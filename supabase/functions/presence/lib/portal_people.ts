// ── Builder list items 236 and 232 (Nov 2026): where each client stands with the portal ──
// Drawn in Figma first (page "Client portal — from the Agiled check", sections 236 and 232).
//
// The studio's Client portal page counts its clients: active, waiting to join, invites
// that ran out, and in the portal in the last 30 days. A client's portal card says when
// they were invited and when they were last in. People, not sign-ins: "last in" is the
// last time they opened their portal (clients.portal_seen_at, stamped by /portal/context
// at most once an hour), or, for a client last in before that stamp existed, their last
// sign-in. An invite "runs out" after seven days without them coming in; the card then
// offers a new one.
import { svc } from './db.ts';

export const INVITE_DAYS = 7;
export const RECENT_DAYS = 30;
export const SEEN_EVERY_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export type PortalState = 'joined' | 'waiting' | 'expired' | 'none';
export interface PortalPerson { site_id: string; name: string; email: string; state: PortalState; invited_at: string | null; seen_at: string | null }

const ms = (iso: string | null | undefined) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? t : NaN; };

/** Where one client stands: in (they've opened the portal), waiting to join, their invite
 *  ran out, or never invited (no sign-in of their own yet). Pure. */
export function portalStateOf(p: { hasLogin: boolean; invitedAt: string | null; seenAt: string | null }, nowMs: number): PortalState {
  if (Number.isFinite(ms(p.seenAt))) return 'joined';
  if (!p.hasLogin) return 'none';
  const at = ms(p.invitedAt);
  return Number.isFinite(at) && nowMs - at >= INVITE_DAYS * DAY_MS ? 'expired' : 'waiting';
}

/** The four numbers on the Client portal page. Active is every client the studio looks
 *  after; recent counts the people in their portal in the last 30 days. Pure. */
export function portalCounts(people: PortalPerson[], nowMs: number): { active: number; waiting: number; expired: number; recent: number } {
  const since = nowMs - RECENT_DAYS * DAY_MS;
  return {
    active: people.length,
    waiting: people.filter((p) => p.state === 'waiting').length,
    expired: people.filter((p) => p.state === 'expired').length,
    recent: people.filter((p) => ms(p.seen_at) >= since).length,
  };
}

export const SETUP_STEPS = ['logo', 'parts', 'welcome', 'preview', 'invite'] as const;
export type SetupStep = typeof SETUP_STEPS[number];
/** The five-step set-up list, in order: a logo, what clients see, a welcome note, the
 *  portal seen as a client, the first client invited. Pure. */
export function setupList(f: { hasLogo: boolean; partsAt: string | null; welcome: string; previewedAt: string | null; invitedAny: boolean }): Array<{ key: SetupStep; done: boolean }> {
  const done: Record<SetupStep, boolean> = {
    logo: !!f.hasLogo,
    parts: Number.isFinite(ms(f.partsAt)),
    welcome: !!String(f.welcome || '').trim(),
    preview: Number.isFinite(ms(f.previewedAt)),
    invite: !!f.invitedAny,
  };
  return SETUP_STEPS.map((key) => ({ key, done: done[key] }));
}

// ── reads ──
const rowsOf = <T,>(q: { ok?: boolean; json?: unknown } | null | undefined): T[] => (q && q.ok !== false && Array.isArray(q.json) ? (q.json as T[]) : []);
async function inChunks<T>(ids: string[], read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...await read(ids.slice(i, i + 100)));
  return out;
}

// the last sign-in of someone the portal hasn't seen yet, kept per instance for ten minutes
const SIGNIN_TTL_MS = 10 * 60_000;
const lastSignIns = new Map<string, { at: number; last: string | null }>();
async function lastSignIn(uid: string): Promise<string | null> {
  const hit = lastSignIns.get(uid);
  if (hit && Date.now() - hit.at < SIGNIN_TTL_MS) return hit.last;
  const base = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(uid)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const j = r.ok ? await r.json().catch(() => null) : null;
    const last = j && typeof j.last_sign_in_at === 'string' ? j.last_sign_in_at : null;
    if (lastSignIns.size > 2000) lastSignIns.clear();
    lastSignIns.set(uid, { at: Date.now(), last });
    return last;
  } catch { return null; }
}

/** Where each of these client sites' people stand with the portal. Three reads for the
 *  lot (sites, clients, their sign-ins), then a sign-in lookup only for someone the
 *  portal hasn't seen yet, eight at a time, fifty at most. */
export async function portalPeople(sites: Array<{ site_id: string; name: string }>, nowMs = Date.now()): Promise<PortalPerson[]> {
  if (!sites.length) return [];
  type SiteRow = { id: string; client_id: string | null };
  type ClientRow = { id: string; email: string | null; contact_email: string | null; contact_id: string | null; portal_seen_at: string | null };
  type ContactRow = { id: string; auth_user_id: string | null; created_at: string | null };
  const siteRows = await inChunks(sites.map((s) => s.site_id), async (ids) => rowsOf<SiteRow>(await svc(`presence_sites?id=in.(${ids.join(',')})&select=id,client_id`)));
  const clientOf = new Map(siteRows.map((r) => [r.id, r.client_id]));
  const clientIds = [...new Set(siteRows.map((r) => r.client_id).filter((x): x is string => !!x))];
  const clients = await inChunks(clientIds, async (ids) => rowsOf<ClientRow>(await svc(`clients?id=in.(${ids.join(',')})&select=id,email,contact_email,contact_id,portal_seen_at`)));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const contactIds = [...new Set(clients.map((c) => c.contact_id).filter((x): x is string => !!x))];
  const contacts = await inChunks(contactIds, async (ids) => rowsOf<ContactRow>(await svc(`contacts?id=in.(${ids.join(',')})&select=id,auth_user_id,created_at`)));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const unseen = [...new Set(clients.filter((c) => !c.portal_seen_at).map((c) => contactById.get(String(c.contact_id || ''))?.auth_user_id).filter((x): x is string => !!x))].slice(0, 50);
  const signedIn = new Map<string, string | null>();
  for (let i = 0; i < unseen.length; i += 8) {
    const part = unseen.slice(i, i + 8);
    const got = await Promise.all(part.map((u) => lastSignIn(u)));
    part.forEach((u, k) => signedIn.set(u, got[k]));
  }

  return sites.map((s) => {
    const c = clientById.get(String(clientOf.get(s.site_id) || ''));
    const contact = c?.contact_id ? contactById.get(c.contact_id) : undefined;
    const uid = contact?.auth_user_id || '';
    const seen = c?.portal_seen_at || (uid ? signedIn.get(uid) || null : null);
    const invited = contact?.created_at || null;
    return {
      site_id: s.site_id, name: s.name, email: String(c?.email || c?.contact_email || ''),
      state: portalStateOf({ hasLogin: !!uid, invitedAt: invited, seenAt: seen }, nowMs),
      invited_at: invited, seen_at: seen,
    };
  });
}

/** The client opened their portal: noted at most once an hour, after the answer has gone. */
export function stampPortalSeen(clientId: string, nowMs = Date.now()): Promise<unknown> {
  const now = new Date(nowMs).toISOString(), since = new Date(nowMs - SEEN_EVERY_MS).toISOString();
  return svc(`clients?id=eq.${encodeURIComponent(clientId)}&or=(portal_seen_at.is.null,portal_seen_at.lt.${encodeURIComponent(since)})`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ portal_seen_at: now }),
  }).catch(() => null);
}
