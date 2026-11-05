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

// ── What a member's write on the content data path needs ─────────────────────
// A member reaches content through the service role (lib/db.ts siteDb), so RLS
// can't hold them to the table above: routes/workspace.ts memberWriteGate does,
// with this. Owners and a studio scoped in never pass through it.
//
// presence_settings is one row holding two kinds of thing. These fields are the
// website itself, so 'edit' covers them. Anything else, including a field added
// later, is account configuration (verification codes, automation switches) and
// needs 'configure'.
export const SETTINGS_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'category_order', 'cover_media_id', 'logo_media_id', 'og_media_id',
  'announcement_text', 'announcement_url', 'announcement_expires_at',
  'hero_layout', 'nav_style', 'sections_hidden', 'sections_order', 'footer_hours', 'footer_social',
  'pages_noindex', 'page_seo', 'blocks', 'pages', 'nav',
]);

/** The capability this write needs, or null when it isn't a write on the content
 *  data path. Pure. `settingsFields` is the body's keys, for PUT /settings only. */
export function contentWriteNeeds(route: string, method: string, settingsFields: string[] = []): SiteCapability | null {
  if (method === 'PUT' && (route === '/identity' || route === '/location' || route === '/voice' || route === '/brand/profile')) return 'edit';
  if (method === 'POST' && route === '/pages/duplicate') return 'edit';
  if (method === 'PUT' && route === '/settings') return settingsFields.every((f) => SETTINGS_CONTENT_FIELDS.has(f)) ? 'edit' : 'configure';
  const m = route.match(/^\/(?:offerings|testimonials|faqs|posts)(\/[0-9a-f-]{36})?$/);
  if (!m) return null;
  if (method === 'POST' && !m[1]) return 'edit';
  if ((method === 'PUT' || method === 'PATCH') && m[1]) return 'edit';
  if (method === 'DELETE' && m[1]) return 'delete';
  return null;
}
