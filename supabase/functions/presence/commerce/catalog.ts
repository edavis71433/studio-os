// ── L1 · The Commercial Ladder — PURE ───────────────────────────────────────
// The plan catalog as data. No I/O, no Stripe, no DB — every function here is
// a pure mapping so it can be unit-tested exhaustively and reasoned about at a
// glance. This is the single source of commercial truth; routes, the webhook,
// and provisioning all read it.
//
// Governed by docs/presence/constitution/02-commercial-constitution.md:
//   • Bill the site, not the seat (§3.1).           • Monthly + annual (§3.2).
//   • Founders = a permanent rate lock (§3.3).       • No metered fees (Law 20).
//   • Enterprise is never self-serve (§3.11);        • Agency is wholesale (§3.10).
//
// The five rungs map onto the two machine-real dimensions that already exist:
//   plan  → an entitlement column (0036)   edition → a presence_sites column (0031)

export type PlanKey = 'presence_monitor' | 'cms_only' | 'business_os_only' | 'presence' | 'presence_managed' | 'agency' | 'enterprise';
export type Term = 'monthly' | 'annual';
export type Edition = 'monitor' | 'presence';

export interface PlanDef {
  key: PlanKey;
  rank: number;                 // ladder order; upgrades move up, downgrades move down
  name: string;                 // customer-facing name
  tagline: string;              // the one-line promise (merchant words, never software words)
  edition: Edition;             // which site edition this rung provisions
  selfServe: boolean;           // true → buyable by card; false → "talk to us" (Agency/Enterprise)
  trialEligible: boolean;       // §3.4 — a card-free trial makes sense for this rung
  monthly: number | null;       // standard price, whole USD/mo (null = contact for pricing)
  founderMonthly: number | null;// the locked founders rate, whole USD/mo
  features: string[];           // plain-language inclusions for the pricing page
}

// ── PRICING ─────────────────────────────────────────────────────────────────
// The one place prices live. The constitution deliberately fixes the billing
// ARCHITECTURE and leaves the numbers to launch (§ "architecture, not prices").
// These are the proposed founder-era defaults — change them here and the whole
// system (pricing page, checkout amounts, upgrade math) follows. Amounts are
// whole dollars/month; annual applies ANNUAL_MONTHS_CHARGED (two months free).
const ANNUAL_MONTHS_CHARGED = 10;   // pay for 10, get 12 — ~17% off, the "calm of not thinking about it"

// Founders cohort is open pre-public-launch (A-first, founders-first — §10).
// While open, self-serve signups earn the founder rate lock. Flip to false to
// close the cohort; existing founders keep their locked rate (it lives on the
// entitlement row, not here).
export const FOUNDERS_OPEN = true;

export const PLANS: readonly PlanDef[] = [
  {
    key: 'presence_monitor', rank: 1, name: 'Presence Monitor', edition: 'monitor',
    tagline: 'Watch your existing website — and know the moment it needs you.',
    selfServe: true, trialEligible: true, monthly: 19, founderMonthly: 15,
    features: [
      'Connects to the website you already have — nothing moves',
      'Ongoing checks: is it up, secure, findable, saying the right things',
      'Plain-language moments when something needs attention',
      'Migration readiness whenever you decide to bring it home',
    ],
  },
  {
    key: 'cms_only', rank: 2, name: 'CMS', edition: 'presence',
    tagline: 'A website that stays correct — structured, versioned, and yours.',
    selfServe: true, trialEligible: true, monthly: 29, founderMonthly: 24,
    features: [
      'Managed hosting, SSL, and your custom domain — all handled',
      'Structured content published with one calm ritual',
      'Every version kept and restorable; the site never lies',
      'Developer Mode available — customize safely, still approval-first',
    ],
  },
  {
    key: 'business_os_only', rank: 3, name: 'Business OS', edition: 'monitor',
    tagline: 'Know your business at a glance — moments, connections, relationships.',
    selfServe: true, trialEligible: true, monthly: 29, founderMonthly: 24,
    features: [
      'Business Moments: plain-language nudges when something needs you',
      'Connect the services you already use — read your own data, safely',
      'A calm relationship view of your accounts',
      'Guidance in sentences, never scores — no website editing needed',
    ],
  },
  {
    key: 'presence', rank: 4, name: 'Presence', edition: 'presence',
    tagline: 'A website that stays correct — without becoming your hobby.',
    selfServe: true, trialEligible: true, monthly: 49, founderMonthly: 39,
    features: [
      'Everything in CMS and Business OS, as one operating system',
      'Your business facts in one place, published with one calm ritual',
      'Every version kept and restorable; the site never lies',
      'Guidance that watches with you, in sentences, never scores',
    ],
  },
  {
    key: 'presence_managed', rank: 5, name: 'Presence Managed', edition: 'presence',
    tagline: 'We keep it right for you — a real person watching alongside the system.',
    selfServe: true, trialEligible: false, monthly: 149, founderMonthly: 119,
    features: [
      'Everything in Presence',
      'Concierge edits and seasonal updates handled for you',
      'White-glove migration of your current site',
      'Priority support from a person who knows your business',
    ],
  },
  {
    key: 'agency', rank: 6, name: 'Agency', edition: 'presence',
    tagline: 'Sell the outcome we sell — under your name, on our pipeline.',
    selfServe: false, trialEligible: false, monthly: null, founderMonthly: null,
    features: [
      'One operating system over many client sites',
      'White-label: your name on the door',
      'Wholesale or referral billing — you choose the relationship',
      'Set up with you — reach out to get started',
    ],
  },
  {
    key: 'enterprise', rank: 7, name: 'Enterprise', edition: 'presence',
    tagline: 'Every location correct, every publish governed, one source of truth.',
    selfServe: false, trialEligible: false, monthly: null, founderMonthly: null,
    features: [
      'Multi-location, multi-brand, governed publishing',
      'Roles, approvals, and brand governance',
      'SSO/SCIM and provenance-backed audit exports',
      'Annual agreement, defined at signing — talk to us',
    ],
  },
] as const;

export function planByKey(key: string): PlanDef | null {
  return PLANS.find((p) => p.key === key) || null;
}

export function selfServePlans(): PlanDef[] {
  return PLANS.filter((p) => p.selfServe);
}

export function isPlanKey(x: unknown): x is PlanKey {
  return typeof x === 'string' && PLANS.some((p) => p.key === x);
}

export function isTerm(x: unknown): x is Term {
  return x === 'monthly' || x === 'annual';
}

// The Stripe recurring interval for a term.
export function stripeInterval(term: Term): 'month' | 'year' {
  return term === 'annual' ? 'year' : 'month';
}

// The charge amount in CENTS for a plan+term, honoring the founder rate lock.
// Returns null when the plan has no self-serve price (Agency/Enterprise) — the
// caller must route those to "talk to us", never to checkout.
export function priceCents(key: PlanKey, term: Term, founder: boolean): number | null {
  const p = planByKey(key);
  if (!p) return null;
  const monthly = founder && p.founderMonthly != null ? p.founderMonthly : p.monthly;
  if (monthly == null) return null;
  const months = term === 'annual' ? ANNUAL_MONTHS_CHARGED : 1;
  return Math.round(monthly * months * 100);
}

// The human display price (whole dollars) for a term, for the pricing page.
export function displayPrice(key: PlanKey, term: Term, founder: boolean): number | null {
  const cents = priceCents(key, term, founder);
  return cents == null ? null : Math.round(cents / 100);
}

// What a plan grants: the site edition it provisions. (Status is billing's job.)
export function editionFor(key: PlanKey): Edition {
  return planByKey(key)?.edition ?? 'presence';
}

// Upgrade / downgrade classification between two rungs.
export type ChangeKind = 'same' | 'upgrade' | 'downgrade';
export function changeKind(from: PlanKey, to: PlanKey): ChangeKind {
  const a = planByKey(from)?.rank ?? 0;
  const b = planByKey(to)?.rank ?? 0;
  if (a === b) return 'same';
  return b > a ? 'upgrade' : 'downgrade';
}

// Can a self-serve customer move themselves from `from` to `to`?
// Upgrades: yes, instant + prorated (§3.7). Downgrades between self-serve rungs:
// yes, but they take effect at renewal, never mid-cycle, never with data loss
// (§3.6). Moving to a non-self-serve rung (Agency/Enterprise) is a sales
// conversation, not a self-serve change.
export interface ChangeVerdict { allowed: boolean; kind: ChangeKind; timing: 'immediate' | 'at_renewal' | 'n/a'; reason: string; }
export function evaluateChange(from: PlanKey, to: PlanKey): ChangeVerdict {
  const kind = changeKind(from, to);
  const toDef = planByKey(to);
  const fromDef = planByKey(from);
  if (!toDef || !fromDef) return { allowed: false, kind, timing: 'n/a', reason: 'Unknown plan.' };
  if (kind === 'same') return { allowed: false, kind, timing: 'n/a', reason: 'That is already your plan.' };
  if (!toDef.selfServe) return { allowed: false, kind, timing: 'n/a', reason: `${toDef.name} is set up with our team — reach out and we’ll handle the move.` };
  if (!fromDef.selfServe) return { allowed: false, kind, timing: 'n/a', reason: `Changes to your ${fromDef.name} plan go through our team.` };
  if (kind === 'upgrade') return { allowed: true, kind, timing: 'immediate', reason: 'Upgrades take effect right away, prorated for the rest of this cycle.' };
  return { allowed: true, kind, timing: 'at_renewal', reason: 'Your new plan starts at your next renewal — nothing changes today, and nothing is lost.' };
}

// The founder flag a NEW self-serve signup should receive right now.
export function grantFounder(): boolean {
  return FOUNDERS_OPEN;
}
