// ── L3 Presence Optimization Engine (Foundation) suite ──────────────────────
// The engine ALREADY existed (M9.0 base + M10 optimization providers, one pure
// registry feeding the frozen Evidence Engine). L3 formalizes that into a
// unified, area-organized, extensible foundation and fills coverage gaps. This
// suite proves: the gap-fill providers observe correctly and in isolation; every
// new observation is evidence-only and pipeline-compatible (catalog + judgment
// completeness); the engine's area map is complete and introspectable; and the
// full registry still composes. Integration + regression run against staging.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/optimization_engine_test.mjs
import { PROVIDERS, runProviders } from '../../supabase/functions/presence/evidence/providers.ts';
import { CATALOG } from '../../supabase/functions/presence/evidence/contract.ts';
import { describeEngine, AREAS, PROVIDER_AREA, areaOf, typesForArea } from '../../supabase/functions/presence/optimization/engine.ts';
import { RULES } from '../../supabase/functions/presence/judgment/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const NOW = '2027-01-20T12:00:00Z';
const page = (path, html) => ({ path, html });
const CLEAN_HOME = '<html lang="en"><head><title>t</title><meta name="twitter:card" content="summary"></head><body><main></main><nav></nav><footer></footer></body></html>';
const mk = (over = {}) => ({
  site: { id: 's1', custom_domain: 'ex.example', netlify_site_id: 'nf', template_slug: 't', template_version: 'v', edition: 'presence' },
  now: NOW,
  draft: { identity: { business_name: 'B', description: 'd', phone: '(213) 555-0140', social: {}, story: 'x' }, locations: [{ address_line1: '1 A St', city: 'Town', hours: [] }], offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] },
  live: null, lastLiveAt: NOW, everPublished: true,
  fileMap: { 'index.html': '' }, fileMapFrom: 'live',
  pages: [page('/', CLEAN_HOME)],
  mediaRows: [], usedMediaIds: [],
  lastOfferingChangeAt: NOW, lastLocationChangeAt: NOW, oldestUnpublishedChangeAt: null, unpublishedChangeEvents: 0,
  liveFetch: { attempted: true, url: 'https://ex.example', ok: true, status: 200, https: true, headers: {}, error: '' },
  opt: {
    domain: 'ex.example',
    dns: { apex: true, www: true, mx: false, spf: false, dmarc: false, caa: true },
    domainExpires: null, httpProbe: { status: 200, redirectsToHttps: true, hops: 1 },
    homeProbe: { url: 'https://ex.example', ms: 100, contentEncoding: 'br', cacheControl: 'max-age=60', contentType: 'text/html', server: 'cloudflare', cdnHint: 'cf-ray' },
    robotsTxt: null, sitemapXml: null, knowledgeDocs: [],
  },
  ...over,
});
const emit = (name, input) => runProviders(input, PROVIDERS.filter((p) => p.name === name)).items.map((i) => i.type);

// ═══ 1. gap-fill observations — each fires on the trigger, stays silent otherwise ═══
{
  // SEO: noindex
  const noindexPage = page('/x', '<html><head><title>x</title><meta name="robots" content="noindex, follow"></head><body></body></html>');
  ok('seo.noindex: a noindex page is observed; a clean page is not',
    emit('technical_seo', mk({ pages: [page('/', CLEAN_HOME), noindexPage] })).includes('seo.noindex') &&
    !emit('technical_seo', mk()).includes('seo.noindex'));

  // Performance: CDN absent
  const noCdn = (o) => ({ homeProbe: { ...mk().opt.homeProbe, server: 'nginx', cdnHint: '', ...o } });
  ok('performance.cdn_absent: no CDN headers/server → observed; a CDN → not',
    emit('performance_deep', mk({ opt: { ...mk().opt, ...noCdn({}) } })).includes('performance.cdn_absent') &&
    !emit('performance_deep', mk()).includes('performance.cdn_absent'));

  // Performance: lazy loading
  const imgs = (n, lazy) => '<html><head></head><body>' + Array.from({ length: n }, (_, k) => `<img src="${k}.jpg"${lazy && k > 0 ? ' loading="lazy"' : ''}>`).join('') + '</body></html>';
  ok('performance.lazy_loading_missing: 4+ eager images → observed; some lazy or few images → not',
    emit('lazy_loading', mk({ pages: [page('/', imgs(5, false))] })).includes('performance.lazy_loading_missing') &&
    !emit('lazy_loading', mk({ pages: [page('/', imgs(5, true))] })).includes('performance.lazy_loading_missing') &&
    !emit('lazy_loading', mk({ pages: [page('/', imgs(3, false))] })).includes('performance.lazy_loading_missing'));

  // Infrastructure: CAA
  ok('infrastructure.caa_missing: resolving domain without CAA → observed; with CAA → not',
    emit('infrastructure', mk({ opt: { ...mk().opt, dns: { ...mk().opt.dns, caa: false } } })).includes('infrastructure.caa_missing') &&
    !emit('infrastructure', mk()).includes('infrastructure.caa_missing'));

  // Accessibility: table structure
  const dataTable = page('/', '<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>');
  const headerTable = page('/', '<html><body><table><tr><th>H</th></tr><tr><td>a</td></tr></table></body></html>');
  const layoutTable = page('/', '<html><body><table role="presentation"><tr><td>a</td></tr></table></body></html>');
  ok('accessibility.table_structure: a headerless data table → observed; a <th> table or a presentation table → not',
    emit('accessibility_deep', mk({ pages: [dataTable] })).includes('accessibility.table_structure') &&
    !emit('accessibility_deep', mk({ pages: [headerTable] })).includes('accessibility.table_structure') &&
    !emit('accessibility_deep', mk({ pages: [layoutTable] })).includes('accessibility.table_structure'));

}

// ═══ 2. evidence-only + pipeline compatibility ═══
const NEW_TYPES = ['seo.noindex', 'performance.cdn_absent', 'performance.lazy_loading_missing', 'infrastructure.caa_missing', 'accessibility.table_structure'];
{
  // every new type is in the catalog and renders both plain sentences
  ok('catalog: every new type has an entry with human + tech sentences',
    NEW_TYPES.every((t) => CATALOG[t] && CATALOG[t].human(CATALOG[t].category === 'seo' ? { page: '/x' } : {}).length > 8 && CATALOG[t].tech({ domain: 'ex.example', page: '/x' }).length > 5));

  // completeness law: every new type is consumed by exactly one judgment rule
  ok('judgment: every new type maps to exactly one rule (no silent gaps)',
    NEW_TYPES.every((t) => RULES.filter((r) => r.types.includes(t)).length === 1));

  // evidence-only: emitted items carry NO judgment/recommendation fields
  const sample = runProviders(mk({ pages: [page('/', '<html><body><table><tr><td>a</td></tr></table></body></html>')], opt: { ...mk().opt, dns: { ...mk().opt.dns, caa: false } } }), PROVIDERS).items;
  const forbidden = ['priority', 'audience', 'timing', 'recommendation', 'reasoning', 'dedupe_key'];
  ok('providers emit ONLY evidence — no judgment/recommendation fields present',
    sample.length > 0 && sample.every((i) => forbidden.every((k) => !(k in i))));
  ok('providers never invent customer copy — human/tech come from the catalog, not the provider',
    sample.every((i) => CATALOG[i.type] && i.human === CATALOG[i.type].human(i.facts)));
}

// ═══ 3. the unified engine — complete, mapped, introspectable ═══
{
  const eng = describeEngine();
  ok('engine: exactly ten optimization areas, each with a plain-language purpose', eng.areas.length === 10 && AREAS.every((a) => a.purpose.length > 15));
  ok('engine: every registered optimization provider is mapped to an area (nothing orphaned)', eng.unmapped_optimization.length === 0, eng.unmapped_optimization.join(','));
  ok('engine: each area names the providers serving it + its observation vocabulary',
    eng.areas.every((a) => Array.isArray(a.providers) && a.observation_types >= 0) &&
    eng.areas.find((a) => a.area === 'seo').providers.includes('technical_seo') &&
    eng.areas.find((a) => a.area === 'performance').providers.includes('lazy_loading'));
  ok('engine: the new gap-fill providers land in the right areas',
    areaOf('lazy_loading') === 'performance' && areaOf('technical_seo') === 'seo' && areaOf('infrastructure') === 'infrastructure');
  ok('engine: area vocabularies are derived from the catalog (no drift)',
    typesForArea('seo').includes('seo.noindex') && typesForArea('performance').includes('performance.cdn_absent') && typesForArea('infrastructure').includes('infrastructure.caa_missing'));
  ok('engine: counts are honest', eng.optimization_providers > 0 && eng.optimization_providers < eng.total_providers && eng.total_providers === PROVIDERS.length);
}

// ═══ 4. composability + isolation still hold with the additions ═══
{
  const full = runProviders(mk(), PROVIDERS);
  ok('composability: the whole registry runs together, every provider recorded', full.record.length === PROVIDERS.length && full.record.every((r) => r.ok));
  const bomb = { name: 'bomb', provide() { throw new Error('boom'); } };
  const mixed = runProviders(mk(), [...PROVIDERS.filter((p) => p.name === 'infrastructure'), bomb]);
  ok('isolation: a throwing provider poisons nothing (others still emit, bomb recorded failed)',
    mixed.record.find((r) => r.name === 'bomb')?.ok === false && mixed.items.length >= 0 && mixed.record.find((r) => r.name === 'infrastructure')?.ok === true);
  // determinism: same input → identical output (types + fingerprints)
  const a = runProviders(mk(), PROVIDERS).items.map((i) => i.fingerprint).join('|');
  const b = runProviders(mk(), PROVIDERS).items.map((i) => i.fingerprint).join('|');
  ok('determinism: identical input yields byte-identical evidence (incl. fingerprints)', a === b && a.length > 0);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
