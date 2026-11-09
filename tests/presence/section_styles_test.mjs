// ── Every site ships only the section styles it uses (list item 106) ─────────────
//   deno run --allow-read --allow-env tests/presence/section_styles_test.mjs
// Every template's stylesheet carried all 34 KB of the section styles (BLOCK_CSS in
// lib/site_blocks.ts): the gallery's photo viewer, the booking widget, tabs, the carousel and
// every look, on sites that used none of them. A publish now keeps the rules its pages can
// use (lib/render.ts trimSectionStyles); the builder's canvas keeps them all, because it
// swaps in a section drawn on its own before the save's full redraw. Also here: the Text
// sections' spacing no longer reaches a template's own posts, and every template draws the
// Features section's grid (Restaurant Classic stacked its items, Nov 8).
import { renderSnapshot, renderForBuilder } from '../../supabase/functions/presence/lib/render.ts';
import { BLOCK_CSS, SECTION_PROSE_TYPES, sectionStyles, pageClasses, renderSiteBlocks } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import { TEMPLATES, fixture, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://example.com/forms/submit', bookEndpoint: 'https://example.com/book' };
const cssOf = (files) => { const k = Object.keys(files).find((x) => /^assets\/site-[0-9a-f]+\.css$/.test(x)); return { key: k, css: String(files[k]) }; };
const pages = (files) => Object.entries(files).filter(([k]) => k.endsWith('.html')).map(([k, v]) => [k, String(v)]);
const classesOf = (files) => { const c = new Set(); for (const [, v] of pages(files)) pageClasses(v, c); return c; };
const GALLERY = { type: 'gallery', title: 'Recent work', image_ids: ['00000000-0000-4000-8000-0000000000a1'] };
const photoRef = () => ({ alt: 'A photo', variants: { w400: '/img/a-400.webp', w800: '/img/a-800.webp' }, width: 800, height: 600 });
const withGallery = (fx, extra = {}) => { const s = structuredClone(fx); const d = composeBlocks([{ ...GALLERY, ...extra }], () => null, photoRef); s.content.settings = { ...s.content.settings, blocks: d.blocks, blocks_src: d.src }; return s; };

// ═══ 1. what a site keeps ═══
for (const slug of TEMPLATES) {
  const own = fixture(slug);
  const shipped = await renderSnapshot(own, SITE), builder = await renderSnapshot(own, SITE, { allSectionStyles: true });
  const s = cssOf(shipped), b = cssOf(builder);
  ok(`[${slug}] a site with no sections ships none of the section styles`, !s.css.includes('.gallery{') && !s.css.includes('.bk-slot{') && !s.css.includes('.lb{') && !s.css.includes('.ff-canvas{') && !s.css.includes('block--bg-tint') && !s.css.includes(':where('));
  ok(`[${slug}] …which is over 30 KB lighter than the whole set`, b.css.length - s.css.length > 30_000, `${b.css.length} → ${s.css.length}`);
  ok(`[${slug}] the builder's drawing keeps the section styles whole`, b.css.includes(BLOCK_CSS) && cssOf(await renderForBuilder(own)).css.includes(BLOCK_CSS));
  // (a redirect stub isn't a page)
  const broken = pages(shipped).filter(([, v]) => !v.includes('http-equiv="refresh"')).filter(([, v]) => { const m = /<link rel="stylesheet" href="\/([^"]+)">/.exec(v); return !m || m[1] !== s.key; }).map(([k]) => k);
  ok(`[${slug}] every page links the stylesheet the site ships`, broken.length === 0, broken.slice(0, 3).join(', '));
  const sameElse = pages(shipped).every(([k, v]) => v.split(`/${s.key}`).join('') === String(builder[k]).split(`/${b.key}`).join(''));
  ok(`[${slug}] the pages are the builder's pages, but for the stylesheet's name`, sameElse && Object.keys(shipped).length === Object.keys(builder).length);

  const full = await renderSnapshot(fullFixture(slug), SITE), fc = cssOf(full);
  ok(`[${slug}] the full sample carries exactly the section styles its pages use`, fc.css.includes(sectionStyles(classesOf(full))) && !fc.css.includes(BLOCK_CSS));
  ok(`[${slug}] …the booking widget's steps too, though its script builds them`, fc.css.includes('.bk-slot{') && fc.css.includes('.bk-services{'));
}
{
  // a site that adds a gallery gets a stylesheet of a new name, so a visitor's year-long copy can't miss its rules
  const own = fixture('harbor');
  const before = cssOf(await renderSnapshot(own, SITE)), after = cssOf(await renderSnapshot(withGallery(own), SITE));
  ok('adding a gallery adds its rules', after.css.includes('.gallery{') && !before.css.includes('.gallery{'));
  ok('…under a new stylesheet name', before.key !== after.key);
  const zoom = cssOf(await renderSnapshot(withGallery(own, { zoom: true }), SITE)).css;
  ok('the photo viewer and its animation come only with a zoom gallery', zoom.includes('.lb:target{display:flex}') && zoom.includes('@keyframes lb-zoom') && !after.css.includes('.lb{') && !after.css.includes('@keyframes'));
  const twice = [await renderSnapshot(withGallery(own), SITE), await renderSnapshot(withGallery(own), SITE)].map((f) => JSON.stringify(Object.entries(f)));
  ok('the same site draws the same bytes twice', twice[0] === twice[1]);
  // Developer Mode markup counts: a class it borrows keeps its rule
  const dev = structuredClone(own); dev.dev_customization = { theme_tokens: {}, custom_css: '', custom_html: '<div class="btn-row"><a class="btn btn-outline" href="/contact/">Call us</a></div>' };
  const dc = cssOf(await renderSnapshot(dev, SITE)).css;
  ok('Developer Mode markup keeps the section rules it borrows', dc.includes('.btn-row{') && dc.includes('.btn-outline{') && !cssOf(await renderSnapshot(own, SITE)).css.includes('.btn-row{'));
  // the builder's preview and the studio's site cards share cache entries, so both keep every rule
  for (const f of ['supabase/functions/presence/routes/preview.ts', 'supabase/functions/presence/agency/sites.ts']) {
    const src = Deno.readTextFileSync(new URL(`../../${f}`, import.meta.url));
    ok(`${f} draws with renderForBuilder`, src.includes('renderForBuilder(snapshot)') && !/renderSnapshot\(/.test(src));
  }
}

// ═══ 2. how the rules are chosen ═══
{
  ok('no classes, no section styles', sectionStyles(new Set()) === '');
  const g = sectionStyles(new Set(['gallery', 'ga']));
  ok('a rule stays when the page carries every class it needs', g.includes('.gallery{display:grid') && g.includes('.gallery .ga img{'));
  ok('…and goes when one is missing', !g.includes('.block-gallery.v-masonry') && !g.includes('.bk-'));
  const al = sectionStyles(new Set(['block', 'ov-align-center', 'prose']));
  ok('a rule keeps only the selectors that can match', al.includes('.block.ov-align-center .prose') && !al.includes('ov-align-right'));
  ok('a :where() list needs one of its classes', !sectionStyles(new Set(['prose'])).includes('.prose') && sectionStyles(new Set(['prose', 'block-tabs'])).includes(':where(') && sectionStyles(new Set(['prose', 'block-spotlight'])).includes(' .prose p{'));
  ok('classes inside :not() are not needed', sectionStyles(new Set(['block', 'block--bg-dark'])).includes('.block.block--bg-dark a:not(.btn){'));
  ok('an @media group stays only with a rule inside it', sectionStyles(new Set(['ba-pair'])).includes('@media(min-width:620px){.ba-pair{') && !sectionStyles(new Set(['gallery'])).includes('@media'));
  // given every class the section styles name, every rule stays, in its place
  const every = new Set([...BLOCK_CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const flat = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '');
  ok('with every class, every rule stays, in the same order', flat(sectionStyles(every)) === flat(BLOCK_CSS));
  const words = pageClasses('<p class="a  b">x</p><script>el(\'div\',\'bk-slot\');var c="bk-err";</script><span class=\'c\'>');
  ok('a page\'s classes: its class attributes and its scripts\' words', ['a', 'b', 'c', 'bk-slot', 'bk-err'].every((c) => words.has(c)) && !words.has('x'));
}

// ═══ 3. the Text sections' spacing stays in the sections ═══
{
  const ctx = { esc, attr, safeHref, formEndpoint: SITE.formEndpoint, bookEndpoint: SITE.bookEndpoint };
  const { blocks, pages: own } = fullFixture('harbor').content.settings;
  const drawn = [...renderSiteBlocks(blocks, ctx), ...renderSiteBlocks(own[0].blocks, ctx)];
  const prose = drawn.filter((b) => /class="prose[ "]/.test(b.html));
  const outside = prose.filter((b) => !SECTION_PROSE_TYPES.some((t) => new RegExp(`^<[a-z]+[^>]*class="[^"]*\\b${t}\\b`).test(b.html))).map((b) => b.type);
  ok('every section that draws .prose is one the spacing rules name (SECTION_PROSE_TYPES)', prose.length >= 5 && outside.length === 0, outside.join(', '));
  // every selector naming .prose names a section's own class before it
  const top = (list) => { const out = []; let d = 0, cur = ''; for (const c of list) { if (c === '(') d++; if (c === ')') d--; if (!d && c === ',') { out.push(cur); cur = ''; } else cur += c; } return [...out, cur]; };
  const heads = [...BLOCK_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((h) => !h.startsWith('@'));
  const loose = heads.flatMap(top).map((x) => x.trim()).filter((x) => /\.prose\b/.test(x) && !/\.(block-[\w-]+|acc-item|ov-align-\w+)\b/.test(x.split('.prose')[0]));
  ok('no section rule names .prose without naming a section around it', loose.length === 0, loose.slice(0, 3).join(' | '));
}

// ═══ 4. the Features section's grid, on every template ═══
for (const slug of TEMPLATES) {
  const { css } = cssOf(await renderSnapshot(fixture(slug), SITE));
  ok(`[${slug}] the template draws the Features grid and its items`, /(^|\n)\.svc-grid\{[^}]*display:grid/.test(css) && /(^|\n)\.svc\{/.test(css));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ SECTION STYLES: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
