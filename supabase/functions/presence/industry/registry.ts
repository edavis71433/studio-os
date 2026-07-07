// ── Industry registry + resolver (L5.0) — pure, additive, no engine touched ──
// The registry is DATA. Resolution is per-site (by the template_slug's vertical,
// the same convention the writer + coach already use). Composition walks a pack's
// `extends` chain so a narrow pack (coffee_shop) inherits a broad one (restaurant)
// and overlays only its differences. Nothing here modifies an engine — engines
// consume the composed registries via `extendRegistry`, which never mutates.
import {
  EMPTY_EVIDENCE, EMPTY_INTELLIGENCE, EMPTY_GROWTH, EMPTY_CREATIVE, EMPTY_CONNECTED, EMPTY_CMS, EMPTY_COMPLIANCE,
} from './contract.ts';
import type { IndustryPack, IndustryKey, IndustryFamily } from './contract.ts';

// ── the taxonomy (the design space; NOT pack contents) ───────────────────────
export interface IndustryEntry { key: IndustryKey; label: string; family: IndustryFamily; }
export const INDUSTRIES: readonly IndustryEntry[] = [
  { key: 'restaurant', label: 'Restaurant', family: 'food' },
  { key: 'coffee_shop', label: 'Coffee Shop', family: 'food' },
  { key: 'home_services', label: 'Home Services', family: 'home_services' },
  { key: 'contractor', label: 'General Contractor', family: 'home_services' },
  { key: 'electrician', label: 'Electrician', family: 'home_services' },
  { key: 'plumber', label: 'Plumber', family: 'home_services' },
  { key: 'hvac', label: 'HVAC', family: 'home_services' },
  { key: 'roofer', label: 'Roofer', family: 'home_services' },
  { key: 'landscaper', label: 'Landscaper', family: 'home_services' },
  { key: 'medical', label: 'Medical Practice', family: 'health' },
  { key: 'dental', label: 'Dental Practice', family: 'health' },
  { key: 'legal', label: 'Law Firm', family: 'professional' },
  { key: 'financial', label: 'Financial Advisor', family: 'professional' },
  { key: 'insurance', label: 'Insurance Agency', family: 'professional' },
  { key: 'real_estate', label: 'Real Estate', family: 'professional' },
  { key: 'pet_grooming', label: 'Pet Grooming', family: 'professional' },   // L5.4 third-party sample
  { key: 'photographer', label: 'Photographer', family: 'creative' },
  { key: 'creative_agency', label: 'Creative Agency', family: 'creative' },
  { key: 'consultant', label: 'Consultant', family: 'professional' },
  { key: 'retail', label: 'Retail', family: 'commerce' },
  { key: 'ecommerce', label: 'E-commerce', family: 'commerce' },
  { key: 'nonprofit', label: 'Nonprofit', family: 'nonprofit' },
  { key: 'professional_services', label: 'Professional Services', family: 'professional' },
  { key: 'generic', label: 'Generic Business', family: 'universal' },
] as const;

export const isIndustryKey = (k: string): k is IndustryKey => INDUSTRIES.some((i) => i.key === k);
export const industryEntry = (k: IndustryKey): IndustryEntry | null => INDUSTRIES.find((i) => i.key === k) || null;

// ── build a pack from a partial (fill unspecified layers with empties) ───────
// So a real pack (L5.1) declares ONLY what it specializes; everything else is a
// no-op contribution. This keeps packs terse and provably additive.
export function makePack(partial: Partial<IndustryPack> & { key: IndustryKey; label: string; family: IndustryFamily }): IndustryPack {
  return {
    version: '1.0.0', status: 'planned', extends: null,
    profile: { summary: '', typicalServices: [], keyFields: [], bookingPosture: 'none' },
    vocabulary: {},
    evidence: EMPTY_EVIDENCE, intelligence: EMPTY_INTELLIGENCE, growth: EMPTY_GROWTH,
    creative: EMPTY_CREATIVE, connected: EMPTY_CONNECTED, cms: EMPTY_CMS, compliance: EMPTY_COMPLIANCE,
    marketplace: { author: 'Studio OS', license: 'platform', exportable: true, shareable: true, minPlatformVersion: '5.0.0', changelog: [] },
    ...partial,
  };
}

// ── the GENERIC baseline: universal defaults, ZERO industry specifics ────────
// Always resolvable, always active as the floor. It carries no industry evidence,
// rules, or templates — proof that "no industry" is just the empty pack, and the
// platform works identically with or without a pack.
export const GENERIC_PACK: IndustryPack = makePack({
  key: 'generic', label: 'Generic Business', family: 'universal', status: 'available',
  profile: { summary: 'A business with a website, services, and customers.', typicalServices: [], keyFields: ['name', 'contact', 'hours', 'location'], bookingPosture: 'none' },
  connected: { relevantProviders: ['google_business_profile', 'google_search_console', 'google_analytics'], defaults: {}, emphasises: ['reviews', 'listings'] },
  cms: { navigation: ['Home', 'About', 'Contact'], pages: ['home', 'about', 'contact'], components: [], servicePages: false, landingPages: [], blogCategories: [] },
});

// ── the registry (only the baseline ships at L5.0; packs are L5.1+) ──────────
const PACKS = new Map<IndustryKey, IndustryPack>([['generic', GENERIC_PACK]]);

/** Register a pack additively (used by L5.1 packs and marketplace install).
 *  Idempotent per key; never mutates other entries. */
export function registerPack(pack: IndustryPack): void { PACKS.set(pack.key, pack); }
export function registeredPacks(): IndustryPack[] { return [...PACKS.values()]; }

/** Resolve a site's industry from its template_slug (the vertical prefix — the
 *  same convention writer/pack.ts + coach/packs.ts already use). Always resolves. */
export function resolveIndustryKey(templateSlug: string | null | undefined): IndustryKey {
  const head = String(templateSlug || '').split('-')[0];
  return isIndustryKey(head) ? head : 'generic';
}

/** Resolve the pack for a key (or the baseline). Never null. */
export function resolvePack(key: IndustryKey): IndustryPack { return PACKS.get(key) || GENERIC_PACK; }

/** Compose a pack with its `extends` ancestry: a child overlays a parent, so a
 *  narrow vertical inherits a broad one and declares only its differences. Pure;
 *  the deepest ancestor is the generic baseline. Cycle-safe (bounded walk). */
export function composePack(key: IndustryKey): IndustryPack {
  const chain: IndustryPack[] = [];
  let cur: IndustryPack | null = resolvePack(key);
  const seen = new Set<IndustryKey>();
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key); chain.push(cur);
    cur = cur.extends ? resolvePack(cur.extends) : null;
  }
  // fold parent→child so the child wins; EVERY layer inherits (a child that
  // leaves a layer empty keeps the parent's — L5.3: extends must inherit all).
  const base = key === 'generic' ? chain : [GENERIC_PACK, ...chain.reverse()];
  return base.reduce((acc, p) => ({
    ...acc, ...p,   // top-level identity (key/label/family/version/status/extends) = the child's
    profile: {
      summary: p.profile.summary || acc.profile.summary,
      typicalServices: uniq([...acc.profile.typicalServices, ...p.profile.typicalServices]),
      keyFields: uniq([...acc.profile.keyFields, ...p.profile.keyFields]),
      bookingPosture: p.profile.bookingPosture !== 'none' ? p.profile.bookingPosture : acc.profile.bookingPosture,
    },
    vocabulary: { ...acc.vocabulary, ...p.vocabulary },
    evidence: { providerNames: uniq([...acc.evidence.providerNames, ...p.evidence.providerNames]), catalogTypes: uniq([...acc.evidence.catalogTypes, ...p.evidence.catalogTypes]) },
    intelligence: {
      judgmentRules: uniq([...acc.intelligence.judgmentRules, ...p.intelligence.judgmentRules]),
      recommendationRules: uniq([...acc.intelligence.recommendationRules, ...p.intelligence.recommendationRules]),
      momentTemplates: uniq([...acc.intelligence.momentTemplates, ...p.intelligence.momentTemplates]),
      conciergeIntents: uniq([...acc.intelligence.conciergeIntents, ...p.intelligence.conciergeIntents]),
      coachAreas: uniq([...acc.intelligence.coachAreas, ...p.intelligence.coachAreas]),
    },
    growth: { pack: p.growth.pack ?? acc.growth.pack, notes: p.growth.notes || acc.growth.notes },
    creative: {
      writer: p.creative.writer ?? acc.creative.writer,
      photographyGuidance: uniq([...acc.creative.photographyGuidance, ...p.creative.photographyGuidance]),
      mediaSuggestions: uniq([...acc.creative.mediaSuggestions, ...p.creative.mediaSuggestions]),
      brandDefaults: { ...acc.creative.brandDefaults, ...p.creative.brandDefaults },
    },
    connected: { relevantProviders: uniq([...acc.connected.relevantProviders, ...p.connected.relevantProviders]), defaults: { ...acc.connected.defaults, ...p.connected.defaults }, emphasises: uniq([...acc.connected.emphasises, ...p.connected.emphasises]) },
    cms: { navigation: uniq([...acc.cms.navigation, ...p.cms.navigation]), pages: uniq([...acc.cms.pages, ...p.cms.pages]), components: uniq([...acc.cms.components, ...p.cms.components]), servicePages: p.cms.servicePages || acc.cms.servicePages, landingPages: uniq([...acc.cms.landingPages, ...p.cms.landingPages]), blogCategories: uniq([...acc.cms.blogCategories, ...p.cms.blogCategories]) },
    compliance: { requirements: uniq([...acc.compliance.requirements, ...p.compliance.requirements]), notes: p.compliance.notes || acc.compliance.notes },
  }), GENERIC_PACK);
}
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

/** Is `siteIndustry` the target industry, or does it extend it (transitively)?
 *  This is what makes a CHILD pack inherit a PARENT's self-gated evidence: the
 *  restaurant provider fires for a coffee_shop because coffee_shop IS-A restaurant. */
export function industryIsA(siteIndustry: string | undefined | null, target: string): boolean {
  let cur: string | null = siteIndustry || null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === target) return true;
    seen.add(cur);
    cur = resolvePack(cur).extends;
  }
  return false;
}

// ── engine extension WITHOUT modification ────────────────────────────────────
// The proof that a pack extends an engine's registry additively: baseline first,
// pack contributions appended; the baseline array is never mutated. Every engine
// already iterates "its registry" — this is simply what that registry becomes
// when a pack is active. (Wiring per-site is L5.1; here we prove the shape.)
export function extendRegistry<T>(baseline: readonly T[], contributions: readonly T[]): T[] {
  return [...baseline, ...contributions];
}

// ── COMMON vs SPECIALIZED — the protected core vs the pack surface ───────────
// What ALWAYS remains universal (frozen platform; never in a pack), what a pack
// MAY specialize, what is customer content, and what is per-site configuration.
export const PLATFORM_LAYERS = {
  universal: [
    'the Intelligence pipeline (Evidence→Judgment→Recommendation→Moments→Concierge)',
    'the Approved-Plan lifecycle + approval law',
    'ownership / export / disconnect (Laws 1–4)',
    'the pure renderer + determinism',
    'the one Concierge host + moment ≤3 law + sentences-never-scores (Law 13)',
    'connected auth / crypto / execute',
    'accessibility by construction (Law 17)',
  ],
  pack: [
    'vocabulary', 'which evidence matters (industry providers + namespaced types)',
    'industry judgment/recommendation/moment copy', 'growth calendar + coach angles',
    'creative voice + photography/media guidance + brand defaults',
    'relevant connected providers + defaults', 'CMS scaffolding (nav/pages/components)',
    'compliance posture',
  ],
  content: ['the actual business facts — name, hours, the real menu items, the real services, real photos'],
  configuration: ['per-site template variant / palette', 'which providers the customer connected', 'the site\'s resolved industry key'],
} as const;
