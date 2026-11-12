// ── Sales review batch seven (Nov 2026): item 33, fixed reports ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch7_test.mjs
//
// Five printable reports on Analytics, no builder (decision 7): revenue by month
// against last year, open deals by stage with days in stage, won and not a fit
// (by source, by reason), enquiries by page, overdue invoices.
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const NOW = '2026-11-08T15:00:00Z';

// ── 1. revenue ──
const rev = R.revenueByMonth([
  { amount_cents: 100000, paid_at: '2026-11-02T10:00:00Z' }, { amount_cents: 50000, paid_at: '2026-11-07T10:00:00Z' },
  { amount_cents: 70000, paid_at: '2025-11-20T10:00:00Z' },   // the same month a year before
  { amount_cents: 30000, paid_at: '2025-12-31T23:59:00Z' },   // December last year: in the window as "this year"'s first month
  { amount_cents: 999, paid_at: 'not a date' },
], NOW);
eq('twelve months, oldest first, ending this month', [rev.months.length, rev.months[0].month, rev.months[11].month], [12, '2025-12', '2026-11']);
eq('this month against the same month a year before', [rev.months[11].this_year, rev.months[11].last_year], [150000, 70000]);
eq('totals', [rev.total_this_year, rev.total_last_year], [180000, 70000]);
eq('a label people read', rev.months[11].label, 'Nov 2026');
eq('a January wraps the year', R.revenueByMonth([], '2027-01-15T00:00:00Z').months.map((m) => m.month).slice(-2), ['2026-12', '2027-01']);

// ── 2. pipeline by stage ──
const stages = R.dealsByStage([
  { id: 'd1', title: 'Acme website', stage: 'proposal', expected_value_cents: 50000, created_at: '2026-10-01T00:00:00Z' },
  { id: 'd2', title: 'Harbor Lane Bakery', stage: 'proposal', expected_value_cents: 150000, created_at: '2026-09-01T00:00:00Z' },
  { id: 'd3', title: 'Northside Dental', stage: 'lead', expected_value_cents: 0, created_at: '2026-11-07T00:00:00Z' },
  { id: 'd4', title: 'Won one', stage: 'won', expected_value_cents: 999 },
], { d1: '2026-11-01T15:00:00Z' }, NOW);
const prop = stages.rows.find((r) => r.stage === 'proposal');
eq('the four open stages, in order', stages.rows.map((r) => r.stage), ['lead', 'qualified', 'proposal', 'contract']);
eq('days in stage: from the move into it, else from when the deal was made', [prop.count, prop.value_cents, prop.avg_days, prop.longest_days, prop.longest_title], [2, 200000, 38, 68, 'Harbor Lane Bakery']);
// item 69: a row also carries its chance and expected cents (null when the caller passes no percents)
eq('an empty stage says so', stages.rows.find((r) => r.stage === 'qualified'), { stage: 'qualified', label: 'Qualified', count: 0, value_cents: 0, chance: null, expected_cents: null, avg_days: null, longest_days: null, longest_title: '' });
eq('closed deals are not in the pipeline report', [stages.count, stages.value_cents], [3, 200000]);

// ── 3. won and not a fit ──
const out = R.wonAndLost([
  { stage: 'won', converted_client_id: 'c1', source: 'website_form', expected_value_cents: 240000, updated_at: '2026-10-01T00:00:00Z' },
  { stage: 'won', converted_client_id: null, source: 'manual', expected_value_cents: 50000, updated_at: '2026-06-01T00:00:00Z' },
  { stage: 'won', source: 'manual', expected_value_cents: 1, updated_at: '2025-01-01T00:00:00Z' },          // more than a year ago
  { stage: 'lost', lost_reason: 'price', expected_value_cents: 30000, updated_at: '2026-09-01T00:00:00Z' },
  { stage: 'lost', lost_reason: '  PRICE ', expected_value_cents: 20000, updated_at: '2026-09-02T00:00:00Z' },
  { stage: 'lost', lost_reason: 'they moved away', expected_value_cents: 0, updated_at: '2026-09-03T00:00:00Z' },
  { stage: 'lost', lost_reason: '', expected_value_cents: 0, updated_at: '2026-09-04T00:00:00Z' },
  { stage: 'proposal', expected_value_cents: 5 },
], NOW);
eq('won and not a fit in the last year', [out.won, out.lost, out.win_rate_pct], [{ count: 2, value_cents: 290000 }, { count: 4, value_cents: 50000 }, 33]);
eq('won by where it came from', out.won_by_source, [{ label: 'Website enquiry', count: 1, value_cents: 240000 }, { label: 'Added by hand', count: 1, value_cents: 50000 }]);
eq('not a fit by reason: an offered reason matches whatever the case; no reason says so', out.lost_by_reason.map((g) => [g.label, g.count]), [['Price', 2], ['No reason given', 1], ['They moved away', 1]]);
eq('more than eight reasons fold the rest into one row', R.wonAndLost(Array.from({ length: 12 }, (_, i) => ({ stage: 'lost', lost_reason: 'Reason ' + i, updated_at: NOW })), NOW).lost_by_reason.slice(-1)[0], { label: 'Other reasons', count: 5, value_cents: 0 });
eq('an unknown source reads as words', [R.sourceLabel('trade_show'), R.sourceLabel(''), R.sourceLabel('import')], ['Trade show', 'Not recorded', 'Imported']);
eq('no closed deals → no win rate', R.wonAndLost([], NOW).win_rate_pct, null);
// Bold redesign (Analytics): days to close — the median of the six most recent wins, and the six before
{
  const day = 86400000, t0 = Date.parse(NOW);
  const win = (closedDaysAgo, tookDays, extra = {}) => ({ id: 'w' + closedDaysAgo, stage: 'won', converted_client_id: 'c', converted_at: new Date(t0 - closedDaysAgo * day).toISOString(), created_at: new Date(t0 - (closedDaysAgo + tookDays) * day).toISOString(), ...extra });
  const wins = [win(1, 10), win(2, 20), win(3, 30), win(4, 40), win(5, 50), win(6, 60), win(30, 5), win(40, 15), win(50, 99, { created_at: null })];
  const dc = R.wonAndLost(wins, NOW).days_to_close;
  eq('days to close: the median of the six latest wins (35), the six before (10), a deal with no start left out', dc, { median_days: 35, count: 6, prior_median_days: 10 });
  eq('days to close: an odd count takes the middle one', R.wonAndLost([win(1, 4), win(2, 9), win(3, 30)], NOW).days_to_close, { median_days: 9, count: 3, prior_median_days: null });
  eq('days to close: no wins → nothing to say', R.wonAndLost([], NOW).days_to_close, { median_days: null, count: 0, prior_median_days: null });
  eq('days to close: the close date comes from the move into Won when there is one', R.wonAndLost([win(1, 10, { id: 'x1' })], NOW, 365, { x1: new Date(t0 - 6 * day).toISOString() }).days_to_close.median_days, 5);
}

// ── 4. enquiries by page ──
const enq = R.enquiriesBySource([
  { id: 'e1', source_page: '/contact/', status: 'new', created_at: '2026-11-01T00:00:00Z' },
  { id: 'e2', source_page: 'https://example.com/contact?utm=x', status: 'converted', created_at: '2026-08-01T00:00:00Z' },
  { id: 'e3', source_page: '/', status: 'read', created_at: '2026-11-05T00:00:00Z' },
  { id: 'e4', source_page: '', status: 'read', created_at: '2026-10-01T00:00:00Z' },
  { id: 'e5', source_page: '/old', status: 'read', created_at: '2025-01-01T00:00:00Z' },   // over a year ago
], new Set(['e3']), NOW);
eq('grouped by page, the busiest first', enq.rows.map((r) => [r.source, r.last_30, r.last_365, r.became_deals]), [['/contact', 1, 2, 1], ['Home page', 1, 1, 1], ['Page not recorded', 0, 1, 0]]);
eq('totals', [enq.last_30, enq.last_365, enq.became_deals], [2, 4, 2]);

// ── 5. overdue ──
const od = R.overdueInvoices([
  { id: 'i1', title: 'Deposit', deal: 'Acme website', amount_cents: 120000, due_date: '2026-10-29', state: 'overdue' },
  { id: 'i2', title: 'Balance', deal: '', amount_cents: 50000, due_date: '2026-11-07', state: 'overdue' },
  { id: 'i3', title: 'Not yet', amount_cents: 1, due_date: '2026-12-01', state: 'upcoming' },
  { id: 'i4', title: 'On its way', amount_cents: 1, due_date: '2026-10-01', state: 'processing' },
], NOW);
eq('only overdue invoices, the longest overdue first', od.rows.map((r) => [r.id, r.days_overdue]), [['i1', 10], ['i2', 1]]);
eq('the total', od.total_cents, 170000);

// ── the route and the pages ──
const sales = read('supabase/functions/presence/routes/sales.ts');
ok('GET /sales/reports sits with the other /sales routes (the same gate)', /if \(route === '\/sales\/reports' && method === 'GET'\) return handleSalesReports\(req, site, principal, cors\);/.test(read('supabase/functions/presence/index.ts')));
// sales item 120 retired the count of six: every table the reports read is named with the
// signed-in site (sales_reads_harness_test.mjs drives the real reads and checks the same)
const reportReads = ((sales.match(/export async function handleSalesReports[\s\S]*?\n}\n/) || [''])[0].match(/`presence_[a-z_]+\?[^`]*`/g) || []);
ok('every read is the signed-in site\'s own', reportReads.length >= 6 && reportReads.every((p) => p.includes('site_id=eq.${site.id}')), JSON.stringify(reportReads.filter((p) => !p.includes('site_id=eq.${site.id}'))));
ok('a failed read marks its report unavailable, never a false zero', /revenue: failed\.has\('revenue'\) \? \{ unavailable: true \}/.test(sales) && /pipeline: dealsOff \? \{ unavailable: true \}/.test(sales) && /overdue: failed\.has\('overdue'\) \|\| !rcv \? \{ unavailable: true \}/.test(sales));
ok('overdue reads the same receivables as Who owes you', /loadReceivables\(site\)\.catch/.test(sales));
const an = read('analytics.html');
ok('both Analytics views carry the reports; never inside a client', /const reportsShell=\(\)=>scope\(\)\?'':/.test(an) && (an.match(/reportsShell\(\)/g) || []).length === 2);
ok('printing a report prints only that report', /body\[data-print="report"\] \*\{visibility:hidden!important;transition:none!important\}/.test(an) && /document\.body\.setAttribute\('data-print','report'\)/.test(an));
const pipe = read('pipeline.html');
const mirror = (pipe.match(/const LOST_REASONS=\[([^\]]+)\]/) || [])[1];
eq('the deal page offers the same reasons the report groups by', mirror && JSON.parse('[' + mirror.replace(/'/g, '"') + ']'), R.LOST_REASONS);
ok('the reason box suggests them and still takes your own words', /list:\{id:'lostReasons',options:LOST_REASONS\}/.test(pipe) && /el\.setAttribute\('list',fl\.list\.id\)/.test(pipe));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
