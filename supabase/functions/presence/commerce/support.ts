// ── Support & service tiers (Phase P, owner addendum) ───────────────────────
// The SERVICE half of every package, as data — so software tiers and service
// tiers can never drift apart. For each plan: what onboarding, support response,
// AI allowance, implementation, training, and maintenance the customer gets.
// Surfaced via /commerce/plans (public pricing data) and the docs. Buying
// software vs hiring the studio is exactly this table's difference.
import type { PlanKey } from './catalog.ts';

export interface SupportTier {
  onboarding: string;       // what the first week looks like
  support: string;          // channel + response expectation
  ai_usage: string;         // plain-language allowance (capacity.ts enforces)
  implementation: string;   // what the studio does FOR you at the start
  training: string;         // what you're taught
  maintenance: string;      // who keeps it healthy, ongoing
}

const SELF_SERVE_BASE: Omit<SupportTier, 'ai_usage'> = {
  onboarding: 'Guided first-run: two questions, your site drafted for review, contextual lessons as you go.',
  support: 'Email support — answered within 2 business days.',
  implementation: 'Self-serve — the guided setup does the heavy lifting.',
  training: 'Built into the product: plain-language explanations at every step, plus the Customer Guide.',
  maintenance: 'The platform watches your presence and proposes fixes; you approve. You own updates.',
};

export const SUPPORT_TIERS: Record<PlanKey, SupportTier> = {
  presence_monitor: {
    ...SELF_SERVE_BASE,
    onboarding: 'Connect your existing site in minutes; the Monitor starts reading the same day.',
    ai_usage: 'Monitoring intelligence included; no AI drafting (nothing to draft — it’s your existing site).',
    maintenance: 'The Monitor reports what your site needs; acting on it is yours (or upgrade and we build).',
  },
  cms_only: { ...SELF_SERVE_BASE, ai_usage: 'Generous AI drafting for pages, posts, and FAQs — enough for weekly updates without thinking about it.' },
  business_os_only: { ...SELF_SERVE_BASE, ai_usage: 'Business intelligence (Moments, Concierge) included; no site drafting (no site to draft).' },
  presence: { ...SELF_SERVE_BASE, ai_usage: 'Full AI: site drafting, growth writer, Concierge, Visual Studio — capacity that comfortably covers an active small business.' },
  presence_managed: {
    onboarding: 'White-glove: we interview you, build the first version, and walk you through it live.',
    support: 'Priority email — answered within 1 business day.',
    ai_usage: 'Full AI, plus the studio drives it for you each month.',
    implementation: 'The studio builds and launches your site, sets up your Business OS, and connects your services.',
    training: 'A live onboarding session, plus refreshers on request.',
    maintenance: 'The studio reviews your presence monthly and proposes improvements; you approve, we apply.',
  },
  agency: {
    onboarding: 'Partner onboarding: your workspace, roles, and first client set up with the studio.',
    support: 'Named contact — same-business-day response.',
    ai_usage: 'Full AI across every client site, pooled at agency scale.',
    implementation: 'Workspace + white-label configuration done with you; client playbooks included.',
    training: 'Team training session + the operator guides.',
    maintenance: 'Platform maintained for you; your clients maintained by you — with our escalation path behind you.',
  },
  enterprise: {
    onboarding: 'Scoped rollout: organization, regions, and locations modeled together before launch.',
    support: 'Named contact + agreed SLA.',
    ai_usage: 'Full AI at organization scale; capacity agreed in the contract.',
    implementation: 'The studio implements the organization structure, inheritance, and first locations.',
    training: 'Role-based training for HQ and location managers.',
    maintenance: 'Governed change management: every org-wide change is an approved, auditable plan.',
  },
};

export function supportFor(key: PlanKey): SupportTier { return SUPPORT_TIERS[key]; }
