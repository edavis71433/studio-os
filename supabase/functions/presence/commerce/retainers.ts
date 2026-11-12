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
  /** Sales item 117: subscriptions a SECOND approval of the same link started. The
   *  retainer itself stays on the first; these are remembered so Cancel stops them too. */
  extra_subscription_ids?: string[];
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

// ── DUNNING (operator audit #3): a care-plan payment failure must be SEEN ────
// applyRetainerSync used to flip retainer.status to past_due/canceled and tell
// NOBODY — no notice, no email, no dashboard consumer outside the deal drawer.
// Recurring service money quietly stopping is exactly the class of silence this
// platform exists to end, so a status TRANSITION now raises one calm owner
// notice (+ the send-once email, gated on the notice's created flag). Pure
// decision + copy here; the impure raise lives inside applyRetainerSync below.

/** Which transitions deserve the owner's attention. Only a CHANGE counts — a
 *  webhook retry that lands on the same status is silence. Pure. */
export function retainerTransition(priorStatus: string | undefined, nextStatus: string | undefined): 'past_due' | 'canceled' | 'recovered' | null {
  const prior = String(priorStatus || '');
  const next = String(nextStatus || '');
  if (!next || prior === next) return null;
  if (next === 'past_due') return 'past_due';
  if (next === 'canceled') return 'canceled';
  if (next === 'active' && prior === 'past_due') return 'recovered';
  return null;
}

/** Weekly-bucketed dedupe keys, one namespace per deal — the recovery teardown
 *  clears every bucket at once via the prefix (the supportAgingPeriod idiom).
 *  Send-once inside a week even if Stripe delivers several failed-invoice
 *  events; a retainer STILL past due next week may speak again. Pure. */
export function retainerNoticePeriodPrefix(dealId: string): string { return `retainer:${dealId}:`; }
export function retainerNoticePeriod(dealId: string, transition: 'past_due' | 'canceled', nowMs: number): string {
  const w = Number.isFinite(nowMs) ? Math.floor(nowMs / (7 * 86400_000)) : 0;
  return `${retainerNoticePeriodPrefix(dealId)}${transition}:w${w}`;
}

/** The studio's plain voice: what happened, which client/deal, what to do. Pure. */
export function retainerNoticeCopy(transition: 'past_due' | 'canceled', dealTitle: string, amountCents: number, interval: string): { headline: string; body: string; subject: string; html: string } {
  const name = (dealTitle || '').trim() || 'a retainer client';
  const amt = '$' + ((Number(amountCents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const per = interval === 'year' ? 'year' : 'month';
  if (transition === 'past_due') {
    return {
      headline: `A retainer payment didn’t go through — ${name}`,
      body: `The ${amt}/${per} retainer didn’t collect this cycle. Stripe retries automatically — if it keeps failing, the client’s card likely needs updating. The work agreement itself hasn’t changed.`,
      subject: `A retainer payment didn’t go through — ${name}`,
      html: `<p>The <b>${amt}/${per}</b> retainer for <b>${name}</b> didn’t collect this cycle.</p><p>Stripe retries automatically over the next few days. If it keeps failing, the client’s card needs updating — open the subscription in Stripe to see the attempts, or send the client a fresh authorization link from the deal.</p>`,
    };
  }
  return {
    headline: `A retainer ended — ${name}`,
    body: `The ${amt}/${per} retainer has been canceled in Stripe and won’t bill again. If that’s expected, nothing to do. If not, a fresh authorization link from the deal restarts it.`,
    subject: `A retainer ended — ${name}`,
    html: `<p>The <b>${amt}/${per}</b> retainer for <b>${name}</b> has been canceled in Stripe and won’t bill again.</p><p>If you and the client agreed to wrap up, nothing to do. If this is a surprise, open the deal and send a fresh authorization link to restart it.</p>`,
  };
}

// ── A SECOND APPROVAL (sales item 117, Nov 12 2026 review, finding 5) ────────
// The retainer link had no one-approval limit, so a client who opened the email
// twice started two monthly charges. The sync then overwrote the stored
// subscription with the newest, so Cancel retainer stopped one and the other went
// on charging, unseen. New links take one approval (commerce/stripe.ts); links
// already sent, and a pay page left open, can still produce a second one. So:
// the retainer stays on its FIRST subscription, a different one arriving while it
// is live (or after it was cancelled) is an EXTRA, the studio is told once, and
// Cancel stops every one of them.
/** Is this subscription a second approval, not the retainer's own? Pure. */
export function isExtraSubscription(prior: Partial<RetainerState> | null, subId: string): boolean {
  const main = String(prior?.stripe_subscription_id || '');
  if (!prior || !subId || !main || subId === main) return false;
  if ((prior.extra_subscription_ids || []).map(String).includes(subId)) return true;
  return prior.status === 'active' || prior.status === 'past_due' || prior.status === 'canceled';
}
/** Every Stripe subscription a Cancel must stop: the retainer's own, then the extras. Pure. */
export function retainerSubscriptionIds(r: Partial<RetainerState> | null): string[] {
  const out: string[] = [];
  for (const id of [r?.stripe_subscription_id, ...((r?.extra_subscription_ids || []) as unknown[])]) { const s = String(id || ''); if (s && !out.includes(s)) out.push(s); }
  return out;
}
export const retainerTwicePeriod = (dealId: string, subId: string): string => `${retainerNoticePeriodPrefix(dealId)}twice:${subId}`;
export function retainerTwiceCopy(dealTitle: string, amountCents: number, interval: string, afterCancel: boolean): { headline: string; body: string } {
  const name = (dealTitle || '').trim() || 'a retainer client';
  const amt = '$' + ((Number(amountCents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const per = interval === 'year' ? 'year' : 'month';
  return afterCancel
    ? { headline: `Retainer approved after you cancelled it: ${name}`, body: `The client approved the ${amt} a ${per} retainer through its old link after it was cancelled, and Stripe is charging them. Cancel retainer on the deal stops it. Refund what was taken in Stripe.` }
    : { headline: `Retainer approved twice: ${name}`, body: `The client approved the ${amt} a ${per} retainer a second time, so two charges are running. Stop the extra one in Stripe and refund its charge. Cancel retainer on the deal stops both.` };
}

/** What the client's portal shows of a retainer (sales item 117): the amount, how often,
 *  where it stands, its charges, and whether they can cancel it. Never a Stripe id. Pure. */
export interface RetainerCharge { at: string; amount: number }
export function retainerPortalView(deal: { id: string; title?: unknown; retainer?: Partial<RetainerState> | null }, charges: RetainerCharge[]): Record<string, unknown> | null {
  const r = deal?.retainer;
  if (!r || typeof r !== 'object' || !r.status) return null;
  const status = String(r.status);
  if (status === 'canceled' && !charges.length) return null;   // set up and withdrawn before it ever charged: nothing of theirs to show
  if (status === 'pending' && !r.checkout_url) return null;
  return {
    id: deal.id, name: String(deal.title || 'Retainer').slice(0, 200),
    amount: (Number(r.amount_cents) || 0) / 100, interval: r.interval === 'year' ? 'year' : 'month', status,
    since: r.created_at || null, next_charge: status === 'active' ? (r.current_period_end || null) : null, canceled_at: r.canceled_at || null,
    approve_url: status === 'pending' ? String(r.checkout_url) : null,
    can_cancel: status === 'active' || status === 'past_due',
    charges: charges.slice(0, 24),
  };
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

  const dr = await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}&deleted_at=is.null&select=id,title,retainer&limit=1`).catch(() => ({ json: [] as any[] }));
  const deal = Array.isArray(dr.json) ? dr.json[0] : null;
  const prior: Partial<RetainerState> | null = (deal && deal.retainer && typeof deal.retainer === 'object') ? deal.retainer : null;
  if (!prior) return { synced: false, reason: 'no_retainer' };   // never invent a retainer from a webhook

  // A second approval never becomes the retainer (sales item 117): see isExtraSubscription.
  if (isExtraSubscription(prior, subId)) return await syncExtraSubscription(type, obj, { dealId, siteId, title: String((deal as { title?: string }).title || ''), prior, subId, nowIso });

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

  // ── DUNNING (operator audit #3) — the transition, made audible ─────────────
  // Deliberately INSIDE applyRetainerSync (the SERVICE rail), never the SaaS
  // billing branch: the purpose-metadata separation above is load-bearing, and
  // this touches only the deal's own notice rail. Best-effort and gated on the
  // stored PATCH landing (a transition we failed to record is retried by
  // Stripe, and must not burn its send-once key on a state we don't hold).
  // Pre-0127 the 'retainer_status' kind fails the notices CHECK → raiseNotice
  // returns false → no email, no throw: dormant until Eric applies the SQL
  // (the 0094–0119 deploy-order posture — SQL lands before or with the deploy).
  if ((up as { ok?: boolean }).ok === true) {
    try {
      const change = retainerTransition(prior.status, next.status);
      if (change) {
        const { raiseNotice, clearNoticePrefix } = await import('../lib/notice.ts');
        const siteRow = (await svc(`presence_sites?id=eq.${encodeURIComponent(siteId)}&select=client_id&limit=1`).catch(() => ({ json: null as any }))).json?.[0];
        const clientId = String(siteRow?.client_id || '');
        if (clientId) {
          if (change === 'recovered') {
            // the money is flowing again — the bell must stop saying otherwise
            await clearNoticePrefix(clientId, 'retainer_status', retainerNoticePeriodPrefix(dealId));
          } else {
            const title = String((deal as { title?: string }).title || '').slice(0, 80);
            const copy = retainerNoticeCopy(change, title, Number(next.amount_cents) || 0, String(next.interval || 'month'));
            const fresh = await raiseNotice({
              siteId, clientId, kind: 'retainer_status',
              period: retainerNoticePeriod(dealId, change, Date.now()),
              headline: copy.headline, body: copy.body,
            });
            if (fresh) {
              const { emailOperator } = await import('../lib/service_bridge.ts');
              const href = next.stripe_subscription_id
                ? `https://dashboard.stripe.com/subscriptions/${next.stripe_subscription_id}`
                : `${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '')}/pipeline.html?deal=${dealId}`;
              emailOperator(siteId, copy.subject, copy.html, 'retainer_status',
                { label: change === 'past_due' ? 'Open it in Stripe' : 'Open the deal', href }).catch(() => {});
            }
          }
        }
      }
    } catch { /* the dunning echo is best-effort — retainer truth is already stored */ }
  }

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

/** A subscription that is NOT the retainer's own (a second approval). It is
 *  remembered on the deal, the studio is told once, and its ending takes it off
 *  again. The retainer's own status, subscription and dates are never touched by it. */
async function syncExtraSubscription(type: string, obj: any, x: { dealId: string; siteId: string; title: string; prior: Partial<RetainerState>; subId: string; nowIso: string }): Promise<{ synced: boolean; reason?: string }> {
  const had = (x.prior.extra_subscription_ids || []).map(String);
  const ended = type === 'customer.subscription.deleted' || (type.startsWith('customer.subscription.') && retainerStatusFromStripe(String(obj?.status || '')) === 'canceled');
  const extras = ended ? had.filter((id) => id !== x.subId) : (had.includes(x.subId) ? had : [...had, x.subId]);
  let ok = true;
  if (extras.length !== had.length) {
    const up = await svc(`presence_deals?id=eq.${encodeURIComponent(x.dealId)}&site_id=eq.${encodeURIComponent(x.siteId)}`, { method: 'PATCH', body: JSON.stringify({ retainer: { ...x.prior, extra_subscription_ids: extras, updated_at: x.nowIso } }) }).catch(() => ({ ok: false }));
    ok = (up as { ok?: boolean }).ok === true;
  }
  if (!ended && ok) {
    try {
      const { raiseNotice } = await import('../lib/notice.ts');
      const clientId = String((await svc(`presence_sites?id=eq.${encodeURIComponent(x.siteId)}&select=client_id&limit=1`).catch(() => ({ json: null as any }))).json?.[0]?.client_id || '');
      if (clientId) {
        const copy = retainerTwiceCopy(x.title.slice(0, 80), Number(x.prior.amount_cents) || 0, String(x.prior.interval || 'month'), x.prior.status === 'canceled');
        const fresh = await raiseNotice({ siteId: x.siteId, clientId, kind: 'retainer_status', period: retainerTwicePeriod(x.dealId, x.subId), headline: copy.headline, body: copy.body });
        if (fresh) {
          const { emailOperator } = await import('../lib/service_bridge.ts');
          emailOperator(x.siteId, copy.headline, `<p>${copy.body.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))}</p>`, 'retainer_status', { label: 'Open it in Stripe', href: `https://dashboard.stripe.com/subscriptions/${x.subId}` }).catch(() => {});
        }
      }
    } catch { /* the extra is remembered either way */ }
  }
  // the money did land: the deal's history and its retainer total say so
  if (type === 'invoice.payment_succeeded') {
    const amt = Number(obj?.amount_paid ?? obj?.amount_due ?? 0) || Number(x.prior.amount_cents) || 0;
    await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ deal_id: x.dealId, site_id: x.siteId, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system', detail: { retainer: true, extra: true, amount_cents: amt, interval: x.prior.interval } }) }).catch(() => {});
  }
  return { synced: ok, reason: 'second_approval' };
}
