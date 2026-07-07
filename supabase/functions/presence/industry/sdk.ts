// ── Industry Pack SDK (L5.4) — the ONE public surface for pack authors ───────
// A third-party developer imports EVERYTHING they need from here, and nothing
// from the platform's internals. If it isn't re-exported here, a pack doesn't
// need it. This is the published contract boundary: packs are data + one pure
// provider, composed and validated through these functions; they never touch an
// engine, never bypass approval, never see another tenant.
//
//   import { makePack, packProvider, packType, validatePack } from '../sdk.ts';
//
// See docs/presence/THIRD-PARTY-PACK-GUIDE.md for the full walkthrough.

// ── the contract (types every pack is written against) ───────────────────────
export type {
  IndustryPack, IndustryKey, KnownIndustryKey, IndustryFamily, PackStatus,
  IndustryProfile, IndustryVocabulary, EvidenceContribution, IntelligenceContribution,
  GrowthContribution, CreativeContribution, ConnectedContribution, CmsContribution,
  ComplianceContribution, MarketplaceMeta,
} from './contract.ts';
export {
  EMPTY_EVIDENCE, EMPTY_INTELLIGENCE, EMPTY_GROWTH, EMPTY_CREATIVE,
  EMPTY_CONNECTED, EMPTY_CMS, EMPTY_COMPLIANCE,
} from './contract.ts';

// ── engine-shaped contribution types (author evidence + intelligence) ────────
// A pack contributes a provider and rules shaped exactly like the platform's, so
// the SDK re-exports those shapes (type-only) — a pack author never imports an
// engine file directly.
export type { Provider } from '../evidence/providers.ts';
export type { Rule as JudgmentRule } from '../judgment/rules.ts';
export type { Priority, ImpactDimension, JudgmentCategory, Audience, Timing } from '../judgment/contract.ts';
export type { RecRule as RecommendationRule } from '../recommendation/rules.ts';
export type { ActionType, ValueDimension, Effort, Risk, Undoability } from '../recommendation/contract.ts';
export type { MomentTemplate } from '../moments/rules.ts';
export type { MomentType, Tone } from '../moments/contract.ts';

// ── authoring helpers (build a pack without boilerplate or foot-guns) ────────
export {
  packProvider,          // a self-gating, inheritance-aware evidence provider
  packType,              // collision-safe, category-valid evidence type keys
  isPackType,
  typeCollisions,
  validatePack,          // structural validation (run before you register)
  validatePackAgainstRegistry, // cross-pack: collisions, missing deps, cycles
  packMaturity, packDepth,
} from './helpers.ts';
export type { PackValidation, PackMaturity } from './helpers.ts';

// ── registry + composition (register, resolve, inherit) ──────────────────────
export {
  makePack,              // fill unspecified layers with empties — declare only your delta
  registerPack, registeredPacks,
  resolvePack, resolveIndustryKey, composePack, industryIsA,
  INDUSTRIES, isIndustryKey, extendRegistry,
} from './registry.ts';
export type { IndustryEntry } from './registry.ts';

// ── marketplace lifecycle + versioning ───────────────────────────────────────
export {
  PLATFORM_VERSION, isCompatible,
  transition, canInstall, canEnable, canDisable, canDeprecate,
  compareVersions, parseVersion, canUpdate,
  exportPack, canExport, canShare,
} from './marketplace.ts';
export type { MarketplaceAction, ExportedPack } from './marketplace.ts';
