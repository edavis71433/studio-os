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
const SCHEDULED_RUNS_DAYS = 90; // presence_scheduled_runs — ops forensics window
const OPS_ERRORS_DAYS = 90;     // ops_errors — request-path error ledger
const RATE_LIMIT_DAYS = 1;      // rate_limit_state — windows are minutes; a day is generous
const EVIDENCE_DAYS = 180;      // presence_evidence_runs — readers only use the latest per site

export async function runRetentionSweep(now: Date = new Date()): Promise<Record<string, boolean | number | null>> {
  const out: Record<string, boolean | number | null> = {};
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const prune = async (key: string, path: string) => {
    try { const r = await svc(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); out[key] = r.ok; }
    catch { out[key] = false; }
  };

  await prune('visits', `presence_visits?ts=lt.${daysAgo(VISITS_DAYS)}`);

  // presence_search_terms older than 13 months (period is 'YYYY-MM')
  try {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SEARCH_TERM_MONTHS, 1));
    const cutoffPeriod = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const r = await svc(`presence_search_terms?period=lt.${cutoffPeriod}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    out.search_terms = r.ok;
  } catch { out.search_terms = false; }

  // Growth-forever tables (round-5 audit): the ops ledger, the request-error
  // ledger, and the per-minute rate-limit windows all accumulated unbounded.
  await prune('scheduled_runs', `presence_scheduled_runs?created_at=lt.${daysAgo(SCHEDULED_RUNS_DAYS)}&status=in.(done,failed,skipped)`);
  await prune('ops_errors', `ops_errors?created_at=lt.${daysAgo(OPS_ERRORS_DAYS)}`);
  await prune('rate_limit_state', `rate_limit_state?window_start=lt.${daysAgo(RATE_LIMIT_DAYS)}`);

  // Free-tool submissions: the privacy policy promises inquiry/tool data is
  // "cleared out periodically" — this is the mechanism behind that sentence.
  // A lead that hasn't turned into a conversation in a year has no basis left.
  await prune('audit_leads', `audit_leads?created_at=lt.${daysAgo(365)}`);

  // Evidence: needs "all but each site's latest run" — SQL, not REST (0091 RPC).
  // presence_evidence cascades from runs. A pre-0091 environment 404s → recorded
  // false, never throws.
  try {
    const r = await svc(`rpc/prune_evidence_runs`, { method: 'POST', body: JSON.stringify({ keep_days: EVIDENCE_DAYS }) });
    out.evidence_runs = r.ok ? Number(r.json ?? 0) : false;
  } catch { out.evidence_runs = false; }

  return out;
}
