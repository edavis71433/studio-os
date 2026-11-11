// ── Slice 8: Business dashboard — pure period math + bucketing ───────────────
// The Salesforce "Reports & Dashboards" treatment for analytics.html needs a
// handful of deterministic aggregation helpers: period → date range, weekly
// bucketing for the 12-week line charts, source share %, invoice status
// buckets, and the recent-wins pick. Everything here is PURE (no I/O, no env,
// no Date.now()) so tests/presence/analytics_dashboard_test.mjs can pin it.
// The stage ladder itself stays in lib/sales_lifecycle.ts (summarizePipeline)
// — this file never re-invents stage math.

const DAY = 86_400_000;
export const DASH_WEEKS = 12;                 // both line charts: weekly, last 12 weeks

// ── period → range ──
export type DashPeriod = 'this_month' | 'last_30' | 'quarter' | 'all';
export const DASH_PERIODS: DashPeriod[] = ['this_month', 'last_30', 'quarter', 'all'];
export const DASH_PERIOD_LABEL: Record<DashPeriod, string> = {
  this_month: 'This month', last_30: 'Last 30 days', quarter: 'This quarter', all: 'All time',
};
export function parseDashPeriod(raw: unknown): DashPeriod {
  return (DASH_PERIODS as string[]).includes(String(raw)) ? raw as DashPeriod : 'this_month';
}

/** The period's start (ms since epoch, UTC calendar boundaries) + its length in
 *  whole days (≥1 — a window of zero days would zero every aggregate on the 1st
 *  of the month). 'all' is honestly bounded at 10 years, not Infinity. */
export function dashRange(period: DashPeriod, nowMs: number): { startMs: number; days: number } {
  const d = new Date(nowMs);
  if (period === 'last_30') return { startMs: nowMs - 30 * DAY, days: 30 };
  if (period === 'all') return { startMs: nowMs - 3650 * DAY, days: 3650 };
  const startMs = period === 'quarter'
    ? Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return { startMs, days: Math.max(1, Math.ceil((nowMs - startMs) / DAY)) };
}

/** An ISO stamp INSIDE the previous calendar month — feed it to summarizePipeline
 *  to get last month's won totals with the same math. On the caller's clock when
 *  `offsetMinutes` is given (getTimezoneOffset's minutes behind UTC, ?tzo=), else UTC. */
export function priorMonthIso(nowMs: number, offsetMinutes: number | null = null): string {
  const off = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const d = new Date(nowMs - off * 60_000);   // the caller's wall clock, read with the UTC getters
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - DAY + off * 60_000).toISOString();
}

// ── weekly bucketing (the 12-week line charts) ──
/** Count timestamps per 7-day bucket ending at nowMs. Oldest bucket first,
 *  newest (the current week) last. Junk timestamps are ignored, never guessed. */
export function weeklyBuckets(timestamps: Array<string | null | undefined>, nowMs: number, weeks = DASH_WEEKS): number[] {
  const out = new Array(weeks).fill(0);
  for (const t of timestamps || []) {
    const ms = Date.parse(String(t || ''));
    if (Number.isNaN(ms)) continue;
    const back = nowMs - ms;
    if (back < 0 || back >= weeks * 7 * DAY) continue;
    out[weeks - 1 - Math.floor(back / (7 * DAY))]++;
  }
  return out;
}

/** Distinct visitors per 7-day bucket (pageview rows only — matches
 *  aggregateVisits' definition of a visitor). Oldest first. Rows WITHOUT a
 *  visitor_hash are skipped, exactly like the headline visitors KPI (counting
 *  each hashless row as its own "visitor" would inflate the weekly buckets
 *  above the headline number). */
export function weeklyVisitors(rows: Array<{ ts?: string; kind?: string; visitor_hash?: string }>, nowMs: number, weeks = DASH_WEEKS): number[] {
  const sets: Array<Set<string>> = Array.from({ length: weeks }, () => new Set());
  for (const r of rows || []) {
    if (!r || r.kind !== 'pageview' || !r.visitor_hash) continue;
    const ms = Date.parse(String(r.ts || ''));
    if (Number.isNaN(ms)) continue;
    const back = nowMs - ms;
    if (back < 0 || back >= weeks * 7 * DAY) continue;
    sets[weeks - 1 - Math.floor(back / (7 * DAY))].add(r.visitor_hash);
  }
  return sets.map((s) => s.size);
}

// ── source shares (the donut legend's "Google · 41%") ──
/** % of visitors per source. Denominator = total distinct visitors (a visitor
 *  arriving via two sources counts in both, so shares can top 100 in theory —
 *  each is clamped, never fabricated). Zero visitors → zero shares. */
export function sourceShares(
  sources: Array<{ source: string; visits: number }>,
  totalVisitors: number,
): Array<{ source: string; visits: number; share: number }> {
  const denom = Math.max(1, Number(totalVisitors) || 0);
  return (sources || []).map((s) => ({
    source: String(s.source || ''), visits: Number(s.visits) || 0,
    share: (Number(totalVisitors) || 0) > 0 ? Math.min(100, Math.round(((Number(s.visits) || 0) / denom) * 100)) : 0,
  }));
}

// ── the period before this one (the "up 12%" on the Visitors tile) ──
/** Where the comparison window starts: the same length of time, immediately before
 *  the current period, so the 5th of this month compares with the five days before
 *  it and never with a whole month. Null for 'all': nothing comes before it. */
export function priorPeriodStart(period: DashPeriod, startMs: number, nowMs: number): number | null {
  if (period === 'all') return null;
  return startMs - Math.max(0, nowMs - startMs);
}

/** Distinct visitors in [priorStartMs, startMs). The same counting as
 *  weeklyVisitors: pageviews only, and a row with no hash isn't a person. */
export function priorPeriodVisitors(rows: Array<{ ts?: string; kind?: string; visitor_hash?: string }>, priorStartMs: number, startMs: number): number {
  const seen = new Set<string>();
  for (const r of rows || []) {
    if (!r || r.kind !== 'pageview' || !r.visitor_hash) continue;
    const ms = Date.parse(String(r.ts || ''));
    if (Number.isFinite(ms) && ms >= priorStartMs && ms < startMs) seen.add(r.visitor_hash);
  }
  return seen.size;
}

/** A Search Console page URL as a path, matching what the visit counter stores. */
export function searchPagePath(url: unknown): string {
  const raw = String(url ?? '');
  try { return new URL(raw).pathname || '/'; } catch { return raw.startsWith('/') ? raw : '/'; }
}

// ── invoice buckets (the donut: paid / sent / overdue, total outstanding in the hole) ──
export interface InvoiceRowForDash { status?: string | null; amount_cents?: number | null; due_date?: string | null; paid_at?: string | null; }
export interface InvoiceBuckets {
  paid_cents: number; sent_cents: number; overdue_cents: number; outstanding_cents: number;
  paid_count: number; sent_count: number; overdue_count: number;
}
/** Bucket invoices for the donut. Paid = paid_at inside the period (period
 *  money, like the card's subtitle). Sent/overdue are POINT-IN-TIME (what's
 *  outstanding now): open + due_date before today = overdue, open otherwise =
 *  sent. Void rows are ignored. */
export function invoiceBuckets(invoices: InvoiceRowForDash[], todayIsoDate: string, periodStartMs: number): InvoiceBuckets {
  const out: InvoiceBuckets = { paid_cents: 0, sent_cents: 0, overdue_cents: 0, outstanding_cents: 0, paid_count: 0, sent_count: 0, overdue_count: 0 };
  for (const iv of invoices || []) {
    if (!iv || typeof iv !== 'object') continue;
    const amt = Math.max(0, Math.trunc(Number(iv.amount_cents) || 0));
    const status = String(iv.status || '');
    if (status === 'paid') {
      const t = Date.parse(String(iv.paid_at || ''));
      if (Number.isFinite(t) && t >= periodStartMs) { out.paid_cents += amt; out.paid_count++; }
    } else if (status === 'open') {
      const overdue = !!iv.due_date && String(iv.due_date) < todayIsoDate;
      if (overdue) { out.overdue_cents += amt; out.overdue_count++; }
      else { out.sent_cents += amt; out.sent_count++; }
    }
    // 'void' (and anything unknown) never counts anywhere
  }
  out.outstanding_cents = out.sent_cents + out.overdue_cents;
  return out;
}

// ── recent wins (last 90 days, newest first, ≤6) ──
export interface DealRowForWins { id?: string | null; title?: string | null; stage?: string | null; expected_value_cents?: number | null; converted_client_id?: string | null; converted_at?: string | null; updated_at?: string | null; }
/** Won = converted OR stage 'won' (mirrors lib/sales_lifecycle.ts summaryIsWon);
 *  closed-at = its newest move into Won when known (`closedAt`, lib/deal_closes.ts, bug
 *  hunt H1), else converted_at, else updated_at (its last move, which any edit moves). */
export function recentWins(deals: DealRowForWins[], nowMs: number, windowDays = 90, max = 6, closedAt: Record<string, string> = {}): Array<{ title: string; value_cents: number; closed_at: string }> {
  const start = nowMs - windowDays * DAY;
  const wins: Array<{ title: string; value_cents: number; closed_at: string; ms: number }> = [];
  for (const d of deals || []) {
    if (!d || typeof d !== 'object') continue;
    const won = !!d.converted_client_id || !!d.converted_at || d.stage === 'won' || d.stage === 'converted';
    if (!won) continue;
    const at = String(closedAt[String(d.id || '')] || d.converted_at || d.updated_at || '');
    const ms = Date.parse(at);
    if (!Number.isFinite(ms) || ms < start || ms > nowMs + DAY) continue;
    wins.push({ title: String(d.title || 'Deal'), value_cents: Math.max(0, Math.trunc(Number(d.expected_value_cents) || 0)), closed_at: at, ms });
  }
  return wins.sort((a, b) => b.ms - a.ms).slice(0, max).map(({ title, value_cents, closed_at }) => ({ title, value_cents, closed_at }));
}

/** Age of the oldest open item in whole days (0 = today). Null when none. */
export function oldestAgeDays(createdAts: Array<string | null | undefined>, nowMs: number): number | null {
  let oldest: number | null = null;
  for (const t of createdAts || []) {
    const ms = Date.parse(String(t || ''));
    if (Number.isNaN(ms)) continue;
    if (oldest === null || ms < oldest) oldest = ms;
  }
  return oldest === null ? null : Math.max(0, Math.floor((nowMs - oldest) / DAY));
}
