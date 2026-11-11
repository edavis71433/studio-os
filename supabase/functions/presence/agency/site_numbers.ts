// ── Every client in one table: the numbers (builder list items 129 and 180, Nov 2026) ──
// Semrush's home lists every project with the same numbers and the change from last
// month, drops in red. The Sites page does the same for three numbers, read on their
// own after the cards are up (the way /agency/site-tools is), so a slow or failed read
// never holds the page:
//
//   GET /agency/site-numbers   { data: { [site_id]: SiteNumbers }, month, prior_month, … }
//
//   • visitors: last whole month against the month before, from the visit counter,
//     counted in the database (presence_month_visitors, migration 0170). The page
//     calls them visits, as Analytics does (bug hunt H5): the visitor mark changes
//     each day, so these are daily visitors added up;
//   • Google clicks: the same two months from Search Console (`signals`, kept per
//     client, whole past months only: the current month never exists there);
//   • health: the studio's 0 to 100 number (lib/health_score.ts) today, against the
//     day nearest a month ago (presence_health_days, written by the evidence engine).
//     It is for studio pages only (Law 13: a client never sees a score).
// A number that can't be known says why (`*_why`), never a zero. Reading needs `read`.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

/** The two whole months compared: last month and the one before (UTC), and the first
 *  moment of the earlier one. Pure. */
export function monthsCompared(nowIso: string): { month: string; prior: string; label: string; priorLabel: string; sinceIso: string } {
  const now = new Date(nowIso);
  const at = (back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const m = at(1), p = at(2);
  return { month: key(m), prior: key(p), label: name(m), priorLabel: name(p), sinceIso: p.toISOString() };
}

/** The days a health reading is taken from: today or yesterday for now; the days
 *  around a month ago (26 to 34 back) for then, the one nearest 30 days winning. */
export function healthDays(nowIso: string): { current: string[]; then: string[] } {
  const base = Date.parse(nowIso.slice(0, 10) + 'T00:00:00Z');
  const day = (back: number) => new Date(base - back * 86_400_000).toISOString().slice(0, 10);
  return { current: [day(0), day(1)], then: [30, 29, 31, 28, 32, 27, 33, 26, 34].map(day) };
}

export interface SiteFacts { id: string; client_id: string | null; edition: string | null; status: string | null; last_published_at: string | null }
export interface VisitMonth { site_id: string; month: string; visitors: number }
export interface ClickMonth { client_id: string; period: string; value: number }
export interface HealthRow { site_id: string; day: string; score: number; critical: number; warning: number }
export type Why = 'no_counter' | 'counter_off' | 'not_live' | 'not_ready' | 'unavailable' | 'not_connected' | 'waiting' | 'not_checked' | null;
export interface SiteNumbers {
  visitors: { value: number; prior: number } | null; visitors_why: Why;
  search: { value: number; prior: number | null } | null; search_why: Why;
  health: { score: number; prior: number | null; to_look_at: number; day: string; prior_day: string | null } | null; health_why: Why;
}

/** Each site's three numbers from the batched reads. A read that failed is `null` and
 *  says `unavailable`; the visitors' function before migration 0170 says `not_ready`.
 *  Pure. */
export function foldSiteNumbers(i: {
  sites: SiteFacts[]; month: string; prior: string; nowIso: string;
  counterOff: Set<string>; connected: Set<string> | null;
  visits: VisitMonth[] | null; visitsReady: boolean;
  clicks: ClickMonth[] | null; health: HealthRow[] | null; healthReady?: boolean;
}): Record<string, SiteNumbers> {
  const out: Record<string, SiteNumbers> = {};
  const vBy = new Map<string, number>();
  for (const v of i.visits || []) vBy.set(`${v.site_id}|${v.month}`, Number(v.visitors) || 0);
  const cBy = new Map<string, number>();
  for (const c of i.clicks || []) cBy.set(`${c.client_id}|${c.period}`, Number(c.value) || 0);
  const days = healthDays(i.nowIso);
  const hBy = new Map<string, HealthRow>();
  for (const h of i.health || []) hBy.set(`${h.site_id}|${String(h.day).slice(0, 10)}`, h);
  for (const s of i.sites) {
    const live = s.edition !== 'monitor' && (s.status === 'live' || !!s.last_published_at);
    const n: SiteNumbers = { visitors: null, visitors_why: null, search: null, search_why: null, health: null, health_why: null };
    // visitors
    if (s.edition === 'monitor') n.visitors_why = 'no_counter';
    else if (!live) n.visitors_why = 'not_live';
    else if (i.counterOff.has(s.id)) n.visitors_why = 'counter_off';
    else if (!i.visitsReady) n.visitors_why = 'not_ready';
    else if (!i.visits) n.visitors_why = 'unavailable';
    else n.visitors = { value: vBy.get(`${s.id}|${i.month}`) || 0, prior: vBy.get(`${s.id}|${i.prior}`) || 0 };
    // Google clicks (kept per client)
    if (!i.connected) n.search_why = 'unavailable';
    else if (!i.connected.has(s.id)) n.search_why = 'not_connected';
    else if (!i.clicks) n.search_why = 'unavailable';
    else {
      const cid = String(s.client_id || '');
      const value = cBy.get(`${cid}|${i.month}`);
      const prior = cBy.get(`${cid}|${i.prior}`);
      if (value === undefined) n.search_why = 'waiting';
      else n.search = { value, prior: prior === undefined ? null : prior };
    }
    // health: today's (else yesterday's) against the day nearest a month ago
    if (i.healthReady === false) n.health_why = 'not_ready';
    else if (!i.health) n.health_why = 'unavailable';
    else {
      const now = days.current.map((d) => hBy.get(`${s.id}|${d}`)).find(Boolean);
      const then = days.then.map((d) => hBy.get(`${s.id}|${d}`)).find(Boolean);
      if (!now) n.health_why = 'not_checked';
      else n.health = { score: Number(now.score) || 0, prior: then ? Number(then.score) || 0 : null, to_look_at: (Number(now.critical) || 0) + (Number(now.warning) || 0), day: String(now.day).slice(0, 10), prior_day: then ? String(then.day).slice(0, 10) : null };
    }
    out[s.id] = n;
  }
  return out;
}

const rowsOf = <T,>(q: unknown): T[] | null => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json)) ? (q as { json: T[] }).json : null;

/** GET /agency/site-numbers, or null when the route is someone else's. */
export async function handleSiteNumbers(route: string, method: string, member: AgencyMember, cors: Record<string, string>, nowIso = new Date().toISOString()): Promise<Response | null> {
  if (route !== '/agency/site-numbers' || method !== 'GET') return null;
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'Your role can’t see this.' }, 403, cors);
  const m = monthsCompared(nowIso);
  const head = { month: m.month, prior_month: m.prior, month_label: m.label, prior_label: m.priorLabel };
  const ids = (await agencySiteIds(member.agency_id)).filter((x) => UUID_RE.test(String(x)));
  if (!ids.length) return json({ data: {}, ...head, partial: false }, 200, cors);
  const IN = `in.(${ids.join(',')})`;
  const soft = () => ({ ok: false, status: 0, json: null as unknown });
  const days = healthDays(nowIso);
  const [siteQ, setQ, connQ, visQ, healthQ] = await Promise.all([
    svc(`presence_sites?id=${IN}&select=id,client_id,edition,status,last_published_at&limit=1000`).catch(soft),
    svc(`presence_settings?site_id=${IN}&visit_counter=is.false&select=site_id&limit=1000`).catch(soft),
    svc(`presence_connections?site_id=${IN}&provider_key=eq.google_search_console&status=eq.connected&select=site_id&limit=1000`).catch(soft),
    svc('rpc/presence_month_visitors', { method: 'POST', body: JSON.stringify({ p_site_ids: ids, p_since: m.sinceIso }) }).catch(soft),
    svc(`presence_health_days?site_id=${IN}&day=in.(${[...days.current, ...days.then].join(',')})&select=site_id,day,score,critical,warning&limit=1000`).catch(soft),
  ]);
  const sites = rowsOf<SiteFacts>(siteQ);
  if (!sites) return json({ data: {}, ...head, partial: true }, 200, cors);
  const clientIds = [...new Set(sites.map((s) => String(s.client_id || '')).filter((x) => UUID_RE.test(x)))];
  const clickQ = clientIds.length
    ? await svc(`signals?client_id=in.(${clientIds.join(',')})&source=eq.gsc&metric=eq.search_clicks&period=in.(${m.month},${m.prior})&select=client_id,period,value&limit=1000`).catch(soft)
    : { ok: true, status: 200, json: [] as unknown };
  const conn = rowsOf<{ site_id: string }>(connQ);
  // the function and the table aren't there until 0170 runs: PostgREST says 404 (PGRST202, PGRST205)
  const missing = (q: { status?: number; text?: string }) => q.status === 404 || /PGRST20[25]|42P01|42883/.test(String(q.text || ''));
  const visitsReady = !missing(visQ as { status?: number; text?: string });
  const healthReady = !missing(healthQ as { status?: number; text?: string });
  const data = foldSiteNumbers({
    sites, month: m.month, prior: m.prior, nowIso,
    counterOff: new Set((rowsOf<{ site_id: string }>(setQ) || []).map((r) => r.site_id)),
    connected: conn ? new Set(conn.map((r) => r.site_id)) : null,
    visits: rowsOf<VisitMonth>(visQ), visitsReady,
    clicks: rowsOf<ClickMonth>(clickQ), health: rowsOf<HealthRow>(healthQ), healthReady,
  });
  const partial = [setQ, connQ, clickQ].some((q) => (q as { ok?: boolean }).ok === false) || (visitsReady && !(visQ as { ok?: boolean }).ok) || (healthReady && !(healthQ as { ok?: boolean }).ok);
  return json({ data, ...head, partial }, 200, cors);
}
