// ── A7 Workspace: site-role resolution + members + share overrides ───────────
// Reuses the agency-auth pattern (resolve the caller via /auth/v1/user, match a
// membership row, learn the user_id on first sight). ADDITIVE and fail-open to
// the SAFE default: an unknown caller on their own site is the business_owner
// (today's behavior), so nothing regresses. Only an explicit client_reviewer
// membership narrows the view. Never touches tenant isolation (still site-scoped).
import { svc } from './db.ts';
import { authUser } from '../../_shared/auth.ts';
import type { SiteRole } from './site_roles.ts';
import { isSiteRole, seesFullWorkspace } from './site_roles.ts';
import { SITE_COLS, type SiteRow } from './site.ts';
import type { Surface, ShareOverride } from './visibility.ts';
import type { EmailBrand } from './email_brand.ts';

async function callerOf(jwt: string): Promise<{ id?: string; email?: string } | null> {
  // shared memoized resolver — the auth boundary already validated this JWT
  return await authUser(jwt);
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

/** The site an invited member reaches: their oldest active seat. They own no site,
 *  so RLS can't find it. `member` is that seat as the row states it, and is null for
 *  a role this code doesn't know, which leaves the caller under RLS. */
export async function resolveMemberSite(principal: { userId: string | null; email: string | null }): Promise<{ site: SiteRow; member: { site_id: string; role: SiteRole } | null } | null> {
  const or = `or=(user_id.eq.${encodeURIComponent(principal.userId || '00000000-0000-0000-0000-000000000000')},email.eq.${encodeURIComponent((principal.email || '').toLowerCase())})`;
  const m = await svc(`presence_site_members?status=eq.active&${or}&select=site_id,role&order=created_at.asc&limit=1`);
  const seat = Array.isArray(m.json) ? (m.json as any[])[0] : null;
  if (!seat?.site_id) return null;
  const s = await svc(`presence_sites?id=eq.${seat.site_id}&select=${SITE_COLS}&limit=1`);
  const site = Array.isArray(s.json) ? (s.json as any[])[0] : null;
  if (!site) return null;
  return { site: site as SiteRow, member: isSiteRole(seat.role) ? { site_id: site.id, role: seat.role } : null };
}

// D1 (perf): a request-scoped memo so the site-role is resolved ONCE per request.
// Keyed by the principal object, which is created fresh per request and GC'd after,
// so there is no cross-request staleness. The reviewer-boundary gate and the P2-D
// handlers both resolve the same role otherwise — this collapses that to one lookup
// (which, on the client-portal path, is a full external /auth/v1/user round-trip).
const roleCache = new WeakMap<object, Map<string, SiteRole>>();
export async function resolveSiteRoleCached(principal: { kind: string; member?: { site_id: string; role: string } | null }, jwt: string, siteId: string): Promise<SiteRole> {
  let m = roleCache.get(principal as object);
  if (!m) { m = new Map(); roleCache.set(principal as object, m); }
  const hit = m.get(siteId);
  if (hit) return hit;
  // Always resolve, because this also learns a member's user_id on first sight. But
  // the seat that admitted them outranks the answer: resolveSiteRole says
  // business_owner after a failed read, a default meant for the site's owner.
  const resolved = await resolveSiteRole(jwt, siteId, principal.kind);
  const role = principal.member?.site_id === siteId ? principal.member.role as SiteRole : resolved;
  m.set(siteId, role);
  return role;
}

/** A site's seats, oldest first. `joined` says they have signed in since the invite
 *  (their user id is learned on first sight); the id itself never leaves here. */
export async function listSiteMembers(siteId: string): Promise<Array<{ id: string; email: string; role: string; status: string; created_at: string; joined: boolean }>> {
  const r = await svc(`presence_site_members?site_id=eq.${siteId}&select=id,email,role,status,created_at,user_id&order=created_at.asc`);
  return (r.ok && Array.isArray(r.json)) ? (r.json as any[]).map(({ user_id, ...m }) => ({ ...m, joined: !!user_id })) : [];
}

// CP-9: the invite email — a one-tap magic link instead of a hand-typed code.
// Best-effort: the membership row is the truth; the email never blocks it.
/** The ONE membership-invite sender (site + agency seats): a signed one-tap
 *  link — invite for a new user, magic link for an existing one — on the
 *  caller's brand, landing on `next`. Returns true only if an email was
 *  actually sent — so the caller can honestly say whether the person was
 *  notified (rather than silently swallowing a failed send). */
/** Mint the ONE-TAP sign-in link every invite email carries: a GoTrue `invite`
 *  for a brand-new user (creates the account), else a `magiclink` for an existing
 *  one — signed by GoTrue, landing on `next` on the Site URL. Returns '' when no
 *  link can be minted (missing env, GoTrue refused), so callers can fall back
 *  honestly (a set-password link, or the plain portal door). Shared by the site/
 *  agency member invites here and the client-portal welcome in routes/sales.ts.
 *  `redirect_to` belongs at the top of this body. `options` is the JS SDK's shape,
 *  and GoTrue ignores it here: the link then lands on the project's Site URL, the
 *  marketing home page, which has no sign-in code, so the person isn't signed in. */
export async function mintSignInLink(email: string, next: string, origin?: string): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !key) return '';
  // `origin` for a page that needs its query string: the marketing domain's redirect to the app drops it
  const site = origin || Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com';
  const gen = async (type: string) => {
    try {
      const r = await fetch(`${base}/auth/v1/admin/generate_link`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, email, redirect_to: `${site}${next}` }),
      });
      const j = await r.json().catch(() => null);
      return String((r.ok && j && (j.action_link || j.properties?.action_link)) || '');
    } catch { return ''; }
  };
  let link = await gen('invite');            // new user → invite (creates the account)
  if (!link) link = await gen('magiclink');  // existing user → magic link
  return link;
}

export async function sendInviteLink(email: string, opts: { subject: string; intro: string; brand: EmailBrand; next: string }): Promise<boolean> {
  const link = await mintSignInLink(email, opts.next);
  if (!link) return false;
  const { sendEmail } = await import('../commerce/account.ts');
  const sent = await sendEmail(email, opts.subject,
    `<p>${opts.intro}</p><p class="cta"><a href="${link}" style="display:inline-block;margin-top:6px;background:${opts.brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Sign in to get started →</a></p><p style="color:#938ba3;font-size:13px;margin-top:10px">No code to type — this link signs you straight in. Want a password for next time? Use “Forgot your password?” on the sign-in page any time.</p>`, opts.brand, { critical: true }).catch(() => false);   // an invited member’s ONLY door in = transactional
  return sent !== false;
}

/** The site-membership flavor: the business's own brand + name. A reviewer lands on
 *  the client door. A seat with the full workspace lands on the studio door, because
 *  the workspace pages read the operator session ('dds-portal-auth'), and a session
 *  from the client door ('dds-client-auth') would leave them signed out there. */
async function sendSiteInvite(email: string, siteId: string, role: SiteRole): Promise<boolean> {
  const { loadEmailBrand } = await import('./email_brand.ts');
  const bn = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`);
  const name = String(bn.json?.[0]?.business_name || 'a business');   // never "Studio OS" — this reaches a client
  const brand = await loadEmailBrand(siteId);   // BR-1: a client's first touch, on the business brand (never the platform name)
  const safe = name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));   // the name is the owner's own text, and this is HTML
  // Nov 10 review (G10): "help run" is wrong for a reviewer, who can only look and
  // approve, and an invitation that oversells reads as a mistake or a scam.
  const words = role === 'client_reviewer'
    ? { subject: `${name} has shared work for you to review`, intro: `<strong>${safe}</strong> has shared work for you to look over and approve.` }
    : { subject: `You’ve been invited to help run ${name}`, intro: `You’ve been invited to help run <strong>${safe}</strong>.` };
  return sendInviteLink(email, { ...words, brand, next: seesFullWorkspace(role) ? '/studio.html' : '/portal.html' });
}

/** Nov 2026 review (client portal finding 5): is this a studio's own site, the one
 *  that holds work for its clients (any active service link names it as the studio
 *  side)? A reviewer seat there would see and decide every client's waiting files,
 *  because a reviewer is tied to a site, not to a project. True, false, or null when
 *  the read failed; callers that guard a reviewer treat null as true. */
export async function isSharedStudioSite(siteId: string): Promise<boolean | null> {
  try {
    const r = await svc(`presence_service_links?agency_site_id=eq.${siteId}&status=eq.active&select=id&limit=1`);
    if (!r.ok || !Array.isArray(r.json)) return null;
    return r.json.length > 0;
  } catch { return null; }
}

/** A reviewer can't sit on a studio's shared site (review finding 5): null when allowed. */
async function reviewerRefusal(siteId: string, role: SiteRole): Promise<'check_failed' | 'shared_site' | null> {
  if (role !== 'client_reviewer') return null;
  const shared = await isSharedStudioSite(siteId);
  if (shared === null) return 'check_failed';
  return shared ? 'shared_site' : null;
}

type SeatRow = { id: string; email: string; role: string; status: string };
export type AddMemberError = 'bad_email' | 'bad_role' | 'shared_site' | 'check_failed' | 'is_owner' | 'already_member' | 'was_removed' | 'write_failed';
/** Invite one person to a site with a role. Builder item 53: an invite never changes
 *  someone already here (that is a role change, by its own route), never makes the
 *  owner a seat, and lets a removed person back only when `restore` says so, with the
 *  role named again. Before, the invite was an upsert, so it rewrote any of those. */
export async function addSiteMember(siteId: string, email: string, role: SiteRole, invitedBy: string, opts: { restore?: boolean; ownerEmails?: string[] } = {}): Promise<{ ok: boolean; error?: AddMemberError; emailed?: boolean; restored?: boolean; member?: SeatRow }> {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'bad_email' };
  if (!isSiteRole(role)) return { ok: false, error: 'bad_role' };
  if ((opts.ownerEmails || []).some((e) => String(e || '').trim().toLowerCase() === clean)) return { ok: false, error: 'is_owner' };
  const refused = await reviewerRefusal(siteId, role);
  if (refused) return { ok: false, error: refused };
  const ex = await svc(`presence_site_members?site_id=eq.${siteId}&email=eq.${encodeURIComponent(clean)}&select=id,email,role,status&limit=1`);
  if (!ex.ok || !Array.isArray(ex.json)) return { ok: false, error: 'check_failed' };
  const seat = (ex.json as SeatRow[])[0];
  if (seat && seat.status !== 'revoked') return { ok: false, error: 'already_member', member: seat };
  if (seat && !opts.restore) return { ok: false, error: 'was_removed', member: seat };
  const r = seat
    ? await svc(`presence_site_members?id=eq.${seat.id}&site_id=eq.${siteId}&status=eq.revoked&select=id,email,role,status`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ role, status: 'active', invited_by: invitedBy }) })
    : await svc('presence_site_members', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, email: clean, role, status: 'active', invited_by: invitedBy }) });
  // a 409 is the same email added meanwhile (unique site_id, email); an empty PATCH, a restore that raced
  if (!r.ok) return { ok: false, error: r.status === 409 ? 'already_member' : 'write_failed' };
  const row = Array.isArray(r.json) ? (r.json as SeatRow[])[0] : undefined;
  if (!row) return { ok: false, error: 'already_member' };
  const emailed = await sendSiteInvite(clean, siteId, role).catch(() => false);   // CP-9: one-tap invite email — now we report whether it went
  return { ok: true, emailed, restored: !!seat, member: row };
}

/** Change a seat's role (builder item 53). Never touches a removed seat. */
export async function changeSiteMemberRole(siteId: string, memberId: string, role: SiteRole): Promise<{ ok: boolean; error?: 'bad_role' | 'shared_site' | 'check_failed' | 'not_found' | 'write_failed'; member?: SeatRow }> {
  if (!isSiteRole(role)) return { ok: false, error: 'bad_role' };
  const refused = await reviewerRefusal(siteId, role);
  if (refused) return { ok: false, error: refused };
  const r = await svc(`presence_site_members?id=eq.${memberId}&site_id=eq.${siteId}&status=neq.revoked&select=id,email,role,status`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ role }) });
  if (!r.ok) return { ok: false, error: 'write_failed' };
  const row = Array.isArray(r.json) ? (r.json as SeatRow[])[0] : undefined;
  return row ? { ok: true, member: row } : { ok: false, error: 'not_found' };
}

/** Remove a seat. False when there was no such seat here (or it was already removed). */
export async function revokeSiteMember(siteId: string, memberId: string): Promise<boolean> {
  const r = await svc(`presence_site_members?id=eq.${memberId}&site_id=eq.${siteId}&status=neq.revoked&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'revoked' }) });
  return r.ok && Array.isArray(r.json) && r.json.length > 0;
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
