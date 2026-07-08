// ── A7 Workspace: site-role resolution + members + share overrides ───────────
// Reuses the agency-auth pattern (resolve the caller via /auth/v1/user, match a
// membership row, learn the user_id on first sight). ADDITIVE and fail-open to
// the SAFE default: an unknown caller on their own site is the business_owner
// (today's behavior), so nothing regresses. Only an explicit client_reviewer
// membership narrows the view. Never touches tenant isolation (still site-scoped).
import { svc } from './db.ts';
import type { SiteRole } from './site_roles.ts';
import { isSiteRole } from './site_roles.ts';
import type { Surface, ShareOverride } from './visibility.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function callerOf(jwt: string): Promise<{ id?: string; email?: string } | null> {
  if (!jwt) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** The caller's role on this site. staff/system operate as the owner (full view).
 *  A matching active member row gives its role; otherwise the caller is the
 *  owning client = business_owner (unchanged default). */
export async function resolveSiteRole(jwt: string, siteId: string, principalKind: string): Promise<SiteRole> {
  if (principalKind === 'staff' || principalKind === 'system') return 'business_owner';
  const user = await callerOf(jwt);
  if (!user?.id && !user?.email) return 'business_owner';
  const email = (user.email || '').toLowerCase();
  const q = await svc(`presence_site_members?site_id=eq.${siteId}&status=eq.active&or=(user_id.eq.${user.id ?? '00000000-0000-0000-0000-000000000000'},email.eq.${encodeURIComponent(email)})&select=id,role,user_id&limit=1`);
  const row = (q.ok && q.json?.[0]) || null;
  if (!row || !isSiteRole(row.role)) return 'business_owner';
  if (!row.user_id && user.id) {
    await svc(`presence_site_members?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id }) }).catch(() => {});
  }
  return row.role as SiteRole;
}

export async function listSiteMembers(siteId: string): Promise<Array<{ id: string; email: string; role: string; status: string }>> {
  const r = await svc(`presence_site_members?site_id=eq.${siteId}&select=id,email,role,status,created_at&order=created_at.asc`);
  return (r.ok && Array.isArray(r.json)) ? r.json : [];
}

export async function addSiteMember(siteId: string, email: string, role: SiteRole, invitedBy: string): Promise<{ ok: boolean; error?: string }> {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'bad_email' };
  if (!isSiteRole(role)) return { ok: false, error: 'bad_role' };
  const r = await svc('presence_site_members?on_conflict=site_id,email', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: siteId, email: clean, role, status: 'active', invited_by: invitedBy }),
  });
  return r.ok ? { ok: true } : { ok: false, error: 'write_failed' };
}

export async function revokeSiteMember(siteId: string, memberId: string): Promise<boolean> {
  const r = await svc(`presence_site_members?id=eq.${memberId}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) });
  return r.ok;
}

/** All share overrides for a site, indexed by `${surface}:${item_id|'*'}`. */
export async function loadShares(siteId: string, surface?: string): Promise<Map<string, boolean>> {
  const filter = surface ? `&surface=eq.${encodeURIComponent(surface)}` : '';
  const r = await svc(`presence_item_shares?site_id=eq.${siteId}${filter}&select=surface,item_id,shared`);
  const m = new Map<string, boolean>();
  if (r.ok && Array.isArray(r.json)) for (const s of r.json) m.set(`${s.surface}:${s.item_id ?? '*'}`, !!s.shared);
  return m;
}

/** Look up the effective override for one item (item-level wins over surface-level). */
export function overrideFor(shares: Map<string, boolean>, surface: Surface, itemId?: string | null): ShareOverride {
  if (itemId != null && shares.has(`${surface}:${itemId}`)) return { shared: shares.get(`${surface}:${itemId}`) };
  if (shares.has(`${surface}:*`)) return { shared: shares.get(`${surface}:*`) };
  return {};
}

export async function setShare(siteId: string, surface: string, itemId: string | null, shared: boolean, by: string): Promise<boolean> {
  const r = await svc('presence_item_shares?on_conflict=site_id,surface,item_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: siteId, surface, item_id: itemId, shared, shared_by: by }),
  });
  return r.ok;
}
