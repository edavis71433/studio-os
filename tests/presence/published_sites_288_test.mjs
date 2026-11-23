// ── What a visitor meets on a published site: builder items 288 and 292 to 311 (Nov 22 2026 review) ──
// One drawing serves all eight templates (lib/template_kit.ts), so each check runs on every one:
//   288 the phone menu: a Menu button and a sheet in the header, the search box inside it, the
//       site's one script file linked on every page, and with scripts off the menu simply shows
//   292 a photo behind a call to action, a spotlight or a title section, and the welcome section
//       drawn over its photo; never on a section of another kind
//   293 the welcome photo's shape, cropped around its focal point
//   294 room for the stuck header when the page jumps to a spot
//   295 the search box: a focus ring, 16px words, and a switch to leave it out
//   296 the header shows the logo and the name, the logo alone (the name as its alt text) or the
//       name alone, and the logo's height is the owner's
//   297 an empty FAQ or Updates page is out of the menu, the sitemap and the site
//   298 a gallery caption only where the owner wrote one; the zoom view and the carousel script
//   299 past events are left out, every event has a place, and the sweep knows the day after
//   300 the updates list pages at 20, names its feed, and a post shares as an article
//   301 the contact form asks for an email and a phone apart; a rating draws as stars
//   302 four motion choices, each kind
//   303 holiday hours and review dates in words
//   304 a line icon on a Why choose us item, in the site's accent colour
//   305 a no-script line inside every form
//   306 phone numbers, email, Privacy and Accessibility and the sign-up tick are 44px on a phone
//   307 no tablist role on Tabs; the accessibility page's contrast promise
//   308 the first photo on an inner page is asked for at once; library fonts are preloaded
//   311 the developer's HTML block sits inside the page, on the pages chosen
//
//   deno run --allow-read --allow-env tests/presence/published_sites_288_test.mjs
import { renderSnapshot, devLayerFragments, injectDevLayer, devBlockPages } from '../../supabase/functions/presence/lib/render.ts';
import { SHELL_CSS, SHELL_CRITICAL, SHELL_NOSCRIPT, MENU_JS, menuButtonHtml } from '../../supabase/functions/presence/lib/site_shell.ts';
import { renderSiteBlocks, resolveBlockMedia, unresolveBlockMedia, validateBlocks, LINE_ICONS, eventPassed, BLOCK_JS, BLOCK_CSS, PHOTO_BG_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { eventDays, blocksNeedRewindow, nextWindowBoundary } from '../../supabase/functions/presence/lib/content_window.ts';
import { MOTION_CSS, MOTIONS, motionOf, applyMotion } from '../../supabase/functions/presence/lib/site_motion.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';
import { renderForm, NOSCRIPT_LINE } from '../../supabase/functions/presence/lib/forms.ts';
import { dayDate, firstPhotoPreload, SITE_JS_PATH } from '../../supabase/functions/presence/lib/template_kit.ts';
import { postPageCount, postListPath, POSTS_PER_PAGE } from '../../supabase/functions/presence/lib/post_render.ts';
import { publishedCspFor } from '../../supabase/functions/presence/lib/site_csp.ts';
import { fontStack, FONT_LIBRARY } from '../../supabase/functions/presence/lib/fonts.ts';
import { TEMPLATES, fixture, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://example.com/forms/submit', bookEndpoint: 'https://example.com/book' };
const pagesOf = (files) => Object.entries(files).filter(([k]) => k.endsWith('.html')).map(([k, v]) => [k, String(v)]);
const cssOf = (files) => String(files[Object.keys(files).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k))] || '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = esc;
const safeHref = (u) => (/^https?:\/\//.test(u) ? u : null);
const CTX = { esc, attr, safeHref, now: '2026-11-22T12:00:00Z', place: { name: 'Bistro Nine', address: '12 Olive Ave, Burbank, CA 91501' } };
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';
const REF = (id) => (id === P1 || id === P2 ? { alt: 'A photo', variants: { w400: `/img/${id.slice(0, 8)}-400.webp`, w800: `/img/${id.slice(0, 8)}-800.webp`, w1600: `/img/${id.slice(0, 8)}-1600.webp` }, width: 1600, height: 1067, focal: { x: 30, y: 70 } } : null);
const ID_OF = (m) => (m.variants?.w400?.includes(P1.slice(0, 8)) ? P1 : m.variants?.w400?.includes(P2.slice(0, 8)) ? P2 : null);
const draw = (list, ctx = CTX) => renderSiteBlocks(resolveBlockMedia(validateBlocks(list), REF), ctx);

// ═══ every template: the shell's parts on every page ═══
for (const slug of TEMPLATES) {
  const files = await renderSnapshot(fullFixture(slug), SITE);
  const pages = pagesOf(files);
  const css = cssOf(files);
  const js = String(files[SITE_JS_PATH.slice(1)] || '');
  // 288
  ok(`[${slug}] 288: every page's header has the Menu button and the sheet, with the menu and the search box inside`, pages.every(([, h]) => h.includes(menuButtonHtml()) && /<div class="site-menu" id="site-menu"><nav class="primary" aria-label="Main">[\s\S]*?<\/nav>\s*<form class="sitesearch"[\s\S]*?<\/form><\/div>/.test(h)));
  ok(`[${slug}] 288: the first-paint rules fold the menu before the stylesheet arrives, and scripts off shows it whole`, pages.every(([, h]) => h.includes(SHELL_CRITICAL) && h.includes(SHELL_NOSCRIPT)));
  ok(`[${slug}] 288: the site's one script file carries the menu and the gallery, and every page links it deferred`, js.includes(MENU_JS) && js.includes(BLOCK_JS) && pages.every(([, h]) => h.includes(`<script src="${SITE_JS_PATH}" defer></script>`)));
  ok(`[${slug}] 288: the stylesheet carries the shell's rules once`, css.split(SHELL_CSS).length === 2);
  ok(`[${slug}] 288: the sheet keeps its place in the header row on a wide screen`, SHELL_CSS.includes('.site-menu{display:contents}'));
  // 293
  const home = String(files['index.html']);
  ok(`[${slug}] 293: the welcome photo takes a shape, 16:9 wide and 4:3 on a phone, around its focal point`, SHELL_CSS.includes('.hero-img img{aspect-ratio:16/9;object-fit:cover}') && SHELL_CSS.includes('@media (max-width:640px){.hero-img img{aspect-ratio:4/3}}') && (!/<div class="hero-img">/.test(home) || /<div class="hero-img">(?:<picture>[\s\S]*?)?<img [^>]*fetchpriority="high"[^>]*style="object-position:\d+% \d+%"/.test(home) || !fixture(slug).content.settings?.cover?.focal));
  // 294
  ok(`[${slug}] 294: the page leaves room for the stuck header when it jumps; the script measures it`, css.includes('html{scroll-padding-top:calc(var(--hdr-h,72px) + 12px)}') && MENU_JS.includes('"--hdr-h"') && MENU_JS.includes('p==="sticky"||p==="fixed"'));
  // 295
  ok(`[${slug}] 295: the search box shows the keyboard's place and its words are 16px`, css.includes('.sitesearch:focus-within{outline:2px solid') && css.includes('.sitesearch input{font-size:max(16px,.92rem)}'));
  // 297: the full sample has questions and posts, so both pages are there
  ok(`[${slug}] 297: with questions and updates, FAQ and Updates are in the menu, the sitemap and the site`, 'faq/index.html' in files && 'updates/index.html' in files && home.includes('href="/faq/"') && home.includes('href="/updates/"') && String(files['sitemap.xml']).includes('/faq/</loc>') && String(files['sitemap.xml']).includes('/updates/</loc>'));
  // 300
  ok(`[${slug}] 300: the updates list and each post name the feed, and a post shares as an article`, String(files['updates/index.html']).includes('<link rel="alternate" type="application/rss+xml"') && String(files['updates/index.html']).includes('href="/feed.xml">Get these updates in a feed reader</a>') && pagesOf(files).filter(([k]) => /^updates\/[^/]+\/index\.html$/.test(k) && !k.includes('category')).every(([, h]) => h.includes('<meta property="og:type" content="article">') && h.includes('article:published_time')) && home.includes('<meta property="og:type" content="website">'));
  // 301 + 305
  const contact = String(files['contact/index.html']);
  ok(`[${slug}] 301: the contact form asks for an email and a phone apart, with the keyboards and autofill for each`, contact.includes('<input id="f-email" type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email"') && contact.includes('<input id="f-phone" type="tel" name="phone" maxlength="40" autocomplete="tel" inputmode="tel"') && !contact.includes('name="contact"'));
  ok(`[${slug}] 305: the contact form, the sign-up box and every custom form carry the no-script line`, contact.includes('<noscript><p class="ff-noscript">Please call or email us; this form needs scripts turned on.</p></noscript>') && pages.filter(([, h]) => h.includes('class="card nl-form"')).every(([, h]) => h.split('form_kind" value="signup"').length - 1 === h.split('<noscript><p class="ff-noscript">').length - 1 - (h.split('class="presence-form"').length - 1) - (h.includes('form_kind" value="contact"') ? 1 : 0)) && pages.filter(([, h]) => h.includes('class="card presence-form"')).every(([, h]) => h.includes(NOSCRIPT_LINE)));
  // 303
  ok(`[${slug}] 303: a review's date prints in words on the reviews wall`, pages.some(([, h]) => h.includes('<time class="rw-date" datetime="2026-05-02">May 2, 2026</time>')));
  // 306
  ok(`[${slug}] 306: on a phone the links a thumb must hit are 44px`, css.includes('a[href^="tel:"],a[href^="mailto:"],.strip a,.credit a,.post-more a,footer.site .cols a,.map-dir a,.annbar a{display:inline-flex;align-items:center;min-height:44px}') && css.includes('.nl-form .nl-consent label{min-height:44px'));
  // 307
  ok(`[${slug}] 307: Tabs carry no tablist role; the accessibility page says colours are checked`, !pages.some(([, h]) => h.includes('role="tablist"')) && String(files['accessibility/index.html']).includes('the site’s own colours are checked for readable contrast'));
  // 308
  const inner = pagesOf(files).filter(([k, h]) => k !== 'index.html' && h.includes('loading="lazy"') && !/<img [^>]*fetchpriority="high"/.test(h));
  ok(`[${slug}] 308: an inner page with photos asks for its first one at once`, inner.length > 0 && inner.every(([, h]) => /<link rel="preload" as="image" href="[^"]+"( imagesrcset="[^"]*" imagesizes="[^"]*")? fetchpriority="high">/.test(h)) && !home.includes('rel="preload" as="image"'));
  // the site's content rule names the script file as the site's own
  const csp = await publishedCspFor([files], 'https://example.com');
  ok(`[${slug}] 288: the site's content rule lets its own script file run and nothing from elsewhere`, /^default-src 'self'; script-src 'self'( 'sha256-[^']+')*; /.test(csp));
}

// ═══ 297: a site with no questions and no updates ═══
{
  const fx = fixture('aurora');
  fx.content.faqs = []; fx.content.posts = [];
  fx.content.settings.nav = [{ label: 'Home', href: '/' }, { label: 'More', href: '/about/', children: [{ label: 'FAQ', href: '/faq/' }, { label: 'Updates', href: '/updates/' }] }, { label: 'Questions', href: '/faq/' }, { label: 'Contact', href: '/contact/' }];
  const files = await renderSnapshot(fx, SITE);
  const home = String(files['index.html']);
  ok('297: an empty FAQ page and an empty Updates page are not written', !('faq/index.html' in files) && !('updates/index.html' in files));
  ok('297: they are out of the menu, the owner\'s own menu too (a dropdown keeps its parent)', !home.includes('href="/faq/"') && !home.includes('href="/updates/"') && home.includes('href="/about/"') && home.includes('>Contact<'));
  ok('297: out of the sitemap, and the search page\'s browse links', !String(files['sitemap.xml']).includes('/faq/') && !String(files['sitemap.xml']).includes('/updates/') && !String(files['search/index.html']).includes('href="/faq/"') && !String(files['search/index.html']).includes('href="/updates/"'));
  const some = fixture('aurora'); some.content.posts = []; const f2 = await renderSnapshot(some, SITE);
  ok('297: with questions but no updates, FAQ stays and Updates goes', 'faq/index.html' in f2 && !('updates/index.html' in f2) && String(f2['index.html']).includes('href="/faq/"'));
}

// ═══ 300: paging at 20 ═══
{
  const fx = fixture('aurora');
  const base = fx.content.posts[0];
  for (let i = 0; i < 45; i++) fx.content.posts.push({ ...base, id: 'p' + i, slug: 'update-' + i, title: 'Update ' + i, published_at: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z` });
  const files = await renderSnapshot(fx, SITE);
  const n = fx.content.posts.length;
  ok('300: the list is split at 20, newest first, on /updates/, /updates/page/2/ and so on', postPageCount(n) === Math.ceil(n / POSTS_PER_PAGE) && 'updates/page/2/index.html' in files && 'updates/page/3/index.html' in files && !('updates/page/4/index.html' in files) && (String(files['updates/index.html']).match(/<article /g) || []).length === 20);
  ok('300: each page links its neighbours and says where it is', String(files['updates/index.html']).includes('href="/updates/page/2/">Older →</a>') && String(files['updates/page/2/index.html']).includes('href="/updates/">← Newer</a>') && String(files['updates/page/2/index.html']).includes('Page 2 of 3') && !String(files['updates/page/3/index.html']).includes('Older →'));
  ok('300: the later pages are in the sitemap and titled by their page', String(files['sitemap.xml']).includes('/updates/page/2/</loc>') && String(files['updates/page/2/index.html']).includes('<title>Updates (page 2 of 3)'));
  ok('300: a category list pages the same way', postListPath({ id: 'news' }, 2) === '/updates/category/news/page/2/' && postListPath(null, 1) === '/updates/');
}

// ═══ 292: a photo behind a section ═══
{
  const cta = draw([{ type: 'cta', text: 'Ready?', button: 'Call', url: 'https://x.test', look: { background: 'photo', photo_id: P1, veil: 'dark' } }])[0].html;
  ok('292: a call to action on a photo under a dark veil: the band spans the page, the photo is its first child, cropped around its focal point', /^<section[^>]* class="block block--bg-photo veil-dark alt block-cta"><div class="bg-photo" aria-hidden="true"><picture>[\s\S]*?<img [^>]*role="presentation"[^>]*style="object-position:30% 70%"><\/picture><\/div><div class="wrap cta-inner">/.test(cta));
  const light = draw([{ type: 'title', title: 'Our story', look: { background: 'photo', photo_id: P2, veil: 'light' } }])[0].html;
  ok('292: a title section under a light veil', light.includes('class="block block--bg-photo veil-light block-titleonly"') && light.includes('<div class="wrap">') && light.includes('<div class="bg-photo"'));
  ok('292: the veil is dark unless the owner says light, and a section of another kind never takes a photo', draw([{ type: 'cta', text: 'Go', look: { background: 'photo', photo_id: P1 } }])[0].html.includes('veil-dark') && !draw([{ type: 'features', items: [{ title: 'A' }], look: { background: 'photo', photo_id: P1 } }])[0].html.includes('bg-photo') && [...PHOTO_BG_TYPES].join() === 'cta,spotlight,title');
  ok('292: a photo that is gone from the library leaves the section on its template\'s own band', !draw([{ type: 'cta', text: 'Go', look: { background: 'photo', photo_id: '33333333-3333-4333-8333-333333333333', width: 'full' } }])[0].html.includes('bg-photo') && draw([{ type: 'cta', text: 'Go', look: { background: 'photo', photo_id: '33333333-3333-4333-8333-333333333333', width: 'full' } }])[0].html.includes('block--full'));
  const stored = validateBlocks([{ type: 'spotlight', title: 'Hi', look: { background: 'photo', photo_id: P1, veil: 'light' } }]);
  const back = unresolveBlockMedia(resolveBlockMedia(stored, REF), ID_OF);
  ok('292: the photo rides the look by id in storage and comes back the same way', stored[0].look.photo_id === P1 && stored[0].look.veil === 'light' && JSON.stringify(back[0].look) === JSON.stringify({ background: 'photo', veil: 'light', photo_id: P1 }));
  const fx = fixture('harbor'); fx.content.settings.hero_layout = 'photo';
  const home = String((await renderSnapshot(fx, SITE))['index.html']);
  ok('292: the welcome section drawn over its photo', /<section class="hero hero-photo veil-dark" data-dds-core="hero" data-dds-movable><div class="hero-bg" aria-hidden="true">(?:<picture>[\s\S]*?)?<img [^>]*fetchpriority="high"/.test(home) && home.includes('<div class="wrap hero-copy">') && !home.includes('class="hero-img"'));
  const fx2 = fixture('harbor'); fx2.content.settings.hero_layout = 'photo-light';
  ok('292: or under a light veil', String((await renderSnapshot(fx2, SITE))['index.html']).includes('class="hero hero-photo veil-light"'));
  const css = cssOf(await renderSnapshot(fx, SITE));
  ok('292: light words on the dark veil, white buttons, the photo cropped to the band; the welcome section too', BLOCK_CSS.includes('.block.block--bg-photo.veil-dark{color:#fff;--soft:currentColor}') && BLOCK_CSS.includes('.block.block--bg-photo.veil-dark .btn{background:#fff') && BLOCK_CSS.includes('.block--bg-photo>.bg-photo picture,.block--bg-photo>.bg-photo img{width:100%;height:100%;object-fit:cover') && css.includes('.hero-photo{') && css.includes('.hero-photo.veil-dark,.hero-photo.veil-dark h1,.hero-photo.veil-dark .tagline{color:#fff}'));
  const fxc = fixture('aurora'); fxc.content.settings.blocks = [...(fxc.content.settings.blocks || []), { type: 'cta', text: 'Go', look: { background: 'photo', photo: REF(P1), veil: 'dark' } }];
  ok('292: a site with a photo section ships those rules in its stylesheet', cssOf(await renderSnapshot(fxc, SITE)).includes('.block.block--bg-photo.veil-dark{color:#fff'));
}

// ═══ 299: events ═══
{
  const list = [{ type: 'events', items: [{ name: 'Past', date: '2026-11-21' }, { name: 'Today', date: '2026-11-22', time: '19:00' }, { name: 'Soon', date: '2026-12-01', place: 'The hall, 4 Elm St' }] }];
  const r = draw(list)[0];
  ok('299: an event that has passed is left out at publish; one on the day stays', !r.html.includes('Past') && r.html.includes('Today') && r.html.includes('Soon'));
  ok('299: every event has a place: its own, else the business\'s address', r.html.includes('<span class="ev-place" data-dds-field="items.2.place">The hall, 4 Elm St</span>') && r.html.includes('<span class="ev-place">12 Olive Ave, Burbank, CA 91501</span>'));
  const ld = JSON.stringify(r.ld);
  ok('299: Google is told the place of each event', ld.includes('"location":{"@type":"Place","name":"Bistro Nine","address":"12 Olive Ave, Burbank, CA 91501"}') && ld.includes('"location":{"@type":"Place","name":"The hall, 4 Elm St","address":"The hall, 4 Elm St"}') && !ld.includes('Past'));
  ok('299: a section whose events have all passed draws nothing', draw([{ type: 'events', items: [{ name: 'Gone', date: '2020-01-01' }] }]).length === 0);
  ok('299: with no clock (a direct draw) every event shows, as before', draw(list, { ...CTX, now: undefined })[0].html.includes('Past'));
  ok('299: an event stays listed through its own day everywhere', !eventPassed('2026-11-22', '2026-11-22T23:59:59.000Z') && eventPassed('2026-11-22', '2026-11-23T00:00:00.000Z') && !eventPassed('not a date', '2030-01-01T00:00:00Z'));
  const blocks = [{ type: 'events', items: [{ name: 'A', date: '2026-11-22' }, { name: 'B', date: '2026-12-01' }] }, { type: 'cta', text: 'x' }];
  ok('299: the sweep sees each event\'s day as the instant it comes down, and republishes the day after', JSON.stringify(eventDays(blocks[0])) === '["2026-11-22T23:59:59.999Z","2026-12-01T23:59:59.999Z"]' && eventDays(blocks[1]).length === 0 && blocksNeedRewindow(blocks, '2026-11-20T00:00:00Z', '2026-11-23T00:00:00Z') && !blocksNeedRewindow(blocks, '2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z') && nextWindowBoundary(blocks, '2026-11-23T00:00:00Z') === '2026-12-01T23:59:59.999Z');
}

// ═══ 298: captions, the zoom view and the carousel ═══
{
  const g = draw([{ type: 'gallery', image_ids: [P1, P2], captions: ['A porch', ''], zoom: true }])[0].html;
  ok('298: a caption shows only where the owner wrote one; the photo\'s description names the zoom link', (g.match(/<figcaption data-dds-field/g) || []).length === 1 && g.includes('aria-label="View larger: A porch"') && g.includes('aria-label="View larger: A photo"'));
  ok('298: the zoom view is a dialog; the page\'s script closes it on Escape, moves on the arrows and a swipe, keeps the keyboard inside, and replaces the address instead of adding a step', g.includes('class="lb" id="lb-0-1" role="dialog" aria-modal="true"') && BLOCK_JS.includes('location.replace(h)') && BLOCK_JS.includes('e.key==="Escape"') && BLOCK_JS.includes('ArrowLeft') && BLOCK_JS.includes('touchend') && BLOCK_JS.includes('e.key==="Tab"'));
  ok('298: the carousel gets Previous and Next and a dot a slide from the script, and the hint goes', BLOCK_JS.includes('"Previous slide"') && BLOCK_JS.includes('"Next slide"') && BLOCK_JS.includes('"Slide "+(i+1)+" of "+s.length') && BLOCK_JS.includes('h.hidden=true'));
  let parses = true; try { new Function(BLOCK_JS); new Function(MENU_JS); } catch (e) { parses = String(e); }
  ok('298: both scripts parse, and neither has an inline handler', parses === true && !/\bon[a-z]+=/.test(BLOCK_JS + MENU_JS), String(parses));
}

// ═══ 301: a rating as stars; the drop-down's own arrow ═══
{
  const f = renderForm({ type: 'form', id: 'f1', title: 'Tell us', kind: 'contact', fields: [{ key: 'rate', label: 'How did we do?', type: 'rating', required: true }, { key: 'pick', label: 'Pick', type: 'select', choices: ['A', 'B'] }] });
  ok('301: each star is the same radio with a star drawn over it and its number kept for screen readers', (f.match(/class="ff-opt ff-star"/g) || []).length === 5 && f.includes('<span class="ff-star-g" aria-hidden="true"><svg') && f.includes('<span class="ff-star-n">1 star</span>') && f.includes('<span class="ff-star-n">5 stars</span>'));
  ok('301: the stars fill up to the chosen one, and the drop-down draws its own arrow', f.includes('.ff-star:has(~.ff-star input:checked) .ff-star-g{color:var(--accent') && f.includes('.presence-form select{appearance:none') && f.includes('background-image:url("data:image/svg+xml'));
  ok('305: the form carries the no-script line', f.includes(NOSCRIPT_LINE));
}

// ═══ 302: motion ═══
{
  ok('302: four choices, each only for devices that allow motion, each lifting buttons and cards under the pointer', MOTIONS.join() === 'gentle,slide,scale,zoom' && MOTIONS.every((m) => MOTION_CSS[m].startsWith('@media screen and (prefers-reduced-motion:no-preference)') && MOTION_CSS[m].includes('.btn:hover,.svc:hover,.card:hover')) && motionOf('slide') === 'slide' && motionOf('fast') === null);
  ok('302: slide comes from the side, scale from a touch smaller, zoom moves the welcome photo slowly', MOTION_CSS.slide.includes('translateX(-40px)') && MOTION_CSS.scale.includes('scale(.94)') && MOTION_CSS.zoom.includes('@keyframes dds-zoom') && MOTION_CSS.zoom.includes('.hero-photo .hero-bg img'));
  const on = applyMotion({ 'index.html': '<html><head></head><body><main><section>a</section></main></body></html>' }, 'scale');
  ok('302: the style settings take the four and nothing else, and a page gets the chosen rules', validateThemeTokens({ motion: 'zoom' }).tokens.motion === 'zoom' && validateThemeTokens({ motion: 'bounce' }).rejected.includes('motion') && on['index.html'].includes(MOTION_CSS.scale));
}

// ═══ 303: dates in words ═══
{
  ok('303: a holiday\'s date reads "Thu Nov 26"', dayDate('2026-11-26') === 'Thu Nov 26' && dayDate('2027-01-01') === 'Fri Jan 1' && dayDate('nonsense') === 'nonsense' && dayDate('2026-02-30') === '2026-02-30');
  const fx = fixture('aurora'); fx.content.locations[0].holiday_exceptions = [{ label: 'Thanksgiving', date: '2026-11-26', closed: true }];
  const files = await renderSnapshot(fx, SITE);
  // item 432: the date and its hours first, the note on its own line
  ok('303: the footer\'s holiday hours print the date in words', String(files['index.html']).includes('<li><time datetime="2026-11-26">Thu Nov 26</time>: Closed<br>Thanksgiving</li>'));
}

// ═══ 304: line icons ═══
{
  const f = draw([{ type: 'features', items: [{ title: 'On time', icon: 'icon:clock' }, { title: 'Friendly', icon: '😀' }, { title: 'Odd', icon: 'icon:nothing-here' }] }])[0].html;
  ok('304: a line icon draws in the site\'s accent colour; an emoji still draws as typed; an unknown name draws nothing', f.includes('<div class="svc-ic svc-ic-line" aria-hidden="true"><svg viewBox="0 0 24 24"') && f.includes(LINE_ICONS.clock) && f.includes('<div class="svc-ic" aria-hidden="true">😀</div>') && f.split('svc-ic').length - 1 === 3);
  ok('304: a set of two dozen, every one a stroke drawing', Object.keys(LINE_ICONS).length >= 24 && Object.values(LINE_ICONS).every((p) => /^<(path|circle|rect|polygon)/.test(p)));
}

// ═══ 296 and 295: the header's own choices ═══
{
  const fx = fixture('aurora');
  fx.content.settings.logo = { alt: '', variants: { w400: '/img/logo-400.webp', w800: '/img/logo-800.webp' }, width: 800, height: 200 };
  const with_ = async (tokens) => String((await renderSnapshot({ ...fx, dev_customization: { theme_tokens: tokens, custom_css: '', custom_html: '' } }, SITE))['index.html']);
  const both = await with_({}), logo = await with_({ header_brand: 'logo', logo_height: '56' }), name = await with_({ header_brand: 'name' }), noSearch = await with_({ site_search: 'off' });
  ok('296: logo and name by default, with the logo\'s own width and height so the header never jumps', /<a class="brand" href="\/"><img src="\/img\/logo-400.webp" alt="" class="brandlogo" width="800" height="200"><span class="brand-name">Golden Hour Events<\/span><\/a>/.test(both));
  ok('296: logo only keeps the name as the logo\'s alt text, at the chosen height', /<a class="brand brand-logo-only" href="\/" style="--logo-h:56px"><img src="\/img\/logo-400.webp" alt="Golden Hour Events" class="brandlogo" width="800" height="200"><\/a>/.test(logo));
  ok('296: name only draws no logo', /<a class="brand" href="\/"><span class="brand-name">Golden Hour Events<\/span><\/a>/.test(name) && !name.includes('brandlogo'));
  ok('296: the settings take the three words and a height from 24 to 80', validateThemeTokens({ header_brand: 'logo', logo_height: '80' }).rejected.length === 0 && validateThemeTokens({ header_brand: 'big', logo_height: '81' }).rejected.length === 2);
  ok('295: the search box can be left out, and the switch takes on or off', !noSearch.includes('class="sitesearch"') && both.includes('class="sitesearch"') && validateThemeTokens({ site_search: 'off' }).tokens.site_search === 'off' && validateThemeTokens({ site_search: 'maybe' }).rejected.length === 1);
}

// ═══ 308: fonts preloaded ═══
{
  const pf = FONT_LIBRARY.find((f) => f.id === 'playfair-display');
  const layer = devLayerFragments({ theme_tokens: { font_display: fontStack(pf) }, custom_css: '', custom_html: '' }).style;
  ok('308: a library font is asked for at once, regular and bold, from the site\'s own copy', layer.includes('</style><link rel="preload" as="font" type="font/woff2" href="/fonts/library/playfair-display-400.woff2" crossorigin><link rel="preload" as="font" type="font/woff2" href="/fonts/library/playfair-display-700.woff2" crossorigin>'));
  ok('308: the first photo\'s preload comes from its own srcset, and a page whose first photo is already eager gets none', firstPhotoPreload('<img src="/a-800.webp" srcset="/a-400.webp 400w, /a-800.webp 800w" sizes="100vw" alt="" loading="lazy">') === '<link rel="preload" as="image" href="/a-800.webp" imagesrcset="/a-400.webp 400w, /a-800.webp 800w" imagesizes="100vw" fetchpriority="high">' && firstPhotoPreload('<img src="/a.webp" alt="" fetchpriority="high"><img src="/b.webp" loading="lazy">') === '' && firstPhotoPreload('<p>no photo</p>') === '');
}

// ═══ 311: the developer's HTML block ═══
{
  const dev = { theme_tokens: {}, custom_css: '', custom_html: '<p>Family-owned since 1998.</p>' };
  const page = (k) => `<html><head></head><body><main id="main"><h1>${k}</h1></main><footer class="site">f</footer></body></html>`;
  const map = Object.fromEntries(['index.html', 'about/index.html', 'privacy/index.html', 'accessibility/index.html', 'thanks/index.html', 'not-sent/index.html', 'search/index.html', '404.html'].map((k) => [k, page(k)]));
  const out = injectDevLayer(map, dev);
  ok('311: the block sits inside the page, above the footer', out['index.html'].includes('</h1><div class="presence-dev-block"><p>Family-owned since 1998.</p></div></main><footer'));
  ok('311: never on the legal pages, the thank-you pages, search or the "not found" page', ['privacy/index.html', 'accessibility/index.html', 'thanks/index.html', 'not-sent/index.html', 'search/index.html', '404.html'].every((k) => !out[k].includes('presence-dev-block')));
  const homeOnly = injectDevLayer(map, { ...dev, theme_tokens: { html_pages: 'home' } }), innerOnly = injectDevLayer(map, { ...dev, theme_tokens: { html_pages: 'inner' } });
  ok('311: the developer picks the home page only, or every page but the home page', homeOnly['index.html'].includes('presence-dev-block') && !homeOnly['about/index.html'].includes('presence-dev-block') && !innerOnly['index.html'].includes('presence-dev-block') && innerOnly['about/index.html'].includes('presence-dev-block') && devBlockPages('about/index.html', undefined) && validateThemeTokens({ html_pages: 'inner' }).tokens.html_pages === 'inner' && validateThemeTokens({ html_pages: 'faq' }).rejected.length === 1);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
