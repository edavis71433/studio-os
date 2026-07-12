// ⚠️ SPEC MODULE — NOT WIRED INTO PRODUCTION (verified Jul 12 2026: zero production
// imports; exercised only by its test). It documents a frozen-architecture contract
// awaiting its phase — do NOT assume it guards anything at runtime. Wire it or
// delete it (with an ADR note) when its phase arrives.
// ── Agency permissions (L5.7) — COMPOSITION over the existing capability table ─
// The agency doesn't get a second permission system. This composes the existing
// role→capability table (auth.ts `can`) with a SCOPE (which orgs/locations a
// member may touch). Effective permission = (role has the capability) AND (the
// target is within the member's scope). Scoped admins (Enterprise/Org/Location
// Admin) are an agency role bounded to a subset of the portfolio. Pure.
import { can } from './auth.ts';
import type { AgencyRole, Capability } from './auth.ts';

// The orchestrated actions and the capability each requires (from auth.ts).
export type AgencyAction =
  | 'view' | 'manage_clients'
  | 'org_manage' | 'org_rollout_prepare' | 'org_rollout_approve'
  | 'pack_prepare' | 'pack_approve'
  | 'connected_prepare' | 'connected_approve'
  | 'publish' | 'manage_members';

export const ACTION_CAP: Record<AgencyAction, Capability> = {
  view: 'read',
  manage_clients: 'manage_clients',
  org_manage: 'manage_enterprise',
  org_rollout_prepare: 'manage_enterprise',
  org_rollout_approve: 'approve_plans',
  pack_prepare: 'manage_marketplace',
  pack_approve: 'approve_plans',
  connected_prepare: 'manage_connected',
  connected_approve: 'approve_plans',
  publish: 'bulk_publish',
  manage_members: 'manage_members',
};

// A member's reach: the agency fences to its own portfolio; a scoped admin is
// further bounded to specific orgs/locations. '*' = the whole (agency) portfolio.
export interface Scope { orgs: Set<string> | '*'; sites: Set<string> | '*'; }
export const FULL_SCOPE: Scope = { orgs: '*', sites: '*' };
export const scopeOrg = (orgId: string, sites: string[] = []): Scope => ({ orgs: new Set([orgId]), sites: sites.length ? new Set(sites) : '*' });
export const scopeSite = (siteId: string): Scope => ({ orgs: '*', sites: new Set([siteId]) });

export interface ScopedMember { role: AgencyRole; scope: Scope; }

/** The composition: role capability AND scope membership. Deny by default. */
export function authorize(member: ScopedMember, action: AgencyAction, target?: { orgId?: string; siteId?: string }): boolean {
  if (!can(member.role, ACTION_CAP[action])) return false;             // role gate
  const { orgs, sites } = member.scope;
  if (target?.orgId && orgs !== '*' && !orgs.has(target.orgId)) return false;   // org scope gate
  if (target?.siteId && sites !== '*' && !sites.has(target.siteId)) return false; // location scope gate
  return true;
}

// ── the nine named roles (the Permission Matrix) — presets over role + scope ──
// Agency-tier roles reach the whole portfolio; the three scoped admins bind an
// agency role to a subset. Naming maps to the existing AgencyRole table.
export type NamedRole =
  | 'agency_owner' | 'agency_admin' | 'manager' | 'editor' | 'analyst' | 'read_only'
  | 'enterprise_admin' | 'organization_admin' | 'location_admin';

export function memberForRole(named: NamedRole, ctx: { orgId?: string; siteId?: string; orgSites?: string[] } = {}): ScopedMember {
  switch (named) {
    case 'agency_owner': return { role: 'owner', scope: FULL_SCOPE };
    case 'agency_admin': return { role: 'admin', scope: FULL_SCOPE };
    case 'manager': return { role: 'account_manager', scope: FULL_SCOPE };
    case 'editor': return { role: 'content_strategist', scope: FULL_SCOPE };
    case 'analyst': return { role: 'readonly', scope: FULL_SCOPE };
    case 'read_only': return { role: 'readonly', scope: FULL_SCOPE };
    // scoped admins: an agency role bounded to their org/location
    case 'enterprise_admin': return { role: 'admin', scope: FULL_SCOPE };            // manages enterprise, full portfolio
    case 'organization_admin': return { role: 'account_manager', scope: scopeOrg(ctx.orgId || '', ctx.orgSites) };
    case 'location_admin': return { role: 'content_strategist', scope: scopeSite(ctx.siteId || '') };
  }
}

/** Every named role's allowed actions — the documented Permission Matrix (pure). */
export function permissionMatrix(): Record<NamedRole, AgencyAction[]> {
  const actions = Object.keys(ACTION_CAP) as AgencyAction[];
  const roles: NamedRole[] = ['agency_owner', 'agency_admin', 'manager', 'editor', 'analyst', 'read_only', 'enterprise_admin', 'organization_admin', 'location_admin'];
  const out = {} as Record<NamedRole, AgencyAction[]>;
  for (const r of roles) {
    const m = memberForRole(r, { orgId: 'o', siteId: 's', orgSites: ['s'] });
    // matrix reflects role capabilities (scope is applied per-target at call time)
    out[r] = actions.filter((a) => can(m.role, ACTION_CAP[a]));
  }
  return out;
}
