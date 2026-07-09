// ── M9.0 Evidence Engine suite ───────────────────────────────────────────────
// Unit (fixture-based, pure), hostile inputs, malformed inputs, determinism,
// contract completeness, composability, performance measurement — all local,
// no network. Plus an optional staging integration tier (SB, SR_KEY, ANON set):
// runs a real observation via the admin surface and reads the stored evidence.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/evidence_test.mjs
import { PROVIDERS, runProviders } from '../../supabase/functions/presence/evidence/providers.ts';
import { CATALOG, makeEmit, fingerprint } from '../../supabase/functions/presence/evidence/contract.ts';
import { getTemplate } from '../../supabase/functions/presence/lib/render.ts';
import { normalizeSnapshotContent } from '../../supabase/functions/presence/lib/render_types.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ═══ canonical input built from the template's own fixture ═══
const fixture = JSON.parse(read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json'));
const T = getTemplate('restaurant-classic', '1.0.0');
const NOW = '2026-07-06T12:00:00.000Z';

function renderFileMap(content) {
  const fm = T.render(
    { content: structuredClone(content), content_contract_version: 1, template_slug: 'restaurant-classic', template_version: '1.0.0', created_at: NOW },
    T.manifest, { baseUrl: 'https://observe.invalid' },
  );
  const out = {};
  for (const [k, v] of Object.entries(fm)) if (typeof v === 'string') out[k] = v;
  return out;
}
const pagesOf = (fm) => Object.keys(fm).filter((k) => k.endsWith('.html'))
  .map((k) => ({ path: k === 'index.html' ? '/' : '/' + k.replace(/\/index\.html$/, '/'), html: fm[k] }));

function healthyInput(overrides = {}) {
  const draft = normalizeSnapshotContent(structuredClone(fixture.content));
  const fm = renderFileMap(draft);
  return {
    site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', template_slug: 'restaurant-classic', template_version: '1.0.0', netlify_site_id: 'nf-1', custom_domain: null, client_id: 'c1', last_published_at: NOW },
    now: NOW,
    draft, live: structuredClone(draft),
    lastLiveAt: '2026-07-01T00:00:00.000Z', everPublished: true,
    fileMap: fm, fileMapFrom: 'live', pages: pagesOf(fm),
    mediaRows: [{ id: 'm1', alt_text: 'Charred octopus over saffron rice', bytes: 180000, width: 1600, height: 1200, mime: 'image/jpeg', created_at: NOW }],
    usedMediaIds: ['m1'],
    lastOfferingChangeAt: '2026-07-01T00:00:00.000Z',
    lastLocationChangeAt: '2026-07-01T00:00:00.000Z',
    oldestUnpublishedChangeAt: null, unpublishedChangeEvents: 0,
    liveFetch: { attempted: true, url: 'https://example.com', ok: true, status: 200, https: true, headers: { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff' }, error: '' },
    ...overrides,
  };
}
const typesOf = (r) => new Set(r.items.map((x) => x.type));

// ═══ 1. catalog integrity ═══
{
  let bad = 0;
  for (const [key, c] of Object.entries(CATALOG)) {
    const catOk = key.startsWith(c.category + '.');
    const sevOk = ['critical', 'warning', 'info'].includes(c.severity);
    const confOk = c.confidence > 0 && c.confidence <= 1;
    const actOk = typeof c.next_action === 'string' && c.next_action.length > 4;
    let tplOk = false;
    try { tplOk = c.human({}).length > 0 && c.tech({}).length > 0; } catch { tplOk = false; }
    if (!(catOk && sevOk && confOk && actOk && tplOk)) { bad++; console.log('   catalog problem:', key); }
  }
  ok(`catalog: every type well-formed (${Object.keys(CATALOG).length} types, 19 categories)`, bad === 0);
  const cats = new Set(Object.values(CATALOG).map((c) => c.category));
  ok('catalog: all 19 categories represented (15 M9.0 + 4 M10)', cats.size === 19, [...cats].join(','));
}

// ═══ 2. healthy fixture → no criticals; all providers ran ═══
const healthy = runProviders(healthyInput());
{
  ok('healthy fixture: all 32 providers executed ok (15 M9.0 + 12 M10 + connected + 4 industry packs; reputation retired in P11)', healthy.record.length === 32 && healthy.record.every((r) => r.ok));
  const crit = healthy.items.filter((x) => x.severity === 'critical');
  ok('healthy fixture: zero critical observations', crit.length === 0, crit.map((c) => c.type).join(',') || `(${healthy.items.length} total items)`);
}

// ═══ 3. contract completeness on every emitted item ═══
{
  let bad = 0;
  for (const it of healthy.items) {
    const fields = [it.category, it.type, it.severity, it.source, it.human, it.tech, it.next_action, it.observed_at, it.fingerprint];
    if (fields.some((f) => typeof f !== 'string' || !f.length)) bad++;
    if (typeof it.confidence !== 'number' || typeof it.resource !== 'string' || typeof it.facts !== 'object') bad++;
    if (!CATALOG[it.type]) bad++;
    if (it.observed_at !== NOW) bad++;
  }
  ok('contract: every item carries all ten fields, catalog-typed, run-clocked', bad === 0);
}

// ═══ 4. degradations produce the expected observations ═══
{
  const inp = healthyInput();
  inp.pages = inp.pages.map((p) => p.path === '/' ? { ...p, html: p.html.replace(/<title>[^<]*<\/title>/, '') } : p);
  ok('seo: stripped title → seo.title_missing', typesOf(runProviders(inp)).has('seo.title_missing'));
}
{
  const inp = healthyInput();
  inp.pages = inp.pages.map((p) => p.path === '/' ? { ...p, html: p.html + '<img src="/x.jpg">' } : p);
  ok('accessibility: bare <img> → img_alt_missing', typesOf(runProviders(inp)).has('accessibility.img_alt_missing'));
}
{
  const inp = healthyInput();
  inp.draft.identity.phone = ''; inp.draft.identity.email = '';
  ok('trust: no phone+email → contact_missing', typesOf(runProviders(inp)).has('trust.contact_missing'));
}
{
  const inp = healthyInput();
  inp.draft.offerings = [
    { id: 'o1', name: 'Twin Dish', category: 'Mains', price_text: '' },
    { id: 'o2', name: 'Twin Dish', category: 'Mains', price_text: '$12' },
  ];
  const t = typesOf(runProviders(inp));
  ok('content: duplicate names → offering_duplicate', t.has('content.offering_duplicate'));
  ok('conversion: empty price → prices_missing', t.has('conversion.prices_missing'));
}
{
  const inp = healthyInput({ everPublished: false, lastLiveAt: null, live: null, fileMapFrom: 'draft' });
  const t = typesOf(runProviders(inp));
  ok('website: never published → not_live', t.has('website.not_live'));
  ok('trust: draft hours + never published → hours_not_public', t.has('trust.hours_not_public'));
}
{
  const inp = healthyInput({ lastLiveAt: '2026-01-01T00:00:00.000Z', lastOfferingChangeAt: '2025-12-01T00:00:00.000Z', oldestUnpublishedChangeAt: '2026-06-01T00:00:00.000Z', unpublishedChangeEvents: 4 });
  const t = typesOf(runProviders(inp));
  ok('freshness: stale dates → publish_stale + menu_unchanged + draft_idle', t.has('freshness.publish_stale') && t.has('freshness.menu_unchanged') && t.has('freshness.draft_idle'));
}
{
  const inp = healthyInput();
  inp.pages = inp.pages.map((p) => p.path === '/' ? { ...p, html: p.html.replace('</body>', '<a href="/no-such-page/">ghost</a></body>') } : p);
  const t = typesOf(runProviders(inp));
  ok('links: dangling internal href → internal_broken (critical)', t.has('links.internal_broken'));
}
{
  const inp = healthyInput();
  inp.mediaRows = [{ id: 'm9', alt_text: 'ok photo words', bytes: 2_400_000, width: null, height: null, mime: 'image/jpeg', created_at: NOW }];
  inp.usedMediaIds = [];
  const t = typesOf(runProviders(inp));
  ok('performance/media: heavy + dimensionless + unused media observed', t.has('performance.image_oversized') && t.has('performance.image_dimensions_missing') && t.has('media.unused'));
}
{
  const inp = healthyInput();
  inp.draft.identity.phone = '(213) 555-0000';
  inp.draft.locations[0].phone = '(213) 555-9999';
  ok('business_info: differing phones → phone_mismatch', typesOf(runProviders(inp)).has('business_info.phone_mismatch'));
}

// ═══ 5. hostile inputs — never throw, never emit malformed items ═══
{
  const inp = healthyInput();
  inp.draft.identity.business_name = '<script>alert(1)</script>"; drop table--';
  inp.draft.identity.description = '🍝'.repeat(50) + ' <img onerror=x> ' + 'A'.repeat(100_000);
  inp.draft.offerings = [{ id: 'x', name: '"><svg onload=1>', category: 'Mains'.repeat(10), price_text: ' ' }];
  const r = runProviders(inp);
  ok('hostile: XSS/huge/control-char content — all providers survive', r.record.every((x) => x.ok));
  ok('hostile: emitted items still contract-complete', r.items.every((it) => it.human.length > 0 && CATALOG[it.type]));
}

// ═══ 6. malformed inputs — empty world ═══
{
  const inp = healthyInput({
    draft: normalizeSnapshotContent({}), live: null, lastLiveAt: null, everPublished: false,
    fileMap: {}, fileMapFrom: 'none', pages: [], mediaRows: [], usedMediaIds: [],
    lastOfferingChangeAt: null, lastLocationChangeAt: null, liveFetch: null,
  });
  inp.site.netlify_site_id = null;
  const r = runProviders(inp);
  ok('malformed: empty snapshot + no pages + no hosting — all providers survive', r.record.every((x) => x.ok));
  const t = typesOf(r);
  ok('malformed: emptiness itself observed (identity_incomplete, hosting_missing)', t.has('business_info.identity_incomplete') && t.has('website.hosting_missing'));
}

// ═══ 7. determinism — byte-identical output for identical input ═══
{
  const r1 = JSON.stringify(runProviders(healthyInput()));
  const r2 = JSON.stringify(runProviders(healthyInput()));
  ok('determinism: two runs on identical input are byte-identical', r1 === r2);
}

// ═══ 8. composability + catalog enforcement ═══
{
  const fake = { name: 'future_provider', provide(_i, emit) { emit('seo.title_missing', 'test', '/x/', { page: '/x/' }); } };
  const r = runProviders(healthyInput(), [...PROVIDERS, fake]);
  ok('composability: a 33rd provider plugs into the same contract', r.record.length === 33 && r.record[32].ok && r.record[32].items === 1);
  const rogue = { name: 'rogue', provide(_i, emit) { emit('made.up_type', 'test', ''); } };
  const r2 = runProviders(healthyInput(), [rogue]);
  ok('catalog enforcement: emitting an unregistered type fails that provider (contained)', r2.record[0].ok === false && r2.items.length === 0);
}
{
  const f1 = fingerprint('site-a', 'seo.title_missing', '/menu/');
  const f2 = fingerprint('site-a', 'seo.title_missing', '/menu/');
  const f3 = fingerprint('site-b', 'seo.title_missing', '/menu/');
  ok('fingerprint: stable per (site,type,resource); distinct across sites', f1 === f2 && f1 !== f3);
}

// ═══ 9. performance ═══
{
  const inp = healthyInput();
  runProviders(inp); // warm
  const N = 100;
  const t0 = performance.now();
  for (let k = 0; k < N; k++) runProviders(inp);
  const avg = (performance.now() - t0) / N;
  ok(`performance: full 15-provider run avg ${avg.toFixed(2)}ms over ${N} iterations (< 50ms)`, avg < 50);
}

// ═══ 10. integration (staging) — only when env is present ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const staffU = (users.users || []).find((x) => (x.email || '') === 'staging-staff@studio-os.test');
  const pw = 'staff-' + crypto.randomUUID().slice(0, 12);
  await fetch(`${SB}/auth/v1/admin/users/${staffU.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
  const staffJwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staging-staff@studio-os.test', password: pw }) })).json()).access_token;
  const call = async (m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': staffJwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const cA = (await j(await fetch(`${SB}/rest/v1/clients?email=eq.rcat-acceptance%40example.com&select=id`, { headers: H })))[0];
  const site = (await j(await fetch(`${SB}/rest/v1/presence_sites?client_id=eq.${cA.id}&select=id`, { headers: H })))[0];

  const run = await call('POST', `/admin/sites/${site.id}/observe`);
  ok('integration: POST /observe runs and stores', run.status === 200 && run.json?.data?.ok === true && run.json.data.item_count >= 0, `items=${run.json?.data?.item_count} ms=${run.json?.data?.ms}`);
  ok('integration: all 32 providers executed on staging', (run.json?.data?.providers || []).length === 32 && run.json.data.providers.every((p) => p.ok), (run.json?.data?.providers || []).filter((p) => !p.ok).map((p) => p.name + ':' + p.error).join(';'));

  const ev = await call('GET', `/admin/sites/${site.id}/evidence`);
  ok('integration: GET /evidence returns the latest run’s items', ev.status === 200 && ev.json?.data?.run_id === run.json.data.run_id && Array.isArray(ev.json.data.items), `n=${ev.json?.data?.items?.length}`);
  const seoOnly = await call('GET', `/admin/sites/${site.id}/evidence?category=seo`);
  ok('integration: category filter narrows', seoOnly.status === 200 && (seoOnly.json.data.items || []).every((x) => x.category === 'seo'));
  const runs = await call('GET', `/admin/sites/${site.id}/evidence/runs`);
  ok('integration: GET /evidence/runs lists the run with its provider record', runs.status === 200 && (runs.json.data || []).some((r) => r.id === run.json.data.run_id && r.item_count === run.json.data.item_count));
  // second run: fingerprints stable across runs (delta queries possible)
  const run2 = await call('POST', `/admin/sites/${site.id}/observe`);
  const ev2 = await call('GET', `/admin/sites/${site.id}/evidence?run_id=${run2.json?.data?.run_id}`);
  const fp1 = new Set((ev.json.data.items || []).map((x) => x.fingerprint));
  const overlapping = (ev2.json?.data?.items || []).filter((x) => fp1.has(x.fingerprint)).length;
  ok('integration: fingerprints persist across runs (deltas provable)', run2.json?.data?.ok === true && overlapping > 0, `overlap=${overlapping}`);
  // staff-only: client jwt must NOT reach the admin evidence surface
  const cpw = 'rcat-' + crypto.randomUUID().slice(0, 12);
  const uA = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'rcat-acceptance@example.com');
  await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: cpw }) });
  const cJwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rcat-acceptance@example.com', password: cpw }) })).json()).access_token;
  const forbidden = await fetch(`${SB}/functions/v1/presence/admin/sites/${site.id}/evidence`, { headers: { 'x-dds-user-jwt': cJwt } });
  ok('integration: evidence is staff-only (client → 403)', forbidden.status === 403);
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ EVIDENCE ENGINE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
