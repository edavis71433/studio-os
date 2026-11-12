// ── Builder list item 57: blocks inside a section (the Blocks section) ───────────────
//   deno run --allow-read --allow-env tests/presence/blocks_57_test.mjs
// A Blocks section holds small blocks stacked top to bottom: heading, text, image, button,
// video, form, spacer, divider and map, with no free placement. This proves the server half:
// what a save may hold (kinds, caps, links, enumerations, forms), that every block keeps its
// place while it's empty (the editor's item numbers never shift), how a published page draws
// it (in reading order, escaped, no scripts or frames from anyone else), its photos through
// the one media pipeline and back, the form finder the form sender and the pop-ups share, and
// the publish list naming the blocks that changed.
import { validateBlocks, validateBlocksWithMap, resolveBlockMedia, unresolveBlockMedia, renderSiteBlocks, REALIZED_BLOCK_TYPES, BLOCK_CSS, SECTION_PROSE_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { COMPONENTS } from '../../supabase/functions/presence/lib/site_components.ts';
import { formsIn, FORM_PRESETS } from '../../supabase/functions/presence/lib/forms.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { describeChanges } from '../../supabase/functions/presence/lib/diff.ts';
import { SECTION_NAME } from '../../supabase/functions/presence/lib/section_comments.ts';
import { settingsMediaUses } from '../../supabase/functions/presence/lib/dam.ts';
import { injectPopup } from '../../supabase/functions/presence/lib/popup.ts';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ctx = { esc, attr, safeHref, formEndpoint: 'https://fn.test/forms/s1' };
const PHOTO = '00000000-0000-4000-8000-0000000000b1', POSTER = '00000000-0000-4000-8000-0000000000b2', PLACE = '00000000-0000-4000-8000-0000000000b3';
const ref = (id) => (id === PHOTO || id === POSTER || id === PLACE)
  ? { alt: 'From the library', variants: { w400: `/img/${id.slice(-2)}-400.webp`, w800: `/img/${id.slice(-2)}-800.webp` }, width: 1600, height: 1067 }
  : null;
const idOf = (m) => (m && m.variants && m.variants.w400 ? ({ b1: PHOTO, b2: POSTER, b3: PLACE })[m.variants.w400.slice(5, 7)] || null : null);
const STORY = { type: 'stack', items: [
  { kind: 'heading', text: 'Our story' },
  { kind: 'text', body: 'Started as a **Saturday stall**.\n\n- sourdough\n- rye' },
  { kind: 'image', image_id: PHOTO, alt: 'Loaves cooling', caption: 'Fresh this morning', link: '/menu/' },
  { kind: 'button', buttons: [{ label: 'See the menu', url: '/menu/' }, { label: 'Call us', url: 'tel:+15550100143', style: 'outline' }] },
] };
const draw = (list) => renderSiteBlocks(resolveBlockMedia(validateBlocks(list), ref), ctx).map((r) => r.html).join('');

// ═══ 1 · what a save may hold ═══
{
  const v = validateBlocks([STORY])[0];
  ok('a Blocks section keeps its blocks, in order', v.type === 'stack' && v.items.map((it) => it.kind).join() === 'heading,text,image,button');
  const odd = validateBlocks([{ type: 'stack', items: [{ kind: 'iframe', html: '<x>' }, null, 'words', { kind: 'heading', text: 'Kept' }] }])[0];
  ok('a kind that doesn’t exist, and anything not a block, is left out', odd.items.length === 1 && odd.items[0].text === 'Kept');
  ok('no blocks at all, no section', validateBlocks([{ type: 'stack', items: [] }, { type: 'stack' }, { type: 'stack', items: [{ kind: 'nope' }] }]).length === 0);
  ok('up to 20 blocks in one section', validateBlocks([{ type: 'stack', items: Array.from({ length: 30 }, (_, i) => ({ kind: 'heading', text: `H${i}` })) }])[0].items.length === 20);
  const empty = validateBlocks([{ type: 'stack', items: [{ kind: 'heading', text: '   ' }, { kind: 'image' }, { kind: 'button', buttons: [{ label: '', url: '' }] }, { kind: 'text', body: 'Still here' }] }])[0];
  ok('an empty block keeps its place (a heading being typed, a photo not picked, a half-made button)', empty.items.length === 4 && empty.items[0].text === '' && !empty.items[1].image_id && empty.items[2].buttons.length === 1 && empty.items[3].body === 'Still here');
  const caps = validateBlocks([{ type: 'stack', items: [
    { kind: 'heading', text: 'h'.repeat(400) }, { kind: 'text', body: 't'.repeat(9000) },
    { kind: 'button', buttons: Array.from({ length: 6 }, (_, i) => ({ label: `b${i}`, url: '/x/' })) },
    { kind: 'image', image_id: PHOTO, caption: 'c'.repeat(500), alt: 'a'.repeat(500) },
  ] }])[0];
  ok('each block keeps the caps of the section it is a small version of', caps.items[0].text.length === 160 && caps.items[1].body.length === 4000 && caps.items[2].buttons.length === 3 && caps.items[3].caption.length === 200 && caps.items[3].alt.length === 200);
  const links = validateBlocks([{ type: 'stack', items: [
    { kind: 'video', url: 'javascript:alert(1)' }, { kind: 'video', url: 'https://www.youtube.com/watch?v=x' },
    { kind: 'map', address: '1 Main St', directions_url: 'javascript:alert(1)' },
  ] }])[0];
  ok('a video or directions link must be a web address; anything else is dropped', links.items[0].url === '' && links.items[1].url.startsWith('https://') && links.items[2].directions_url === undefined && links.items[2].address === '1 Main St');
  const en = validateBlocks([{ type: 'stack', column: 'huge', gap: 'roomy', items: [
    { kind: 'heading', text: 'A', size: 'xl', align: 'middle', hide_on_phone: 'yes' },
    { kind: 'heading', text: 'B', size: 'm', align: 'center', hide_on_phone: true },
    { kind: 'image', image_id: PHOTO, width: 'tiny', decorative: 'true' }, { kind: 'image', image_id: PHOTO, width: 's', decorative: true },
    { kind: 'spacer', size: 'xl' }, { kind: 'divider', width: 's' }, { kind: 'text', body: 'x', size: 's' },
  ] }])[0];
  ok('choices are from a fixed list; anything else stores nothing (the default)',
    en.column === undefined && en.gap === 'roomy'
    && !('size' in en.items[0]) && !('align' in en.items[0]) && !('hide_on_phone' in en.items[0])
    && en.items[1].size === 'm' && en.items[1].align === 'center' && en.items[1].hide_on_phone === true
    && !('width' in en.items[2]) && !('decorative' in en.items[2]) && en.items[3].width === 's' && en.items[3].decorative === true
    && !('size' in en.items[4]) && en.items[5].width === 's' && !('size' in en.items[6]));
  const looks = validateBlocks([{ ...STORY, look: { background: 'dark', align: 'center' }, show_until: '2030-01-01T00:00:00Z' }])[0];
  ok('the usual section looks and dates ride along', looks.look.background === 'dark' && looks.look.align === 'center' && !!looks.show_until);
  const cell = validateBlocks([{ type: 'columns', columns: [{ body: 'x', block: STORY }, { body: 'y' }] }])[0];
  ok('a Blocks section never goes inside a Columns cell (a cell is a small stack already)', !cell.columns[0].block);
  ok('a Blocks section is drawn by the engine and listed in the catalog, with the same kinds', (() => {
    const c = COMPONENTS.find((x) => x.key === 'stack');
    const kinds = c && c.fields.find((f) => f.key === 'kind');
    return REALIZED_BLOCK_TYPES.includes('stack') && !!c && c.label === 'Blocks' && kinds && kinds.options.join() === 'heading,text,image,button,video,form,spacer,divider,map';
  })());
}

// ═══ 2 · forms inside a Blocks section ═══
{
  const contact = FORM_PRESETS[0].def;
  const page = validateBlocks([
    { ...contact },
    { type: 'stack', items: [{ kind: 'heading', text: 'Ask us' }, { kind: 'form', form: { ...contact } }, { kind: 'form', form: { ...contact, id: 'quote' } }, { kind: 'form', form: { ...contact, id: 'third' } }, { kind: 'form', form: { id: 'broken', fields: [] } }] },
  ]);
  const st = page[1];
  ok('a form block goes through the Form section’s gate', st.items[1].form && st.items[1].form.type === 'form' && Array.isArray(st.items[1].form.fields) && st.items[1].form.fields.length > 0);
  ok('its id stays unique on the page, shared with the page’s Form sections', page[0].id === contact.id && st.items[1].form.id !== contact.id && st.items[2].form.id === 'quote');
  ok('a third form, and a form that fails the gate, keep their place empty', st.items.length === 5 && !st.items[3].form && !st.items[4].form);
  const found = formsIn(page);
  ok('one finder sees every form on a page: Form sections and Form blocks, in page order', found.map((f) => f.id).join() === [contact.id, st.items[1].form.id, 'quote'].join());
  ok('the finder reads raw lists too, and ignores what isn’t a form', formsIn([{ type: 'stack', items: [{ kind: 'form', form: { id: 'x' } }, { kind: 'form' }, null] }, { type: 'form', id: 'y', fields: [] }, null, 'x']).map((f) => f.id).join() === 'y');
  const html = draw([{ type: 'stack', items: [{ kind: 'form', form: { ...contact, id: 'ask' } }] }]);
  ok('a form block draws the same form, posting to the site’s form address', html.includes('id="presence-form-ask"') && html.includes('name="form_id" value="ask"') && html.includes('https://fn.test/forms/s1'));
  const files = { 'index.html': '<html><body><a href="#form-ask">Ask</a></body></html>' };
  const out = injectPopup(files, { settings: { blocks: [], pages: [{ slug: 'help', blocks: [{ type: 'stack', items: [{ kind: 'form', form: { ...contact, id: 'ask' } }] }] }] } }, { formEndpoint: 'https://fn.test/forms/s1' });
  ok('a "#form-<id>" button opens a form that lives inside a Blocks section on another page', String(out['index.html']).includes('id="form-ask"'));
}

// ═══ 3 · how a published page draws it ═══
{
  const html = draw([STORY]);
  ok('one section, its blocks in one column, in order', /^<section id="our-story" data-dds-sid="stack" data-dds-key="block_stack" class="block wrap block-stack"><div class="stk"><h2 /.test(html) && html.indexOf('<h2') < html.indexOf('prose') && html.indexOf('prose') < html.indexOf('<figure') && html.indexOf('<figure') < html.indexOf('stk-btns'));
  ok('each block says its place (data-dds-item) and carries the field stamps typing on the page uses',
    html.includes('data-dds-item="0" data-dds-field="items.0.text"') && html.includes('data-dds-item="1" data-dds-field="items.1.body" data-dds-md="1"')
    && html.includes('data-dds-field="items.2.caption"') && html.includes('data-dds-field="items.3.buttons.0.label"') && html.includes('data-dds-field="items.3.buttons.1.label"'));
  ok('words are written in markdown and drawn safely', html.includes('<strong>Saturday stall</strong>') && html.includes('<li>sourdough</li>'));
  ok('a photo keeps its own description, its caption and its link', html.includes('alt="Loaves cooling"') && html.includes('<figcaption data-dds-field="items.2.caption">Fresh this morning</figcaption>') && html.includes('<a class="img-link" href="/menu/"'));
  ok('buttons are real links, the outline look on the second', html.includes('<a class="btn" href="/menu/"') && html.includes('<a class="btn btn-outline" href="tel:+15550100143"'));
  const gap = draw([{ type: 'stack', items: [{ kind: 'heading', text: '' }, { kind: 'image', image_id: '00000000-0000-4000-8000-00000000dead' }, { kind: 'text', body: 'After the gaps' }] }]);
  ok('an empty block draws nothing, and the next keeps its own number', !gap.includes('data-dds-item="0"') && !gap.includes('data-dds-item="1"') && gap.includes('data-dds-item="2"'));
  ok('a section of empty blocks draws nothing at all', draw([{ type: 'stack', items: [{ kind: 'heading', text: '' }, { kind: 'image' }] }]) === '');
  const sizes = draw([{ type: 'stack', items: [{ kind: 'heading', text: 'Big' }, { kind: 'heading', text: 'Mid', size: 'm' }, { kind: 'heading', text: 'Small', size: 's' }, { kind: 'text', body: 'Lead', size: 'l' }] }]);
  ok('heading sizes are real heading levels: Big h2, Medium h3, Small h4; never the page’s one h1', sizes.includes('<h2 class="stk-b stk-h"') && sizes.includes('<h3 class="stk-b stk-h"') && sizes.includes('<h4 class="stk-b stk-h"') && !sizes.includes('<h1') && sizes.includes('stk-text stk-lg'));
  const looks = draw([{ type: 'stack', column: 'narrow', gap: 'tight', items: [{ kind: 'heading', text: 'C', align: 'center' }, { kind: 'image', image_id: PHOTO, width: 'm', align: 'right', hide_on_phone: true }, { kind: 'spacer', size: 'l' }, { kind: 'divider', width: 's' }, { kind: 'spacer' }] }]);
  ok('line-up, width, space and hiding on phones are classes from a fixed list',
    looks.includes('block-stack stk-narrow stk-gap-tight') && looks.includes('class="stk-b stk-h stk-ac"') && looks.includes('class="stk-b stk-img stk-wm stk-ar stk-hide-m"')
    && looks.includes('class="stk-b stk-space stk-space-l"') && looks.includes('class="stk-b stk-hr stk-short"') && looks.includes('class="stk-b stk-space stk-space-m"'));
  ok('a spacer is silent to screen readers', /<div class="stk-b stk-space stk-space-l" data-dds-item="2" aria-hidden="true"><\/div>/.test(looks));
  const media = draw([{ type: 'stack', items: [
    { kind: 'video', url: 'https://www.youtube.com/watch?v=x', poster_id: POSTER, caption: 'A morning at the bakery' },
    { kind: 'video', url: 'https://vimeo.com/1' },
    { kind: 'map', address: '12 Olive Ave, Burbank', image_id: PLACE },
    { kind: 'image', image_id: PHOTO, decorative: true },
  ] }]);
  ok('a video is its picture and a link out: no player from another company', media.includes('<a class="v-link" href="https://www.youtube.com/watch?v=x"') && media.includes('class="v-poster"') && media.includes('aria-label="Watch: A morning at the bakery"') && media.includes('▶ Watch the video') && !/<iframe|<script/i.test(media));
  ok('a map is the owner’s picture, the address and a directions link out', media.includes('class="map-img"') && media.includes('data-dds-field="items.2.address">12 Olive Ave, Burbank') && media.includes('https://www.google.com/maps/search/?api=1&amp;query=12%20Olive%20Ave%2C%20Burbank'));
  ok('a decorative photo is silent to screen readers', media.includes('alt="" role="presentation"'));
  const bad = draw([{ type: 'stack', items: [
    { kind: 'heading', text: '<script>alert(1)</script>' }, { kind: 'text', body: '<img src=x onerror=alert(1)>' },
    { kind: 'button', buttons: [{ label: 'Go', url: 'javascript:alert(1)' }, { label: '"><b>', url: '/ok/' }] },
    { kind: 'image', image_id: PHOTO, link: 'javascript:alert(1)', caption: '<i>c</i>' },
  ] }]);
  ok('a block may link to a page of the site itself, never to “//” another site', draw([{ type: 'stack', items: [{ kind: 'button', buttons: [{ label: 'Hours', url: '/contact/#hours' }, { label: 'Away', url: '//evil.example/x' }] }] }]).includes('href="/contact/#hours"') && !draw([{ type: 'stack', items: [{ kind: 'button', buttons: [{ label: 'Away', url: '//evil.example/x' }] }] }]).includes('evil'));
  ok('hostile words stay words, and unsafe links never draw', !bad.includes('<script>') && !bad.includes('<img src=x') && !bad.includes('javascript:') && bad.includes('&lt;script&gt;') && bad.includes('&quot;&gt;&lt;b&gt;') && !bad.includes('class="img-link"'));
  const toc = renderSiteBlocks(validateBlocks([{ type: 'toc' }, STORY, { type: 'stack', items: [{ kind: 'text', body: 'No heading here' }] }]).map((b) => resolveBlockMedia([b], ref)[0]), ctx).map((r) => r.html).join('');
  ok('its first heading names the section: its anchor and its place in On this page', toc.includes('<a href="#our-story">Our story</a>') && toc.includes('id="stack"'));
  ok('the same blocks always draw the same bytes', draw([STORY]) === draw([STORY]));
  const look = draw([{ ...STORY, look: { background: 'dark' } }]);
  ok('the section’s colour theme lands on its root like any section', look.startsWith('<section id="our-story" data-dds-sid="stack" data-dds-key="block_stack" class="block block--bg-dark wrap block-stack">'));
  const map = validateBlocksWithMap([{ type: 'richtext', body: '' }, STORY]);
  ok('the editor’s join still points at the stored section', map.map[0].sid === 'stack' && map.map[0].src_index === 1);
}

// ═══ 4 · photos through the one pipeline, and back ═══
{
  const stored = validateBlocks([{ type: 'stack', column: 'wide', items: [
    { kind: 'image', image_id: PHOTO, alt: 'Loaves cooling', caption: 'Fresh' },
    { kind: 'video', url: 'https://vimeo.com/1', poster_id: POSTER },
    { kind: 'map', address: '12 Olive Ave', image_id: PLACE },
    { kind: 'image', image_id: '00000000-0000-4000-8000-00000000dead' },
    { kind: 'heading', text: 'Kept' },
  ], look: { spacing: 'roomy' } }]);
  const resolved = resolveBlockMedia(stored, ref);
  const it = resolved[0].items;
  ok('each photo resolves through the same ref(), its own description folded in', it[0].image.alt === 'Loaves cooling' && it[1].poster.variants.w400 && it[2].image && it[0].image_id === undefined);
  ok('a photo that can’t be found leaves its block empty, in its place', it.length === 5 && it[3].image === null && it[4].text === 'Kept');
  const back = unresolveBlockMedia(resolved, idOf);
  const want = JSON.parse(JSON.stringify(stored[0]));
  delete want.items[3].image_id;   // the photo that's gone stays gone
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  ok('a restore brings the stored shape back: ids, words, choices and looks', canon(back[0]) === canon(want), canon(back[0]));
  ok('a restored Blocks section validates to itself', canon(validateBlocks(back)[0]) === canon(want));
  ok('where a photo is used names the Blocks section by its first heading', (() => {
    const uses = settingsMediaUses({ blocks: [{ type: 'stack', items: [{ kind: 'heading', text: 'Our story' }, { kind: 'image', image_id: PHOTO }] }] });
    const r = uses.get(PHOTO);
    return !!r && r[0].label === 'the Blocks section “Our story” on your Home page';
  })());
  ok('a note on a Blocks section names it plainly', SECTION_NAME.stack === 'Blocks');
}

// ═══ 5 · the publish list names the blocks that changed ═══
{
  const content = (blocks) => ({ identity: { business_name: 'Marlow’s Kitchen' }, locations: [], offerings: [], faqs: [], testimonials: [], posts: [], redirects: [], settings: { blocks } });
  const said = (a, b) => describeChanges(content(b), content(a)).changes.map((c) => c.sentence);
  const plus = { ...STORY, items: [...STORY.items, { kind: 'button', buttons: [{ label: 'Book', url: '/book/' }] }] };
  ok('a block added', said([STORY], [plus]).includes('“Our story” on your home page: a button added.'));
  ok('blocks removed, counted by kind', said([plus], [{ ...STORY, items: [STORY.items[0]] }]).includes('“Our story” on your home page: a text block removed, a photo removed, 2 buttons removed.'));
  ok('blocks moved', said([STORY], [{ ...STORY, items: [STORY.items[0], STORY.items[2], STORY.items[1], STORY.items[3]] }]).includes('“Our story” on your home page: blocks moved.'));
  ok('words changed', said([STORY], [{ ...STORY, items: [STORY.items[0], { kind: 'text', body: 'New words' }, STORY.items[2], STORY.items[3]] }]).includes('“Our story” on your home page: 1 block changed.'));
  ok('only the section’s look changed', said([STORY], [{ ...STORY, look: { background: 'tinted' } }]).includes('“Our story” on your home page: its look changed.'));
  ok('other sections keep the short count', said([{ type: 'richtext', body: 'a' }], [{ type: 'richtext', body: 'b' }]).includes('1 changed on your home page.'));
}

// ═══ 6 · its styles ═══
{
  ok('its words get the section prose spacing and links', SECTION_PROSE_TYPES.includes('block-stack'));
  ok('one column: 820px, Narrow 620px, Wide the page’s width', BLOCK_CSS.includes('.block-stack .stk{max-width:820px}') && BLOCK_CSS.includes('.block-stack.stk-narrow .stk{max-width:620px}') && BLOCK_CSS.includes('.block-stack.stk-wide .stk{max-width:none}'));
  ok('blocks never float side by side: no grid, no flex on the column, no absolute placement', !/\.stk\{[^}]*(display:(grid|flex)|position:absolute)/.test(BLOCK_CSS));
  ok('hiding on phones lives only under the 620px query', BLOCK_CSS.split('.stk-hide-m').length === 2 && BLOCK_CSS.includes('@media(max-width:620px){.stk-hide-m{display:none!important}}'));
  ok('the space between blocks comes from one setting', BLOCK_CSS.includes('.stk>.stk-b+.stk-b{margin-top:var(--stk-gap,22px)}') && BLOCK_CSS.includes('.block-stack.stk-gap-tight{--stk-gap:10px}') && BLOCK_CSS.includes('.block-stack.stk-gap-roomy{--stk-gap:40px}'));
}

// ═══ 7 · the published pages the browser test opens (tests/e2e/blocks-57.spec.ts) ═══
// A page with a Blocks section between two Text sections, published by three templates, its
// stylesheet inlined so the test needs one file. Rewrite them with --update-fixtures after
// any change to how a Blocks section draws; this checks they are what the renderer draws today.
{
  const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
  const { composeBlocks } = await import('../../supabase/functions/presence/lib/serializer.ts');
  const { fixture } = await import('./full_fixture.mjs');
  const ROOT = new URL('../../', import.meta.url);
  const EP = 'https://db.example.supabase.co/functions/v1/presence/forms/5e000000-0000-4000-8000-000000000057/submit';
  const pic = (id) => ({ alt: 'A sample photo', variants: { w400: `/img/s${id.slice(-4)}-400.webp`, w800: `/img/s${id.slice(-4)}-800.webp`, w1600: `/img/s${id.slice(-4)}-1600.webp` }, width: 1600, height: 1067 });
  const id = (n) => `00000000-0000-4000-8000-0000000057${n}`;
  const PAGE_BLOCKS = [
    { type: 'richtext', title: 'Before the blocks', body: 'A Text section above, drawn the usual way.' },
    { type: 'stack', items: [
      { kind: 'heading', text: 'Built from blocks' },
      { kind: 'text', body: 'A heading, words, a photo and buttons, **stacked** in reading order. Every block sits under the one before it, on a phone and on a big screen alike.' },
      { kind: 'image', image_id: id('01'), caption: 'A photo with its caption' },
      { kind: 'button', buttons: [{ label: 'Book a visit', url: 'https://example.com/book' }, { label: 'Our hours', url: '/contact/#hours', style: 'outline' }, { label: 'Call us', url: 'tel:+15550100100', style: 'outline' }] },
      { kind: 'heading', text: 'A smaller heading', size: 'm' },
      { kind: 'image', image_id: id('02'), width: 's', align: 'center' },
      { kind: 'video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', poster_id: id('03'), caption: 'A minute in the shop' },
      { kind: 'divider', width: 's', hide_on_phone: true },
      { kind: 'spacer', size: 'l' },
      { kind: 'form', form: { ...FORM_PRESETS[0].def, id: 'blocks_form' } },
      { kind: 'map', address: '12 Olive Ave, Burbank', image_id: id('04') },
    ] },
    { type: 'richtext', title: 'After the blocks', body: 'A Text section below, drawn the usual way.' },
  ];
  for (const slug of ['business-classic', 'aurora', 'atelier']) {
    const fx = fixture(slug);
    const page = composeBlocks(structuredClone(PAGE_BLOCKS), () => null, pic, {});
    fx.content.settings = { ...fx.content.settings, pages: [{ slug: 'blocks', title: 'Blocks', blocks: page.blocks, blocks_src: page.src }] };
    const files = await renderSnapshot(fx, { baseUrl: 'https://shop.example', formEndpoint: EP });
    const cssPath = Object.keys(files).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k));
    const html = String(files['blocks/index.html']).replace(`<link rel="stylesheet" href="/${cssPath}">`, () => `<style>${files[cssPath]}</style>`);
    ok(`[${slug}] the browser page carries its Blocks section, its stylesheet and the form sender`, html.includes('block-stack') && html.includes('.block-stack .stk{') && html.includes(`action="${EP}"`) && /<script[^>]*>[^<]*presence-form|data-dds-item="9"/.test(html) && !html.includes('/assets/site-'));
    const url = new URL(`tests/e2e/fixtures/blocks-57/${slug}.html`, ROOT);
    if (Deno.args.includes('--update-fixtures')) { Deno.mkdirSync(new URL('.', url), { recursive: true }); Deno.writeTextFileSync(url, html); }
    let onDisk = ''; try { onDisk = Deno.readTextFileSync(url); } catch { /* missing */ }
    ok(`[${slug}] browser fixture is what the renderer draws today (regenerate: --update-fixtures)`, onDisk === html);
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n════ BLOCKS (ITEM 57): ${results.length - failed}/${results.length} PASSED ════`);
if (failed) Deno.exit(1);
