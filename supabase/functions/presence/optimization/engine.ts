// ── The Presence Optimization Engine — the unified foundation (L3) ──────────
// Studio OS continuously observes a customer's digital presence and identifies
// where it can be improved. The customer never has to understand SEO, Core Web
// Vitals, structured data, accessibility, DNS, or indexing — the engine
// understands these systems and (downstream) explains them in plain business
// language.
//
// This module does NOT run anything and changes no behavior. It FORMALIZES the
// architecture that already runs: every optimization capability is a pure
// Provider (evidence/providers.ts) in the one registry the Evidence Engine
// executes. Here we declare the AREAS those providers serve, map each provider
// to its area, and expose introspection so the engine's coverage is legible and
// new providers have an obvious home. It is the contract and the map, not a
// second engine.
//
//   THE PROVIDER CONTRACT (unchanged, from evidence/providers.ts):
//     Provider = { name, provide: (input, emit) => void }
//     • PURE — no I/O, no clock, no randomness; input.now is the only time.
//     • Emits ONLY evidence via `emit(type, surface, resource, facts)`; every
//       type must exist in the catalog (contract.ts / optimization/catalog.ts).
//     • NEVER recommends, ranks, summarizes, or writes customer copy — Judgment
//       and everything after it own that. Providers observe; the pipeline decides.
//     • Independent + isolated — a throwing provider contributes nothing and
//       poisons nothing (the registry runner guarantees it).
//
//   ADDING A PROVIDER (the extension model, no architecture change):
//     1. Write a pure Provider and append it to OPTIMIZATION_PROVIDERS.
//     2. Register any new evidence types in the catalog (severity/confidence/
//        human/tech/next_action live there — providers carry only measured facts).
//     3. Map every new type to exactly one judgment rule (the completeness law).
//        Foundation-stage observations go on the suppressed `platform_roadmap`
//        rule; promoting them to customer recommendations is a deliberate later
//        rules change (L3.1), never a side effect of observing more.
//     4. Map the provider to its area below and add a test.
//   Any new probe I/O goes in a collector (evidence/collect.ts or optimization/
//   collect.ts), never in a provider.

import { PROVIDERS, PACK_PROVIDER_NAMES } from '../evidence/providers.ts';
import type { Provider } from '../evidence/providers.ts';
import { CATALOG } from '../evidence/contract.ts';
import type { Category } from '../evidence/contract.ts';

export type OptimizationArea =
  | 'seo' | 'aeo' | 'accessibility' | 'performance' | 'infrastructure'
  | 'analytics' | 'local_presence' | 'trust' | 'visual' | 'knowledge';

export interface AreaDef {
  key: OptimizationArea;
  name: string;
  purpose: string;            // plain business language — what this area protects for the customer
  categories: Category[];     // the evidence categories this area owns
}

// The ten optimization areas. Each is a lens on the customer's digital presence;
// together they are what "keep it findable, fast, trustworthy, and correct
// everywhere" decomposes into.
export const AREAS: readonly AreaDef[] = [
  { key: 'seo', name: 'Search visibility', purpose: 'Be found when people search for what the business offers.', categories: ['seo', 'structured_data'] },
  { key: 'aeo', name: 'AI search readiness', purpose: 'Be quotable by AI assistants and answer engines, not just classic search.', categories: ['aeo'] },
  { key: 'accessibility', name: 'Accessibility', purpose: 'Work for every visitor, including those using assistive technology.', categories: ['accessibility'] },
  { key: 'performance', name: 'Speed', purpose: 'Load fast enough that visitors stay instead of leaving.', categories: ['performance'] },
  { key: 'infrastructure', name: 'Foundations', purpose: 'Keep the domain, security, and email plumbing sound and uninterrupted.', categories: ['infrastructure'] },
  { key: 'analytics', name: 'Measurement', purpose: 'Understand what visitors do (observation only — no dashboards).', categories: ['analytics'] },
  { key: 'local_presence', name: 'Local presence', purpose: 'Show up correctly on maps, in directories, and in reviews.', categories: ['local_presence', 'reviews'] },
  { key: 'trust', name: 'Trust', purpose: 'Give visitors the signals that say this business is real and safe.', categories: ['trust'] },
  { key: 'visual', name: 'Imagery', purpose: 'Present the business with real, well-made images that load well.', categories: ['media'] },
  { key: 'knowledge', name: 'Business knowledge', purpose: 'Keep the facts on the site agreeing with the customer\'s own documents.', categories: ['knowledge'] },
] as const;

// The plug-in map: which registered provider serves which area. This is the
// explicit "everything plugs into one engine" registry. Providers absent here
// are the core Presence content/accuracy providers (business_info, content,
// conversion, freshness, structured_data-as-content) — they feed the same
// Evidence Engine but belong to the room, not the optimization lens.
export const PROVIDER_AREA: Record<string, OptimizationArea> = {
  // search
  seo: 'seo', metadata: 'seo', links: 'seo', technical_seo: 'seo', structured_data: 'seo',
  // AI search
  aeo: 'aeo',
  // accessibility
  accessibility: 'accessibility', accessibility_deep: 'accessibility',
  // speed
  performance: 'performance', performance_deep: 'performance', lazy_loading: 'performance',
  // foundations
  website: 'infrastructure', infrastructure: 'infrastructure', email_auth: 'infrastructure',
  // measurement
  analytics: 'analytics',
  // local
  local_presence: 'local_presence', local_presence_deep: 'local_presence', reviews: 'local_presence', reputation: 'local_presence',
  // trust
  trust: 'trust', trust_deep: 'trust',
  // imagery
  media: 'visual', visual_assets: 'visual',
  // knowledge
  knowledge: 'knowledge',
};

export function areaOf(providerName: string): OptimizationArea | null {
  return PROVIDER_AREA[providerName] || null;
}

// The core Presence providers — they feed the SAME Evidence Engine but observe
// the room's content/accuracy, not the optimization lens. Listed explicitly so
// an unmapped provider is a real onboarding gap, not one of these by design.
export const CORE_PRESENCE_PROVIDERS: ReadonlySet<string> = new Set(['business_info', 'content', 'conversion', 'freshness', 'connected']);

// Evidence types the catalog defines for an area's categories — the vocabulary
// of observations that area can produce.
export function typesForArea(area: OptimizationArea): string[] {
  const def = AREAS.find((a) => a.key === area);
  if (!def) return [];
  return Object.entries(CATALOG)
    .filter(([, entry]) => def.categories.includes(entry.category))
    .map(([type]) => type)
    .sort();
}

export interface AreaCoverage {
  area: OptimizationArea; name: string; purpose: string;
  providers: string[]; observation_types: number;
}

// Full engine coverage — for operator introspection and provider onboarding.
// "Which areas exist, which providers serve each, how many observations each
// can make." Pure; derived from the live registry + catalog, so it can never
// drift from what actually runs.
export function describeEngine(providers: Provider[] = PROVIDERS): {
  areas: AreaCoverage[];
  optimization_providers: number;
  total_providers: number;
  unmapped_optimization: string[];
} {
  const byArea = new Map<OptimizationArea, string[]>();
  for (const p of providers) {
    const a = areaOf(p.name);
    if (a) byArea.set(a, [...(byArea.get(a) || []), p.name]);
  }
  const areas: AreaCoverage[] = AREAS.map((def) => ({
    area: def.key, name: def.name, purpose: def.purpose,
    providers: (byArea.get(def.key) || []).sort(),
    observation_types: typesForArea(def.key).length,
  }));
  const mapped = new Set(Object.keys(PROVIDER_AREA));
  return {
    areas,
    optimization_providers: providers.filter((p) => areaOf(p.name)).length,
    total_providers: providers.length,
    // a registry provider that is neither assigned an optimization area, a core
    // Presence provider, nor an industry-pack content provider — a real onboarding
    // gap (someone added an optimization provider and forgot to categorize it).
    // Pack providers observe industry content (room lens), so they are exempt like
    // the core providers — and the exemption self-updates as packs are added.
    unmapped_optimization: providers.map((p) => p.name).filter((n) => !mapped.has(n) && !CORE_PRESENCE_PROVIDERS.has(n) && !PACK_PROVIDER_NAMES.has(n)).sort(),
  };
}
