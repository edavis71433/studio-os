// ── Builder list item 207: a site's visit numbers, counted in the database ───
// Analytics, the client portal, the Health page and Business insights each asked for up
// to 5,000 visit rows and counted them in code. One read returns 1,000 rows at most, so
// past 1,000 rows in the window the numbers were understated, the older weeks of the
// chart fell toward zero, and the "cut short" note (set at 5,000) could never show.
// presence_visit_stats (migration 0194) counts in the database, the way the Sites page
// has since item 180; this module asks it and hands back the shapes the pages already
// use (aggregateVisits' VisitAgg, the weekly line, the period before).
// Before 0194 the function isn't there: the rows are read a page at a time and counted by
// the same pure functions as before, right up to 50,000 rows and marked cut short past it.
import { svc, svcPages } from './db.ts';
import { aggregateVisits, aiAssistantOf, AI_SOURCE, sourceLabel, type VisitAgg, type VisitRow } from './visits.ts';
import { priorPeriodVisitors, weeklyVisitors } from './analytics_dashboard.ts';

export interface VisitStats {
  agg: VisitAgg;
  /** Visitors in [priorStartMs, startMs); null when no window before was asked for. */
  priorVisitors: number | null;
  /** Visitors per week, oldest first; null when no weeks were asked for. */
  weekly: number[] | null;
  /** True only on the row-by-row path, when even its 50,000 rows weren't all of them. */
  truncated: boolean;
}
export interface VisitWindow {
  startMs: number;
  nowMs: number;
  /** Where the window closes; left out, it runs to the newest row. */
  endMs?: number | null;
  priorStartMs?: number | null;
  weeks?: number;
  paths?: string[] | null;
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v as Array<Record<string, unknown>> : []);
const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** The database's answer in the shapes the pages use. Pure.
 *  Sources come back by referrer host and utm_source and are worded here (sourceLabel is
 *  the one home of that wording). Two hosts with the same wording (google.com and
 *  google.co.uk, say) are added together, so someone who came through both on one day
 *  counts once under each: the share is of visits, as it always was. */
export function statsFromDb(j: Record<string, unknown> | null | undefined, weeks = 0): VisitStats {
  const o = j || {};
  const visitors = num(o.visitors), pageviews = num(o.pageviews);
  const ev = (o.events && typeof o.events === 'object' ? o.events : {}) as Record<string, unknown>;
  const pages = list(o.pages).map((p) => ({ path: String(p.path || ''), views: num(p.views), visitors: num(p.visitors) }));
  const sources = new Map<string, number>(), ai = new Map<string, number>();
  for (const s of list(o.sources)) {
    const ref = String(s.ref_host || ''), utm = String(s.utm_source || ''), n = num(s.visits);
    const label = sourceLabel(ref, utm);
    sources.set(label, (sources.get(label) || 0) + n);
    if (label === AI_SOURCE) { const who = aiAssistantOf(ref, utm); if (who) ai.set(who, (ai.get(who) || 0) + n); }
  }
  const devices = list(o.devices).map((d) => ({ device: String(d.device || ''), n: num(d.views) })).sort((a, b) => b.n - a.n);
  const devTotal = devices.reduce((a, d) => a + d.n, 0) || 1;
  const weekly = weeks > 0 ? Array.from({ length: weeks }, (_, i) => num(Array.isArray(o.weekly) ? o.weekly[i] : 0)) : null;
  return {
    agg: {
      visitors, pageviews, priorVisitors: num(o.prior_visitors),
      topPages: pages.slice(0, 5).map(({ path, views }) => ({ path, views })),
      pages,
      topSources: top(sources, 5).map(([source, visits]) => ({ source, visits })),
      aiAssistants: top(ai, 5).map(([name, visits]) => ({ name, visits })),
      devices: devices.slice(0, 3).map((d) => ({ device: d.device, share: Math.round((d.n / devTotal) * 100) })),
      countries: list(o.countries).slice(0, 5).map((c) => ({ country: String(c.country || ''), visits: num(c.visits) })),
      events: { phone: num(ev.phone), email: num(ev.email), cta: num(ev.cta), download: num(ev.download) },
      hasData: pageviews > 0 || visitors > 0,
      truncated: false,
    },
    priorVisitors: o.prior_visitors === null || o.prior_visitors === undefined ? null : num(o.prior_visitors),
    weekly,
    truncated: false,
  };
}

/** The same numbers from the rows themselves: the path before migration 0194. Pure. */
export function statsFromRows(rows: VisitRow[], w: VisitWindow, truncated = false): VisitStats {
  const end = w.endMs ?? Infinity;
  const inWindow = rows.filter((v) => { const ms = Date.parse(String(v.ts || '')); return Number.isFinite(ms) && ms >= w.startMs && ms < end; });
  // the window's own rows only; the days argument then just has to reach back to its start
  const anchor = Number.isFinite(end) ? end : w.nowMs;
  const agg = aggregateVisits(inWindow, anchor, Math.max(1, Math.ceil((anchor - w.startMs) / 86_400_000) + 1));
  const prior = w.priorStartMs === null || w.priorStartMs === undefined ? null : priorPeriodVisitors(rows, w.priorStartMs, w.startMs);
  return {
    agg: { ...agg, priorVisitors: prior ?? 0, truncated },
    priorVisitors: truncated ? null : prior,
    weekly: w.weeks ? weeklyVisitors(rows, w.nowMs, w.weeks) : null,
    truncated,
  };
}

const firstMs = (w: VisitWindow): number => Math.min(w.startMs, w.priorStartMs ?? w.startMs, w.weeks ? w.nowMs - w.weeks * 7 * 86_400_000 : w.startMs);
const missing = (r: { status: number; text?: string }): boolean => r.status === 404 || /PGRST202|42883/.test(String(r.text || ''));

/** One site's visit numbers for a window. Null when the read failed: the page then says
 *  the numbers couldn't load, never a zero. */
export async function readVisitStats(siteId: string, w: VisitWindow): Promise<VisitStats | null> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const r = await svc('rpc/presence_visit_stats', {
    method: 'POST',
    body: JSON.stringify({
      p_site_id: siteId, p_start: iso(w.startMs), p_now: iso(w.nowMs),
      p_end: w.endMs === null || w.endMs === undefined ? null : iso(w.endMs),
      p_prior_start: w.priorStartMs === null || w.priorStartMs === undefined ? null : iso(w.priorStartMs),
      p_weeks: w.weeks || 0, p_paths: w.paths && w.paths.length ? w.paths : null,
    }),
  }).catch(() => null);
  if (r && r.ok && r.json && typeof r.json === 'object' && 'visitors' in r.json) return statsFromDb(r.json as Record<string, unknown>, w.weeks || 0);
  if (!r || !missing(r)) return null;
  // before 0194: every row, a page at a time
  const until = w.endMs === null || w.endMs === undefined ? '' : `&ts=lt.${iso(w.endMs)}`;
  const paths = w.paths && w.paths.length ? `&path=in.(${encodeURIComponent(w.paths.map((p) => `"${p.replace(/"/g, '')}"`).join(','))})` : '';
  const pages = await svcPages(`presence_visits?site_id=eq.${siteId}&ts=gte.${iso(firstMs(w))}${until}${paths}&kind=in.(pageview,phone,email,cta,download)&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash`, 'ts');
  return pages ? statsFromRows(pages.rows as VisitRow[], w, pages.truncated) : null;
}

/** Visitors per site since a moment, counted in the database (the studio's client list).
 *  Null when the read failed or the function isn't there yet. */
export async function readSitesVisitors(siteIds: string[], sinceIso: string): Promise<Record<string, number> | null> {
  if (!siteIds.length) return {};
  const r = await svc('rpc/presence_sites_visitors', { method: 'POST', body: JSON.stringify({ p_site_ids: siteIds, p_since: sinceIso }) }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) return null;
  return Object.fromEntries((r.json as Array<{ site_id: string; visitors: number }>).map((x) => [String(x.site_id), num(x.visitors)]));
}
