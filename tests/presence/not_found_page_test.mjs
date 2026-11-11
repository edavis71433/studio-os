// ── The owner's own "not found" page, and the password page's own words (builder list item 121, Nov 2026) ──
// The owner picks one of their pages to answer a broken link, and writes the heading and the
// message on a password page's box. This proves:
//   · the stored fields are cleaned: only a true notFound stays; the words are trimmed, cut to
//     length and kept free of control characters; a page copy is never the not-found page
//   · on every template the chosen page becomes 404.html as drawn, out of search engines and
//     pointing at no address of its own, while its own address still works; without one, or
//     when the chosen page is private or needs a password, the template's ready-made page stays
//   · the password box shows the owner's heading and message, escaped, else its own words
//
//   deno run --allow-read tests/presence/not_found_page_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { pageShowFields, applyNotFoundPage, liveContent, gatePage } from '../../supabase/functions/presence/lib/page_access.ts';
import { duplicatePageInSettings } from '../../supabase/functions/presence/lib/page_ops.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://example.test' };
const TEMPLATES = ['business-classic', 'restaurant-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
const LOCK = '11111111-2222-4333-8444-555555555555';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };

// the stored fields
ok('notFound only when true', pageShowFields({ notFound: true }).notFound === true && !('notFound' in pageShowFields({ notFound: 'yes' })) && !('notFound' in pageShowFields({})));
const w = pageShowFields({ lockTitle: '  Members’ \u0007prices  ', lockNote: 'Ask us\nat the counter.' + 'x'.repeat(400) });
ok('the box’s words are trimmed, cleaned and cut to length', w.lockTitle === 'Members’ prices' && w.lockNote.startsWith('Ask us at the counter.') && w.lockNote.length === 300);
ok('empty or not words: nothing kept', !('lockTitle' in pageShowFields({ lockTitle: '   ' })) && !('lockNote' in pageShowFields({ lockNote: 12 })));
const dup = duplicatePageInSettings({ blocks: [], pages: [{ slug: 'lost', title: 'Lost', blocks: [], notFound: true, noFooter: true }] }, 'lost');
ok('a copy of the not-found page isn’t the not-found page too (its other settings come along)', !('error' in dup) && !('notFound' in dup.pages[1]) && dup.pages[1].noFooter === true);

// the pass itself
const PAGE = '<!doctype html><html><head><title>Lost</title><link rel="canonical" href="https://example.test/lost/">\n<meta name="robots" content="index,follow"></head><body><main>Lost? Let’s get you home</main></body></html>';
const fm = { 'index.html': '<html></html>', '404.html': 'READY-MADE', 'lost/index.html': PAGE };
const out = applyNotFoundPage(fm, [{ slug: 'lost', notFound: true }]);
ok('the chosen page answers a broken link', String(out['404.html']).includes('Lost? Let’s get you home'));
ok('…kept out of search engines, pointing at no address of its own', String(out['404.html']).includes('<meta name="robots" content="noindex">') && !String(out['404.html']).includes('rel="canonical"') && !String(out['404.html']).includes('index,follow'));
ok('…and its own address still works as it was', out['lost/index.html'] === PAGE);
ok('nobody picked: the very same files', applyNotFoundPage(fm, [{ slug: 'lost' }]) === fm && applyNotFoundPage(fm, undefined) === fm);
ok('a private or password page never answers a broken link', applyNotFoundPage(fm, [{ slug: 'lost', notFound: true, access: 'private' }]) === fm && applyNotFoundPage(fm, [{ slug: 'lost', notFound: true, access: 'password' }]) === fm);
ok('a picked page that isn’t drawn: the ready-made page stays', applyNotFoundPage(fm, [{ slug: 'gone', notFound: true }]) === fm);

// on every template, through the one render entry
for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const pagesOf = (extra = {}) => [{ slug: 'lost', title: 'Lost', blocks: [{ type: 'richtext', title: 'Lost? Let’s get you home', body: 'The page you wanted has moved.' }], ...extra }];
  const withPages = (pages) => ({ ...fx, content: { ...fx.content, settings: { ...(fx.content.settings || {}), pages } } });
  const plain = await renderSnapshot(withPages(pagesOf()), SITE);
  const picked = await renderSnapshot(withPages(pagesOf({ notFound: true })), SITE);
  const nf = String(picked['404.html'] || '');
  ok(`[${slug}] no pick: the template’s own 404 page`, String(plain['404.html']).length > 0 && !String(plain['404.html']).includes('Lost? Let’s get you home'));
  ok(`[${slug}] picked: 404.html is that page`, nf.includes('Lost? Let’s get you home') && nf.includes('<meta name="robots" content="noindex">') && !nf.includes('rel="canonical"'));
  ok(`[${slug}] …with links that work from any address`, !/(href|src)="\.\.?\//.test(nf));
  ok(`[${slug}] …and its own page as before`, picked['lost/index.html'] === plain['lost/index.html']);
}

// the password box's words
const sealedBits = { iv: 'AAAA', data: 'BBBB' }, lock = { salt: 'c2FsdA==', iterations: 310000 };
const own = gatePage('<html><head></head><body><main></main></body></html>', sealedBits, lock, { title: 'Lessons', heading: 'Members’ <prices>', note: 'Ask us & we’ll tell you.' });
ok('the owner’s heading and message, escaped', own.includes('<h1>Members’ &lt;prices&gt;</h1>') && own.includes('<p>Ask us &amp; we’ll tell you.</p>') && !own.includes('This page needs a password'));
const plainBox = gatePage('<html><head></head><body><main></main></body></html>', sealedBits, lock, { title: 'Lessons' });
ok('none written: the box’s own words', plainBox.includes('<h1>This page needs a password</h1>') && plainBox.includes('Type the password you were given to see Lessons.'));
const { sealed } = liveContent({ identity: { business_name: 'x' }, locations: [], settings: { pages: [{ slug: 'lessons', title: 'Lessons', blocks: [], access: 'password', lock: LOCK, lockTitle: 'Members’ prices', lockNote: 'Ask at the counter.' }] } }, new Set([LOCK]));
ok('the publish hands the words to the box', sealed.length === 1 && sealed[0].heading === 'Members’ prices' && sealed[0].note === 'Ask at the counter.');

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  not found page — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
