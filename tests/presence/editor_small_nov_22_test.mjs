// ── Small editor fixes from the Nov 22 review: builder items 322, 324, 326, 327, 328 and 430 ──
//   322 the dock's Versions lists the saved versions, newest first (the same list as Site settings)
//   324 the section search knows the words owners use, and the tiles they lead to
//   326 Layers is headed by what it lists (the dock's Find is gone: tests/e2e covers the dock)
//   327 plain words: the browser's own font named in words, a hint on every page flag, no H2 or H3
//   328 How you sound: one row in Business details, kept where the AI writer reads a voice
//   430 a long business name keeps the phone bar near 60px: its own box, two lines, a little smaller
// The editor's pieces are pulled out of its source and run; the published site is drawn for real.
//
//   deno run --allow-read --allow-env tests/presence/editor_small_nov_22_test.mjs
import { editorSource } from './editor_source.mjs';
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { SHELL_CSS, MENU_BREAK } from '../../supabase/functions/presence/lib/site_shell.ts';
import { TEMPLATES, fixture } from './full_fixture.mjs';
import { pinClock } from './clock.mjs';
const restoreClock = pinClock();   // the suite holds dates and draws the templates, which read the clock (item 421)

const ROOT = new URL('../../', import.meta.url);
const src = editorSource();
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// Pull `function NAME(...) {...}` or `const NAME = {...}` / `[...]` out of the editor by bracket matching.
function balanced(text, from) {
  let depth = 0;
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(from, j + 1); }
  }
  throw new Error('unbalanced from ' + from);
}
const fnSrc = (name) => { const at = src.indexOf('function ' + name + '('); if (at < 0) throw new Error('no function ' + name); const open = src.indexOf('{', at); return src.slice(at, open) + balanced(src, open); };
const constSrc = (name) => { const at = src.indexOf('const ' + name + ' = '); if (at < 0) throw new Error('no const ' + name); const open = at + ('const ' + name + ' = ').length; return balanced(src, open); };
const value = (name, scope = {}) => new Function(...Object.keys(scope), 'return (' + constSrc(name) + ');')(...Object.values(scope));
const fn = (name, scope = {}) => new Function(...Object.keys(scope), 'return (' + fnSrc(name) + ');')(...Object.values(scope));

// ═══ 322: the versions the dock lists ═══
{
  const dcTwVersions = fn('dcTwVersions', { VERSIONS_SHOWN: 10 });
  const pubs = [
    { id: 'p1', at: '2026-11-18T17:00:00Z', status: 'superseded', summary: 'New hours' },
    { id: 'p2', at: '2026-11-21T18:30:00Z', status: 'live', summary: 'Holiday menu', label: 'Winter' },
    { id: 'p3', at: '2026-11-20T12:00:00Z', status: 'failed', summary: '' },
  ];
  const cps = [{ id: 'c1', name: 'Before the spring menu', created_at: '2026-11-19T09:00:00Z' }];
  const got = dcTwVersions(pubs, cps);
  ok('322: publishes and checkpoints in one list, newest first', got.map((v) => v.id).join() === 'p2,c1,p1');
  ok('322: a publish that didn\'t go through has nothing to draw, so it isn\'t listed', !got.some((v) => v.id === 'p3'));
  ok('322: the live one says so; a checkpoint is marked saved and keeps its name', got[0].live === true && got[0].name === 'Winter' && got[1].saved === true && got[1].name === 'Before the spring menu' && !got[2].live);
  const many = Array.from({ length: 14 }, (_, i) => ({ id: 'v' + i, at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), status: 'superseded' }));
  const ten = dcTwVersions(many, []);
  ok('322: at most ten, like the Versions list, the newest kept', ten.length === 10 && ten[0].id === 'v13' && ten[9].id === 'v4');
  ok('322: nothing listed when there is nothing kept, and a bad answer is no list', dcTwVersions([], []).length === 0 && dcTwVersions({}, null).length === 0);
}

// ═══ 324: what an owner types finds the right tiles ═══
{
  const BLOCK_DEFS = value('BLOCK_DEFS'), SECTION_GROUPS = value('SECTION_GROUPS'), SECTION_ALIAS = value('SECTION_ALIAS'), SECTION_FINDS = value('SECTION_FINDS');
  const vocabCap = (w) => String(w || '').charAt(0).toUpperCase() + String(w || '').slice(1);
  const routesFor = (label) => value('SECTION_ROUTES', { VOCAB: { label }, vocabCap });
  const trayItemMatches = fn('trayItemMatches');
  const tiles = (label) => {
    const routes = routesFor(label), out = [];
    for (const g of SECTION_GROUPS) {
      for (const ty of g.types) { const d = BLOCK_DEFS.find((x) => x.type === ty); if (d) out.push({ name: d.name, words: (SECTION_ALIAS[ty] || '') + ' ' + (SECTION_FINDS[ty] || ''), type: ty }); }
      for (const r of routes.filter((x) => x.group === g.label)) out.push({ name: r.name(), words: r.alias + ' ' + r.finds, type: '' });
    }
    return out;
  };
  const restaurant = tiles('menu');
  const find = (q, list = restaurant) => list.filter((t) => trayItemMatches(t.name, t.words, t.type, q)).map((t) => t.name);
  const has = (q, names, list) => { const got = find(q, list); return names.every((n) => got.includes(n)); };
  ok('324: "form" finds the Contact form and the sign-up form', has('form', ['Contact form', 'Newsletter sign-up']));
  ok('324: "contact" finds the Contact form and the map', has('contact', ['Contact form', 'Map & directions']));
  ok('324: "hours" finds Hours', has('hours', ['Hours']));
  ok('324: "menu" finds the Menu and the price list', has('menu', ['Menu', 'Pricing / packages']));
  ok('324: on a site whose word is Services, "menu" still finds it, by its own name', has('menu', ['Services'], tiles('services')));
  ok('324: "hero" finds the opening with a photo and the spotlight', has('hero', ['Opening with a photo', 'Spotlight']));
  ok('324: "faq" finds the Accordion', has('faq', ['Accordion']));
  ok('324: "testimonial" finds the reviews', has('testimonial', ['Reviews wall', 'Review rating badge']));
  ok('324: "blog" finds Updates', has('blog', ['Updates']));
  ok('324: none of those words finds nothing, plural or capitalised', ['forms', 'Contact', 'HOURS', 'faqs', 'testimonials', 'Blog'].every((q) => find(q).length > 0));
  ok('324: no tile is named "(native)" or "(expandable)"', restaurant.every((t) => !/\((native|expandable)\)/i.test(t.name)));
  ok('324: every new tile sits under a real group, and names where it opens', routesFor('menu').every((r) => SECTION_GROUPS.some((g) => g.label === r.group) && r.says && typeof r.go === 'function'));
  ok('324: the search still needs every word: "contact zzz" finds nothing', find('contact zzz').length === 0);
}

// ═══ 326: Layers says what it lists ═══
{
  const made = [];
  const el = (tag, cls, text) => { const n = { tag, cls, text, kids: [] }; n.appendChild = (k) => n.kids.push(k); n.addEventListener = () => {}; made.push(n); return n; };
  const host = { textContent: '', kids: [] }; host.appendChild = (k) => host.kids.push(k);
  const pages = [{ slug: '', title: 'Home' }, { slug: 'about-us', title: 'About us' }, { slug: 'menu', title: 'Menu' }];
  const scope = { $: () => host, PDRAG: null, pdFinish: () => {}, el, dcPageList: () => pages, DC_PAGE: 'about-us', dcPageTreeRow: (pg, cur) => ({ cls: 'pagerow', page: pg.slug, cur }), dcTreeSectionRows: (h) => h.appendChild({ cls: 'block' }), dcAddPage: () => {}, CM_ON: false };
  fn('dcBuildTree', scope)({});
  const order = host.kids.map((k) => k.text || (k.cls === 'pagerow' ? 'page:' + k.page + (k.cur ? '*' : '') : k.cls));
  ok('326: Layers is headed "Sections on this page", the open page and its sections first', order[0] === 'Sections on this page' && order[1] === 'page:about-us*' && order[2] === 'block');
  ok('326: the other pages come after, under their own heading, then Add a page', order[3] === 'Your other pages' && order[4] === 'page:' && order[5] === 'page:menu' && /Add a page/.test(order[6] || ''));
  host.kids = [];
  fn('dcBuildTree', { ...scope, DC_PAGE: '~about' })({});
  ok('326: a page with no sections of its own says so under the heading', host.kids[0].text === 'Sections on this page' && host.kids[1].cls === 'dc-tree-empty');
}

// ═══ 327: plain words ═══
{
  const fontWords = fn('fontWords', { FONT_GENERIC: value('FONT_GENERIC') });
  ok('327: the browser\'s own font is named in words, never "system-ui"', fontWords('system-ui') === 'Your device’s own font' && fontWords('-apple-system') === 'Your device’s own font' && fontWords('sans-serif') === 'Your device’s own font');
  ok('327: a serif or typewriter stand-in says which; a real font keeps its name', fontWords('serif') === 'Your device’s serif font' && fontWords('ui-monospace') === 'Your device’s typewriter font' && fontWords('Georgia') === 'Georgia');
  const RT = value('RT_BUTTONS', { rtLine: () => {}, rtWrap: () => {}, rtLink: () => {} });
  const shown = RT.map((b) => b.html.replace(/<[^>]+>/g, ''));
  ok('327: the text box\'s heading buttons say Heading and Smaller heading, not H2 and H3', shown.includes('Heading') && shown.includes('Smaller heading') && !shown.some((t) => /^H[1-6]$/.test(t)));
  const HB_TREE_FLAG = value('HB_TREE_FLAG');
  const treeHint = fn('treeHint', { HB_TREE_FLAG });
  const page = (status, sections = []) => ({ status, status_label: { publish_failed: 'Publish didn’t go through', missing_required: 'Needs something before publishing', needs_review: 'Worth a look' }[status], sections });
  ok('327: every flag a page can wear has a hint after its whole label (item 285 keeps the label in the title)', Object.keys(HB_TREE_FLAG).every((s) => { const h = treeHint(page(s)); return h.startsWith(page(s).status_label + ': ') && h.length > page(s).status_label.length + 30; }));
  const look = treeHint(page('needs_review', [{ label: 'Questions', status: 'needs_review' }, { label: 'Hours', status: 'complete' }, { label: 'Menu', status: 'needs_review' }]));
  ok('327: "Worth a look" says it can still go live, and names the parts to look at', /can go live/.test(look) && /Look at: Questions, Menu\./.test(look) && !/Hours/.test(look));
  ok('327: no page, no hint', treeHint(null) === '');
}

// ═══ 328: How you sound ═══
{
  const VOICE_CHOICES = value('VOICE_CHOICES');
  const voicePick = fn('voicePick', { VOICE_CHOICES });
  ok('328: five choices', VOICE_CHOICES.length === 5 && new Set(VOICE_CHOICES).size === 5);
  ok('328: a stored choice reads back as that choice, words of their own as "own", nothing as none', voicePick('Warm and friendly') === 'Warm and friendly' && voicePick('Like a neighbour who knows cars') === 'own' && voicePick('') === '' && voicePick(null) === '' && voicePick('  Calm and professional ') === 'Calm and professional');
  // the row writes the field the writer reads: the text of both files is the contract here
  const facts = Deno.readTextFileSync(new URL('supabase/functions/presence/writer/facts.ts', ROOT));
  const brand = Deno.readTextFileSync(new URL('supabase/functions/presence/routes/brand.ts', ROOT));
  ok('328: the AI writer reads its voice from the brand profile\'s voice_characteristics', /presence_brand_profile\?site_id=eq\.\$\{site\.id\}&select=voice_characteristics/.test(facts) && /tone_notes: v\.voice_characteristics/.test(facts));
  ok('328: the brand profile route saves voice_characteristics, up to 600 characters', /voice_characteristics: 600/.test(brand));
}

// ═══ 430: a long name on a phone ═══
{
  const long = 'Marlow’s Kitchen and Catering Company of Greater Los Angeles';
  for (const slug of TEMPLATES) {
    const fx = fixture(slug);
    fx.content.identity = { ...fx.content.identity, business_name: long };
    const html = String((await renderSnapshot(fx, { baseUrl: 'https://shop.example', formEndpoint: 'https://shop.example/forms/submit', bookEndpoint: 'https://shop.example/book' }))['index.html']);
    ok(`[${slug}] 430: the name has its own box in the header`, /<a class="brand"[^>]*>(?:<img[^>]*>)?<span class="brand-name">Marlow[^<]*Catering Company of Greater Los Angeles<\/span><\/a>/.test(html));
  }
  const phone = SHELL_CSS.slice(SHELL_CSS.indexOf(`@media (max-width:${MENU_BREAK}px){`));
  const brand = /header\.site \.brand\{font-size:([\d.]+)rem;line-height:([\d.]+);min-height:(\d+)px/.exec(phone);
  const clamp = /header\.site \.brand-name\{[^}]*-webkit-line-clamp:2;[^}]*overflow:hidden/.test(phone);
  const pad = /header\.site \.nav\{[^}]*padding-top:(\d+)px;padding-bottom:(\d+)px/.exec(phone);
  const twoLines = brand ? 2 * Number(brand[1]) * 16 * Number(brand[2]) : 99;
  const bar = brand && pad ? Math.max(Number(brand[3]), twoLines) + Number(pad[1]) + Number(pad[2]) : 99;
  ok('430: on a phone the name holds to two lines, a little smaller than before (1.15rem)', clamp && brand && Number(brand[1]) < 1.15);
  ok(`430: two lines of name fit the 44px row, so the bar is about 60px (${bar}px)`, twoLines <= 44 && bar <= 62);
}

restoreClock();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
