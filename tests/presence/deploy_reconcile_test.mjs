// ── Deploy robustness (Presence CMS Phase 1, M5) ─────────────────────────────
//   deno run --allow-read --allow-env tests/presence/deploy_reconcile_test.mjs
// Pure decision helpers + structural wiring checks (no network).
Deno.env.delete('MAX_CONCURRENT_DEPLOYS');
const M = await import('../../supabase/functions/presence/lib/deploy_reconcile.ts');
const { deployCeiling, deployCeilingExceeded, deployStateOutcome, ageMs, DEFAULT_DEPLOY_CEILING, RECONCILE_STALE_MS, ABANDON_MS } = M;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── deployStateOutcome: Netlify state → terminal publish outcome ──
ok('state: ready → live', deployStateOutcome('ready') === 'live');
ok('state: error → failed', deployStateOutcome('error') === 'failed');
ok('state: uploading → pending', deployStateOutcome('uploading') === 'pending');
ok('state: building → pending', deployStateOutcome('building') === 'pending');
ok('state: null → pending (never a false terminal)', deployStateOutcome(null) === 'pending');

// ── concurrent deploy ceiling ──
ok('ceiling: below → not exceeded', deployCeilingExceeded(3, 8) === false);
ok('ceiling: at limit → exceeded', deployCeilingExceeded(8, 8) === true);
ok('ceiling: above → exceeded', deployCeilingExceeded(9, 8) === true);
ok('ceiling: default is 8 when env unset', deployCeiling() === DEFAULT_DEPLOY_CEILING && DEFAULT_DEPLOY_CEILING === 8);
Deno.env.set('MAX_CONCURRENT_DEPLOYS', '3');
ok('ceiling: MAX_CONCURRENT_DEPLOYS env overrides the default (configurable)', deployCeiling() === 3);
Deno.env.set('MAX_CONCURRENT_DEPLOYS', '0');
ok('ceiling: non-positive env falls back to default', deployCeiling() === DEFAULT_DEPLOY_CEILING);
Deno.env.delete('MAX_CONCURRENT_DEPLOYS');

// ── ageMs + reconcile thresholds ──
const NOW = 1_000_000_000_000;
ok('age: null/unparseable → 0', ageMs(null, NOW) === 0 && ageMs('nope', NOW) === 0);
ok('age: 30s ago → ~30000', (() => { const a = ageMs(new Date(NOW - 30_000).toISOString(), NOW); return a >= 29_000 && a <= 31_000; })());
ok('stale threshold is past the 30s in-request poll', RECONCILE_STALE_MS === 90_000 && RECONCILE_STALE_MS > 30_000);
ok('abandon threshold is generous (15 min)', ABANDON_MS === 15 * 60_000);

// ── structural wiring: ceiling, telemetry, reconcile-cron, shared reconcile ──
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('wiring: runPipeline enforces the deploy ceiling (503 deploy_busy)', /deployCeiling\(\)/.test(pub) && /deploy_busy/.test(pub) && /deployCeilingExceeded/.test(pub));
  ok('wiring: per-stage telemetry emitted (publish_stages log)', /publish_stages/.test(pub) && /logStages\(/.test(pub) && /at\('deploy'\)/.test(pub));
  ok('wiring: handlePublishHistory reuses the shared reconcileSitePublishes', /reconcileSitePublishes\(site\.id\)/.test(pub) && !/deployState\(p\.netlify_deploy_id\)/.test(pub));

  const sys = read('supabase/functions/presence/routes/system.ts');
  ok('wiring: reconcile runs on the default cron cycle (no owner cron change)', /const reconcile = await runReconcileStuckPublishes\(/.test(sys));
  ok('wiring: reconcile also has a dedicated task', /task === 'reconcile'/.test(sys));

  const net = read('supabase/functions/presence/lib/netlify.ts');
  ok('wiring: deploy poll timeout is configurable (DEPLOY_POLL_MS)', /DEPLOY_POLL_MS/.test(net));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DEPLOY RECONCILE (M5): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
