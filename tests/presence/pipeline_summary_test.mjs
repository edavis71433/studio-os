// ── Pipeline summary pure rollup (CRM "your numbers") ────────────────────────
//   deno run --allow-read tests/presence/pipeline_summary_test.mjs
// Proves the calm rollup math: open pipeline value/count, won-this-month (with
// calendar-month boundaries), win rate over a window, per-stage breakdown — and
// the two honesty rules: zeros read as zeros, and a win rate over no closed deals
// is `null` (never a fabricated 0%). Pure + deterministic (a fixed `now`).
const M = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const { summarizePipeline, OPEN_STAGES, WIN_RATE_WINDOW_DAYS } = M;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, a === b, a === b ? '' : `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const NOW = '2026-07-13T12:00:00.000Z';   // month = 2026-07; 90-day window opens ~2026-04-14

// ── empty / non-array input: honest zeros, no fabrication ──
{
  const s = summarizePipeline([], NOW);
  eq('empty: open count 0', s.open.count, 0);
  eq('empty: open value 0', s.open.value_cents, 0);
  eq('empty: won-month count 0', s.won_month.count, 0);
  eq('empty: win rate pct is NULL (not a fake 0%)', s.win_rate.pct, null);
  eq('empty: total 0', s.total, 0);
  eq('empty: by_stage still lists the 4 open stages', s.by_stage.length, 4);
  ok('empty: by_stage all zero', s.by_stage.every((b) => b.count === 0 && b.value_cents === 0));
  const bad = summarizePipeline(null, NOW);
  eq('non-array input → empty (0 total)', bad.total, 0);
  eq('non-array input → win rate null', bad.win_rate.pct, null);
}

// ── a realistic mixed book of deals ──
const DEALS = [
  // OPEN pipeline
  { stage: 'lead', expected_value_cents: 100000 },                 // $1,000
  { stage: 'lead', expected_value_cents: null },                   // no value → $0 (not fabricated)
  { stage: 'qualified', expected_value_cents: 250000 },            // $2,500
  { stage: 'proposal', expected_value_cents: 400000 },             // $4,000
  { stage: 'contract', expected_value_cents: 300000 },             // $3,000
  // WON this month (converted)
  { stage: 'won', converted_client_id: 'c1', converted_at: '2026-07-05T10:00:00Z', expected_value_cents: 500000 },
  { stage: 'won', converted_client_id: 'c2', converted_at: '2026-07-01T00:00:00Z', expected_value_cents: 200000 }, // 1st of month → counts
  // WON but LAST month (in the 90-day window for win rate, NOT this month)
  { stage: 'won', converted_client_id: 'c3', converted_at: '2026-06-20T10:00:00Z', expected_value_cents: 300000 },
  // LOST inside the window
  { stage: 'lost', updated_at: '2026-07-02T10:00:00Z', expected_value_cents: 150000 },
  // LOST outside the window (older than 90 days) → excluded from win rate
  { stage: 'lost', updated_at: '2026-01-01T10:00:00Z', expected_value_cents: 999999 },
];
const S = summarizePipeline(DEALS, NOW);

// open pipeline
eq('open: count = 5 active deals', S.open.count, 5);
eq('open: value = $10,500 (sum of active, null→0)', S.open.value_cents, 100000 + 0 + 250000 + 400000 + 300000);
ok('open: won & lost deals are NOT in open pipeline', S.open.count === 5 && S.total === 10);

// per-stage breakdown (open stages only, ladder order)
ok('by_stage: order is lead→qualified→proposal→contract', JSON.stringify(S.by_stage.map((b) => b.stage)) === JSON.stringify(OPEN_STAGES));
ok('by_stage: won/lost never appear', S.by_stage.every((b) => b.stage !== 'won' && b.stage !== 'lost'));
const byStage = Object.fromEntries(S.by_stage.map((b) => [b.stage, b]));
eq('by_stage: lead count 2', byStage.lead.count, 2);
eq('by_stage: lead value $1,000', byStage.lead.value_cents, 100000);
eq('by_stage: qualified $2,500 / 1', byStage.qualified.value_cents, 250000);
eq('by_stage: proposal $4,000 / 1', byStage.proposal.value_cents, 400000);
eq('by_stage: contract $3,000 / 1', byStage.contract.value_cents, 300000);
ok('by_stage: per-stage counts sum to the open count', S.by_stage.reduce((a, b) => a + b.count, 0) === S.open.count);
ok('by_stage: per-stage values sum to the open value', S.by_stage.reduce((a, b) => a + b.value_cents, 0) === S.open.value_cents);

// won this month (calendar month, UTC)
eq('won-month: count = 2 (Jul 5 + Jul 1)', S.won_month.count, 2);
eq('won-month: value = $7,000', S.won_month.value_cents, 500000 + 200000);
ok('won-month: LAST month (Jun 20) is excluded', S.won_month.count === 2 && S.won_month.value_cents === 700000);

// win rate over the 90-day window
eq('win-rate: won-in-window = 3 (Jul5, Jul1, Jun20)', S.win_rate.won, 3);
eq('win-rate: lost-in-window = 1 (Jul2; Jan1 excluded)', S.win_rate.lost, 1);
eq('win-rate: pct = 75 (3 of 4)', S.win_rate.pct, 75);
eq('win-rate: window is 90 days', S.win_rate.window_days, WIN_RATE_WINDOW_DAYS);
eq('total: 10 deals considered', S.total, 10);

// ── month-boundary precision: last instant of previous month must NOT count ──
{
  const s = summarizePipeline([
    { stage: 'won', converted_client_id: 'x', converted_at: '2026-06-30T23:59:59Z', expected_value_cents: 111111 },
    { stage: 'won', converted_client_id: 'y', converted_at: '2026-07-01T00:00:00Z', expected_value_cents: 222222 },
  ], NOW);
  eq('boundary: Jun 30 23:59:59Z NOT this month; Jul 1 00:00:00Z IS', s.won_month.count, 1);
  eq('boundary: only the July value counts', s.won_month.value_cents, 222222);
}

// ── won detection: a converted deal WITHOUT stage:'won' still counts as won ──
{
  const s = summarizePipeline([
    { converted_client_id: 'z', converted_at: '2026-07-08T10:00:00Z', expected_value_cents: 90000 }, // no stage field
    { stage: 'proposal', expected_value_cents: 60000 },
  ], NOW);
  eq('won-detect: converted_client_id → won, not open', s.open.count, 1);
  eq('won-detect: the converted deal is counted this month', s.won_month.count, 1);
  eq('won-detect: open value is only the proposal', s.open.value_cents, 60000);
}

// ── no-fabrication: only-open pipeline → win rate stays null (no closed deals) ──
{
  const s = summarizePipeline([
    { stage: 'lead', expected_value_cents: 100 },
    { stage: 'qualified', expected_value_cents: 200 },
  ], NOW);
  eq('no-fabrication: win rate null with zero closed deals', s.win_rate.pct, null);
  eq('no-fabrication: won-in-window 0', s.win_rate.won, 0);
  eq('no-fabrication: lost-in-window 0', s.win_rate.lost, 0);
}

// ── win rate CAN be a legitimate 0% (closed deals exist, none won) ──
{
  const s = summarizePipeline([
    { stage: 'lost', updated_at: '2026-07-01T10:00:00Z', expected_value_cents: 500 },
    { stage: 'lost', updated_at: '2026-07-02T10:00:00Z', expected_value_cents: 700 },
  ], NOW);
  eq('legit 0%: pct is 0 (not null) when closed deals exist but none won', s.win_rate.pct, 0);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PIPELINE SUMMARY (pure rollup): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
