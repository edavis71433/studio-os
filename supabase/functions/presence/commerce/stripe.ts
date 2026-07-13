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
  // L1 — reuse the existing Stripe customer for this email instead of minting a
  // duplicate on every checkout (duplicates fragment billing history and can
  // point the billing portal at the wrong subscription). Pass `customer` when we
  // have one; otherwise let Stripe create it from `customer_email`.
  const existingCustomer = await findCustomerIdByEmail(p.email);
  if (existingCustomer) params['customer'] = existingCustomer;
  else params['customer_email'] = p.email;
  // L2 — the idempotency key must include the client: without a signup row the
  // caller passes 'nosignup', so two different customers checking out the same
  // plan/term would collide on one key. clientId is unique per customer.
  const idem = `signup-${p.signupId}-${p.clientId}-${p.plan}-${p.term}`;
  const session = await stripeReq('checkout/sessions', params, idem);
  return { id: String(session.id), url: String(session.url) };
}

/** A one-time SERVICE invoice payment link (a deposit / project charge). A Payment
 *  Link (NOT a 24h Checkout session), so it never expires — a customer can pay
 *  whenever. Inline price_data → no pre-created Price needed. The webhook flips the
 *  invoice to paid via metadata.presence_invoice_id, threaded onto both the link and
 *  the PaymentIntent (payment_intent.succeeded + checkout.session.completed).
 *  Idempotent per invoice (re-sending returns the same price + link). */
export async function createServicePaymentLink(p: { amountCents: number; currency?: string; description: string; invoiceId: string }): Promise<{ url: string; id: string }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const price = await stripeReq('prices', {
    'unit_amount': String(Math.max(1, Math.round(p.amountCents))),
    'currency': (p.currency || 'usd').toLowerCase(),
    'product_data[name]': (p.description || 'Invoice').slice(0, 250),
  }, `price-${p.invoiceId}`);
  const link = await stripeReq('payment_links', {
    'line_items[0][price]': String(price.id),
    'line_items[0][quantity]': '1',
    'metadata[presence_invoice_id]': p.invoiceId,
    'metadata[kind]': 'service_invoice',
    'payment_intent_data[metadata][presence_invoice_id]': p.invoiceId,
    'payment_intent_data[metadata][kind]': 'service_invoice',
    // ONE payment per invoice — after it completes, Stripe deactivates the link,
    // so a client double-clicking the email can never pay the same invoice twice.
    'restrictions[completed_sessions][limit]': '1',
    // Land the payer back on OUR branded thank-you, not Stripe's generic screen.
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': `${SITE_URL}/payment-success.html`,
  }, `plink-${p.invoiceId}`);
  return { url: String(link.url), id: String(link.id) };
}

/** A recurring SERVICE-RETAINER authorization link (a Payment Link, NOT a 24h
 *  Checkout session, so it never expires — the client authorizes whenever). It is
 *  a SEPARATE service-purpose subscription, DISTINCT from the SaaS subscription
 *  primitive above (createSubscriptionCheckout): it carries NO plan/term/founder,
 *  and metadata.purpose='service_retainer' on BOTH the link and the subscription
 *  so the ONE webhook routes every later customer.subscription.* / invoice.* by
 *  purpose to the service rail and NEVER to SaaS entitlement. Inline recurring
 *  price_data → no pre-created Price. Idempotent per (deal, amount, interval): a
 *  re-request returns the same price + link; a changed amount mints a fresh one. */
export async function createServiceRetainerLink(p: { productName: string; amountCents: number; interval: 'month' | 'year'; dealId: string; siteId: string; successUrl?: string }): Promise<{ url: string; id: string; priceId: string }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const key = `${p.dealId}-${Math.max(1, Math.round(p.amountCents))}-${p.interval}`;
  const price = await stripeReq('prices', {
    'unit_amount': String(Math.max(1, Math.round(p.amountCents))),
    'currency': 'usd',
    'recurring[interval]': p.interval,
    'product_data[name]': (p.productName || 'Retainer').slice(0, 250),
  }, `retainer-price-${key}`);
  const link = await stripeReq('payment_links', {
    'line_items[0][price]': String(price.id),
    'line_items[0][quantity]': '1',
    'metadata[purpose]': 'service_retainer',
    'metadata[kind]': 'service_retainer',
    'metadata[deal_id]': p.dealId,
    'metadata[site_id]': p.siteId,
    // Threaded onto the SUBSCRIPTION so every later lifecycle event carries the purpose.
    'subscription_data[metadata][purpose]': 'service_retainer',
    'subscription_data[metadata][kind]': 'service_retainer',
    'subscription_data[metadata][deal_id]': p.dealId,
    'subscription_data[metadata][site_id]': p.siteId,
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': `${p.successUrl || `${SITE_URL}/payment-success.html`}`,
  }, `retainer-plink-${key}`);
  return { url: String(link.url), id: String(link.id), priceId: String(price.id) };
}

/** Deactivate a Payment Link so it can no longer be used (e.g. a pending retainer
 *  the studio canceled before the client ever authorized). Best-effort; never throws. */
export async function deactivatePaymentLink(linkId: string): Promise<void> {
  if (!STRIPE_SECRET || !linkId) return;
  try { await stripeReq(`payment_links/${encodeURIComponent(linkId)}`, { active: 'false' }); } catch { /* best-effort */ }
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
