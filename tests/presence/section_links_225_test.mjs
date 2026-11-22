// ── Builder list item 225 (Nov 2026): a link name per section, and a shaped bottom edge ──
//   deno run --allow-read --allow-env tests/presence/section_links_225_test.mjs
// A section may carry a link name ("hours") that becomes its id on the page, so a menu item or a
// button can jump straight to it ("/#hours", "/menu/#specials"); and a bottom edge (wave, slant,
// curve, peak, zigzag) that hangs its own colour over the top of the next section. This checks the
// name rule (and that the editor's copy of it agrees), what a save keeps, the ids a page gets, the
// links a section's buttons and the menu may carry now, the edge's styles shipping only where
// used, and the publish list naming a jump that goes nowhere. The editor's rows are driven by
// tests/e2e/section-links-225.spec.ts.
import { anchorOf, isAnchor, jumpTarget, ownPage, siteLink, sectionLinks, ANCHOR_MAX } from '../../supabase/functions/presence/lib/section_links.ts';
import { validateBlocks, resolveBlockMedia, renderSiteBlocks, sectionIdsFor, sectionStyles, pageClasses, SECTION_EDGES, EDGE_PATHS, BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref, renderMarkdown } from '../../supabase/functions/presence/lib/markdown.ts';
import { menuForCopy } from '../../supabase/functions/presence/lib/site_layout.ts';
import { deadJumps, validateSnapshot } from '../../supabase/functions/presence/lib/manifest_validate.ts';
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const ctx = { esc, attr, safeHref };
const draw = (list) => renderSiteBlocks(resolveBlockMedia(validateBlocks(list), () => null), ctx).map((r) => r.html).join('\n');
const PAGE = editorSource();
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ── the name rule ──
ok('a typed name is made tidy', anchorOf('Opening Hours') === 'opening-hours' && anchorOf('#Hours') === 'hours' && anchorOf('  Café menu! ') === 'cafe-menu' && anchorOf('a__b') === 'a-b');
ok('nothing usable is no name', anchorOf('') === null && anchorOf('---') === null && anchorOf('#') === null && anchorOf(null) === null && anchorOf('😀') === null);
ok(`at most ${ANCHOR_MAX} long, never ending in a dash`, anchorOf('x'.repeat(39) + '-yz') === 'x'.repeat(39) && anchorOf('y'.repeat(60)).length === ANCHOR_MAX);
ok('names the page uses for its own parts are refused', ['main', 'top', 'open-now', 'f-name', 'form-quote', 'lb-0', 'nl-1', 'dds-hdr', 'presence-dev', 'ps-pop', 'search-q', 'tab-1'].every((n) => anchorOf(n) === null));
ok('a stored name is kept only when tidy', isAnchor('hours') && isAnchor('our-menu-2') && !isAnchor('Hours') && !isAnchor('hours-') && !isAnchor('main') && !isAnchor(''));
// the editor's copy of the rule says the same about every probe
{
  const fn = PAGE.match(/\nfunction anchorTidy\(raw\) \{[\s\S]*?\n\}/)[0];
  const reserved = PAGE.match(/\nconst ANCHOR_RESERVED = (\[[^\]]*\]);/)[1];
  const anchorTidy = new Function(`const ANCHOR_RESERVED = ${reserved};${fn}; return anchorTidy;`)();
  const probes = ['Opening Hours', '#hours', 'Café menu', 'main', 'f-name', 'form-x', '---', '', 'x'.repeat(50), 'Specials (today)', 'tabs-2', 'consent-x', 'consentx', 'Ünïcødé'];
  const drift = probes.filter((p) => anchorTidy(p) !== anchorOf(p));
  ok('the editor tidies a name exactly as the server does', drift.length === 0, drift.join(' | '));
}

// ── where a jump link goes ──
ok('#hours: on the page it is on', JSON.stringify(jumpTarget('#hours')) === JSON.stringify({ page: null, anchor: 'hours' }));
ok('/#hours: on Home', JSON.stringify(jumpTarget('/#hours')) === JSON.stringify({ page: '', anchor: 'hours' }));
ok('/menu/#specials: on another page', JSON.stringify(jumpTarget('/menu/#specials')) === JSON.stringify({ page: 'menu', anchor: 'specials' }));
ok('anything else is not a jump', ['#Hours', '#form-quote', '#main', '/a/b/#x', '//evil.example/#x', 'https://x.example/#y', '/menu#x', 'menu/#x', '#'].every((h) => jumpTarget(h) === null));
ok('the site’s own pages', ownPage('/') && ownPage('/menu/') && !ownPage('/menu') && !ownPage('//x/') && !ownPage('/a/b/'));
ok('a section’s button may go to a page or a named part of one', siteLink('/menu/') === '/menu/' && siteLink('/#hours') === '/#hours' && siteLink('#hours') === '#hours' && siteLink('/menu') === null && siteLink('javascript:x') === null);
ok('every link in a section is found, at any depth', JSON.stringify(sectionLinks({ type: 'stack', items: [{ kind: 'button', buttons: [{ label: 'a', url: '/#a' }] }, { kind: 'image', link: '/b/' }] })) === JSON.stringify(['/#a', '/b/']));

// ── what a save keeps ──
{
  const [a, b, c] = validateBlocks([
    { type: 'richtext', title: 'Opening hours', body: 'Seven to three.', anchor: 'hours' },
    { type: 'richtext', title: 'Menu', body: 'Bread.', anchor: 'Our Menu!' },
    { type: 'richtext', title: 'Visit', body: 'Come by.', anchor: 'main' },
  ]);
  ok('a tidy name is kept', a.anchor === 'hours');
  ok('a messy one is made tidy', b.anchor === 'our-menu');
  ok('a name the page uses is dropped', !('anchor' in c));
  const [d] = validateBlocks([{ type: 'richtext', title: 'x', body: 'y', anchor: 42 }]);
  ok('only words are a name', !('anchor' in d));
}
{
  const edges = validateBlocks(SECTION_EDGES.map((e) => ({ type: 'richtext', title: e, body: 'x', look: { edge: e } })));
  ok('the five edges are kept', edges.every((b, i) => b.look && b.look.edge === SECTION_EDGES[i]) && SECTION_EDGES.join() === 'wave,slant,curve,peak,zigzag');
  const [bad] = validateBlocks([{ type: 'richtext', title: 'x', body: 'y', look: { edge: 'zig;zag' } }]);
  ok('anything else is not', !bad.look);
}
// the name and the edge ride a photo section's rebuild, both ways
{
  const ID = '00000000-0000-4000-8000-0000000000a1';
  const stored = validateBlocks([{ type: 'image', image_id: ID, anchor: 'photos', look: { edge: 'wave' } }]);
  const resolved = resolveBlockMedia(stored, (id) => (id === ID ? { alt: 'x', variants: { w400: '/img/a1-400.webp' }, width: 10, height: 10 } : null));
  ok('a photo section keeps its link name and edge when its photo is resolved', resolved[0].anchor === 'photos' && resolved[0].look.edge === 'wave');
}

// ── the id each section gets ──
{
  const html = draw([
    { type: 'richtext', title: 'Hours', body: 'a' },
    { type: 'richtext', title: 'Opening hours', body: 'b', anchor: 'hours' },
    { type: 'richtext', title: 'Hours', body: 'c' },
  ]);
  ok('a section’s own name is its id', html.includes('<section id="hours" '));
  ok('a heading’s id steps aside for it', /<section id="hours-2" /.test(html) && /<section id="hours-3" /.test(html) && (html.match(/id="hours"/g) || []).length === 1);
  const twice = draw([{ type: 'richtext', title: 'A', body: 'a', anchor: 'same' }, { type: 'richtext', title: 'B', body: 'b', anchor: 'same' }]);
  ok('a second section with the same name keeps its heading’s id', twice.includes('id="same"') && twice.includes('id="b"') && (twice.match(/id="same"/g) || []).length === 1);
  const plain = draw([{ type: 'richtext', title: 'Our story', body: 'a' }, { type: 'richtext', title: 'Our story', body: 'b' }]);
  ok('a page with no names gets the ids it always had', plain.includes('id="our-story"') && plain.includes('id="our-story-2"'));
  ok('the publish check works out the same ids before anything is drawn', JSON.stringify(sectionIdsFor(validateBlocks([{ type: 'richtext', title: 'Hours', body: 'a' }, { type: 'richtext', title: 'Opening hours', body: 'b', anchor: 'hours' }]))) === JSON.stringify(['hours-2', 'hours']));
  const toc = draw([{ type: 'toc' }, { type: 'richtext', title: 'Opening hours', body: 'b', anchor: 'hours' }]);
  ok('a contents list links to the section’s own name', toc.includes('<a href="#hours">Opening hours</a>'));
}

// ── where a section's buttons may go now ──
{
  const html = draw([
    { type: 'cta', text: 'See when we’re open', button: 'Our hours', url: '/#hours' },
    { type: 'cta', text: 'Hungry?', button: 'The menu', url: '/menu/' },
    { type: 'cta', text: 'Same page', button: 'Jump', url: '#hours' },
    { type: 'cta', text: 'Never', button: 'Bad', url: 'javascript:alert(1)' },
  ]);
  ok('a button jumps to a named part of a page', html.includes('href="/#hours"') && html.includes('href="#hours"'));
  ok('a button opens one of the site’s own pages', html.includes('href="/menu/"'));
  ok('anything unsafe still draws no button', !html.includes('javascript:') && !html.includes('>Bad<'));
  ok('emails and written text keep the stricter rule', safeHref('/menu/') === null && safeHref('#hours') === null && !renderMarkdown('[menu](/menu/)').includes('href'));
}

// ── the menu ──
{
  const ser = read('supabase/functions/presence/lib/serializer.ts');
  ok('a menu item may jump to a named part of a page (from any page, so always from the site’s root)', /if \(v\.startsWith\('\/'\) && jumpTarget\(v\)\) return v;/.test(ser));
  const copied = menuForCopy([{ label: 'Hours', href: '/#hours' }, { label: 'Specials', href: '/menu/#specials' }, { label: 'Elsewhere', href: 'https://x.example/' }]);
  ok('a copied site keeps menu jumps to its own pages', copied.length === 2 && copied[1].href === '/menu/#specials');
}

// ── the edge's styles: in the stylesheet, shipped only where used ──
{
  ok('each edge is a mask in the section’s own colour', SECTION_EDGES.every((e) => BLOCK_CSS.includes(`.block--edge-${e}{--edge-m:url("data:image/svg+xml,`)) && BLOCK_CSS.includes('background:inherit;pointer-events:none;-webkit-mask:var(--edge-m)'));
  ok('the next section makes room with a clear top border, so nothing of it is covered', BLOCK_CSS.includes('.block.block--edge+*{border-top:var(--edge-h) solid transparent}'));
  ok('shorter on phones', BLOCK_CSS.includes('--edge-h:clamp(20px,4vw,48px)'));
  ok('the editor draws the same five shapes', (() => { const src = PAGE.match(/\nconst EDGE_PATHS = (\{[\s\S]*?\});\n/)[1]; const js = new Function(`return ${src};`)(); return SECTION_EDGES.every((e) => js[e] === EDGE_PATHS[e]); })());
  const none = sectionStyles(pageClasses('<section class="block wrap block-richtext">x</section>'));
  const wave = sectionStyles(pageClasses('<section class="block wrap block-richtext block--edge block--edge-wave">x</section>'));
  ok('a page without an edge ships none of its styles', !none.includes('block--edge'));
  ok('a page with a wave ships the wave and nothing of the other four', wave.includes('.block--edge-wave{') && !wave.includes('.block--edge-peak{') && wave.includes('.block.block--edge::after'));
  const drawn = draw([{ type: 'richtext', title: 'Hours', body: 'x', look: { edge: 'peak', background: 'dark' } }]);
  ok('a section with an edge carries both classes', /class="block [^"]*block--edge block--edge-peak/.test(drawn));
}

// ── a published page ──
{
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  const settings = fx.content.settings || {};
  const withEdge = { ...fx, content: { ...fx.content, settings: { ...settings, blocks: [{ type: 'richtext', title: 'Opening hours', body: 'Seven to three.', anchor: 'hours', look: { edge: 'wave', background: 'dark' } }, { type: 'richtext', title: 'Visit', body: 'Come by.' }] } } };
  const files = await renderSnapshot(withEdge, { baseUrl: 'https://example.com' });
  const css = String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);
  ok('the published page has the section’s own id and its edge', String(files['index.html']).includes('id="hours"') && /block--edge-wave/.test(String(files['index.html'])) && css.includes('.block--edge-wave{'));
  const plainFiles = await renderSnapshot(fx, { baseUrl: 'https://example.com' });
  const plainCss = String(plainFiles[Object.keys(plainFiles).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);
  ok('a site without edges ships none of their styles', !plainCss.includes('block--edge'));
}

// ── the publish list names a jump that goes nowhere ──
{
  const content = (nav, home, pages = []) => ({ settings: { nav, blocks: home, pages } });
  const home = [{ type: 'richtext', title: 'Opening hours', body: 'x', anchor: 'hours' }];
  const menuPage = { slug: 'menu', title: 'Menu', blocks: [{ type: 'richtext', title: 'Specials', body: 'x', anchor: 'specials' }, { type: 'cta', text: 'x', button: 'Hours', url: '/#hours' }, { type: 'cta', text: 'x', button: 'Up', url: '#specials' }] };
  ok('nothing to say when every jump lands', deadJumps(content([{ label: 'Hours', href: '/#hours' }, { label: 'Specials', href: '/menu/#specials' }], home, [menuPage])).length === 0);
  const gone = deadJumps(content([{ label: 'Hours', href: '/#hours' }], [{ type: 'richtext', title: 'Opening hours', body: 'x' }], [menuPage]));
  ok('a menu item whose section lost its name is named', gone.some((m) => m === 'The menu item “Hours” jumps to #hours on Home, and no section there has that link name.'), gone.join(' | '));
  ok('so is a button on another page pointing at it', gone.some((m) => /^A button in a section on the Menu page jumps to #hours on Home/.test(m)));
  const page = deadJumps(content([{ label: 'Old', href: '/events/#spring' }], home, []));
  ok('a jump to a page that is gone is named', page[0] === 'The menu item “Old” jumps to #spring on a page that isn’t on the site any more.');
  ok('a jump made from a heading’s own id still counts as landing', deadJumps(content([{ label: 'Story', href: '/#our-story' }], [{ type: 'richtext', title: 'Our story', body: 'x' }])).length === 0);
  const manifest = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/manifest.json'));
  const v = validateSnapshot({ content_contract_version: manifest.content_contract_version, content: content([{ label: 'Hours', href: '/#nope' }], home) }, manifest);
  ok('publish lists it as a warning, never a blocker', v.warnings.some((w) => w.field === 'links' && w.message.includes('#nope')) && !v.blockers.some((b) => b.field === 'links'));
}

// ── the published pages the browser test opens (tests/e2e/section-links-225.spec.ts) ──
// A home page with a button and a menu item that jump to a dark "Opening hours" section with a
// wave edge, drawn by three templates with the stylesheet inlined. Rewrite them with
// --update-fixtures after any change to how link names or edges draw; this checks they are
// what the renderer draws today.
{
  const { composeBlocks } = await import('../../supabase/functions/presence/lib/serializer.ts');
  const { fixture } = await import('./full_fixture.mjs');
  const ROOT = new URL('../../', import.meta.url);
  const BLOCKS = [
    { type: 'cta', text: 'Open from seven every morning.', button: 'See our hours', url: '#hours' },
    { type: 'richtext', title: 'Fresh bread, every morning', body: 'Sourdough, pastries and coffee, made here from six in the morning.' },
    { type: 'richtext', title: 'Opening hours', body: 'Monday to Friday, seven to three.\n\nSaturday and Sunday, eight to two.', anchor: 'hours', look: { background: 'dark', edge: 'wave' } },
    { type: 'richtext', title: 'Reserve a table', body: 'Groups of six or more, tell us a day ahead.' },
    ...['Catering', 'Gift cards', 'Our bakers', 'Visit us'].map((t) => ({ type: 'richtext', title: t, body: 'A few words so the page runs well past the screen. '.repeat(6) })),
  ];
  for (const slug of ['business-classic', 'aurora', 'slate']) {
    const fx = fixture(slug);
    const home = composeBlocks(structuredClone(BLOCKS), () => null, () => null, {});
    fx.content.settings = { ...fx.content.settings, blocks: home.blocks, blocks_src: home.src, nav: [{ label: 'Home', href: '/' }, { label: 'Hours', href: '/#hours' }], sections: { hidden: ['hero', 'about', 'offerings', 'testimonials', 'faqs'], order: [] } };
    const files = await renderSnapshot(fx, { baseUrl: 'https://shop.example' });
    const cssPath = Object.keys(files).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k));
    const html = String(files['index.html']).replace(`<link rel="stylesheet" href="/${cssPath}">`, () => `<style>${files[cssPath]}</style>`).replace(/<script src="\/assets\/site-[0-9a-f]+\.js" defer><\/script>\n?/, '');   // the site's script file stays out of the fixture (items 288 and 298)
    ok(`[${slug}] the browser page has the named section, its wave, the jump links and its stylesheet`, html.includes('<section id="hours" ') && html.includes('block--edge-wave') && html.includes('href="#hours"') && html.includes('href="/#hours"') && html.includes('.block--edge-wave{') && !html.includes('/assets/site-'));
    const url = new URL(`tests/e2e/fixtures/section-links-225/${slug}.html`, ROOT);
    if (Deno.args.includes('--update-fixtures')) { Deno.mkdirSync(new URL('.', url), { recursive: true }); Deno.writeTextFileSync(url, html); }
    let onDisk = ''; try { onDisk = Deno.readTextFileSync(url); } catch { /* missing */ }
    ok(`[${slug}] browser fixture is what the renderer draws today (regenerate: --update-fixtures)`, onDisk === html);
  }
}

const failed = results.filter((r) => !r).length;
console.log(`${failed ? 'FAIL' : 'PASS'}  link names and bottom edges (item 225) — ${results.length} assertions, ${failed} failures`);
if (failed) Deno.exit(1);
