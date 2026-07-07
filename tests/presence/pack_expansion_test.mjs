// ── L5.3 Industry Pack Expansion suite ──────────────────────────────────────
// Proves the two scaling patterns on the LIVE pipeline, no engine change:
//   1. Coffee Shop EXTENDS Restaurant — inherits everything, duplicates nothing.
//   2. Home Services is a reusable BASE — a future trade extends it for free.
// Plus: no cross-contamination between industries, and measured reuse.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/pack_expansion_test.mjs
import { composePack, resolvePack, resolveIndustryKey, registerPack, makePack, industryIsA } from '../../supabase/functions/presence/industry/registry.ts';
import { restaurantProvider } from '../../supabase/functions/presence/industry/packs/restaurant.ts';
import { coffeeShopProvider, COFFEE_SHOP_PACK } from '../../supabase/functions/presence/industry/packs/coffee_shop.ts';
import { homeServicesProvider, HOME_SERVICES_PACK } from '../../supabase/functions/presence/industry/packs/home_services.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { judge } from '../../supabase/functions/presence/judgment/rules.ts';
import { recommend } from '../../supabase/functions/presence/recommendation/rules.ts';
import { momentize } from '../../supabase/functions/presence/moments/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-07T12:00:00.000Z', SITE = '00000000-0000-4000-8000-000000000001';

function evidenceFrom(providers, input) {
  const items = [];
  for (const pr of providers) pr.provide(input, makeEmit(SITE, pr.name, NOW, items));
  return items.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
}
function pipeline(providers, input, plan = 'presence') {
  const ev = evidenceFrom(providers, input);
  const js = judge(ev, { siteId: SITE, now: NOW, previous: {}, plan }).judgments;
  const jr = js.map((j) => ({ judgment_hash: j.judgment_id, judgment_key: j.dedupe_key, rule: j.rule, category: j.category, priority: j.priority, severity: j.severity, confidence: j.confidence, reasoning: j.reasoning, timing: j.timing, audience: j.audience, status: j.status, evidence_count: j.evidence_count, evidence_ids: j.evidence_ids, first_seen_at: j.first_seen_at, expires_at: j.expires_at }));
  const rr = recommend(jr, { siteId: SITE, now: NOW, previous: {} }).recommendations.map((r) => ({ recommendation_hash: r.recommendation_id, rule: r.rule, priority: r.priority, audience: r.audience, status: r.status, value_dimensions: r.value_dimensions, timing: r.timing, expires_at: r.expiration }));
  const moments = momentize(rr, { siteId: SITE, now: NOW, previous: {}, dismissals: {} }).moments.filter((m) => m.status === 'active');
  return { ev, js, moments };
}
const site = (industry, over = {}) => ({ site: { id: SITE }, now: NOW, industry, pages: [{ path: '/', html: '<h2>Welcome</h2>' }], mediaRows: [], ...over });

// ═══ 1. COFFEE SHOP INHERITS RESTAURANT (composePack) ═══
{
  const c = composePack('coffee_shop');
  ok('inherit: coffee shop inherits Restaurant CMS (menu, reservations) AND adds its own (seasonal_drinks)',
    c.cms.pages.includes('menu') && c.cms.pages.includes('reservations') && c.cms.pages.includes('seasonal_drinks'));
  ok('inherit: vocabulary inherits (offerings=menu) and specializes (offering=drink)', c.vocabulary.offerings === 'menu' && c.vocabulary.offering === 'drink');
  ok('inherit: the Growth calendar is inherited from Restaurant (coach pack)', c.growth.pack?.slug === 'restaurant');
  ok('inherit: the creative voice is inherited and extended (restaurant writer + coffee photography)', !!c.creative.writer && c.creative.photographyGuidance.some((g) => /latte|cup/i.test(g)) && c.creative.photographyGuidance.some((g) => /hero dish|natural light/i.test(g)));
  ok('inherit: profile inherits restaurant fields and overrides booking (reservation → order)', c.profile.keyFields.includes('cuisine') && c.profile.keyFields.includes('wifi') && c.profile.bookingPosture === 'order');
  ok('inherit: connected guidance is inherited (Google Business Profile)', c.connected.relevantProviders.includes('google_business_profile'));
}

// ═══ 2. EVIDENCE INHERITANCE — the restaurant provider fires for a coffee shop ═══
{
  ok('is-a: coffee_shop IS-A restaurant (inheritance-aware self-gate)', industryIsA('coffee_shop', 'restaurant') && !industryIsA('restaurant', 'coffee_shop'));
  const rEv = evidenceFrom([restaurantProvider], site('coffee_shop', { pages: [{ path: '/', html: '<h2>Welcome</h2>' }] })).map((e) => e.type);
  ok('is-a: the Restaurant evidence provider fires for a coffee shop (menu/photos inherited)', rEv.includes('content.restaurant_menu_absent') && rEv.includes('media.restaurant_food_photos_missing'));
  const cEv = evidenceFrom([coffeeShopProvider], site('coffee_shop')).map((e) => e.type);
  ok('is-a: the Coffee Shop provider adds its own evidence (workspace)', cEv.includes('content.coffee_shop_workspace_unlisted'));
}

// ═══ 3. LIVE PIPELINE for a coffee shop — restaurant + coffee intelligence, calm ═══
{
  const { js, moments } = pipeline([restaurantProvider, coffeeShopProvider], site('coffee_shop'));
  ok('pipeline: a coffee shop gets BOTH restaurant and coffee judgments', js.some((j) => j.rule === 'restaurant_menu' && j.status === 'active') && js.some((j) => j.rule === 'coffee_shop_workspace' && j.status === 'active'));
  ok('pipeline: it all stays calm (≤3 merged moments, no flood)', moments.length <= 3 && moments.length >= 1);
}

// ═══ 4. HOME SERVICES BASE — the reusable foundation ═══
{
  const h = composePack('home_services');
  ok('base: home services scaffolds the common trade CMS (services, service_areas, emergency, financing)',
    ['services', 'service_areas', 'emergency_service', 'financing', 'reviews', 'faqs'].every((p) => h.cms.pages.includes(p)));
  ok('base: it leads with per-service pages, quote-first booking, before/after media', h.cms.servicePages === true && h.profile.bookingPosture === 'quote' && h.creative.mediaSuggestions.some((m) => /before/i.test(m)));
  ok('base: it carries the trust foundation (licensing compliance, service-area + license evidence)',
    h.compliance.requirements.length > 0 && h.evidence.catalogTypes.includes('business_info.home_services_service_area_missing') && h.evidence.catalogTypes.includes('trust.home_services_license_unlisted'));
  ok('base: connected + vocabulary suit a trade (scheduling/CRM, "request a quote")', h.connected.relevantProviders.includes('google_calendar') && h.connected.relevantProviders.includes('hubspot') && h.vocabulary.book === 'request a quote');
}

// ═══ 5. FUTURE TRADE — a plumber EXTENDS home services for free (demo, not shipped) ═══
{
  registerPack(makePack({ key: 'plumber_demo', label: 'Plumber (demo)', family: 'home_services', status: 'available', extends: 'home_services',
    vocabulary: { emergency: 'burst pipe / no water' }, profile: { summary: 'A plumbing trade.', typicalServices: ['leak repair', 'water heaters', 'drain cleaning'], keyFields: [], bookingPosture: 'none' } }));
  const pl = composePack('plumber_demo');
  ok('future: a trade inherits ALL of home services (CMS, quote posture, licensing, evidence) declaring only its own',
    pl.cms.pages.includes('service_areas') && pl.profile.bookingPosture === 'quote' && pl.compliance.requirements.length > 0 && pl.vocabulary.book === 'request a quote' && pl.vocabulary.emergency === 'burst pipe / no water');
  ok('future: the home-services evidence provider fires for the trade (is-a)', industryIsA('plumber_demo', 'home_services'));
  const plEv = evidenceFrom([homeServicesProvider], site('plumber_demo')).map((e) => e.type);
  ok('future: a plumber site gets the home-services trust evidence, inherited', plEv.includes('business_info.home_services_service_area_missing'));
}

// ═══ 6. NO CROSS-CONTAMINATION between industries ═══
{
  ok('isolation: a restaurant gets NO coffee or home-services evidence', evidenceFrom([coffeeShopProvider, homeServicesProvider], site('restaurant')).length === 0);
  ok('isolation: a coffee shop gets NO home-services evidence', evidenceFrom([homeServicesProvider], site('coffee_shop')).length === 0);
  ok('isolation: a home-services site gets NO restaurant/coffee evidence', evidenceFrom([restaurantProvider, coffeeShopProvider], site('home_services')).length === 0);
  ok('isolation: a generic site gets NO pack evidence at all', evidenceFrom([restaurantProvider, coffeeShopProvider, homeServicesProvider], site('generic')).length === 0);
}

// ═══ 7. NO DUPLICATION — coffee doesn't restate restaurant's rules ═══
{
  ok('no-dup: coffee shop declares ONLY its own judgment rule (inherits restaurant’s via evidence, not copy)',
    COFFEE_SHOP_PACK.intelligence.judgmentRules.length === 1 && COFFEE_SHOP_PACK.intelligence.judgmentRules[0] === 'coffee_shop_workspace');
  // every pack evidence type is catalogued exactly once (no collision across the 3 packs)
  const types = [...COFFEE_SHOP_PACK.evidence.catalogTypes, ...HOME_SERVICES_PACK.evidence.catalogTypes];
  ok('no-dup: pack evidence types are catalogued and unique', types.every((t) => !!CATALOG[t]) && new Set(types).size === types.length);
}

// ═══ 8. REUSE MEASUREMENT — how much of Coffee Shop is Restaurant? ═══
{
  const c = composePack('coffee_shop');
  const own = COFFEE_SHOP_PACK; // declared-by-coffee only
  const inheritedPages = c.cms.pages.length - own.cms.pages.length;
  const reusePct = Math.round((inheritedPages / c.cms.pages.length) * 100);
  ok(`reuse: most of coffee shop's CMS is inherited from restaurant (~${reusePct}% pages inherited)`, reusePct >= 60, `${inheritedPages}/${c.cms.pages.length} pages inherited`);
  ok('reuse: coffee shop declares only a handful of its own fields (small delta)', own.cms.pages.length <= 5 && own.intelligence.judgmentRules.length <= 2);
}

// ═══ 9. PERFORMANCE across all four ═══
{
  const t0 = Date.now();
  for (let k = 0; k < 5000; k++) { composePack('restaurant'); composePack('coffee_shop'); composePack('generic'); composePack('home_services'); }
  const ms = Date.now() - t0;
  ok(`performance: 20k composes across 4 packs in ${ms}ms`, ms < 2000, `${ms}ms`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PACK EXPANSION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
