// ── Builder list item 47 (Nov 2026): a busy day of visitors, said once ────────
// Once a day, for every live hosted site: if yesterday's page views were at least
// three times a usual day (the average of the seven days before it, with at least
// three of them having any) and at least twenty, raise one `traffic_spike` notice,
// an UPDATE on the ONE notice model (period day:<date>, so it can never repeat).
// The studio's bell names the site; the owner's bell says "your website". No push:
// good news can wait for the next look. The counting is pure and tested.
// Nov 2026 review (server findings 5, 8, 9): the words say "page views", which is
// what is counted; the week is read in full pages (a cut-off or failed read says
// nothing); and the check runs only in the first hour of the UTC day, since
// "yesterday" doesn't change during the day (it used to re-read a week 96 times).
import { svc, svcPages } from '../lib/db.ts';
import { raiseNotice } from '../lib/notice.ts';
import { siteOrigin } from '../lib/site.ts';

export const SPIKE_MIN_VIEWS = 20;
export const SPIKE_RATIO = 3;
export const SPIKE_MIN_DAYS = 3;
const VISITS_PAGE = 1000, VISITS_PAGES = 50;   // every page or none; past 50,000 page views in eight days the check says nothing
export const SPIKE_RUN_HOURS = 1;               // runs only in the first hour of the UTC day (the */15 tick gives it four tries)

export interface VisitRow { site_id: string; ts: string }
export interface Spike { site_id: string; yesterday: number; usual: number; ratio: number }

/** The UTC day of an instant, as YYYY-MM-DD. */
export const dayOf = (iso: string): string => String(iso).slice(0, 10);
/** `n` days before a YYYY-MM-DD day. */
export function daysBefore(day: string, n: number): string {
  const t = Date.parse(day + 'T00:00:00Z');
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

/** Pure: which sites had a spike on `day`, from page-view rows covering the eight
 *  days ending with it. A site with fewer than three earlier days of any visits has
 *  no "usual" yet, so it never spikes. */
export function spikeSites(rows: VisitRow[], day: string): Spike[] {
  const before = new Set(Array.from({ length: 7 }, (_, i) => daysBefore(day, i + 1)));
  const perSite = new Map<string, { today: number; days: Map<string, number> }>();
  for (const r of rows) {
    const d = dayOf(r.ts);
    const s = perSite.get(r.site_id) || { today: 0, days: new Map() };
    if (d === day) s.today++;
    else if (before.has(d)) s.days.set(d, (s.days.get(d) || 0) + 1);
    perSite.set(r.site_id, s);
  }
  const out: Spike[] = [];
  for (const [site_id, s] of perSite) {
    if (s.today < SPIKE_MIN_VIEWS || s.days.size < SPIKE_MIN_DAYS) continue;
    const usual = [...s.days.values()].reduce((a, b) => a + b, 0) / 7;   // a quiet day counts as zero
    if (usual <= 0 || s.today < usual * SPIKE_RATIO) continue;
    out.push({ site_id, yesterday: s.today, usual: Math.round(usual * 10) / 10, ratio: Math.round(s.today / usual) });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** The words for one spike, for the owner's bell (the studio's bell adds the site's name). */
export function spikeWords(sp: Spike, host: string | null): { headline: string; body: string } {
  return {
    headline: `A busy day: ${sp.yesterday} page views yesterday`,
    body: `That’s about ${sp.ratio} times a usual day${host ? ` for ${host}` : ''}. See where they came from on Analytics.`,
  };
}

/** The daily job. Yesterday in UTC; sites that are live and hosted here. */
export async function runTrafficSpikes(limit = 200, nowIso = new Date().toISOString()): Promise<{ sites: number; spikes: number; truncated: boolean; not_due?: boolean; read_failed?: boolean }> {
  if (new Date(nowIso).getUTCHours() >= SPIKE_RUN_HOURS) return { sites: 0, spikes: 0, truncated: false, not_due: true };
  const day = daysBefore(dayOf(nowIso), 1);
  const sitesQ = await svc(`presence_sites?status=eq.live&edition=neq.monitor&client_id=not.is.null&select=id,client_id,custom_domain,netlify_site_id&order=last_published_at.desc.nullslast&limit=${limit}`);
  const sites = (Array.isArray(sitesQ.json) ? sitesQ.json : []) as Array<{ id: string; client_id: string; custom_domain: string | null; netlify_site_id: string | null }>;
  if (!sites.length) return { sites: 0, spikes: 0, truncated: false };
  const from = daysBefore(day, 7) + 'T00:00:00Z', to = day + 'T23:59:59.999Z';
  const ids = sites.map((s) => s.id).join(',');
  const vq = await svcPages(`presence_visits?site_id=in.(${ids})&kind=eq.pageview&ts=gte.${from}&ts=lte.${to}&select=site_id,ts`, 'ts', VISITS_PAGE, VISITS_PAGES);
  // a failed page, or past the bound, means some days are missing, so "usual" would
  // read wrong and ordinary days could look busy: say nothing rather than something wrong
  if (!vq) return { sites: sites.length, spikes: 0, truncated: false, read_failed: true };
  if (vq.truncated) return { sites: sites.length, spikes: 0, truncated: true };
  const rows = vq.rows as VisitRow[];
  let spikes = 0;
  for (const sp of spikeSites(rows, day)) {
    const site = sites.find((s) => s.id === sp.site_id); if (!site) continue;
    const host = siteOrigin(site).replace(/^https:\/\//, '') || null;   // the site's own domain, else its hosted name (lib/site.ts; never netlify_site_id)
    const w = spikeWords(sp, host);
    const fresh = await raiseNotice({ siteId: site.id, clientId: site.client_id, kind: 'traffic_spike', period: `day:${day}`, headline: w.headline, body: w.body, push: false });
    if (fresh) spikes++;
  }
  return { sites: sites.length, spikes, truncated: false };
}
