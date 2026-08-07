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

  // ── TAKE DOWN the "Still unpaid" reminder the paid invoice raised ──────────
  // runInvoiceReminders (commerce/lifecycle.ts) raises deal_followup with period
  // `invremind:<invoice id>`, and money landing is that row's ONLY teardown —
  // an unpaid-invoice reminder is deliberately undismissable by hand
  // (lib/inbox_feed.noticeDismissible) and no route in the platform can void an
  // invoice either. So this clear cannot be allowed to be skipped.
  //
  // It used to be the LAST statement of the paid-echo try{}: a throw at the deal
  // event POST or the site lookup jumped straight past it, and Stripe's retry
  // then short-circuited on `already paid` and never re-ran the echo — money
  // landed, row stranded, forever. It is now (a) its OWN unit that swallows
  // everything, (b) the FIRST thing the echo does, and (c) run on the
  // already-paid path too, so a retry heals a row a previous attempt stranded.
  // Returns the owning client_id so the echo below need not re-read the site.
  // Never throws; its result never affects payment processing.
  //
  // This function has no lib/notice.ts (it is a separate Edge Function with its
  // own db() helper), so the clear mirrors clearNotice's shape here.
  const clearInvoiceReminder = async (inv: any): Promise<string> => {
    try {
      const siteRow = (await dbGet(`presence_sites?id=eq.${encodeURIComponent(String(inv?.site_id ?? ''))}&select=client_id&limit=1`))[0];
      const clientId = String(siteRow?.client_id || '');
      if (!clientId) return '';
      await db(
        `presence_plan_notices?client_id=eq.${encodeURIComponent(clientId)}&kind=eq.deal_followup&status=eq.active&period=eq.${encodeURIComponent(`invremind:${inv.id}`)}`,
        'PATCH', { status: 'dismissed' },
      );
      return clientId;
    } catch (e) {
      console.error(`[stripe-webhook] invremind clear best-effort failed for ${inv?.id}:`, e);
      return '';
    }
  };

  // MONEY AGAINST A WITHDRAWN INVOICE — the one payment outcome the product had
  // no record of. markPresenceInvoicePaid correctly refuses to resurrect a voided
  // invoice (a void invoice stays void), but the ONLY trace of that refusal was a
  // console.log and a stripe_payments row, and neither is inside the app.
  //
  // Two ordinary ways a client still pays one:
  //   · POST /sales/invoices/:id/void deactivates the Stripe Payment Link, and
  //     that call failed silently (Stripe said no, or was unreachable); or
  //   · they already had a Checkout Session open. Deactivating a Payment Link
  //     does NOT kill sessions already minted from it, so a client with the
  //     payment page loaded can complete it afterwards.
  //
  // Either way the studio is holding money on an invoice it withdrew, and has to
  // decide whether to refund it — so it has to SEE it. Raised on the ONE notice
  // model everything else uses (presence_plan_notices, unique on
  // (client_id, kind, period)), so it reaches the bell, Today and the Inbox with
  // no second notification system. The period is the invoice id, so a Stripe
  // retry of the same event re-raises nothing.
  //
  // DISMISSABLE by design (deliberately NOT in NOTICE_PROTECTED_KINDS): the
  // resolution — refund in Stripe, or keep the money and re-raise the invoice —
  // happens outside this application, so nothing here can ever tear the row down.
  // An undismissable row with no automatic teardown is a permanent one.
  //
  // Best-effort and fully swallowed: it can never affect the 200 that stops
  // Stripe retrying a payment we have already accepted. Requires migration 0119
  // (the kind CHECK); pre-migration the insert is rejected, logged, and the
  // payment is processed exactly as before.
  const noticeVoidedInvoicePaid = async (inv: any, via: string): Promise<void> => {
    try {
      const siteRow = (await dbGet(`presence_sites?id=eq.${encodeURIComponent(String(inv?.site_id ?? ''))}&select=client_id&limit=1`))[0];
      const clientId = String(siteRow?.client_id || '');
      if (!clientId) return;
      const amount = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      const what = inv.title || (inv.purpose === 'deposit' ? 'Deposit' : 'Invoice');
      await db('presence_plan_notices', 'POST', {
        site_id: inv.site_id, client_id: clientId, kind: 'invoice_void_paid',
        period: `voidpaid:${inv.id}`, status: 'active',
        headline: `Payment received on a withdrawn invoice — ${what} (${amount})`,
        body: 'This invoice was voided, so it has not been marked paid — but the money did arrive. Refund it in Stripe, or raise a fresh invoice if the work is going ahead.',
      });
      console.error(`[stripe-webhook] payment landed on VOIDED presence_invoice ${inv.id} (via ${via}) — invoice left void, operator notice raised`);
    } catch (e) {
      console.error(`[stripe-webhook] could not raise the voided-invoice-paid notice for ${inv?.id}:`, e);
    }
  };

  // Multi-tenant service invoices/deposits (presence_invoices) — same one authority,
  // flipped via metadata.presence_invoice_id (threaded onto the Payment Link's intent).
  const markPresenceInvoicePaid = async (invoiceId: string, via: string): Promise<Response> => {
    // Fetch first: (a) an unknown id must NOT log a false success, (b) only an
    // OPEN invoice may flip (a voided one stays void even if its old link is paid),
    // (c) the row's site/deal ids feed the owner-facing echo below.
    const inv = (await dbGet(`presence_invoices?id=eq.${encodeURIComponent(invoiceId)}&select=id,site_id,deal_id,title,amount_cents,purpose,status&limit=1`))[0];
    if (!inv) {
      console.error(`[stripe-webhook] ${type} → presence_invoice ${invoiceId} not found (via ${via}) — acking so Stripe stops retrying`);
      return new Response('ok (unknown invoice)', { status: 200 });
    }
    if (inv.status === 'paid') {
      // The healing path. A retry lands here whenever a previous attempt flipped
      // the row but died before (or during) its echo. The clear is idempotent —
      // it matches only still-ACTIVE invremind rows — so re-running it costs one
      // no-op PATCH and is the only thing that can rescue a stranded reminder.
      await clearInvoiceReminder(inv);
      return new Response('ok (already paid)', { status: 200 });
    }
    if (inv.status !== 'open') {
      console.log(`[stripe-webhook] ${type} → presence_invoice ${invoiceId} is '${inv.status}', not flipping (via ${via})`);
      // A payment on a VOIDED invoice is money taken against something the studio
      // withdrew — the refusal to flip it is right, but it must be VISIBLE.
      // Only 'void': any other non-open status is not a withdrawal.
      if (inv.status === 'void') await noticeVoidedInvoicePaid(inv, via);
      return new Response('ok (not open)', { status: 200 });
    }
    // return=representation so ONLY the write that actually flipped the row (the
    // race winner) emits the owner echo — a concurrent duplicate matches 0 rows.
    const flipped = await fetch(`${SB_URL}/rest/v1/presence_invoices?id=eq.${encodeURIComponent(invoiceId)}&status=eq.open`, {
      method: 'PATCH',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'paid', paid_at: eventTime, updated_at: eventTime }),
    });
    if (!flipped.ok) {
      console.error(`[stripe-webhook] ${type} FAILED to mark presence_invoice ${invoiceId} paid (via ${via}) — returning 500 so Stripe retries`);
      return new Response('db write failed', { status: 500 });
    }
    const flippedRows = await flipped.json().catch(() => []);
    if (!Array.isArray(flippedRows) || flippedRows.length === 0) {
      return new Response('ok (already flipped by a concurrent event)', { status: 200 });
    }
    // FIRST, before anything that can throw: take the "Still unpaid" row down.
    // Everything after it is an ADDITION to the owner's view; this is a REMOVAL
    // of a line that now contradicts reality ("Still unpaid — Deposit ($500)"
    // directly above "Paid — Deposit ($500)"), and it is the only clear that row
    // will ever get. Ordering is the whole fix — it is deliberately not inside
    // the echo's try{}, because that try is what used to swallow its turn.
    const clientId = await clearInvoiceReminder(inv);
    // The owner-facing echo: a deal event (Pipeline history) + a notice (bell /
    // Today / Inbox) — without these, payment was invisible inside the app.
    try {
      const amount = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      if (inv.deal_id) {
        await db('presence_deal_events', 'POST', {
          site_id: inv.site_id, deal_id: inv.deal_id, kind: 'invoice_paid',
          actor: 'stripe', actor_kind: 'system',
          detail: { invoice_id: inv.id, amount_cents: Number(inv.amount_cents) || 0, purpose: inv.purpose },
        });
      }
      if (clientId) {
        await db('presence_plan_notices', 'POST', {
          site_id: inv.site_id, client_id: clientId, kind: 'invoice_paid',
          period: `paid:${inv.id}`, status: 'active',
          headline: `Paid — ${inv.title || (inv.purpose === 'deposit' ? 'Deposit' : 'Invoice')} (${amount})`,
          body: inv.purpose === 'deposit' ? 'The deposit landed. You can start the work.' : 'The payment landed — nothing else to do.',
        });
      }
    } catch (e) { console.error(`[stripe-webhook] paid-echo best-effort failed for ${invoiceId}:`, e); }
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

      // SERVICE RETAINER settlement (recurring service charges). SaaS entitlement
      // rides subscription.* + checkout — it never uses invoice.*, so this branch
      // is purely additive and cannot touch SaaS. Forward ONLY when the object is
      // tagged with the service-retainer PURPOSE (on the invoice or its subscription
      // details); billing-sync then updates the retainer and records the settlement.
      // (Register invoice.payment_succeeded / invoice.payment_failed in the Stripe
      // endpoint to enable the per-charge echo; retainer STATUS also stays correct
      // via the always-registered customer.subscription.* events below.)
      if (type === 'invoice.payment_succeeded' || type === 'invoice.payment_failed') {
        const imd = obj.metadata || {};
        const smd = obj.subscription_details?.metadata || {};
        const isRetainer = imd.purpose === 'service_retainer' || imd.kind === 'service_retainer' || smd.purpose === 'service_retainer' || smd.kind === 'service_retainer';
        if (isRetainer) {
          const ok = await forwardBillingSync(type, obj);
          if (!ok) { console.error(`[stripe-webhook] ${type} retainer sync failed — 500 so Stripe retries`); return new Response('sync failed', { status: 500 }); }
          console.log(`[stripe-webhook] ${type} → service retainer settled (sub ${(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id) || '?'})`);
        } else {
          console.log(`[stripe-webhook] ${type} (not a service retainer) — acknowledged, entitlement unaffected`);
        }
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