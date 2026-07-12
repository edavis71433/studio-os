// ════════════════════════════════════════════════════════════════════════════
//  STRIPE WEBHOOK — the single source of payment truth.
//
//  Deploy as its own Supabase Edge Function named `stripe-webhook`, with JWT
//  verification DISABLED (Stripe cannot send Supabase auth headers):
//
//      supabase functions deploy stripe-webhook --no-verify-jwt
//
//  Then in Stripe Dashboard → Developers → Webhooks → Add endpoint:
//      URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//      Events: checkout.session.completed, payment_intent.succeeded,
//              payment_intent.payment_failed
//  Copy the endpoint's signing secret (whsec_...) into this function's secrets
//  as STRIPE_WEBHOOK_SECRET. SB_URL / SERVICE_ROLE_KEY / (optionally)
//  STRIPE_SECRET must also be present, same values as the other functions.
//
//  WHAT IT DOES (and nothing more):
//    • Verifies the Stripe-Signature header (HMAC-SHA256, v1 scheme, 5-minute
//      timestamp tolerance, constant-time compare). Unverified requests get
//      400 and touch nothing. The browser is never trusted about money.
//    • checkout.session.completed (mode=payment) with metadata.invoice_id →
//      PATCH that invoice: status='paid', paid_at=<Stripe event time>. This is
//      the exact contract invoice_paylink writes into the session, and the
//      exact condition the opportunity won-loop sweeps for — so a payment
//      closes its linked opportunity as WON on the next sync, automatically.
//    • checkout.session.completed with metadata.order_id (public audit
//      checkout) → flips that audit order to paid, completing the promise the
//      checkout route's comment always made.
//    • payment_intent.succeeded with metadata.invoice_id → same invoice flip
//      (belt-and-suspenders; invoice_paylink stamps the intent metadata too).
//    • payment_intent.payment_failed → logged, nothing mutated. A failure is
//      information, not state.
//    • Everything else → 200 + log line. Unknown events must not error, or
//      Stripe retries forever.
//    • OBSERVABILITY: every processed event is recorded in
//      stripe_webhook_events (idempotency — duplicate deliveries are
//      acknowledged without re-processing), and every payment/failure lands a
//      row in stripe_payments — the ledger the admin's "Payments (live from
//      Stripe)" panel reads. Ledger writes are best-effort and never block
//      the invoice flip.
//
//  FAILURE BEHAVIOR: database write fails → 500, so Stripe retries with the
//  same event (the PATCH is idempotent: setting paid twice is setting paid).
//  Signature fails → 400, no retry storm, nothing touched. Every branch logs
//  one structured line: [stripe-webhook] <event> <outcome> <ids>.
// ════════════════════════════════════════════════════════════════════════════

const SB_URL = Deno.env.get('SB_URL') || Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
// L1: subscription lifecycle is delegated to the presence function's
// secret-gated billing-sync route (where provisioning + all secrets live), so
// this function stays the thin, single source of PAYMENT truth. Register these
// added events in the Stripe endpoint: checkout.session.completed (already),
// customer.subscription.created / updated / deleted.
const BILLING_SYNC_SECRET = Deno.env.get('BILLING_SYNC_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';

// W4 (L3) — livemode guard. A test-mode event must never mutate live billing (or
// vice-versa). Expected mode is derived from the Stripe secret key prefix
// (sk_live_ / sk_test_) or set explicitly via STRIPE_EXPECT_LIVEMODE=true|false.
// If neither is known we FAIL OPEN (process) but log — never silently drop money.
function expectedLivemode(): boolean | null {
  const explicit = (Deno.env.get('STRIPE_EXPECT_LIVEMODE') || '').trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  const key = Deno.env.get('STRIPE_SECRET') || Deno.env.get('STRIPE_SECRET_KEY') || '';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return true;
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return false;
  return null;
}

// Forward a Stripe object to presence /commerce/billing-sync. Best-effort with
// an honest failure: a non-2xx returns false so the caller can 500 → Stripe
// retries (the sync is idempotent). Never throws.
async function forwardBillingSync(type: string, object: unknown): Promise<boolean> {
  if (!BILLING_SYNC_SECRET) { console.error('[stripe-webhook] BILLING_SYNC_SECRET unset — cannot sync subscription; set it on this function'); return false; }
  try {
    const r = await fetch(`${SB_URL}/functions/v1/presence/commerce/billing-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-commerce-secret': BILLING_SYNC_SECRET, apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
      body: JSON.stringify({ type, object }),
    });
    if (!r.ok) { console.error(`[stripe-webhook] billing-sync ${type} returned ${r.status}`); return false; }
    return true;
  } catch (e) { console.error(`[stripe-webhook] billing-sync ${type} threw: ${String(e)}`); return false; }
}

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]
async function verifyStripeSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !WEBHOOK_SECRET) return false;
  const parts: Record<string, string[]> = {};
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=', 2).map((s) => (s || '').trim());
    if (!k || !v) continue;
    (parts[k] ||= []).push(v);
  }
  const t = parts['t'] && parts['t'][0];
  const v1s = parts['v1'] || [];
  if (!t || !v1s.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!isFinite(age) || age > 300) return false; // 5-minute tolerance
  const expected = await hmacHex(WEBHOOK_SECRET, `${t}.${rawBody}`);
  return v1s.some((v) => timingSafeEqual(v, expected));
}

async function db(path: string, method: string, payload: unknown): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  return r.ok;
}

// POST returning {code, rows}. rows is the inserted row(s) ([] on an ignored
// conflict). code lets the caller tell a conflict (2xx, empty) from a real
// error (4xx/5xx) — e.g. a column that doesn't exist yet (migration not applied).
async function dbInsertReturning(path: string, payload: unknown, prefer: string): Promise<{ code: number; rows: any[] }> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { code: r.status, rows: [] };
    return { code: r.status, rows: await r.json().catch(() => []) };
  } catch { return { code: 0, rows: [] }; }
}

async function dbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
    });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

// ── OBSERVABILITY (restores the incumbent webhook's behavior) ──
// stripe_webhook_events: one row per processed Stripe event (event_id, type,
// received_at) — the idempotency trail. stripe_payments: the ledger the
// admin's "Payments (live from Stripe)" panel reads. Ledger writes are
// best-effort: a failed observability insert is logged loudly but never
// blocks or fails the money truth (the invoice flip), because a 500 here
// would make Stripe retry an already-applied payment for a logging hiccup.
// W4 — CLAIM-FIRST idempotency. Try to INSERT the event row atomically (PK on
// event_id). Outcomes:
//   'claimed'   → we own this event, process it, then mark it done.
//   'done'      → a prior delivery already applied it; acknowledge, skip.
//   'processing'→ another in-flight delivery owns it; acknowledge (if it fails,
//                 its own 500 makes Stripe retry, which will find 'failed').
//   'retry'     → a prior attempt errored (status 'failed'); re-process (safe —
//                 every downstream action is idempotent).
async function claimEvent(eventId: string, type: string, livemode: boolean | null): Promise<'claimed' | 'done' | 'processing' | 'retry'> {
  if (!eventId) return 'claimed'; // no id to dedupe on — process (best-effort)
  const receivedAt = new Date().toISOString();
  const ins = await dbInsertReturning('stripe_webhook_events',
    { event_id: eventId, type, received_at: receivedAt, status: 'processing', livemode },
    'return=representation,resolution=ignore-duplicates');
  if (ins.rows.length > 0) return 'claimed';
  // A 4xx here almost always means the 0083 columns (status/livemode) aren't
  // applied yet on this environment. Fall back to the legacy schema so a deploy
  // that lands before its migration still dedupes (event_id/type/received_at)
  // instead of skipping every event. Zero-downtime-safe in either order.
  if (ins.code >= 400 || ins.code === 0) {
    const legacy = await dbInsertReturning('stripe_webhook_events',
      { event_id: eventId, type, received_at: receivedAt },
      'return=representation,resolution=ignore-duplicates');
    if (legacy.rows.length > 0) return 'claimed';   // fresh row → we own it
    if (legacy.code >= 200 && legacy.code < 300) return 'done';   // 2xx empty = genuine conflict → already recorded
    // Both inserts HARD-failed (transient DB error, code 0/4xx): we can't dedupe.
    // PROCESS rather than drop — dropping a checkout.session.completed here would
    // silently lose a paid signup's provisioning (reconcile only repairs EXISTING
    // entitlements). Downstream is idempotent, so a rare double-process is safe.
    console.error(`[stripe-webhook] claim insert failed for ${eventId} (codes ${ins.code}/${legacy.code}) — processing anyway to avoid dropping the event`);
    return 'claimed';
  }
  // 2xx + empty = a genuine PK conflict; decide by the existing row's status.
  const rows = await dbGet(`stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=status,received_at&limit=1`);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const status = row ? String(row.status || 'done') : 'done';
  if (status === 'failed') return 'retry';
  if (status === 'processing') {
    // Reclaim a STALE in-flight claim: a prior isolate likely died after claiming
    // but before settling. Without this, retries read 'processing' forever and the
    // event is never applied. 5-min window >> normal processing time.
    const ageMs = row?.received_at ? (Date.now() - Date.parse(String(row.received_at))) : 0;
    return ageMs > 5 * 60 * 1000 ? 'retry' : 'processing';
  }
  return 'done';
}

// Mark a claimed/retried event done once its side effects have been applied.
async function markEventDone(eventId: string, type: string) {
  if (!eventId) return;
  const ok = await db(`stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, 'PATCH',
    { type, status: 'done', processed_at: new Date().toISOString() });
  if (!ok) console.error(`[stripe-webhook] could not mark event ${eventId} done (non-fatal)`);
}

// Mark a claim failed so a Stripe retry re-processes it (and it's operator-visible).
async function markEventFailed(eventId: string) {
  if (!eventId) return;
  await db(`stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, 'PATCH', { status: 'failed' }).catch(() => {});
}

async function recordPayment(session: any, md: Record<string, string>, status: string) {
  const ok = await db('stripe_payments', 'POST', {
    stripe_session_id: session.id || null,
    stripe_payment_intent: (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id) || (session.object === 'payment_intent' ? session.id : null),
    stripe_invoice_id: (typeof session.invoice === 'string' ? session.invoice : session.invoice?.id) || null,
    stripe_customer_id: (typeof session.customer === 'string' ? session.customer : session.customer?.id) || null,
    stripe_subscription_id: (typeof session.subscription === 'string' ? session.subscription : session.subscription?.id) || null,
    email: session.customer_details?.email || session.customer_email || null,
    amount: (Number(session.amount_total ?? session.amount ?? 0) || 0) / 100,
    currency: session.currency || 'usd',
    kind: md.kind || (session.mode === 'subscription' ? 'subscription' : 'one_time'),
    status,
    description: md.description || null,
    invoice_id: md.invoice_id || null,
    client_id: md.client_id || null,
  });
  if (!ok) console.error(`[stripe-webhook] could not record payment in stripe_payments (non-fatal, session ${session.id || '?'})`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!SB_URL || !SB_SERVICE) { console.error('[stripe-webhook] misconfigured: missing SB_URL/SERVICE_ROLE_KEY'); return new Response('misconfigured', { status: 500 }); }

  const raw = await req.text();
  const ok = await verifyStripeSignature(raw, req.headers.get('stripe-signature'));
  if (!ok) {
    console.error('[stripe-webhook] signature verification FAILED — request rejected, nothing touched');
    return new Response('invalid signature', { status: 400 });
  }

  let event: any = null;
  try { event = JSON.parse(raw); } catch { return new Response('bad payload', { status: 400 }); }
  const type = String(event?.type || '');
  const eventId = String(event?.id || '');
  const obj = event?.data?.object || {};
  const eventTime = event?.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString();
  const livemode = typeof event?.livemode === 'boolean' ? event.livemode : null;

  // L3 — live/test guard: a signature can be valid yet come from the wrong mode
  // (a test event delivered to the live endpoint). Never mutate billing across
  // the mode boundary. Acknowledge 200 (not 400) so Stripe stops retrying.
  const expect = expectedLivemode();
  if (expect !== null && livemode !== null && livemode !== expect) {
    console.error(`[stripe-webhook] LIVEMODE MISMATCH event ${eventId} (${type}) livemode=${livemode}, expected ${expect} — ignored, nothing touched`);
    return new Response('ignored (livemode mismatch)', { status: 200 });
  }

  // W4 — claim-first idempotency (atomic on the event_id PK). Stripe retries and
  // can deliver duplicates concurrently; only the delivery that wins the INSERT
  // processes. A completed/in-flight duplicate is acknowledged without re-running.
  const claim = await claimEvent(eventId, type, livemode);
  if (claim === 'done' || claim === 'processing') {
    console.log(`[stripe-webhook] duplicate event ${eventId} (${type}) — ${claim}, acknowledged without re-processing`);
    return new Response('ok', { status: 200 });
  }

  // one idempotent action: flip an invoice to paid, from Stripe truth
  const markInvoicePaid = async (invoiceId: string, via: string): Promise<Response> => {
    const wrote = await db(`invoices?id=eq.${encodeURIComponent(invoiceId)}`, 'PATCH', { status: 'paid', paid_at: eventTime });
    if (!wrote) {
      console.error(`[stripe-webhook] ${type} FAILED to mark invoice ${invoiceId} paid (via ${via}) — returning 500 so Stripe retries`);
      return new Response('db write failed', { status: 500 });
    }
    console.log(`[stripe-webhook] ${type} → invoice ${invoiceId} paid (via ${via}); linked opportunity closes as won on next sync`);
    return new Response('ok', { status: 200 });
  };

  // Multi-tenant service invoices/deposits (presence_invoices) — same one authority,
  // flipped via metadata.presence_invoice_id (threaded onto the Payment Link's intent).
  const markPresenceInvoicePaid = async (invoiceId: string, via: string): Promise<Response> => {
    const wrote = await db(`presence_invoices?id=eq.${encodeURIComponent(invoiceId)}`, 'PATCH', { status: 'paid', paid_at: eventTime, updated_at: eventTime });
    if (!wrote) {
      console.error(`[stripe-webhook] ${type} FAILED to mark presence_invoice ${invoiceId} paid (via ${via}) — returning 500 so Stripe retries`);
      return new Response('db write failed', { status: 500 });
    }
    console.log(`[stripe-webhook] ${type} → presence_invoice ${invoiceId} paid (via ${via})`);
    return new Response('ok', { status: 200 });
  };

  // Dispatch returns the Response; the claim is settled ONCE afterward — done on
  // 200, failed on anything else — so a Stripe retry of a failed event re-runs
  // (claim === 'retry') instead of being swallowed as a duplicate.
  const dispatch = async (): Promise<Response> => {
    try {
      if (type === 'checkout.session.completed') {
        const md = obj.metadata || {};
        await recordPayment(obj, md, String(obj.payment_status || 'paid') === 'paid' ? 'paid' : String(obj.payment_status || ''));
        // L1: a self-serve subscription purchase → provision via billing-sync.
        if (String(obj.mode || '') === 'subscription' || md.kind === 'subscription') {
          const ok = await forwardBillingSync(type, obj);
          if (!ok) { console.error(`[stripe-webhook] ${type} subscription sync failed — 500 so Stripe retries`); return new Response('sync failed', { status: 500 }); }
          console.log(`[stripe-webhook] ${type} → subscription provisioned (client ${md.client_id || '?'}, plan ${md.plan || '?'})`);
          return new Response('ok', { status: 200 });
        }
        if (md.invoice_id) return await markInvoicePaid(String(md.invoice_id), 'checkout.session metadata');
        if (md.order_id) {
          const wrote = await db(`audit_orders?id=eq.${encodeURIComponent(String(md.order_id))}`, 'PATCH', { status: 'paid', paid_at: eventTime });
          if (!wrote) { console.error(`[stripe-webhook] ${type} FAILED to mark audit order ${md.order_id} paid`); return new Response('db write failed', { status: 500 }); }
          console.log(`[stripe-webhook] ${type} → audit order ${md.order_id} paid`);
          return new Response('ok', { status: 200 });
        }
        if (md.presence_invoice_id) return await markPresenceInvoicePaid(String(md.presence_invoice_id), 'checkout.session metadata');
        console.log(`[stripe-webhook] ${type} with no invoice_id/order_id metadata (session ${obj.id || '?'}) — payment recorded, nothing to flip`);
        return new Response('ok', { status: 200 });
      }

      if (type === 'payment_intent.succeeded') {
        const md = obj.metadata || {};
        if (md.invoice_id) return await markInvoicePaid(String(md.invoice_id), 'payment_intent metadata');
        if (md.presence_invoice_id) return await markPresenceInvoicePaid(String(md.presence_invoice_id), 'payment_intent metadata');
        console.log(`[stripe-webhook] ${type} with no invoice metadata (${obj.id || '?'}) — acknowledged`);
        return new Response('ok', { status: 200 });
      }

      if (type === 'payment_intent.payment_failed') {
        const md = obj.metadata || {};
        await recordPayment(obj, md, 'failed');
        console.error(`[stripe-webhook] payment FAILED${md.invoice_id ? ` for invoice ${md.invoice_id}` : ''} (${obj.id || '?'}): ${obj.last_payment_error?.message || 'no detail'} — invoice state unchanged`);
        return new Response('ok', { status: 200 });
      }

      // L1: subscription lifecycle → entitlement sync (renewal, past-due grace,
      // voluntary pause, cancellation). Delegated to billing-sync; a failed sync
      // returns 500 so Stripe retries the (idempotent) event.
      if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
        const ok = await forwardBillingSync(type, obj);
        if (!ok) { console.error(`[stripe-webhook] ${type} sync failed — 500 so Stripe retries`); return new Response('sync failed', { status: 500 }); }
        console.log(`[stripe-webhook] ${type} → entitlement synced (sub ${obj.id || '?'}, status ${obj.status || '?'})`);
        return new Response('ok', { status: 200 });
      }

      // unhandled event types are acknowledged, never errored
      console.log(`[stripe-webhook] ignoring event type ${type}`);
      return new Response('ok', { status: 200 });
    } catch (e) {
      console.error(`[stripe-webhook] unexpected error on ${type}: ${String(e)} — 500 so Stripe retries`);
      return new Response('error', { status: 500 });
    }
  };

  const res = await dispatch();
  if (res.status === 200) await markEventDone(eventId, type);
  else await markEventFailed(eventId);   // release the claim so the retry re-processes
  return res;
});