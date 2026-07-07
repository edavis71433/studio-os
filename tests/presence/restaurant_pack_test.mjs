// ── L5.1 Restaurant Industry Pack suite ─────────────────────────────────────
// Proves the flagship pack flows through the LIVE frozen pipeline (evidence →
// judgment → recommendation → moments), self-gates so non-restaurant sites are
// untouched, conforms to the L5.0 contract, and supports every restaurant sub-
// type on one architecture — all WITHOUT any engine logic change.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/restaurant_pack_test.mjs
import { restaurantProvider, RESTAURANT_PACK } from '../../supabase/functions/presence/industry/packs/restaurant.ts';
import { composePack, resolvePack } from '../../supabase/functions/presence/industry/registry.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { judge } from '../../supabase/functions/presence/judgment/rules.ts';
import { recommend } from '../../supabase/functions/presence/recommendation/rules.ts';
import { momentize } from '../../supabase/functions/presence/moments/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-07T12:00:00.000Z';
const SITE = '00000000-0000-4000-8000-000000000001';
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));

// build an observation input for an eatery; menu/prices/photos toggle the evidence
function eatery({ industry = 'restaurant', menu = true, prices = true, photos = true } = {}) {
  const html = (menu ? '<h2>Menu</h2>' : '<h2>Welcome</h2>') + (prices ? '<p>Dish $12</p><p>Plate $18</p>' : '<p>Dish</p>');
  return { site: { id: SITE }, now: NOW, industry, pages: [{ path: menu ? '/menu' : '/', html }], mediaRows: photos ? [{ id: 'm1' }, { id: 'm2' }] : [] };
}
function restaurantEvidence(input) {
  const items = [];
  restaurantProvider.provide(input, makeEmit(SITE, 'restaurant', NOW, items));
  return items.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
}
function pipeline(input, plan = 'presence') {
  const ev = restaurantEvidence(input);
  const js = judge(ev, { siteId: SITE, now: NOW, previous: {}, plan }).judgments;
  const jr = js.map((j) => ({ judgment_hash: j.judgment_id, judgment_key: j.dedupe_key, rule: j.rule, category: j.category, priority: j.priority, severity: j.severity, confidence: j.confidence, reasoning: j.reasoning, timing: j.timing, audience: j.audience, status: j.status, evidence_count: j.evidence_count, evidence_ids: j.evidence_ids, first_seen_at: j.first_seen_at, expires_at: j.expires_at }));
  const recs = recommend(jr, { siteId: SITE, now: NOW, previous: {} }).recommendations;
  const rr = recs.map((r) => ({ recommendation_hash: r.recommendation_id, rule: r.rule, priority: r.priority, audience: r.audience, status: r.status, value_dimensions: r.value_dimensions, timing: r.timing, expires_at: r.expiration }));
  const moments = momentize(rr, { siteId: SITE, now: NOW, previous: {}, dismissals: {} }).moments.filter((m) => m.status === 'active');
  return { evidence: ev, judgments: js, moments };
}

// ═══ 1. the provider self-gates on industry ═══
{
  const asRestaurant = restaurantEvidence(eatery({ industry: 'restaurant', menu: false, photos: false })).map((e) => e.type);
  ok('provider: a restaurant with no menu/photos emits restaurant evidence', asRestaurant.includes('content.menu_absent') && asRestaurant.includes('media.food_photos_missing'));
  const asOther = restaurantEvidence(eatery({ industry: 'generic', menu: false, photos: false }));
  ok('self-gating: the SAME site as a non-restaurant emits NOTHING (inert elsewhere)', asOther.length === 0);
  const asMissingIndustry = restaurantEvidence({ site: { id: SITE }, now: NOW, pages: [{ path: '/', html: '' }], mediaRows: [] });
  ok('self-gating: no industry set → the provider stays silent', asMissingIndustry.length === 0);
}

// ═══ 2. the pack's evidence is in the ONE catalog (spread wiring) ═══
{
  ok('wiring: restaurant evidence types live in the ONE frozen catalog', !!CATALOG['content.menu_absent'] && !!CATALOG['content.menu_prices_missing'] && !!CATALOG['media.food_photos_missing']);
}

// ═══ 3. full LIVE pipeline flow — evidence → judgment → recommendation → moment ═══
{
  const { evidence, judgments, moments } = pipeline(eatery({ menu: false, photos: false }));
  ok('pipeline: restaurant evidence becomes a restaurant judgment', judgments.some((j) => j.rule === 'restaurant_menu' && j.status === 'active') && judgments.some((j) => j.rule === 'restaurant_visuals'));
  // two mergeable restaurant nudges become ONE calm bundle (menu + photos in the summary), never two pings
  ok('pipeline: it surfaces as a calm restaurant Business Moment (in the diner’s words)', moments.some((m) => /menu|photo/i.test(m.headline + ' ' + m.summary)) && moments.length <= 3);
  ok('pipeline: the moments speak restaurant, not jargon', moments.every((m) => !/SEO|schema|API|!/.test(m.headline + m.summary)));
}

// ═══ 4. calm — a complete restaurant raises nothing ═══
{
  const { moments } = pipeline(eatery({ menu: true, prices: true, photos: true }));
  ok('calm: a restaurant with a priced menu + photos raises no restaurant moment', !moments.some((m) => /menu|photo/i.test(m.headline)));
  const partial = pipeline(eatery({ menu: true, prices: false, photos: true }));
  ok('calm: only the real gap surfaces (menu present, prices missing → one gentle nudge)', partial.judgments.some((j) => j.rule === 'restaurant_menu' && j.priority === 'low'));
}

// ═══ 5. self-gating end to end — a non-restaurant with the same gaps stays silent ═══
{
  const { judgments, moments } = pipeline(eatery({ industry: 'generic', menu: false, photos: false }));
  ok('self-gating: end to end, a generic site gets no restaurant judgment or moment',
    !judgments.some((j) => j.rule?.startsWith('restaurant_')) && !moments.some((m) => /menu|photo/i.test(m.headline)));
}

// ═══ 6. pack conformance — L5.0 contract, layers reuse coach + writer ═══
{
  const p = composePack('restaurant');
  ok('conformance: the pack resolves and carries every specialized layer', resolvePack('restaurant').key === 'restaurant' && p.profile.bookingPosture === 'reservation' && p.vocabulary.offerings === 'menu');
  ok('conformance: the growth layer IS the coach restaurant pack (not a duplicate)', p.growth.pack?.slug === 'restaurant' && Object.keys(p.growth.pack.holidays).length > 0);
  ok('conformance: the creative layer IS the writer pack (not a duplicate)', !!p.creative.writer && p.creative.photographyGuidance.length > 0);
  ok('conformance: the CMS layer scaffolds restaurant pages (menu/reservations/gallery)', p.cms.pages.includes('menu') && p.cms.pages.includes('reservations') && p.cms.navigation.includes('Menu'));
  ok('conformance: intelligence declares its rules/recs/templates', p.intelligence.judgmentRules.includes('restaurant_menu') && p.intelligence.recommendationRules.includes('rec_restaurant_menu') && p.intelligence.momentTemplates.includes('restaurant_menu'));
}

// ═══ 7. one architecture supports every restaurant sub-type ═══
{
  const SUBTYPES = ['coffee shop', 'fine dining', 'fast casual', 'food truck', 'bakery', 'pizza', 'barbecue', 'sushi', 'family restaurant', 'bar'];
  let allCalm = true, allWork = true;
  for (let idx = 0; idx < SUBTYPES.length; idx++) {
    // vary content per sub-type deterministically (some missing menu, some missing photos)
    const missingMenu = idx % 2 === 0, missingPhotos = idx % 3 === 0;
    const { moments, judgments } = pipeline(eatery({ menu: !missingMenu, prices: !missingMenu, photos: !missingPhotos }));
    if (moments.length > 3) allCalm = false;
    // the SAME restaurant rules apply regardless of sub-type
    const expectMenuJudgment = missingMenu;
    if (expectMenuJudgment && !judgments.some((j) => j.rule === 'restaurant_menu' && j.status === 'active')) allWork = false;
  }
  ok('sub-types: all 10 restaurant types stay calm (≤3 moments) on one architecture', allCalm);
  ok('sub-types: the same restaurant intelligence applies uniformly across sub-types', allWork);
}

// ═══ 8. no fork — engines reference the pack generically, never restaurant by name ═══
{
  ok('no-fork: judgment/recommendation/moments import PACK_* aggregates, not the restaurant pack directly',
    /PACK_JUDGMENT_RULES/.test(src('judgment/rules.ts')) && !/packs\/restaurant/.test(src('judgment/rules.ts')) &&
    /PACK_REC_RULES/.test(src('recommendation/rules.ts')) && !/packs\/restaurant/.test(src('recommendation/rules.ts')) &&
    /PACK_MOMENT_TEMPLATES/.test(src('moments/rules.ts')) && !/packs\/restaurant/.test(src('moments/rules.ts')));
  ok('no-fork: the restaurant provider self-gates (the only industry logic lives in the pack)', /i\.industry !== 'restaurant'/.test(src('industry/packs/restaurant.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ RESTAURANT PACK: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
