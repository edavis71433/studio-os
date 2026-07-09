// ── Phase AN-2: LIVE integration — the real deployed collector + composition ──
// Beacons the DEPLOYED /px endpoint over HTTP exactly as a browser sendBeacon
// would (no apikey), verifies privacy behavior (bot dropped, DNT respected, UA
// parsed server-side, no raw IP), then confirms the Website view composes it.
// Isolated by a unique path; skips when creds absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/visits_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP visits_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAnalyticsWebsite } = await import('../../supabase/functions/presence/routes/analytics.ts');
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE = Deno.env.get('SITE') || arr(await svc('presence_sites?select=id&limit=1'))[0]?.id;
const PX = `${SB_URL}/functions/v1/presence/px/${SITE}`;
const TAG = '/an2-itest-' + crypto.randomUUID().slice(0, 8);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile/15E Safari/604';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
// a browser sendBeacon sends NO apikey header — prove the public endpoint accepts it
const beacon = (body, ua, extra = {}) => fetch(PX, { method: 'POST', headers: { 'user-agent': ua, 'content-type': 'text/plain', origin: 'https://joes-example.com', ...extra }, body: JSON.stringify(body) });

try {
  const r1 = await beacon({ k: 'pageview', p: TAG, r: 'https://www.google.com/search?q=x' }, IPHONE);
  ok('collector: accepts a public beacon with NO apikey (like sendBeacon) → 204', r1.status === 204);
  await beacon({ k: 'phone', p: TAG }, IPHONE);                       // an engagement event
  await beacon({ k: 'pageview', p: TAG, r: '' }, BOT);               // bot → must be dropped
  await beacon({ k: 'pageview', p: TAG, r: '' }, IPHONE, { dnt: '1' }); // DNT → must be dropped
  await sleep(1200); // let the inserts settle

  const rows = arr(await svc(`presence_visits?site_id=eq.${SITE}&path=eq.${encodeURIComponent(TAG)}&select=kind,device,os,browser,ref_host,visitor_hash,country&order=id.desc`));
  const pv = rows.find((x) => x.kind === 'pageview');
  ok('collector: pageview row stored', !!pv);
  ok('collector: UA parsed server-side → mobile / iOS / Safari', pv && pv.device === 'mobile' && pv.os === 'iOS' && pv.browser === 'Safari');
  ok('collector: referrer reduced to HOST only (privacy)', pv && pv.ref_host === 'google.com');
  ok('collector: anonymous visitor hash present, no raw IP', pv && /^[0-9a-f]{20}$/.test(pv.visitor_hash));
  ok('collector: engagement (phone) event stored', rows.some((x) => x.kind === 'phone'));
  ok('collector: BOT beacon was DROPPED (not stored)', rows.filter((x) => x.kind === 'pageview').length === 1);
  ok('collector: DNT beacon was DROPPED (not stored)', rows.filter((x) => x.kind === 'pageview').length === 1);

  // composition sees the real visit
  const site = arr(await svc(`presence_sites?id=eq.${SITE}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`))[0];
  const web = (await (await handleAnalyticsWebsite(new Request('http://x/analytics/website?period=week'), site, {})).json()).data;
  ok('composition: Website view now reports real visitors (≥1)', web.has_data && web.visitors >= 1);
  ok('composition: the visited path appears in top pages', (web.top_pages || []).some((p) => p.path === TAG));
} finally {
  await svc(`presence_visits?site_id=eq.${SITE}&path=eq.${encodeURIComponent(TAG)}`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ VISITS LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
