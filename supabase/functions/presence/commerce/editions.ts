// ── L-Packaging · Editions as DATA (Phase D) ─────────────────────────────────
// ONE platform, many editions. An edition is a NAMED BUNDLE OF FEATURES — never
// a separate codebase, deployment, app, or navigation system. This file is the
// single source of packaging truth: which feature areas each edition includes,
// the ladder order (for upgrade/downgrade), and the plan→edition mapping. Pure —
// no I/O — so it's exhaustively testable and the nav/gates/UI all read from it.
//
// Orthogonal to the two machine-real dimensions that already exist:
//   • commerce/catalog.ts PLANS  → pricing/commercial truth (what you buy)
//   • presence_sites.edition     → hosting/render capability (monitor | presence)
// This adds the FEATURE dimension (what you can do), which is what nav adapts to.

export type EditionKey =
  | 'monitor' | 'cms_only' | 'business_os_only' | 'studio_os' | 'managed' | 'agency' | 'enterprise';

export const EDITIONS: readonly EditionKey[] = ['monitor', 'cms_only', 'business_os_only', 'studio_os', 'managed', 'agency', 'enterprise'];
export function isEditionKey(x: unknown): x is EditionKey { return typeof x === 'string' && (EDITIONS as readonly string[]).includes(x); }

// Feature areas — the atoms editions are composed from. Each maps to real,
// already-built capability; nav sections and feature gates read these.
export type EditionFeature =
  | 'website'          // CMS: pages/media/templates/SEO/publishing/preview/versioning/rollback
  | 'developer'        // Developer Mode (still capability-gated by use_developer_mode)
  | 'forms'            // Forms / Lead Capture — packaged here, BUILD pending (FD-2)
  | 'business_moments' // the daily intelligence surface
  | 'connected'        // Connected Platform (read + approved writes)
  | 'ai'               // Concierge / Growth / Visual Studio brains
  | 'relationship'     // CRM — the Client Relationship Center
  | 'reports'          // ownership/export + the relationship read (calm, no dashboards)
  | 'client_portal'    // sharing + invite a client reviewer (ownership)
  | 'managed_service'  // concierge/done-for-you (a person in the loop)
  | 'agency'           // portfolio, client switching, white-label
  | 'enterprise';      // orgs, locations, governance, SSO/SCIM, audit exports

// The one matrix. Higher editions are supersets of lower ones (upgrades only add).
const CMS: EditionFeature[] = ['website', 'developer', 'forms', 'client_portal', 'reports'];
const BOS: EditionFeature[] = ['business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'];
const STUDIO: EditionFeature[] = Array.from(new Set([...CMS, ...BOS]));
// Monitor WATCHES an existing website (read-only) plus the intelligence layer —
// Business Moments, connected data, guidance, and reports — so you "know the moment
// it needs you". It shows the observed workspace but never drafts/publishes
// (enforced by the site edition 'monitor') and has no CMS authoring (developer/
// forms), since it hosts nothing. It deliberately does NOT include the relationship
// suite (CRM / sales / projects) — that is Business OS — so a $19 watch plan never
// out-features the $29 Business OS plan (relationship is the thing you upgrade for).
const MONITOR: EditionFeature[] = ['website', 'business_moments', 'connected', 'ai', 'reports', 'client_portal'];

const MATRIX: Record<EditionKey, EditionFeature[]> = {
  monitor: MONITOR,
  cms_only: CMS,
  business_os_only: BOS,
  studio_os: STUDIO,
  managed: Array.from(new Set([...STUDIO, 'managed_service'])),
  agency: Array.from(new Set([...STUDIO, 'managed_service', 'agency'])),
  enterprise: Array.from(new Set([...STUDIO, 'managed_service', 'agency', 'enterprise'])),
};

export interface EditionDef {
  key: EditionKey;
  rank: number;              // ladder order (upgrade = higher rank)
  name: string;              // customer-facing
  promise: string;           // one calm line
  features: EditionFeature[];
}

export const EDITION_DEFS: Record<EditionKey, EditionDef> = {
  monitor: { key: 'monitor', rank: 1, name: 'Monitor', promise: 'Watch your existing website — and know the moment it needs you.', features: MATRIX.monitor },
  cms_only: { key: 'cms_only', rank: 1, name: 'CMS', promise: 'A website that stays correct — structured, versioned, and yours.', features: MATRIX.cms_only },
  business_os_only: { key: 'business_os_only', rank: 1, name: 'Business OS', promise: 'Know your business at a glance — moments, connections, and relationships.', features: MATRIX.business_os_only },
  studio_os: { key: 'studio_os', rank: 2, name: 'Studio OS', promise: 'Your website and your business, one calm operating system.', features: MATRIX.studio_os },
  managed: { key: 'managed', rank: 3, name: 'Managed', promise: 'We keep it right for you — a real person alongside the system.', features: MATRIX.managed },
  agency: { key: 'agency', rank: 4, name: 'Agency', promise: 'One operating system over many client businesses, under your name.', features: MATRIX.agency },
  enterprise: { key: 'enterprise', rank: 5, name: 'Enterprise', promise: 'Every location correct, every publish governed, one source of truth.', features: MATRIX.enterprise },
};

export function featuresOf(edition: EditionKey): EditionFeature[] { return [...(MATRIX[edition] || [])]; }
export function editionIncludes(edition: EditionKey, feature: EditionFeature): boolean { return (MATRIX[edition] || []).includes(feature); }
export function editionRank(edition: EditionKey): number { return EDITION_DEFS[edition]?.rank ?? 0; }

/** True when moving from → to gains capability (an upgrade). Same-rank editions
 *  (cms_only ↔ business_os_only) are lateral, not upgrades. */
export function isUpgrade(from: EditionKey, to: EditionKey): boolean { return editionRank(to) > editionRank(from); }
export function isDowngrade(from: EditionKey, to: EditionKey): boolean { return editionRank(to) < editionRank(from); }

/** Features gained / lost moving between editions — the honest upgrade/downgrade
 *  preview. Data is never in this list (data is always preserved; capabilities
 *  appear or hide). Pure. */
export function featureDelta(from: EditionKey, to: EditionKey): { gained: EditionFeature[]; lost: EditionFeature[] } {
  const a = new Set(featuresOf(from)); const b = new Set(featuresOf(to));
  return {
    gained: featuresOf(to).filter((f) => !a.has(f)),
    lost: featuresOf(from).filter((f) => !b.has(f)),
  };
}

/** Map a commercial plan (commerce/catalog.ts PLANS) to its feature edition.
 *  Multiple plans can share an edition (e.g. Monitor is Business-OS observe-only). */
export function editionFromPlan(planKey: string): EditionKey {
  switch (planKey) {
    case 'presence': return 'studio_os';
    case 'presence_managed': return 'managed';
    case 'agency': return 'agency';
    case 'enterprise': return 'enterprise';
    case 'presence_monitor': return 'monitor';          // observe an existing site + intelligence (no publish)
    case 'cms_only': return 'cms_only';
    case 'business_os_only': return 'business_os_only';
    default: return 'studio_os';
  }
}

/** The nav-relevant edition flags buildNav consumes. Derived from the matrix so
 *  navigation adapts automatically to the edition — no per-edition nav code. */
export interface EditionFlags {
  hasWebsite: boolean;
  hasBusinessOS: boolean;   // any of moments/connected/ai/relationship
  hasRelationship: boolean;
  hasConnected: boolean;
  hasReports: boolean;
  hasClientPortal: boolean;
  hasDeveloper: boolean;
  hasAgency: boolean;
  hasEnterprise: boolean;
}
export function editionFlags(edition: EditionKey): EditionFlags {
  const f = new Set(featuresOf(edition));
  return {
    hasWebsite: f.has('website'),
    hasBusinessOS: f.has('business_moments') || f.has('connected') || f.has('ai') || f.has('relationship'),
    hasRelationship: f.has('relationship'),
    hasConnected: f.has('connected'),
    hasReports: f.has('reports'),
    hasClientPortal: f.has('client_portal'),
    hasDeveloper: f.has('developer'),
    hasAgency: f.has('agency'),
    hasEnterprise: f.has('enterprise'),
  };
}

/** Legacy site edition ('monitor' | 'presence') → a sensible default feature
 *  edition, used when no explicit edition entitlement is stored yet. Preserves
 *  today's behavior: a full 'presence' site is Studio OS; 'monitor' is watch. */
export function editionFromSite(siteEdition: string, opts?: { isAgency?: boolean; isEnterprise?: boolean }): EditionKey {
  if (opts?.isEnterprise) return 'enterprise';
  if (opts?.isAgency) return 'agency';
  if (siteEdition === 'monitor') return 'monitor';   // observe-only site → the Monitor edition (workspace visible, no publish)
  return 'studio_os';
}
