// ── Phase AN-3.1: LIVE integration — GSC data flows to Analytics (real DB) ────
// Proves the read+surface path against real Postgres: aggregate metrics in signals
// + query/page detail in presence_search_terms → the Analytics Search view composes
// real impressions/clicks + top-search + best-page in plain English, and flips
// detail_available. (The Google API boundary is owner-gated and can't be live-tested
// here — see the report; the sync's PARSING is unit-tested in gsc_test.)
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/gsc_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP gsc_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAnalyticsSearch } = await import('../../supabase/functions/presence/routes/analytics.ts');
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);

const site = arr(await svc(`presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&client_id=not.is.null&limit=1`))[0];
if (!site) { console.log('SKIP — no site with a client'); Deno.exit(0); }
const CLIENT = site.client_id, cors = {};
const sig = (metric, value, period) => svc('signals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: CLIENT, metric, value, period, source: 'gsc', unit: 'count', confidence: 'measured', scope: 'client' }) });
const term = (dimension, key, clicks, impressions, period) => svc('presence_search_terms', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: CLIENT, period, dimension, key, clicks, impressions, position: 4 }) });

try {
  const before = (await (await handleAnalyticsSearch(new Request('http://x/analytics/search'), site, cors)).json()).data;
  ok('before: no GSC data → honest "connect" card, no performance/detail', before.connected.search_console === false && before.performance.length === 0 && (before.detail || []).length === 0 && before.detail_available === false);

  await sig('search_impressions', 1284, '2026-06'); await sig('search_clicks', 37, '2026-06');
  await sig('search_impressions', 500, '2026-05'); await sig('search_clicks', 12, '2026-05');
  await term('query', 'joes plumbing', 12, 200, '2026-06'); await term('query', 'emergency plumber', 5, 80, '2026-06');
  await term('page', '/services', 9, 150, '2026-06');

  const after = (await (await handleAnalyticsSearch(new Request('http://x/analytics/search'), site, cors)).json()).data;
  ok('after: real impressions composed in plain English', after.performance.some((i) => /People saw your business 1,284 times on Google/.test(i.sentence)));
  ok('after: connected flips true from real data', after.connected.search_console === true);
  ok('after: TOP SEARCH surfaced (query detail from presence_search_terms)', (after.detail || []).some((c) => c.key === 'top_query' && /joes plumbing/.test(c.sentence)));
  ok('after: BEST PAGE surfaced (page detail)', (after.detail || []).some((c) => c.key === 'top_page' && /services page/.test(c.sentence)));
  ok('after: detail_available flips true', after.detail_available === true);
  ok('after: "not measured" search card retired', after.not_measured.length === 0);
} finally {
  await svc(`signals?client_id=eq.${CLIENT}&source=eq.gsc&period=in.(2026-05,2026-06)`, { method: 'DELETE' });
  await svc(`presence_search_terms?client_id=eq.${CLIENT}&period=eq.2026-06`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ GSC LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
