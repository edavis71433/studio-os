// ── Slice 8: Business dashboard — pure helpers + structural wiring ───────────
//   deno run --allow-read tests/presence/analytics_dashboard_test.mjs
// Pins the pure math behind GET /analytics/dashboard (period → range, weekly
// bucketing, source shares, invoice buckets, recent wins, oldest-age) and the
// structural facts: the route is registered in index.ts; the portfolio stays;
// the old plain-English home (GET /analytics) is gone, as no page has called it
// since this dashboard (bug hunt H10, Nov 10).
import {
  parseDashPeriod, parseDashDates, dashRange, priorMonthIso, weeklyBuckets, weeklyVisitors,
  sourceShares, invoiceBuckets, recentWins, oldestAgeDays, priorPeriodStart, priorPeriodVisitors, searchPagePath, DASH_WEEKS,
} from '../../supabase/functions/presence/lib/analytics_dashboard.ts';
import { aggregateVisits } from '../../supabase/functions/presence/lib/visits.ts';

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
  ok('range: a window that runs to today ends now', m.endMs === NOW && t.endMs === NOW && a.endMs === NOW);
}

// ── builder list item 175: the date presets and picked dates ──
{
  const iso = (ms) => new Date(ms).toISOString();
  // NOW is Friday Jul 17 2026, 15:30 UTC
  eq('preset: new values pass through', ['today', 'yesterday', 'this_week', 'last_week', 'last_month', 'this_year', 'last_year', 'custom'].map(parseDashPeriod), ['today', 'yesterday', 'this_week', 'last_week', 'last_month', 'this_year', 'last_year', 'custom']);
  const td = dashRange('today', NOW);
  eq('today: from midnight to now', [iso(td.startMs), td.endMs === NOW, td.days], ['2026-07-17T00:00:00.000Z', true, 1]);
  const yd = dashRange('yesterday', NOW);
  eq('yesterday: the whole day before, then it stops', [iso(yd.startMs), iso(yd.endMs), yd.days], ['2026-07-16T00:00:00.000Z', '2026-07-17T00:00:00.000Z', 1]);
  const tw = dashRange('this_week', NOW);
  eq('this week: from Sunday', iso(tw.startMs), '2026-07-12T00:00:00.000Z');
  const lw = dashRange('last_week', NOW);
  eq('last week: Sunday to Sunday, seven days', [iso(lw.startMs), iso(lw.endMs), lw.days], ['2026-07-05T00:00:00.000Z', '2026-07-12T00:00:00.000Z', 7]);
  const lm = dashRange('last_month', NOW);
  eq('last month: June, whole', [iso(lm.startMs), iso(lm.endMs), lm.days], ['2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 30]);
  eq('last month in January: the December before', [iso(dashRange('last_month', Date.parse('2026-01-09T12:00:00Z')).startMs)], ['2025-12-01T00:00:00.000Z']);
  const ty = dashRange('this_year', NOW);
  eq('this year: from January 1', [iso(ty.startMs), ty.endMs === NOW], ['2026-01-01T00:00:00.000Z', true]);
  const ly = dashRange('last_year', NOW);
  eq('last year: 2025, whole', [iso(ly.startMs), iso(ly.endMs), ly.days], ['2025-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 365]);
  // the caller's clock: Los Angeles in summer is 420 minutes behind UTC
  const la = { offsetMinutes: 420 };
  eq('clock: this month starts at midnight in Los Angeles', iso(dashRange('this_month', NOW, la).startMs), '2026-07-01T07:00:00.000Z');
  eq('clock: today in Los Angeles at 1:00 UTC is still yesterday there', iso(dashRange('today', Date.parse('2026-07-18T01:00:00Z'), la).startMs), '2026-07-17T07:00:00.000Z');
  eq('clock: last month in Los Angeles', [iso(dashRange('last_month', NOW, la).startMs), iso(dashRange('last_month', NOW, la).endMs)], ['2026-06-01T07:00:00.000Z', '2026-07-01T07:00:00.000Z']);
  eq('clock: without an offset, UTC as before', iso(dashRange('quarter', NOW).startMs), '2026-07-01T00:00:00.000Z');
  // picked dates
  eq('dates: a real window passes', parseDashDates('2026-06-03', '2026-06-17', NOW), { from: '2026-06-03', to: '2026-06-17' });
  eq('dates: one day is a window', parseDashDates('2026-07-17', '2026-07-17', NOW), { from: '2026-07-17', to: '2026-07-17' });
  ok('dates: the end before the start is refused', parseDashDates('2026-06-17', '2026-06-03', NOW) === null);
  ok('dates: an end after today is refused', parseDashDates('2026-07-01', '2026-07-18', NOW) === null);
  ok('dates: a day that does not exist is refused', parseDashDates('2026-02-30', '2026-03-02', NOW) === null);
  ok('dates: junk is refused', parseDashDates('yesterday', '2026-07-01', NOW) === null && parseDashDates(null, null, NOW) === null);
  ok('dates: more than ten years back is refused', parseDashDates('2015-01-01', '2016-01-01', NOW) === null);
  ok('dates: today on the caller’s clock (Los Angeles is still on the 17th at 1:00 UTC on the 18th)', parseDashDates('2026-07-17', '2026-07-18', Date.parse('2026-07-18T01:00:00Z'), 420) === null && !!parseDashDates('2026-07-17', '2026-07-18', Date.parse('2026-07-18T08:00:00Z'), 420));
  const cr = dashRange('custom', NOW, { from: '2026-06-03', to: '2026-06-17' });
  eq('custom: both days counted whole', [iso(cr.startMs), iso(cr.endMs), cr.days], ['2026-06-03T00:00:00.000Z', '2026-06-18T00:00:00.000Z', 15]);
  eq('custom ending today: stops at now, not at midnight', dashRange('custom', NOW, { from: '2026-07-10', to: '2026-07-17' }).endMs, NOW);
  eq('custom without dates: this month', iso(dashRange('custom', NOW).startMs), '2026-07-01T00:00:00.000Z');
  // the period before a window that ended: the same length, just before it
  ok('prior: last week compares with the week before it', priorPeriodStart('last_week', lw.startMs, lw.endMs) === lw.startMs - 7 * DAY);
  // a payment after a past window isn't counted in it
  const paidIn = invoiceBuckets([{ status: 'paid', amount_cents: 100, paid_at: '2026-06-10T00:00:00Z' }, { status: 'paid', amount_cents: 500, paid_at: '2026-07-02T00:00:00Z' }], '2026-07-17', lm.startMs, lm.endMs);
  eq('invoices: only what was paid inside last month', [paidIn.paid_cents, paidIn.paid_count], [100, 1]);
  eq('invoices: no end given, everything since the start (as before)', invoiceBuckets([{ status: 'paid', amount_cents: 500, paid_at: '2026-07-02T00:00:00Z' }], '2026-07-17', lm.startMs).paid_cents, 500);
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
  // hashless rows are SKIPPED — exactly like the headline visitors KPI (counting
  // each hashless row as its own visitor would inflate the weekly buckets
  // above the headline number)
  eq('visitors: hashless rows never count (matches the KPI, no inflation)',
    weeklyVisitors([{ ts: daysAgo(1), kind: 'pageview' }, { ts: daysAgo(1), kind: 'pageview', visitor_hash: '' }, { ts: daysAgo(1), kind: 'pageview', visitor_hash: 'a' }], NOW)[11], 1);
}

// ── exact calendar boundary (the route's pre-filter — B2) ──
// aggregateVisits rebuilds its window as nowMs − days·DAY; with dashRange's
// ceil'd days that bleeds up to ~24h of the prior period into "This month".
// The routes intersect the rows with the true startMs FIRST — pinned here.
{
  const { startMs, days } = dashRange('this_month', NOW);
  const mk = (ms, hash) => ({ ts: new Date(ms).toISOString(), kind: 'pageview', path: '/', ref_host: '', utm_source: '', device: '', country: '', visitor_hash: hash });
  const rows = [mk(startMs - 3600_000, 'before'), mk(startMs + 3600_000, 'after')];   // 1h either side of the month start
  const periodRows = rows.filter((v) => { const ms = Date.parse(String(v.ts || '')); return Number.isFinite(ms) && ms >= startMs; });
  eq('boundary: a visit 1h before the month start is excluded by the pre-filter', aggregateVisits(periodRows, NOW, days).visitors, 1);
  eq('boundary: without the pre-filter the ceil window over-counts (the filter is load-bearing)', aggregateVisits(rows, NOW, days).visitors, 2);
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
  ok('index.ts still serves the portfolio', idx.includes(`route === '/analytics/portfolio'`) && route.includes('export async function handleAnalyticsPortfolio'));
  ok('H10: the old home (GET /analytics, no caller) is gone, route and handler', !idx.includes(`route === '/analytics' &&`) && !/handleAnalyticsHome/.test(idx) && !route.includes('function handleAnalyticsHome'));
  ok('routes/analytics.ts exports handleAnalyticsDashboard', route.includes('export async function handleAnalyticsDashboard'));
  ok('dashboard reuses the pure lib (no forked math in the route)', /from '\.\.\/lib\/analytics_dashboard\.ts'/.test(route) && /summarizePipeline/.test(route));
  // builder list item 175: windows on the caller's clock, and a past window's reads stop at its end
  ok('item 175: the window is worked out on the caller’s clock, with the picked dates', /dashRange\(period, nowMs, \{ offsetMinutes: tzo, \.\.\.\(dates \|\| \{\}\) \}\)/.test(route) && /parseDashDates\(sp\.get\('from'\), sp\.get\('to'\), nowMs, tzo\)/.test(route));
  ok('item 175: picked dates that make no window are this month', /if \(period === 'custom' && !dates\) period = 'this_month';/.test(route));
  ok('item 175: all three visit reads stop at a past window’s end', (route.match(/\$\{until\}&kind=/g) || []).length === 3);
  ok('item 175: the answer says where the window starts and ends', /window: \{ start: new Date\(startMs\)\.toISOString\(\), end: new Date\(endMs\)\.toISOString\(\), closed/.test(route));
  ok('item 175: enquiries, invoices and the lines keep to the window', /count: subs\.filter\(\(s\) => inWindow\(/.test(route) && /invoiceBuckets\(invs, nowIso\.slice\(0, 10\), startMs, closed \? endMs : Infinity\)/.test(route) && /weeklyVisitors\(visits, endMs\)/.test(route));
}

// ── the period before this one + the per-page table ──
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 5, 12), start = Date.UTC(2026, 10, 1);
  ok('prior: the same stretch of time, immediately before', priorPeriodStart('this_month', start, now) === start - (now - start));
  ok('prior: all time has nothing before it', priorPeriodStart('all', now - 3650 * DAY, now) === null);
  const pStart = priorPeriodStart('this_month', start, now);
  const rows = [
    { ts: new Date(start - DAY).toISOString(), kind: 'pageview', visitor_hash: 'a' },
    { ts: new Date(start - DAY).toISOString(), kind: 'pageview', visitor_hash: 'a' },
    { ts: new Date(start - DAY).toISOString(), kind: 'pageview', visitor_hash: 'b' },
    { ts: new Date(start - DAY).toISOString(), kind: 'phone', visitor_hash: 'c' },
    { ts: new Date(start - DAY).toISOString(), kind: 'pageview' },
    { ts: new Date(start + DAY).toISOString(), kind: 'pageview', visitor_hash: 'd' },
    { ts: new Date(pStart - DAY).toISOString(), kind: 'pageview', visitor_hash: 'e' },
  ];
  ok('prior: distinct people, pageviews only, inside the window only', priorPeriodVisitors(rows, pStart, start) === 2);
  const agg = aggregateVisits([
    { ts: new Date(now - 60000).toISOString(), kind: 'pageview', path: '/menu/', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'a' },
    { ts: new Date(now - 60000).toISOString(), kind: 'pageview', path: '/menu/', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'a' },
    { ts: new Date(now - 60000).toISOString(), kind: 'pageview', path: '/menu/', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'b' },
    { ts: new Date(now - 60000).toISOString(), kind: 'pageview', path: '/', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'b' },
  ], now, 7);
  ok('pages: views AND people per page, busiest first', JSON.stringify(agg.pages) === JSON.stringify([{ path: '/menu/', views: 3, visitors: 2 }, { path: '/', views: 1, visitors: 1 }]));
  ok('pages: the short list stays as it was for older readers', JSON.stringify(agg.topPages[0]) === JSON.stringify({ path: '/menu/', views: 3 }));
  ok('search page path: a whole URL becomes the path the counter stores', searchPagePath('https://marlows.example/menu/?x=1') === '/menu/' && searchPagePath('https://marlows.example') === '/');
  ok('search page path: garbage is the home page, never a throw', searchPagePath('nonsense') === '/' && searchPagePath(null) === '/');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ANALYTICS DASHBOARD (slice 8): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
