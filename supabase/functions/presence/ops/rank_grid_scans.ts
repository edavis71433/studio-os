// ── The map rank grid's scans (builder list item 185, Nov 2026) ──────────────────
// One scan = one search ("plumber") over the client's grid of spots (lib/rank_grid.ts),
// kept as a row of presence_rank_grid_scans (migration 0209): the rank at each spot,
// the first three place ids there, who came up ahead most often, and what it cost at
// Google's prices. Nothing else from Google is kept.
//
// The monthly job scans each client the studio switched the grid on for, on the 1st:
//   • one client per run of the job (up to three searches, a few seconds each);
//   • the month is CLAIMED first (a compare-and-swap on the setting), so two ticks
//     never both scan; a client whose scan fails is tried again on later ticks, three
//     times a month at most;
//   • each run also clears the coordinates of scans older than 30 days (Google's rule).
// "Scan now" (routes/rank_grid.ts) uses the same scanAndKeep.
import { svc } from '../lib/db.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import {
  COORDS_KEEP_DAYS, afterGridFailure, gridDueNow, normalizeGridSetting, rivalsOf, scanCost, scanGrid, summarize,
  type GridPoint, type GridSetting,
} from '../lib/rank_grid.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
class NotDue extends Error {}
const SAVE = (siteId: string, change: (s: GridSetting) => GridSetting) =>
  updateReservedJson(siteId, RESERVED_NAMES.rankGrid, (cur) => change(normalizeGridSetting(cur)), 'rank-grid');

export const SCAN_COLS = 'id,phrase,kind,scanned_at,size,spacing_mi,place_id,center_lat,center_lng,ranks,tops,rivals,total,top3,top10,found,avg_rank,requests,cost_usd,created_by';

/** A scan's ranks as stored: row by row from the north-west corner; 1 to 20 is the
 *  rank, 0 is "not in the top 20", null is a spot Google didn't answer for. Pure. */
export function ranksOf(points: GridPoint[]): Array<number | null> {
  return points.map((p) => (p.err ? null : p.rank == null ? 0 : p.rank));
}

/** One scan, kept. The row, or why not: no key, Google's trouble, or no table yet. */
export async function scanAndKeep(siteId: string, s: GridSetting, phrase: string, kind: 'monthly' | 'now', who: string | null, nowIso = new Date().toISOString()): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; reason: string }> {
  const key = Deno.env.get('PLACES_KEY') || '';
  if (!key) return { ok: false, reason: 'places_not_configured' };
  if (!s.place) return { ok: false, reason: 'no_place' };
  const got = await scanGrid(key, { size: s.size, spacing: s.spacing, placeId: s.place.id }, phrase);
  if (!got.ok) return { ok: false, reason: got.reason };
  const sum = summarize(got.points);
  const requests = { ids_only: got.requests.ids_only, location: got.requests.location };
  const ins = await svc('presence_rank_grid_scans', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, phrase, kind, scanned_at: nowIso, size: s.size, spacing_mi: s.spacing, place_id: s.place.id,
      center_lat: got.center.lat, center_lng: got.center.lng,
      ranks: ranksOf(got.points), tops: got.points.map((p) => p.top),
      rivals: rivalsOf(got.points, s.place.id, 5),
      total: sum.total, top3: sum.top3, top10: sum.top10, found: sum.found, avg_rank: sum.avg,
      requests, cost_usd: scanCost(requests), created_by: who,
    }),
  }).catch(() => null);
  const row = ins && ins.ok ? rows(ins)[0] : null;
  if (!row) return { ok: false, reason: ins && (ins.status === 404 || /PGRST205|42P01/.test(JSON.stringify(ins.json || ''))) ? 'not_ready' : 'not_kept' };
  return { ok: true, row };
}

/** Google keeps coordinates to 30 days: clear the centre of every older scan. */
export async function clearOldCoordinates(nowIso: string): Promise<void> {
  const cutoff = new Date(Date.parse(nowIso) - COORDS_KEEP_DAYS * 86_400_000).toISOString();
  await svc(`presence_rank_grid_scans?scanned_at=lt.${encodeURIComponent(cutoff)}&center_lat=not.is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ center_lat: null, center_lng: null }),
  }).catch(() => null);
}

/** The job. Counts clients: scanned, failed, skipped. `skipped_no_key` when Google's key
 *  isn't set (nothing claimed, nothing failed); `not_ready` before migration 0209. */
export async function runRankGridScans(limit = 1, nowIso = new Date().toISOString()): Promise<{ scanned: number; failed: number; skipped: number; skipped_no_key?: true; not_ready?: true }> {
  const month = nowIso.slice(0, 7);
  await clearOldCoordinates(nowIso);
  const q = await svc(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.rankGrid)}&deleted_at=is.null&select=site_id,body&limit=500`).catch(() => null);
  let scanned = 0, failed = 0, skipped = 0;
  for (const r of rows(q)) {
    if (scanned + failed >= limit) break;
    let seen; try { seen = normalizeGridSetting(JSON.parse(r.body)); } catch { skipped++; continue; }
    if (!gridDueNow(seen, nowIso)) { skipped++; continue; }
    if (!Deno.env.get('PLACES_KEY')) return { scanned, failed, skipped: skipped + 1, skipped_no_key: true };
    // the table first: without it there is nowhere to keep a scan
    const ready = await svc('presence_rank_grid_scans?select=id&limit=1').catch(() => null);
    if (!ready || !ready.ok) return { scanned, failed, skipped, not_ready: true };
    let before: string | null = null;
    const claimed = await SAVE(r.site_id, (s) => {
      if (!gridDueNow(s, nowIso)) throw new NotDue();
      before = s.month;
      return { ...s, month };
    }).catch(() => null);
    if (!claimed) { skipped++; continue; }
    // a search already scanned this month (a try that failed halfway) isn't scanned twice
    const done = new Set(rows(await svc(`presence_rank_grid_scans?site_id=eq.${r.site_id}&kind=eq.monthly&scanned_at=gte.${month}-01T00:00:00Z&select=phrase&limit=20`).catch(() => null)).map((x) => String(x.phrase).toLowerCase()));
    let why: string | null = null;
    for (const phrase of claimed.phrases) {
      if (done.has(phrase.toLowerCase())) continue;
      const got = await scanAndKeep(r.site_id, claimed, phrase, 'monthly', null, nowIso);
      if (!got.ok) { why = got.reason; break; }
    }
    if (why) {
      failed++;
      await SAVE(r.site_id, (s) => afterGridFailure(s, month, before, why as string, nowIso)).catch(() => null);
    } else {
      scanned++;
      await SAVE(r.site_id, (s) => ({ ...s, tries: null, last_result: { month, status: 'scanned', reason: null, at: nowIso } })).catch(() => null);
    }
  }
  return { scanned, failed, skipped };
}

/** The setting as stored, for the routes. */
export async function readGridSetting(siteId: string): Promise<GridSetting> {
  return normalizeGridSetting(await readReservedJson(siteId, RESERVED_NAMES.rankGrid));
}
