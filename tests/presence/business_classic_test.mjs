// ── Phase T3: business-classic template suite ────────────────────────────────
// Proves THE industry realization: one render, correct vocabulary + schema per
// industry. A plumber site says "Services" and emits @type:Plumber; a salon gets
// HairSalon; a restaurant on this template still gets Menu/@type:Restaurant.
// Plus the production contract: file set, a11y basics, form fix (honeypot +
// thanks), announcement/logo, sitemap/robots, determinism.
//
//   deno run --allow-read --allow-env tests/presence/business_classic_test.mjs
import { getTemplate, renderSnapshot, listTemplates } from '../../supabase/functions/presence/lib/render.ts';
import { NOT_SENT_REASONS, notSentReason } from '../../supabase/functions/presence/lib/legal_pages.ts';
import { senderTag } from '../../supabase/functions/presence/lib/site_send.ts';

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
  const f = await render('plumber');
  ok('plumber: /services/ page exists, no /menu/', 'services/index.html' in f && !('menu/index.html' in f));
  const home = f['index.html'];
  ok('plumber: @type Plumber on the home page', home.includes('"@type":"Plumber"'));
  ok('plumber: no Restaurant/Menu schema anywhere', !home.includes('"@type":"Restaurant"') && !f['services/index.html'].includes('MenuItem'));
  ok('plumber: nav says Services, not Menu', home.includes('>Services</a>') && !home.includes('>Menu</a>'));
  ok('plumber: offerings page emits ItemList of Service', f['services/index.html'].includes('"@type":"ItemList"') && f['services/index.html'].includes('"@type":"Service"'));
}

// ═══ 3. other industries flip correctly from the SAME render ═══
{
  ok('salon → HairSalon', (await render('salon'))['index.html'].includes('"@type":"HairSalon"'));
  ok('retail → Store + Products page', await (async () => { const f = await render('retail'); return f['index.html'].includes('"@type":"Store"') && 'products/index.html' in f; })());
  ok('restaurant on business-classic → Restaurant + Menu vocabulary', await (async () => { const f = await render('restaurant'); return f['index.html'].includes('"@type":"Restaurant"') && 'menu/index.html' in f && f['menu/index.html'].includes('MenuItem'); })());
  ok('unknown/generic → LocalBusiness (safe)', (await render('generic'))['index.html'].includes('"@type":"LocalBusiness"'));
}

// ═══ 4. production contract: files, a11y, SEO plumbing ═══
{
  const f = await render('plumber');
  const expected = ['index.html', 'services/index.html', 'about/index.html', 'faq/index.html', 'contact/index.html', 'thanks/index.html', 'updates/index.html', '404.html', 'favicon.svg', 'sitemap.xml', 'robots.txt'];
  ok('full production file set', expected.every((k) => k in f), expected.filter((k) => !(k in f)).join(','));
  // full pages only — redirect stubs are intentionally-minimal meta-refresh files
  const pages = Object.entries(f).filter(([k, v]) => k.endsWith('.html') && !String(v).includes('http-equiv="refresh"')).map(([k, v]) => [k, String(v)]);
  ok('every page: lang + skip link + main landmark + single h1', pages.every(([, h]) => h.includes('lang="en"') && h.includes('class="skip"') && h.includes('<main id="main">') && (h.match(/<h1[\s>]/g) || []).length === 1));
  ok('every page: title + description + canonical + og:title', pages.every(([, h]) => h.includes('<title>') && h.includes('name="description"') && h.includes('rel="canonical"') && h.includes('og:title')));
  const navPages = pages.filter(([k]) => !['404.html', 'thanks/index.html', 'privacy/index.html', 'accessibility/index.html', 'search/index.html'].includes(k));
  ok('aria-current marks the active nav item', navPages.length > 0 && navPages.every(([, h]) => h.includes('aria-current="page"')));
  ok('sitemap lists /services/ (not /menu/, not /thanks/)', f['sitemap.xml'].includes('/services/') && !f['sitemap.xml'].includes('/menu/') && !f['sitemap.xml'].includes('/thanks/'));
  ok('robots disallows /thanks/ + points at the sitemap', f['robots.txt'].includes('Disallow: /thanks/') && f['robots.txt'].includes('sitemap.xml'));
  // Content pages stay pure-static. The ONLY first-party inline scripts are the
  // on-site search (Phase SEARCH: /search/) + the updates tag-filter (progressive
  // enhancement) — both same-origin, zero external origins. Everything else is JS-free.
  // item 99: the Open now line, its hours data and its first-party script, rides on the home page only
  const noOpenNow = (h) => String(h).replace(/<script id="hours-data" type="application\/json">[\s\S]*?<\/script>\n<script>\(function\(\)\{var el=document\.getElementById\('open-now'\)[\s\S]*?<\/script>/, '');
  const scriptPages = pages.filter(([k]) => k !== 'search/index.html' && k !== 'updates/index.html');
  // item 131: a page holding the site's form also carries the page's sender (lib/site_send.ts), and no other page does
  const sender = senderTag(SITE.formEndpoint);
  const noSender = (h) => String(h).replace(sender, '');
  ok('zero JavaScript emitted, except the first-party search, tag filter, Open now and the form’s sender', scriptPages.length > 0 && scriptPages.every(([, h]) => !/<script(?! type="application\/ld\+json")/.test(noOpenNow(noSender(h)))));
  ok('the form’s sender rides only on the pages that hold the form', scriptPages.some(([, h]) => h.includes(sender)) && scriptPages.every(([, h]) => h.includes(sender) === h.includes(`action="${SITE.formEndpoint}"`)));
  ok('the Open now script is on the home page only', pages.filter(([, h]) => String(h).includes("getElementById('open-now')")).map(([k]) => k).join() === 'index.html');
}

// ═══ 5. the Phase-V essentials carry over ═══
{
  const f = await render('plumber', { announcement: { text: 'Closed July 4th', expires_at: null }, });
  ok('announcement bar renders site-wide', f['index.html'].includes('class="annbar"') && f['about/index.html'].includes('Closed July 4th'));
  const contact = (await render('plumber'))['contact/index.html'];
  ok('form: honeypot + hidden kind/source + posts to the endpoint', contact.includes('name="_hp"') && contact.includes('name="form_kind"') && contact.includes(SITE.formEndpoint));
  ok('thanks page: noindex + calm copy', (await render('plumber'))['thanks/index.html'].includes('name="robots" content="noindex"'));
}

// ═══ 5b. Phase Q: the generated legal foundation ═══
{
  const f = await render('plumber');
  ok('privacy + accessibility pages generated', 'privacy/index.html' in f && 'accessibility/index.html' in f);
  const pv = f['privacy/index.html'];
  ok('privacy: facts-true (title + contact-form coverage + effective date)', pv.includes('Privacy policy') && pv.includes('contact form') && pv.includes('Effective '));
  // item 61: every published page carries the first-party visit counter, so the page says so
  ok('privacy: no cookies, and the visit counter described as it is', pv.includes('no cookies') && pv.includes('counts its own visits') && pv.includes('without any outside analytics') && pv.includes('Do Not Track') === false && pv.includes('asks websites not to track you') && !pv.includes('no analytics or tracking'));
  const off = (await render('plumber', { visit_counter: false }))['privacy/index.html'];
  ok('privacy: with the counter switched off, the page says the site counts nothing', off.includes('does not count or track visits') && !off.includes('counts its own visits'));
  ok('accessibility: promises the template actually keeps', f['accessibility/index.html'].includes('keyboard') && f['accessibility/index.html'].includes('written description'));
  ok('every page footer links Privacy · Accessibility', f['index.html'].includes('href="/privacy/"') && f['about/index.html'].includes('href="/accessibility/"'));
  ok('sitemap includes the legal pages', f['sitemap.xml'].includes('/privacy/') && f['sitemap.xml'].includes('/accessibility/'));
  const noForm = await renderSnapshot(snapFor('plumber'), { baseUrl: 'https://example.com' });
  ok('no form endpoint → privacy honestly says nothing is collected', noForm['privacy/index.html'].includes('no forms and collects nothing'));
}

// ═══ 5b+. item 62: a message that didn't send says why, and goes back with the words kept ═══
{
  const f = await render('plumber');
  const ns = f['not-sent/index.html'];
  ok('not-sent: the page exists, noindex, out of the sitemap, disallowed for robots', !!ns && ns.includes('name="robots" content="noindex"') && !f['sitemap.xml'].includes('/not-sent/') && f['robots.txt'].includes('Disallow: /not-sent/'));
  ok('not-sent: says it didn’t send, with a line per reason and a general one', ns.includes('Your message didn’t send.') && NOT_SENT_REASONS.every((r) => ns.includes(`id="ns-${r}"`)) && ns.includes('ns-general'));
  ok('not-sent: it sends the visitor Back, where the browser keeps the words, and offers the contact page', ns.includes('Back button to return to the form: what you wrote is still there.') && ns.includes('href="/contact/"'));
  ok('not-sent: no script and no click handler (CSS :target picks the reason)', !/<script(?! type="application\/ld\+json")/.test(ns) && !/<[a-z][a-z0-9]*\b[^>]*\son\w+\s*=/i.test(ns));
  ok('reasons: a known code keeps its line, anything else gets the general one', notSentReason('bad_email') === 'bad_email' && notSentReason('need_contact') === 'need_contact' && notSentReason('weird') === 'check');
  const route = await Deno.readTextFile(new URL('supabase/functions/presence/routes/commercial.ts', ROOT));
  // five: the contact form's two, a custom form's two, and item 146's "Join our list" box
  ok('route: every failed browser submission goes to the page; the contact page is only the old-site fallback and the gone-form case', (route.match(/await notSent\(/g) || []).length === 5 && (route.match(/redirectTo\('\/contact\/'\)/g) || []).length === 2);
  const slugs = listTemplates().map((t) => t.slug);
  const each = await Promise.all(slugs.map(async (slug) => { const sn = snapFor('plumber'); sn.template_slug = slug; const g = await renderSnapshot(sn, SITE); const h = String(g['not-sent/index.html'] || ''); return [slug, h.includes('Your message didn’t send.') && h.includes('content="noindex"') && (h.match(/<h1[\s>]/g) || []).length === 1 && h.includes('aria-current="page"')]; }));
  ok('not-sent: all eight templates draw it, noindex, one heading, Contact marked in the menu', slugs.length === 8 && each.every(([, good]) => good), each.filter(([, g]) => !g).map(([s]) => s).join(','));
}

// ═══ 5b++. item 67: the social share image uses the chosen cover photo ═══
{
  const cover = { variants: { w400: '/img/cv-400.webp', w800: '/img/cv-800.webp', w1600: '/img/cv-1600.webp' }, alt: 'The dining room', width: 1600, height: 1067 };
  const home = (await render('plumber', { cover, og_image: null }))['index.html'];
  ok('share image: the chosen cover photo when no share image is set', /property="og:image" content="[^"]*\/img\/cv-1600\.webp"/.test(home));
  const own = (await render('plumber', { cover, og_image: { variants: { w1600: '/img/og-1600.webp' }, alt: '' } }))['index.html'];
  ok('share image: a share image the owner set still wins', /property="og:image" content="[^"]*\/img\/og-1600\.webp"/.test(own));
}

// ═══ 5c. Phase Z: search-engine verification — a field, not a technical task ═══
{
  const f = await render('plumber', { verification: { google: 'GTOKEN123', bing: 'BTOKEN456' } });
  ok('verification meta tags render on every page when set', f['index.html'].includes('name="google-site-verification" content="GTOKEN123"') && f['about/index.html'].includes('name="msvalidate.01" content="BTOKEN456"'));
  ok('no tokens → no verification meta (clean default)', !(await render('plumber'))['index.html'].includes('google-site-verification'));
}

// ═══ 5d. Phase CP-2: the Design Studio renders ═══
{
  const css = (await render('plumber'))[Object.keys(await render('plumber')).find((k) => k.startsWith('assets/'))];
  ok('CSS adopts the studio tokens (type/scale/density/radius/bg vars with safe fallbacks)',
    css.includes('var(--font-body,') && css.includes('var(--font-display,') && css.includes('var(--font-scale,1)') && css.includes('var(--spacing-scale,1)') && css.includes('var(--radius,') && css.includes('var(--bg,'));
  const hidden = (await render('plumber', { sections: { hidden: ['testimonials', 'faqs'], order: [] } }))['index.html'];
  ok('sections hide (testimonials+faqs off the home page, kept elsewhere)', !hidden.includes('What customers say') && !hidden.includes('Good to know') && hidden.includes('About us'));
  const reordered = (await render('plumber', { sections: { hidden: [], order: ['faqs', 'about'] } }))['index.html'];
  ok('sections reorder (faqs before about)', reordered.indexOf('Good to know') < reordered.indexOf('About us'));
  const noSet = (await render('plumber'))['index.html'];
  ok('no settings → all four sections in default order', noSet.indexOf('About us') < noSet.indexOf('What customers say'));
  // The welcome section moves like the others, and its address strip moves with it.
  const at = (h, needle) => h.indexOf(needle);
  ok('the welcome section is stamped movable for the builder', noSet.includes('data-dds-core="hero" data-dds-movable'));
  ok('no settings → the welcome section comes first', at(noSet, 'data-dds-core="hero"') < at(noSet, 'About us'));
  const heroDown = (await render('plumber', { sections: { hidden: [], order: ['about', 'hero', 'offerings', 'testimonials', 'faqs'] } }))['index.html'];
  ok('a saved order can put the welcome section below About', at(heroDown, 'About us') < at(heroDown, 'data-dds-core="hero"'));
  const stripAt = at(heroDown, 'class="strip"');
  ok('the address strip follows the welcome section wherever it goes', stripAt > at(heroDown, 'data-dds-core="hero"') && stripAt < at(heroDown, 'data-dds-core="offerings"'));
  ok('an order saved before the welcome section could move leaves it first', at(reordered, 'data-dds-core="hero"') < at(reordered, 'Good to know'));
  const heroOff = (await render('plumber', { sections: { hidden: ['hero'], order: ['about', 'hero'] } }))['index.html'];
  ok('with the welcome section removed, the strip keeps its place at the top', !heroOff.includes('data-dds-core="hero"') && at(heroOff, 'class="strip"') < at(heroOff, 'About us'));
  ok('the welcome section appears once', (heroDown.match(/data-dds-core="hero"/g) || []).length === 1 && (heroDown.match(/class="strip"/g) || []).length === 1);
  // DS-6 split hero consumes DS-5 focal — the first cropping presentation
  const base = JSON.parse(JSON.stringify(fixture));
  const heroOffering = base.content.offerings.find((o) => o.media);
  if (heroOffering) heroOffering.media.focal = { x: 100, y: 0 };
  base.template_slug = 'business-classic'; base.template_version = '1.0.0';
  base.content.settings = { ...(base.content.settings || {}), industry: 'plumber', hero_layout: 'split' };
  const split = (await renderSnapshot(base, SITE))['index.html'];
  ok('split hero renders with object-fit cropping + the focal point', split.includes('hero-split') && split.includes('object-position:100% 0%'));
  const centeredNav = (await render('plumber', { nav_style: 'centered' }))['index.html'];
  ok('centered header style applies via class', centeredNav.includes('wrap nav centered'));
  const noFooter = (await render('plumber', { footer: { hours: false, social: false } }))['index.html'];
  ok('footer toggles hide hours + social', !noFooter.includes('<caption>Hours</caption>'));
}

// ═══ 5e. Phase SD: search visibility as human questions ═══
{
  const f = await render('plumber', { pages_noindex: ['faq', 'contact'] });
  ok('hidden pages get noindex + leave the sitemap (but still exist)', f['faq/index.html'].includes('content="noindex"') && f['contact/index.html'].includes('content="noindex"') && !f['sitemap.xml'].includes('/faq/') && !f['sitemap.xml'].includes('/contact/') && f['sitemap.xml'].includes('/services/'));
  ok('default: nothing customer-facing is noindexed (only /thanks/)', !(await render('plumber'))['faq/index.html'].includes('content="noindex"'));
  const ov = await render('plumber', { page_seo: { about: { title: 'Meet the crew', description: 'Two generations of pipes.' } } });
  ok('per-page search wording overrides title + description', ov['about/index.html'].includes('<title>Meet the crew</title>') && ov['about/index.html'].includes('content="Two generations of pipes."'));
  ok('blank overrides keep the good defaults', (await render('plumber'))['about/index.html'].includes('<title>About — '));
  const base = JSON.parse(JSON.stringify(fixture));
  base.template_slug = 'business-classic'; base.template_version = '1.0.0';
  base.content.settings = { ...(base.content.settings || {}), industry: 'plumber' };
  if (base.content.posts[0]) {
    base.content.posts[0].noindex = true;
    const pf = await renderSnapshot(base, SITE);
    const slug = base.content.posts[0].slug;
    ok('a post can be hidden from Google (noindex + out of the sitemap, still published)', pf[`updates/${slug}/index.html`].includes('content="noindex"') && !pf['sitemap.xml'].includes(`/updates/${slug}/`) && (`updates/${slug}/index.html` in pf));
  }
}

// ═══ 6. determinism ═══
{
  const a = await render('plumber'), b = await render('plumber');
  ok('same snapshot → same bytes', JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && a['index.html'] === b['index.html'] && a['sitemap.xml'] === b['sitemap.xml']);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
