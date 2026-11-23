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
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { svc } from '../lib/db.ts';
import { stripeMetaOf, stripeSubscriptionIdOf, subscriptionPeriodEnd, invoicePaidCents, invoicePaidAt, subscriptionAmount } from './stripe_shape.ts';
import { stripeConfigured, retrieveSubscription } from './stripe.ts';

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

/** Every deal with a retainer, oldest first, a page at a time. The daily Stripe check (sales item
 *  130, commerce/stripe_check.ts) reads the first page, and the week-before note for a yearly
 *  retainer (sales item 163, commerce/lifecycle.ts runRetainerRenewalNotes) reads the same path
 *  later in the same 15-minute run, so the run's shared reads (builder item 402, lib/db.ts
 *  tickMemo) answer the second from the first: one database call between them, unless the
 *  check changed a deal in between. Keep the two on this one path. */
export const RETAINER_DEALS_PAGE = 100;
export function retainerDealsPath(offset = 0): string {
  return `presence_deals?retainer=not.is.null&deleted_at=is.null&select=id,site_id,title,contact_id,retainer,created_at&order=created_at.asc&limit=${RETAINER_DEALS_PAGE}${offset > 0 ? `&offset=${offset}` : ''}`;
}
export function retainerNoticePeriod(dealId: string, transition: 'past_due' | 'canceled', nowMs: number): string {
  const w = Number.isFinite(nowMs) ? Math.floor(nowMs / (7 * 86400_000)) : 0;
  return `${retainerNoticePeriodPrefix(dealId)}${transition}:w${w}`;
}

/** The studio's plain voice: what happened, which client/deal, what to do. Pure.
 *
 *  Sales item 129: the failed-card line used to say "send the client a fresh
 *  authorization link from the deal", which the deal refuses while the retainer is
 *  past due. It now says what works: Email the card link on the deal (Stripe's own
 *  page for a new card), or the client does it from their portal. `reason` is
 *  Stripe's cancellation_details.reason on a retainer that ended: 'payment_failed'
 *  means every retry failed and Stripe stopped it. */
export function retainerNoticeCopy(transition: 'past_due' | 'canceled', dealTitle: string, amountCents: number, interval: string, reason?: string): { headline: string; body: string; subject: string; html: string } {
  const name = (dealTitle || '').trim() || 'a retainer client';
  const amt = '$' + ((Number(amountCents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const per = interval === 'year' ? 'year' : 'month';
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
  if (transition === 'past_due') {
    return {
      headline: `A retainer card didn’t go through: ${name}`,
      body: `The ${amt} a ${per} charge didn’t go through. Stripe tries the card again over the next few days. To fix it sooner, press Email the card link on the deal: the client puts in a new card on Stripe’s own page. They can also do it from their portal. If every try fails, Stripe ends the retainer.`,
      subject: `A retainer card didn’t go through: ${name}`,
      html: `<p>The <b>${amt} a ${per}</b> retainer charge for <b>${esc(name)}</b> didn’t go through.</p><p>Stripe tries the card again over the next few days. To fix it sooner, open the deal and press <b>Email the card link</b>: the client puts in a new card on Stripe’s own page, and Stripe uses it for the next try. They can also do it from their portal.</p><p>If every try fails, Stripe ends the retainer.</p>`,
    };
  }
  if (reason === 'payment_failed') {
    return {
      headline: `A retainer ended after its card kept failing: ${name}`,
      body: `Stripe tried the ${amt} a ${per} charge several times, then ended the retainer. It won’t charge again. To start it again, set up the retainer again from the deal: the client approves it with a card that works.`,
      subject: `A retainer ended after its card kept failing: ${name}`,
      html: `<p>Stripe tried the <b>${amt} a ${per}</b> retainer charge for <b>${esc(name)}</b> several times, then ended the retainer. It won’t charge again.</p><p>To start it again, open the deal and set up the retainer again: the client approves it with a card that works.</p>`,
    };
  }
  return {
    headline: `A retainer ended — ${name}`,
    body: `The ${amt}/${per} retainer has been canceled in Stripe and won’t bill again. If that’s expected, nothing to do. If not, a fresh authorization link from the deal restarts it.`,
    subject: `A retainer ended — ${name}`,
    html: `<p>The <b>${amt}/${per}</b> retainer for <b>${esc(name)}</b> has been canceled in Stripe and won’t bill again.</p><p>If you and the client agreed to wrap up, nothing to do. If this is a surprise, open the deal and send a fresh authorization link to restart it.</p>`,
  };
}

/** Can the client put in a new card for this retainer (sales item 129)? Only a live
 *  one, and only once Stripe has named its customer (the approval did that). Pure. */
export function retainerCardFixable(r: Partial<RetainerState> | null | undefined): boolean {
  if (!r || typeof r !== 'object') return false;
  return (r.status === 'active' || r.status === 'past_due') && !!String(r.stripe_customer_id || '');
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
  if (!prior || !subId) return false;
  const main = String(prior.stripe_subscription_id || '');
  if ((prior.extra_subscription_ids || []).map(String).includes(subId)) return true;
  // Sales item 140 (Nov 22 2026 review): a retainer cancelled while it was still waiting holds
  // no subscription, so an approval that landed after the cancel (Stripe lets an open pay page
  // finish) was taken as the retainer's own: it stayed "Cancelled", nobody was told, Stripe
  // charged every month and Cancel answered "already cancelled". It is an extra, like one that
  // lands after a cancel of a live retainer: the studio hears it and Cancel stops it.
  if (!main) return prior.status === 'canceled';
  if (subId === main) return false;
  return prior.status === 'active' || prior.status === 'past_due' || prior.status === 'canceled';
}
/** Sales item 140: did this approval come through a link that is not the retainer's own (the
 *  old link of a waiting retainer that was cancelled and set up again at a new price)? The
 *  checkout session names its link; a mismatch is an extra, never the new retainer's own. Pure. */
export function approvedThroughOldLink(prior: Partial<RetainerState> | null, session: any): boolean {
  const ours = String(prior?.stripe_payment_link_id || '');
  const via = String((typeof session?.payment_link === 'string' ? session.payment_link : session?.payment_link?.id) || '');
  return !!ours && !!via && via !== ours && String(session?.object || 'checkout.session') === 'checkout.session';
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
export interface RetainerCharge { at: string; amount: number; id?: string; refunded?: number; refunded_at?: string | null; receipt_url?: string | null }   // sales item 174: a refunded charge says so and links its receipt (item 163)
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
    can_cancel: status === 'active' || status === 'past_due' || (Array.isArray(r.extra_subscription_ids) && r.extra_subscription_ids.length > 0),   // sales item 140: an approval that landed after a cancel still charges, and Cancel must stop it
    can_update_card: retainerCardFixable(r),   // sales item 129: Stripe's page for a new card
    charges: charges.slice(0, 24),
  };
}

/** Merge a webhook/API patch onto the deal's stored retainer, stamping updated_at.
 *  Load-bearing guard: a CANCELED retainer is never resurrected by a late,
 *  out-of-order webhook (a subscription.updated arriving after cancel) — canceling
 *  is final. Sales item 130: nor does a retainer that went live ever go back to
 *  waiting for approval. Stripe's 'incomplete' (our pending) comes only before the
 *  first charge, so it arriving later is an old message landing late, and it used to
 *  tell a paying client to approve their retainer again. Pure. */
export function mergeRetainerState(prior: Partial<RetainerState> | null, patch: Partial<RetainerState>, nowIso: string): RetainerState {
  const base: Partial<RetainerState> = prior || {};
  const clean: Partial<RetainerState> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
  const out = { ...base, ...clean, updated_at: nowIso } as RetainerState;
  if (base.status === 'canceled' && patch.status && patch.status !== 'canceled') out.status = 'canceled';
  if ((base.status === 'active' || base.status === 'past_due') && patch.status === 'pending') out.status = base.status;
  return out;
}

/** What a retainer is, by Stripe's word now rather than the message's (sales item 130).
 *  Stripe sends no message in order: a failure that arrives after the charge that put
 *  it right would set a paid-up retainer past due, and a paid charge arriving after a
 *  newer failure would hide that failure. So the subscription is read fresh, and its
 *  status decides. `fallback` is what the event alone would have said, used when
 *  Stripe can't be asked. A message about a charge or an approval proves the retainer
 *  started, so Stripe's pre-first-charge 'incomplete' never undoes it. Pure. */
export function retainerStatusNow(type: string, live: { status?: unknown } | null, fallback: RetainerStatus): RetainerStatus {
  if (type === 'customer.subscription.deleted') return 'canceled';
  if (!live || typeof live.status !== 'string' || !live.status) return fallback;
  const fresh = retainerStatusFromStripe(live.status);
  if (fresh === 'pending' && type !== 'customer.subscription.created' && type !== 'customer.subscription.updated') return fallback;
  return fresh;
}

/** The retainer's subscription as Stripe has it now, or null when it can't be asked
 *  (no Stripe here, Stripe unreachable, or an answer about some other subscription).
 *  A failed read falls back to the message: the daily check puts it right the next day. */
async function liveSubscription(subId: string, given?: any): Promise<any | null> {
  if (given && typeof given === 'object' && given.id === subId && typeof given.status === 'string') return given;
  if (!subId || !stripeConfigured()) return null;
  try {
    const s = await retrieveSubscription(subId);
    return s && s.id === subId && typeof s.status === 'string' ? s : null;
  } catch (e) {
    console.warn(`[retainer] could not read subscription ${subId} from Stripe (${String((e as Error)?.message || e)}); using the message as sent`);
    return null;
  }
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

// ── A retainer charge, and an approval, are recorded (sales item 128) ────────
// Stripe reports each monthly charge as an invoice event. The webhook was never
// told to listen for one, and the code read the charge's subscription where
// Stripe stopped putting it (commerce/stripe_shape.ts), so no charge reached the
// deal's history, revenue, the weekly email, the bookkeeper file or the client's
// portal, which said "No charges yet" to a client charged every month.

/** Stripe's words for "a retainer charge landed": invoice.paid, which the webhook
 *  listens for since sales item 128, and invoice.payment_succeeded, the older
 *  name. One charge can arrive under both. Pure. */
export function isRetainerChargeEvent(type: string): boolean {
  return type === 'invoice.paid' || type === 'invoice.payment_succeeded';
}

/** A client approving a retainer is the first move from waiting to live. A replay,
 *  a recovery or a resumed retainer is not one. Kept apart from retainerTransition,
 *  which is the dunning rail (Needs you): an approval is news, like money landing,
 *  so it is told on the Updates tier. Pure. */
export function retainerApproved(priorStatus: string | undefined, nextStatus: string | undefined): boolean {
  return String(priorStatus || '') === 'pending' && String(nextStatus || '') === 'active';
}
/** One approval line per retainer set-up: a retainer set up again after a cancel is a new one. Pure. */
export function retainerApprovedPeriod(dealId: string, askedAt: unknown): string {
  return `${retainerNoticePeriodPrefix(dealId)}approved:${Date.parse(String(askedAt || '')) || 0}`;
}
/** What the studio reads when a client approves. Pure. */
export function retainerApprovedCopy(dealTitle: string, amountCents: number, interval: string, setUpAs: { amount_cents: number; interval: string } | null = null): { headline: string; body: string } {
  const name = (dealTitle || '').trim() || 'a retainer client';
  const amt = '$' + ((Number(amountCents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const per = interval === 'year' ? 'year' : 'month';
  // sales item 140: when Stripe is charging something other than what was set up, the studio is told
  const was = setUpAs ? ` Stripe is charging ${amt} a ${per}, not the $${((Number(setUpAs.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} a ${setUpAs.interval === 'year' ? 'year' : 'month'} that was set up: the deal and their portal now show what Stripe charges. If that is wrong, cancel the retainer and set it up again.` : '';
  return {
    headline: `Retainer approved: ${name}, ${amt} a ${per}`,
    body: `The client approved the ${amt} a ${per} retainer. Stripe charges their card each ${per} until one of you cancels, and every charge shows on the deal.${was}`,
  };
}

/** What a retainer charge records on the deal: its amount, and the Stripe invoice
 *  it came from, so the same charge sent twice, or under both names, is recorded
 *  once. null when there is nothing to record (a $0 invoice). Pure. */
export function retainerChargeRow(inv: any, x: { dealId: string; siteId: string; interval: unknown; fallbackCents: unknown; extra?: boolean }): Record<string, unknown> | null {
  const paid = invoicePaidCents(inv);
  const cents = paid === null ? (Math.round(Number(inv?.amount_due) || 0) || Math.round(Number(x.fallbackCents) || 0)) : paid;
  if (!(cents > 0)) return null;
  const stripeInvoice = String(inv?.id || '');
  const at = invoicePaidAt(inv);
  return {
    deal_id: x.dealId, site_id: x.siteId, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system',
    detail: { retainer: true, ...(x.extra ? { extra: true } : {}), amount_cents: cents, interval: x.interval === 'year' ? 'year' : 'month', ...(stripeInvoice ? { stripe_invoice: stripeInvoice } : {}) },
    // the day Stripe took it, so a charge recorded late (a retry) still counts in its own month
    ...(at ? { created_at: at } : {}),
  };
}

/** Put one charge on the deal, once. ok:false means it may not be recorded and
 *  Stripe should send the event again (the read or the write failed). */
export async function recordRetainerCharge(inv: any, x: { dealId: string; siteId: string; interval: unknown; fallbackCents: unknown; extra?: boolean }): Promise<{ ok: boolean; recorded: boolean }> {
  const row = retainerChargeRow(inv, x);
  if (!row) return { ok: true, recorded: false };
  const stripeInvoice = String((row.detail as { stripe_invoice?: string }).stripe_invoice || '');
  if (stripeInvoice) {
    const seen = await svc(`presence_deal_events?deal_id=eq.${encodeURIComponent(x.dealId)}&site_id=eq.${encodeURIComponent(x.siteId)}&kind=eq.invoice_paid&detail->>stripe_invoice=eq.${encodeURIComponent(stripeInvoice)}&select=id&limit=1`).catch(() => ({ ok: false, json: null as any }));
    if (!seen.ok) return { ok: false, recorded: false };
    if (Array.isArray(seen.json) && seen.json.length) return { ok: true, recorded: false };
  }
  const ins = await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }).catch(() => ({ ok: false, json: null }));
  if (ins.ok !== true) return { ok: false, recorded: false };
  // sales item 163: the client's branded receipt, once per charge (the charge itself is recorded once)
  const made = Array.isArray((ins as { json?: unknown }).json) ? ((ins as { json: any[] }).json[0] || null) : null;
  if (made?.id) await emailChargeReceipt(x.siteId, x.dealId, String(made.id), row).catch(() => false);
  return { ok: true, recorded: true };
}

/** Sales item 163: a retainer charge's receipt, drawn as a paid invoice (lib/documents.ts kind
 *  'charge'): the deal event that recorded the charge, read back as an invoice-shaped row. null
 *  when it isn't a charge of this site. What came back on it (a refund of the charge in Stripe,
 *  sales item 174) reads from presence_money_returns by the Stripe invoice. */
export async function chargeReceiptRow(eventId: string, siteId: string): Promise<any | null> {
  const r = await svc(`presence_deal_events?id=eq.${encodeURIComponent(eventId)}&site_id=eq.${encodeURIComponent(siteId)}&kind=eq.invoice_paid&select=id,deal_id,site_id,detail,created_at&limit=1`).catch(() => ({ ok: false, json: null }));
  const e = r.ok && Array.isArray(r.json) ? r.json[0] : null;
  if (!e || e.detail?.retainer !== true) return null;
  const deal = (await svc(`presence_deals?id=eq.${encodeURIComponent(String(e.deal_id))}&site_id=eq.${encodeURIComponent(siteId)}&select=title&limit=1`).catch(() => ({ json: null as any }))).json?.[0];
  const stripeInvoice = String(e.detail?.stripe_invoice || '');
  let refunded = 0, returned: Array<{ cents: number; at: string | null; kind: string }> = [];
  if (stripeInvoice) {
    const rr = await svc(`presence_money_returns?site_id=eq.${encodeURIComponent(siteId)}&applies_to=eq.retainer&stripe_invoice=eq.${encodeURIComponent(stripeInvoice)}&counted_cents=gt.0&select=counted_cents,counted_at,kind&order=counted_at.asc&limit=20`).catch(() => ({ ok: false, json: null }));
    for (const x of (rr.ok && Array.isArray(rr.json) ? rr.json : [])) { refunded += Number(x.counted_cents) || 0; returned.push({ cents: Number(x.counted_cents) || 0, at: x.counted_at || null, kind: String(x.kind || 'refund') }); }
  }
  const per = e.detail?.interval === 'year' ? 'yearly' : 'monthly';
  return { id: e.id, deal_id: e.deal_id, title: `Retainer, ${per}${deal?.title ? ': ' + String(deal.title).slice(0, 120) : ''}`, description: 'Retainer charge', amount_cents: Math.round(Number(e.detail?.amount_cents) || 0), currency: 'usd', purpose: 'service', status: 'paid', paid_at: e.created_at, paid_method: '', paid_note: '', number: null, created_at: e.created_at, refunded_cents: refunded, dispute_status: null, charge: true, returned };
}

/** The receipt email for one retainer charge: the same branded receipt an invoice gets, with the
 *  PDF, to the deal's person. Best-effort; a failed send never fails the recording. */
async function emailChargeReceipt(siteId: string, dealId: string, eventId: string, row: Record<string, unknown>): Promise<boolean> {
  const deal = (await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}&select=title,contact_id&limit=1`).catch(() => ({ json: null as any }))).json?.[0];
  const contact = deal?.contact_id ? (await svc(`presence_contacts?id=eq.${encodeURIComponent(String(deal.contact_id))}&site_id=eq.${encodeURIComponent(siteId)}&select=name,email&limit=1`).catch(() => ({ json: null as any }))).json?.[0] : null;
  const email = String(contact?.email || '').trim();
  if (!email) return false;
  const [{ sendEmail }, { loadEmailBrand, EMAIL_BRAND_DEFAULT, emailBand, emailFacts }, { docContextFor }, { documentPdf, pdfFileName, }, { docLinkFor }, { dayLabel }] = await Promise.all([
    import('./account.ts'), import('../lib/email_brand.ts'), import('../lib/doc_context.ts'), import('../lib/doc_pdf.ts'), import('../routes/sales.ts'), import('../lib/documents.ts'),
  ]);
  const brand = await loadEmailBrand(siteId);
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
  const detail = (row.detail || {}) as { amount_cents?: number; interval?: string };
  const amount = '$' + ((Number(detail.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const per = detail.interval === 'year' ? 'yearly' : 'monthly';
  const studio = brand.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? esc(brand.name) : 'your studio';
  const first = String(contact?.name || '').trim().split(/\s+/)[0] || '';
  const doc = await chargeReceiptRow(eventId, siteId);
  let pdf: Uint8Array | null = null;
  let link: string | null = null;
  if (doc) {
    try { const ctx = await docContextFor(siteId, 'charge', doc, { returned: doc.returned }); const { deal_id: _d, returned: _r, charge: _c, ...data } = doc; pdf = documentPdf('charge', data, brand, ctx); } catch { pdf = null; }
    link = await docLinkFor('charge', eventId, siteId).catch(() => null);
  }
  const day = dayLabel(String(row.created_at || new Date().toISOString()));
  return await sendEmail(email, `Receipt: ${amount} ${per} retainer payment, thank you`,
    emailBand('Receipt · Retainer', 'Payment received. Thank you.') + `<p>${first ? `Hi ${esc(first)},` : 'Hi there,'}</p><p>Your ${per} retainer payment to ${studio} went through${day ? ' on ' + esc(day) : ''}.</p>` +
    emailFacts([['Retainer', esc(String(deal?.title || 'Retainer'))], ['Amount paid', amount]], { big: true, tone: 'good' }) +
    `<p>Nothing else is needed from you. ${pdf ? 'Your receipt is attached as a PDF.' : ''}${link ? ` <a href="${link}" style="color:${brand.accentDark}">View it online →</a>` : ''}</p><p style="color:#666;font-size:.9rem">You can stop the retainer any time from your portal. Have a question? Just reply to this email.</p>`,
    brand, { critical: true, asBusiness: true, siteId, keep: 'money', ...(pdf ? { attachments: [{ filename: pdfFileName('charge', doc), content: pdf }] } : {}) });
}

// ── the impure webhook sync (called by commerce/billing-sync, by PURPOSE) ────
// Updates the deal's retainer state from Stripe truth. NEVER touches presence_
// entitlements (SaaS) — it only PATCHes presence_deals.retainer. Resolves the deal
// from the metadata WE set (deal_id/site_id), falling back to the stored
// subscription id for invoice.* events that carry only the subscription. Best-
// effort + honest: it will NOT create a retainer it didn't originate (a prior
// state must already exist), so a stray webhook can never invent one.
//
// `retry` (sales item 128): the event changed something that didn't save (the
// retainer itself, or a charge), so billing-sync answers 502 and Stripe sends it
// again. Every step is safe to run twice. A notice or an email that fails never
// asks for a retry: the state is what matters, and Stripe would re-send forever.
export async function applyRetainerSync(type: string, obj: any, opts: { live?: any } = {}): Promise<{ synced: boolean; reason?: string; retry?: boolean }> {
  const nowIso = new Date().toISOString();
  const md = stripeMetaOf(obj);
  let dealId = String(md.deal_id || '');
  let siteId = String(md.site_id || '');
  const subId = stripeSubscriptionIdOf(obj);

  // Fallback (invoice.* events): resolve the deal by the stored subscription id.
  // Pre-0096 this jsonb filter simply matches nothing → clean no-op.
  if ((!dealId || !siteId) && subId) {
    const q = await svc(`presence_deals?retainer->>stripe_subscription_id=eq.${encodeURIComponent(subId)}&deleted_at=is.null&select=id,site_id&limit=1`).catch(() => ({ ok: false, json: [] as any[] }));
    const row = Array.isArray(q.json) ? q.json[0] : null;
    if (row) { dealId = String(row.id); siteId = String(row.site_id); }
  }
  if (!dealId || !siteId) return { synced: false, reason: 'no_deal' };

  const dr = await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}&deleted_at=is.null&select=id,title,retainer&limit=1`).catch(() => ({ ok: false, json: [] as any[] }));
  if (!dr.ok) return { synced: false, reason: 'read_failed', retry: true };
  const deal = Array.isArray(dr.json) ? dr.json[0] : null;
  const prior: Partial<RetainerState> | null = (deal && deal.retainer && typeof deal.retainer === 'object') ? deal.retainer : null;
  if (!prior) return { synced: false, reason: 'no_retainer' };   // never invent a retainer from a webhook

  // A second approval never becomes the retainer (sales item 117): see isExtraSubscription.
  // Sales item 140: nor does an approval through an old link, or one that lands after a cancel.
  const oldLink = type === 'checkout.session.completed' && !!subId && approvedThroughOldLink(prior, obj);
  if (oldLink || isExtraSubscription(prior, subId)) return await syncExtraSubscription(type, obj, { dealId, siteId, title: String((deal as { title?: string }).title || ''), prior, subId, nowIso, oldLink });

  // Sales item 130: the subscription as Stripe has it now decides, whatever order the
  // messages came in (retainerStatusNow). The daily check hands over the one it just read.
  const live = subId ? await liveSubscription(subId, opts.live) : null;
  const patch: Partial<RetainerState> = {};
  if (subId) patch.stripe_subscription_id = subId;
  if (obj?.customer) patch.stripe_customer_id = String(typeof obj.customer === 'string' ? obj.customer : obj.customer.id);
  if (type === 'customer.subscription.deleted') {
    patch.status = 'canceled';
    patch.canceled_at = nowIso;
  } else if (type.startsWith('customer.subscription.')) {
    patch.status = retainerStatusNow(type, live, retainerStatusFromStripe(String(obj?.status || '')));
    if (patch.status === 'canceled' && prior.status !== 'canceled') patch.canceled_at = nowIso;
  } else if (type === 'checkout.session.completed') {
    patch.status = retainerStatusNow(type, live, 'active');   // the client authorized
  } else if (isRetainerChargeEvent(type)) {
    patch.status = retainerStatusNow(type, live, 'active');
  } else if (type === 'invoice.payment_failed') {
    patch.status = retainerStatusNow(type, live, 'past_due');
  }
  const cpe = subscriptionPeriodEnd(live || (type.startsWith('customer.subscription.') ? obj : null));
  if (cpe) patch.current_period_end = new Date(cpe * 1000).toISOString();
  // Sales item 140: what Stripe is charging is what the deal and the portal say. The amount was
  // never read back, so an approval at another price (an old link finished late) showed the
  // price the studio last set up while Stripe charged the other one.
  const charging = subscriptionAmount(live || (type.startsWith('customer.subscription.') ? obj : null));
  if (charging && (charging.amount_cents !== Number(prior.amount_cents) || charging.interval !== prior.interval)) { patch.amount_cents = charging.amount_cents; patch.interval = charging.interval; }

  const next = mergeRetainerState(prior, patch, nowIso);
  const up = await svc(`presence_deals?id=eq.${encodeURIComponent(dealId)}&site_id=eq.${encodeURIComponent(siteId)}`, {
    method: 'PATCH', body: JSON.stringify({ retainer: next }),
  }).catch(() => ({ ok: false }));
  // The retainer didn't save: nothing below may speak for a state we don't hold.
  if ((up as { ok?: boolean }).ok !== true) return { synced: false, reason: 'write_failed', retry: true };

  // ── APPROVED (sales item 128) — the studio hears it, on the Updates tier ────
  // Best-effort: once per retainer set-up (the notice's unique key), the email on
  // the notice's created flag, like a paid invoice's echo.
  if (retainerApproved(prior.status, next.status)) {
    try {
      const { raiseNotice } = await import('../lib/notice.ts');
      const clientId = String((await svc(`presence_sites?id=eq.${encodeURIComponent(siteId)}&select=client_id&limit=1`).catch(() => ({ json: null as any }))).json?.[0]?.client_id || '');
      if (clientId) {
        const copy = retainerApprovedCopy(String((deal as { title?: string }).title || '').slice(0, 80), Number(next.amount_cents) || 0, String(next.interval || 'month'), charging && (charging.amount_cents !== Number(prior.amount_cents) || charging.interval !== prior.interval) ? { amount_cents: Number(prior.amount_cents) || 0, interval: String(prior.interval || 'month') } : null);
        const fresh = await raiseNotice({ siteId, clientId, kind: 'invoice_paid', period: retainerApprovedPeriod(dealId, prior.created_at), headline: copy.headline, body: copy.body });
        if (fresh) {
          const { emailOperator } = await import('../lib/service_bridge.ts');
          const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
          const base = appBase();
          emailOperator(siteId, copy.headline, `<p>${esc(copy.body)}</p>`, 'retainer_approved', { label: 'Open the deal', href: `${base}/pipeline.html?deal=${dealId}&dtab=billing` }).catch(() => {});
        }
      }
    } catch { /* the retainer is live either way */ }
  }

  // ── DUNNING (operator audit #3) — the transition, made audible ─────────────
  // Deliberately INSIDE applyRetainerSync (the SERVICE rail), never the SaaS
  // billing branch: the purpose-metadata separation above is load-bearing, and
  // this touches only the deal's own notice rail. Best-effort and gated on the
  // stored PATCH landing (a transition we failed to record is retried by
  // Stripe, and must not burn its send-once key on a state we don't hold).
  // Pre-0127 the 'retainer_status' kind fails the notices CHECK → raiseNotice
  // returns false → no email, no throw: dormant until Eric applies the SQL
  // (the 0094–0119 deploy-order posture — SQL lands before or with the deploy).
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
          // sales item 129: an ending says why when Stripe gave up on a failing card
          const reason = change === 'canceled' ? String(obj?.cancellation_details?.reason || '') : '';
          const copy = retainerNoticeCopy(change, title, Number(next.amount_cents) || 0, String(next.interval || 'month'), reason);
          const fresh = await raiseNotice({
            siteId, clientId, kind: 'retainer_status',
            period: retainerNoticePeriod(dealId, change, Date.now()),
            headline: copy.headline, body: copy.body,
          });
          if (fresh) {
            const { emailOperator } = await import('../lib/service_bridge.ts');
            // the fix is on the deal now (Email the card link, or set it up again), not in Stripe
            const href = `${appBase()}/pipeline.html?deal=${dealId}&dtab=billing`;
            emailOperator(siteId, copy.subject, copy.html, 'retainer_status', { label: 'Open the deal', href }).catch(() => {});
          }
        }
      }
    }
  } catch { /* the dunning echo is best-effort — retainer truth is already stored */ }

  // Settlement: a recurring charge landed → a line on the deal, which is what the
  // deal's Paid, revenue, the weekly email, the bookkeeper file and the client's
  // portal all count. Reuses the allowed 'invoice_paid' deal-event kind;
  // detail.retainer distinguishes it. Once per Stripe invoice (sales item 128).
  if (isRetainerChargeEvent(type)) {
    const rec = await recordRetainerCharge(obj, { dealId, siteId, interval: next.interval, fallbackCents: next.amount_cents });
    if (!rec.ok) return { synced: true, reason: 'charge_not_recorded', retry: true };
  }
  return { synced: true };
}

/** A subscription that is NOT the retainer's own (a second approval). It is
 *  remembered on the deal, the studio is told once, and its ending takes it off
 *  again. The retainer's own status, subscription and dates are never touched by it. */
async function syncExtraSubscription(type: string, obj: any, x: { dealId: string; siteId: string; title: string; prior: Partial<RetainerState>; subId: string; nowIso: string; oldLink?: boolean }): Promise<{ synced: boolean; reason?: string; retry?: boolean }> {
  const had = (x.prior.extra_subscription_ids || []).map(String);
  const ended = type === 'customer.subscription.deleted' || (type.startsWith('customer.subscription.') && retainerStatusFromStripe(String(obj?.status || '')) === 'canceled');
  const extras = ended ? had.filter((id) => id !== x.subId) : (had.includes(x.subId) ? had : [...had, x.subId]);
  let ok = true;
  if (extras.length !== had.length) {
    const up = await svc(`presence_deals?id=eq.${encodeURIComponent(x.dealId)}&site_id=eq.${encodeURIComponent(x.siteId)}`, { method: 'PATCH', body: JSON.stringify({ retainer: { ...x.prior, extra_subscription_ids: extras, updated_at: x.nowIso } }) }).catch(() => ({ ok: false }));
    ok = (up as { ok?: boolean }).ok === true;
  }
  if (!ok) return { synced: false, reason: 'second_approval', retry: true };
  if (!ended) {
    try {
      const { raiseNotice } = await import('../lib/notice.ts');
      const clientId = String((await svc(`presence_sites?id=eq.${encodeURIComponent(x.siteId)}&select=client_id&limit=1`).catch(() => ({ json: null as any }))).json?.[0]?.client_id || '');
      if (clientId) {
        // sales item 140: an approval through an old link is one that landed after that link's retainer was cancelled
        const copy = retainerTwiceCopy(x.title.slice(0, 80), Number(x.prior.amount_cents) || 0, String(x.prior.interval || 'month'), x.prior.status === 'canceled' || !!x.oldLink);
        const fresh = await raiseNotice({ siteId: x.siteId, clientId, kind: 'retainer_status', period: retainerTwicePeriod(x.dealId, x.subId), headline: copy.headline, body: copy.body });
        if (fresh) {
          const { emailOperator } = await import('../lib/service_bridge.ts');
          emailOperator(x.siteId, copy.headline, `<p>${copy.body.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))}</p>`, 'retainer_status', { label: 'Open it in Stripe', href: `https://dashboard.stripe.com/subscriptions/${x.subId}` }).catch(() => {});
        }
      }
    } catch { /* the extra is remembered either way */ }
  }
  // the money did land: the deal's history and its retainer total say so, once per charge
  if (isRetainerChargeEvent(type)) {
    const rec = await recordRetainerCharge(obj, { dealId: x.dealId, siteId: x.siteId, interval: x.prior.interval, fallbackCents: x.prior.amount_cents, extra: true });
    if (!rec.ok) return { synced: true, reason: 'second_approval', retry: true };
  }
  return { synced: true, reason: 'second_approval' };
}
