// ── Phase AN-3: LIVE integration — real signals → composed Search Performance ──
// Proves presence reads GSC metrics from the shared `signals` table (same DB) and the
// Analytics home composes them in plain English — so it auto-activates the instant
// real ingestion lands. Isolated throwaway signals; skips when creds absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/search_perf_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP search_perf_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAnalyticsHome } = await import('../../supabase/functions/presence/routes/analytics.ts');
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);

const site = arr(await svc(`presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&client_id=not.is.null&limit=1`))[0];
if (!site) { console.log('SKIP — no site with a client'); Deno.exit(0); }
const CLIENT = site.client_id;
const cors = {};
const mk = (metric, value, period) => svc('signals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: CLIENT, metric, value, period, source: 'gsc', unit: 'count', confidence: 'measured', scope: 'client' }) });

try {
  // seed two months of REAL-shape GSC metrics
  await mk('search_impressions', 1284, '2026-06'); await mk('search_clicks', 37, '2026-06');
  await mk('search_impressions', 500, '2026-05'); await mk('search_clicks', 12, '2026-05'); // a clear, meaningful rise

  const home = (await (await handleAnalyticsHome(new Request('http://x/analytics?period=month'), site, cors)).json()).data;
  ok('home: search performance card appears alongside the rest', (home.insights || []).some((i) => i.key === 'search_impressions'));
  ok('home: meaningful rise surfaces as a Search moment (no noise)', (home.watching || []).some((w) => /finding you on Google/.test(w.headline)));
} finally {
  await svc(`signals?client_id=eq.${CLIENT}&source=eq.gsc&period=in.(2026-05,2026-06)`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SEARCH PERF LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
