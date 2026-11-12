// ── Owners on deals, requests and to-dos (sales item 37, Nov 2026) ────────────
// Once a second person is on a studio's team, every deal, request and to-do has an
// owner: assigned_to, the person's sign-in id (deals since 0074, requests since 0078,
// to-dos since 0199). Whoever adds one owns it; a deal made from a website enquiry and
// a request a client sends start with the business owner (the team's owner seat). A
// row with no owner (from before owners existed) is the business owner's. "Mine"
// shows only yours on Pipeline, Requests and To-dos. A person on no studio team is a
// team of one: everything is theirs, and the pages show no toggle and no picker.
import { svc } from './db.ts';
import { UUID_RE } from './uuid.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown } | null) => (r && Array.isArray((r as any).json) ? (r as any).json : []) as any[];

/** me: the caller; owner: the business owner; ids: everyone who can own something. */
export type Team = { me: string; owner: string; ids: string[] };

/** A team as the server read it, from the members' rows (pure, for tests and the route). */
export function teamFrom(me: string, members: Array<{ user_id?: unknown; role?: unknown }>): Team {
  const ids: string[] = [];
  for (const m of members || []) { const id = String(m?.user_id || ''); if (UUID_RE.test(id) && !ids.includes(id)) ids.push(id); }
  const ownerRow = (members || []).find((m) => m?.role === 'owner' && UUID_RE.test(String(m?.user_id || '')));
  const owner = ownerRow ? String(ownerRow.user_id) : (ids[0] || me);
  if (UUID_RE.test(me) && !ids.includes(me)) ids.push(me);
  return { me, owner, ids };
}

/** The caller's team: their studio's active members who have signed in. */
export async function teamOf(principal: Principal): Promise<Team> {
  const me = UUID_RE.test(String(principal?.userId || '')) ? String(principal.userId) : '';
  if (!principal?.jwt) return teamFrom(me, []);
  const m = await resolveAgencyMember(principal.jwt).catch(() => null);
  if (!m) return teamFrom(me, []);
  const list = rows(await svc(`presence_agency_members?agency_id=eq.${m.agency_id}&status=eq.active&user_id=not.is.null&select=user_id,role,created_at&order=created_at.asc&limit=200`).catch(() => null));
  return teamFrom(me, list);
}

/** The business owner of the studio that serves a client site: a request a client sends starts with them. */
export async function studioOwnerOfSite(siteId: string): Promise<string | null> {
  if (!UUID_RE.test(String(siteId || ''))) return null;
  const link = rows(await svc(`presence_agency_clients?site_id=eq.${siteId}&select=agency_id&limit=1`).catch(() => null))[0];
  if (!link) return null;
  const o = rows(await svc(`presence_agency_members?agency_id=eq.${link.agency_id}&role=eq.owner&status=eq.active&user_id=not.is.null&select=user_id&limit=1`).catch(() => null))[0];
  return o && UUID_RE.test(String(o.user_id)) ? String(o.user_id) : null;
}

/** Is a row with this owner the caller's? One with no owner is the business owner's. */
export const isMine = (team: Team, assignedTo: unknown): boolean =>
  assignedTo ? String(assignedTo) === team.me : (!!team.me && team.me === team.owner);

/** "Mine" as a PostgREST filter part on `col`. */
export function mineFilter(team: Team, col = 'assigned_to'): string {
  if (!team.me) return `&${col}=eq.00000000-0000-0000-0000-000000000000`;   // no one to be: nothing is theirs
  return team.me === team.owner ? `&or=(${col}.eq.${team.me},${col}.is.null)` : `&${col}=eq.${team.me}`;
}

/** An owner a write may set: someone on the team, or empty (nobody, which means the business owner). */
export function ownerToSet(team: Team, raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === '') return { ok: true, value: null };
  const id = String(raw ?? '');
  return UUID_RE.test(id) && team.ids.includes(id) ? { ok: true, value: id } : { ok: false };
}
