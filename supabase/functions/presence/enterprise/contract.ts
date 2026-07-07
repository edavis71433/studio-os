// ── Enterprise & Multi-Location Foundation (L5.6) — the model ────────────────
// One business owns MANY locations, sharing everything by default and storing
// only DIFFERENCES. This is not a new architecture: a location is a site the
// existing pipeline already runs; the organization adds an INHERITANCE layer
// (Organization → Region → Location) resolved into per-location config, exactly
// the layered-merge the Industry Pack composePack already uses. No engine change.
//
//   Organization ─▶ Region (optional) ─▶ Location
//   inherit everything · override only what a location truly needs

// The per-location IDENTITY — always unique to a location, never inherited.
export interface LocationIdentity {
  site_id: string;             // a location IS a presence_site
  name: string;
  address: string;
  phone: string;
  hours: Record<string, string>;
  timezone: string;
}

// The INHERITABLE config — an org sets defaults; a region and a location override
// ONLY the fields they need. Every field optional: absence means "inherit".
export interface OrgConfigLayer {
  brand?: { name?: string; palette?: string; logo?: string };
  voice?: string;                          // creative voice guidance
  photographyGuidance?: string[];
  industry?: string;                       // Industry Pack key — a restaurant chain sets 'restaurant' once, at the org
  compliance?: string[];
  connected?: { providers?: string[]; defaults?: Record<string, unknown> };
  businessProfile?: Record<string, unknown>;
  growthCalendar?: string;
  cms?: { navigation?: string[]; pages?: string[]; components?: string[]; policies?: string[] };
  policies?: string[];
  template?: { slug?: string; version?: string };
}

export type ConfigLevel = 'org' | 'region' | 'location';

// A stored config row exists ONLY where something is overridden.
export interface ConfigRow { org_id: string; level: ConfigLevel; ref_id: string; config: OrgConfigLayer; }

export interface Organization { id: string; name: string; tenant_id: string; }
export interface Region { id: string; org_id: string; name: string; }
export interface Location extends LocationIdentity { org_id: string; region_id: string | null; }

// The org-wide operations that change platform behavior — each an Approved Plan.
export type OrgOp =
  | 'brand_update' | 'hours_update' | 'connected_update' | 'industry_update'
  | 'location_rollout' | 'template_rollout';
export const ORG_OPS: OrgOp[] = ['brand_update', 'hours_update', 'connected_update', 'industry_update', 'location_rollout', 'template_rollout'];
