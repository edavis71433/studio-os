// ── L1 · Stripe API helper ──────────────────────────────────────────────────
// Thin, honest wrapper over the Stripe REST API, mirroring the pattern already
// used in clever-api (form-encoded POST, Idempotency-Key, error surfaced). No
// pre-created Stripe Price IDs are needed: subscription Checkout uses inline
// price_data + a recurring interval, so the amount comes from our own catalog
// and the whole flow works with just STRIPE_SECRET configured.
//
// When STRIPE_SECRET is absent the caller gets a clear "billing not configured"
// signal (never a crash, never a fake success) — the route turns that into a
// calm 503 so a mis-provisioned environment is obvious, not silently broken.

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET') || '';
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');

export function stripeConfigured(): boolean { return !!STRIPE_SECRET; }
export function siteUrl(): string { return SITE_URL; }

async function stripeReq(path: string, params: Record<string, string>, idem?: string, method: 'POST' | 'GET' | 'DELETE' = 'POST'): Promise<any> {
  const h: Record<string, string> = { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idem) h['Idempotency-Key'] = idem;
  const qs = (method === 'GET' || method === 'DELETE') && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const url = `https://api.stripe.com/v1/${path}${qs}`;
  const r = await fetch(url, { method, headers: h, body: method === 'POST' ? new URLSearchParams(params).toString() : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error((j && j.error && j.error.message) || `stripe ${r.status}`);
  return j;
}

/** Cancel a subscription immediately (stops future billing). Keeps the Stripe
 *  customer + past invoices for tax/audit. Idempotent-ish: canceling an already-
 *  canceled sub returns ok. Never throws to the caller. */
export async function cancelSubscription(subId: string): Promise<{ ok: boolean; error?: string }> {
  if (!STRIPE_SECRET) return { ok: false, error: 'not_configured' };
  if (!subId) return { ok: true };
  try { await stripeReq(`subscriptions/${encodeURIComponent(subId)}`, {}, undefined, 'DELETE'); return { ok: true }; }
  catch (e) { const m = String((e as Error).message || e); if (/no such subscription|already canceled|resource_missing/i.test(m)) return { ok: true }; return { ok: false, error: m }; }
}

/** The existing Stripe customer id for an email, or null (W8: reuse, don't dup). */
export async function findCustomerIdByEmail(email: string): Promise<string | null> {
  if (!STRIPE_SECRET || !email) return null;
  try { const r = await stripeReq('customers', { email, limit: '1' }, undefined, 'GET'); return r?.data?.[0]?.id || null; }
  catch { return null; }
}

export interface CheckoutParams {
  productName: string;      // shown on the Stripe page + receipt
  amountCents: number;      // per-interval charge
  interval: 'month' | 'year';
  email: string;
  clientId: string;
  plan: string;
  term: string;
  founder: boolean;
  signupId: string;
  successUrl?: string;
  cancelUrl?: string;
}

// A subscription Checkout session. Metadata is threaded onto BOTH the session
// (so checkout.session.completed can provision) and the subscription (so every
// later customer.subscription.* lifecycle event carries plan/term/founder).
export async function createSubscriptionCheckout(p: CheckoutParams): Promise<{ id: string; url: string }> {
  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': p.productName,
    'line_items[0][price_data][recurring][interval]': p.interval,
    'line_items[0][price_data][unit_amount]': String(p.amountCents),
    'line_items[0][quantity]': '1',
    'success_url': `${p.successUrl || `${SITE_URL}/welcome.html`}?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': p.cancelUrl || `${SITE_URL}/pricing.html`,
    'customer_email': p.email,
    'client_reference_id': p.signupId,
    'metadata[client_id]': p.clientId,
    'metadata[plan]': p.plan,
    'metadata[term]': p.term,
    'metadata[founder]': p.founder ? 'true' : 'false',
    'metadata[signup_id]': p.signupId,
    'metadata[kind]': 'subscription',
    'subscription_data[metadata][client_id]': p.clientId,
    'subscription_data[metadata][plan]': p.plan,
    'subscription_data[metadata][term]': p.term,
    'subscription_data[metadata][founder]': p.founder ? 'true' : 'false',
  };
  const session = await stripeReq('checkout/sessions', params, `signup-${p.signupId}-${p.plan}-${p.term}`);
  return { id: String(session.id), url: String(session.url) };
}

// A Billing Portal session — the customer manages payment method, cancels,
// or changes plan through Stripe's own hosted surface. Requires a customer id.
export async function createBillingPortal(customerId: string, returnUrl?: string): Promise<{ url: string }> {
  const session = await stripeReq('billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl || `${SITE_URL}/presence.html`,
  });
  return { url: String(session.url) };
}

export async function retrieveSubscription(subId: string): Promise<any> {
  return await stripeReq(`subscriptions/${encodeURIComponent(subId)}`, {}, undefined, 'GET');
}

export async function retrieveCheckoutSession(sessionId: string): Promise<any> {
  return await stripeReq(`checkout/sessions/${encodeURIComponent(sessionId)}`, { 'expand[0]': 'subscription' }, undefined, 'GET');
}
