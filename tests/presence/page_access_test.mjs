// ── Who can see a page, and its header and footer (builder list items 48 and 120, Nov 2026) ──
// An owner's own page can leave out the site's header or footer (a landing page), and can be
// open to everyone, need a password, or be private (kept off the live site). This proves, on
// every template:
//   · a page set to leave out its header or footer is drawn without it, everywhere it's drawn,
//     and every other page keeps both
//   · the live copy drops private pages (file, menu, sitemap, search) and a password page whose
//     key is missing, keeps password pages off Google and the site's search, and never changes
//     the draft it was made from
//   · a sealed page holds none of its words, keeps the site's header and footer, and opens to
//     the right key only; the key the server keeps is the one a visitor's browser makes
//   · the stored page fields are cleaned, Duplicate keeps them, and the publish summary says
//     what changed (and now counts section edits at all, which it never did)
//
//   deno run --allow-read tests/presence/page_access_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { pageShowFields, stripSiteChrome, applyPageChrome, liveContent, lockIdsIn, newPageLock, lockKeyFromPassword, sealPage, openSealedPage, lockPages, gatePage, passwordProblem, LOCK_ITERATIONS } from '../../supabase/functions/presence/lib/page_access.ts';
import { duplicatePageInSettings } from '../../supabase/functions/presence/lib/page_ops.ts';
import { describeChanges } from '../../supabase/functions/presence/lib/diff.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://example.test' };
const TEMPLATES = ['business-classic', 'restaurant-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
const LOCK = '11111111-2222-4333-8444-555555555555';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };
const b64 = (u) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ── the stored fields, cleaned ──
ok('access keeps password and private only', pageShowFields({ access: 'password' }).access === 'password' && pageShowFields({ access: 'private' }).access === 'private' && pageShowFields({ access: 'everyone' }).access === undefined && pageShowFields({ access: '<b>' }).access === undefined);
ok('a lock is a uuid or nothing', pageShowFields({ lock: LOCK.toUpperCase() }).lock === LOCK && pageShowFields({ lock: 'x' }).lock === undefined && pageShowFields({ lock: 7 }).lock === undefined);
ok('header and footer flags are true or absent', pageShowFields({ noHeader: true, noFooter: 'yes' }).noHeader === true && !('noFooter' in pageShowFields({ noHeader: true, noFooter: 'yes' })));
ok('a page that never used them carries nothing new', JSON.stringify(pageShowFields({ slug: 'a', title: 'A', blocks: [] })) === '{}');
ok('a password needs at least 4 characters, at most 100', passwordProblem('abc') && !passwordProblem(' abcd ') && passwordProblem('x'.repeat(101)) && passwordProblem(undefined));

// ── header and footer, on every template ──
const PAGES = [
  { slug: 'landing', title: 'Landing', noHeader: true, noFooter: true, blocks: [{ type: 'richtext', title: 'Spring offer', body: 'Ten percent off.' }] },
  { slug: 'top-only', title: 'Top only', noFooter: true, blocks: [{ type: 'richtext', title: 'Just the header', body: 'x' }] },
  { slug: 'bottom-only', title: 'Bottom only', noHeader: true, blocks: [{ type: 'richtext', title: 'Just the footer', body: 'y' }] },
  { slug: 'plain', title: 'Plain', blocks: [{ type: 'richtext', title: 'Both', body: 'z' }] },
];
for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  fx.content.settings = { ...(fx.content.settings || {}), pages: structuredClone(PAGES) };
  const out = await renderSnapshot(fx, SITE);
  const has = (file, tag) => (out[file] || '').includes(`<${tag} class="site"`);
  ok(`[${slug}] a landing page leaves out both`, !has('landing/index.html', 'header') && !has('landing/index.html', 'footer') && (out['landing/index.html'] || '').includes('Ten percent off.'));
  ok(`[${slug}] leaving out the footer keeps the header`, has('top-only/index.html', 'header') && !has('top-only/index.html', 'footer'));
  ok(`[${slug}] leaving out the header keeps the footer`, !has('bottom-only/index.html', 'header') && has('bottom-only/index.html', 'footer'));
  ok(`[${slug}] every other page keeps both`, ['index.html', 'plain/index.html', 'about/index.html', 'contact/index.html'].every((f) => has(f, 'header') && has(f, 'footer')));
  ok(`[${slug}] the page keeps its skip link and main`, (out['landing/index.html'] || '').includes('id="main"'));
}
ok('stripping something that isn’t there changes nothing', stripSiteChrome('<main>x</main>', { header: true, footer: true }) === '<main>x</main>');
ok('no page asking leaves the file map as it was', applyPageChrome({ 'a/index.html': '<header class="site">h</header>' }, [{ slug: 'a' }])['a/index.html'] === '<header class="site">h</header>');

// ── the live copy ──
const draft = {
  identity: { business_name: 'Marlow’s Kitchen' }, locations: [], offerings: [], testimonials: [], faqs: [], posts: [], redirects: [],
  settings: {
    pages_noindex: ['about'],
    pages: [
      { slug: 'open', title: 'Open', blocks: [] },
      { slug: 'gallery', title: 'Gallery', access: 'password', lock: LOCK, blocks: [] },
      { slug: 'spring', title: 'Spring', access: 'private', blocks: [] },
      { slug: 'nokey', title: 'No key', access: 'password', lock: '99999999-2222-4333-8444-555555555555', blocks: [] },
      { slug: 'nolock', title: 'No lock', access: 'password', blocks: [] },
    ],
    nav: [
      { label: 'Home', href: '/' },
      { label: 'Spring', href: '/spring/', children: [{ label: 'Open', href: '/open/' }, { label: 'Gallery', href: '/gallery/' }] },
      { label: 'More', href: '/open/', children: [{ label: 'Spring again', href: '/spring/' }] },
      { label: 'No key', href: '/nokey/' },
    ],
  },
};
const frozen = JSON.stringify(draft);
ok('the lock ids a draft names', JSON.stringify(lockIdsIn(draft)) === JSON.stringify([LOCK, '99999999-2222-4333-8444-555555555555']));
const { content: live, sealed } = liveContent(draft, new Set([LOCK]));
ok('private pages and password pages without a usable key leave', JSON.stringify(live.settings.pages.map((p) => p.slug)) === JSON.stringify(['open', 'gallery']));
ok('password pages are the ones to seal', JSON.stringify(sealed) === JSON.stringify([{ slug: 'gallery', title: 'Gallery', lock: LOCK }]));
ok('a menu item for a page that left gives its dropdown its place', JSON.stringify(live.settings.nav) === JSON.stringify([{ label: 'Home', href: '/' }, { label: 'Open', href: '/open/' }, { label: 'Gallery', href: '/gallery/' }, { label: 'More', href: '/open/' }]));
ok('password pages are kept off Google and the site search', live.settings.pages_noindex.includes('page:gallery') && live.settings.pages_noindex.includes('about'));
ok('the draft itself is not changed', JSON.stringify(draft) === frozen);
{
  const withFolder = { ...draft, settings: { ...draft.settings, nav: [{ label: 'Home', href: '/' }, { label: 'Later', href: '', folder: true, children: [{ label: 'Spring', href: '/spring/' }] }, { label: 'Kept', href: '', folder: true, children: [{ label: 'Spring', href: '/spring/' }, { label: 'Open', href: '/open/' }] }] } };
  const nav = liveContent(withFolder, new Set([LOCK])).content.settings.nav;
  ok('a menu folder left empty by a private page leaves too; one with pages keeps them', JSON.stringify(nav) === JSON.stringify([{ label: 'Home', href: '/' }, { label: 'Kept', href: '', folder: true, children: [{ label: 'Open', href: '/open/' }] }]));
}
ok('a site with nothing hidden is passed through as it is', liveContent({ ...draft, settings: { pages: [{ slug: 'a', title: 'A', blocks: [] }] } }, new Set()).content.settings.pages.length === 1);

{
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  fx.content.settings = { ...(fx.content.settings || {}), pages: [
    { slug: 'open', title: 'Open', blocks: [{ type: 'richtext', title: 'Open words', body: 'For everyone.' }] },
    { slug: 'gallery', title: 'Gallery', access: 'password', lock: LOCK, blocks: [{ type: 'richtext', title: 'Members gallery', body: 'The secret recipe is love.' }] },
    { slug: 'spring', title: 'Spring', access: 'private', blocks: [{ type: 'richtext', title: 'Coming soon', body: 'Not yet.' }] },
  ] };
  const liveC = liveContent(fx.content, new Set([LOCK]));
  const out = await renderSnapshot({ ...fx, content: liveC.content }, SITE);
  ok('a private page has no file on the live site', out['spring/index.html'] === undefined);
  ok('the menu links the password page and not the private one', out['index.html'].includes('href="/gallery/"') && !out['index.html'].includes('href="/spring/"'));
  ok('neither is in the sitemap', !out['sitemap.xml'].includes('/spring/') && !out['sitemap.xml'].includes('/gallery/') && out['sitemap.xml'].includes('/open/'));
  ok('neither is in the site’s search', !out['search-index.json'].includes('/spring/') && !out['search-index.json'].includes('/gallery/') && !out['search-index.json'].includes('secret recipe'));
  ok('the password page is noindexed', out['gallery/index.html'].includes('<meta name="robots" content="noindex">'));
  // the draft itself still draws every page (the canvas and Preview)
  const drawn = await renderSnapshot(fx, SITE);
  ok('the draft still draws the private page for the editor', (drawn['spring/index.html'] || '').includes('Not yet.'));

  // ── sealing ──
  const lock = await newPageLock(' open sesame ');
  // the fastest of three: one alone could wait behind a busy computer (it gates deploys)
  let took = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); await lockKeyFromPassword('open sesame', bytes(lock.salt), lock.iterations); took = Math.min(took, performance.now() - t0); }
  ok('a lock is a salt and a key, never the password', lock.iterations === LOCK_ITERATIONS && bytes(lock.salt).length === 16 && bytes(lock.key).length === 32 && !JSON.stringify(lock).includes('sesame'));
  ok('making a key takes a moment, not a long wait (' + Math.round(took) + ' ms)', took < 3000);
  ok('the key a visitor makes from the same password is the one kept', b64(await lockKeyFromPassword('open sesame', bytes(lock.salt), lock.iterations)) === lock.key);
  ok('a different password makes a different key', b64(await lockKeyFromPassword('open sesam', bytes(lock.salt), lock.iterations)) !== lock.key);
  const sealedMap = await lockPages(out, [{ slug: 'gallery', title: 'Gallery', ...lock }]);
  const gate = sealedMap['gallery/index.html'];
  ok('the sealed page holds none of its words', !gate.includes('secret recipe') && !gate.includes('Members gallery'));
  ok('it asks for the password in the site’s own header and footer', gate.includes('This page needs a password') && gate.includes('<header class="site"') && gate.includes('<footer class="site"') && gate.includes('type="password"'));
  ok('it says which page and leads home', gate.includes('to see Gallery.') && gate.includes('href="/">Back to the home page'));
  ok('it carries no description, share tags or structured data', !/<meta name="description"/.test(gate) && !/og:description|twitter:title/.test(gate) && !gate.includes('application/ld+json'));
  ok('it keeps the site’s stylesheet and stays off Google', /<link rel="stylesheet" href="\/assets\/site-[0-9a-f]+\.css">/.test(gate) && gate.includes('content="noindex"'));
  ok('it doesn’t count a visit until the page opens', !gate.includes('presence-analytics'));
  ok('other pages are untouched', sealedMap['open/index.html'] === out['open/index.html'] && sealedMap['index.html'] === out['index.html']);
  const data = JSON.parse(gate.match(/<script type="application\/json" id="dds-lock-data">([\s\S]*?)<\/script>/)[1]);
  ok('the box names the salt and rounds the visitor needs', data.salt === lock.salt && data.iterations === lock.iterations);
  ok('the right key opens the page exactly', (await openSealedPage(data, lock.key)) === out['gallery/index.html']);
  let refused = false;
  try { await openSealedPage(data, b64(await lockKeyFromPassword('wrong', bytes(lock.salt), lock.iterations))); } catch { refused = true; }
  ok('the wrong key opens nothing', refused);
  const again = (await lockPages(out, [{ slug: 'gallery', title: 'Gallery', ...lock }]))['gallery/index.html'];
  ok('each publish seals with a fresh nonce', again !== gate);
  ok('a page that isn’t drawn is left alone', (await lockPages(out, [{ slug: 'nope', title: 'Nope', ...lock }]))['nope/index.html'] === undefined);
  ok('a hostile title is written as text', gatePage('<html><head></head><body><main id="main"></main></body></html>', { iv: 'AA==', data: 'AA==' }, lock, { title: '<img src=x onerror=alert(1)>' }).includes('&lt;img src=x onerror=alert(1)&gt;'));
  ok('a sealed page still has its sealed bytes when the page has a </script> in it', (await openSealedPage(await sealPage('<script>x</script></script>', lock.key), lock.key)) === '<script>x</script></script>');
}

// ── Duplicate keeps who can see it ──
{
  const r = duplicatePageInSettings({ pages: [{ slug: 'gallery', title: 'Gallery', access: 'password', lock: LOCK, noHeader: true, blocks: [] }] }, 'gallery');
  const copy = r.pages.find((p) => p.slug === 'gallery-copy');
  ok('a copy of a password page keeps its password and header choice', copy && copy.access === 'password' && copy.lock === LOCK && copy.noHeader === true && !('noFooter' in copy));
  const r2 = duplicatePageInSettings({ pages: [{ slug: 'a', title: 'A', blocks: [] }] }, 'a');
  ok('a copy of an open page carries nothing new', JSON.stringify(Object.keys(r2.pages[1]).sort()) === JSON.stringify(['blocks', 'slug', 'title']));
}

// ── the publish summary ──
{
  const base = (pages, blocks = [], extra = {}) => ({ identity: { business_name: 'X' }, locations: [], offerings: [], testimonials: [], faqs: [], posts: [], redirects: [], settings: { blocks, pages, ...extra } });
  const said = (d, l) => describeChanges(d, l).changes.map((c) => c.sentence);
  const was = base([{ slug: 'g', title: 'Gallery', blocks: [] }, { slug: 'old', title: 'Old', blocks: [] }], [{ type: 'title', title: 'A' }]);
  ok('a section added on the home page counts (it never did)', said(base(was.settings.pages, [{ type: 'title', title: 'A' }, { type: 'title', title: 'B' }]), was).includes('1 section added on your home page.'));
  ok('a section added on an own page counts', said(base([{ slug: 'g', title: 'Gallery', blocks: [{ type: 'title', title: 'C' }] }, { slug: 'old', title: 'Old', blocks: [] }], was.settings.blocks), was).includes('1 section added on “Gallery”.'));
  const pw = base([{ slug: 'g', title: 'Gallery', access: 'password', lock: LOCK, blocks: [] }, { slug: 'old', title: 'Old', access: 'private', noHeader: true, noFooter: true, blocks: [] }, { slug: 'new', title: 'New', blocks: [] }], was.settings.blocks);
  const s = said(pw, was);
  ok('a page that will need a password says so', s.includes('“Gallery” will need a password to open.'));
  ok('a page kept private says it leaves the live site', s.includes('“Old” comes off your live site and stays private.'));
  ok('a landing page says it leaves out the header and footer', s.includes('“Old” leaves out the header and footer.'));
  ok('a new page is named', s.includes('New page: “New”.'));
  ok('back to everyone says so', said(was, pw).includes('“Gallery” is open to everyone.') && said(was, pw).includes('The page “New” is removed.'));
  ok('a new password is a change', said(base([{ slug: 'g', title: 'Gallery', access: 'password', lock: '22222222-2222-4333-8444-555555555555', blocks: [] }]), base([{ slug: 'g', title: 'Gallery', access: 'password', lock: LOCK, blocks: [] }])).includes('“Gallery” gets a new password.'));
  ok('a menu change counts', said(base([], [], { nav: [{ label: 'Home', href: '/' }] }), base([])).includes('Your menu changes.'));
  ok('search settings saved in another order are not a change', said(base([], [], { page_seo: { b: { title: 'B', description: 'd' }, a: { title: 'A' } } }), base([], [], { page_seo: { a: { title: 'A' }, b: { description: 'd', title: 'B' } } })).length === 0);
  ok('the same draft and live say nothing', said(was, structuredClone(was)).length === 0);
}

// ── wiring: the publish draws the live copy and seals before it deploys; nothing else does ──
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  const at = (s) => pub.indexOf(s);
  ok('the publish reads this site’s keys, then makes the live copy', at('readPageLocks(site.id, lockIdsIn(') > 0 && at('liveContent(snapshotArg.snapshot.content') > at('readPageLocks(site.id'));
  ok('the publish draws the live copy, not the draft', pub.includes('renderSnapshot(liveSnap, siteCfg)') && !pub.includes('renderSnapshot(snapshotArg.snapshot, siteCfg)'));
  ok('password pages are sealed before anything deploys', at('lockPages(fileMap') > 0 && at('lockPages(fileMap') < at('deployFileMap('));
  ok('the snapshot Versions keeps is the draft as it was', !/snapshotArg\.snapshot\.content\s*=/.test(pub));
  const prev = read('supabase/functions/presence/routes/preview.ts');
  ok('the canvas and Preview still draw the draft, private pages and all', prev.includes('renderForBuilder(snapshot)') && !prev.includes('liveContent('));
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  page access — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
