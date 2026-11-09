// ── Fixed reports (sales review item 33, Nov 2026) ───────────────────────────
// Five reports on Analytics, each a plain table that prints: revenue by month
// against last year, open deals by stage with days in stage, won and not a fit
// (won by where the deal came from, not a fit by the reason given), enquiries by
// the page they came from, and overdue invoices. No report builder (decision 7).
// Pure: the route reads the rows, these shape them. All dates are UTC.
import { foundViaLabel } from './found_via.ts';

const DAY = 86400000;
const n = (v: unknown) => Number(v) || 0;
const ymd = (iso: unknown) => String(iso || '').slice(0, 10);
const ym = (iso: unknown) => String(iso || '').slice(0, 7);
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ── 1. revenue by month: the last twelve months against the same months a year before ──
export interface RevenueMonth { month: string; label: string; this_year: number; last_year: number }
export function revenueByMonth(paid: Array<{ amount_cents?: unknown; paid_at?: unknown }>, nowIso: string) {
  const byMonth = new Map<string, number>();
  for (const p of paid || []) { const k = ym(p?.paid_at); if (/^\d{4}-\d{2}$/.test(k)) byMonth.set(k, (byMonth.get(k) || 0) + n(p.amount_cents)); }
  const end = ym(nowIso);
  const months: RevenueMonth[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = shiftMonth(end, -i);
    months.push({ month: k, label: `${MONTH[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`, this_year: byMonth.get(k) || 0, last_year: byMonth.get(shiftMonth(k, -12)) || 0 });
  }
  return { months, total_this_year: months.reduce((a, m) => a + m.this_year, 0), total_last_year: months.reduce((a, m) => a + m.last_year, 0) };
}

// ── 2. open deals by stage, with how long they have sat there ──
export const OPEN_STAGES = ['lead', 'qualified', 'proposal', 'contract'];
export const STAGE_LABEL: Record<string, string> = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
/** lastMoveInto: deal id → when it last moved INTO its current stage (a stage_change event); else it has been there since it was made. */
export function dealsByStage(deals: Array<{ id?: unknown; title?: unknown; stage?: unknown; expected_value_cents?: unknown; created_at?: unknown }>, lastMoveInto: Record<string, string>, nowIso: string, labels: Record<string, string> = STAGE_LABEL, chances: Record<string, number> | null = null) {
  const now = Date.parse(nowIso);
  const rows = OPEN_STAGES.map((stage) => {
    const ds = (deals || []).filter((d) => d && d.id && String(d.stage) === stage && !(d as any).converted_client_id);
    const days = ds.map((d) => {
      const since = Date.parse(lastMoveInto[String(d.id)] || String(d.created_at || ''));
      return { d, days: Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / DAY)) : 0 };
    });
    const longest = days.slice().sort((a, b) => b.days - a.days)[0];
    // item 69: with the studio's percents, each stage also says what it is expected to bring in
    const chance = chances ? (chances[stage] ?? null) : null;
    return {
      stage, label: labels[stage] || STAGE_LABEL[stage], count: ds.length, value_cents: ds.reduce((a, d) => a + n(d.expected_value_cents), 0),
      chance, expected_cents: chance === null ? null : ds.reduce((a, d) => a + Math.round(n(d.expected_value_cents) * chance / 100), 0),
      avg_days: days.length ? Math.round(days.reduce((a, x) => a + x.days, 0) / days.length) : null,
      longest_days: longest ? longest.days : null, longest_title: longest ? String(longest.d.title || 'A deal') : '',
    };
  });
  return { rows, count: rows.reduce((a, r) => a + r.count, 0), value_cents: rows.reduce((a, r) => a + r.value_cents, 0),
    expected_cents: chances ? rows.reduce((a, r) => a + (r.expected_cents || 0), 0) : null };
}

// ── 3. won and not a fit over the last year ──
export const LOST_REASONS = ['Price', 'Timing', 'Went with someone else', 'No reply', 'Outside what we do'];
// Final pass (Nov 8, batch C): "Not a fit for us" read like the stage itself. Deals already
// marked with the old words count with the new ones.
const REASON_ALIAS: Record<string, string> = { 'not a fit for us': 'Outside what we do' };
export const SOURCE_LABEL: Record<string, string> = { website_form: 'Website enquiry', manual: 'Added by hand', import: 'Imported', referral: 'Referral', email: 'Email' };
export const sourceLabel = (s: unknown) => { const k = String(s || '').trim(); return SOURCE_LABEL[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : 'Not recorded'); };
/** One spelling per reason: the five offered reasons match whatever the case; anything else groups by its own words. */
export function reasonLabel(r: unknown): string {
  const t = String(r || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'No reason given';
  const hit = LOST_REASONS.find((x) => x.toLowerCase() === t.toLowerCase()) || REASON_ALIAS[t.toLowerCase()];
  return hit || (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
}
function groupBy<T>(list: T[], key: (x: T) => string, value: (x: T) => number, cap: number, otherLabel: string) {
  const m = new Map<string, { label: string; count: number; value_cents: number }>();
  for (const x of list) {
    const k = key(x), lk = k.toLowerCase();
    const g = m.get(lk) || { label: k, count: 0, value_cents: 0 };
    g.count++; g.value_cents += value(x); m.set(lk, g);
  }
  const all = [...m.values()].sort((a, b) => b.count - a.count || b.value_cents - a.value_cents || a.label.localeCompare(b.label));
  if (all.length <= cap) return all;
  const rest = all.slice(cap - 1);
  return [...all.slice(0, cap - 1), { label: otherLabel, count: rest.reduce((a, g) => a + g.count, 0), value_cents: rest.reduce((a, g) => a + g.value_cents, 0) }];
}
/** `closedAt` maps a deal id to when it moved into Won or Not a fit (its newest
 *  stage_change / converted event into its current outcome). Final pass (Nov 8,
 *  F5): the window used updated_at, which any later edit moves — logging a call
 *  on a deal won two years ago pulled it into "the last 12 months" and into the
 *  win rate. Without an event, a converted deal's converted_at is the close;
 *  only a deal with neither falls back to updated_at. */
export function wonAndLost(deals: Array<Record<string, unknown>>, nowIso: string, windowDays = 365, closedAt: Record<string, string> = {}) {
  const since = Date.parse(nowIso) - windowDays * DAY;
  const isWon = (d: Record<string, unknown>) => !!d.converted_client_id || d.stage === 'won';
  const closeTime = (d: Record<string, unknown>) => Date.parse(String(closedAt[String(d.id)] || (isWon(d) && d.converted_at) || d.updated_at || ''));
  const inWindow = (d: Record<string, unknown>) => { const t = closeTime(d); return Number.isFinite(t) && t >= since; };
  const won = (deals || []).filter((d) => d && isWon(d) && inWindow(d));
  const lost = (deals || []).filter((d) => d && !isWon(d) && d.stage === 'lost' && inWindow(d));
  const v = (d: Record<string, unknown>) => n(d.expected_value_cents);
  // Bold redesign (Analytics, Nov 2026): "Days to close" — the median days from a
  // won deal's start to its win, over the six most recent wins, and the six before
  // them so the page can say faster or slower. A deal with no start date is left
  // out, never counted as zero days.
  const spans = won.map((d) => ({ t: closeTime(d), start: Date.parse(String(d.created_at || '')) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.start) && x.t >= x.start)
    .sort((a, b) => b.t - a.t)
    .map((x) => (x.t - x.start) / DAY);
  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  };
  return {
    window_days: windowDays,
    won: { count: won.length, value_cents: won.reduce((a, d) => a + v(d), 0) },
    lost: { count: lost.length, value_cents: lost.reduce((a, d) => a + v(d), 0) },
    win_rate_pct: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    won_by_source: groupBy(won, (d) => sourceLabel(d.source), v, 8, 'Other sources'),
    lost_by_reason: groupBy(lost, (d) => reasonLabel(d.lost_reason), v, 8, 'Other reasons'),
    // item 69: "How did they find you?" next to where the deal came from
    won_by_found_via: groupBy(won, (d) => foundViaLabel(d.found_via), v, 8, 'Other'),
    days_to_close: { median_days: median(spans.slice(0, 6)), count: Math.min(6, spans.length), prior_median_days: spans.length > 6 ? median(spans.slice(6, 12)) : null },
  };
}

// ── 4. enquiries by the page they came from ──
export function pageLabel(p: unknown): string {
  const t = String(p || '').trim();
  if (!t) return 'Page not recorded';
  let path = t;
  try { if (/^https?:\/\//i.test(t)) path = new URL(t).pathname; } catch { /* keep it as written */ }
  path = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return path === '/' ? 'Home page' : path.slice(0, 120);
}
export function enquiriesBySource(subs: Array<{ id?: unknown; source_page?: unknown; status?: unknown; created_at?: unknown }>, becameDeal: Set<string>, nowIso: string) {
  const now = Date.parse(nowIso);
  const m = new Map<string, { source: string; last_30: number; last_365: number; became_deals: number }>();
  for (const s of subs || []) {
    const t = Date.parse(String(s?.created_at || ''));
    if (!Number.isFinite(t) || now - t > 365 * DAY) continue;
    const k = pageLabel(s.source_page);
    const g = m.get(k) || { source: k, last_30: 0, last_365: 0, became_deals: 0 };
    g.last_365++; if (now - t <= 30 * DAY) g.last_30++;
    if (s.status === 'converted' || becameDeal.has(String(s.id))) g.became_deals++;
    m.set(k, g);
  }
  const rows = [...m.values()].sort((a, b) => b.last_365 - a.last_365 || b.last_30 - a.last_30 || a.source.localeCompare(b.source));
  return { rows, last_30: rows.reduce((a, r) => a + r.last_30, 0), last_365: rows.reduce((a, r) => a + r.last_365, 0), became_deals: rows.reduce((a, r) => a + r.became_deals, 0) };
}

// ── 5. overdue invoices (the receivables read's own overdue state) ──
export function overdueInvoices(items: Array<{ id?: unknown; title?: unknown; deal?: unknown; amount_cents?: unknown; due_date?: unknown; state?: unknown }>, nowIso: string) {
  const today = Date.parse(ymd(nowIso) + 'T00:00:00Z');
  const rows = (items || []).filter((i) => i && i.state === 'overdue').map((i) => {
    const due = Date.parse(ymd(i.due_date) + 'T00:00:00Z');
    return { id: String(i.id || ''), title: String(i.title || 'Invoice'), deal: String(i.deal || ''), amount_cents: n(i.amount_cents), due_date: ymd(i.due_date), days_overdue: Number.isFinite(due) ? Math.max(0, Math.round((today - due) / DAY)) : null };
  }).sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0) || b.amount_cents - a.amount_cents);
  return { rows, total_cents: rows.reduce((a, r) => a + r.amount_cents, 0) };
}
