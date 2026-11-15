// ── Ready-made pages by what each is for (builder list item 216) ────────────────
// Add a page shows a picture of every ready-made page, grouped Introduce, Sell, Show and
// Home pages (lib/page_layouts.ts). This checks the list against the real validator:
// every page keeps every section it brings (only photo sections arrive empty, for the
// owner's own photos), nothing invents a review, every address is free of the
// templates' built-in pages, and GET /pages/ready serves the list.
//   deno run --allow-read --allow-env tests/presence/page_layouts_test.mjs
const P = '../../supabase/functions/presence';
const { listReadyPages, PAGE_GROUPS, PAGE_PURPOSES, PHOTO_SECTIONS, purposeOf } = await import(`${P}/lib/page_layouts.ts`);
const { STARTER_LAYOUTS } = await import(`${P}/lib/starter_layouts.ts`);
const { validateBlocks } = await import(`${P}/lib/site_blocks.ts`);
const { PAGE_SLUG_RE, RESERVED_PAGE_SLUGS } = await import(`${P}/lib/page_ops.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const pages = listReadyPages();

// ── the groups ──
{
  ok('four groups, in the order Add a page shows them', JSON.stringify(PAGE_GROUPS.map((g) => g.key)) === JSON.stringify(['introduce', 'sell', 'show', 'home']) && JSON.stringify([...PAGE_PURPOSES]) === JSON.stringify(['introduce', 'sell', 'show', 'home']));
  const names = (g) => pages.filter((p) => p.group === g).map((p) => p.name);
  ok('Introduce: About us, Contact, Meet the team, Questions', JSON.stringify(names('introduce')) === JSON.stringify(['About us', 'Contact', 'Meet the team', 'Questions']));
  ok('Sell: Services, Prices, Menu, Book a visit', JSON.stringify(names('sell')) === JSON.stringify(['Services', 'Prices', 'Menu', 'Book a visit']));
  ok('Show: Gallery, Reviews, Events, Before and after', JSON.stringify(names('show')) === JSON.stringify(['Gallery', 'Reviews', 'Events', 'Before and after']));
  ok('Home pages: the home layouts, all of them, in their own order', JSON.stringify(pages.filter((p) => p.group === 'home').map((p) => p.key)) === JSON.stringify(STARTER_LAYOUTS.map((l) => l.key)));
  ok('the purpose pages come before the home pages', pages.findIndex((p) => p.group === 'home') === pages.filter((p) => p.group !== 'home').length);
  ok('each group says in a line what its pages are for', PAGE_GROUPS.every((g) => g.name && /\.$/.test(g.line)));
}

// ── every page ──
{
  const keys = pages.map((p) => p.key);
  ok('every key is its own (each is a picture’s file name)', new Set(keys).size === keys.length && keys.every((k) => /^[a-z_]+$/.test(k)), keys.filter((k, i) => keys.indexOf(k) !== i).join(', '));
  ok('every page has a name, a line and a page name', pages.every((p) => p.name && p.description && p.title && p.title.length <= 60));
  const badSlug = pages.filter((p) => !PAGE_SLUG_RE.test(p.slug) || RESERVED_PAGE_SLUGS.has(p.slug) || p.slug.length > 40).map((p) => `${p.key}:${p.slug}`);
  ok('every address is a page of its own: never the template’s About, Contact, Services, Menu or FAQ', badSlug.length === 0, badSlug.join(', '));
  const lost = [];
  for (const p of pages) {
    const waits = p.blocks.filter((b) => PHOTO_SECTIONS.has(b.type)).length;
    const kept = validateBlocks(JSON.parse(JSON.stringify(p.blocks)));
    if (kept.length !== p.blocks.length - waits) lost.push(`${p.key}: ${kept.length} of ${p.blocks.length - waits}`);
  }
  ok('every section of every page is kept by the real validator, with no photos at all', lost.length === 0, lost.join('; '));
  const photoOnly = pages.filter((p) => p.blocks.every((b) => PHOTO_SECTIONS.has(b.type) || b.type === 'title'));
  ok('no page is only a heading and photos waiting to be added', photoOnly.length === 0, photoOnly.map((p) => p.key).join(', '));
  const empties = pages.flatMap((p) => p.blocks.filter((b) => PHOTO_SECTIONS.has(b.type)).map((b) => [p.key, b]));
  ok('a photo section arrives empty, for the owner’s own photos (never someone else’s)', empties.length === 2 && empties.every(([, b]) => (Array.isArray(b.image_ids) ? b.image_ids : b.items || []).length === 0));
  ok('a page holds 2 to 6 sections', pages.every((p) => p.blocks.length >= 2 && p.blocks.length <= 6));
}

// ── never invented facts ──
{
  const reviews = pages.find((p) => p.key === 'reviews');
  ok('the Reviews page draws the site’s own approved reviews, and no review is written into it', reviews.blocks.some((b) => b.type === 'reviews_wall') && !reviews.blocks.some((b) => b.type === 'reviews' || b.type === 'testimonials'));
  const words = JSON.stringify(pages.filter((p) => p.group !== 'home').map((p) => p.blocks));
  ok('no ready-made page writes a price, a phone number or an address', !/\$\d|\(\d{3}\)|\d{3}-\d{4}|@[a-z]+\./.test(words));
  ok('no em-dash in the new pages’ words', !/—[a-z ]/i.test(words.replace(/\$—/g, '')));
  ok('the contact form asks for a name, an email and a message', (() => { const f = pages.find((p) => p.key === 'contact').blocks.find((b) => b.type === 'form'); return f && ['name', 'email', 'message'].every((k) => f.fields.some((x) => x.key === k)); })());
}

// ── purposes as stored ──
{
  ok('purposeOf: the four, in any case', ['introduce', 'SELL', ' show ', 'home'].map(purposeOf).join() === 'introduce,sell,show,home');
  ok('purposeOf: anything else is none', [null, '', 'shop', 'home page', 3].every((v) => purposeOf(v) === null));
}

// ── served ──
{
  const src = read('supabase/functions/presence/routes/saved_pages.ts');
  const idx = read('supabase/functions/presence/index.ts');
  ok('GET /pages/ready serves the groups, the pages and the recommended home layout', src.includes('return json({ data: { groups: PAGE_GROUPS, pages: listReadyPages(), recommended: starterKeyFor(industry) } }, 200, cors);'));
  ok('router: GET /pages/ready, read-only and site-scoped', idx.includes("if (route === '/pages/ready' && method === 'GET') return handleReadyPages(site, cors);"));
  ok('router: the routes load only when asked for', idx.includes("lazyRoutes(() => import('./routes/saved_pages.ts'))"));
  ok('/blocks/suggested still answers its starters for older pages', read('supabase/functions/presence/routes/content.ts').includes('starters: listStarterLayouts(),'));
}

const failed = results.filter((r) => !r).length;
console.log(`\n════ READY-MADE PAGES: ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
