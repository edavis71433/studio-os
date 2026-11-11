// ── List item 151: one Site health place — speed as visitors feel it, uptime, go-live ──
//   deno run --allow-read --allow-env --allow-net tests/presence/site_health_test.mjs
// Real visitors' loading speed (the counter sends the page's largest contentful paint
// with its time, item 157's leave row), the share of the last 30 days the uptime check
// found the site answering, and a new site's "before you go live" list, as far as the
// platform can check it itself. Each part only says what it can show; too little data
// is no verdict, never a guess.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const { speedOf, pageCalled, cleanLcp, trackerScript, SPEED_GOOD_MS, SPEED_SLOW_MS } = await import(`${P}/lib/visits.ts`);
const { buildWebsiteHealth } = await import(`${P}/lib/website_health.ts`);
const { handleCollect } = await import(`${P}/routes/collect.ts`);
const { runUptimeHeartbeat } = await import(`${P}/monitor/heartbeat.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));

// ═══ 1. speed, from what visitors' browsers report ═══
{
  const t = trackerScript('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'https://x.supabase.co/functions/v1/presence');
  ok('tracker: watches the largest contentful paint, and sends it with the page\'s time', t.includes("observe({type:'largest-contentful-paint',buffered:true})") && t.includes("ms:Math.min(seen,1800000),lcp:Math.round(lcp)"));
  ok('tracker: a browser without it (Safari) just sends nothing for it', t.includes('try{new PerformanceObserver(') && t.includes('}catch(e){}'));
  ok('lcp: kept in whole milliseconds, up to a minute', cleanLcp(1234.6) === 1235 && cleanLcp(0) === null && cleanLcp(70_000) === null && cleanLcp('fast') === null);
  ok('thresholds: Google\'s own, 2.5 s good and 4 s slow', SPEED_GOOD_MS === 2500 && SPEED_SLOW_MS === 4000);
  ok('names: a path as an owner says it', pageCalled('/') === 'the home page' && pageCalled('/menu/') === 'the menu page' && pageCalled('/our-work/') === 'the our work page');

  const rows = (n, path, device, ms) => Array.from({ length: n }, (_, i) => ({ path, device, lcp_ms: ms + (i % 5) * 10 }));
  ok('too few visits: no verdict, never a guess', speedOf(rows(10, '/', 'mobile', 1200)).verdict === null && speedOf([]).sentence === null);
  const fast = speedOf([...rows(30, '/', 'mobile', 1800), ...rows(25, '/', 'desktop', 900)]);
  ok('fast: under 2.5 s for three visitors in four, on phones and computers', fast.verdict === 'fast' && fast.sentence === 'Loads fast for most visitors.' && fast.phones.samples === 30 && fast.computers.samples === 25);
  const slowPhones = speedOf([...rows(20, '/', 'mobile', 2000), ...rows(15, '/menu/', 'mobile', 5200), ...rows(25, '/', 'desktop', 1000)]);
  ok('slow: the slower side is judged, and its slowest page named', slowPhones.verdict === 'slow' && slowPhones.sentence === 'Slow on phones: the menu page takes 5.2 s for most visitors.', slowPhones.sentence);
  const bit = speedOf([...rows(25, '/', 'mobile', 3100)]);
  ok('a little slow: between 2.5 and 4 s', bit.verdict === 'a_little_slow' && bit.sentence === 'A little slow on phones: the home page takes 3.1 s for most visitors.', bit.sentence);
  ok('per page: phones and computers apart, a page with too few visits says nothing', JSON.stringify(slowPhones.pages.find((p) => p.path === '/menu/')) === JSON.stringify({ path: '/menu/', samples: 15, phones_ms: 5230, computers_ms: null }), JSON.stringify(slowPhones.pages));
}

// ═══ 2. the Health check: uptime, speed, before you go live ═══
const BASE = { now: '2026-11-11T12:00:00Z', site_status: 'live', has_unpublished_changes: false, publish_failed: false, last_published_at: '2026-11-01T00:00:00Z', missing_count: 0, missing_href: null, scheduled: false, launch: [], connections: [], contact_form_working: true, versions_saved: true, domain: 'alpha.example' };
const find = (h, key) => h.categories.find((c) => c.key === key);
{
  let h = buildWebsiteHealth({ ...BASE, uptime_30d: { days: 30, checks: 4000, ok_checks: 3999 } });
  ok('uptime: "Online 100% of the last 30 days" when it all but never missed', find(h, 'website_status').checks.some((c) => c.title === 'Online 100% of the last 30 days' && c.state === 'ok'));
  h = buildWebsiteHealth({ ...BASE, uptime_30d: { days: 30, checks: 1000, ok_checks: 996 } });
  ok('uptime: one decimal under that', find(h, 'website_status').checks.some((c) => c.title === 'Online 99.6% of the last 30 days' && c.why === '996 of our 1000 checks found it answering.'));
  h = buildWebsiteHealth({ ...BASE, uptime_30d: { days: 30, checks: 1000, ok_checks: 900 } });
  ok('uptime: under 99% is something to look at', find(h, 'website_status').checks.some((c) => c.title === 'Online 90% of the last 30 days' && c.state === 'attention'));
  h = buildWebsiteHealth({ ...BASE, uptime_30d: { days: 30, checks: 5, ok_checks: 5 } });
  ok('uptime: too few checks yet, no figure', !find(h, 'website_status').checks.some((c) => /^Online \d/.test(c.title)));

  h = buildWebsiteHealth({ ...BASE, speed: { verdict: 'slow', sentence: 'Slow on phones: the menu page takes 5.2 s for most visitors.', phones_ms: 4800, computers_ms: 1200, samples: 60 }, speed_check_href: 'https://tools.example/site-review?url=x' });
  const sp = find(h, 'speed').checks[0];
  ok('speed: a slow site says so in a sentence, with the figures and a way to find the cause', sp.title === 'Slow on phones: the menu page takes 5.2 s for most visitors' && sp.state === 'attention' && sp.why.includes('on phones 4.8 s, on computers 1.2 s') && sp.why.includes('iPhone visitors aren\'t in it') && sp.action_href === 'https://tools.example/site-review?url=x');
  h = buildWebsiteHealth({ ...BASE, speed: { verdict: 'fast', sentence: 'Loads fast for most visitors.', phones_ms: 1800, computers_ms: null, samples: 30 } });
  ok('speed: a fast site is a pass', find(h, 'speed').checks[0].state === 'ok' && find(h, 'speed').checks[0].title === 'Loads fast for most visitors');
  ok('speed: no verdict, no Speed group', !find(buildWebsiteHealth({ ...BASE, speed: { verdict: null, sentence: null, phones_ms: null, computers_ms: null, samples: 3 } }), 'speed') && !find(buildWebsiteHealth(BASE), 'speed'));

  const GL = { first_published_at: '2026-11-05T00:00:00Z', has_phone: false, has_share_picture: false, contact_url: 'https://alpha.example/contact/' };
  h = buildWebsiteHealth({ ...BASE, contact_form_working: false, golive: GL });
  const gl = find(h, 'golive');
  ok('go-live: a new site gets the list: a test message, the phone number, the sharing picture', gl && gl.label === 'Before you go live' && gl.checks.length === 3 && gl.checks.every((c) => c.state === 'attention'));
  ok('go-live: the test message points at the live contact page', gl.checks[0].title === 'Send yourself a test message' && gl.checks[0].action_href === 'https://alpha.example/contact/');
  h = buildWebsiteHealth({ ...BASE, site_status: 'never_published', contact_form_working: false, golive: { ...GL, first_published_at: null } });
  ok('go-live: before the first publish, the test message waits for it', find(h, 'golive').checks[0].title === 'Once it’s live, send yourself a test message' && find(h, 'golive').checks[0].state === 'off');
  h = buildWebsiteHealth({ ...BASE, golive: { ...GL, has_phone: true, has_share_picture: true } });
  ok('go-live: everything done, the list goes away', !find(h, 'golive'));
  h = buildWebsiteHealth({ ...BASE, contact_form_working: false, golive: { ...GL, first_published_at: '2026-09-01T00:00:00Z' } });
  ok('go-live: a site live over a month doesn\'t get it', !find(h, 'golive'));
}

// ═══ 3. the collector and the uptime check ═══
{
  let writes, answer;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.includes('rate')) return new Response(JSON.stringify(true), { status: 200 });
    if (u.pathname === '/rest/v1/presence_visits') { const b = JSON.parse(init.body); writes.push(b); return new Response(null, { status: answer(b) }); }
    return new Response('[]', { status: 200 });
  };
  const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const hit = async (body, statusFor = () => 201) => {
    writes = []; answer = statusFor;
    await handleCollect(new Request(`http://stub.local/functions/v1/presence/px/${SITE}`, { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', origin: 'https://site.example' } }), SITE, {});
    return writes;
  };
  let w = await hit({ k: 'leave', p: '/', ms: 30_000, lcp: 2140 });
  ok('collect: the speed is kept with the page\'s time', w.length === 1 && w[0].lcp_ms === 2140 && w[0].ms === 30_000);
  w = await hit({ k: 'leave', p: '/', ms: 30_000, lcp: 2140 }, (b) => (b.lcp_ms ? 400 : 201));
  ok('collect: before migration 0157, the page\'s time is kept without its speed', w.length === 2 && w[1].lcp_ms === undefined && w[1].ms === 30_000);
  w = await hit({ k: 'button', p: '/', l: 'Book', lcp: 900 });
  ok('collect: only a page\'s time carries a speed', w.length === 1 && w[0].lcp_ms === undefined);

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'stub.local' && u.pathname === '/rest/v1/presence_sites' && (init.method || 'GET') === 'GET') return new Response(JSON.stringify([{ id: SITE, client_id: 'c1', custom_domain: 'alpha.example', netlify_site_id: 'nf', uptime_ok: true, uptime_fail_streak: 0, uptime_checked_at: null }]), { status: 200 });
    if (u.hostname === 'alpha.example') return new Response('', { status: 200 });
    calls.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    return new Response('', { status: 204 });
  };
  await runUptimeHeartbeat(5);
  const tick = calls.find((c) => c.path === '/rest/v1/rpc/presence_uptime_tick');
  ok('uptime: every check adds to the day\'s tally', !!tick && tick.body.p_site === SITE && tick.body.p_ok === true);
}

// ═══ 4. where it reads, and the migration ═══
{
  const route = read('supabase/functions/presence/routes/health_page.ts');
  ok('health: reads the 30-day tally, the visitors\' speed and the go-live facts, each on its own', /presence_uptime_days\?site_id=eq\.\$\{site\.id\}&day=gte\./.test(route) && /kind=eq\.leave&lcp_ms=not\.is\.null/.test(route) && /presence_identity\?site_id=eq\.\$\{site\.id\}&select=phone/.test(route) && /select=og_media_id,cover_media_id/.test(route));
  ok('analytics: a speed read of its own, so it can\'t take the buttons with it before 0157', /kind=eq\.leave&lcp_ms=not\.is\.null&select=path,device,lcp_ms/.test(read('supabase/functions/presence/routes/analytics.ts')));
  ok('privacy: the counter\'s description says it notes how quickly a page showed', read('supabase/functions/presence/lib/legal_pages.ts').includes('it notes how long the page was open and how quickly it showed.'));
  for (const [name, src] of [['migration 0157', read('supabase/migrations/0157_site_health_speed_uptime.sql')], ['apply pack 0157', read('docs/presence/APPLY-0157-prod.sql')]]) {
    ok(`${name}: the speed column, the daily tally with RLS, the one function for the service role only`,
      /add column if not exists lcp_ms integer;/.test(src) && /create table if not exists public\.presence_uptime_days/.test(src) && /alter table public\.presence_uptime_days enable row level security;/.test(src)
      && /revoke all on function public\.presence_uptime_tick\(uuid, boolean\) from public, anon, authenticated;/.test(src) && /grant execute on function public\.presence_uptime_tick\(uuid, boolean\) to service_role;/.test(src));
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE HEALTH (item 151): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
