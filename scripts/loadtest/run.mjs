// ── Load-test runner (Presence CMS Phase 1, M10) ─────────────────────────────
// Drives the hardened CMS at a range of concurrency levels and reports latency
// percentiles + a recommended MAX_CONCURRENT_DEPLOYS. Built on the pure, tested
// harness. Deterministic given the same target/site/config.
//
//   Deno:  deno run --allow-net --allow-env scripts/loadtest/run.mjs
//   Node:  node scripts/loadtest/run.mjs   (Node 18+ for global fetch)
//
// Config (env): LOADTEST_TARGET (required) · LOADTEST_MODE=preview|publish
//   LOADTEST_SITE · LOADTEST_ANON · LOADTEST_JWT · LOADTEST_SECRET
//   LOADTEST_LEVELS=1,2,4,8,12,16 · LOADTEST_ITERATIONS=40 · LOADTEST_P95_BUDGET_MS=15000
//
// MODES:
//   preview  — SAFE, non-destructive. GET /preview (serializeDraft + renderSnapshot,
//              the CPU-heavy path). Measures render latency at concurrency. Use
//              this everywhere, including prod, without side effects.
//   publish  — STAGING ONLY. POST /publish. Measures the FULL pipeline incl. the
//              Netlify deploy + exercises the M5 concurrent-deploy ceiling. Never
//              run against a production site (it deploys).
import { runPool, summarize, recommendCeiling, parseConfig } from './harness.mjs';

const env = (typeof Deno !== 'undefined' ? Deno.env.toObject() : process.env);
const cfg = parseConfig(env);
const log = (...a) => console.log(...a);
const die = (m) => { console.error('load-test: ' + m); (typeof Deno !== 'undefined' ? Deno.exit(1) : process.exit(1)); };

if (!cfg.target) die('set LOADTEST_TARGET to the presence function base URL, e.g. https://<ref>.functions.supabase.co/presence');
if (cfg.mode === 'publish' && !/staging|wjlpursnwbmlcdwbeowv/i.test(cfg.target) && !env.LOADTEST_ALLOW_PUBLISH) {
  die('mode=publish deploys sites — only run against STAGING. Set LOADTEST_ALLOW_PUBLISH=1 to override.');
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.anon) h['Authorization'] = 'Bearer ' + cfg.anon;
  if (cfg.jwt) h['x-dds-user-jwt'] = cfg.jwt;
  if (cfg.site) h['x-dds-scope-site'] = cfg.site;
  return h;
}

/** One measured request. Returns { ms, ok, status }. */
async function oneRequest() {
  const t0 = performance.now();
  let status = 0, ok = false;
  try {
    if (cfg.mode === 'publish') {
      const r = await fetch(`${cfg.target}/publish`, { method: 'POST', headers: headers(), body: JSON.stringify({ summary: 'load-test' }) });
      status = r.status; ok = r.ok; await r.text();
    } else {
      const r = await fetch(`${cfg.target}/preview?page=/`, { method: 'GET', headers: headers() });
      status = r.status; ok = r.ok; await r.text();
    }
  } catch (e) { status = -1; ok = false; }
  return { ms: performance.now() - t0, ok, status };
}

async function measureLevel(concurrency) {
  const items = Array.from({ length: cfg.iterations }, (_, i) => i);
  const { results } = await runPool(items, () => oneRequest(), concurrency);
  const samples = results.filter((r) => r.ok && r.value?.ok).map((r) => r.value.ms);
  const errors = results.filter((r) => !r.ok || !r.value?.ok).length;
  const s = summarize(samples);
  return { concurrency, ...s, errorRate: results.length ? errors / results.length : 0, errors, p95Ms: s.p95 };
}

(async () => {
  log(`\nPresence load test — mode=${cfg.mode} target=${cfg.target}`);
  log(`levels=[${cfg.levels.join(', ')}] iterations/level=${cfg.iterations} p95Budget=${cfg.p95BudgetMs}ms\n`);
  log('conc'.padEnd(6) + 'n'.padEnd(6) + 'errors'.padEnd(8) + 'p50'.padEnd(8) + 'p95'.padEnd(8) + 'p99'.padEnd(8) + 'max');
  const levels = [];
  for (const c of cfg.levels) {
    const r = await measureLevel(c);
    levels.push(r);
    log(String(c).padEnd(6) + String(r.count).padEnd(6) + String(r.errors).padEnd(8) + `${r.p50}`.padEnd(8) + `${r.p95}`.padEnd(8) + `${r.p99}`.padEnd(8) + `${r.max}`);
  }
  const rec = recommendCeiling(levels, { p95BudgetMs: cfg.p95BudgetMs, maxErrorRate: 0 });
  log(`\nRecommended MAX_CONCURRENT_DEPLOYS: ${rec.recommended ?? 'n/a'} — ${rec.reason}`);
  log(`(current M5 default is 8; adjust the env var if this run says otherwise.)\n`);
})();
