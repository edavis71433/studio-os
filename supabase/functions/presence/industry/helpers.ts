// ── Industry Pack helpers (L5.2) — the reusable toolkit every pack shares ────
// The Restaurant Pack revealed patterns that MUST NOT be copy-pasted into the
// next 99 packs: self-gating, collision-safe type naming, structural validation,
// and maturity. They live here once, so a future pack composes them instead of
// re-implementing (and mis-implementing) them. Pure; no engine dependency.
import type { Provider } from '../evidence/providers.ts';
import type { IndustryPack } from './contract.ts';

// ── self-gating provider (was a hand-written `if (i.industry !== 'x') return`) ──
// Guarantees a pack's provider is inert for every other industry — the author
// can't forget to gate, because the wrapper does it. This is the ONLY safe way
// for a pack to add an evidence provider.
export function packProvider(industry: string, name: string, provide: (i: any, emit: any) => void): Provider {
  return {
    name,
    provide(i: any, emit: any) {
      if (i?.industry !== industry) return;   // self-gating, enforced
      provide(i, emit);
    },
  };
}

// ── collision-safe evidence type naming ──────────────────────────────────────
// A pack type is `<category>.<industry>_<name>`: a VALID category prefix (the
// frozen catalog convention) AND the industry in the name (so two packs can
// never collide on a shared category like content.* or media.*).
export function packType(industry: string, category: string, name: string): string {
  return `${category}.${industry}_${name}`;
}
/** Does a type belong to this industry's namespace? */
export function isPackType(type: string, industry: string): boolean {
  const seg = type.split('.')[1] || '';
  return seg.startsWith(`${industry}_`);
}

// ── cross-pack collision detection (a marketplace safety check) ──────────────
export function typeCollisions(packs: IndustryPack[]): string[] {
  const seen = new Map<string, string>();          // type → first pack that claimed it
  const collisions: string[] = [];
  for (const p of packs) {
    for (const t of p.evidence.catalogTypes) {
      if (seen.has(t) && seen.get(t) !== p.key) collisions.push(`${t} (${seen.get(t)} vs ${p.key})`);
      else seen.set(t, p.key);
    }
  }
  return collisions;
}

// ── structural validation — a pack is well-formed before it ships ────────────
export interface PackValidation { ok: boolean; problems: string[]; }
export function validatePack(pack: IndustryPack): PackValidation {
  const problems: string[] = [];
  // evidence types must be collision-safe: category-prefixed AND industry-namespaced
  for (const t of pack.evidence.catalogTypes) {
    if (!t.includes('.')) problems.push(`evidence type "${t}" is not category-prefixed`);
    else if (pack.key !== 'generic' && !isPackType(t, pack.key)) problems.push(`evidence type "${t}" is not namespaced by industry "${pack.key}"`);
  }
  // a provider must exist if the pack emits evidence
  if (pack.evidence.catalogTypes.length > 0 && pack.evidence.providerNames.length === 0) problems.push('declares evidence types but no provider');
  // one recommendation + one moment per interruptible judgment rule
  const jr = pack.intelligence.judgmentRules.length;
  if (pack.intelligence.recommendationRules.length !== jr) problems.push('judgment rules and recommendation rules are not 1:1');
  if (jr > 0 && pack.intelligence.momentTemplates.length !== jr) problems.push('judgment rules and moment templates are not 1:1');
  // a versioned, exportable identity is required for the marketplace
  if (!/^\d+\.\d+\.\d+$/.test(pack.version)) problems.push(`version "${pack.version}" is not semver`);
  return { ok: problems.length === 0, problems };
}

// ── pack maturity model ──────────────────────────────────────────────────────
// Six cumulative stages by BREADTH of layers filled. Depth (rule count) is
// reported separately — a pack can be broad but shallow, and honesty matters.
export type PackMaturity = 'foundation' | 'basic' | 'standard' | 'advanced' | 'complete' | 'enterprise';
export const MATURITY_ORDER: PackMaturity[] = ['foundation', 'basic', 'standard', 'advanced', 'complete', 'enterprise'];

export function packMaturity(pack: IndustryPack): PackMaturity {
  const hasProfile = !!pack.profile.summary && Object.keys(pack.vocabulary).length > 0;
  const observes = pack.evidence.catalogTypes.length > 0;
  const advises = pack.intelligence.judgmentRules.length > 0;
  const guides = !!pack.growth.pack && !!pack.creative.writer;
  const fullSite = pack.connected.relevantProviders.length > 0 && pack.cms.pages.length > 0;
  // enterprise = a complete pack that is ALSO regulated-aware AND marketplace-published
  const published = pack.marketplace.license !== 'platform';
  const enterprise = fullSite && pack.compliance.requirements.length > 0 && published;
  if (enterprise) return 'enterprise';
  if (hasProfile && observes && advises && guides && fullSite) return 'complete';
  if (hasProfile && observes && advises && guides) return 'advanced';
  if (hasProfile && observes && advises) return 'standard';
  if (hasProfile && observes) return 'basic';
  return 'foundation';
}
/** Intelligence depth, reported separately from breadth. */
export function packDepth(pack: IndustryPack): { rules: number; band: 'none' | 'basic' | 'standard' | 'deep' } {
  const n = pack.intelligence.judgmentRules.length;
  return { rules: n, band: n === 0 ? 'none' : n <= 2 ? 'basic' : n <= 5 ? 'standard' : 'deep' };
}
