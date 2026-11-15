// ── Which Stripe we were built for, and where it puts things (sales item 128) ──
// Stripe changes the SHAPE of what it sends from one API version to the next, and
// a call that names no version gets whatever the account's default is that day.
// The Nov 15 2026 Stripe review found the account and the webhook on
// 2026-05-27.dahlia while the retainer code still read the fields Stripe moved in
// 2025-03-31.basil: invoice.subscription and invoice.subscription_details went
// under invoice.parent.subscription_details, and a subscription's
// current_period_end went onto its items. So every retainer charge would have
// been missed, and no next charge date shown.
//
// STRIPE_API_VERSION is sent on every call (commerce/stripe.ts) and is the version
// the webhook endpoint is set to in Stripe; stripe-webhook/index.ts carries its own
// copy, and tests/presence/stripe_retainer_charges_128_test.mjs holds the two
// together. The readers below take both shapes, the new one first, so an event
// Stripe sends in the older shape (a retry, a resend from the dashboard) still
// reads right. Pure, no imports.

export const STRIPE_API_VERSION = '2026-05-27.dahlia';

type Obj = Record<string, any> | null | undefined;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (v: unknown): string => String((typeof v === 'string' ? v : isObj(v) ? v.id : '') || '');

/** The notes WE put on a Stripe object (purpose, deal_id, site_id). A checkout
 *  session and a subscription carry them as their own metadata; an invoice carries
 *  its subscription's under parent.subscription_details (older shape:
 *  subscription_details) and has an EMPTY metadata of its own, which must not win. */
export function stripeMetaOf(obj: Obj): Record<string, unknown> {
  const marked = (m: unknown): m is Record<string, unknown> => isObj(m) && !!(m.deal_id || m.purpose || m.kind);
  for (const m of [obj?.metadata, obj?.parent?.subscription_details?.metadata, obj?.subscription_details?.metadata]) {
    if (marked(m)) return m;
  }
  return isObj(obj?.metadata) ? obj!.metadata : {};
}

/** The subscription a Stripe object belongs to: a subscription's own id, a checkout
 *  session's `subscription`, an invoice's parent.subscription_details.subscription
 *  (older shape: `subscription`). '' when it names none. */
export function stripeSubscriptionIdOf(obj: Obj): string {
  if (obj?.object === 'subscription') return idOf(obj.id);
  return idOf(obj?.subscription) || idOf(obj?.parent?.subscription_details?.subscription);
}

/** When a subscription next charges, as unix seconds, or null. Since basil it is
 *  on each item; a subscription with several items renews at the latest of them. */
export function subscriptionPeriodEnd(sub: Obj): number | null {
  const top = Number(sub?.current_period_end);
  if (Number.isFinite(top) && top > 0) return top;
  let best = 0;
  for (const it of Array.isArray(sub?.items?.data) ? sub!.items.data : []) {
    const v = Number(it?.current_period_end);
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best > 0 ? best : null;
}

/** What a paid Stripe invoice actually took, in cents. null when Stripe didn't say
 *  (a caller may fall back to the amount it expected); 0 is a real answer, a $0
 *  invoice, and is never recorded as a charge. */
export function invoicePaidCents(inv: Obj): number | null {
  const v = inv?.amount_paid;
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** When Stripe says an invoice was paid, as an ISO string, or null. */
export function invoicePaidAt(inv: Obj): string | null {
  const t = Number(inv?.status_transitions?.paid_at);
  return Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : null;
}
