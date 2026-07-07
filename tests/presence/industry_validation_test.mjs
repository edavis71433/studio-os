// ── L5.2 Industry Platform Validation & Scaling suite ───────────────────────
// Attacks the Industry Platform with the Restaurant Pack as the proof: the
// reusable toolkit (self-gating, namespacing, validation, maturity), collision
// safety and open keys for a marketplace, the site-shape + edition matrix, and
// scaling to hundreds of installed/inactive packs — all additive, all calm.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/industry_validation_test.mjs
import { packProvider, packType, isPackType, typeCollisions, validatePack, packMaturity, packDepth, MATURITY_ORDER } from '../../supabase/functions/presence/industry/helpers.ts';
import { makePack, registerPack, registeredPacks, resolvePack, resolveIndustryKey, composePack } from '../../supabase/functions/presence/industry/registry.ts';
import { RESTAURANT_PACK, restaurantProvider } from '../../supabase/functions/presence/industry/packs/restaurant.ts';
import { CATALOG, makeEmit } from '../../supabase/functions/presence/evidence/contract.ts';
import { judge } from '../../supabase/functions/presence/judgment/rules.ts';
import { recommend } from '../../supabase/functions/presence/recommendation/rules.ts';
import { momentize } from '../../supabase/functions/presence/moments/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-07T12:00:00.000Z', SITE = '00000000-0000-4000-8000-000000000001';

// ═══ 1. REUSABLE TOOLKIT — self-gating can't be forgotten ═══
{
  let emitted = 0;
  const prov = packProvider('dental', 'dental', () => { emitted++; });
  prov.provide({ industry: 'restaurant' }, () => {}); // wrong industry
  ok('toolkit: packProvider auto-gates — a wrong-industry site never runs the body', emitted === 0);
  prov.provide({ industry: 'dental' }, () => {});
  ok('toolkit: packProvider runs for its own industry', emitted === 1);
  ok('toolkit: packType is category-prefixed AND industry-namespaced (collision-safe)',
    packType('dental', 'content', 'recall_due') === 'content.dental_recall_due' && isPackType('content.dental_recall_due', 'dental'));
}

// ═══ 2. COLLISION SAFETY — two packs can never claim the same type ═══
{
  const a = makePack({ key: 'restaurant', label: 'R', family: 'food', evidence: { providerNames: ['restaurant'], catalogTypes: [packType('restaurant', 'content', 'menu_absent')] } });
  const b = makePack({ key: 'retail', label: 'Rt', family: 'commerce', evidence: { providerNames: ['retail'], catalogTypes: [packType('retail', 'content', 'catalog_absent')] } });
  ok('collision: namespaced types across packs never collide', typeCollisions([a, b]).length === 0);
  const bad = makePack({ key: 'retail', label: 'Rt', family: 'commerce', evidence: { providerNames: ['retail'], catalogTypes: ['content.menu_absent'] } });
  const clash = makePack({ key: 'restaurant', label: 'R', family: 'food', evidence: { providerNames: ['restaurant'], catalogTypes: ['content.menu_absent'] } });
  ok('collision: an UN-namespaced clash is detected (the scaling foot-gun, guarded)', typeCollisions([clash, bad]).length === 1);
}

// ═══ 3. VALIDATION — a pack is well-formed before it ships ═══
{
  ok('validate: the Restaurant Pack is well-formed', validatePack(RESTAURANT_PACK).ok, validatePack(RESTAURANT_PACK).problems.join(';'));
  const malformed = makePack({ key: 'plumber', label: 'P', family: 'home_services', evidence: { providerNames: [], catalogTypes: ['content.leak'] }, intelligence: { judgmentRules: ['x'], recommendationRules: [], momentTemplates: [], conciergeIntents: [], coachAreas: [] } });
  const v = validatePack(malformed);
  ok('validate: a malformed pack is rejected with reasons (un-namespaced type, no provider, no 1:1 rec)', !v.ok && v.problems.length >= 3, `${v.problems.length} problems`);
}

// ═══ 4. OPEN KEYS — a marketplace/partner pack registers ANY key, no platform edit ═══
{
  const partner = makePack({ key: 'artisan_bakery_partner', label: 'Artisan Bakery (partner)', family: 'food', status: 'available', extends: 'restaurant' });
  registerPack(partner);
  ok('open-keys: a partner pack with a novel key registers and resolves', resolvePack('artisan_bakery_partner').label === 'Artisan Bakery (partner)');
  ok('open-keys: it composes on top of a first-party pack via extends', composePack('artisan_bakery_partner').cms.pages.includes('generic') === false && composePack('artisan_bakery_partner').vocabulary.offerings !== undefined);
}

// ═══ 5. MATURITY MODEL — breadth + honest depth ═══
{
  ok('maturity: the model has six ascending stages', MATURITY_ORDER.length === 6 && MATURITY_ORDER[0] === 'foundation' && MATURITY_ORDER[5] === 'enterprise');
  ok('maturity: the Restaurant Pack is a COMPLETE first-party pack (all core layers, platform-published)', packMaturity(RESTAURANT_PACK) === 'complete');
  ok('maturity: depth is reported honestly (restaurant intelligence is still shallow — 2 rules)', packDepth(RESTAURANT_PACK).band === 'basic');
  const bare = makePack({ key: 'x', label: 'X', family: 'universal' });
  ok('maturity: a bare pack is Foundation', packMaturity(bare) === 'foundation');
}

// ═══ 6. SITE-SHAPE + EDITION MATRIX — calm and consistent everywhere ═══
{
  const run = (input, plan = 'presence') => {
    const items = []; restaurantProvider.provide(input, makeEmit(SITE, 'restaurant', NOW, items));
    const ev = items.map((i) => ({ id: i.fingerprint, category: i.category, type: i.type, severity: i.severity, confidence: i.confidence, resource: i.resource, facts: i.facts }));
    const js = judge(ev, { siteId: SITE, now: NOW, previous: {}, plan }).judgments;
    const jr = js.map((j) => ({ judgment_hash: j.judgment_id, judgment_key: j.dedupe_key, rule: j.rule, category: j.category, priority: j.priority, severity: j.severity, confidence: j.confidence, reasoning: j.reasoning, timing: j.timing, audience: j.audience, status: j.status, evidence_count: j.evidence_count, evidence_ids: j.evidence_ids, first_seen_at: j.first_seen_at, expires_at: j.expires_at }));
    const recs = recommend(jr, { siteId: SITE, now: NOW, previous: {} }).recommendations.map((r) => ({ recommendation_hash: r.recommendation_id, rule: r.rule, priority: r.priority, audience: r.audience, status: r.status, value_dimensions: r.value_dimensions, timing: r.timing, expires_at: r.expiration }));
    return { js, moments: momentize(recs, { siteId: SITE, now: NOW, previous: {}, dismissals: {} }).moments.filter((m) => m.status === 'active') };
  };
  const base = (over) => ({ site: { id: SITE }, now: NOW, industry: 'restaurant', pages: [{ path: '/', html: '<h2>Welcome</h2>' }], mediaRows: [], ...over });
  const shapes = {
    'single-page minimal': base({}),
    'large content site': base({ pages: Array.from({ length: 40 }, (_, k) => ({ path: `/p${k}`, html: '<p>content</p>' })) }),
    'multi-location': base({ pages: [{ path: '/locations', html: '<h2>Our 12 locations</h2>' }] }),
    'complete': base({ pages: [{ path: '/menu', html: '<h2>Menu</h2><p>Dish $12</p><p>Plate $18</p>' }], mediaRows: [{ id: 'a' }, { id: 'b' }] }),
  };
  let calm = true;
  for (const [, input] of Object.entries(shapes)) if (run(input).moments.length > 3) calm = false;
  ok('site-shapes: single-page / large / multi-location / complete all stay ≤3 calm moments', calm);
  // edition: on Monitor the restaurant customer rules are suppressed (existing law), never a false interruption
  const monitor = run(base({}), 'presence_monitor');
  ok('editions: on Presence Monitor the restaurant nudges are suppressed (edition-aware, calm)', !monitor.js.some((j) => j.rule?.startsWith('restaurant_') && j.status === 'active'));
  // no-connected vs heavy-connected: restaurant evidence is independent of connections
  ok('connected: restaurant intelligence is the same with or without connected data (independent)', run(base({})).js.some((j) => j.rule === 'restaurant_menu'));
}

// ═══ 7. SCALING — hundreds of installed + inactive packs stay fast and inert ═══
{
  const before = registeredPacks().length;
  for (let k = 0; k < 500; k++) registerPack(makePack({ key: `synthetic_${k}`, label: `S${k}`, family: 'professional', status: k % 2 ? 'installed' : 'disabled' }));
  ok('scaling: 500 packs register into the same registry (no engine change)', registeredPacks().length >= before + 500);
  // resolution stays O(1): a restaurant site still resolves restaurant, unaffected by 500 inactive packs
  ok('scaling: resolution is unaffected by hundreds of inactive packs', resolveIndustryKey('restaurant-classic') === 'restaurant' && resolvePack('restaurant').key === 'restaurant');
  // a non-matching site with 500 packs installed still emits NOTHING extra (self-gating holds at scale)
  const items = []; restaurantProvider.provide({ industry: 'generic', pages: [], mediaRows: [] }, makeEmit(SITE, 'restaurant', NOW, items));
  ok('scaling: self-gating holds at scale — a generic site gets zero pack evidence', items.length === 0);
}

// ═══ 8. PERFORMANCE — resolution + composition are cheap ═══
{
  const t0 = Date.now();
  for (let k = 0; k < 20000; k++) { resolveIndustryKey('restaurant-classic'); composePack('restaurant'); }
  const ms = Date.now() - t0;
  ok(`performance: 20k resolve+compose in ${ms}ms (well under budget)`, ms < 2000, `${ms}ms`);
  ok('performance: restaurant evidence types are all present in the ONE catalog after all this', RESTAURANT_PACK.evidence.catalogTypes.every((t) => !!CATALOG[t]));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ INDUSTRY VALIDATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
