// ⚠️ SPEC MODULE — NOT WIRED INTO PRODUCTION (verified Jul 12 2026: zero production
// imports; exercised only by its test). It documents a frozen-architecture contract
// awaiting its phase — do NOT assume it guards anything at runtime. Wire it or
// delete it (with an ADR note) when its phase arrives.
// ── Guided onboarding — pure core (Phase I) ──────────────────────────────────
// The first-run experience is an ORCHESTRATION over existing systems, not a new
// one: a short intake → the existing `starter_site` writer (a draft PROPOSAL,
// approval-first) → review → the existing publish ritual. This file holds the
// pure, tested pieces the first-run surface uses: the industry intake options +
// smart default services (so the member isn't typing from blank), the writer
// request builder, and the first-success milestone list. Mirrored in
// get-started.html at runtime (no build step ships TS to the browser).

export interface StarterIntake { industry: string; services: string[]; description: string; goal?: string }

// Broader than the industry PACKS on purpose — this only shapes the intake copy +
// default services + the writer instructions; it never needs to match a pack.
export const ONBOARDING_INDUSTRIES: Array<{ key: string; label: string; services: string[] }> = [
  { key: 'restaurant', label: 'Restaurant', services: ['Dinner', 'Lunch', 'Catering'] },
  { key: 'coffee_shop', label: 'Café / Coffee Shop', services: ['Coffee & espresso', 'Pastries', 'Breakfast'] },
  { key: 'home_services', label: 'Home Services', services: ['Repairs', 'Installation', 'Emergency service'] },
  { key: 'salon', label: 'Salon & Beauty', services: ['Haircut & styling', 'Color', 'Treatments'] },
  { key: 'retail', label: 'Shop / Retail', services: ['In-store shopping', 'Featured products', 'Gift cards'] },
  { key: 'professional', label: 'Professional Services', services: ['Consultation', 'Ongoing support', 'Project work'] },
  { key: 'fitness', label: 'Fitness & Wellness', services: ['Classes', 'Personal training', 'Memberships'] },
  { key: 'other', label: 'Something else', services: ['What you offer', 'Consultation'] },
];

export function isOnboardingIndustry(key: string): boolean { return ONBOARDING_INDUSTRIES.some((i) => i.key === key); }
export function industryLabel(key: string): string { return (ONBOARDING_INDUSTRIES.find((i) => i.key === key) || {}).label || ''; }

/** Sensible starter services for an industry so the intake is pre-filled, not blank. */
export function suggestedServices(industryKey: string): string[] {
  const found = ONBOARDING_INDUSTRIES.find((i) => i.key === industryKey);
  return [...((found || ONBOARDING_INDUSTRIES[ONBOARDING_INDUSTRIES.length - 1]).services)];
}

/** Build the EXISTING starter_site writer request from the intake. Reuses the
 *  writer (POST /writer/generate) — no new endpoint. Bounded + trimmed. */
export function buildStarterRequest(intake: StarterIntake): { kind: 'starter_site'; starter: { services: Array<{ name: string }>; goals: string }; instructions: string } {
  const services = (intake.services || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((name) => ({ name }));
  const goals = [intake.description, intake.goal].map((s) => String(s || '').trim()).filter(Boolean).join(' ').slice(0, 300);
  const label = industryLabel(intake.industry);
  const instructions = `${label ? `A ${label} business. ` : ''}${String(intake.description || '').trim()}`.slice(0, 600).trim();
  return { kind: 'starter_site', starter: { services, goals }, instructions };
}

/** True when we have enough to auto-draft (at least one service or a description). */
export function canAutoDraft(intake: StarterIntake): boolean {
  const svc = (intake.services || []).some((s) => String(s || '').trim());
  return svc || String(intake.description || '').trim().length >= 8;
}

// The first-success path — meaningful milestones, calm, never gamified. Each maps
// to a real capability the member already has; the surface lights them as reached.
export interface Milestone { key: string; label: string; why: string }
export function firstSuccessMilestones(): Milestone[] {
  return [
    { key: 'drafted', label: 'Website drafted', why: 'We turned your details into a real starting point — nothing is live yet.' },
    { key: 'previewed', label: 'Previewed', why: 'See it exactly as visitors will, before anyone else does.' },
    { key: 'approved', label: 'Approved by you', why: 'Nothing goes live without your say-so. That’s the whole promise.' },
    { key: 'published', label: 'Published', why: 'Live on the web — and every version kept, so you can always go back.' },
    { key: 'moment', label: 'First Business Moment', why: 'From here, Studio OS watches quietly and only speaks when something’s worth a look.' },
  ];
}

// One-line contextual lessons — taught in place, never a tutorial wall.
export const ONBOARDING_LESSONS: Record<string, string> = {
  approvals: 'Studio OS proposes; you approve. Nothing publishes or changes on your behalf without you.',
  ownership: 'It’s yours — export everything anytime, connect or disconnect freely, leave without penalty.',
  rollback: 'Every publish is kept. If a change looks wrong, restore an earlier version in one step.',
  moments: 'No dashboards to check — Business Moments surface only what needs you, in plain words.',
  ai: 'AI drafts; you decide. It only speaks to what’s true of your business, and never publishes.',
};
