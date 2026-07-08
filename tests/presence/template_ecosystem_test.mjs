// ── Phase T template-ecosystem suite ─────────────────────────────────────────
// Proves the templates-as-data primitives: industry vocabulary emits the CORRECT
// schema.org type + vocabulary per industry (the fix for "@type: Restaurant on a
// plumber"), and the structured component catalog is well-formed (every block
// declares fields + a11y + schema role). These are what let hundreds of templates
// exist as data, not code.
//
//   deno run --allow-read --allow-env tests/presence/template_ecosystem_test.mjs
import { vocabFor, isKnownIndustry, allIndustryKeys, templateSlugForIndustry } from '../../supabase/functions/presence/lib/industry_vocab.ts';
import { COMPONENTS, componentByKey, componentsForIndustry, componentFields } from '../../supabase/functions/presence/lib/site_components.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. industry vocabulary — CORRECT schema + words per industry (the fix) ═══
{
  ok('restaurant → Restaurant + Menu (unchanged, correct)', (() => { const v = vocabFor('restaurant'); return v.schemaType === 'Restaurant' && v.offeringLabel === 'Menu' && v.isMenu; })());
  ok('plumber → Plumber schema + Services (NOT Restaurant/Menu — the bug fix)', (() => { const v = vocabFor('plumber'); return v.schemaType === 'Plumber' && v.offeringLabel === 'Services' && !v.isMenu; })());
  ok('salon → HairSalon + Services', (() => { const v = vocabFor('salon'); return v.schemaType === 'HairSalon' && v.offeringLabel === 'Services'; })());
  ok('retail → Store + Products', (() => { const v = vocabFor('retail'); return v.schemaType === 'Store' && v.offeringLabel === 'Products' && v.offeringItemSchema === 'Product'; })());
  ok('law → Attorney; dental → Dentist; fitness → HealthClub + Classes', vocabFor('law').schemaType === 'Attorney' && vocabFor('dental').schemaType === 'Dentist' && vocabFor('fitness').schemaType === 'HealthClub' && vocabFor('fitness').offeringLabel === 'Classes');
  ok('unknown / generic → LocalBusiness + Services (safe neutral default)', vocabFor('zzz').schemaType === 'LocalBusiness' && vocabFor('generic').schemaType === 'LocalBusiness' && vocabFor(null).offeringLabel === 'Services');
  ok('every industry has a non-empty offering path + primary action', allIndustryKeys().every((k) => { const v = vocabFor(k); return v.offeringPath.startsWith('/') && v.primaryAction.length > 1; }));
  ok('a broad set of industries covered (not restaurant-only)', allIndustryKeys().length >= 25 && isKnownIndustry('home_services') && isKnownIndustry('medical') && isKnownIndustry('nonprofit'));
}

// ═══ 2. template resolution by industry (default-template-as-data) ═══
{
  ok('food industries → the shipped restaurant template', templateSlugForIndustry('restaurant') === 'restaurant-classic' && templateSlugForIndustry('coffee_shop') === 'restaurant-classic');
  ok('non-food industries → the neutral business template', templateSlugForIndustry('plumber') === 'business-classic' && templateSlugForIndustry('law') === 'business-classic' && templateSlugForIndustry('generic') === 'business-classic');
}

// ═══ 3. component catalog — well-formed structured blocks ═══
{
  ok('a broad component library (~30 blocks)', COMPONENTS.length >= 25);
  ok('every component declares key/label/category/purpose/fields/a11y/seo', COMPONENTS.every((c) => c.key && c.label && c.category && c.purpose && Array.isArray(c.fields) && c.a11y && c.seo && Array.isArray(c.industries)));
  ok('every component has at least one field', COMPONENTS.every((c) => c.fields.length >= 1));
  ok('every field has a key + a valid type', COMPONENTS.every((c) => c.fields.every((f) => f.key && ['text', 'richtext', 'url', 'email', 'phone', 'image', 'number', 'time', 'list', 'enum', 'boolean'].includes(f.type))));
  ok('component keys are unique', new Set(COMPONENTS.map((c) => c.key)).size === COMPONENTS.length);
  ok('the milestone core blocks exist', ['hero', 'services', 'testimonials', 'faq', 'team', 'gallery', 'hours', 'location', 'cta', 'lead_form', 'reviews', 'menu', 'products'].every((k) => componentByKey(k)));
  ok('lead_form + faq + testimonials carry the right schema role', componentByKey('lead_form').schema === 'ContactPoint' && componentByKey('faq').schema === 'FAQPage' && componentByKey('testimonials').schema === 'Review');
  ok('every block states an accessibility contract', COMPONENTS.every((c) => c.a11y.length > 10));
}

// ═══ 4. industry ↔ component fit (right blocks per industry) ═══
{
  ok('universal blocks appear for any industry', componentsForIndustry('plumber').some((c) => c.key === 'hero') && componentsForIndustry('plumber').some((c) => c.key === 'services'));
  ok('service_areas surfaces for home-service trades, not restaurants', componentsForIndustry('plumber').some((c) => c.key === 'service_areas') && !componentsForIndustry('restaurant').some((c) => c.key === 'service_areas'));
  ok('menu surfaces for food, not for a law firm', componentsForIndustry('restaurant').some((c) => c.key === 'menu') && !componentsForIndustry('law').some((c) => c.key === 'menu'));
  ok('componentFields returns a component\'s fields', componentFields('hero').some((f) => f.key === 'headline') && componentFields('nope').length === 0);
}

// ═══ 5. AI + approval posture is data, not ad-hoc ═══
{
  ok('AI-assistable fields are flagged (writer knows what it may draft)', componentByKey('hero').fields.some((f) => f.aiAssist) && componentByKey('services').fields.some((f) => f.aiAssist));
  ok('presentational blocks emit no schema (null), content blocks do', componentByKey('cta').schema === null && componentByKey('faq').schema !== null);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
