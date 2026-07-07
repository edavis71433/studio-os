// ── Industry Platform Foundation (L5.0) — the ONE Industry Pack contract ─────
// Studio OS adapts to different businesses WITHOUT becoming different software.
// An Industry Pack is not a fork — it is a bundle of DATA that extends the frozen
// platform through the Extension Contract (Registry → Adapter → Catalog → Rule),
// resolved per site, consumed by engines that never change.
//
// This UNIFIES two registries that already exist but were fragmented:
//   • writer/pack.ts  (voice + vocabulary)  → the CREATIVE layer
//   • coach/packs.ts  (calendar + seasons)  → the GROWTH layer
// plus the new layers (profile, evidence, intelligence, connected, cms,
// compliance). One pack, one resolution, many layers — no parallel systems.
//
// NOTHING industry-specific is implemented here (no restaurant rules, no
// templates). This is the architecture only: the shape every pack fits, so the
// 100th industry is a registry entry, never a redesign.
import type { GrowthPack } from '../coach/packs.ts';
import type { IndustryPack as WriterPack } from '../writer/pack.ts';

// ── the taxonomy: the design space, named (not the pack contents) ────────────
// First-party industries are named for autocomplete + type-safety; but the key
// is OPEN (L5.2 scaling): a marketplace/partner pack may register any string key
// without editing the platform's type. `(string & {})` keeps IDE completion for
// the known set while accepting arbitrary keys.
export type KnownIndustryKey =
  | 'restaurant' | 'coffee_shop'
  | 'contractor' | 'electrician' | 'plumber' | 'hvac' | 'roofer' | 'landscaper'
  | 'medical' | 'dental'
  | 'legal' | 'financial' | 'insurance' | 'real_estate'
  | 'photographer' | 'creative_agency' | 'consultant'
  | 'retail' | 'ecommerce'
  | 'nonprofit' | 'professional_services'
  | 'generic';                       // the universal baseline — always resolvable
export type IndustryKey = KnownIndustryKey | (string & {});

export type IndustryFamily =
  | 'food' | 'home_services' | 'health' | 'professional' | 'creative' | 'commerce' | 'nonprofit' | 'universal';

// Marketplace lifecycle — a pack is versioned, installable, toggleable, exportable.
export type PackStatus = 'planned' | 'draft' | 'available' | 'installed' | 'disabled' | 'deprecated';

// ── the layers (every one ADDITIVE; a pack fills only what it specializes) ────

/** What a business of this type IS — defaults the platform pre-fills, never the
 *  customer's actual facts (those are content). */
export interface IndustryProfile {
  summary: string;                    // one plain sentence describing the business type
  typicalServices: string[];          // example service names (defaults, customer edits)
  keyFields: string[];                // profile fields that matter here (e.g. 'service_area')
  bookingPosture: 'reservation' | 'appointment' | 'quote' | 'walk_in' | 'order' | 'none';
}

/** Universal term → industry term. The frozen surfaces read the customer's own
 *  words through this map ("offerings" → "menu" | "services" | "portfolio"). */
export type IndustryVocabulary = Record<string, string>;

/** Additive evidence: pure providers + category-prefixed, industry-NAMESPACED
 *  catalog types. Self-gating law: an industry provider emits ONLY when the
 *  resolved industry matches, so its evidence never appears for other industries
 *  and the engine needs no industry filter. Types MUST start with `<industry>.`. */
export interface EvidenceContribution {
  providerNames: string[];            // names of the pure providers the pack registers
  catalogTypes: string[];             // e.g. 'restaurant.menu_stale' — namespaced, self-gating
}

/** Additive intelligence: rules/recs/templates the pack contributes, keyed to its
 *  OWN evidence types. Because those types only exist for this industry, the rules
 *  stay inert elsewhere — no engine change, no per-rule industry field. */
export interface IntelligenceContribution {
  judgmentRules: string[];            // judgment rule keys (consume this pack's evidence types)
  recommendationRules: string[];      // rec rule keys (one per interruptible judgment rule)
  momentTemplates: string[];          // moment template keys (customer copy in the industry's words)
  conciergeIntents: string[];         // deterministic follow-up intents this industry adds
  coachAreas: string[];               // growth-coach areas this industry emphasizes
}

/** The GROWTH layer — the existing coach GrowthPack (calendar/seasons/events) is
 *  this layer verbatim; the umbrella subsumes it rather than duplicating it. */
export interface GrowthContribution {
  pack: GrowthPack | null;            // the coach's per-vertical calendar (coach/packs.ts)
  notes: string;
}

/** The CREATIVE layer — the existing writer pack (voice + vocabulary) plus the
 *  additional creative guidance. Influences the ONE creative studio through
 *  config; it never creates a new AI system. */
export interface CreativeContribution {
  writer: WriterPack | null;          // voice guardrails + vocabulary hints (writer/pack.ts)
  photographyGuidance: string[];      // what good photos look like here (for media suggestions)
  mediaSuggestions: string[];         // the shots/sections this industry should show
  brandDefaults: Record<string, string>; // palette/tone starting points (customer overrides)
}

/** How the pack influences the Connected Platform — by REFERENCING existing
 *  provider keys and declaring relevance/defaults. Never provider-specific code. */
export interface ConnectedContribution {
  relevantProviders: string[];        // existing connected provider keys, ordered by relevance
  defaults: Record<string, unknown>;  // e.g. the booking provider to suggest first
  emphasises: ('reviews' | 'booking' | 'forms' | 'payments' | 'crm' | 'listings')[];
}

/** How the pack scaffolds the CMS — declarative navigation/pages/components a
 *  template can realize. Never an industry fork of the CMS. */
export interface CmsContribution {
  navigation: string[];               // suggested nav entries (customer edits)
  pages: string[];                    // page kinds this industry expects (e.g. 'menu', 'services')
  components: string[];               // component kinds relevant here
  servicePages: boolean;              // does this industry lead with per-service pages?
  landingPages: string[];             // landing-page kinds the coach/writer can propose
  blogCategories: string[];           // starter content categories
}

/** Industry compliance posture (medical/legal/financial/insurance care most). */
export interface ComplianceContribution {
  requirements: string[];             // e.g. 'HIPAA-aware contact forms', 'bar-compliant disclaimers'
  notes: string;
}

/** Marketplace metadata — how a pack is authored, versioned, licensed, shared. */
export interface MarketplaceMeta {
  author: string;
  license: string;
  exportable: boolean;                // a pack is serializable data → always exportable
  shareable: boolean;
  changelog: Array<{ version: string; note: string }>;
}

/** THE Industry Pack — one contract, many layers, pure data. */
export interface IndustryPack {
  key: IndustryKey;
  label: string;
  family: IndustryFamily;
  version: string;                    // semver
  status: PackStatus;
  extends: IndustryKey | null;        // composition: a pack may specialize a broader one
  profile: IndustryProfile;
  vocabulary: IndustryVocabulary;
  evidence: EvidenceContribution;
  intelligence: IntelligenceContribution;
  growth: GrowthContribution;
  creative: CreativeContribution;
  connected: ConnectedContribution;
  cms: CmsContribution;
  compliance: ComplianceContribution;
  marketplace: MarketplaceMeta;
}

// Empty layers — the generic baseline and any partially-specified pack default
// to these, so a pack only declares what it actually specializes. All additive:
// an empty contribution changes nothing.
export const EMPTY_EVIDENCE: EvidenceContribution = { providerNames: [], catalogTypes: [] };
export const EMPTY_INTELLIGENCE: IntelligenceContribution = { judgmentRules: [], recommendationRules: [], momentTemplates: [], conciergeIntents: [], coachAreas: [] };
export const EMPTY_GROWTH: GrowthContribution = { pack: null, notes: '' };
export const EMPTY_CREATIVE: CreativeContribution = { writer: null, photographyGuidance: [], mediaSuggestions: [], brandDefaults: {} };
export const EMPTY_CONNECTED: ConnectedContribution = { relevantProviders: [], defaults: {}, emphasises: [] };
export const EMPTY_CMS: CmsContribution = { navigation: [], pages: [], components: [], servicePages: false, landingPages: [], blogCategories: [] };
export const EMPTY_COMPLIANCE: ComplianceContribution = { requirements: [], notes: '' };
