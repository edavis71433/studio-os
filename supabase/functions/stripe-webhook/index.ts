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
async function recordEvent(eventId: string, type: string) {
  if (!eventId) return;
  const ok = await db('stripe_webhook_events', 'POST', { event_id: eventId, type, received_at: new Date().toISOString() });
  if (!ok) console.error(`[stripe-webhook] could not record event ${eventId} in stripe_webhook_events (non-fatal)`);
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const rows = await dbGet(`stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
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

  // idempotency: Stripe retries and can deliver duplicates; a seen event id
  // is acknowledged without re-processing
  if (await alreadyProcessed(eventId)) {
    console.log(`[stripe-webhook] duplicate event ${eventId} (${type}) — already processed, acknowledged`);
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

  try {
    if (type === 'checkout.session.completed') {
      const md = obj.metadata || {};
      await recordPayment(obj, md, String(obj.payment_status || 'paid') === 'paid' ? 'paid' : String(obj.payment_status || ''));
      if (md.invoice_id) {
        const res = await markInvoicePaid(String(md.invoice_id), 'checkout.session metadata');
        if (res.status === 200) await recordEvent(eventId, type);
        return res;
      }
      if (md.order_id) {
        const wrote = await db(`audit_orders?id=eq.${encodeURIComponent(String(md.order_id))}`, 'PATCH', { status: 'paid', paid_at: eventTime });
        if (!wrote) { console.error(`[stripe-webhook] ${type} FAILED to mark audit order ${md.order_id} paid`); return new Response('db write failed', { status: 500 }); }
        console.log(`[stripe-webhook] ${type} → audit order ${md.order_id} paid`);
        await recordEvent(eventId, type);
        return new Response('ok', { status: 200 });
      }
      console.log(`[stripe-webhook] ${type} with no invoice_id/order_id metadata (session ${obj.id || '?'}) — payment recorded, nothing to flip`);
      await recordEvent(eventId, type);
      return new Response('ok', { status: 200 });
    }

    if (type === 'payment_intent.succeeded') {
      const md = obj.metadata || {};
      if (md.invoice_id) {
        const res = await markInvoicePaid(String(md.invoice_id), 'payment_intent metadata');
        if (res.status === 200) await recordEvent(eventId, type);
        return res;
      }
      console.log(`[stripe-webhook] ${type} with no invoice metadata (${obj.id || '?'}) — acknowledged`);
      await recordEvent(eventId, type);
      return new Response('ok', { status: 200 });
    }

    if (type === 'payment_intent.payment_failed') {
      const md = obj.metadata || {};
      await recordPayment(obj, md, 'failed');
      console.error(`[stripe-webhook] payment FAILED${md.invoice_id ? ` for invoice ${md.invoice_id}` : ''} (${obj.id || '?'}): ${obj.last_payment_error?.message || 'no detail'} — invoice state unchanged`);
      await recordEvent(eventId, type);
      return new Response('ok', { status: 200 });
    }

    // unhandled event types are acknowledged, never errored
    console.log(`[stripe-webhook] ignoring event type ${type}`);
    await recordEvent(eventId, type);
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error(`[stripe-webhook] unexpected error on ${type}: ${String(e)} — 500 so Stripe retries`);
    return new Response('error', { status: 500 });
  }
});