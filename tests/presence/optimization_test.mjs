// ── M10 Presence Optimization Engine suite ───────────────────────────────────
// Pure tiers: catalog integrity (every entry renders human+tech sentences),
// the knowledge extractor, each provider family in ISOLATION with synthetic
// input, determinism (identical input → identical items incl. fingerprints),
// composability (full registry incl. M9.0 providers), failure isolation (a
// throwing provider poisons nothing), null-probe honesty (no probe → no
// guessing). Integration: import a document on staging, run a REAL evidence
// run, verify optimization providers executed and evidence stored, verify
// nothing customer-facing changed.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/optimization_test.mjs
import { OPT_CATALOG } from '../../supabase/functions/presence/optimization/catalog.ts';
import { OPTIMIZATION_PROVIDERS } from '../../supabase/functions/presence/optimization/providers.ts';
import { extractKnowledge, normName, normPrice } from '../../supabase/functions/presence/optimization/knowledge.ts';
import { PROVIDERS, runProviders } from '../../supabase/functions/presence/evidence/providers.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

/* synthetic ObservationInput — everything a provider may read */
const NOW = '2027-01-20T12:00:00Z';
const HOME_HTML = `<html lang="en"><head><title>Marlow’s Kitchen</title><meta name="description" content="Seasonal plates in Echo Park — book a table tonight for honest cooking."><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"Restaurant","name":"Marlow’s Kitchen","address":"2114 Sunset Blvd","telephone":"(213) 555-0140","openingHoursSpecification":[]}</script></head>
<body><main><h1>Marlow’s Kitchen</h1><p>2114 Sunset Blvd · <a href="tel:2135550140">(213) 555-0140</a> · Tue 5:00 pm – 10:00 pm</p><input id="q" type="text"><a href="/menu/">Menu</a></main><nav></nav><footer></footer></body></html>`;
const MENU_HTML = `<html lang="en"><head><title>Menu — Marlow’s</title><meta name="description" content="A short seasonal menu that changes with the Wednesday market garden."></head><body><main><h1>Menu</h1><p>Rye Gnocchi twenty-four. Come hungry and curious, friends.</p></main></body></html>`;
const BASE = {
  site: { id: 'site-1', custom_domain: 'marlows.example', netlify_site_id: 'nf-1', template_slug: 'restaurant-classic', template_version: 'v1' },
  now: NOW,
  draft: {
    identity: { business_name: 'Marlow’s Kitchen', description: 'We cook a short seasonal menu in Echo Park. Half the garden is ours and the rest comes from the Wednesday market.', story: '', phone: '(213) 555-0140', social: {} },
    locations: [{ address_line1: '2114 Sunset Blvd', city: 'Echo Park', hours: [{ day: 'tue', closed: false, intervals: [{ open: '17:00', close: '22:00' }] }] }],
    offerings: [{ id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', is_visible: true }],
    testimonials: [
      { id: 't1', quote: 'x', author: 'a', quote_date: '2026-12-01' },
      { id: 't2', quote: 'y', author: 'b', quote_date: '2026-01-05' },
      { id: 't3', quote: 'z', author: 'c', quote_date: '2025-11-01' },
    ],
    faqs: [{ id: 'f1', question: 'Walk-ins?', answer: 'Yes, most nights.' }, { id: 'f2', question: 'Parking?', answer: 'On the street.' }],
    posts: [], redirects: [],
  },
  live: null, lastLiveAt: '2026-12-01T00:00:00Z', everPublished: true,
  fileMap: { 'index.html': HOME_HTML, 'menu/index.html': MENU_HTML, 'ghost/index.html': MENU_HTML.replace('Menu', 'Ghost') },
  fileMapFrom: 'live',
  pages: [
    { path: '/', html: HOME_HTML },
    { path: '/menu/', html: MENU_HTML },
    { path: '/ghost/', html: `<html lang="en"><head><title>Ghost</title></head><body><main><h1>Ghost</h1><p>${'orphan words '.repeat(20)}</p></main></body></html>` },
  ],
  mediaRows: [
    { id: 'm1', alt_text: 'the patio', bytes: 44000, width: 1200, height: 800, mime: 'image/jpeg', created_at: NOW },
    { id: 'm2', alt_text: 'the patio again', bytes: 44000, width: 1200, height: 800, mime: 'image/jpeg', created_at: NOW },
  ],
  usedMediaIds: ['m1'],
  lastOfferingChangeAt: NOW, lastLocationChangeAt: NOW,
  oldestUnpublishedChangeAt: null, unpublishedChangeEvents: 0,
  liveFetch: { attempted: true, url: 'https://marlows.example', ok: true, status: 200, https: true, headers: {}, error: '' },
  opt: {
    domain: 'marlows.example',
    dns: { apex: true, www: false, mx: true, spf: false, dmarc: false },
    domainExpires: '2027-02-15',
    httpProbe: { status: 200, redirectsToHttps: false, hops: 3 },
    homeProbe: { url: 'https://marlows.example', ms: 2400, contentEncoding: '', cacheControl: '', contentType: 'text/html; charset=utf-8' },
    robotsTxt: 'User-agent: *\nDisallow: /\n',
    sitemapXml: '<urlset><url><loc>https://marlows.example/</loc></url></urlset>',
    knowledgeDocs: [{ id: 'd1', filename: 'spring-menu.txt', extracted: extractKnowledge(
      'SPRING MENU\nRye Gnocchi ..... $26\nDuck Confit ..... $31\nCall us: (213) 555-9999\nOpen Tue-Sun 5pm to 10pm\n') }],
  },
};
const run1 = (names) => runProviders(BASE, OPTIMIZATION_PROVIDERS.filter((p) => names.includes(p.name)));

// ═══ 1. catalog integrity ═══
{
  const entries = Object.entries(OPT_CATALOG);
  ok('catalog: every optimization entry carries category/severity/confidence/next_action + both sentence templates',
    entries.every(([k, c]) => k.includes('.') && c.category && c.severity && c.confidence > 0 && c.confidence <= 1 &&
      c.next_action && typeof c.human({}) === 'string' && typeof c.tech({}) === 'string'), `entries=${entries.length}`);
  ok('catalog: optimization entries live inside the ONE evidence catalog', entries.every(([k]) => k in CATALOG));
  ok('catalog: emitting an unregistered type still throws (contract enforced)', (() => {
    try { makeEmit('s', 'p', NOW, [])('made.up_type', 'x', ''); return false; } catch { return true; }
  })());
}

// ═══ 2. the knowledge extractor (pure, deterministic) ═══
{
  const x = extractKnowledge('LUNCH\nRye Gnocchi ..... $24\nHalf Chicken — 28.00\nSoup of the day $9.50\nWe are open Mon-Fri 11am - 3pm\nCall (213) 555-0140 or hi@marlows.example\nhttps://marlows.example/menu\nThis is a long descriptive sentence about our philosophy of cooking that ends with a period.');
  ok('extract: menu items with three price styles', x.items.length === 3 && x.items[0].name === 'Rye Gnocchi' && x.items[0].price_text === '$24');
  ok('extract: hours lines recognized', x.hours_lines.length === 1 && /Mon-Fri/.test(x.hours_lines[0]));
  ok('extract: phones, emails, urls', x.phones.length === 1 && x.emails[0] === 'hi@marlows.example' && x.urls.length === 1);
  ok('extract: prose sentences are NOT items', !x.items.some((i) => /philosophy/.test(i.name)));
  ok('extract: deterministic — identical input, identical output', JSON.stringify(x) === JSON.stringify(extractKnowledge('LUNCH\nRye Gnocchi ..... $24\nHalf Chicken — 28.00\nSoup of the day $9.50\nWe are open Mon-Fri 11am - 3pm\nCall (213) 555-0140 or hi@marlows.example\nhttps://marlows.example/menu\nThis is a long descriptive sentence about our philosophy of cooking that ends with a period.')));
  ok('extract: helpers normalize honestly', normName('Rye  Gnocchi!') === 'rye gnocchi' && normPrice('$24.00') === '24' && normPrice('24 dollars') === '24');
}

// ═══ 3. provider isolation — each family alone, on synthetic truth ═══
{
  const infra = run1(['infrastructure']).items.map((i) => i.type);
  ok('infrastructure: www gap, expiring domain, no-https redirect, redirect chain', ['infrastructure.dns_www_unresolved', 'infrastructure.domain_expiring', 'infrastructure.http_not_redirected', 'infrastructure.redirect_chain'].every((t) => infra.includes(t)), infra.join(','));
  ok('infrastructure: apex resolves → no apex evidence', !infra.includes('infrastructure.dns_apex_unresolved'));

  const email = run1(['email_auth']).items.map((i) => i.type);
  ok('email_auth: MX without SPF/DMARC → both observed', email.includes('infrastructure.spf_missing') && email.includes('infrastructure.dmarc_missing'));

  const seo = run1(['technical_seo']).items.map((i) => i.type);
  ok('technical_seo: robots blocks all + sitemap gaps + orphan page', seo.includes('seo.robots_blocks_all') && seo.includes('seo.sitemap_page_missing') && seo.includes('seo.orphan_page'), seo.join(','));

  const aeo = run1(['aeo']).items.map((i) => i.type);
  ok('aeo: FAQ schema missing + thin answers + entity links missing', aeo.includes('aeo.faq_schema_missing') && aeo.includes('aeo.answers_thin') && aeo.includes('aeo.entity_links_missing'), aeo.join(','));

  const a11y = run1(['accessibility_deep']).items.map((i) => i.type);
  ok('accessibility_deep: unlabeled input observed', a11y.includes('accessibility.form_label_missing'));

  const perf = run1(['performance_deep']).items.map((i) => i.type);
  ok('performance_deep: no compression + no cache headers + slow response', perf.includes('performance.compression_missing') && perf.includes('performance.cache_headers_missing') && perf.includes('performance.slow_response'));

  const rep = run1(['reputation']).items.map((i) => i.type);
  ok('reputation: slowing testimonial velocity observed', rep.includes('reviews.velocity_slowing'));

  const ana = run1(['analytics']).items.map((i) => i.type);
  ok('analytics: honest absence observation, nothing invented', ana.length === 1 && ana[0] === 'analytics.not_connected');

  const trust = run1(['trust_deep']).items.map((i) => i.type);
  ok('trust_deep: empty story → team info missing', trust.includes('trust.team_info_missing'));

  const vis = run1(['visual_assets']).items.map((i) => i.type);
  ok('visual_assets: og:image missing + duplicate upload; imagery exists so no imagery_none', vis.includes('media.og_image_missing') && vis.includes('media.duplicate_image') && !vis.includes('media.imagery_none'));

  const kn = run1(['knowledge']).items;
  ok('knowledge: document item not on site → item_unlisted', kn.some((i) => i.type === 'knowledge.item_unlisted' && i.facts.name === 'Duck Confit'));
  ok('knowledge: price disagreement observed with both prices', kn.some((i) => i.type === 'knowledge.price_mismatch' && i.facts.doc_price === '$26' && i.facts.site_price === '$24'));
  ok('knowledge: phone disagreement observed', kn.some((i) => i.type === 'knowledge.phone_mismatch'));

  const nap = run1(['local_presence_deep']).items;
  // L3: local_presence_deep always emits the honest apple_business_unconnected
  // absence signal (like GBP/analytics); a consistent phone still raises NO NAP alarm.
  ok('local_presence_deep: consistent phone → no false NAP alarm', !nap.some((i) => i.type === 'local_presence.nap_inconsistent'));
}

// ═══ 4. null-probe honesty — no probe, no guessing ═══
{
  const blind = { ...BASE, opt: null };
  const r = runProviders(blind, OPTIMIZATION_PROVIDERS);
  const netTypes = r.items.filter((i) => i.type.startsWith('infrastructure.') || i.type.startsWith('performance.compression') || i.type.startsWith('knowledge.'));
  ok('honesty: with probes unavailable, network/knowledge providers observe NOTHING', netTypes.length === 0);
  ok('honesty: pure-HTML providers still work without probes', r.items.some((i) => i.type.startsWith('aeo.')));
  ok('honesty: every provider still reports an execution record', r.record.length === OPTIMIZATION_PROVIDERS.length && r.record.every((x) => x.ok));
}

// ═══ 5. determinism ═══
{
  const a = runProviders(BASE, OPTIMIZATION_PROVIDERS);
  const b = runProviders(BASE, OPTIMIZATION_PROVIDERS);
  ok('determinism: identical input → identical items, fingerprints, and record', JSON.stringify(a) === JSON.stringify(b), `items=${a.items.length}`);
}

// ═══ 6. composability + failure isolation ═══
{
  ok('composability: the ONE registry now runs 28 providers (15 + 13)', PROVIDERS.length === 28, `providers=${PROVIDERS.length}`);
  const full = runProviders(BASE, PROVIDERS);
  ok('composability: M9.0 and M10 providers run together, all recorded', full.record.length === 28 && full.record.every((r) => r.ok));
  const bomb = { name: 'bomb', provide() { throw new Error('boom'); } };
  const mixed = runProviders(BASE, [OPTIMIZATION_PROVIDERS[0], bomb, OPTIMIZATION_PROVIDERS[10]]);
  ok('failure isolation: a throwing provider contributes nothing and poisons nothing',
    mixed.record.find((r) => r.name === 'bomb').ok === false && mixed.record.filter((r) => r.ok).length === 2 && mixed.items.length > 0);
}

// ═══ 7. nothing customer-facing, structurally ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/optimization/providers.ts', import.meta.url))
    + Deno.readTextFileSync(new URL('../../supabase/functions/presence/optimization/collect.ts', import.meta.url));
  ok('boundary: providers import no Draft Writer, serializer, model, or content routes', !/applySnapshotToDraft|serializer|anthropicModel|routes\//.test(src));
  const a = runProviders(BASE, OPTIMIZATION_PROVIDERS);
  ok('boundary: no scores anywhere — observations carry measured facts only', !JSON.stringify(a.items).includes('"score"'));
}

// ═══ 8. integration (staging) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const uC = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'rcat-acceptance@example.com');
  const uS = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'staging-staff@studio-os.test');
  const login = async (u) => {
    const pw = 'rcat-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: pw }) })).json()).access_token;
  };
  const [jwtC, jwtS] = [await login(uC), await login(uS)];
  const call = async (jwt, m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };

  const identityBefore = JSON.stringify((await call(jwtC, 'GET', '/identity')).json?.data);

  // the customer brings a document
  const imp = await call(jwtC, 'POST', '/knowledge/import', { filename: 'm10-test-menu.txt', content: 'TEST MENU\nImaginary Optimization Special ..... $99\nOpen Mon 9am - 5pm\n' });
  ok('integration: knowledge import extracts and stores', imp.status === 200 && imp.json?.data?.items === 1, `items=${imp.json?.data?.items}`);
  const docs = await call(jwtC, 'GET', '/knowledge/docs');
  ok('integration: the customer sees their documents', docs.status === 200 && (docs.json?.data || []).some((d) => d.filename === 'm10-test-menu.txt'));

  // a real evidence run through the untouched orchestrator
  const siteQ = await call(jwtC, 'GET', '/site');
  const siteId = siteQ.json?.data?.site?.id;
  const run = await call(jwtS, 'POST', `/admin/sites/${siteId}/observe`);
  ok('integration: the evidence run succeeds with all 28 providers', run.status === 200 && run.json?.data?.ok === true && (run.json?.data?.providers || []).length === 28, `items=${run.json?.data?.item_count}`);
  const rec = run.json?.data?.providers || [];
  ok('integration: every optimization provider executed without error', ['infrastructure', 'email_auth', 'technical_seo', 'aeo', 'accessibility_deep', 'performance_deep', 'local_presence_deep', 'reputation', 'analytics', 'trust_deep', 'visual_assets', 'knowledge'].every((n) => rec.some((r) => r.name === n && r.ok)));
  const ev = await call(jwtS, 'GET', `/admin/sites/${siteId}/evidence?run=${run.json.data.run_id}`);
  const items = ev.json?.data?.items || [];
  ok('integration: optimization evidence stored through the one pipeline', items.some((i) => ['aeo', 'analytics', 'knowledge', 'infrastructure'].includes(i.category)), `total=${items.length}`);
  ok('integration: the imported document produced knowledge evidence', items.some((i) => i.type === 'knowledge.item_unlisted' && String(i.facts?.name || '').includes('Imaginary Optimization Special')));
  ok('integration: every stored item honors the ten-field contract', items.every((i) => i.category && i.type && i.severity && i.confidence > 0 && i.source && i.human && i.tech && i.next_action && i.observed_at && i.fingerprint));

  const identityAfter = JSON.stringify((await call(jwtC, 'GET', '/identity')).json?.data);
  ok('integration: OBSERVATION CHANGED NOTHING — content byte-identical', identityBefore === identityAfter);

  // cleanup: remove the test document (customer-owned)
  const doc = (docs.json?.data || []).find((d) => d.filename === 'm10-test-menu.txt');
  if (doc) await call(jwtC, 'DELETE', `/knowledge/docs/${doc.id}`);
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ OPTIMIZATION ENGINE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
