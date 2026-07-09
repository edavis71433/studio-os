// ── PT-9: AI Business Memory — assembled from EXISTING data, never a new store ─
// One consolidated "what we know about this business" object, derived purely from
// data the platform already holds (settings.industry, the voice profile, the
// identity, site status + publish history). The concierge and drafting read it so
// their language stays consistent with the business's industry, tone, and stage.
// Pure: the route feeds it already-loaded rows; there is no second memory system.

export interface MemoryInputs {
  industry?: string | null;
  industryLabel?: string | null;                 // vocab offeringLabel etc. (already resolved by caller)
  voiceTone?: string | null;                     // from the voice/brand profile
  identityDescription?: string | null;
  serviceArea?: string | null;
  goals?: string[] | null;                       // if the onboarding brief captured any
  siteStatus?: string | null;                    // 'draft' | 'live' | ...
  lastPublishedAt?: string | null;
  offeringsCount?: number;
  live?: boolean;
}

export type BusinessStage = 'setting_up' | 'newly_live' | 'established' | 'quiet';

export interface BusinessMemory {
  industry: string;                              // human label, never blank
  tone: string;                                  // one plain phrase
  goals: string[];                               // at most 3, plain English
  priorities: string[];                          // what would help most right now
  seasonality: string;                           // one plain sentence, industry-aware
  stage: BusinessStage;
}

const SEASONALITY: Record<string, string> = {
  restaurant: 'Holidays, patio season, and local events tend to drive interest.',
  cafe: 'Mornings, holidays, and seasonal drinks tend to drive interest.',
  coffee_shop: 'Mornings, holidays, and seasonal drinks tend to drive interest.',
  bakery: 'Holidays and weekends are your busiest windows.',
  catering: 'Wedding and holiday seasons book out earliest.',
  retail: 'The winter holidays are the biggest window; plan promotions early.',
  florist: 'Valentine’s, Mother’s Day, and weddings are the peaks.',
  landscaping: 'Spring and early summer are when demand climbs fastest.',
  hvac: 'The first heat wave and first cold snap drive the busiest calls.',
  plumber: 'Winter freezes and holiday hosting spike emergency calls.',
  roofing: 'After storm season is when inquiries surge.',
  accounting: 'Tax season (Jan–Apr) is the peak; prepare capacity early.',
  law: 'Demand is steadier year-round; referrals matter most.',
  fitness: 'January and early fall bring the biggest sign-up waves.',
  gym: 'January and early fall bring the biggest sign-up waves.',
  salon: 'Holidays and event seasons (proms, weddings) book out first.',
  photography: 'Fall and wedding season are the busiest booking windows.',
};

/** Assemble the memory. Pure — no I/O, no clock beyond passed-in `now`. */
export function buildBusinessMemory(inp: MemoryInputs, nowIso: string): BusinessMemory {
  const industry = (inp.industryLabel || prettyIndustry(inp.industry) || 'Local business').trim();
  const tone = (inp.voiceTone || '').trim() || 'warm, plain, and free of jargon';

  // stage: derived from publish history, not asked
  const live = inp.live ?? (inp.siteStatus === 'live');
  let stage: BusinessStage = 'setting_up';
  if (live && inp.lastPublishedAt) {
    const days = daysBetween(inp.lastPublishedAt, nowIso);
    stage = days <= 60 ? 'newly_live' : 'established';
  } else if (!live && inp.lastPublishedAt) {
    stage = 'quiet';
  }

  // priorities: what would most help RIGHT NOW, inferred from real state (plain, actionable)
  const priorities: string[] = [];
  if (!live && !inp.lastPublishedAt) priorities.push('Get the website live so customers can find it.');
  if ((inp.offeringsCount ?? 0) === 0) priorities.push('Add what you offer so visitors know what you do.');
  if (stage === 'quiet') priorities.push('Post an update so the site looks current and cared for.');
  if (!priorities.length) priorities.push('Keep the details accurate and reply to new inquiries quickly.');

  const goals = (inp.goals || []).map((g) => String(g).trim()).filter(Boolean).slice(0, 3);
  const key = String(inp.industry || '').toLowerCase();
  const seasonality = SEASONALITY[key] || 'Watch for the seasons and local events that bring your customers in.';

  return { industry, tone, goals, priorities, seasonality, stage };
}

function prettyIndustry(key: string | null | undefined): string {
  if (!key) return '';
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso), b = Date.parse(bIso);
  if (!isFinite(a) || !isFinite(b)) return 9999;
  return Math.abs(Math.floor((b - a) / 86400_000));
}

/** A one-line memory summary the concierge can open with. Pure. */
export function memorySentence(m: BusinessMemory): string {
  const stageWord = m.stage === 'setting_up' ? 'just getting set up'
    : m.stage === 'newly_live' ? 'newly live' : m.stage === 'quiet' ? 'been quiet lately' : 'established';
  return `I know ${m.industry} — ${stageWord}, and I keep the tone ${m.tone}.`;
}
