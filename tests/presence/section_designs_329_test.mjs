// ── The bold section designs Eric picked in Figma (builder item 329) ─────────────────
//   deno run --allow-read --allow-env tests/presence/section_designs_329_test.mjs
//   deno run --allow-read --allow-env --allow-write tests/presence/section_designs_329_test.mjs --update-fixtures
// The Nov 22 review: every new section arrived as thin white cards, "Image + text" was one line
// of words, and features, prices and questions read like a wireframe. Figma section C gave eight
// designs, each a style variant of a section that exists (lib/site_blocks.ts BLOCK_VARIANTS):
//   image_text  overlap (the photo off the page's edge, a card over it), frame (the photo on an
//               offset accent block, a big number and its line beside it)
//   features    numbered (01, 02, 03 under thick rules), tiles (line icons on a dark band)
//   pricing     menu (a printed price list, two columns past four rows), plans (the featured plan
//               raised, "Most popular")
//   accordion   side (the heading and a short line beside the questions), numbered (answers
//               showing, two columns, on a tinted band)
// This drives the real validator, renderer and publish: every design on every template, the new
// fields' bounds and escaping, unknown designs falling back, the designs' styles shipping only
// where they're used (and whole on the builder's canvas), and every word in them reading. It
// also writes the pages tests/e2e/section-designs-329.spec.ts measures in a browser.
import { renderSnapshot, renderForBuilder, devLayerFragments, FIXED_COLOR_TEMPLATES } from '../../supabase/functions/presence/lib/render.ts';
import { buttonStyle, siteColours } from '../../supabase/functions/presence/lib/site_buttons.ts';
import { lookStyle } from '../../supabase/functions/presence/lib/site_looks.ts';
import { validateBlocks, resolveBlockMedia, unresolveBlockMedia, renderSiteBlocks, BLOCK_VARIANTS, BLOCK_CSS, DESIGN_CSS, sectionStyles } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import { TEMPLATES, fixture } from './full_fixture.mjs';
import { parseHtml, elementsIn, sheetsOf, cascade, hexOf } from './style_cascade.mjs';
import { editorSource } from './editor_source.mjs';   // the editor's palettes and looks, read as data

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ctx = { esc, attr, safeHref };
const SITE = { baseUrl: 'https://shop.example' };
const PIC = '00000000-0000-4000-8000-0000000329a1', PIC2 = '00000000-0000-4000-8000-0000000329a2';
const ref = (id) => ({ alt: 'A sample photo', variants: { w400: `/img/s${id.slice(-4)}-400.webp`, w800: `/img/s${id.slice(-4)}-800.webp` }, width: 1600, height: 1200 });
const draw = (raw) => renderSiteBlocks(resolveBlockMedia(validateBlocks(raw), ref), ctx);
const html1 = (raw) => (draw([raw])[0] || { html: '' }).html;

// One of each design, filled the way the Figma frames are (fake sample businesses).
const DESIGNS = {
  overlap: { type: 'image_text', variant: 'overlap', title: 'Baked at 4am, gone by noon.', image_id: PIC, body: 'Sourdough, rye and seeded loaves from a 30-hour dough. Order by 8pm and we hold one for you.', side: 'left', button: { label: 'Order for pickup', url: 'https://example.com/order' } },
  frame: { type: 'image_text', variant: 'frame', title: 'Gardens that look after themselves.', image_id: PIC2, body: 'Native plants, drip watering and a plan for every season, so your weekends stay yours.', side: 'left', button: { label: 'See finished gardens', url: 'https://example.com/work' }, number: '15', number_label: 'years planting gardens in Glendale' },
  numbered: { type: 'features', variant: 'numbered', title: 'Why clients stay with us.', items: [
    { title: 'A fixed fee, agreed first', text: 'You know the cost before we start, in writing, with no hourly surprises.' },
    { title: 'You speak to a partner', text: 'Every case is run by one of our two partners, from the first call to the end.' },
    { title: 'Answers within a day', text: 'Call or email and you hear back the same working day.' }] },
  tiles: { type: 'features', variant: 'tiles', title: 'Four promises on every job.', items: [
    { title: 'On time, or $50 off', text: 'If we are late for your window, $50 comes off the bill.', icon: 'icon:clock' },
    { title: 'Licensed and insured', text: 'Every crew member is checked, trained and covered.', icon: 'icon:shield' },
    { title: 'Price agreed first', text: 'You approve the price before any work begins.', icon: '✓' },
    { title: 'A real person answers', text: 'Call between 7 and 7 and talk to us, not a menu.', icon: 'icon:phone' }] },
  menu: { type: 'pricing', variant: 'menu', title: 'Today’s prices', tiers: [
    { name: 'Espresso', price_text: '3.50', features: [] }, { name: 'Cortado', price_text: '4.25', features: [] }, { name: 'Oat milk latte', price_text: '5.50', features: ['Oat or almond'] },
    { name: 'Pour-over, single origin', price_text: '5.00', features: [] }, { name: 'Butter croissant', price_text: '4.00', features: [] }, { name: 'Cardamom bun', price_text: '4.75', features: [] },
    { name: 'Sourdough loaf', price_text: '9.00', features: [] }, { name: 'Seeded rye', price_text: '10.00', features: [] }] },
  plans: { type: 'pricing', variant: 'plans', title: 'Pick how you train.', tiers: [
    { name: 'Drop in', price_text: '$25 one class', features: ['Any class on the timetable', 'Gloves to borrow'] },
    { name: 'Unlimited', price_text: '$129 a month', features: ['Every class, every day', 'Open gym hours', 'One coaching check-in a month'] },
    { name: 'Ten classes', price_text: '$199 use within 3 months', features: ['Any ten classes', 'Share with a friend'] }] },
  side: { type: 'accordion', variant: 'side', title: 'Questions people ask before they call.', intro: 'Still not sure? Ask us anything and you get a straight answer.', items: [
    { summary: 'Do you charge for estimates?', body: 'No. We visit, measure and send a written price within 48 hours, free.' },
    { summary: 'How long does a kitchen take?', body: 'Most kitchens take three to five weeks.' },
    { summary: 'Do you pull the permits?', body: 'Yes, every permit, every time. [See our licence](https://example.com/licence).' }] },
  qnumbered: { type: 'accordion', variant: 'numbered', title: 'Good to know before your visit', items: [
    { summary: 'How early should I book?', body: 'Two weeks ahead for Saturdays. Weekdays often have space within a few days.' },
    { summary: 'What if I’m running late?', body: 'Text us. Up to 15 minutes we keep your full time.' },
    { summary: 'Do you do a patch test?', body: 'Yes, for every new colour client, 48 hours before.' },
    { summary: 'Can I bring a photo?', body: 'Please do. It is the quickest way to show us what you love.' }] },
};
const ROOT_CLASS = { overlap: 'block-imgtext v-overlap', frame: 'block-imgtext v-frame', numbered: 'block-features v-numbered', tiles: 'block-features v-tiles', menu: 'block-pricing v-menu', plans: 'block-pricing v-plans', side: 'block-accordion v-side', qnumbered: 'block-accordion v-numbered' };
// a rule each design's stylesheet carries, and the inner classes only that design draws
const RULE = { overlap: '.block-imgtext.v-overlap .iw-card{', frame: '.block-imgtext.v-frame .iw-big{', numbered: '.block-features.v-numbered .fn-item{', tiles: '.block-features.v-tiles .ft-tile{', menu: '.block-pricing.v-menu .pm-line{', plans: '.block-pricing.v-plans .pp-card{', side: '.block-accordion.v-side .qs-item summary{', qnumbered: '.block-accordion.v-numbered .qn-item{' };
const OWN = { overlap: 'iw-over', frame: 'iw-frame', numbered: 'fn-', tiles: 'ft-', menu: 'pm-', plans: 'pp-', side: 'qs-', qnumbered: 'qn-' };

// ═══ 1. the designs are the variants the brief names, on the sections that exist ═══
{
  const want = { image_text: ['overlap', 'frame'], features: ['numbered', 'tiles'], pricing: ['menu', 'plans'], accordion: ['side', 'numbered'] };
  ok('BLOCK_VARIANTS offers the eight designs on image + text, features, prices and questions', Object.entries(want).every(([t, vs]) => vs.every((v) => (BLOCK_VARIANTS[t] || []).includes(v))));
  ok('…and keeps the looks there were (price list, two columns, the rest)', BLOCK_VARIANTS.pricing.includes('list') && BLOCK_VARIANTS.accordion.includes('two-column') && BLOCK_VARIANTS.gallery.length === 2 && BLOCK_VARIANTS.reviews_wall.length === 2 && BLOCK_VARIANTS.cta.length === 1);
  for (const [k, raw] of Object.entries(DESIGNS)) ok(`${k}: the design survives validation`, validateBlocks([raw])[0]?.variant === raw.variant);
}

// ═══ 2. an unknown design, or one from another section, falls back to the drawing of today ═══
{
  const cases = [['image_text', 'sparkly'], ['image_text', 'tiles'], ['features', 'menu'], ['features', 'Numbered'], ['pricing', 'side'], ['pricing', 'frame'], ['accordion', 'plans'], ['accordion', 'overlap']];
  for (const [type, variant] of cases) {
    const base = Object.values(DESIGNS).find((d) => d.type === type);
    const { variant: _v, ...plain } = base;
    const stored = validateBlocks([{ ...plain, variant }])[0];
    ok(`${type} with "${variant}" stores no design and draws exactly as the default`, stored && !('variant' in stored) && html1({ ...plain, variant }) === html1(plain));
  }
  ok('a design name that is not a string is dropped too', !('variant' in validateBlocks([{ ...DESIGNS.tiles, variant: ['tiles'] }])[0]) && !('variant' in validateBlocks([{ ...DESIGNS.menu, variant: { menu: 1 } }])[0]));
}

// ═══ 3. the new fields: validated, capped, kept apart from the drawing of today ═══
{
  const it = validateBlocks([{ ...DESIGNS.frame, number: '  1,200+   happy  ', number_label: 'x'.repeat(90) }])[0];
  ok('the big number is tidied and capped at 12, its line at 60', it.number === '1,200+ happy' && it.number_label === 'x'.repeat(60));
  const none = validateBlocks([{ ...DESIGNS.frame, number: '   ', number_label: '' }])[0];
  ok('empty number fields store nothing', !('number' in none) && !('number_label' in none));
  const acc = validateBlocks([{ ...DESIGNS.side, intro: 'y'.repeat(260) }, { ...DESIGNS.side, intro: '  ' }]);
  ok('the short line under the heading caps at 200; empty stores nothing', acc[0].intro === 'y'.repeat(200) && !('intro' in acc[1]));
  const f = (featured, tiers = DESIGNS.plans.tiers) => validateBlocks([{ ...DESIGNS.plans, tiers, featured }])[0].featured;
  ok('the raised plan: a whole number naming a plan that is there (0 = none) is kept', f(1) === 1 && f(3) === 3 && f(0) === 0);
  ok('…anything else is dropped (the middle one of three is the default)', [4, -1, 1.5, '2', true, null, NaN, Infinity].every((v) => f(v) === undefined));
  ok('…and a plan number past a shorter list is dropped', f(3, DESIGNS.plans.tiers.slice(0, 2)) === undefined);
  const rows = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i + 1}`, price_text: `${i + 1}.00`, features: [] }));
  const kept = (variant) => validateBlocks([{ type: 'pricing', tiers: rows, ...(variant ? { variant } : {}) }])[0].tiers.length;
  ok('a printed price list keeps up to 16 rows; cards, the price list and the plans keep four, as before', kept('menu') === 16 && kept('') === 4 && kept('list') === 4 && kept('plans') === 4);
  // the drawing of today ignores the new fields: byte for byte the same with or without them
  const pairs = [
    [{ type: 'image_text', title: 'Our story', image_id: PIC, body: 'Ten years on.', side: 'right' }, { number: '15', number_label: 'years' }],
    [{ type: 'accordion', items: [{ summary: 'Q?', body: 'A.' }] }, { intro: 'A short line.' }],
    [{ type: 'accordion', variant: 'two-column', items: [{ summary: 'Q?', body: 'A.' }] }, { intro: 'A short line.' }],
    [{ type: 'pricing', tiers: DESIGNS.plans.tiers }, { featured: 1 }],
    [{ type: 'pricing', variant: 'list', tiers: DESIGNS.plans.tiers }, { featured: 1 }],
  ];
  ok('today’s drawings (and the price list and two-column looks) are byte-identical with the new fields set', pairs.every(([b, extra]) => html1(b) === html1({ ...b, ...extra })));
  ok('the overlap design draws no big number (only the colour frame does)', !html1({ ...DESIGNS.overlap, number: '15', number_label: 'years' }).includes('iw-num'));
  ok('the colour frame draws the number only when both fields are filled', html1(DESIGNS.frame).includes('class="iw-num"') && !html1({ ...DESIGNS.frame, number_label: '' }).includes('iw-num') && !html1({ ...DESIGNS.frame, number: '' }).includes('iw-num'));
  // the fields ride the media rebuilds both ways (a restore from an older version keeps them)
  const back = unresolveBlockMedia(resolveBlockMedia(validateBlocks([DESIGNS.frame, DESIGNS.plans, { ...DESIGNS.plans, featured: 0 }, DESIGNS.side]), ref), (m) => (m.variants.w400.includes('29a2') ? PIC2 : PIC));
  ok('number, its line, the raised plan and the short line survive resolve and back', back[0].number === '15' && back[0].number_label === DESIGNS.frame.number_label && back[0].variant === 'frame' && back[2].featured === 0 && back[3].intro === DESIGNS.side.intro);
}

// ═══ 4. hostile words stay words, in every design ═══
{
  const bad = '<script>alert(1)</script>', quote = '" onmouseover="alert(1)', img = '<img src=x onerror=alert(1)>';
  const raw = [
    { ...DESIGNS.overlap, title: bad, body: img, button: { label: quote, url: 'javascript:alert(1)' } },
    { ...DESIGNS.frame, title: bad, number: bad, number_label: quote, button: { label: bad, url: 'https://example.com/x' } },
    { ...DESIGNS.numbered, items: [{ title: bad, text: quote }] },
    { ...DESIGNS.tiles, items: [{ title: bad, text: img, icon: '<b>' }, { title: 'x', icon: 'icon:"><script>' }] },
    { ...DESIGNS.menu, tiers: [{ name: bad, price_text: quote, features: [img] }] },
    { ...DESIGNS.plans, tiers: [{ name: bad, price_text: '$9<script>', features: [img] }, { name: quote, price_text: img, features: [] }] },
    { ...DESIGNS.side, title: bad, intro: img, items: [{ summary: bad, body: img }] },
    { ...DESIGNS.qnumbered, items: [{ summary: quote, body: bad }] },
  ];
  const out = draw(raw);
  ok('all eight still draw', out.length === 8 && out.every((b, i) => b.html.includes(ROOT_CLASS[Object.keys(DESIGNS)[i]])));
  ok('no tag, attribute or script link gets through', out.every((b) => !/<script|<img\s+src=x|onmouseover="alert|href="javascript:|<b>/i.test(b.html) && b.html.includes('&lt;')));
  ok('a made-up line icon name draws no icon markup of its own', !out[3].html.includes('icon:') && !out[3].html.includes('"&gt;'));
}

// ═══ 5. what each design draws ═══
{
  const o = html1(DESIGNS.overlap);
  ok('overlap: a full-width section with the page box inside, the photo then a card holding the heading, words and button', /^<section [^>]*class="block block-imgtext v-overlap"><div class="wrap"><div class="iw-over it-left">/.test(o) && /iw-media.*iw-card.*<h2[^>]*>Baked at 4am/.test(o) && o.includes('class="btn"'));
  ok('overlap: the photo on the right side when picked', html1({ ...DESIGNS.overlap, side: 'right' }).includes('iw-over it-right'));
  ok('overlap with no photo: the card alone', html1({ ...DESIGNS.overlap, image_id: undefined }).includes('iw-over it-left iw-solo') && !html1({ ...DESIGNS.overlap, image_id: undefined }).includes('iw-media'));
  const fr = html1(DESIGNS.frame);
  ok('frame: the photo, then the number and its line, the heading, the words and a link with an arrow', /iw-frame it-left">.*iw-media.*iw-words.*iw-num.*iw-big[^>]*>15<.*iw-lbl[^>]*>years planting.*<h2/.test(fr) && fr.includes('class="iw-link"') && fr.includes('<span aria-hidden="true">→</span>'));
  const n = html1(DESIGNS.numbered);
  ok('numbered features: an ordered list, 01 02 03 in each heading, hidden from a screen reader (the list counts)', n.includes('<ol class="fn-list">') && ['01', '02', '03'].every((x) => n.includes(`<span class="fn-num" aria-hidden="true">${x}</span>`)));
  const t = html1(DESIGNS.tiles);
  ok('tiles: a list of tiles, a line icon drawn as itself, a typed one as words', t.includes('<ul class="ft-grid">') && (t.match(/<svg /g) || []).length === 3 && t.includes('<span class="ft-ic" aria-hidden="true">✓</span>'));
  ok('tiles: its own colour theme is the dark band', /class="block block-features v-tiles block--bg-dark"/.test(t));
  const look = (l, st) => html1({ ...DESIGNS.tiles, ...(l ? { look: { background: l } } : {}), ...(st ? { style: st } : {}) });
  ok('…a theme the owner picks wins (tinted, plain, accent, dark), and so does their own colour', ['tinted', 'plain', 'accent', 'dark'].every((l) => (look(l).match(/block--bg-/g) || []).length === 1) && look('', { bg_color: '#123456' }).includes('ov-bg') && !look('', { bg_color: '#123456' }).includes('block--bg-dark'));
  const m = html1(DESIGNS.menu);
  ok('menu: past four rows, two columns of four, in order down the first then the second', m.includes('pm-cols pm-two') && (m.match(/<ul class="pm-col">/g) || []).length === 2 && m.indexOf('Pour-over') < m.indexOf('</ul>') && m.indexOf('Butter croissant') > m.indexOf('</ul>'));
  const m4 = html1({ ...DESIGNS.menu, tiers: DESIGNS.menu.tiers.slice(0, 4) });
  ok('menu: four rows or fewer, one column', !m4.includes('pm-two') && (m4.match(/<ul class="pm-col">/g) || []).length === 1);
  ok('menu: odd rows split with the extra one first', (() => { const h = html1({ ...DESIGNS.menu, tiers: DESIGNS.menu.tiers.slice(0, 5) }); const first = h.slice(0, h.indexOf('</ul>')); return (first.match(/pm-row/g) || []).length === 3; })());
  ok('menu: a dotted line between each name and its price, a row’s notes under it', m.includes('<span class="pm-dots" aria-hidden="true"></span><span class="pm-price" data-dds-field="tiers.0.price_text">3.50</span>') && m.includes('<span class="pm-note"><span data-dds-field="tiers.2.features.0">Oat or almond</span></span>'));
  const plan = (extra) => html1({ ...DESIGNS.plans, ...extra });
  const raised = (h) => [...h.matchAll(/<li class="pp-card( pp-on)?">/g)].map((x) => !!x[1]);
  ok('plans: the middle one of three is raised by default, with a "Most popular" badge', JSON.stringify(raised(plan({}))) === '[false,true,false]' && (plan({}).match(/Most popular/g) || []).length === 1);
  ok('plans: the plan the owner marks is raised instead; 0 raises none', JSON.stringify(raised(plan({ featured: 3 }))) === '[false,false,true]' && !plan({ featured: 0 }).includes('pp-on') && !plan({ featured: 0 }).includes('Most popular'));
  ok('plans: two or four plans raise none unless one is marked', !plan({ tiers: DESIGNS.plans.tiers.slice(0, 2) }).includes('pp-on') && JSON.stringify(raised(plan({ tiers: DESIGNS.plans.tiers.slice(0, 2), featured: 2 }))) === '[false,true]');
  ok('plans: the price is drawn big up to its first number, the rest small, the words unchanged', plan({}).includes('data-dds-field="tiers.1.price_text"><span class="pp-big">$129</span><span class="pp-per"> a month</span></p>'));
  ok('plans: a price with no number is drawn at one size', html1({ ...DESIGNS.plans, tiers: [{ name: 'Visit', price_text: 'Free', features: [] }] }).includes('<span class="pp-word">Free</span>'));
  const s = html1(DESIGNS.side);
  ok('side: the heading and the short line on the left, the questions on the right, the first open', /qs-head"><h2[^>]*>Questions people ask.*<p class="qs-intro" data-dds-field="intro">Still not sure/.test(s) && (s.match(/<details class="qs-item" open>/g) || []).length === 1 && (s.match(/<details class="qs-item">/g) || []).length === 2);
  const q = html1(DESIGNS.qnumbered);
  ok('numbered questions: an ordered list, numbers in each question’s heading, the answers showing (no details)', q.includes('<ol class="qn-grid">') && q.includes('<span class="qn-num" aria-hidden="true">04</span>') && !q.includes('<details'));
  ok('numbered questions: their own colour theme is the tinted band; a theme the owner picks wins', q.includes('v-numbered block--bg-tint"') && !html1({ ...DESIGNS.qnumbered, look: { background: 'plain' } }).includes('block--bg-tint'));
  // the editor's in-place typing finds every field (G13 stamps)
  const stamps = { overlap: ['title', 'body', 'button.label'], frame: ['number', 'number_label', 'title', 'body', 'button.label'], numbered: ['title', 'items.0.title', 'items.2.text'], tiles: ['items.3.title', 'items.1.text'],
    menu: ['tiers.7.name', 'tiers.7.price_text', 'tiers.2.features.0'], plans: ['tiers.0.name', 'tiers.1.price_text', 'tiers.1.features.2'], side: ['title', 'intro', 'items.2.summary', 'items.0.body'], qnumbered: ['items.3.summary', 'items.3.body'] };
  ok('every word in the designs carries its field, so it can be typed on the page', Object.entries(stamps).every(([k, fields]) => fields.every((f) => html1(DESIGNS[k]).includes(`data-dds-field="${f}"`))));
  // headings and anchors as before: the same fallbacks, so the on-this-page list and links agree
  const bare = draw([{ ...DESIGNS.side, title: undefined }, { ...DESIGNS.numbered, title: undefined }, { ...DESIGNS.menu, title: undefined }]);
  ok('a design with no title shows the section’s usual heading and anchor', bare[0].html.includes('id="more-information"') && bare[0].html.includes('>More information</h2>') && bare[1].html.includes('>Why choose us</h2>') && bare[2].html.includes('>Pricing</h2>'));
  // what Google reads is the same for every design of a price list
  const ld = (raw) => JSON.stringify(draw([raw])[0].ld);
  const { variant: _, ...cards } = DESIGNS.plans;
  ok('the plans and the printed list carry the same Offer list as cards', ld(DESIGNS.plans) === ld(cards) && JSON.parse(ld(DESIGNS.menu)).itemListElement.length === 8);
}

// ═══ 6. every template draws every design, and ships only the styles a site uses ═══
const page = (slug, list) => {
  const s = fixture(slug);
  const d = composeBlocks(structuredClone(list), () => null, ref, {});
  s.content.settings = { ...(s.content.settings || {}), pages: [{ slug: 'designs', title: 'Designs', blocks: d.blocks, blocks_src: d.src }] };
  return s;
};
const cssOf = (files) => { const k = Object.keys(files).find((x) => /^assets\/site-[0-9a-f]+\.css$/.test(x)); return { key: k, css: String(files[k]) }; };
// the selectors DESIGN_CSS draws, each needing a class only the designs carry
const splitTop = (list) => { const out = []; let d = 0, cur = ''; for (const c of list) { if (c === '(') d++; if (c === ')') d--; if (!d && c === ',') { out.push(cur); cur = ''; } else cur += c; } return [...out, cur]; };
const designSelectors = [...DESIGN_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{[^{}]*\}/g)].flatMap((m) => splitTop(m[1]).map((x) => x.trim())).filter((x) => x && !x.startsWith('('));
const ALL = Object.values(DESIGNS);
const drawn = {};
for (const slug of TEMPLATES) {
  const files = await renderSnapshot(page(slug, ALL), SITE);
  const home = String(files['designs/index.html']), { css } = cssOf(files);
  drawn[slug] = files;
  ok(`[${slug}] the page draws all eight designs`, Object.values(ROOT_CLASS).every((c) => home.includes(`class="block ${c}`) || home.includes(`class="block wrap ${c}`)));
  ok(`[${slug}] …and its stylesheet carries each design’s rules`, Object.values(RULE).every((r) => css.includes(r)));
  const plain = cssOf(await renderSnapshot(fixture(slug), SITE)).css;
  ok(`[${slug}] a site with none of the designs ships none of their rules`, designSelectors.every((sel) => !plain.includes(sel + '{') && !plain.includes(sel + ',')));
  for (const k of ['overlap', 'tiles', 'qnumbered']) {
    const one = cssOf(await renderSnapshot(page(slug, [DESIGNS[k]]), SITE)).css;
    const others = Object.keys(DESIGNS).filter((x) => x !== k && OWN[x] !== OWN[k]);
    ok(`[${slug}] a site with only "${k}" ships its rules and no other design’s`, one.includes(RULE[k]) && others.every((x) => !one.includes(RULE[x]) && !one.includes(`.${OWN[x]}`)));
  }
  const canvas = cssOf(await renderForBuilder(page(slug, [])));
  ok(`[${slug}] the builder’s canvas keeps every section style, the designs right after BLOCK_CSS, under a name of its own`, canvas.css.includes(`${BLOCK_CSS}\n${DESIGN_CSS}`) && /^assets\/site-[0-9a-f]{16}\.css$/.test(canvas.key) && canvas.key !== cssOf(await renderSnapshot(page(slug, []), SITE)).key);
}
{
  // the numbered features and the numbered questions share a design name, never each other's rules
  const f = sectionStyles(new Set(['block', 'wrap', 'block-features', 'v-numbered', 'fn-list', 'fn-item', 'fn-t', 'fn-num', 'fn-d', 'block-accordion', 'accordion', 'acc-item', 'prose']));
  ok('numbered features beside a plain accordion: no numbered-question rule comes along', f.includes('.block-features.v-numbered .fn-item{') && !f.includes('.qn-'));
  ok('the designs’ rules come after every BLOCK_CSS rule they sit beside', (() => { const all = sectionStyles(new Set([...DESIGN_CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), ...BLOCK_CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1]))); return all.indexOf('.iw-card{') > all.indexOf('.stk-hide-m'); })());
}

// ═══ 7. every word in the designs reads, on every template, on a desktop and a phone ═══
// Each design as it first comes (its own colour theme: the tiles' dark band, the numbered
// questions' tinted one), under the template's own colours and every palette and look the
// editor offers a template that takes them (band_words_test.mjs reads them all on the accent and
// dark bands). A look is read as a site draws it: its colours, its own layer (lib/site_looks.ts,
// which turns a dark look's page dark) and its own button set, then the template's own buttons, as
// "Your template's" in Styles leaves them after a look. Words that show later count too: a closed answer.
{
  const SRC = editorSource();
  const pageArray = (name) => new Function(`return ${SRC.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]};`)();
  const TOKENS = ['accent', 'accent_dark', 'ink', 'soft', 'bg'];
  const CHOICES = [{ name: 'its own colours', tokens: {} }, ...[...pageArray('PALETTES'), ...pageArray('STYLE_LOOKS')].filter((p) => p.tokens && Object.keys(p.tokens).length)]
    .filter((c, i, all) => all.findIndex((d) => TOKENS.every((k) => d.tokens[k] === c.tokens[k])) === i);
  // a style element's :root variables and its other rules (the palette's style layer, a button set's colours)
  const splitStyle = (style) => { const css = style.replace(/^<style[^>]*>|<\/style>$/g, ''); const m = /^:root\{([^{}]*)\}/.exec(css); return { root: Object.fromEntries((m ? m[1] : '').split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])), rules: m ? css.slice(m[0].length) : css }; };
  const rootOf = (tokens) => splitStyle(devLayerFragments({ theme_tokens: tokens, custom_css: '', custom_html: '' }).style).root;
  const VIEWS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
  ok(`the editor offers palettes and looks to read under (${CHOICES.length - 1})`, CHOICES.length > 8);
  for (const slug of TEMPLATES) {
    const files = drawn[slug], fixed = FIXED_COLOR_TEMPLATES.has(slug);
    const doc = parseHtml(String(files['designs/index.html'])), all = [...elementsIn(doc)];
    const head = all.find((e) => e.tag === 'head'), body = all.find((e) => e.tag === 'body');
    const headSheets = sheetsOf(head, files), bodySheets = sheetsOf(body, files);
    const css = cssOf(files).css;
    const sections = all.filter((e) => e.classes.has('block') && [...e.classes].some((c) => /^v-(overlap|frame|numbered|tiles|menu|plans|side)$/.test(c)));
    let worst = { ratio: Infinity, why: '' }, words = 0;
    const unread = new Set();
    for (const choice of fixed ? CHOICES.slice(0, 1) : CHOICES) {
      const root = rootOf(choice.tokens);
      for (const set of [null, ...(choice.tokens.buttons ? [choice.tokens.buttons] : [])]) {
        // the set and the look's layer go at the end of the head, as a site carries them; "Your
        // template's" buttons clear the set with its corners and shadow (presence-edit.js buttonSetRows)
        const { buttons: _b, button_radius: _r, button_shadow: _s, ...own } = choice.tokens;
        const lookCss = splitStyle(lookStyle(set ? choice.tokens : own, { fixed, template: slug })).rules;
        const style = set ? splitStyle(buttonStyle(set, null, siteColours(css, choice.tokens))) : { root: {}, rules: '' };
        const sheets = [...headSheets, ...(style.rules + lookCss ? [style.rules + lookCss] : []), ...bodySheets];
        for (const view of VIEWS) {
          if (view.width < 600 && (choice !== CHOICES[0] || set)) continue;   // a phone: the template's own colours
          const c = cascade(doc, sheets, { ...view, later: true, root: { ...style.root, ...root } });
          c.unread.forEach((u) => unread.add(u));
          for (const sec of sections) for (const el of [sec, ...elementsIn(sec)]) for (const w of c.words(el)) {
            words++;
            if (w.ratio < worst.ratio) worst = { ratio: w.ratio, why: `${[...sec.classes].join('.')} ${el.tag}.${[...el.classes].join('.')} "${w.what.slice(0, 30)}" ${hexOf(w.fg)} on ${hexOf(w.bg)}, ${choice.name}, ${set || 'the template’s'} buttons, ${view.width}px` };
          }
        }
      }
    }
    ok(`[${slug}] all eight designs on the page (${sections.length} sections)`, sections.length === 8);
    ok(`[${slug}] the cascade reads every rule on the page`, unread.size === 0, [...unread].slice(0, 4).join(' | '));
    ok(`[${slug}] every word reads at 4.5:1 or better (worst ${worst.ratio.toFixed(2)}:1, ${words} words)`, worst.ratio >= 4.5 && words > 150, worst.why);
  }
}

// ═══ 8. the pages the browser spec measures (tests/e2e/section-designs-329.spec.ts) ═══
// Three templates (light and sans, serif, dark): every design, plus the photo off the right edge
// and a short price list, inlined into one page as a publish draws it.
{
  const ROOT = new URL('../../', import.meta.url);
  const EXTRA = [{ ...DESIGNS.overlap, title: 'The photo on the other side.', side: 'right' }, { ...DESIGNS.menu, title: 'A short list', tiers: DESIGNS.menu.tiers.slice(0, 3) }];
  for (const slug of ['business-classic', 'editorial', 'slate']) {
    const files = await renderSnapshot(page(slug, [...ALL, ...EXTRA]), SITE);
    const { key } = cssOf(files);
    const html = String(files['designs/index.html']).replace(`<link rel="stylesheet" href="/${key}">`, () => `<style>${files[key]}</style>`).replace(/<script src="\/assets\/site-[0-9a-f]+\.js" defer><\/script>\n?/, '');
    ok(`[${slug}] the browser page carries the designs and their styles, nothing loaded from elsewhere`, html.includes('v-overlap') && html.includes('.block-pricing.v-plans .pp-on{') && !html.includes('/assets/site-'));
    const url = new URL(`tests/e2e/fixtures/section-designs-329/${slug}.html`, ROOT);
    if (Deno.args.includes('--update-fixtures')) { Deno.mkdirSync(new URL('.', url), { recursive: true }); Deno.writeTextFileSync(url, html); }
    let onDisk = ''; try { onDisk = Deno.readTextFileSync(url); } catch { /* missing */ }
    ok(`[${slug}] the browser page is what the renderer draws today (regenerate: --update-fixtures)`, onDisk === html);
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n════ SECTION DESIGNS (ITEM 329): ${results.length - failed}/${results.length} PASSED ════`);
if (failed) Deno.exit(1);
