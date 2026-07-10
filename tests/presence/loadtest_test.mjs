// ── Load-test harness (Presence CMS Phase 1, M10) ────────────────────────────
//   deno run --allow-read tests/presence/loadtest_test.mjs
// The load-test framework's pure core must itself be trustworthy — proven here.
const H = await import('../../scripts/loadtest/harness.mjs');
const { runPool, percentiles, summarize, recommendCeiling, parseConfig } = H;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── runPool: honors the concurrency bound + processes everything in order ──
{
  let live = 0, peak = 0;
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const worker = async (x) => { live++; if (live > peak) peak = live; await tick(); live--; return x * 2; };
  const { results: r, maxInFlight, width } = await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], worker, 3);
  ok('pool: never exceeds the concurrency bound', peak <= 3 && maxInFlight <= 3);
  ok('pool: reaches the bound (peak === 3 with 10 items)', peak === 3 && width === 3);
  ok('pool: processes every item in order', r.length === 10 && r.every((x) => x.ok) && r[0].value === 2 && r[9].value === 20);
}
{
  // a failing worker is captured, never throws
  const { results: r } = await runPool([1, 2, 3], async (x) => { if (x === 2) throw new Error('boom'); return x; }, 2);
  ok('pool: a worker error is captured as ok:false (pool never rejects)', r[0].ok && !r[1].ok && r[2].ok && /boom/.test(r[1].error));
}
{
  // concurrency wider than the item count is clamped
  const { width } = await runPool([1, 2], async (x) => x, 16);
  ok('pool: width clamped to item count', width === 2);
}

// ── percentiles: nearest-rank, deterministic ──
{
  const s = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const p = percentiles(s, [50, 95, 99]);
  ok('pct: p50 of 1..100 = 50', p.p50 === 50);
  ok('pct: p95 of 1..100 = 95', p.p95 === 95);
  ok('pct: p99 of 1..100 = 99', p.p99 === 99);
  ok('pct: empty sample → zeros (no NaN)', percentiles([]).p95 === 0);
  ok('pct: single sample → that value at every percentile', percentiles([7]).p50 === 7 && percentiles([7]).p99 === 7);
}

// ── summarize ──
{
  const s = summarize([10, 20, 30, 40, 50]);
  ok('summary: count/min/max/mean correct', s.count === 5 && s.min === 10 && s.max === 50 && s.mean === 30);
  ok('summary: filters non-finite samples', summarize([10, NaN, 20, undefined, 30]).count === 3);
  ok('summary: empty → all zero (safe)', summarize([]).count === 0 && summarize([]).p95 === 0);
}

// ── recommendCeiling: highest level within SLO ──
{
  const levels = [
    { concurrency: 1, p95Ms: 2000, errorRate: 0 },
    { concurrency: 4, p95Ms: 6000, errorRate: 0 },
    { concurrency: 8, p95Ms: 12000, errorRate: 0 },
    { concurrency: 16, p95Ms: 22000, errorRate: 0.02 }, // over budget + errors
  ];
  const rec = recommendCeiling(levels, { p95BudgetMs: 15000, maxErrorRate: 0 });
  ok('ceiling: recommends the highest in-SLO level (8)', rec.recommended === 8 && rec.passing.includes(8) && !rec.passing.includes(16));
  const none = recommendCeiling([{ concurrency: 4, p95Ms: 30000, errorRate: 0.5 }], { p95BudgetMs: 15000 });
  ok('ceiling: when nothing passes → most conservative + flagged', none.recommended === 4 && /no level met/.test(none.reason));
  ok('ceiling: no levels → null + reason', recommendCeiling([]).recommended === null);
}

// ── parseConfig: documented defaults + full override ──
{
  const d = parseConfig({});
  ok('config: safe defaults (preview mode, non-destructive)', d.mode === 'preview' && d.concurrency === 8 && d.iterations === 40 && d.p95BudgetMs === 15000);
  ok('config: default level sweep', JSON.stringify(d.levels) === JSON.stringify([1, 2, 4, 8, 12, 16]));
  const o = parseConfig({ LOADTEST_MODE: 'publish', LOADTEST_CONCURRENCY: '12', LOADTEST_LEVELS: '2,4,8', LOADTEST_P95_BUDGET_MS: '9000' });
  ok('config: every knob overridable', o.mode === 'publish' && o.concurrency === 12 && JSON.stringify(o.levels) === JSON.stringify([2, 4, 8]) && o.p95BudgetMs === 9000);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ LOAD-TEST HARNESS (M10): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
