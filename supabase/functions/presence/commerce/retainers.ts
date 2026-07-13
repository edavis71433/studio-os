// ── Service retainers — recurring SERVICE billing on the frozen boundary ─────
// A retainer is the studio billing a client "$X every month/year" for ongoing
// work. It rides the SERVICE rail, kept DELIBERATELY DISTINCT from the customer's
// own SaaS subscription (presence_entitlements, product='presence'). The ONLY
// discriminator is PURPOSE METADATA — exactly the frozen billing boundary:
//   ONE Stripe · ONE webhook authority · SaaS-vs-service told apart by purpose.
//
// How it stays off the SaaS rail (verified against the code that owns SaaS truth):
//   • The retainer's Stripe subscription carries metadata.purpose='service_retainer'
//     (never plan/term/founder). commerce/billing-sync routes it here BEFORE the
//     SaaS branch, so applyEntitlementPatch (which filters product=eq.presence) is
//     never reached. Even without that guard, the SaaS branch ignores it (no plan
//     metadata → isPlanKey false → 'no_plan_metadata'), so there is defence in depth.
//   • Retainer state lives on the DEAL (presence_deals.retainer jsonb), never on
//     presence_entitlements — so no SaaS lifecycle sweep, reconcile, renewal
//     reminder, or entitlement read (all product=eq.presence) can ever see it.
//
// Pure cores up top (exhaustively unit-tested); the impure webhook sync below.
import { svc } from '../lib/db.ts';

export const RETAINER_PURPOSE = 'service_retainer';

export type RetainerStatus = 'pending' | 'active' | 'past_due' | 'canceled';
export type RetainerInterval = 'month' | 'year';

export interface RetainerState {
  status: RetainerStatus;
  amount_cents: number;
  interval: RetainerInterval;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_link_id: string | null;
  checkout_url: string | null;          // the client's non-expiring authorization link
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
}

// ── PURPOSE METADATA — the ONE thing that keeps a retainer off the SaaS rail ──
/** Does this Stripe object's metadata mark it a SERVICE retainer (not SaaS)? The
 *  webhook + billing-sync route on exactly this. Pure. */
export function isServiceRetainerMeta(md: Record<string, unknown> | null | undefined): boolean {
  if (!md || typeof md !== 'object') return false;
  return md.purpose === RETAINER_PURPOSE || md.kind === RETAINER_PURPOSE;
}

/** Which billing RAIL a Stripe event's metadata belongs to. A retainer is
 *  'service_retainer'; everything else (a SaaS plan subscription) is 'saas'. This
 *  is the isolation invariant, made testable: a retainer NEVER reads as 'saas',
 *  and a SaaS subscription (plan/term metadata) NEVER reads as 'service_retainer'. */
export function billingRailFor(md: Record<string, unknown> | null | undefined): 'service_retainer' | 'saas' {
  return isServiceRetainerMeta(md) ? 'service_retainer' : 'saas';
}

// ── validation ───────────────────────────────────────────────────────────────
export interface RetainerInput { amount_cents: number; interval: RetainerInterval; }
export function validateRetainerInput(amountCents: unknown, interval: unknown): { ok: true; value: RetainerInput } | { ok: false; error: string } {
  const amt = Math.trunc(Number(amountCents));
  if (!Number.isFinite(amt) || amt < 100) return { ok: false, error: 'Enter a retainer amount of at least $1.00.' };
  if (amt > 100_000_000) return { ok: false, error: 'That amount is over $1,000,000 — double-check it and try again.' };
  if (interval !== 'month' && interval !== 'year') return { ok: false, error: 'Choose monthly or annual billing.' };
  return { ok: true, value: { amount_cents: amt, interval } };
}

// ── status mapping (Stripe subscription status → the retainer's calm status) ──
export function retainerStatusFromStripe(stripeStatus: string): RetainerStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    default:
      return 'pending';
  }
}

/** Merge a webhook/API patch onto the deal's stored retainer, stamping updated_at.
 *  Load-bearing guard: a CANCELED retainer is never resurrected by a late,
 *  out-of-order webhook (a subscription.updated arriving after cancel) — canceling
 *  is final. Pure. */
export function mergeRetainerState(prior: Partial<RetainerState> | null, patch: Partial<RetainerState>, nowIso: string): RetainerState {
  const base: Partial<RetainerState> = prior || {};
  const clean: Partial<RetainerState> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
  const out = { ...base, ...clean, updated_at: nowIso } as RetainerState;
  if (base.status === 'canceled' && patch.status && patch.status !== 'canceled') out.status = 'canceled';
  return out;
}

// ── Agreement renewal / expiry reminder (a SIGNED contract's term-end) ───────
// DISTINCT from the SaaS renewal_reminder: this is the studio's own signed
// service agreement approaching its term end. A calm OWNER nudge ~30 and ~7 days
// out — never an auto-renew or auto-charge (silent renewals break the "nothing is
// final until you act" calm). Pure decision + copy; the sweep raises the notice.
export function agreementRenewalWindow(termEnd: string | null | undefined, nowIso: string): 7 | 30 | null {
  if (!termEnd) return null;
  const end = Date.parse(String(termEnd).length <= 10 ? `${termEnd}T00:00:00Z` : String(termEnd));
  const now = Date.parse(nowIso);
  if (!isFinite(end) || !isFinite(now)) return null;
  const days = Math.floor((end - now) / 86_400_000);
  if (days < 0) return null;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  return null;
}

/** The send-once key: one per term-end per window, so the 30-day and 7-day notes
 *  each fire exactly once (and a re-dated agreement gets a fresh sequence). Pure. */
export function agreementRenewalPeriod(termEnd: string, window: 7 | 30): string {
  return `${String(termEnd).slice(0, 10)}:${window}`;
}

/** Calm, owner-facing copy — the agreement, the date, and the explicit promise
 *  that nothing renews or charges by itself. Pure. */
export function agreementRenewalCopy(title: string, termEndIso: string, window: 7 | 30): { headline: string; body: string; subject: string } {
  const when = new Date(String(termEndIso).length <= 10 ? `${termEndIso}T00:00:00Z` : String(termEndIso))
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const name = (title || '').trim() || 'a signed agreement';
  const lead = window === 7 ? `The term for “${name}” ends ${when}` : `A heads-up: the term for “${name}” ends ${when}`;
  return {
    headline: lead,
    body: `${lead}. Nothing renews or bills automatically — when you're ready, reach out to your client to renew, revise, or wrap up. This is only so it never lapses without you deciding.`,
    subject: lead,
  };
}

// ── the impure webhook sync (called by commerce/billing-sync, by PURPOSE) ────
// Updates the deal's retainer state from Stripe truth. NEVER touches presence_
// entitlements (SaaS) — it only PATCHes presence_deals.retainer. Resolves the deal
// from the metadata WE set (deal_id/site_id), falling back to the stored
// subscription id for invoice.* events that carry only the subscription. Best-
// effort + honest: it will NOT create a retainer it didn't originate (a prior
// state must already exist), so a stray webhook can never invent one.
export async function applyRetainerSync(type: string, obj: any): Promise<{ synced: boolean; reason?: string }> {
  const nowIso = new Date().toISOString();
  const md = (obj && (obj.metadata || obj.subscription_details?.metadata)) || {};
  let dealId = String(md.deal_id || '');
  let siteId = String(md.site_id || '');
  const subId = String(
    (obj?.object === 'subscription' ? obj?.id : '') ||
    (typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id) || '',
  );

  // Fallback (invoice.* events): resolve the deal by the stored subscription id.
  // Pre-0096 this jsonb filter simply matches nothing → clean no-op.
  if ((!dealId || !siteId) && subId) {
    const q = await svc(`presence_deals?retainer->>stripe_subscription_id=eq.${encodeURIComponent(subId)}&deleted_at=is.null&select=id,site_id&limit=1`).catch(() => ({ json: [] as any[] }));
    const row = Array.isArray(q.json) ? q.json[0] : null;
    if (row) { dealId = String(row.id); siteId = String(row.site_id); }
  }
  if (!dealId || !siteId) return { synced: false, reason: 'no_deal' };

  const dr = await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}&deleted_at=is.null&select=id,retainer&limit=1`).catch(() => ({ json: [] as any[] }));
  const deal = Array.isArray(dr.json) ? dr.json[0] : null;
  const prior: Partial<RetainerState> | null = (deal && deal.retainer && typeof deal.retainer === 'object') ? deal.retainer : null;
  if (!prior) return { synced: false, reason: 'no_retainer' };   // never invent a retainer from a webhook

  const patch: Partial<RetainerState> = {};
  if (subId) patch.stripe_subscription_id = subId;
  if (obj?.customer) patch.stripe_customer_id = String(typeof obj.customer === 'string' ? obj.customer : obj.customer.id);
  if (type === 'customer.subscription.deleted') {
    patch.status = 'canceled';
    patch.canceled_at = nowIso;
  } else if (type.startsWith('customer.subscription.')) {
    patch.status = retainerStatusFromStripe(String(obj?.status || ''));
    const cpe = Number(obj?.current_period_end);
    if (isFinite(cpe) && cpe > 0) patch.current_period_end = new Date(cpe * 1000).toISOString();
  } else if (type === 'checkout.session.completed') {
    patch.status = 'active';   // the client authorized; subscription.created reconciles the details
  } else if (type === 'invoice.payment_succeeded') {
    patch.status = 'active';
  } else if (type === 'invoice.payment_failed') {
    patch.status = 'past_due';
  }

  const next = mergeRetainerState(prior, patch, nowIso);
  const up = await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}`, {
    method: 'PATCH', body: JSON.stringify({ retainer: next }),
  }).catch(() => ({ ok: false }));

  // Settlement echo (best-effort): a recurring charge landed → a calm history line
  // on the deal, exactly like a paid service invoice. Reuses the allowed
  // 'invoice_paid' deal-event kind; detail.retainer distinguishes it in the UI.
  if (type === 'invoice.payment_succeeded') {
    try {
      const amt = Number(obj?.amount_paid ?? obj?.amount_due ?? 0) || Number(next.amount_cents) || 0;
      await svc('presence_deal_events', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ deal_id: dealId, site_id: siteId, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system', detail: { retainer: true, amount_cents: amt, interval: next.interval } }),
      }).catch(() => {});
    } catch { /* the echo is best-effort */ }
  }
  return { synced: (up as { ok?: boolean }).ok === true };
}
