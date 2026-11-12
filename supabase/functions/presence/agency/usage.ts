// ── What each client uses (builder list item 210, Nov 2026) ─────────────────────────
// Review file 03, findings 1, 6 and 11: every publish and every restore of a client's site
// is its own deploy at Netlify, about 10 cents each (15 credits; the Pro plan's 5,000 a
// month cover about 330, the app's own updates included), and nobody was watching it. The
// studio now sees, per client, the publishes that went up this month and what they cost,
// the ones skipped because nothing had changed (item 208), the storage their files take,
// and their visits.
//
//   GET /agency/usage?month=YYYY-MM   (this month by default, UTC)
//     { data: { [site_id]: SiteUsage }, totals, days, month, month_label, visits_month,
//       visits_label, prior_label, plan, partial }
//
// A number that can't be known says why (`*_why`), never a zero. Reading needs `read`.
import { json } from '../../_shared/http.ts';
import { svc, svcPages } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import { monthsCompared } from './site_numbers.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

/** About what one deploy costs at Netlify, in cents (15 credits; $10 buys 1,500). */
export const PUBLISH_COST_CENTS = 10;
/** The deploys a month the Pro plan's credits cover (5,000 / 15), the app's own included. */
export const PLAN_PUBLISHES = 330;
/** This many deploys of one site inside an hour is worth a word to the studio. */
export const BURST_AT = 5;

export interface PublishRow { site_id: string; kind: string; status: string; netlify_deploy_id: string | null; unchanged?: boolean | null; created_at: string }
export interface SiteUsage {
  publishes: number | null; restores: number; skipped: number; cost_cents: number; publishes_why: 'hosted_elsewhere' | 'not_live' | null;
  burst: { count: number; day: string } | null;
  storage: { bytes: number; files: number } | null;
  visits: { value: number; prior: number } | null; visits_why: 'hosted_elsewhere' | 'not_live' | 'not_ready' | 'unavailable' | null;
}

/** The month asked for (YYYY-MM, else this one) and the moments it starts and ends. Pure. */
export function usageMonth(asked: string | null | undefined, nowIso: string): { month: string; startIso: string; endIso: string; label: string } {
  const now = new Date(nowIso);
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(asked || ''));
  const y = m ? Number(m[1]) : now.getUTCFullYear(), mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(y, mo, 1)), end = new Date(Date.UTC(y, mo + 1, 1));
  return { month: `${y}-${String(mo + 1).padStart(2, '0')}`, startIso: start.toISOString(), endIso: end.toISOString(), label: start.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }) };
}

/** The most deploys of one site inside any hour, and the day it began, when that's at
 *  least BURST_AT. Pure. */
export function burstOf(times: string[]): { count: number; day: string } | null {
  const t = times.map((x) => Date.parse(x)).filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0, at = 0;
  for (let i = 0, j = 0; j < t.length; j++) {
    while (t[j] - t[i] >= 3_600_000) i++;
    if (j - i + 1 > best) { best = j - i + 1; at = t[i]; }
  }
  return best >= BURST_AT ? { count: best, day: new Date(at).toISOString().slice(0, 10) } : null;
}

/** Each site's usage, the month's totals and the publishes on each day, from the batched
 *  reads. A deploy that reached the host is a paid one, a restore too, whatever came of it;
 *  a publish that sent nothing (item 208) is counted as skipped. Pure. */
export function foldUsage(i: {
  sites: Array<{ id: string; edition: string | null; status: string | null; last_published_at: string | null }>;
  publishes: PublishRow[] | null; storage: Map<string, { bytes: number; files: number }>;
  visits: Array<{ site_id: string; month: string; visitors: number }> | null; visitsReady: boolean; visitsMonth: string; priorMonth: string;
  startIso: string; endIso: string;
}): { data: Record<string, SiteUsage>; totals: { publishes: number; restores: number; skipped: number; cost_cents: number; bytes: number; files: number; visits: number }; days: Array<{ day: string; publishes: number }> } {
  const data: Record<string, SiteUsage> = {};
  const totals = { publishes: 0, restores: 0, skipped: 0, cost_cents: 0, bytes: 0, files: 0, visits: 0 };
  const perDay = new Map<string, number>();
  const bySite = new Map<string, PublishRow[]>();
  for (const p of i.publishes || []) bySite.set(p.site_id, [...(bySite.get(p.site_id) || []), p]);
  const visitsOf = (siteId: string, month: string) => (i.visits || []).filter((v) => v.site_id === siteId && v.month === month).reduce((n, v) => n + (Number(v.visitors) || 0), 0);
  for (const s of i.sites) {
    const elsewhere = s.edition === 'monitor';
    const live = s.status === 'live' || !!s.last_published_at;
    const rows = bySite.get(s.id) || [];
    const paid = rows.filter((p) => p.netlify_deploy_id && p.unchanged !== true);
    const skipped = rows.filter((p) => p.unchanged === true).length;
    const restores = paid.filter((p) => p.kind === 'restore').length;
    for (const p of paid) { const d = p.created_at.slice(0, 10); perDay.set(d, (perDay.get(d) || 0) + 1); }
    const storage = i.storage.get(s.id) || null;
    const visits = !elsewhere && live && i.visits ? { value: visitsOf(s.id, i.visitsMonth), prior: visitsOf(s.id, i.priorMonth) } : null;
    data[s.id] = {
      publishes: i.publishes ? paid.length : null, restores, skipped, cost_cents: paid.length * PUBLISH_COST_CENTS,
      publishes_why: elsewhere ? 'hosted_elsewhere' : (!live && !paid.length ? 'not_live' : null),
      burst: burstOf(paid.map((p) => p.created_at)),
      storage,
      visits, visits_why: elsewhere ? 'hosted_elsewhere' : !live ? 'not_live' : !i.visitsReady ? 'not_ready' : !i.visits ? 'unavailable' : null,
    };
    totals.publishes += paid.length; totals.restores += restores; totals.skipped += skipped; totals.cost_cents += paid.length * PUBLISH_COST_CENTS;
    if (storage) { totals.bytes += storage.bytes; totals.files += storage.files; }
    if (visits) totals.visits += visits.value;
  }
  const days: Array<{ day: string; publishes: number }> = [];
  for (let t = Date.parse(i.startIso); t < Date.parse(i.endIso); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    days.push({ day: d, publishes: perDay.get(d) || 0 });
  }
  return { data, totals, days };
}

const rowsOf = <T,>(q: unknown): T[] | null => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json)) ? (q as { json: T[] }).json : null;

/** GET /agency/usage, or null when the route is someone else's. */
export async function handleUsage(req: Request, route: string, method: string, member: AgencyMember, cors: Record<string, string>, nowIso = new Date().toISOString()): Promise<Response | null> {
  if (route !== '/agency/usage' || method !== 'GET') return null;
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'Your role can’t see this.' }, 403, cors);
  const um = usageMonth(new URL(req.url).searchParams.get('month'), nowIso);
  const vm = monthsCompared(nowIso);   // visits: the last whole month against the one before, as Sites shows them
  const head = { month: um.month, month_label: um.label, visits_month: vm.month, visits_label: vm.label, prior_label: vm.priorLabel, plan: { publishes: PLAN_PUBLISHES, cost_cents: PUBLISH_COST_CENTS } };
  const ids = (await agencySiteIds(member.agency_id)).filter((x) => UUID_RE.test(String(x)));
  if (!ids.length) return json({ data: {}, totals: null, days: [], ...head, partial: false }, 200, cors);
  const IN = `in.(${ids.join(',')})`;
  const soft = () => ({ ok: false, status: 0, json: null as unknown, text: '' });
  const pubPath = (cols: string) => `presence_publishes?site_id=${IN}&created_at=gte.${encodeURIComponent(um.startIso)}&created_at=lt.${encodeURIComponent(um.endIso)}&select=${cols}`;
  const [siteQ, pubs0, visQ, storage] = await Promise.all([
    svc(`presence_sites?id=${IN}&select=id,edition,status,last_published_at&limit=1000`).catch(soft),
    svcPages(pubPath('site_id,kind,status,netlify_deploy_id,unchanged,created_at'), 'created_at').catch(() => null),
    svc('rpc/presence_month_visitors', { method: 'POST', body: JSON.stringify({ p_site_ids: ids, p_since: vm.sinceIso }) }).catch(soft),
    storageOf(ids),
  ]);
  const sites = rowsOf<{ id: string; edition: string | null; status: string | null; last_published_at: string | null }>(siteQ);
  if (!sites) return json({ data: {}, totals: null, days: [], ...head, partial: true }, 200, cors);
  // before migration 0205 there is no `unchanged`: every deploy is a paid one, as it was
  const pubs = pubs0 ?? await svcPages(pubPath('site_id,kind,status,netlify_deploy_id,created_at'), 'created_at').catch(() => null);
  const visitsReady = !((visQ as { status?: number }).status === 404 || /PGRST202|42883/.test(String((visQ as { text?: string }).text || '')));
  const out = foldUsage({ sites, publishes: pubs ? pubs.rows as PublishRow[] : null, storage, visits: rowsOf<{ site_id: string; month: string; visitors: number }>(visQ), visitsReady, visitsMonth: vm.month, priorMonth: vm.prior, startIso: um.startIso, endIso: um.endIso });
  const partial = !pubs || !!pubs?.truncated || storage.size < sites.length || (visitsReady && !(visQ as { ok?: boolean }).ok);
  return json({ ...out, ...head, partial }, 200, cors);
}

/** Each site's live files and the bytes they take, counted by the database (0165), ten
 *  sites at a time. A site the database couldn't count is left out. */
async function storageOf(ids: string[]): Promise<Map<string, { bytes: number; files: number }>> {
  const out = new Map<string, { bytes: number; files: number }>();
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const r = await svc('rpc/presence_media_usage', { method: 'POST', body: JSON.stringify({ p_site: id }) }).catch(() => null);
      const row = r && r.ok && Array.isArray(r.json) ? r.json[0] : null;
      const files = Number(row?.files), bytes = Number(row?.bytes);
      if (row && Number.isFinite(files) && Number.isFinite(bytes)) out.set(id, { bytes, files });
    }));
  }
  return out;
}
