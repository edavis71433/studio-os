// ── Site-level roles (A7) — the audience WITHIN one site ─────────────────────
// Distinct from the agency principal (spans a portfolio) and the operator
// (`staff`). A site's owning client is always the business_owner; additional
// people are granted a role via presence_site_members. Permissions as DATA, one
// place, pure. ADDITIVE: with no members assigned, the owner sees everything —
// exactly today's behavior — so nothing regresses. Deny-by-default.
//
// This is the foundation the client-portal differentiation, the read-only
// stakeholder, business staff, and Developer-Mode prep all build on. It does NOT
// change tenant isolation (which site) — only the audience within a site.

export type SiteRole = 'business_owner' | 'business_staff' | 'client_reviewer' | 'developer';

export const SITE_ROLES: readonly SiteRole[] = ['business_owner', 'business_staff', 'client_reviewer', 'developer'];
export function isSiteRole(r: string): r is SiteRole { return (SITE_ROLES as readonly string[]).includes(r); }

export type SiteCapability =
  | 'view_all'             // see the full business-owner workspace
  | 'view_shared'          // see only items shared to the client (the client portal)
  | 'edit'                 // edit content/drafts
  | 'approve'              // approve plans / drafts (the sign-off)
  | 'publish'              // publish to the live site
  | 'connect'              // manage connected services
  | 'configure'            // settings
  | 'delete'
  | 'export'               // download everything you can see (ownership)
  | 'invite'               // invite / manage site members
  | 'comment'              // leave comments on shared items
  | 'use_developer_mode';  // A8 prep — off unless the role grants it

// The one capability table. Business owner = full; business staff = operate but
// not delete/configure/invite; client reviewer = the client portal (review,
// approve, comment, export shared); developer = full + developer mode (no
// delete/invite by default).
const CAPS: Record<SiteRole, SiteCapability[]> = {
  business_owner: ['view_all', 'edit', 'approve', 'publish', 'connect', 'configure', 'delete', 'export', 'invite', 'comment'],
  business_staff: ['view_all', 'edit', 'approve', 'publish', 'connect', 'export', 'comment'],
  client_reviewer: ['view_shared', 'approve', 'export', 'comment'],
  developer: ['view_all', 'edit', 'approve', 'publish', 'connect', 'configure', 'export', 'comment', 'use_developer_mode'],
};

export function siteCan(role: SiteRole, cap: SiteCapability): boolean {
  return (CAPS[role] || []).includes(cap);
}

export function capabilitiesOf(role: SiteRole): SiteCapability[] {
  return [...(CAPS[role] || [])];
}

/** A reviewer is the "client" audience — sees only shared items. Everyone else
 *  (owner/staff/developer, and the operator) sees the full workspace. */
export function seesFullWorkspace(role: SiteRole): boolean {
  return siteCan(role, 'view_all');
}
