// ── Openings made for a kind of business, and the one list of looks (Nov 22 2026) ──────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/kind_openings_test.mjs
// Eric picked three openings each for a salon or spa, home services and a restaurant or café in
// Figma (section B: S1 to R3). An opening is a design, one of its layouts, a ready-made look (or the
// design's own new-site fonts), the name centred at the top for the centred editorial ones, and for
// two of them a card on the photo. + New site shows a kind's three first, the first picked.
// Part A: the registry (lib/kind_openings.ts) and what each gives a site (lib/template_openings.ts).
// Part B: the looks are the server's one list, and the editor is sent it (routes/dev.ts).
// Part C: the cards on the photo and the panel's photo side, drawn by the real renderer, shipping
// their rules only where used. Part D: the estimate card's form and the server's own reading of it;
// today's line, run in a stand-in page. Part E: every word of every opening reads. Part F: the real
// POST /agency/sites applies an opening to the new site only, refuses unknown ones, and without one
// behaves as before. Part G: what + New site is sent, and "See it full size", through the real routes.
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('RESEND_KEY', 're_test');
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const KO = await import('../../supabase/functions/presence/lib/kind_openings.ts');
const TO = await import('../../supabase/functions/presence/lib/template_openings.ts');
const { STYLE_LOOKS, LOOK_CLEAR, LOOK_KEYS, lookByKey } = await import('../../supabase/functions/presence/lib/style_looks.ts');
const { validateThemeTokens } = await import('../../supabase/functions/presence/lib/devmode.ts');
const { renderSnapshot, renderForBuilder, listTemplates, FIXED_COLOR_TEMPLATES } = await import('../../supabase/functions/presence/lib/render.ts');
const { sampleSnapshot, kindSampleContent } = await import('../../supabase/functions/presence/lib/kind_samples.ts');
const { HERO_CARD_CSS, TODAY_JS } = await import('../../supabase/functions/presence/lib/hero_cards.ts');
const { formParamsToSubmission, validateSubmission } = await import('../../supabase/functions/presence/lib/commercial.ts');
const { libraryFontsIn } = await import('../../supabase/functions/presence/lib/fonts.ts');
const { parseHtml, elementsIn, sheetsOf, cascade, hexOf } = await import('./style_cascade.mjs');
const SLUGS = listTemplates().map((t) => t.slug);
const lookName = (k) => (k ? lookByKey(k)?.name : '');
function* ancestors(e) { for (let p = e.parent; p; p = p.parent) yield p; }

// ═══ A. the registry: Figma section B, as Eric picked it ═══
// [key, kind, design, layout, look, header, card, photo side, the page], the first of each kind first
const FIGMA = [
  ['beauty-panel', 'beauty', 'atelier', 'panel', 'Blush', '', '', '', ''],                  // S2 (first)
  ['beauty-photo', 'beauty', 'atelier', 'photo', 'Black & gold', '', '', '', ''],           // S1
  ['beauty-editorial', 'beauty', 'atelier', 'editorial', 'Golden hour', 'centered', '', '', ''],   // S3
  ['home-type', 'home', 'harbor', 'type', 'Hard hat', '', '', '', 'off'],                   // C1 (first): the big words on the yellow page
  ['home-photo', 'home', 'harbor', 'photo', 'Steady navy', '', 'estimate', '', ''],         // C2
  ['home-panel', 'home', 'harbor', 'panel', 'Night shift', '', '', 'left', ''],             // C3
  ['food-photo', 'food', 'restaurant-classic', 'photo', '', '', 'today', '', ''],           // R1 (first): its own new-site fonts
  ['food-editorial', 'food', 'restaurant-classic', 'editorial', 'Newsprint', 'centered', '', '', ''],   // R2
  ['food-type', 'food', 'restaurant-classic', 'type', 'Hand-lettered', '', '', '', 'off'],  // R3: on the cream page
];
{
  eq('A1: nine openings, three for each of the three kinds, the first of each as Eric marked it', KO.KIND_OPENINGS.map((o) => [o.key, o.family, o.design, o.layout, lookName(o.look), o.header, o.card, o.photo, o.band]), FIGMA);
  ok('A2: every key is its own', new Set(KO.KIND_OPENINGS.map((o) => o.key)).size === 9);
  ok('A3: each is made with a built-in design and one of its front-page layouts', KO.KIND_OPENINGS.every((o) => SLUGS.includes(o.design) && TO.isHeroLayout(o.layout)));
  ok('A4: each look is one of the twelve (Restaurant Classic’s first opening keeps the design’s own colours)', KO.KIND_OPENINGS.every((o) => o.look === '' ? o.key === 'food-photo' : !!lookByKey(o.look)));
  ok('A5: names and lines are plain words: no dashes for pauses, no code names', KO.KIND_OPENINGS.every((o) => !/[—–_]/.test(o.name + o.line) && o.name.includes(' · ') && o.line.length > 20));
  eq('A6: a kind’s openings, in order; other kinds have none', ['beauty', 'home', 'food', 'health', 'other', ''].map((f) => KO.openingsOf(f).map((o) => o.key)),
    [['beauty-panel', 'beauty-photo', 'beauty-editorial'], ['home-type', 'home-photo', 'home-panel'], ['food-photo', 'food-editorial', 'food-type'], [], [], []]);
  ok('A7: an unknown key is no opening', [null, undefined, '', 'nope', 'BEAUTY-PANEL', 5, {}].every((k) => KO.kindOpening(k) === null && TO.kindOpeningStart(k) === null));
  for (const o of KO.KIND_OPENINGS) {
    const s = TO.kindOpeningStart(o.key);
    const want = { ...(o.look ? lookByKey(o.look).tokens : TO.openingStartFor(o.design).tokens), ...(o.card ? { hero_card: o.card } : {}), ...(o.photo ? { hero_photo: o.photo } : {}), ...(o.band ? { hero_band: o.band } : {}) };
    ok(`A8 ${o.key}: gives the design, the layout, the header and the look whole, with its card, photo side and page`, s.slug === o.design && s.hero_layout === o.layout && s.nav_style === o.header && JSON.stringify(s.tokens) === JSON.stringify(want) && s.name === o.name);
    const v = validateThemeTokens(s.tokens);
    ok(`A9 ${o.key}: every setting is one Styles may save, kept as it is`, v.rejected.length === 0 && JSON.stringify(v.tokens) === JSON.stringify(s.tokens), v.rejected.join(','));
    ok(`A10 ${o.key}: its two fonts are library families, so a publish carries their files`, libraryFontsIn(s.tokens).length >= 1 && libraryFontsIn(s.tokens).length <= 2);
  }
  eq('A11: Restaurant Classic’s first opening is in its own new-site fonts', libraryFontsIn(TO.kindOpeningStart('food-photo').tokens).map((f) => f.family), ['Playfair Display', 'Manrope']);
  const pay = KO.openingsPayload();
  eq('A12: what + New site is sent: each kind’s openings with their pictures', Object.fromEntries(Object.entries(pay).map(([f, l]) => [f, l.map((x) => [x.key, x.design, x.picture])])),
    Object.fromEntries(['beauty', 'home', 'food'].map((f) => [f, KO.openingsOf(f).map((o) => [o.key, o.design, `/thumbs/openings/${o.key}.jpg`])])));
}

// ═══ B. the looks: the server's one list, and the editor is sent it ═══
{
  ok('B1: Original first, setting nothing, then the twelve', STYLE_LOOKS.length === 13 && STYLE_LOOKS[0].key === '' && Object.keys(STYLE_LOOKS[0].tokens).length === 0 && STYLE_LOOKS.slice(1).every((l) => l.tokens.look === l.key));
  ok('B2: every look’s settings are ones Styles may save', STYLE_LOOKS.every((l) => validateThemeTokens(l.tokens).rejected.length === 0));
  ok('B3: what a look clears covers everything any look sets, each emptied', STYLE_LOOKS.every((l) => Object.keys(l.tokens).every((k) => LOOK_KEYS.includes(k))) && LOOK_KEYS.every((k) => LOOK_CLEAR[k] === '') && Object.keys(LOOK_CLEAR).length === LOOK_KEYS.length);
  const { handleDevCustomizationGet } = await import('../../supabase/functions/presence/routes/dev.ts');
  const SITE_ID = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
  db.reset({ presence_dev_customizations: [{ site_id: SITE_ID, theme_tokens: { accent: '#123456' }, custom_css: '', custom_html: '' }], presence_site_members: [] });
  const r = await handleDevCustomizationGet('jwt', { id: SITE_ID, template_slug: 'harbor', template_version: '1.0.0' }, { kind: 'staff', userId: 'u', email: 'ops@example.com' }, {});
  const body = await r.json();
  ok('B4: GET /dev/customization sends the editor the one list of looks, beside the font library', r.status === 200 && JSON.stringify(body.data.looks) === JSON.stringify(STYLE_LOOKS) && Array.isArray(body.data.font_library) && body.data.font_library.length > 10);
  ok('B5: …and what picking a look clears', JSON.stringify(body.data.look_clear) === JSON.stringify(LOOK_CLEAR));
}

// ═══ drawing helpers ═══
const SITE = { baseUrl: 'https://example.com' };
const LIVE = { baseUrl: 'https://example.com', formEndpoint: 'https://fn.example/functions/v1/presence/forms/ab12ab12-ab12-4b12-8b12-ab12ab12ab12/submit' };
const opened = (key, f = () => {}) => { const o = KO.kindOpening(key); const snap = TO.startedSnapshot(sampleSnapshot(o.family, o.design), key); f(snap.content, snap); return snap; };
const home = async (snap, site = SITE) => String((await renderSnapshot(snap, site))['index.html']);
const cssOf = (files) => String(files[Object.keys(files).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k))]);
const heroOf = (html) => (/<section class="hero[^"]*"[\s\S]*?<\/section>/.exec(html) || [''])[0];

// ═══ C. what each opening draws, and only where used ═══
{
  for (const o of KO.KIND_OPENINGS) {
    const files = await renderSnapshot(opened(o.key), SITE);
    const html = String(files['index.html']), hero = heroOf(html), css = cssOf(files);
    const cls = o.layout === 'photo' ? 'hero hero-photo veil-dark' : `hero op op-${o.layout}${o.photo ? ' op-left' : ''}${o.band ? ' op-page' : ''}`;
    ok(`C1 ${o.key}: opens with its layout`, hero.startsWith(`<section class="${cls}"`), hero.slice(0, 80));
    ok(`C2 ${o.key}: the name centred at the top only for the centred editorial ones`, html.includes('<div class="wrap nav centered">') === (o.header === 'centered'));
    ok(`C3 ${o.key}: the look’s own layer comes with a look`, html.includes('id="dds-look"') === !!o.look);
    ok(`C4 ${o.key}: a card only where picked, its rules only then`, hero.includes('class="hero-card') === !!o.card && css.includes(HERO_CARD_CSS) === !!o.card);
    ok(`C5 ${o.key}: the photo on the left only where picked, its rules only then`, css.includes(TO.PANEL_LEFT_CSS) === (o.photo === 'left'));
  }
  // the card and the photo side are style settings: on a layout that can't show them they draw nothing
  const base = (layout, tokens) => { const s = sampleSnapshot('home', 'harbor'); s.content.settings = { ...s.content.settings, hero_layout: layout }; s.dev_customization = { theme_tokens: tokens, custom_css: '', custom_html: '' }; return s; };
  for (const layout of ['', 'split', 'panel', 'editorial', 'type']) {
    const a = await renderSnapshot(base(layout, { hero_card: 'estimate' }), SITE), b = await renderSnapshot(base(layout, {}), SITE);
    ok(`C6 a card asked for on “${layout || 'Classic'}”: no card, and the stylesheet is byte for byte the same`, cssOf(a) === cssOf(b) && !String(a['index.html']).includes('class="hero-card'));
  }
  for (const layout of ['photo', 'editorial', 'type']) {
    const a = await renderSnapshot(base(layout, { hero_photo: 'left' }), SITE), b = await renderSnapshot(base(layout, {}), SITE);
    ok(`C7 the photo on the left asked for on “${layout}”: drawn as without it`, cssOf(a) === cssOf(b) && !String(a['index.html']).includes('op-left'));
  }
  const withPhoto = await renderSnapshot(base('photo', { hero_card: 'estimate' }), SITE);
  const bareSnap = base('photo', { hero_card: 'estimate' }); bareSnap.content.offerings = bareSnap.content.offerings.map(({ media, ...x }) => x); bareSnap.content.posts = bareSnap.content.posts.map(({ hero, ...x }) => x);
  const noPhoto = await renderSnapshot(bareSnap, SITE);
  ok('C8 …and the photo layouts draw a card only over a photo', String(withPhoto['index.html']).includes('class="hero-card') && !String(noPhoto['index.html']).includes('class="hero-card') && !cssOf(noPhoto).includes('.hero-card'));
  const hidden = base('photo', { hero_card: 'estimate' }); hidden.content.settings.sections = { hidden: ['hero'], order: [] };
  const hf = await renderSnapshot(hidden, SITE);
  ok('C9 a welcome section taken off the page takes its card and the card’s rules with it', !String(hf['index.html']).includes('class="hero-card') && !cssOf(hf).includes('.hero-card'));
  const light = await renderSnapshot(base('photo-light', { hero_card: 'estimate' }), SITE);
  ok('C10 the light photo takes a card too', heroOf(String(light['index.html'])).startsWith('<section class="hero hero-photo veil-light"') && String(light['index.html']).includes('hc-estimate'));
}

// ═══ D. the cards' insides ═══
{
  // the estimate card: the Contact page's address, as a quote request
  const live = await home(opened('home-photo'), LIVE), hero = heroOf(live);
  const form = (/<form class="hc-form"[\s\S]*?<\/form>/.exec(hero) || [''])[0];
  ok('D1 estimate: a form to the site’s own form address', form.startsWith(`<form class="hc-form" method="post" action="${LIVE.formEndpoint}">`));
  const contact = String((await renderSnapshot(opened('home-photo'), LIVE))['contact/index.html']);
  ok('D2 …the same address as the Contact page’s form', contact.includes(`action="${LIVE.formEndpoint}"`));
  const names = [...form.matchAll(/<(?:input|textarea)[^>]*\bname="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  eq('D3 …a quote request: its kind, the page, the trap for robots, the name, one box for a phone or an email, what needs doing', names, ['form_kind', 'source_page', '_hp', 'name', 'contact', 'message']);
  ok('D4 …each box has its label, the name and the phone or email are needed', ['hc_name', 'hc_contact', 'hc_msg'].every((id) => form.includes(`<label for="${id}">`) && form.includes(`id="${id}"`)) && /name="name" required/.test(form) && /name="contact" required/.test(form) && /value="quote"/.test(form));
  ok('D5 …the page carries the sender, which sends it from the page (lib/site_send.ts)', /<script>\(function\(\)\{\nif\(!window\.fetch/.test(live) || live.includes('document.addEventListener(\'submit\''));
  // what the server makes of what the card sends: the real reading the submit route uses
  const read = (fields) => validateSubmission(formParamsToSubmission((k) => (k in fields ? fields[k] : null)));
  const phone = read({ form_kind: 'quote', source_page: '/', _hp: '', name: 'Dana', contact: '(818) 555-0100', message: 'A leaking tap' });
  const mail = read({ form_kind: 'quote', source_page: '/', _hp: '', name: 'Dana', contact: 'dana@example.com', message: '' });
  ok('D6 …a phone number arrives as the phone, an email as the email, as a quote request, the message not needed', phone.ok && phone.sub.phone === '(818) 555-0100' && !phone.sub.email && phone.sub.form_kind === 'quote' && mail.ok && mail.sub.email === 'dana@example.com' && !mail.spam);
  ok('D7 …nothing to reply to is refused, and a filled trap is marked', read({ form_kind: 'quote', name: 'Dana', contact: '' }).ok === false && read({ form_kind: 'quote', name: 'x', contact: 'a@b.co', _hp: 'bot' }).spam === true);
  const canvas = heroOf(String((await renderForBuilder(opened('home-photo')))['index.html']));
  ok('D8 …on the builder’s canvas the form is drawn with no address, like a Form section', canvas.includes('<form class="hc-form" method="post"><input type="hidden" name="form_kind" value="quote">'));

  // the today card: today's hours from the site's own week, the booking button, the ordering link
  const food = await home(opened('food-photo'));
  const card = (/<aside class="hero-card hc-today"[\s\S]*?<\/aside>/.exec(food) || [''])[0];
  const lines = [...card.matchAll(/<p class="hc-when" data-(day|date)="([^"]+)" hidden>([\s\S]*?)<\/p>/g)].map((m) => [m[2], m[3]]);
  eq('D9 today: a line for every day of the sample’s week and each of its holidays, all hidden until the page shows today’s', lines, [
    ['mon', 'Closed today'], ['tue', 'Open 5pm to 10pm'], ['wed', 'Open 5pm to 10pm'], ['thu', 'Open 5pm to 11pm'], ['fri', 'Open 12pm to 2:30pm and 5pm to 12am'],
    ['sat', 'Open 10am to 2:30pm and 5pm to 12am'], ['sun', 'Open 10am to 3pm'], ['2026-11-26', 'Closed today<br>Thanksgiving'], ['2026-12-24', 'Open 12pm to 8pm<br>Christmas Eve']]);   // item 432: the day first, the note on its own line
  ok('D10 …a link to all the hours and Restaurant Classic’s own booking button', card.includes('<a href="/contact/">See all hours</a>') && card.includes('<a class="btn" href="https://resy.example/vermilion-and-vine" rel="noopener">Reserve a table</a>') && !card.includes('Order online'));
  ok('D11 …the hours data and today’s script on the page, after the Open now line’s', food.indexOf('<script id="hours-data"') > 0 && food.indexOf(TODAY_JS) > food.indexOf('<script id="hours-data"'));
  const ordering = await home(opened('food-photo', (c) => { c.identity.ordering_url = 'https://order.example/vv'; }));
  ok('D12 …the ordering link when there is one', ordering.includes('<a class="hc-link" href="https://order.example/vv" rel="noopener">Order online <span aria-hidden="true">→</span></a>'));
  const bare = await renderSnapshot(opened('food-photo', (c) => { c.identity.booking_url = ''; c.identity.ordering_url = ''; c.locations = []; }), SITE);
  ok('D13 …no hours, no booking, no ordering: no card, and none of its rules', !String(bare['index.html']).includes('class="hero-card') && !cssOf(bare).includes('.hero-card'));
  const noHours = await home(opened('food-photo', (c) => { c.locations[0].hours = c.locations[0].hours.map((d) => ({ ...d, closed: true, intervals: [] })); }));
  ok('D14 …a week with no hours: the booking button alone, and no today’s line or script', noHours.includes('hc-today') && !noHours.includes('hc-when') && !noHours.includes('id="hc_today"') && !noHours.includes(TODAY_JS));
  const bad = await home(opened('food-photo', (c) => { c.identity.booking_url = 'javascript:alert(1)'; c.locations[0].holiday_exceptions = [{ date: '2026-12-31', label: '<b>New</b> "Year"', closed: true }]; }));
  ok('D15 …a booking link that isn’t safe is never a button, and the words are escaped', !/javascript:/.test(heroOf(bad)) && heroOf(bad).includes('Closed today<br>&lt;b&gt;New&lt;/b&gt; &quot;Year&quot;'));
  // the script, in a stand-in page: it only ever shows one of the lines the page has
  const run = (iso, html) => {
    const rows = [...html.matchAll(/<p class="hc-when" data-(day|date)="([^"]+)" hidden>/g)].map((m) => ({ kind: m[1], key: m[2], hidden: true }));
    const data = (/<script id="hours-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html) || [])[1];
    const box = { querySelector: (sel) => { const m = /^\[data-(day|date)="([^"]+)"\]$/.exec(sel); return rows.find((r) => r.kind === m[1] && r.key === m[2]) || null; } };
    const doc = { getElementById: (id) => (id === 'hc_today' ? box : id === 'hours-data' && data ? { textContent: data.replaceAll('\\u003c', '<') } : null) };
    const At = class extends Date { constructor(...a) { if (a.length) super(...a); else super(iso); } };
    new Function('document', 'Date', TODAY_JS)(doc, At);
    return rows.filter((r) => !r.hidden).map((r) => r.key);
  };
  eq('D16 today’s line: a Friday evening in Los Angeles shows Friday’s', run('2026-11-21T03:00:00Z', food), ['fri']);
  eq('D17 …a Monday morning there (still Sunday night in no other zone) shows Monday’s', run('2026-11-23T17:00:00Z', food), ['mon']);
  eq('D18 …Thanksgiving shows the holiday’s own line, not Thursday’s', run('2026-11-26T20:00:00Z', food), ['2026-11-26']);
  eq('D19 …late Sunday in Los Angeles is still Sunday there, though Monday in London', run('2026-11-23T06:30:00Z', food), ['sun']);
}

// ═══ E. every word an opening draws reads, its card too, on a computer and a phone ═══
// The header, the welcome section and the line of facts under it. (The rest of the page is the
// design's own, read by style_looks_333_test.mjs and the other contrast suites.)
for (const o of KO.KIND_OPENINGS) {
  const files = await renderSnapshot(opened(o.key, (c) => { c.identity.ordering_url = 'https://order.example/x'; }), LIVE);
  const doc = parseHtml(String(files['index.html'])), all = [...elementsIn(doc)];
  const head = all.find((e) => e.tag === 'head'), body = all.find((e) => e.tag === 'body');
  const sheets = [...sheetsOf(head, files), ...sheetsOf(body, files)];
  let worst = { r: Infinity, why: '' }, words = 0;
  const unread = new Set();
  // the words over the welcome photo sit on the photo under its veil (item 292), which this reading
  // can't see behind them; everything else is measured, the card on the photo too
  const overPhoto = new Set(all.filter((e) => e.classes.has('hero-photo')).flatMap((sec) => [...elementsIn(sec)].filter((e) => !(e.classes.has('hero-card') || [...ancestors(e)].some((a) => a.classes.has('hero-card'))))));
  const top = all.filter((e) => (e.tag === 'header' && e.classes.has('site')) || (e.tag === 'section' && e.classes.has('hero')) || (e.classes.has('strip') && e.parent?.tag === 'main'));
  const drawn = top.flatMap((e) => [e, ...elementsIn(e)]);
  for (const width of [1280, 390]) {
    const c = cascade(doc, sheets, { width, height: 900, later: true });
    c.unread.forEach((u) => unread.add(u));
    for (const el of drawn) for (const w of c.words(el)) {
      if (w.image || overPhoto.has(el)) continue;
      words++;
      if (w.ratio < worst.r) worst = { r: w.ratio, why: `${el.tag}.${[...el.classes].join('.')} "${w.what.slice(0, 30)}" ${hexOf(w.fg)} on ${hexOf(w.bg)} at ${width}px` };
    }
  }
  ok(`E1 ${o.key}: every word it draws reads at 4.5:1 or better (worst ${worst.r.toFixed(2)}:1, ${words} words)`, worst.r >= 4.5 && words > 15 && unread.size === 0, `${worst.why} ${[...unread].slice(0, 2).join(' | ')}`);
}

// Type only's band under every look and the look's own button set: the band's buttons stay white
// with the band's words, over any set (a set's colours are picked for the page, not the band)
{
  const under = [];
  for (const l of STYLE_LOOKS.filter((x) => x.key)) for (const slug of ['harbor', 'restaurant-classic', 'atelier']) {
    const s = sampleSnapshot('home', slug);
    s.content.settings = { ...s.content.settings, hero_layout: 'type' };
    s.content.identity.ordering_url = 'https://order.example/x';
    s.dev_customization = { theme_tokens: l.tokens, custom_css: '', custom_html: '' };
    const files = await renderSnapshot(s, LIVE);
    const doc = parseHtml(String(files['index.html'])), all = [...elementsIn(doc)];
    const head = all.find((e) => e.tag === 'head'), body = all.find((e) => e.tag === 'body');
    const c = cascade(doc, [...sheetsOf(head, files), ...sheetsOf(body, files)], { width: 1280, height: 900, later: true });
    const band = all.find((e) => e.classes.has('op-type'));
    for (const el of [band, ...elementsIn(band)]) for (const w of c.words(el)) if (w.ratio < 4.5) under.push(`${l.name} ${slug} ${el.tag}.${[...el.classes].join('.')} "${w.what.slice(0, 20)}" ${hexOf(w.fg)} on ${hexOf(w.bg)}`);
  }
  ok('E2: Type only’s band reads under every look with its own button set', under.length === 0, under.slice(0, 4).join(' | '));
}

// ═══ F. + New site with an opening: the real POST /agency/sites ═══
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', ME = '11111111-1111-4111-8111-111111111111';
const OLD = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', OLDC = 'c1000000-0000-4000-8000-000000000001';
const KIT = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd', TPL_KIT = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const pg = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = String(init.method || 'GET').toUpperCase();
  if (u.host === 'api.netlify.com') {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const name = body.name || u.pathname.split('/').pop();
    return new Response(JSON.stringify({ id: 'nf-new', name, default_domain: `${name}.netlify.app`, state: 'ready' }), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  }
  // the database's own default: a new site is on Atelier at its first version (migration 0110)
  if (u.pathname === '/rest/v1/presence_sites' && method === 'POST') init = { ...init, body: JSON.stringify({ template_slug: 'atelier', template_version: '1.0.0', ...JSON.parse(String(init.body)) }) };
  return pg(url, init);
};
function seed() {
  db.reset({
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active' }],
    presence_agency_clients: [{ site_id: OLD, agency_id: AG, status: 'active', tags: [], owner_email: 'owner@bistro.example' }],
    presence_sites: [{ id: OLD, client_id: OLDC, edition: 'presence', status: 'live', template_slug: 'atelier', template_version: '1.0.0' }],
    clients: [{ id: OLDC, name: 'Bistro Nine', email: 'owner@bistro.example' }],
    presence_settings: [{ site_id: OLD, hero_layout: '', nav_style: '', industry_key: 'restaurant' }],
    presence_dev_customizations: [{ site_id: OLD, theme_tokens: { accent: '#8c3b2e' }, custom_css: '', custom_html: '' }],
    presence_starter_kits: [
      { id: KIT, agency_id: AG, name: 'Salon colours', payload: { industry_key: 'salon', template_slug: '', category_order: [], offerings: [], faqs: [], voice: { tone_notes: '', preferred_vocabulary: '', never_claim: '' }, theme_tokens: { accent: '#7a2e5e', header_scroll: 'stay' } } },
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
const siteOf = (id) => (db.tables.presence_sites || []).find((s) => s.id === id);
const settingsOf = (id) => (db.tables.presence_settings || []).find((s) => s.site_id === id);
const tokensOf = (id) => (db.tables.presence_dev_customizations || []).find((s) => s.site_id === id)?.theme_tokens;
const oldBefore = () => JSON.stringify([siteOf(OLD), settingsOf(OLD), tokensOf(OLD)]);
for (const o of KO.KIND_OPENINGS) {
  seed();
  const before = oldBefore();
  const r = await newSite({ business_name: `A ${o.key} site`, template_slug: o.design, industry_key: o.family === 'beauty' ? 'salon' : o.family === 'home' ? 'home_services' : 'restaurant', opening: o.key });
  const id = r.body.data?.site_id, want = TO.kindOpeningStart(o.key);
  ok(`F1 ${o.key}: made on its design, with its layout${o.header ? ' and the name centred at the top' : ''}`, r.status === 201 && siteOf(id)?.template_slug === o.design && settingsOf(id)?.hero_layout === o.layout && (settingsOf(id)?.nav_style || '') === o.header, JSON.stringify(r.body).slice(0, 240));
  eq(`F2 ${o.key}: exactly its style: the look whole (or the design’s fonts), its card and photo side`, tokensOf(id), want.tokens);
  eq(`F3 ${o.key}: the answer says what it was given`, r.body.data.opening, { key: o.key, name: o.name, slug: o.design, layout: o.layout, applied: { layout: true, style: true } });
  ok(`F4 ${o.key}: the history says it in plain words`, db.tables.presence_change_events.some((e) => e.site_id === id && e.summary === `Opens with “${o.name}”`));
  ok(`F5 ${o.key}: the site that was already there is untouched`, oldBefore() === before);
}
{
  seed();
  const sites = db.tables.presence_sites.length, clients = db.tables.clients.length;
  const r = await newSite({ business_name: 'Unknown Opening', opening: 'beauty-neon' });
  ok('F6: an opening that isn’t offered is refused in plain words, and nothing is made', r.status === 400 && r.body.error === 'bad_opening' && /isn’t one of the ones offered/.test(r.body.message) && db.tables.presence_sites.length === sites && db.tables.clients.length === clients);
  const m = await newSite({ business_name: 'Wrong Design', template_slug: 'meadow', opening: 'beauty-panel' });
  ok('F7: an opening sent with another design is refused, and nothing is made', m.status === 400 && /made with another design/.test(m.body.message) && db.tables.presence_sites.length === sites);
  const n = await newSite({ business_name: 'Not A Word', opening: 42 });
  ok('F8: an opening that isn’t a word is refused too', n.status === 400 && n.body.error === 'bad_opening');
}
{
  seed();
  const r = await newSite({ business_name: 'Opening Alone', opening: 'home-photo' });
  const id = r.body.data?.site_id;
  ok('F9: an opening alone brings its design', r.status === 201 && siteOf(id)?.template_slug === 'harbor' && r.body.data.look?.slug === 'harbor' && settingsOf(id)?.hero_layout === 'photo');
}
{
  seed();
  const r = await newSite({ business_name: 'Plain Harbor', template_slug: 'harbor', industry_key: 'plumber' });
  const id = r.body.data?.site_id;
  eq('F10: no opening: as before, the design’s own start (Harbor: type only, in its two fonts)', [settingsOf(id)?.hero_layout, tokensOf(id), r.body.data.opening], ['type', TO.openingStartFor('harbor').tokens, { slug: 'harbor', layout: 'type', fonts: ['Roboto Slab', 'Work Sans'], applied: { layout: true, fonts: true } }]);
}
{
  seed();
  const r = await newSite({ business_name: 'Kit Then Look', kit_id: KIT, opening: 'beauty-panel', industry_key: 'salon' });
  const id = r.body.data?.site_id;
  ok('F11: a starter kit still lands; the opening’s look goes on over its colours, and its other settings stay', r.status === 201 && r.body.data.kit?.applied?.colors === true
    && JSON.stringify(tokensOf(id)) === JSON.stringify({ header_scroll: 'stay', ...TO.kindOpeningStart('beauty-panel').tokens }), JSON.stringify(tokensOf(id)));
}
{
  seed();
  const r = await newSite({ business_name: 'From My Template', kit_id: TPL_KIT, opening: 'home-type' });
  const id = r.body.data?.site_id;
  ok('F12: a saved template brings its own look: the opening isn’t applied over it', r.status === 201 && r.body.data.opening === null && !tokensOf(id)?.look && settingsOf(id)?.hero_layout !== 'type', JSON.stringify({ o: r.body.data.opening, s: settingsOf(id), t: tokensOf(id) }));
}

// ═══ G. what + New site is sent, and "See it full size", through the real routes ═══
{
  const call = async (path) => {
    const req = new Request('http://stub.local/functions/v1/presence' + path, { method: 'GET' });
    const res = await handleAgency(req, path.split('?')[0], 'GET', member, PRINCIPAL, {});
    return { status: res.status, body: await res.json() };
  };
  seed();
  const g = await call('/agency/designs');
  eq('G1: GET /agency/designs sends each kind’s openings, the first one first', Object.fromEntries(Object.entries(g.body.data.openings).map(([f, l]) => [f, l.map((x) => x.key)])),
    { beauty: ['beauty-panel', 'beauty-photo', 'beauty-editorial'], home: ['home-type', 'home-photo', 'home-panel'], food: ['food-photo', 'food-editorial', 'food-type'] });
  ok('G2 …with their plain names, lines, designs and pictures', g.body.data.openings.beauty[0].name === 'Split on a colour panel · Blush' && g.body.data.openings.food[0].picture === '/thumbs/openings/food-photo.jpg' && g.body.data.openings.home.every((x) => x.design === 'harbor'));
  let r = await call('/agency/designs/harbor/sample?kind=plumber&opening=home-photo');
  const html = r.body?.data?.html || '';
  ok('G3: See it full size draws an opening: the plumber in Harbor, over the photo in Steady navy, with the estimate card', r.status === 200 && html.includes('Copper Line Plumbing') && html.includes('hero hero-photo veil-dark') && html.includes('hc-estimate') && html.includes('id="dds-look"'));
  ok('G4 …a page a frame can show safely: no scripts, and the card’s form sends nowhere', !/<script/i.test(html) && html.includes('<form class="hc-form" method="post"><input') && !html.includes('https://example.com'));
  r = await call('/agency/designs/restaurant-classic/sample?kind=restaurant&opening=food-photo');
  ok('G5 …the today card shows Friday’s line, the day its picture shows', r.status === 200 && /<p class="hc-when" data-day="fri">Open 12pm to 2:30pm and 5pm to 12am<\/p>/.test(r.body.data.html) && (r.body.data.html.match(/<p class="hc-when"[^>]*>/g) || []).filter((x) => !x.includes('hidden')).length === 1);
  r = await call('/agency/designs/atelier/sample?kind=salon&opening=home-photo');
  ok('G6: an opening made with another design is said plainly', r.status === 404 && /isn’t one of this design’s/.test(r.body.message));
  r = await call('/agency/designs/harbor/sample?kind=salon&opening=nope');
  ok('G7: …and one that isn’t offered', r.status === 404);
  r = await call('/agency/designs/harbor/sample?kind=salon');
  ok('G8: a design with no opening is drawn as a new site on it starts: Harbor opens with type only, in its fonts', r.status === 200 && r.body.data.html.includes('<section class="hero op op-type"') && r.body.data.html.includes("--font_display:Roboto Slab"));
}

const failed = results.filter((x) => !x).length;
console.log(`\n════ OPENINGS PER KIND + THE ONE LIST OF LOOKS: ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
