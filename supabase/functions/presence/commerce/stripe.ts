// ── L1 · Stripe API helper ──────────────────────────────────────────────────
// Thin, honest wrapper over the Stripe REST API, mirroring the pattern already
// used in clever-api (form-encoded POST, Idempotency-Key, error surfaced). No
// pre-created Stripe Price IDs are needed: the payment links use inline
// price_data, so the amount comes from our own records and the whole flow works
// with just STRIPE_SECRET configured. (The self-serve plan checkout went with
// sign-up, builder item 199; the billing portal still manages a plan already paid.)
//
// When STRIPE_SECRET is absent the caller gets a clear "billing not configured"
// signal (never a crash, never a fake success) — the route turns that into a
// calm 503 so a mis-provisioned environment is obvious, not silently broken.
//
// Every call names the Stripe version this code reads (sales item 128): without
// it a call gets the account's default of the day, and one press of "Upgrade" in
// Stripe's Workbench would change the shape of every answer with nobody told.
import { STRIPE_API_VERSION } from './stripe_shape.ts';
import { stripeKeyKind } from './stripe_key.ts';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET') || '';
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');

export function stripeConfigured(): boolean { return !!STRIPE_SECRET; }
/** Restricted or full-power, live or test, read from the key's prefix (sales item 131).
 *  The key itself stays in this file. */
export const heldKeyKind = () => stripeKeyKind(STRIPE_SECRET);

/** The one place this file talks to Stripe, so every call names the version (sales
 *  item 128). Answers the status and Stripe's JSON; a network failure throws. */
async function stripeFetch(path: string, params: Record<string, string>, method: 'POST' | 'GET' | 'DELETE', idem?: string, timeoutMs?: number): Promise<{ status: number; body: any }> {
  const h: Record<string, string> = { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION };
  if (idem) h['Idempotency-Key'] = idem;
  const qs = (method === 'GET' || method === 'DELETE') && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs}`, { method, headers: h, body: method === 'POST' ? new URLSearchParams(params).toString() : undefined, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function stripeReq(path: string, params: Record<string, string>, idem?: string, method: 'POST' | 'GET' | 'DELETE' = 'POST'): Promise<any> {
  const { status, body: j } = await stripeFetch(path, params, method, idem);
  if (status < 200 || status >= 300) throw new Error((j && j.error && j.error.message) || `stripe ${status}`);
  if (!j) throw new Error(`stripe ${status}: an answer that couldn’t be read`);
  return j;
}

/** One question to Stripe whose answer is only its status (sales item 131, the key
 *  check in commerce/stripe_key.ts). A 403 from Stripe names the permission the key
 *  lacks ("Having the 'rak_payout_write' permission would allow this request"); that
 *  name is the only thing kept from the answer. Stripe's message also quotes part of
 *  the key and the account, so neither is ever passed on. Never throws: a network
 *  failure is status 0. */
export async function stripeProbe(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string> = {}): Promise<{ status: number; lacks: string | null }> {
  if (!STRIPE_SECRET) return { status: 0, lacks: null };
  try {
    const { status, body } = await stripeFetch(path, params, method, undefined, 10_000);
    const said = String((body && body.error && body.error.message) || '');
    const m = status === 403 ? said.match(/'(rak_[a-z_]+)'/) : null;
    return { status, lacks: m ? m[1] : null };
  } catch { return { status: 0, lacks: null }; }
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

/** The ways a client can pay (sales item 132, the Nov 15 2026 Stripe review, finding 6).
 *  A link that names none offers whatever is switched on in Stripe's settings, which on
 *  a dollar invoice was card, Link, bank, Klarna, Cash App Pay and Amazon Pay. Klarna
 *  costs about twice a card and no client has used it, so every link now names exactly:
 *    card             a card, and the wallets switched on in Stripe's settings, which come
 *                     under card (Apple Pay is on; Google Pay was off when this was written, Nov 16 2026)
 *    link             Link, Stripe's saved-details checkout
 *    us_bank_account  a US bank payment (ACH); dollars only, so it is left off any other currency
 *  A method switched on in Stripe for something else can't appear on an invoice by
 *  surprise. Adding one later means adding it here. */
export function payMethodTypes(currency?: string): string[] {
  return String(currency || 'usd').toLowerCase() === 'usd' ? ['card', 'link', 'us_bank_account'] : ['card', 'link'];
}
const payMethodParams = (currency?: string): Record<string, string> =>
  Object.fromEntries(payMethodTypes(currency).map((t, i) => [`payment_method_types[${i}]`, t]));

/** A one-time SERVICE invoice payment link (a deposit / project charge). A Payment
 *  Link (NOT a 24h Checkout session), so it never expires — a customer can pay
 *  whenever. Inline price_data → no pre-created Price needed. The webhook flips the
 *  invoice to paid via metadata.presence_invoice_id, threaded onto both the link and
 *  the PaymentIntent (payment_intent.succeeded + checkout.session.completed).
 *  Idempotent per invoice (re-sending returns the same price + link).
 *
 *  `gen` (sales item 116) is presence_invoices.link_gen: which link the invoice is
 *  on. Stripe hands the SAME link back for the same key, so a link that is spent
 *  (it takes one payment; a bank payment that bounced used it up) or was made for
 *  another amount (a part payment, an Undo) could never be replaced, and the same
 *  key with a new amount is refused outright. Whoever clears the stored link adds
 *  one to link_gen; a link made under the new number is a new one. 0 keeps the
 *  keys every invoice had before, so a retry of an old send still lands on its link. */
export const payLinkKey = (invoiceId: string, gen?: unknown): string => {
  const g = Math.max(0, Math.trunc(Number(gen) || 0));
  return g ? `${invoiceId}-g${g}` : invoiceId;
};
export async function createServicePaymentLink(p: { amountCents: number; currency?: string; description: string; invoiceId: string; gen?: unknown }): Promise<{ url: string; id: string }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const key = payLinkKey(p.invoiceId, p.gen);
  const price = await stripeReq('prices', {
    'unit_amount': String(Math.max(1, Math.round(p.amountCents))),
    'currency': (p.currency || 'usd').toLowerCase(),
    'product_data[name]': (p.description || 'Invoice').slice(0, 250),
  }, `price-${key}`);
  const link = await stripeReq('payment_links', {
    'line_items[0][price]': String(price.id),
    'line_items[0][quantity]': '1',
    ...payMethodParams(p.currency),
    'metadata[presence_invoice_id]': p.invoiceId,
    'metadata[kind]': 'service_invoice',
    'payment_intent_data[metadata][presence_invoice_id]': p.invoiceId,
    'payment_intent_data[metadata][kind]': 'service_invoice',
    // ONE payment per invoice — after it completes, Stripe deactivates the link,
    // so a client double-clicking the email can never pay the same invoice twice.
    'restrictions[completed_sessions][limit]': '1',
    // Oct 2026 benchmark (item 1): land the payer back on THEIR Invoices tab,
    // naming the invoice, so the row can say "Paid — confirming" while the
    // webhook catches up (client.html reads ?paid=). A payer with no portal
    // sign-in is forwarded on by client.html to payment-success.html?paid=…,
    // the branded thank-you this used to send everyone to. A Payment Link's
    // after_completion redirect is the only return hook Stripe's hosted page
    // offers — it fires once the session COMPLETES, which for a delayed method
    // (ACH) is before the money settles; hence "confirming", never "paid".
    // No #fragment here: Stripe validates the URL and client.html opens the
    // tab itself from ?paid=. Links minted BEFORE this deploy keep their old
    // redirect (Stripe does not re-read the function) — see the PR's steps.
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': `${SITE_URL}/client.html?paid=${encodeURIComponent(p.invoiceId)}`,
  }, `plink-${key}`);
  return { url: String(link.url), id: String(link.id) };
}

/** A recurring SERVICE-RETAINER authorization link (a Payment Link, NOT a 24h
 *  Checkout session, so it never expires — the client authorizes whenever). It is
 *  a SEPARATE service-purpose subscription, DISTINCT from a Studio OS plan
 *  subscription (the billing portal's): it carries NO plan/term/founder,
 *  and metadata.purpose='service_retainer' on BOTH the link and the subscription
 *  so the ONE webhook routes every later customer.subscription.* / invoice.* by
 *  purpose to the service rail and NEVER to SaaS entitlement. Inline recurring
 *  price_data → no pre-created Price. Idempotent per (deal, amount, interval, the
 *  moment this retainer was asked for): a retry of the same request returns the
 *  same price + link; a changed amount, or a retainer set up again after a cancel,
 *  mints a fresh one (the cancelled one's link is switched off, and Stripe would
 *  otherwise hand that dead link straight back).
 *
 *  ONE approval per link (sales item 117): it had no limit, so a client who opened
 *  the email twice started two monthly charges. */
export async function createServiceRetainerLink(p: { productName: string; amountCents: number; interval: 'month' | 'year'; dealId: string; siteId: string; successUrl?: string; askedAt?: string }): Promise<{ url: string; id: string; priceId: string }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const asked = Date.parse(String(p.askedAt || ''));
  const key = `${p.dealId}-${Math.max(1, Math.round(p.amountCents))}-${p.interval}${Number.isFinite(asked) ? '-' + asked : ''}`;
  const price = await stripeReq('prices', {
    'unit_amount': String(Math.max(1, Math.round(p.amountCents))),
    'currency': 'usd',
    'recurring[interval]': p.interval,
    'product_data[name]': (p.productName || 'Retainer').slice(0, 250),
  }, `retainer-price-${key}`);
  const link = await stripeReq('payment_links', {
    'line_items[0][price]': String(price.id),
    'line_items[0][quantity]': '1',
    ...payMethodParams('usd'),   // the same ways to pay as an invoice; each later charge uses the one approved here
    'metadata[purpose]': 'service_retainer',
    'metadata[kind]': 'service_retainer',
    'metadata[deal_id]': p.dealId,
    'metadata[site_id]': p.siteId,
    // Threaded onto the SUBSCRIPTION so every later lifecycle event carries the purpose.
    'subscription_data[metadata][purpose]': 'service_retainer',
    'subscription_data[metadata][kind]': 'service_retainer',
    'subscription_data[metadata][deal_id]': p.dealId,
    'subscription_data[metadata][site_id]': p.siteId,
    'restrictions[completed_sessions][limit]': '1',
    'after_completion[type]': 'redirect',
    // its own thank-you: the page used to tell someone who had just approved a retainer that their invoice was paid
    'after_completion[redirect][url]': `${p.successUrl || `${SITE_URL}/payment-success.html?retainer=1`}`,
  }, `retainer-plink-${key}`);
  return { url: String(link.url), id: String(link.id), priceId: String(price.id) };
}

/** Deactivate a Payment Link so it can no longer be used (a pending retainer the
 *  studio canceled before the client ever authorized; an invoice the studio
 *  withdrew). Best-effort — it never throws — but it now REPORTS.
 *
 *  It used to return `void` and swallow both a throw and a non-2xx, so "Stripe
 *  confirmed the link is dead", "Stripe said no" (revoked key, no such link, rate
 *  limit) and "Stripe was unreachable" were byte-identical to every caller. The
 *  void handler therefore told the operator a flat "Invoice voided" in all three
 *  cases, and a client paying through a link the studio believes is switched off
 *  is exactly what that route exists to prevent. `true` means Stripe CONFIRMED
 *  the link is inactive; anything else is `false` and the caller must say so.
 *
 *  Even `true` is not a guarantee that nobody can pay: deactivating a Payment
 *  Link does NOT kill Checkout Sessions already minted from it, so a client who
 *  had the payment page open can still complete it. That case is caught on the
 *  other side — stripe-webhook refuses to flip a voided invoice and raises an
 *  `invoice_void_paid` operator notice. */
export async function deactivatePaymentLink(linkId: string): Promise<boolean> {
  if (!STRIPE_SECRET || !linkId) return false;
  try { await stripeReq(`payment_links/${encodeURIComponent(linkId)}`, { active: 'false' }); return true; }
  catch (e) {
    console.error(`[stripe] could not deactivate payment link ${linkId}: ${String((e as Error)?.message || e)} — it may still be live`);
    return false;
  }
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

// ── Refunds and disputes (sales items 126, 127) ─────────────────────────────
// Read-only. A refund or a dispute made in Stripe reaches Studio OS as an event;
// commerce/charge_returns.ts reads the charge and its refunds, or the dispute, fresh
// from here rather than trusting what the event carried, so events that arrive late
// or out of order still land on Stripe's latest word. Each throws on a Stripe error
// (the caller answers "try again" and Stripe sends the event again).

/** One charge: its payment intent, amounts (amount, amount_captured, amount_refunded),
 *  refunded / disputed, how it was paid (payment_method_details.type). */
export async function retrieveCharge(id: string): Promise<any> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  return await stripeReq(`charges/${encodeURIComponent(id)}`, {}, undefined, 'GET');
}

/** Every refund on one charge, newest first (a charge holds far fewer than 100). */
export async function listChargeRefunds(chargeId: string): Promise<any[]> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const r = await stripeReq('refunds', { charge: chargeId, limit: '100' }, undefined, 'GET');
  return Array.isArray(r?.data) ? r.data : [];
}

/** One dispute: amount, status, reason, evidence_details.due_by, and the balance
 *  transactions that took the money (and Stripe's fee) and gave it back. */
export async function retrieveDispute(id: string): Promise<any> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  return await stripeReq(`disputes/${encodeURIComponent(id)}`, {}, undefined, 'GET');
}

/** The disputes on one charge (a charge can be disputed once). */
export async function listChargeDisputes(chargeId: string): Promise<any[]> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const r = await stripeReq('disputes', { charge: chargeId, limit: '10' }, undefined, 'GET');
  return Array.isArray(r?.data) ? r.data : [];
}

/** One payment intent: its metadata (presence_invoice_id, set on every pay link's
 *  payment) and latest_charge. */
export async function retrievePaymentIntent(id: string): Promise<any> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  return await stripeReq(`payment_intents/${encodeURIComponent(id)}`, {}, undefined, 'GET');
}

/** The Stripe invoice a payment intent paid, or '' when it paid none (a pay link's
 *  payment). Since 2025-03-31.basil a charge no longer names its invoice; Stripe's
 *  invoice payments list does. This is how a retainer charge is found. */
export async function invoiceForPaymentIntent(paymentIntentId: string): Promise<string> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const r = await stripeReq('invoice_payments', { 'payment[type]': 'payment_intent', 'payment[payment_intent]': paymentIntentId, limit: '1' }, undefined, 'GET');
  const first = Array.isArray(r?.data) ? r.data[0] : null;
  const inv = first?.invoice;
  return String((typeof inv === 'string' ? inv : inv?.id) || '');
}

// ── What reached the bank: fees and payouts, for the bookkeeper file (sales item 133) ──
// Read only. Stripe keeps its fee from each payment and pays the rest out in batches,
// so each payment has a balance transaction (amount, fee, net) and each payout lists
// the balance transactions it carried. These reads feed lib/stripe_ledger.ts.

/** Every page of a Stripe list, up to `maxPages` of 100; `more` says Stripe had more
 *  than that. Throws when Stripe can't be read, so a short list is never taken for a
 *  whole one. */
async function listAll(path: string, params: Record<string, string>, maxPages: number): Promise<{ data: any[]; more: boolean }> {
  const data: any[] = [];
  let after = '';
  for (let page = 0; page < maxPages; page++) {
    const res = await stripeReq(path, { ...params, limit: '100', ...(after ? { starting_after: after } : {}) }, undefined, 'GET');
    const got = Array.isArray(res?.data) ? res.data : [];
    data.push(...got);
    after = String(got.length ? got[got.length - 1]?.id || '' : '');
    if (!res?.has_more || !after) return { data, more: false };
  }
  return { data, more: true };
}

/** Each payment Stripe took between two moments (unix seconds), with the charge it came
 *  from: a charge carries its PaymentIntent's notes, so presence_invoice_id names the
 *  invoice. A card is type charge, a bank payment type payment. */
export async function listPaymentBalanceTransactions(fromSec: number, toSec: number, maxPages = 10): Promise<{ data: any[]; more: boolean }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const span = { 'created[gte]': String(Math.floor(fromSec)), 'created[lt]': String(Math.floor(toSec)), 'expand[]': 'data.source' };
  const [cards, banks] = await Promise.all(['charge', 'payment'].map((type) => listAll('balance_transactions', { ...span, type }, maxPages)));
  return { data: [...cards.data, ...banks.data], more: cards.more || banks.more };
}

/** Payouts due to arrive between two moments (unix seconds). */
export async function listPayouts(fromSec: number, toSec: number, maxPages = 5): Promise<{ data: any[]; more: boolean }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  return await listAll('payouts', { 'arrival_date[gte]': String(Math.floor(fromSec)), 'arrival_date[lt]': String(Math.floor(toSec)) }, maxPages);
}

/** What one automatic payout carried: its balance transactions, each naming its source. */
export async function listPayoutTransactions(payoutId: string, maxPages = 5): Promise<{ data: any[]; more: boolean }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  return await listAll('balance_transactions', { payout: String(payoutId) }, maxPages);
}

/** The PaymentIntent that paid a Stripe invoice (a retainer's monthly charge), or ''. */
export async function paymentIntentForInvoice(stripeInvoiceId: string): Promise<string> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const res = await stripeReq('invoice_payments', { invoice: String(stripeInvoiceId), limit: '10' }, undefined, 'GET');
  const rows = Array.isArray(res?.data) ? res.data : [];
  const paid = rows.find((x: any) => x?.status === 'paid' && x?.payment?.type === 'payment_intent') || rows.find((x: any) => x?.payment?.type === 'payment_intent');
  const pi = paid?.payment?.payment_intent;
  return String((typeof pi === 'string' ? pi : pi?.id) || '');
}

// ── Retainer cards (sales item 129) ──────────────────────────────────────────
/** Stripe's own page for a client to put in a new card (sales item 129): the
 *  customer portal, opened on "update your payment method" and nothing else, which
 *  Stripe's own guide sends a subscriber to when a charge fails. They come back to
 *  `doneUrl` once a card is saved, or to `returnUrl` if they leave first. A session
 *  lives a short while, so every press makes a new one. Stripe refuses until the
 *  customer portal has been saved once in its settings, and then this throws. */
export async function createCardUpdateSession(p: { customerId: string; returnUrl: string; doneUrl: string }): Promise<{ url: string }> {
  if (!STRIPE_SECRET) throw new Error('not_configured');
  const s = await stripeReq('billing_portal/sessions', {
    customer: p.customerId,
    return_url: p.returnUrl,
    'flow_data[type]': 'payment_method_update',
    'flow_data[after_completion][type]': 'redirect',
    'flow_data[after_completion][redirect][return_url]': p.doneUrl,
  });
  if (!/^https:\/\//.test(String(s?.url || ''))) throw new Error('no_session_url');
  return { url: String(s.url) };
}
