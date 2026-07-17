// ── Slice 8: Business dashboard — pure helpers + structural wiring ───────────
//   deno run --allow-read tests/presence/analytics_dashboard_test.mjs
// Pins the pure math behind GET /analytics/dashboard (period → range, weekly
// bucketing, source shares, invoice buckets, recent wins, oldest-age) and the
// structural facts: the route is registered in index.ts AND every pre-slice-8
// /analytics route is still there (deploy-order tolerance: the new page must
// not orphan anything an old analytics.html called).
import {
  parseDashPeriod, dashRange, priorMonthIso, weeklyBuckets, weeklyVisitors,
  sourceShares, invoiceBuckets, recentWins, oldestAgeDays, DASH_WEEKS,
} from '../../supabase/functions/presence/lib/analytics_dashboard.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? '' : `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-17T15:30:00.000Z');   // month starts Jul 1; quarter starts Jul 1
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();

// ── parseDashPeriod ──
eq('period: valid values pass through', parseDashPeriod('quarter'), 'quarter');
eq('period: junk falls back to this_month', parseDashPeriod('evil'), 'this_month');
eq('period: missing falls back to this_month', parseDashPeriod(null), 'this_month');

// ── dashRange ──
{
  const m = dashRange('this_month', NOW);
  eq('range this_month: starts at the 1st (UTC)', new Date(m.startMs).toISOString(), '2026-07-01T00:00:00.000Z');
  eq('range this_month: days elapsed in month', m.days, 17);
  const q = dashRange('quarter', NOW);
  eq('range quarter: starts at the quarter boundary', new Date(q.startMs).toISOString(), '2026-07-01T00:00:00.000Z');
  const q2 = dashRange('quarter', Date.parse('2026-05-10T00:00:00Z'));
  eq('range quarter: Q2 starts Apr 1', new Date(q2.startMs).toISOString(), '2026-04-01T00:00:00.000Z');
  const t = dashRange('last_30', NOW);
  eq('range last_30: exactly 30 days back', t.startMs, NOW - 30 * DAY);
  eq('range last_30: 30 days wide', t.days, 30);
  const a = dashRange('all', NOW);
  ok('range all: bounded (10y), not Infinity', a.days === 3650 && Number.isFinite(a.startMs));
  const first = dashRange('this_month', Date.parse('2026-07-01T00:00:00Z'));
  ok('range: 1st of the month still ≥1 day (never a zero window)', first.days >= 1);
}

// ── priorMonthIso ──
eq('priorMonthIso: lands inside the previous calendar month', priorMonthIso(NOW).slice(0, 7), '2026-06');
eq('priorMonthIso: January → previous December', priorMonthIso(Date.parse('2026-01-05T00:00:00Z')).slice(0, 7), '2025-12');

// ── weeklyBuckets ──
{
  const w = weeklyBuckets([daysAgo(1), daysAgo(2), daysAgo(8), daysAgo(83)], NOW);
  eq('weekly: 12 buckets', w.length, DASH_WEEKS);
  eq('weekly: current week last', w[11], 2);
  eq('weekly: prior week', w[10], 1);
  eq('weekly: oldest bucket first', w[0], 1);
  eq('weekly: outside the window ignored', weeklyBuckets([daysAgo(85)], NOW).reduce((a, b) => a + b, 0), 0);
  eq('weekly: junk timestamps ignored, never guessed', weeklyBuckets([null, '', 'nope'], NOW).reduce((a, b) => a + b, 0), 0);
}

// ── weeklyVisitors (distinct per bucket, pageviews only) ──
{
  const rows = [
    { ts: daysAgo(1), kind: 'pageview', visitor_hash: 'a' },
    { ts: daysAgo(2), kind: 'pageview', visitor_hash: 'a' },   // same visitor, same week → 1
    { ts: daysAgo(3), kind: 'pageview', visitor_hash: 'b' },
    { ts: daysAgo(1), kind: 'phone', visitor_hash: 'c' },      // action ≠ visitor
    { ts: daysAgo(9), kind: 'pageview', visitor_hash: 'a' },   // prior week → counts again there
  ];
  const w = weeklyVisitors(rows, NOW);
  eq('visitors: distinct within a week', w[11], 2);
  eq('visitors: a returning visitor counts per week', w[10], 1);
  eq('visitors: non-pageview kinds never count', weeklyVisitors([{ ts: daysAgo(1), kind: 'cta', visitor_hash: 'z' }], NOW)[11], 0);
}

// ── sourceShares ──
{
  const s = sourceShares([{ source: 'Google', visits: 88 }, { source: 'Direct', visits: 64 }], 214);
  eq('shares: rounded % of visitors', s[0].share, 41);
  eq('shares: keeps the visit count', s[1].visits, 64);
  eq('shares: zero visitors → zero shares (no divide-by-zero fabrication)', sourceShares([{ source: 'X', visits: 5 }], 0)[0].share, 0);
  eq('shares: clamped at 100', sourceShares([{ source: 'X', visits: 50 }], 10)[0].share, 100);
}

// ── invoiceBuckets ──
{
  const today = '2026-07-17';
  const start = Date.parse('2026-07-01T00:00:00Z');
  const iv = invoiceBuckets([
    { status: 'paid', amount_cents: 270000, paid_at: '2026-07-10T00:00:00Z' },
    { status: 'paid', amount_cents: 99000, paid_at: '2026-06-02T00:00:00Z' },  // paid BEFORE the period → not period money
    { status: 'open', amount_cents: 90000, due_date: '2026-08-01' },           // sent, not yet due
    { status: 'open', amount_cents: 25000, due_date: '2026-07-01' },           // past due → overdue
    { status: 'void', amount_cents: 500000 },                                  // void never counts
  ], today, start);
  eq('invoices: paid = paid within the period', iv.paid_cents, 270000);
  eq('invoices: sent = open, not yet due', iv.sent_cents, 90000);
  eq('invoices: overdue = open past due', iv.overdue_cents, 25000);
  eq('invoices: outstanding = sent + overdue (the donut hole)', iv.outstanding_cents, 115000);
  eq('invoices: counts follow the same buckets', [iv.paid_count, iv.sent_count, iv.overdue_count], [1, 1, 1]);
  eq('invoices: empty input → honest zeros', invoiceBuckets([], today, start).outstanding_cents, 0);
}

// ── recentWins ──
{
  const wins = recentWins([
    { title: 'Patio rebuild', stage: 'won', expected_value_cents: 240000, converted_at: daysAgo(5) },
    { title: 'Converted only', stage: 'contract', expected_value_cents: 100000, converted_client_id: 'c1', converted_at: daysAgo(20) },
    { title: 'Old win', stage: 'won', expected_value_cents: 50000, converted_at: daysAgo(120) },   // outside 90d
    { title: 'Still open', stage: 'proposal', expected_value_cents: 999999 },
    { title: 'Won, no converted_at', stage: 'won', expected_value_cents: 60000, updated_at: daysAgo(10) },
  ], NOW);
  eq('wins: only won/converted inside 90 days', wins.length, 3);
  eq('wins: newest first', wins[0].title, 'Patio rebuild');
  eq('wins: falls back to updated_at for the close date', wins[1].title, 'Won, no converted_at');
  const many = recentWins(Array.from({ length: 10 }, (_, i) => ({ title: 'W' + i, stage: 'won', converted_at: daysAgo(i + 1) })), NOW);
  eq('wins: capped at 6', many.length, 6);
}

// ── oldestAgeDays ──
eq('oldest: whole days back', oldestAgeDays([daysAgo(2), daysAgo(1)], NOW), 2);
eq('oldest: today → 0', oldestAgeDays([daysAgo(0)], NOW), 0);
eq('oldest: none → null (never a fake 0)', oldestAgeDays([], NOW), null);

// ── structural pins: the route is registered AND the old surface survives ──
{
  const idx = await Deno.readTextFile(new URL('../../supabase/functions/presence/index.ts', import.meta.url));
  const route = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/analytics.ts', import.meta.url));
  ok('index.ts registers GET /analytics/dashboard', /route === '\/analytics\/dashboard' && method === 'GET'.*handleAnalyticsDashboard/.test(idx));
  ok('index.ts imports handleAnalyticsDashboard from routes/analytics.ts', /handleAnalyticsDashboard[^]*from '\.\/routes\/analytics\.ts'/.test(idx));
  for (const old of ['/analytics', '/analytics/website', '/analytics/customers', '/analytics/search', '/analytics/portfolio']) {
    ok(`index.ts still serves the pre-slice-8 route ${old}`, idx.includes(`route === '${old}'`));
  }
  ok('routes/analytics.ts still exports the old handlers (deploy-order tolerance)',
    ['handleAnalyticsHome', 'handleAnalyticsWebsite', 'handleAnalyticsCustomers', 'handleAnalyticsSearch', 'handleAnalyticsPortfolio'].every((h) => route.includes(`export async function ${h}`)));
  ok('routes/analytics.ts exports handleAnalyticsDashboard', route.includes('export async function handleAnalyticsDashboard'));
  ok('dashboard reuses the pure lib (no forked math in the route)', /from '\.\.\/lib\/analytics_dashboard\.ts'/.test(route) && /summarizePipeline/.test(route));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ANALYTICS DASHBOARD (slice 8): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
