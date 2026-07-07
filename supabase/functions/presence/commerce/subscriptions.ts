// ── L1 · Subscription → Entitlement mapping — PURE ──────────────────────────
// The single translation from Stripe subscription truth to the entitlement
// state the whole platform already enforces. No I/O: the webhook reads the
// Stripe object, calls this, and writes the patch. Kept pure (takes `now`) so
// every lifecycle transition is unit-tested.
//
// The lifecycle ladder (constitution §3.5) rides on the EXISTING three states —
// no new status value:
//   Stripe active / trialing            → active   (full, live)
//   Stripe past_due / unpaid            → active + grace_until  (past-due: still
//                                          full + live, a gentle banner; §3.5)
//   Stripe paused                       → paused   (voluntary hold, read-only)
//   Stripe canceled / incomplete_expired→ lapsed   (grace exhausted, read-only + export)
//   Stripe incomplete                   → lapsed   (initial payment never landed)
// cancel_at_period_end keeps status active until the period ends; the eventual
// subscription.deleted then lapses it. Nothing here ever touches content.

import type { PlanKey, Term } from './catalog.ts';
import { isPlanKey, isTerm } from './catalog.ts';

export type EntStatus = 'active' | 'paused' | 'lapsed';

const GRACE_DAYS = 14; // §3.5 "past-due (grace) ≈ 14 days"

export function mapStatus(stripeStatus: string): EntStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'unpaid':
      return 'active'; // past_due/unpaid stay full during grace (banner, not lockout)
    case 'paused':
      return 'paused';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    default:
      return 'lapsed';
  }
}

function isoFromUnix(sec: unknown): string | null {
  const n = Number(sec);
  if (!isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface EntitlementPatch {
  status: EntStatus;
  plan?: PlanKey;
  term?: Term;
  founder?: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  grace_until: string | null;   // a date string when in past-due grace, else null (clears it)
  trial_ends_at?: string | null;
}

// Translate a Stripe Subscription object into an entitlement patch.
// `now` is injected for testability (grace clock). plan/term/founder come from
// the subscription metadata WE set at checkout; unknown values are omitted so a
// malformed metadata blob never corrupts a known-good plan.
export function entitlementPatchFromSubscription(sub: any, now: Date): EntitlementPatch {
  const stripeStatus = String(sub?.status || '');
  const status = mapStatus(stripeStatus);
  const md = (sub && sub.metadata) || {};
  const cancelAtPeriodEnd = sub?.cancel_at_period_end === true;

  const patch: EntitlementPatch = {
    status,
    stripe_customer_id: sub?.customer ? String(typeof sub.customer === 'string' ? sub.customer : sub.customer.id) : null,
    stripe_subscription_id: sub?.id ? String(sub.id) : null,
    current_period_end: isoFromUnix(sub?.current_period_end),
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: isoFromUnix(sub?.canceled_at),
    grace_until: (stripeStatus === 'past_due' || stripeStatus === 'unpaid') ? addDays(now, GRACE_DAYS) : null,
  };

  if (isPlanKey(md.plan)) patch.plan = md.plan;
  if (isTerm(md.term)) patch.term = md.term;
  if (typeof md.founder === 'string') patch.founder = md.founder === 'true';

  // Stripe trial → carry the trial clock so the banner and conversion moment are honest.
  const trialEnd = isoFromUnix(sub?.trial_end);
  if (stripeStatus === 'trialing' && trialEnd) patch.trial_ends_at = trialEnd;
  else if (status === 'active' && stripeStatus !== 'trialing') patch.trial_ends_at = null; // converted → clear

  return patch;
}

// A card-free trial (no Stripe subscription yet): active, with a trial clock.
// Provisioned immediately; converts when the customer commits (§3.4).
export function trialEntitlementPatch(plan: PlanKey, now: Date, days: number): EntitlementPatch {
  return {
    status: 'active',
    plan,
    founder: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    grace_until: null,
    trial_ends_at: addDays(now, days),
  };
}
