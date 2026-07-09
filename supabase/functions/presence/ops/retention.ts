// ── Data retention sweep — keep the analytics stores bounded ─────────────────
// Privacy-first + cost-conscious: raw first-party visits and GSC term detail are
// only useful recent; we prune the long tail on the ops cron. Aggregate rollups
// (signals) and business records are NOT touched here — only the high-volume,
// recency-only detail tables. Idempotent: a DELETE with a date floor removes only
// what's already past retention. Fail-safe: errors are swallowed (never block the
// cycle). Retention windows match the comments on the table definitions.
import { svc } from '../lib/db.ts';

const VISITS_DAYS = 180;        // presence_visits — 6 months of first-party traffic
const SEARCH_TERM_MONTHS = 13;  // presence_search_terms — 13 months (year-over-year headroom)

export async function runRetentionSweep(now: Date = new Date()): Promise<{ visits_pruned: number | null; search_terms_pruned: number | null }> {
  const out = { visits_pruned: null as number | null, search_terms_pruned: null as number | null };

  // presence_visits older than 180 days
  try {
    const cutoff = new Date(now.getTime() - VISITS_DAYS * 86_400_000).toISOString();
    const r = await svc(`presence_visits?ts=lt.${cutoff}`, { method: 'DELETE', headers: { Prefer: 'return=minimal,count=exact' } });
    out.visits_pruned = countFrom(r);
  } catch { /* non-fatal */ }

  // presence_search_terms older than 13 months (period is 'YYYY-MM')
  try {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SEARCH_TERM_MONTHS, 1));
    const cutoffPeriod = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const r = await svc(`presence_search_terms?period=lt.${cutoffPeriod}`, { method: 'DELETE', headers: { Prefer: 'return=minimal,count=exact' } });
    out.search_terms_pruned = countFrom(r);
  } catch { /* non-fatal */ }

  return out;
}

// PostgREST returns the affected count in the Content-Range header when count=exact.
function countFrom(r: { text?: string; json?: unknown }): number | null {
  // svc() doesn't surface headers; fall back to null (the sweep still ran). The
  // count is informational only — the DELETE itself is the point.
  return null;
}
