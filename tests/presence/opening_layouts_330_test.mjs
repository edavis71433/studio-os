// ── The three new openings, and each design's own start (builder list item 330) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/opening_layouts_330_test.mjs
// Figma section A (Nov 22 2026): the eight designs were one layout in eight skins. Three new
// front-page layouts ('panel', 'editorial', 'type'), and a new site opens the way its design
// does, in the design's own two fonts. Part A: the one module (lib/template_openings.ts). Part B:
// each new layout drawn in all eight designs, with photos and without (the headline rule, no
// empty photo box, the stylesheet only when used). Part C: the facts are only what the site
// really has. Part D: hostile words are escaped. Part E: which photos, in which order. Part F:
// the real PUT /settings saves only a layout that exists. Part G: the real POST /agency/sites
// gives a new site its design's opening and fonts, filling only what is empty.
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('RESEND_KEY', 're_test');
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const O = await import('../../supabase/functions/presence/lib/template_openings.ts');
const { renderSnapshot, listTemplates } = await import('../../supabase/functions/presence/lib/render.ts');
const { FONT_LIBRARY, libraryFontsIn } = await import('../../supabase/functions/presence/lib/fonts.ts');
const { validateThemeTokens } = await import('../../supabase/functions/presence/lib/devmode.ts');
const SLUGS = listTemplates().map((t) => t.slug).sort();
const KINDS = ['panel', 'editorial', 'type'];

// the Figma card "Which template opens which way, and its own fonts" (461:138), as Eric picked it
const CARD = {
  'restaurant-classic': ['photo', 'Playfair Display', 'Manrope'], 'slate': ['photo', 'Space Grotesk', 'Inter'],
  'aurora': ['photo-light', 'Outfit', 'Figtree'], 'atelier': ['panel', 'DM Serif Display', 'DM Sans'],
  'business-classic': ['panel', 'Plus Jakarta Sans', 'Inter'], 'meadow': ['editorial', 'Cormorant Garamond', 'Source Sans 3'],
  'editorial': ['editorial', 'Libre Baskerville', 'Nunito Sans'], 'harbor': ['type', 'Roboto Slab', 'Work Sans'],
};

// ═══ A. the module ═══
{
  eq('A1: seven layouts in the editor’s order, by their plain names', O.HERO_LAYOUTS.map((l) => [l.value, l.name]), [['', 'Classic'], ['split', 'Photo beside text'], ['photo', 'Words over the photo'], ['photo-light', 'Words over a light photo'], ['panel', 'Split: words on a colour panel'], ['editorial', 'Centred editorial'], ['type', 'Type only']]);
  ok('A2: no name has an em-dash or a code word', O.HERO_LAYOUTS.every((l) => !/—|_/.test(l.name)));
  ok('A3: every layout is one a site can save; nothing else is', O.HERO_LAYOUTS.every((l) => O.isHeroLayout(l.value)) && ![' panel', 'PANEL', 'banner', 'classic', null, undefined, 5, {}].some((v) => O.isHeroLayout(v)));
  ok('A4: the three new ones, and only those, are new', KINDS.every((k) => O.isNewOpening(k)) && !['', 'split', 'photo', 'photo-light', 'x'].some((v) => O.isNewOpening(v)));
  eq('A5: every built-in design has its start, and only they do', Object.keys(O.TEMPLATE_OPENINGS).sort(), SLUGS);
  for (const slug of SLUGS) {
    const s = O.openingStartFor(slug);
    eq(`A6 ${slug}: opens and reads as the card says`, s && [s.hero_layout, ...s.fonts], CARD[slug]);
    const checked = validateThemeTokens(s.tokens);
    ok(`A7 ${slug}: the two tokens are ones Styles may save, kept as they are`, checked.rejected.length === 0 && JSON.stringify(checked.tokens) === JSON.stringify(s.tokens));
    eq(`A8 ${slug}: a publish carries exactly those two families (lib/fonts.ts reads the tokens)`, libraryFontsIn(s.tokens).map((f) => f.family), s.fonts[0] === s.fonts[1] ? [s.fonts[0]] : s.fonts);
  }
  const used = new Set(Object.values(O.TEMPLATE_OPENINGS).flatMap((p) => [p.display, p.body]));
  ok('A9: every family picked is in the library, regular and bold only (no italics to fake)', [...used].every((id) => { const f = FONT_LIBRARY.find((x) => x.id === id); return f && f.weights.every((w) => w === 400 || w === 700); }));
  ok('A10: a design that isn’t built in has no start', O.openingStartFor('nope') === null && O.openingStartFor(undefined) === null && O.openingStartFor('') === null);
  const m = O.openingStartFor('meadow');
  eq('A11: the history line, in plain words', [O.openingSummary(m, true, true), O.openingSummary(m, true, false), O.openingSummary(m, false, true), O.openingSummary(m, false, false)],
    ['The home page opens with “Centred editorial”; headings in Cormorant Garamond, text in Source Sans 3', 'The home page opens with “Centred editorial”', 'Fonts: headings in Cormorant Garamond, text in Source Sans 3', '']);
  ok('A12: the new rules ask for no italics and no weight the library lacks', KINDS.every((k) => { const css = O.openingCss(k); return !/italic/.test(css) && [...css.matchAll(/font-weight:(\d+)/g)].every((x) => x[1] === '400' || x[1] === '700'); }));
}

// ═══ drawing helpers ═══
const base = (slug) => JSON.parse(Deno.readTextFileSync(new URL(`../../supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, import.meta.url)));
const pic = (n, extra = {}) => ({ alt: `Photo ${n}`, variants: { w400: `/img/p${n}-400.webp`, w800: `/img/p${n}-800.webp`, w1600: `/img/p${n}-1600.webp` }, width: 1600, height: 1067, ...extra });
const WALL = (count = 38, average = 4.86) => ({ type: 'reviews_wall', title: 'Reviews', max: 12, reviews: [{ rating: 5, body: 'Lovely work.', author: 'Sam P.' }, { rating: 4, body: 'On time.', author: 'Lee R.' }], aggregate: { count, average } });
function site(slug, layout, f = () => {}) {
  const s = base(slug);
  s.content.settings = { ...(s.content.settings || {}), hero_layout: layout };
  f(s.content, s);
  return s;
}
const noPhotos = (c) => { delete c.settings.cover; c.offerings = c.offerings.map(({ media, ...o }) => o); c.posts = c.posts.map(({ hero, ...p }) => p); };
const withPhotos = (c) => { c.settings.cover = pic(1, { focal: { x: 30, y: 60 } }); c.offerings = c.offerings.map((o, i) => ({ ...o, media: pic(10 + i) })); c.posts = c.posts.map((p, i) => ({ ...p, hero: pic(50 + i) })); };
const draw = (s) => renderSnapshot(structuredClone(s), { baseUrl: 'https://example.com' });
const cssOf = (files) => String(files[Object.keys(files).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k))]);
const welcome = (html) => /<section class="hero op op-(panel|editorial|type)"[\s\S]*?<\/section>/.exec(html);
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const escd = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ═══ B. every new layout in every design, with photos and without ═══
for (const slug of SLUGS) {
  const classic = await draw(site(slug, ''));
  const plainCss = cssOf(classic);
  ok(`B0 ${slug}: a site on any older layout carries none of the new rules`, !/\.op[-{ ]/.test(plainCss));
  for (const old of ['split', 'photo', 'photo-light']) {
    const f = await draw(site(slug, old, withPhotos));
    ok(`B0 ${slug} ${old}: none of the new rules, and drawn as before (no new opening)`, !/\.op[-{ ]/.test(cssOf(f)) && !welcome(String(f['index.html'])));
  }
  for (const kind of KINDS) {
    for (const photos of [true, false]) {
      const label = `${slug} ${kind}${photos ? '' : ', no photos'}`;
      const s = site(slug, kind, photos ? withPhotos : noPhotos);
      const files = await draw(s);
      const html = String(files['index.html']);
      const w = welcome(html);
      const want = photos || kind === 'type' ? kind : 'type';
      ok(`B1 ${label}: opens as ${want}`, w && w[1] === want, w ? w[1] : 'no new opening drawn');
      const sec = w ? w[0] : '';
      const i = s.content.identity;
      ok(`B2 ${label}: the tagline is the headline; the name stays in the header and the page title`, sec.includes(`<h1${[...i.tagline].length > 60 ? ' class="op-long"' : ''} data-pr="identity.tagline">${escd(i.tagline)}</h1>`) && !sec.includes(`>${escd(i.business_name)}</h1>`)
        && html.includes(`>${escd(i.business_name)}</a>`) && /<title>[^<]+<\/title>/.test(html));
      const boxes = [...sec.matchAll(/<div class="op-(?:photo|ph)">([\s\S]*?)<\/div>/g)];
      ok(`B3 ${label}: no empty photo box: every box holds its photo`, boxes.every((b) => /<img src="\/img\/p\d+-800\.webp"/.test(b[1])) && (want === 'type' ? boxes.length === 0 : boxes.length > 0));
      if (want === 'editorial') ok(`B4 ${label}: three photos in a row`, /<div class="wrap op-photos n3">/.test(sec) && boxes.length === 3);
      if (want === 'panel') ok(`B4 ${label}: one photo, to the edge, at its focal point, asked for first`, boxes.length === 1 && /style="object-position:30% 60%"/.test(boxes[0][1]) && /fetchpriority="high"/.test(boxes[0][1]));
      const css = cssOf(files), tail = '\n' + O.openingCss(want);
      const others = KINDS.filter((k) => k !== want).map((k) => O.OPENING_CSS[k]);
      ok(`B5 ${label}: the design’s own stylesheet, then only ${want}’s rules`, css.endsWith(tail) && !/\.op[-{ ]/.test(css.slice(0, -tail.length)) && others.every((o) => !css.includes(o)));
      ok(`B6 ${label}: one open-or-closed line on the page, and its script only with it`, (html.match(/id="open-now"/g) || []).length === 1 && html.includes('id="hours-data"'));
      ok(`B7 ${label}: the section still moves and outlines like the welcome section`, sec.includes('data-dds-core="hero" data-dds-movable'));
    }
  }
  // no tagline: the name is the headline
  const named = String((await draw(site(slug, 'type', (c) => { c.identity.tagline = '   '; })))['index.html']);
  ok(`B8 ${slug}: with no tagline the business name is the headline`, welcome(named)?.[0].includes(`<h1 data-pr="identity.business_name">${escd(base(slug).content.identity.business_name)}</h1>`));
}

// ═══ C. the facts are only what the site really has ═══
{
  const facts = (html) => [...(welcome(html)?.[0] || '').matchAll(/<li class="op-fact"[^>]*><span class="op-big[^"]*">([\s\S]*?)<\/span><span class="op-lb">([\s\S]*?)<\/span><\/li>/g)].map((m) => [text(m[1]), text(m[2])]);
  const home = async (s) => String((await draw(s))['index.html']);
  const all = await home(site('harbor', 'type', (c) => { c.settings.blocks = [WALL()]; }));
  eq('C1: everything it has, in order: the reviews, today, the phone, the places it serves', facts(all), [['4.9', 'out of 5 from 38 reviews'], ['', 'See all hours'], ['(818) 555-0167', 'Call us'], ['Glendale, Burbank, La Crescenta and Pasadena', 'Places we serve']]);
  ok('C2: the open-or-closed fact is the strip’s own line (its script fills it), so there is one on the page', /<li class="op-fact"><span class="op-big"><span id="open-now" class="open-now" aria-live="polite"><\/span><\/span>/.test(all) && (all.match(/id="open-now"/g) || []).length === 1);
  ok('C3: a long list of places is set smaller', /<span class="op-big op-s">Glendale, Burbank, La Crescenta and Pasadena<\/span>/.test(all));
  const one = await home(site('harbor', 'type', (c) => { c.settings.blocks = [WALL(1, 5)]; }));
  eq('C4: one review is one review, a whole average stays whole', facts(one)[0], ['5', 'out of 5 from 1 review']);
  const hidden = await home(site('harbor', 'type', (c) => { c.settings.blocks = [WALL()]; c.settings.sections = { hidden: ['block_reviews_wall'], order: [] }; }));
  ok('C5: reviews the home page doesn’t show are not counted in the facts', !/class="rw-agg"/.test(hidden) && !facts(hidden).some((f) => /review/.test(f[1])));
  const none0 = await home(site('harbor', 'type', (c) => { c.settings.blocks = [WALL(0, 0)]; }));
  ok('C6: no approved reviews, no reviews fact', !facts(none0).some((f) => /review/.test(f[1])));
  const bare = await home(site('harbor', 'type', (c) => { c.identity.phone = ''; c.identity.service_area = ''; c.locations = []; }));
  ok('C7: nothing to say, no facts row at all (and no empty one)', !/op-facts/.test(bare) && !/id="open-now"/.test(bare) && !/id="hours-data"/.test(bare));
  const shut = await home(site('harbor', 'type', (c) => { c.locations[0].hours = c.locations[0].hours.map((d) => ({ ...d, closed: true, intervals: [] })); }));
  ok('C8: a week with no opening hours has no open-or-closed fact', !facts(shut).some((f) => f[1] === 'See all hours') && !/id="open-now"/.test(shut));
  const digits = (s) => (s.match(/\d+/g) || []);
  const seen = facts(all).flatMap((f) => digits(f.join(' ')));
  ok('C9: every number in the facts is the site’s own (its phone, its approved reviews)', seen.every((d) => ['4', '9', '5', '38', '818', '555', '0167'].includes(d)), seen.join(','));
  const strip = (html) => (/<\/section>\s*<div class="strip">([\s\S]*?)<\/div><\/div>/.exec(html.slice(html.indexOf('data-dds-core="hero"'))) || [])[1] || '';
  ok('C10: Type only: the strip under it keeps the address and directions, not the phone or today again', /1420 S Central Ave, Glendale/.test(strip(all)) && /Get directions/.test(strip(all)) && !/tel:/.test(strip(all)) && !/open-now/.test(strip(all)));
  const panel = await home(site('atelier', 'panel', (c) => { withPhotos(c); c.settings.blocks = [WALL()]; }));
  ok('C11: the panel’s proof line: the reviews and today; the strip under it keeps the phone, not today', /<p class="op-proof"><span><span aria-hidden="true">★ <\/span>4\.9 out of 5 from 38 reviews<\/span><span id="open-now"/.test(panel) && /tel:/.test(strip(panel)) && !/open-now/.test(strip(panel)));
  const noWall = await home(site('atelier', 'panel', withPhotos));
  ok('C12: no reviews shown, no reviews in the proof line', !/out of 5/.test(welcome(noWall)[0]) && /<p class="op-proof"><span id="open-now"/.test(noWall));
  const out = await home(site('harbor', 'type', (c) => { c.locations[0].goes_to_customers = true; }));
  ok('C13: a business that goes to its customers: no street and no directions anywhere in the opening or its strip', !/1420 S Central/.test(welcome(out)[0]) && !/1420 S Central/.test(strip(out)) && !/Get directions/.test(strip(out)) && facts(out).some((f) => f[1] === 'Places we serve'));
  const editorial = await home(site('meadow', 'editorial', withPhotos));
  ok('C14: Centred editorial keeps the strip just as it was, under the photos', /<\/section>\n<div class="strip"><div class="wrap">\n  <span id="open-now" class="open-now" aria-live="polite"><\/span>/.test(editorial));
  const kick = await home(site('meadow', 'editorial', withPhotos));
  ok('C15: the places it serves stand above the headline (Type only has them in its facts instead)', /<p class="kicker" data-pr="identity.service_area">/.test(welcome(kick)[0]) && !/class="kicker"/.test(welcome(all)[0]));
  const short = await home(site('meadow', 'panel', (c) => { withPhotos(c); c.identity.short_description = 'Flowers picked this morning, arranged by hand.'; }));
  ok('C16: the short description is the line under the headline, never in italics', /<p class="op-line" data-pr="identity.short_description">Flowers picked this morning, arranged by hand\.<\/p>/.test(short) && /\.op \.op-line\{[^}]*font-style:normal/.test(O.openingCss('panel')));
  const buttons = (html) => [...welcome(html)[0].matchAll(/<a class="(btn(?: ghost)?)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[3]]);
  eq('C17: the buttons, as the welcome section has them: book, then Contact us', buttons(all), [['btn', 'Get a quote'], ['btn ghost', 'Contact us']]);
  const noBook = await home(site('harbor', 'type', (c) => { c.identity.booking_url = ''; c.identity.ordering_url = ''; }));
  eq('C18: no booking or ordering link: one button to the services', buttons(noBook), [['btn', 'See our services']]);
  const badLink = await home(site('harbor', 'type', (c) => { c.identity.booking_url = 'javascript:alert(1)'; c.identity.ordering_url = ''; }));
  eq('C19: a booking link that isn’t safe is never a button', [/javascript:/.test(badLink), buttons(badLink)], [false, [['btn', 'See our services']]]);
}

// ═══ D. hostile words are escaped in every new layout ═══
for (const kind of KINDS) {
  const evil = site('harbor', kind, (c) => {
    withPhotos(c);
    c.identity.tagline = '<script>alert(1)</script>" onmouseover="x';
    c.identity.short_description = '<img src=x onerror=alert(2)>';
    c.identity.service_area = '"><b>x</b>';
    c.identity.business_name = '<i>Bad</i> & Co';
    c.settings.blocks = [WALL()];
  });
  const html = String((await draw(evil))['index.html']);
  const sec = welcome(html)[0];
  ok(`D1 ${kind}: no script, handler or markup from the words survives`, !/<script>alert/.test(sec) && !/<img src=x/.test(sec) && !/ onmouseover="x/.test(sec) && !/<b>x<\/b>/.test(sec) && !/onerror=alert/.test(sec.replace(/&lt;img src=x onerror=alert\(2\)&gt;/, '')));
  ok(`D2 ${kind}: the words are there, escaped`, sec.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot; onmouseover=&quot;x') && sec.includes('&lt;img src=x onerror=alert(2)&gt;'));
}

// ═══ E. which photos, in which order ═══
{
  const sec = async (f) => welcome(String((await draw(site('meadow', 'editorial', f)))['index.html']))?.[0] || '';
  const srcs = (h) => [...h.matchAll(/<img src="(\/img\/p\d+)-800\.webp"/g)].map((m) => m[1]);
  const order = base('meadow').content.offerings.map((o, i) => ({ o, i })).sort((a, b) => (a.o.sort_order ?? 0) - (b.o.sort_order ?? 0) || String(a.o.id).localeCompare(String(b.o.id))).map((x) => x.i);
  eq('E1: the cover first, then the services’ photos in their order, then the updates’', srcs(await sec(withPhotos)), ['/img/p1', `/img/p${10 + order[0]}`, `/img/p${10 + order[1]}`]);
  eq('E1b: no cover and one service photo: that photo, then the update’s', srcs(await sec((c) => { noPhotos(c); c.offerings[order[0]].media = pic(31); c.posts[0].hero = pic(32); })), ['/img/p31', '/img/p32']);
  eq('E2: a photo used twice is shown once', srcs(await sec((c) => { noPhotos(c); c.settings.cover = pic(7); c.offerings[0].media = pic(7); c.offerings[1].media = pic(8); })), ['/img/p7', '/img/p8']);
  const two = await sec((c) => { noPhotos(c); c.offerings[0].media = pic(3); c.posts[0].hero = pic(4); });
  ok('E3: two photos make a row of two (no cover needed)', /op-photos n2/.test(two) && JSON.stringify(srcs(two)) === '["/img/p3","/img/p4"]');
  const lone = await sec((c) => { noPhotos(c); c.settings.cover = pic(5); c.offerings[0].media = { alt: 'a file with no picture', variants: {} }; });
  ok('E4: a "photo" with nothing to show is passed over; one photo stands alone', /op-photos n1/.test(lone) && srcs(lone).length === 1);
  const first = await sec(withPhotos);
  ok('E5: the first photo is asked for first, the others wait their turn', (first.match(/fetchpriority="high"/g) || []).length === 1 && (first.match(/loading="lazy"/g) || []).length === 2);
  const panelNone = String((await draw(site('atelier', 'panel', (c) => { noPhotos(c); c.offerings[0].media = { alt: 'nothing', variants: {} }; })))['index.html']);
  ok('E6: a panel whose only "photo" has nothing to show opens as Type only', welcome(panelNone)?.[1] === 'type' && !/op-photo/.test(panelNone));
}

// ═══ F. the real PUT /settings saves only a layout that exists ═══
const SITE = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';
{
  const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
  const { handleSettings } = await import('../../supabase/functions/presence/routes/content.ts');
  db.reset({ presence_settings: [{ site_id: SITE, hero_layout: '', updated_at: '2026-11-22T00:00:00Z' }], presence_change_events: [] });
  const who = { kind: 'client', userId: 'u1', tenantId: null, role: 'client', email: 'owner@example.com', jwt: 'jwt', requestId: 'r1' };
  const put = async (body) => {
    const req = new Request('http://stub.local/functions/v1/presence/settings', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const r = await handleSettings(req, (p, i) => svc(p, i), { id: SITE, status: 'ready', edition: 'presence' }, who, {});
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const stored = () => db.tables.presence_settings[0].hero_layout;
  for (const v of ['panel', 'editorial', 'type', 'split', 'photo', 'photo-light', '']) {
    const r = await put({ hero_layout: v });
    ok(`F1: “${v || 'Classic'}” saves`, r.status === 200 && stored() === v, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  await put({ hero_layout: 'type' });
  const bad = await put({ hero_layout: 'banner' });
  ok('F2: a layout that doesn’t exist is refused in plain words, and the saved one stays', bad.status >= 400 && bad.status < 500 && JSON.stringify(bad.body).includes('That isn’t one of the front-page layouts.') && stored() === 'type', JSON.stringify(bad.body));
}

// ═══ G. a new site starts with its design's opening and fonts (the real POST /agency/sites) ═══
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const { startOpening } = await import('../../supabase/functions/presence/agency/sites.ts');
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', ME = '11111111-1111-4111-8111-111111111111';
const OLD = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', OLDC = 'c1000000-0000-4000-8000-000000000001';
const KIT = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd', FONT_KIT = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', TPL_KIT = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const pg = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = String(init.method || 'GET').toUpperCase();
  if (u.host === 'api.netlify.com') {   // hosting, outside the database
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const name = body.name || u.pathname.split('/').pop();
    return new Response(JSON.stringify({ id: 'nf-new', name, default_domain: `${name}.netlify.app`, state: 'ready' }), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  }
  // the database's own column defaults the in-memory one doesn't know: a new site is on the
  // default design (migration 0110: atelier) at its first version
  if (u.pathname === '/rest/v1/presence_sites' && method === 'POST') init = { ...init, body: JSON.stringify({ template_slug: 'atelier', template_version: '1.0.0', ...JSON.parse(String(init.body)) }) };
  return pg(url, init);
};
function seed() {
  db.reset({
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active' }],
    presence_agency_clients: [{ site_id: OLD, agency_id: AG, status: 'active', tags: [], owner_email: 'owner@bistro.example' }],
    presence_sites: [{ id: OLD, client_id: OLDC, edition: 'presence', status: 'live', template_slug: 'atelier', template_version: '1.0.0' }],
    clients: [{ id: OLDC, name: 'Bistro Nine', email: 'owner@bistro.example' }],
    // an existing site on the same design, with no layout and no fonts: it must stay exactly so
    presence_settings: [{ site_id: OLD, hero_layout: '', industry_key: 'restaurant' }],
    presence_dev_customizations: [{ site_id: OLD, theme_tokens: { accent: '#8c3b2e' }, custom_css: '', custom_html: '' }],
    presence_starter_kits: [
      { id: KIT, agency_id: AG, name: 'Florist colours', payload: { industry_key: 'florist', template_slug: '', category_order: [], offerings: [], faqs: [], voice: { tone_notes: '', preferred_vocabulary: '', never_claim: '' }, theme_tokens: { accent: '#7a2e5e' } } },
      { id: FONT_KIT, agency_id: AG, name: 'Our own fonts', payload: { industry_key: 'generic', template_slug: '', category_order: [], offerings: [], faqs: [], voice: { tone_notes: '', preferred_vocabulary: '', never_claim: '' }, theme_tokens: { font_display: 'Lora, Georgia, serif', font_body: 'Inter, system-ui, sans-serif' } } },
      { id: TPL_KIT, agency_id: AG, name: 'My template', payload: { industry_key: 'generic', template_slug: 'harbor', category_order: [], offerings: [], faqs: [], voice: { tone_notes: '', preferred_vocabulary: '', never_claim: '' }, theme_tokens: {}, layout: { template_slug: 'harbor', blocks: [], pages: [], nav: [], sections_order: [], sections_hidden: [], hero_layout: 'split', nav_style: '', footer_hours: true, footer_social: true } } },
    ],
    presence_change_events: [],
  });
}
const member = { agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} };
const PRINCIPAL = { kind: 'client', userId: '99999999-0000-4000-8000-000000000009', email: 'eric@studio.example' };
async function newSite(body) {
  const req = new Request('http://stub.local/functions/v1/presence/agency/sites', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, '/agency/sites', 'POST', member, PRINCIPAL, {});
  return { status: res.status, body: await res.json() };
}
const settingsOf = (id) => (db.tables.presence_settings || []).find((s) => s.site_id === id);
const tokensOf = (id) => (db.tables.presence_dev_customizations || []).find((s) => s.site_id === id)?.theme_tokens;
const oldBefore = () => JSON.stringify([settingsOf(OLD), tokensOf(OLD)]);
{
  seed();
  const before = oldBefore();
  const r = await newSite({ business_name: 'Fernwood Flower Co.', template_slug: 'meadow', industry_key: 'florist' });
  const id = r.body.data?.site_id;
  const want = O.openingStartFor('meadow');
  ok('G1: + New site on Meadow opens with Centred editorial', r.status === 201 && settingsOf(id)?.hero_layout === 'editorial' && settingsOf(id)?.industry_key === 'florist', JSON.stringify(r.body).slice(0, 300));
  eq('G2: …in Meadow’s two fonts, saved as the two style tokens', tokensOf(id), want.tokens);
  eq('G3: a publish will carry those two families’ files', libraryFontsIn(tokensOf(id)).map((f) => f.family), ['Cormorant Garamond', 'Source Sans 3']);
  eq('G4: the answer says what the site was given', r.body.data.opening, { slug: 'meadow', layout: 'editorial', fonts: ['Cormorant Garamond', 'Source Sans 3'], applied: { layout: true, fonts: true } });
  const ev = db.tables.presence_change_events.find((e) => e.site_id === id && /opens with/.test(e.summary));
  ok('G5: the history says it in plain words, as the layout and the colours and fonts', ev && ev.summary === 'The home page opens with “Centred editorial”; headings in Cormorant Garamond, text in Source Sans 3' && JSON.stringify(ev.detail?.fields) === '["hero_layout","theme_tokens"]', JSON.stringify(ev));
  ok('G6: the site that was already there is untouched', oldBefore() === before);
}
{
  seed();
  const r = await newSite({ business_name: 'Just A Name' });
  const id = r.body.data?.site_id;
  ok('G7: a name alone starts on the default design (Atelier) and opens as it does: the colour panel, DM Serif Display and DM Sans', r.status === 201 && settingsOf(id)?.hero_layout === 'panel' && JSON.stringify(tokensOf(id)) === JSON.stringify(O.openingStartFor('atelier').tokens) && r.body.data.look === null);
}
for (const slug of SLUGS) {
  seed();
  const r = await newSite({ business_name: `A ${slug} site`, template_slug: slug });
  const id = r.body.data?.site_id;
  const [layout, display, body] = CARD[slug];
  ok(`G8 ${slug}: a new site opens and reads as the card says`, r.status === 201 && settingsOf(id)?.hero_layout === layout && JSON.stringify(libraryFontsIn(tokensOf(id)).map((f) => f.family)) === JSON.stringify(display === body ? [display] : [display, body]));
}
{
  seed();
  const r = await newSite({ business_name: 'Kit And Look', template_slug: 'harbor', kit_id: KIT });
  const id = r.body.data?.site_id;
  ok('G9: a starter kit’s colour still lands, and the design’s fonts join it', r.body.data.kit?.applied?.colors === true && JSON.stringify(tokensOf(id)) === JSON.stringify({ accent: '#7a2e5e', ...O.openingStartFor('harbor').tokens }) && settingsOf(id)?.hero_layout === 'type', JSON.stringify(tokensOf(id)));
}
{
  seed();
  const r = await newSite({ business_name: 'Own Fonts', template_slug: 'meadow', kit_id: FONT_KIT });
  const id = r.body.data?.site_id;
  ok('G10: fonts the site already has (from its kit) are kept; the layout is still set', JSON.stringify(tokensOf(id)) === JSON.stringify({ font_display: 'Lora, Georgia, serif', font_body: 'Inter, system-ui, sans-serif' }) && settingsOf(id)?.hero_layout === 'editorial' && r.body.data.opening.applied.fonts === false && r.body.data.opening.applied.layout === true);
  ok('G11: the history then names only the layout', db.tables.presence_change_events.some((e) => e.site_id === id && e.summary === 'The home page opens with “Centred editorial”'));
}
{
  seed();
  const r = await newSite({ business_name: 'From My Template', template_slug: 'meadow', kit_id: TPL_KIT });
  const id = r.body.data?.site_id;
  ok('G12: a saved template brings its own look: no design opening, no design fonts', r.status === 201 && r.body.data.opening === null && !tokensOf(id)?.font_display && settingsOf(id)?.hero_layout !== 'editorial', JSON.stringify({ o: r.body.data.opening, s: settingsOf(id), t: tokensOf(id) }));
}
{
  // startOpening on its own: a site that already has a layout and fonts keeps both, and nothing is recorded
  seed();
  db.tables.presence_sites.push({ id: SITE, client_id: 'c-z', edition: 'presence', status: 'ready', template_slug: 'harbor', template_version: '1.0.0' });
  db.tables.presence_settings.push({ site_id: SITE, hero_layout: 'split' });
  db.tables.presence_dev_customizations.push({ site_id: SITE, theme_tokens: { font_display: 'Lora, Georgia, serif' }, custom_css: '.x{color:red}', custom_html: '<p>Hi</p>' });
  const out = await startOpening(SITE, PRINCIPAL);
  ok('G13: a layout and fonts already chosen are kept, and the history stays quiet', out.applied.layout === false && out.applied.fonts === false && settingsOf(SITE).hero_layout === 'split' && tokensOf(SITE).font_display === 'Lora, Georgia, serif' && !db.tables.presence_change_events.some((e) => e.site_id === SITE));
  db.tables.presence_dev_customizations.find((d) => d.site_id === SITE).theme_tokens = { accent: '#123456' };
  db.tables.presence_settings.find((s) => s.site_id === SITE).hero_layout = '';
  const out2 = await startOpening(SITE, PRINCIPAL);
  const dev = db.tables.presence_dev_customizations.find((d) => d.site_id === SITE);
  ok('G14: fonts join the colours already there; the developer’s CSS and HTML are kept as they are', out2.applied.fonts && JSON.stringify(dev.theme_tokens) === JSON.stringify({ accent: '#123456', ...O.openingStartFor('harbor').tokens }) && dev.custom_css === '.x{color:red}' && dev.custom_html === '<p>Hi</p>' && settingsOf(SITE).hero_layout === 'type');
  db.tables.presence_sites.find((s) => s.id === SITE).template_slug = 'a-custom-design';
  ok('G15: a design with no pick gets nothing', (await startOpening(SITE, PRINCIPAL)) === null);
  db.tables.presence_sites.find((s) => s.id === SITE).template_slug = 'meadow';
  db.tables.presence_settings.find((s) => s.site_id === SITE).hero_layout = '';
  db.fail.add('presence_dev_customizations');
  const writes = db.log.length;
  const out3 = await startOpening(SITE, PRINCIPAL);
  db.fail.delete('presence_dev_customizations');
  ok('G16: when what the site has can’t be read, nothing is written over it', out3.applied.layout === false && out3.applied.fonts === false && settingsOf(SITE).hero_layout === '' && db.log.slice(writes).every((c) => c.method === 'GET'));
}

const failed = results.filter((x) => !x).length;
console.log(`\n════ OPENING LAYOUTS + DESIGN STARTS (item 330): ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
