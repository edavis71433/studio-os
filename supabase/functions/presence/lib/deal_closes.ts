// ── When a deal closed (bug hunt H1, Nov 10 2026) ─────────────────────────────
// A closed deal's close is its newest move into the outcome it has now (Won or Not
// a fit), read from presence_deal_events. Analytics' Reports have read it that way
// since the Nov 8 final pass (F5). The dashboard's tiles on the same page used
// converted_at, else updated_at, which any edit moves: rename a deal marked Won by
// hand in September, log a call on it, and it was "won this month", with "↑ vs last
// month", a bigger Won bar and a "Won Nov 10" line under Recent wins. One reader
// for both now; the reads are handed in, so the shaping stays pure.
import { UUID_RE } from './uuid.ts';

/** Won or Not a fit, the way the reports count it; '' while the deal is open. Pure. */
export function dealOutcome(d: { converted_client_id?: unknown; stage?: unknown }): 'won' | 'lost' | '' {
  return (d && (d.converted_client_id || d.stage === 'won')) ? 'won' : (d && d.stage === 'lost' ? 'lost' : '');
}

/** The events read for one batch of closed deals (ids checked by the caller). Builder item
 *  411: no order or cap here; readCloseDates pages it (svcPages, oldest first) and folds
 *  newest first, where `limit=2000` quietly got 1,000 rows past that many events. */
export function closesPath(siteFilter: string, ids: string[]): string {
  return `presence_deal_events?${siteFilter}&kind=in.(stage_change,converted)&to_stage=in.(won,lost)&deal_id=in.(${ids.join(',')})&select=deal_id,to_stage,created_at`;
}

/** deal id → when it last moved into the outcome it has now. `events` newest first. Pure. */
export function foldCloses(outcome: Map<string, string>, events: Array<{ deal_id?: unknown; to_stage?: unknown; created_at?: unknown }>, into: Record<string, string> = {}): Record<string, string> {
  for (const e of events || []) {
    const k = String(e.deal_id || '');
    if (!into[k] && outcome.has(k) && String(e.to_stage) === outcome.get(k)) into[k] = String(e.created_at || '');
  }
  return into;
}

/** The close dates of every closed deal in `deals`, read 100 ids at a time, side by side.
 *  `read` answers a path with its rows, or null when the read failed; `partial` says one
 *  did (those deals keep the old fallback: converted_at, else updated_at). */
export async function readCloseDates(deals: Array<Record<string, unknown>>, siteFilter: string, read?: (path: string) => Promise<any[] | null>): Promise<{ closedAt: Record<string, string>; partial: boolean }> {
  // the default reader: every page, newest first (a caller may hand in its own for a test)
  const pagedRead = async (path: string): Promise<any[] | null> => { const { svcPages } = await import('./db.ts'); const r = await svcPages(path, 'created_at'); return r ? r.rows.reverse() : null; };
  read = read || pagedRead;
  const outcome = new Map<string, string>();
  for (const d of deals || []) { const o = d && dealOutcome(d); const id = String((d && d.id) || ''); if (o && UUID_RE.test(id)) outcome.set(id, o); }
  const ids = [...outcome.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const closedAt: Record<string, string> = {};
  let partial = false;
  for (const ev of await Promise.all(chunks.map((c) => read(closesPath(siteFilter, c)).catch(() => null)))) {
    if (!ev) { partial = true; continue; }
    foldCloses(outcome, ev, closedAt);
  }
  return { closedAt, partial };
}
