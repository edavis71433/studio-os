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
  // fast path: the overwhelming common case is a site with NO extra members —
  // the caller is the owning client (business_owner) and we skip the auth lookup.
  const any = await svc(`presence_site_members?site_id=eq.${siteId}&status=eq.active&select=id&limit=1`);
  if (!(any.ok && any.json?.length)) return 'business_owner';
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

// D1 (perf): a request-scoped memo so the site-role is resolved ONCE per request.
// Keyed by the principal object, which is created fresh per request and GC'd after,
// so there is no cross-request staleness. The reviewer-boundary gate and the P2-D
// handlers both resolve the same role otherwise — this collapses that to one lookup
// (which, on the client-portal path, is a full external /auth/v1/user round-trip).
const roleCache = new WeakMap<object, Map<string, SiteRole>>();
export async function resolveSiteRoleCached(principal: { kind: string }, jwt: string, siteId: string): Promise<SiteRole> {
  let m = roleCache.get(principal as object);
  if (!m) { m = new Map(); roleCache.set(principal as object, m); }
  const hit = m.get(siteId);
  if (hit) return hit;
  const role = await resolveSiteRole(jwt, siteId, principal.kind);
  m.set(siteId, role);
  return role;
}

export async function listSiteMembers(siteId: string): Promise<Array<{ id: string; email: string; role: string; status: string }>> {
  const r = await svc(`presence_site_members?site_id=eq.${siteId}&select=id,email,role,status,created_at&order=created_at.asc`);
  return (r.ok && Array.isArray(r.json)) ? r.json : [];
}

// CP-9: the invite email — a one-tap magic link instead of a hand-typed code.
// Best-effort: the membership row is the truth; the email never blocks it.
/** Sends the invite/sign-in email. Returns true only if an email was actually
 *  sent — so the caller can honestly tell the owner whether the client was
 *  notified (rather than silently swallowing a failed send). */
async function sendInviteLink(email: string, siteId: string): Promise<boolean> {
  const base = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !key) return false;
  const site = Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com';
  const gen = async (type: string) => {
    const r = await fetch(`${base}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, email, options: { redirect_to: `${site}/portal.html` } }),
    });
    const j = await r.json().catch(() => null);
    return (r.ok && j && (j.action_link || j.properties?.action_link)) || '';
  };
  let link = await gen('invite');            // new user → invite (creates the account)
  if (!link) link = await gen('magiclink');  // existing user → magic link
  if (!link) return false;
  const { sendEmail } = await import('../commerce/account.ts');
  const { loadEmailBrand } = await import('./email_brand.ts');
  const bn = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`);
  const name = String(bn.json?.[0]?.business_name || 'a business');   // never "Studio OS" — this reaches a client
  const brand = await loadEmailBrand(siteId);   // BR-1: a client's first touch, on the business brand (never the platform name)
  const sent = await sendEmail(email, `You’ve been invited to help run ${name}`,
    `<p>You’ve been invited to help run <strong>${name}</strong>.</p><p class="cta"><a href="${link}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Sign in to get started →</a></p><p style="color:#938ba3;font-size:13px;margin-top:10px">No code to type. You can set a password afterwards from your account.</p>`, brand).catch(() => false);
  return sent !== false;
}

export async function addSiteMember(siteId: string, email: string, role: SiteRole, invitedBy: string): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'bad_email' };
  if (!isSiteRole(role)) return { ok: false, error: 'bad_role' };
  const r = await svc('presence_site_members?on_conflict=site_id,email', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: siteId, email: clean, role, status: 'active', invited_by: invitedBy }),
  });
  if (!r.ok) return { ok: false, error: 'write_failed' };
  const emailed = await sendInviteLink(clean, siteId).catch(() => false);   // CP-9: one-tap invite email — now we report whether it went
  return { ok: true, emailed };
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
