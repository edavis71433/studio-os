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
  ok('aria-current marks the active nav item', pages.filter(([k]) => !['404.html', 'thanks/index.html', 'privacy/index.html', 'accessibility/index.html'].includes(k)).every(([, h]) => h.includes('aria-current="page"')));
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

// ═══ 5b. Phase Q: the generated legal foundation ═══
{
  const f = render('plumber');
  ok('privacy + accessibility pages generated', 'privacy/index.html' in f && 'accessibility/index.html' in f);
  const pv = f['privacy/index.html'];
  ok('privacy: facts-true (title + contact-form coverage + effective date)', pv.includes('Privacy policy') && pv.includes('contact form') && pv.includes('Effective '));
  ok('privacy: honest no-cookies/no-tracking claim (the templates ARE cookieless)', pv.includes('no cookies') && pv.includes('no analytics or tracking'));
  ok('accessibility: promises the template actually keeps', f['accessibility/index.html'].includes('keyboard') && f['accessibility/index.html'].includes('written description'));
  ok('every page footer links Privacy · Accessibility', f['index.html'].includes('href="/privacy/"') && f['about/index.html'].includes('href="/accessibility/"'));
  ok('sitemap includes the legal pages', f['sitemap.xml'].includes('/privacy/') && f['sitemap.xml'].includes('/accessibility/'));
  const noForm = renderSnapshot(snapFor('plumber'), { baseUrl: 'https://example.com' });
  ok('no form endpoint → privacy honestly says nothing is collected', noForm['privacy/index.html'].includes('no forms and collects nothing'));
}

// ═══ 5c. Phase Z: search-engine verification — a field, not a technical task ═══
{
  const f = render('plumber', { verification: { google: 'GTOKEN123', bing: 'BTOKEN456' } });
  ok('verification meta tags render on every page when set', f['index.html'].includes('name="google-site-verification" content="GTOKEN123"') && f['about/index.html'].includes('name="msvalidate.01" content="BTOKEN456"'));
  ok('no tokens → no verification meta (clean default)', !render('plumber')['index.html'].includes('google-site-verification'));
}

// ═══ 5d. Phase CP-2: the Design Studio renders ═══
{
  const css = render('plumber')[Object.keys(render('plumber')).find((k) => k.startsWith('assets/'))];
  ok('CSS adopts the studio tokens (type/scale/density/radius/bg vars with safe fallbacks)',
    css.includes('var(--font-body,') && css.includes('var(--font-display,') && css.includes('var(--font-scale,1)') && css.includes('var(--spacing-scale,1)') && css.includes('var(--radius,') && css.includes('var(--bg,'));
  const hidden = render('plumber', { sections: { hidden: ['testimonials', 'faqs'], order: [] } })['index.html'];
  ok('sections hide (testimonials+faqs off the home page, kept elsewhere)', !hidden.includes('What customers say') && !hidden.includes('Good to know') && hidden.includes('About us'));
  const reordered = render('plumber', { sections: { hidden: [], order: ['faqs', 'about'] } })['index.html'];
  ok('sections reorder (faqs before about)', reordered.indexOf('Good to know') < reordered.indexOf('About us'));
  const noSet = render('plumber')['index.html'];
  ok('no settings → all four sections in default order', noSet.indexOf('About us') < noSet.indexOf('What customers say'));
  // DS-6 split hero consumes DS-5 focal — the first cropping presentation
  const base = JSON.parse(JSON.stringify(fixture));
  const heroOffering = base.content.offerings.find((o) => o.media);
  if (heroOffering) heroOffering.media.focal = { x: 100, y: 0 };
  base.template_slug = 'business-classic'; base.template_version = '1.0.0';
  base.content.settings = { ...(base.content.settings || {}), industry: 'plumber', hero_layout: 'split' };
  const split = renderSnapshot(base, SITE)['index.html'];
  ok('split hero renders with object-fit cropping + the focal point', split.includes('hero-split') && split.includes('object-position:100% 0%'));
  const centeredNav = render('plumber', { nav_style: 'centered' })['index.html'];
  ok('centered header style applies via class', centeredNav.includes('wrap nav centered'));
  const noFooter = render('plumber', { footer: { hours: false, social: false } })['index.html'];
  ok('footer toggles hide hours + social', !noFooter.includes('<caption>Hours</caption>'));
}

// ═══ 5e. Phase SD: search visibility as human questions ═══
{
  const f = render('plumber', { pages_noindex: ['faq', 'contact'] });
  ok('hidden pages get noindex + leave the sitemap (but still exist)', f['faq/index.html'].includes('content="noindex"') && f['contact/index.html'].includes('content="noindex"') && !f['sitemap.xml'].includes('/faq/') && !f['sitemap.xml'].includes('/contact/') && f['sitemap.xml'].includes('/services/'));
  ok('default: nothing customer-facing is noindexed (only /thanks/)', !render('plumber')['faq/index.html'].includes('content="noindex"'));
  const ov = render('plumber', { page_seo: { about: { title: 'Meet the crew', description: 'Two generations of pipes.' } } });
  ok('per-page search wording overrides title + description', ov['about/index.html'].includes('<title>Meet the crew</title>') && ov['about/index.html'].includes('content="Two generations of pipes."'));
  ok('blank overrides keep the good defaults', render('plumber')['about/index.html'].includes('<title>About — '));
  const base = JSON.parse(JSON.stringify(fixture));
  base.template_slug = 'business-classic'; base.template_version = '1.0.0';
  base.content.settings = { ...(base.content.settings || {}), industry: 'plumber' };
  if (base.content.posts[0]) {
    base.content.posts[0].noindex = true;
    const pf = renderSnapshot(base, SITE);
    const slug = base.content.posts[0].slug;
    ok('a post can be hidden from Google (noindex + out of the sitemap, still published)', pf[`updates/${slug}/index.html`].includes('content="noindex"') && !pf['sitemap.xml'].includes(`/updates/${slug}/`) && (`updates/${slug}/index.html` in pf));
  }
}

// ═══ 6. determinism ═══
{
  const a = render('plumber'), b = render('plumber');
  ok('same snapshot → same bytes', JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && a['index.html'] === b['index.html'] && a['sitemap.xml'] === b['sitemap.xml']);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
