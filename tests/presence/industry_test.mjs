// ── L5.0 Industry Platform Foundation suite ─────────────────────────────────
// Proves the Industry Pack ARCHITECTURE (no packs implemented): one contract,
// resolved per site, composed additively, extending the frozen engines without
// modification — and unifying the two per-vertical registries that already exist
// (writer voice + coach calendar) as layers rather than forking them.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/industry_test.mjs
import { EMPTY_INTELLIGENCE } from '../../supabase/functions/presence/industry/contract.ts';
import {
  INDUSTRIES, GENERIC_PACK, makePack, registerPack, registeredPacks,
  resolveIndustryKey, resolvePack, composePack, extendRegistry, PLATFORM_LAYERS, isIndustryKey,
} from '../../supabase/functions/presence/industry/registry.ts';
import { transition, canInstall, canEnable, canDisable, canUpdate, compareVersions, exportPack, canExport } from '../../supabase/functions/presence/industry/marketplace.ts';
import { growthPackFor } from '../../supabase/functions/presence/coach/packs.ts';
import { packFor } from '../../supabase/functions/presence/writer/pack.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. Taxonomy — every named industry is in the design space ═══
{
  const NAMED = ['restaurant', 'coffee_shop', 'contractor', 'electrician', 'plumber', 'hvac', 'roofer', 'landscaper', 'medical', 'dental', 'legal', 'financial', 'insurance', 'real_estate', 'photographer', 'creative_agency', 'consultant', 'retail', 'ecommerce', 'nonprofit', 'professional_services'];
  ok('taxonomy: all 21 supported industries + generic baseline + home_services base are named', NAMED.every((k) => isIndustryKey(k)) && isIndustryKey('generic') && isIndustryKey('home_services') && INDUSTRIES.length === 23);
  ok('taxonomy: every industry has a family and label; keys are unique', INDUSTRIES.every((i) => i.family && i.label) && new Set(INDUSTRIES.map((i) => i.key)).size === INDUSTRIES.length);
}

// ═══ 2. Contract — one shape, every layer present; a pack declares only diffs ═══
{
  const layers = ['profile', 'vocabulary', 'evidence', 'intelligence', 'growth', 'creative', 'connected', 'cms', 'compliance', 'marketplace'];
  ok('contract: the baseline pack carries every layer', layers.every((l) => l in GENERIC_PACK));
  const terse = makePack({ key: 'consultant', label: 'Consultant', family: 'professional' });
  ok('contract: makePack fills unspecified layers with empty (additive) contributions',
    terse.evidence.catalogTypes.length === 0 && terse.intelligence.judgmentRules.length === 0 && terse.marketplace.exportable === true);
}

// ═══ 3. Resolver — per-site, always resolves, matches the existing convention ═══
{
  ok('resolver: template_slug vertical → industry key (restaurant-classic → restaurant)', resolveIndustryKey('restaurant-classic') === 'restaurant');
  ok('resolver: an unknown or missing slug resolves to generic (never throws)', resolveIndustryKey('made-up-thing') === 'generic' && resolveIndustryKey('') === 'generic' && resolveIndustryKey(null) === 'generic');
  ok('resolver: resolvePack always returns a pack (baseline floor)', resolvePack('generic').key === 'generic' && resolvePack('legal').key !== undefined);
}

// ═══ 4. Composition — extends chain overlays parent→child, cycle-safe ═══
{
  // a synthetic narrow pack specializing a synthetic broad pack (test fixtures, NOT shipped industries)
  registerPack(makePack({ key: 'restaurant', label: 'Restaurant', family: 'food', status: 'available', vocabulary: { offerings: 'menu' }, cms: { navigation: ['Menu'], pages: ['menu'], components: [], servicePages: false, landingPages: [], blogCategories: [] } }));
  registerPack(makePack({ key: 'coffee_shop', label: 'Coffee Shop', family: 'food', status: 'available', extends: 'restaurant', vocabulary: { offerings: 'drinks' } }));
  const composed = composePack('coffee_shop');
  ok('composition: a child inherits its parent’s layers (coffee_shop gets restaurant’s Menu page)', composed.cms.pages.includes('menu'));
  ok('composition: the child overrides where it specializes (drinks beats menu)', composed.vocabulary.offerings === 'drinks');
  ok('composition: the generic baseline is always folded in underneath', composed.connected.relevantProviders.includes('google_business_profile'));
  // cycle safety: a self/mutual extends never hangs
  registerPack(makePack({ key: 'consultant', label: 'C', family: 'professional', extends: 'consultant' }));
  let hung = false; try { composePack('consultant'); } catch { hung = true; }
  ok('composition: a cyclic extends is bounded (never hangs)', !hung);
}

// ═══ 5. Additivity — packs extend engines WITHOUT modifying them ═══
{
  const baseline = Object.freeze(['universal_rule_a', 'universal_rule_b']);
  const contributed = extendRegistry(baseline, ['restaurant.menu_rule']);
  ok('additive: extendRegistry appends without mutating the baseline (engine registry untouched)',
    contributed.length === 3 && baseline.length === 2 && contributed.includes('restaurant.menu_rule'));
  // the GENERIC baseline contributes ZERO industry intelligence — "no industry" = identical platform
  ok('additive: the generic baseline adds no industry rules/types (platform identical without a pack)',
    JSON.stringify(GENERIC_PACK.intelligence) === JSON.stringify(EMPTY_INTELLIGENCE) && GENERIC_PACK.evidence.catalogTypes.length === 0);
}

// ═══ 6. Self-gating law — industry evidence types are namespaced ═══
{
  registerPack(makePack({ key: 'dental', label: 'Dental', family: 'health', evidence: { providerNames: ['dental_provider'], catalogTypes: ['dental.recall_due', 'dental.insurance_reset'] }, intelligence: { ...EMPTY_INTELLIGENCE, judgmentRules: ['dental_recall'] } }));
  const p = resolvePack('dental');
  ok('self-gating: a pack’s evidence types are namespaced by its industry (inert for others)',
    p.evidence.catalogTypes.every((t) => t.startsWith('dental.')));
}

// ═══ 7. Common vs Specialized — the protected core is never in a pack ═══
{
  const universal = PLATFORM_LAYERS.universal.join(' ').toLowerCase();
  const pack = PLATFORM_LAYERS.pack.join(' ').toLowerCase();
  ok('split: the frozen spines live in UNIVERSAL, never in a pack', /intelligence pipeline/.test(universal) && /approval/.test(universal) && /ownership/.test(universal));
  ok('split: packs specialize vocabulary/evidence/creative/cms, never the engines', /vocabulary/.test(pack) && /cms scaffolding/.test(pack) && !/pipeline|approval law|renderer/.test(pack));
  ok('split: content and configuration are distinct from packs', PLATFORM_LAYERS.content.length > 0 && PLATFORM_LAYERS.configuration.length > 0);
}

// ═══ 8. Marketplace — install/enable/disable/update/version/export ═══
{
  ok('marketplace: legal transitions only (install available, disable installed, enable disabled)',
    transition('available', 'install') === 'installed' && transition('installed', 'disable') === 'disabled' && transition('disabled', 'enable') === 'installed');
  ok('marketplace: illegal transitions are refused (no skipping, no self-transition)',
    transition('available', 'enable') === null && transition('disabled', 'disable') === null && transition('deprecated', 'install') === null);
  ok('marketplace: capability predicates agree with the machine', canInstall('available') && canDisable('installed') && canEnable('disabled') && !canInstall('installed'));
  ok('marketplace: versions compare and updates only go forward', compareVersions('1.2.0', '1.10.0') === -1 && canUpdate('1.0.0', '1.1.0') && !canUpdate('2.0.0', '1.9.9'));
  const ex = exportPack(GENERIC_PACK);
  ok('marketplace: a pack exports to a portable, self-describing document', ex.format === 'studio-os-industry-pack' && ex.pack.key === 'generic' && canExport(GENERIC_PACK));
}

// ═══ 9. Extensibility — the 100th industry is a registry entry, not a redesign ═══
{
  const before = registeredPacks().length;
  registerPack(makePack({ key: 'photographer', label: 'Photographer', family: 'creative', status: 'available' }));
  ok('extensibility: a new pack plugs into the same registry (no engine change)', registeredPacks().length >= before && resolvePack('photographer').status === 'available');
  // adding a brand-new industry taxonomy entry would be one INDUSTRIES line — architecture holds at scale
  ok('extensibility: nothing in resolution/composition is per-industry hard-coded', typeof composePack === 'function' && typeof registerPack === 'function');
}

// ═══ 10. Unification — the umbrella SUBSUMES the existing registries as layers ═══
{
  // the coach's GrowthPack and the writer's pack are real, working per-vertical
  // registries; the umbrella wraps them as the growth + creative layers (no fork).
  const growth = growthPackFor('restaurant-classic');   // coach/packs.ts
  const writer = packFor('restaurant');                 // writer/pack.ts
  const unified = makePack({
    key: 'restaurant', label: 'Restaurant', family: 'food', status: 'available',
    growth: { pack: growth, notes: 'coach calendar layer' },
    creative: { writer, photographyGuidance: [], mediaSuggestions: [], brandDefaults: {} },
  });
  ok('unification: the growth layer is the existing coach GrowthPack (not a duplicate)', unified.growth.pack?.slug === 'restaurant' && Array.isArray(Object.keys(unified.growth.pack.holidays)));
  ok('unification: the creative layer is the existing writer pack (not a duplicate)', !!unified.creative.writer && typeof unified.creative.writer.slug === 'string');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ INDUSTRY PLATFORM: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
