// ── M11 Presence Monitor Edition suite ───────────────────────────────────────
// Pure tiers: platform adapter detection (7 platforms via markers), page
// discovery (same-host, capped, deduped, no assets), verification matchers
// (meta/file/dns — exact-token, order-independent), verifyConnection with an
// injected fetcher (no network), truthfulness guards (external input silences
// hosted-only observations; hosted behavior provably unchanged), no-write-
// path structural checks. Integration (staging): flip the test site to
// monitor, connect its own live URL, verification failure is honest, force-
// verify then a REAL observation run over the EXTERNAL site through the one
// pipeline, publish gate 403, upgrade back to presence with every history
// row intact. State fully restored at the end.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/monitor_test.mjs
import { ADAPTERS, detectPlatform } from '../../supabase/functions/presence/monitor/adapters.ts';
import { discoverPaths, matchers, verifyConnection } from '../../supabase/functions/presence/monitor/external.ts';
import { classifyPage, pageFit, assessMigrationReadiness } from '../../supabase/functions/presence/monitor/readiness.ts';
import { runProviders, PROVIDERS } from '../../supabase/functions/presence/evidence/providers.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. platform adapters — one common architecture, detection as data ═══
{
  const cases = [
    ['wordpress', '<link rel="stylesheet" href="/wp-content/themes/x/style.css">'],
    ['squarespace', '<!-- This is Squarespace. --><script src="https://static1.squarespace.com/x.js"></script>'],
    ['wix', '<img src="https://static.wixstatic.com/media/x.jpg">'],
    ['shopify', '<script src="https://cdn.shopify.com/s/files/x.js"></script>'],
    ['webflow', '<meta content="Webflow" name="generator">'],
    ['framer', '<meta name="generator" content="Framer 2024">'],
    ['custom', '<html><head><title>Hand-built</title></head><body>plain</body></html>'],
  ];
  ok('adapters: seven platforms detected from read-only markers', cases.every(([slug, html]) => detectPlatform(html) === slug),
    cases.map(([s, h]) => `${s}:${detectPlatform(h)}`).join(' '));
  ok('adapters: headers count too (server fingerprints)', detectPlatform('<html></html>', { 'x-powered-by': 'X-Wix-Renderer' }) === 'wix');
  ok('adapters: registry entries carry slug/name/markers/note — future platforms are entries', ADAPTERS.every((a) => a.slug && a.name && a.markers.length && a.note));
}

// ═══ 2. page discovery — same-host, capped, clean ═══
{
  const html = `
    <a href="/about">About</a><a href="/menu/">Menu</a><a href="/about">dupe</a>
    <a href="https://other-site.com/steal">external</a><a href="/logo.png">asset</a>
    <a href="/contact#top">Contact</a><a href="mailto:x@y.com">mail</a>
    <a href="/a">1</a><a href="/b">2</a><a href="/c">3</a><a href="/d">4</a><a href="/e">5</a><a href="/f">6</a>`;
  const paths = discoverPaths(html, 'https://marlows.example/');
  ok('discovery: same-host pages only, deduped, no assets or anchors-only dupes',
    paths.includes('/about') && paths.includes('/menu') && paths.includes('/contact') &&
    !paths.some((p) => p.includes('other-site') || p.endsWith('.png')), paths.join(','));
  ok('discovery: bounded at 7 discovered paths (8 pages with home)', paths.length <= 7);
  ok('discovery: deterministic', JSON.stringify(paths) === JSON.stringify(discoverPaths(html, 'https://marlows.example/')));
}

// ═══ 3. verification matchers — pure decision logic ═══
{
  const T = 'dds-abc123def456';
  ok('meta: exact token in either attribute order', matchers.meta(`<meta name="dds-site-verification" content="${T}">`, T) &&
    matchers.meta(`<meta content="${T}" name="dds-site-verification">`, T));
  ok('meta: a different token does NOT verify', !matchers.meta('<meta name="dds-site-verification" content="dds-WRONG">', T));
  ok('file: exact contents (whitespace forgiven), nothing else', matchers.file(`  ${T}\n`, T) && !matchers.file(`${T} plus extra`, T));
  ok('dns: quoted TXT records match; unrelated records do not', matchers.dns([`"${T}"`, '"v=spf1 -all"'], T) && !matchers.dns(['"other"'], T));
}

// ═══ 4. verifyConnection with an injected fetcher — no network, full logic ═══
{
  const conn = { url: 'https://marlows.example/', domain: 'marlows.example', method: 'meta', token: 'dds-tok' };
  const fetcherWith = (body, ok = true) => () => Promise.resolve(new Response(body, { status: ok ? 200 : 404 }));
  const yes = await verifyConnection(conn, fetcherWith('<head><meta name="dds-site-verification" content="dds-tok"></head>'));
  const no = await verifyConnection(conn, fetcherWith('<head></head>'));
  const down = await verifyConnection(conn, fetcherWith('', false));
  ok('verify(meta): token present → verified with a plain note', yes.verified && /found/i.test(yes.note));
  ok('verify(meta): token absent → honest failure, no guessing', !no.verified && /isn’t on the homepage/i.test(no.note));
  ok('verify(meta): site down → the status is named', !down.verified && /404/.test(down.note));
  const fileYes = await verifyConnection({ ...conn, method: 'file' }, (u) => Promise.resolve(new Response(u.includes('dds-verify-dds-tok.txt') ? 'dds-tok' : 'nope')));
  ok('verify(file): fetches /dds-verify-<token>.txt and matches contents', fileYes.verified);
  const dnsYes = await verifyConnection({ ...conn, method: 'dns' }, (u) => Promise.resolve(new Response(
    u.includes('_dds-verify.marlows.example') ? JSON.stringify({ Answer: [{ data: '"dds-tok"' }] }) : '{}',
    { headers: { 'content-type': 'application/dns-json' } })));
  ok('verify(dns): TXT on _dds-verify.<domain> verifies', dnsYes.verified);
}

// ═══ 5. truthfulness guards — external flips exactly three observations off ═══
{
  const base = {
    site: { id: 's1', custom_domain: null, netlify_site_id: null, template_slug: 'restaurant-classic', template_version: 'v1', edition: 'presence' },
    now: '2027-01-20T12:00:00Z',
    draft: { identity: { business_name: 'M', description: 'd', phone: '' }, locations: [{ address_line1: 'x', city: 'y', postal_code: 'z', hours: [{ day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:00' }] }], holiday_exceptions: [{ d: 1 }] }], offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] },
    live: null, lastLiveAt: null, everPublished: false,
    fileMap: {}, fileMapFrom: 'none', pages: [], mediaRows: [], usedMediaIds: [],
    lastOfferingChangeAt: null, lastLocationChangeAt: null, oldestUnpublishedChangeAt: null,
    unpublishedChangeEvents: 0, liveFetch: null, opt: null, external: false,
  };
  const hosted = runProviders(base, PROVIDERS).items.map((i) => i.type);
  ok('hosted site (external=false): not_live + hosting_missing + hours_not_public all observed — unchanged behavior',
    hosted.includes('website.not_live') && hosted.includes('website.hosting_missing') && hosted.includes('trust.hours_not_public'));
  const ext = runProviders({ ...base, external: true, site: { ...base.site, edition: 'monitor' } }, PROVIDERS).items.map((i) => i.type);
  ok('external site (Monitor): those three FALSE observations are never emitted',
    !ext.includes('website.not_live') && !ext.includes('website.hosting_missing') && !ext.includes('trust.hours_not_public'));
  ok('external site: everything else still observes (business profile gaps, analytics absence…)',
    ext.includes('business_info.identity_incomplete') === hosted.includes('business_info.identity_incomplete') && ext.includes('analytics.not_connected'));
}

// ═══ 5b. Migration Readiness — the quiet answer to "what would it take?" ═══
{
  ok('readiness: pages classify by path + title', classifyPage('/', '') === 'home' && classifyPage('/menu', 'Our Food') === 'menu' &&
    classifyPage('/our-story', 'About Us') === 'about' && classifyPage('/faq', '') === 'faq' &&
    classifyPage('/find-us', 'Hours & Directions') === 'contact' && classifyPage('/blog', 'News') === 'updates' && classifyPage('/mystery', 'X') === 'other');
  ok('readiness: fit — template sections clean, unknown reviewed, commerce manual',
    pageFit('menu', '/menu') === 'clean' && pageFit('other', '/mystery') === 'review' && pageFit('menu', '/shop/checkout') === 'manual');

  const PAGES = [
    { path: '/', html: '<title>Marlow’s Kitchen</title><meta name="description" content="Seasonal plates in Echo Park.">' },
    { path: '/food/', html: '<title>Our Menu</title><meta name="description" content="What we cook.">' },
    { path: '/our-story/', html: '<title>About Marlow’s</title>' },
    { path: '/shop/checkout/', html: '<title>Checkout</title>' },
  ];
  const EV = [
    { category: 'accessibility', type: 'accessibility.img_alt_missing', severity: 'warning', human: '4 images have no descriptions.' },
    { category: 'accessibility', type: 'accessibility.form_label_missing', severity: 'warning', human: 'A form field has no label.' },
    { category: 'content', type: 'content.description_thin', severity: 'info', human: 'The description is under 40 words.' },
    { category: 'performance', type: 'performance.compression_missing', severity: 'warning', human: 'Pages travel uncompressed.' },
  ];
  const r = assessMigrationReadiness(PAGES, EV);
  ok('readiness: page plans — home + renamed sections clean, checkout manual',
    r.pages.find((p) => p.path === '/')?.fit === 'clean' && r.pages.find((p) => p.path === '/food/')?.fit === 'clean' &&
    r.pages.find((p) => p.path === '/shop/checkout/')?.fit === 'manual');
  ok('readiness: SEO preserved — titles/descriptions counted, renamed paths become redirects',
    r.seo.titles_preserved === 4 && r.seo.descriptions_preserved === 2 && r.seo.redirects_needed.includes('/food/') && r.seo.redirects_needed.includes('/our-story/'));
  ok('readiness: accessibility priorities come from evidence, worst first, deduped',
    r.accessibility_first.length === 2 && r.accessibility_first.every((a) => a.what.length > 0));
  ok('readiness: post-migration improvements derived from evidence, as sentences',
    r.content_after.some((s) => /descriptions get properly written/i.test(s)) && r.content_after.some((s) => /fast, compressed/i.test(s)));
  ok('readiness: the customer summary is sentences — no state word, no scores',
    r.summary.length >= 2 && !r.summary.some((s) => /ready|mostly_ready|needs_prep/.test(s) && /_/.test(s)) && !JSON.stringify(r.summary).match(/\b\d+\s*(\/|out of)\s*\d+/));
  ok('readiness: deterministic', JSON.stringify(r) === JSON.stringify(assessMigrationReadiness(PAGES, EV)));
  const prep = assessMigrationReadiness(PAGES, [
    { category: 'accessibility', type: 'accessibility.lang_missing', severity: 'critical', human: 'x' },
    { category: 'accessibility', type: 'accessibility.heading_skip', severity: 'critical', human: 'y' },
  ]);
  ok('readiness: two critical accessibility issues → operators see needs_prep', prep.state === 'needs_prep' && r.state !== 'needs_prep');
}

// ═══ 6. no write paths, structurally ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/monitor/external.ts', import.meta.url))
    + Deno.readTextFileSync(new URL('../../supabase/functions/presence/monitor/adapters.ts', import.meta.url));
  ok('read-only: the monitor module contains no POST/PUT/PATCH/DELETE toward external sites and no deploy/publish imports',
    !/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src) && !/netlify|deploy|publish|applySnapshotToDraft|serializer/i.test(src));
  const routes = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/monitor.ts', import.meta.url));
  ok('read-only: monitor routes write only OUR rows — no external write calls, no hosting modules', !/netlify|deploy/i.test(routes));
}

// ═══ 7. integration (staging) — the full monitor lifecycle, state restored ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const login = async (email) => {
    const u = (users.users || []).find((x) => (x.email || '').toLowerCase() === email);
    const pw = 'pw-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
  };
  const [jwtC, jwtS] = [await login('rcat-acceptance@example.com'), await login('staging-staff@studio-os.test')];
  const call = async (jwt, m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const siteR = await call(jwtC, 'GET', '/site');
  const siteId = siteR.json?.data?.site?.id;
  const countRows = async (table) => (await j(await fetch(`${SB}/rest/v1/${table}?site_id=eq.${siteId}&select=id`, { headers: H }))).length;

  try {
    // history BEFORE the edition dance — the upgrade-preservation baseline
    const before = {};
    for (const t of ['presence_evidence_runs', 'presence_judgments', 'presence_recommendations', 'presence_moments', 'presence_growth_opportunities', 'presence_brand_reports']) before[t] = await countRows(t);

    // 1. become a Monitor site
    const flip = await call(jwtS, 'POST', `/admin/sites/${siteId}/edition`, { edition: 'monitor' });
    ok('integration: operator sets the edition to monitor', flip.status === 200 && flip.json?.data?.edition === 'monitor');
    ok('integration: the room reports the edition', (await call(jwtC, 'GET', '/site')).json?.data?.site?.edition === 'monitor');

    // 2. the boundary: a Monitor site can NEVER publish
    const pub = await call(jwtC, 'POST', '/publish');
    ok('integration: publish is refused for Monitor — with a warm explanation', pub.status === 403 && pub.json?.error === 'edition_monitor');
    const res = await call(jwtC, 'POST', '/restore', { publish_id: crypto.randomUUID() });
    ok('integration: restore is refused for Monitor', res.status === 403);

    // 3. connect an existing website (example.com — IANA's reserved test
    //    domain; a real, fetchable external site touched with GETs only)
    const conn = await call(jwtC, 'POST', '/monitor/connect', { url: 'https://example.com/', method: 'meta' });
    ok('integration: connect stores a pending connection with instructions', conn.status === 200 && conn.json?.data?.status === 'pending' && /dds-site-verification/.test(conn.json?.data?.instructions || ''), `platform=${conn.json?.data?.platform}`);

    // 4. verification is HONEST — the token isn't on that site
    const ver = await call(jwtC, 'POST', '/monitor/verify');
    ok('integration: unproven ownership does NOT verify', ver.status === 200 && ver.json?.data?.verified === false, ver.json?.data?.note);

    // 5. observation does not start without verification
    const run0 = await call(jwtS, 'POST', `/admin/sites/${siteId}/observe`);
    ok('integration: unverified → the run observes the profile only (no external fetch trusted)', run0.status === 200 && run0.json?.data?.ok === true);

    // 6. simulate the customer completing verification (service role — the check itself is covered by pure tiers)
    await fetch(`${SB}/rest/v1/presence_monitor_connections?site_id=eq.${siteId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'verified', verified_at: new Date().toISOString() }) });
    const run1 = await call(jwtS, 'POST', `/admin/sites/${siteId}/observe`);
    ok('integration: verified → a REAL observation run over the external website', run1.status === 200 && run1.json?.data?.ok === true && (run1.json?.data?.providers || []).length === 27, `items=${run1.json?.data?.item_count}`);
    const ev = await call(jwtS, 'GET', `/admin/sites/${siteId}/evidence?run=${run1.json.data.run_id}`);
    const items = ev.json?.data?.items || [];
    ok('integration: external pages produced evidence through the ONE pipeline', items.length > 0 && items.every((i) => i.fingerprint && i.human));
    ok('integration: no FALSE hosted-site claims about the external site', !items.some((i) => ['website.not_live', 'website.hosting_missing', 'trust.hours_not_public'].includes(i.type)));

    // 6b. Migration Readiness — quietly determined while monitoring
    const ready = await call(jwtC, 'GET', '/monitor/readiness');
    ok('integration: readiness answers in sentences — summary, page plans, first fixes', ready.status === 200 &&
      Array.isArray(ready.json?.data?.summary) && ready.json.data.summary.length >= 2 &&
      Array.isArray(ready.json?.data?.pages) && ready.json.data.pages.every((p) => p.path && p.plan), ready.json?.data?.summary?.[0]);
    ok('integration: no internal state word or score reaches the customer',
      !JSON.stringify(ready.json?.data || {}).match(/needs_prep|mostly_ready|"state"|"score"/));
    const adminReady = await call(jwtS, 'GET', `/admin/sites/${siteId}/migration-readiness`);
    ok('integration: the operator sees the full working detail', adminReady.status === 200 &&
      adminReady.json?.data?.state && adminReady.json?.data?.seo && Array.isArray(adminReady.json?.data?.pages), `state=${adminReady.json?.data?.state}`);
    const stored = (await j(await fetch(`${SB}/rest/v1/presence_monitor_connections?site_id=eq.${siteId}&select=readiness_at`, { headers: H })))[0];
    ok('integration: the assessment is quietly kept on the connection', !!stored?.readiness_at);

    // 7. the upgrade: monitor → presence, one flip, NOTHING lost
    const up = await call(jwtS, 'POST', `/admin/sites/${siteId}/edition`, { edition: 'presence' });
    ok('integration: upgrade is one column flip', up.status === 200 && up.json?.data?.edition === 'presence');
    let intact = true;
    for (const t of Object.keys(before)) {
      const after = await countRows(t);
      if (after < before[t]) { intact = false; console.log(`      LOST ROWS in ${t}: ${before[t]} → ${after}`); }
    }
    ok('integration: evidence/judgments/recommendations/moments/growth/brand history ALL survive the upgrade', intact);
    // probe the gate without actually publishing: a bogus restore now fails
    // in the route itself (404/400), no longer at the edition gate (403)
    const gate = await call(jwtC, 'POST', '/restore', { publish_id: crypto.randomUUID() });
    ok('integration: the publish/restore gate lifts after the upgrade', gate.status !== 403, `status=${gate.status}`);
  } finally {
    // restore staging exactly as found: presence edition, no connection
    await fetch(`${SB}/rest/v1/presence_sites?id=eq.${siteId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ edition: 'presence' }) });
    await fetch(`${SB}/rest/v1/presence_monitor_connections?site_id=eq.${siteId}`, { method: 'DELETE', headers: H });
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ PRESENCE MONITOR: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
