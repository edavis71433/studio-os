// ── Load-test harness (Presence CMS Phase 1, M10) ────────────────────────────
// The REUSABLE, DETERMINISTIC core of the load-test framework: a bounded worker
// pool, latency statistics, and a deploy-ceiling recommendation. It is pure (no
// network, no clock beyond the timings you feed it) so it is unit-testable and
// its output is reproducible. The thin CLI (run.mjs) wires it to a real target;
// this module is what makes the measurement trustworthy.

/** Run `worker(item, i)` over `items` with at most `concurrency` in flight.
 *  Returns results in input order + the observed peak concurrency (so a caller
 *  can PROVE the pool honored its bound). Never rejects — a worker error is
 *  captured as `{ ok:false }`. */
export async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(concurrency | 0 || 1, items.length || 1));
  let next = 0, inFlight = 0, maxInFlight = 0;
  async function pump() {
    while (next < items.length) {
      const i = next++;
      inFlight++; if (inFlight > maxInFlight) maxInFlight = inFlight;
      try { results[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (e) { results[i] = { ok: false, error: String((e && e.message) || e) }; }
      inFlight--;
    }
  }
  await Promise.all(Array.from({ length: width }, () => pump()));
  return { results, maxInFlight, width };
}

/** Nearest-rank percentiles over a numeric sample. Deterministic. */
export function percentiles(samples, ps = [50, 95, 99]) {
  const out = {};
  if (!samples || !samples.length) { for (const p of ps) out[`p${p}`] = 0; return out; }
  const s = [...samples].sort((a, b) => a - b);
  for (const p of ps) {
    const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
    out[`p${p}`] = s[idx];
  }
  return out;
}

/** Full latency summary over an array of millisecond samples. Pure. */
export function summarize(samplesMs) {
  const s = (samplesMs || []).filter((n) => Number.isFinite(n));
  if (!s.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const sum = s.reduce((a, b) => a + b, 0);
  const pcts = percentiles(s, [50, 95, 99]);
  return {
    count: s.length,
    min: Math.min(...s),
    max: Math.max(...s),
    mean: Math.round((sum / s.length) * 100) / 100,
    p50: pcts.p50, p95: pcts.p95, p99: pcts.p99,
  };
}

/** From a sweep of concurrency levels — each `{ concurrency, p95Ms, errorRate }`
 *  — recommend the deploy ceiling (MAX_CONCURRENT_DEPLOYS): the HIGHEST level
 *  that stays within the SLO (zero errors AND p95 ≤ budget). Falls back to the
 *  lowest tested level if none pass, and flags that. Pure + deterministic. */
export function recommendCeiling(levels, opts = {}) {
  const budgetMs = Number.isFinite(opts.p95BudgetMs) ? opts.p95BudgetMs : 15_000;
  const maxErrorRate = Number.isFinite(opts.maxErrorRate) ? opts.maxErrorRate : 0;
  const sorted = [...(levels || [])].sort((a, b) => a.concurrency - b.concurrency);
  if (!sorted.length) return { recommended: null, reason: 'no levels measured', passing: [] };
  const passing = sorted.filter((l) => (l.errorRate ?? 0) <= maxErrorRate && (l.p95Ms ?? Infinity) <= budgetMs);
  if (passing.length) {
    const best = passing[passing.length - 1];
    return { recommended: best.concurrency, reason: `highest level within SLO (p95 ≤ ${budgetMs}ms, errors ≤ ${maxErrorRate})`, passing: passing.map((l) => l.concurrency), budgetMs };
  }
  return { recommended: sorted[0].concurrency, reason: `no level met the SLO — recommend the most conservative (${sorted[0].concurrency}) and investigate`, passing: [], budgetMs };
}

/** Parse framework config from an env-like object. Documented defaults; every
 *  knob overridable → "configurable". Pure. */
export function parseConfig(env = {}) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    target: env.LOADTEST_TARGET || '',                 // function base URL, e.g. https://<ref>.functions.supabase.co/presence
    mode: (env.LOADTEST_MODE || 'preview'),            // 'preview' (safe, render-only) | 'publish' (staging only)
    concurrency: num(env.LOADTEST_CONCURRENCY, 8),
    iterations: num(env.LOADTEST_ITERATIONS, 40),
    levels: (env.LOADTEST_LEVELS || '1,2,4,8,12,16').split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0),
    p95BudgetMs: num(env.LOADTEST_P95_BUDGET_MS, 15_000),
    site: env.LOADTEST_SITE || '',
    anon: env.LOADTEST_ANON || '',
    jwt: env.LOADTEST_JWT || '',
    secret: env.LOADTEST_SECRET || '',
  };
}
