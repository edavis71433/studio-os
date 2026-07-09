// ── Phase AN-3: LIVE integration — real signals → composed Search Performance ──
// Proves presence reads GSC metrics from the shared `signals` table (same DB) and
// composes plain-English performance + flips "connected" — so it auto-activates the
// instant real ingestion lands. Isolated throwaway signals; skips when creds absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/search_perf_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP search_perf_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAnalyticsSearch, handleAnalyticsHome } = await import('../../supabase/functions/presence/routes/analytics.ts');
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);

const site = arr(await svc(`presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&client_id=not.is.null&limit=1`))[0];
if (!site) { console.log('SKIP — no site with a client'); Deno.exit(0); }
const CLIENT = site.client_id;
const cors = {};
const mk = (metric, value, period) => svc('signals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: CLIENT, metric, value, period, source: 'gsc', unit: 'count', confidence: 'measured', scope: 'client' }) });

try {
  // before: honest "not connected"
  const before = (await (await handleAnalyticsSearch(new Request('http://x/analytics/search'), site, cors)).json()).data;
  ok('before: no GSC data → honest "connect Search Console" card, no performance', before.connected.search_console === false && before.performance.length === 0 && before.not_measured.length === 1);

  // seed two months of REAL-shape GSC metrics
  await mk('search_impressions', 1284, '2026-06'); await mk('search_clicks', 37, '2026-06');
  await mk('search_impressions', 500, '2026-05'); await mk('search_clicks', 12, '2026-05'); // a clear, meaningful rise

  const after = (await (await handleAnalyticsSearch(new Request('http://x/analytics/search'), site, cors)).json()).data;
  ok('after: composes REAL impressions in plain English', after.performance.some((i) => /People saw your business 1,284 times on Google/.test(i.sentence)));
  ok('after: composes REAL clicks', after.performance.some((i) => /37 of them clicked through/.test(i.sentence)));
  ok('after: "connected" flips true from real data (auto-activation)', after.connected.search_console === true);
  ok('after: "not measured" search card retired once data exists', after.not_measured.length === 0);
  ok('after: genuine search milestones surfaced', (after.milestones || []).some((m) => m.key === 'first_impression' && m.achieved));

  const home = (await (await handleAnalyticsHome(new Request('http://x/analytics?period=month'), site, cors)).json()).data;
  ok('home: search performance card appears alongside the rest', (home.insights || []).some((i) => i.key === 'search_impressions'));
  ok('home: meaningful rise surfaces as a Search moment (no noise)', (home.watching || []).some((w) => /finding you on Google/.test(w.headline)));
} finally {
  await svc(`signals?client_id=eq.${CLIENT}&source=eq.gsc&period=in.(2026-05,2026-06)`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SEARCH PERF LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
