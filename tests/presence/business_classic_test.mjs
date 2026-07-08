// ── Phase T3: business-classic template suite ────────────────────────────────
// Proves THE industry realization: one render, correct vocabulary + schema per
// industry. A plumber site says "Services" and emits @type:Plumber; a salon gets
// HairSalon; a restaurant on this template still gets Menu/@type:Restaurant.
// Plus the production contract: file set, a11y basics, form fix (honeypot +
// thanks), announcement/logo, sitemap/robots, determinism.
//
//   deno run --allow-read --allow-env tests/presence/business_classic_test.mjs
import { getTemplate, renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const fixture = JSON.parse(await Deno.readTextFile(new URL('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json', ROOT)));
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://fn.example.com/forms/x/submit' };

function snapFor(industry, extraSettings = {}) {
  const s = structuredClone(fixture);
  s.template_slug = 'business-classic'; s.template_version = '1.0.0';
  s.content.settings = { ...(s.content.settings || {}), industry, ...extraSettings };
  return s;
}
const render = (industry, extra) => renderSnapshot(snapFor(industry, extra), SITE);

// ═══ 1. registered + contract ═══
{
  const t = getTemplate('business-classic', '1.0.0');
  ok('registered in the registry with a manifest', !!t && t.manifest.slug === 'business-classic' && t.manifest.content_contract_version === 1);
}

// ═══ 2. plumber: Services vocabulary + Plumber schema (the fix, rendered) ═══
{
  const f = render('plumber');
  ok('plumber: /services/ page exists, no /menu/', 'services/index.html' in f && !('menu/index.html' in f));
  const home = f['index.html'];
  ok('plumber: @type Plumber on the home page', home.includes('"@type":"Plumber"'));
  ok('plumber: no Restaurant/Menu schema anywhere', !home.includes('"@type":"Restaurant"') && !f['services/index.html'].includes('MenuItem'));
  ok('plumber: nav says Services, not Menu', home.includes('>Services</a>') && !home.includes('>Menu</a>'));
  ok('plumber: offerings page emits ItemList of Service', f['services/index.html'].includes('"@type":"ItemList"') && f['services/index.html'].includes('"@type":"Service"'));
}

// ═══ 3. other industries flip correctly from the SAME render ═══
{
  ok('salon → HairSalon', render('salon')['index.html'].includes('"@type":"HairSalon"'));
  ok('retail → Store + Products page', (() => { const f = render('retail'); return f['index.html'].includes('"@type":"Store"') && 'products/index.html' in f; })());
  ok('restaurant on business-classic → Restaurant + Menu vocabulary', (() => { const f = render('restaurant'); return f['index.html'].includes('"@type":"Restaurant"') && 'menu/index.html' in f && f['menu/index.html'].includes('MenuItem'); })());
  ok('unknown/generic → LocalBusiness (safe)', render('generic')['index.html'].includes('"@type":"LocalBusiness"'));
}

// ═══ 4. production contract: files, a11y, SEO plumbing ═══
{
  const f = render('plumber');
  const expected = ['index.html', 'services/index.html', 'about/index.html', 'faq/index.html', 'contact/index.html', 'thanks/index.html', 'updates/index.html', '404.html', 'favicon.svg', 'sitemap.xml', 'robots.txt'];
  ok('full production file set', expected.every((k) => k in f), expected.filter((k) => !(k in f)).join(','));
  // full pages only — redirect stubs are intentionally-minimal meta-refresh files
  const pages = Object.entries(f).filter(([k, v]) => k.endsWith('.html') && !String(v).includes('http-equiv="refresh"')).map(([k, v]) => [k, String(v)]);
  ok('every page: lang + skip link + main landmark + single h1', pages.every(([, h]) => h.includes('lang="en"') && h.includes('class="skip"') && h.includes('<main id="main">') && (h.match(/<h1[\s>]/g) || []).length === 1));
  ok('every page: title + description + canonical + og:title', pages.every(([, h]) => h.includes('<title>') && h.includes('name="description"') && h.includes('rel="canonical"') && h.includes('og:title')));
  ok('aria-current marks the active nav item', pages.filter(([k]) => k !== '404.html' && k !== 'thanks/index.html').every(([, h]) => h.includes('aria-current="page"')));
  ok('sitemap lists /services/ (not /menu/, not /thanks/)', f['sitemap.xml'].includes('/services/') && !f['sitemap.xml'].includes('/menu/') && !f['sitemap.xml'].includes('/thanks/'));
  ok('robots disallows /thanks/ + points at the sitemap', f['robots.txt'].includes('Disallow: /thanks/') && f['robots.txt'].includes('sitemap.xml'));
  ok('zero JavaScript emitted (pure static)', pages.every(([, h]) => !/<script(?! type="application\/ld\+json")/.test(h)));
}

// ═══ 5. the Phase-V essentials carry over ═══
{
  const f = render('plumber', { announcement: { text: 'Closed July 4th', expires_at: null }, });
  ok('announcement bar renders site-wide', f['index.html'].includes('class="annbar"') && f['about/index.html'].includes('Closed July 4th'));
  const contact = render('plumber')['contact/index.html'];
  ok('form: honeypot + hidden kind/source + posts to the endpoint', contact.includes('name="_hp"') && contact.includes('name="form_kind"') && contact.includes(SITE.formEndpoint));
  ok('thanks page: noindex + calm copy', render('plumber')['thanks/index.html'].includes('name="robots" content="noindex"'));
}

// ═══ 6. determinism ═══
{
  const a = render('plumber'), b = render('plumber');
  ok('same snapshot → same bytes', JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && a['index.html'] === b['index.html'] && a['sitemap.xml'] === b['sitemap.xml']);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
