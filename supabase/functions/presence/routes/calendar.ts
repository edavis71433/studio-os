// ═══ YOUR CALENDAR IN GOOGLE CALENDAR (sales review item 46, Nov 2026) ═══════
//   GET    /calendar/link            — the private link (to those who may manage it)
//   POST   /calendar/link            — make a link; a new one turns the old one off (configure)
//   DELETE /calendar/link            — turn the link off (configure)
//   GET    /calendar/feed/<token>.ics — PUBLIC: the feed itself, read by Google
//                                       Calendar, Apple or Outlook; the token is the key
// The token lives in a reserved row on the site (lib/reserved_store.ts: deny-all,
// function-mediated). The feed carries bookings and dated tasks only, never an
// email, phone or note (lib/calendar_feed.ts says why).
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { svc } from '../lib/db.ts';
import { RESERVED_NAMES, readReservedJson, writeReservedJson } from '../lib/reserved_store.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { FEED_TOKEN_RE, newFeedToken, buildIcs, bookingEvent, taskEvent } from '../lib/calendar_feed.ts';
import { loadMyTasks } from './sales.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const APP = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const FEED_BASE = () => `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/presence/calendar/feed/`;
const feedUrl = (token: string) => `${FEED_BASE()}${token}.ics`;

/** Owners (no seat), studio staff and seats that hold 'configure' manage the link. */
function mayManage(principal: Principal): boolean {
  const m = (principal as any).member as { role?: string } | null | undefined;
  if (!m) return true;
  return !!m.role && isSiteRole(m.role) && siteCan(m.role, 'configure');
}

export async function handleCalendarLink(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const stored = (await readReservedJson(site.id, RESERVED_NAMES.calendarFeed)) as { token?: string | null; created_at?: string } | null;
  const token = stored && typeof stored.token === 'string' && FEED_TOKEN_RE.test(stored.token) ? stored.token : '';
  const manage = mayManage(principal);
  const answer = (t: string, at?: string) => json({ data: { on: !!t, url: manage && t ? feedUrl(t) : null, created_at: t ? (at || null) : null, can_manage: manage } }, 200, cors);
  if (req.method === 'GET') return answer(token, stored?.created_at);
  if (!manage) return json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
  const by = principal.email || principal.userId || 'system';
  if (req.method === 'POST') {
    const t = newFeedToken(), at = new Date().toISOString();
    const ok = await writeReservedJson(site.id, RESERVED_NAMES.calendarFeed, { token: t, user_id: principal.userId || null, created_at: at }, by);
    return ok ? answer(t, at) : json({ error: 'write_failed', message: 'Your calendar link didn’t save — please try again.' }, 502, cors);
  }
  if (req.method === 'DELETE') {
    const ok = await writeReservedJson(site.id, RESERVED_NAMES.calendarFeed, { token: null, user_id: null, created_at: null }, by);
    return ok ? answer('') : json({ error: 'write_failed', message: 'Your calendar link is still on — please try again.' }, 502, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

const plain = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function handleCalendarFeed(token: string): Promise<Response> {
  if (!FEED_TOKEN_RE.test(token)) return plain(404, 'This calendar link isn’t valid.');
  // the token is hex-only (checked above), so it is safe inside the filter
  const found = await svc(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.calendarFeed)}&deleted_at=is.null&body=like.*${token}*&select=site_id,body&limit=2`);
  if (!found.ok) return plain(503, 'The calendar is unavailable just now.');
  const row = rows(found).find((r) => { try { return JSON.parse(String(r.body || '{}')).token === token; } catch { return false; } });
  if (!row) return plain(404, 'This calendar link was turned off.');
  const siteId = String(row.site_id);
  const owner = (() => { try { return JSON.parse(String(row.body)).user_id || null; } catch { return null; } })();
  const now = Date.now(), nowIso = new Date(now).toISOString();
  const from = new Date(now - 30 * 86400000).toISOString(), to = new Date(now + 365 * 86400000).toISOString();
  const [appts, ident, tasks] = await Promise.all([
    svc(`presence_appointments?site_id=eq.${siteId}&status=in.(pending,confirmed)&slot_start=gte.${encodeURIComponent(from)}&slot_start=lte.${encodeURIComponent(to)}&select=id,type_name,slot_start,duration_min,customer_name,status&order=slot_start.asc&limit=500`),
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => ({ ok: false, json: [] } as any)),
    loadMyTasks(siteId, owner).catch(() => ({ all: [], partial: true })),
  ]);
  // a failed read answers 503, so the calendar keeps its last copy instead of emptying
  if (!appts.ok || tasks.partial) return plain(503, 'The calendar is unavailable just now.');
  const name = String(rows(ident)[0]?.business_name || '').trim();
  const events = [
    ...rows(appts).map((a) => bookingEvent(a, APP())),
    ...tasks.all.filter((t) => t.due).map((t) => taskEvent(t, APP())),
  ].filter(Boolean) as any[];
  const body = buildIcs(name ? `Studio OS — ${name}` : 'Studio OS', events, nowIso);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="studio-os.ics"', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' } });
}
