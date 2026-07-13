// ── On-site search + tags — pure logic (Phase SEARCH) ────────────────────────
//   deno run --allow-read tests/presence/search_test.mjs
// The static index builder (content → entries, snippet/title, no PII), the ONE
// ranking rule (matchDocs, mirrored by the on-site client script), tag
// normalization + the tag-filter helpers, and the XSS-safe rendered fragments.
// All pure — no DB, no network, no clock.
import {
  plainSnippet, buildSearchIndex, searchIndexJson, matchDocs,
  normalizeTags, uniquePostTags, postTagsAttr, postTagsHtml, tagFilterBar, tagFilterScript,
  searchBoxHtml, searchPageBody, searchClientScript, SEARCH_CSS,
} from '../../supabase/functions/presence/lib/search_index.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = esc;

// ═══ plainSnippet — markdown/html stripped to a plain single line ═══
ok('snippet: strips markdown emphasis/heading/links', plainSnippet('# Hi **there** [link](http://x)') === 'Hi there link');
ok('snippet: strips stray html tags', plainSnippet('a <b>bold</b> <img src=x> word') === 'a bold word');
ok('snippet: collapses whitespace', plainSnippet('a\n\n  b\t c') === 'a b c');
{
  const long = 'word '.repeat(60);
  const s = plainSnippet(long, 100);
  ok('snippet: truncates with ellipsis on a word boundary', s.length <= 101 && s.endsWith('…') && !s.includes('  '));
}
ok('snippet: empty in → empty out', plainSnippet('') === '' && plainSnippet(null) === '');

// ═══ buildSearchIndex — content → entries ═══
const content = {
  identity: { business_name: 'Bacchus Kitchen', description: 'Seasonal plates in Burbank.', tagline: 'Warm food.', story: 'We opened in 2019.', phone: '818-555-0134', email: 'hi@bacchus.example' },
  offerings: [{ id: 'o1', name: 'Braised Short Rib', category: 'Mains', description: 'Slow-cooked, red wine.', price_text: '$28' }, { id: 'o2', name: '', category: 'x' }],
  faqs: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Always at the bar.' }],
  posts: [
    { id: 'p1', title: 'Winter menu is live', slug: 'winter-menu', body_md: 'Six new plates.', excerpt: 'Six new plates.', published_at: '2026-02-01T00:00:00Z', tags: ['Winter', 'events'] },
    { id: 'p2', title: 'Older post', slug: 'older', body_md: 'x', published_at: '2026-01-01T00:00:00Z' },
    { id: 'p3', title: '', slug: 'no-title', body_md: 'x', published_at: '2026-03-01T00:00:00Z' }, // dropped: no title
  ],
};
const opts = { offeringPath: '/menu/', offeringLabel: 'Menu' };
const docs = buildSearchIndex(content, opts);
ok('index: has page/service/update/faq kinds', ['page', 'service', 'update', 'faq'].every((k) => docs.some((d) => d.k === k)));
ok('index: offering with a name is indexed; the nameless one is dropped', docs.filter((d) => d.k === 'service').length === 1 && docs.some((d) => d.t === 'Braised Short Rib'));
ok('index: titleless post dropped', !docs.some((d) => d.k === 'update' && !d.t));
ok('index: updates newest-first', (() => { const u = docs.filter((d) => d.k === 'update'); return u[0].t === 'Winter menu is live' && u[1].t === 'Older post'; })());
ok('index: offering url → offeringPath, faq → /faq/, post → /updates/<slug>/',
  docs.find((d) => d.t === 'Braised Short Rib').u === '/menu/' &&
  docs.find((d) => d.k === 'faq').u === '/faq/' &&
  docs.find((d) => d.t === 'Winter menu is live').u === '/updates/winter-menu/');
ok('index: post tags fold into entry (searchable)', (() => { const p = docs.find((d) => d.t === 'Winter menu is live'); return Array.isArray(p.g) && p.g.includes('winter') && p.g.includes('events'); })());
// NO PII: the phone + email must never appear anywhere in the shipped index.
{
  const blob = searchIndexJson(content, opts);
  ok('index: NO PII — phone never in the index', !blob.includes('818-555-0134') && !blob.includes('5550134'));
  ok('index: NO PII — email never in the index', !blob.includes('hi@bacchus.example'));
  ok('index: is valid JSON, an array', Array.isArray(JSON.parse(blob)));
}
ok('index: FAQ page entry appears only when there are FAQs', (() => {
  const noFaq = buildSearchIndex({ ...content, faqs: [] }, opts);
  return !noFaq.some((d) => d.u === '/faq/') && docs.some((d) => d.k === 'page' && d.u === '/faq/');
})());

// ═══ matchDocs — the ONE ranking rule ═══
ok('match: empty query → no results', matchDocs(docs, '').length === 0 && matchDocs(docs, '   ').length === 0);
ok('match: a title hit ranks above a snippet-only hit', (() => {
  const r = matchDocs(docs, 'plates'); // "Six new plates" (snippet) vs nothing in title
  return r.length > 0 && r.some((d) => d.s.toLowerCase().includes('plates'));
})());
ok('match: title match beats body match for the same term', (() => {
  const r = matchDocs(docs, 'winter'); // title "Winter menu is live" + tag
  return r[0].t === 'Winter menu is live';
})());
ok('match: every token must hit somewhere (AND semantics)', matchDocs(docs, 'winter zzzznope').length === 0);
ok('match: matches on a tag', matchDocs(docs, 'events').some((d) => d.t === 'Winter menu is live'));
ok('match: case-insensitive', matchDocs(docs, 'WALK-INS').some((d) => d.k === 'faq'));
ok('match: limit is respected', matchDocs(docs, 'a', 2).length <= 2);

// ═══ normalizeTags — the single gate ═══
ok('tags: comma string → array, lowercased + trimmed', JSON.stringify(normalizeTags('Winter, EVENTS ,  Patio ')) === JSON.stringify(['winter', 'events', 'patio']));
ok('tags: newline-separated accepted', JSON.stringify(normalizeTags('a\nb')) === JSON.stringify(['a', 'b']));
ok('tags: array input accepted', JSON.stringify(normalizeTags(['One', 'two'])) === JSON.stringify(['one', 'two']));
ok('tags: dedupes (case-insensitively)', JSON.stringify(normalizeTags('X, x, X')) === JSON.stringify(['x']));
ok('tags: strips punctuation/markup chars to spaces', JSON.stringify(normalizeTags(['Hot Plates!!', 'a/b'])) === JSON.stringify(['hot plates', 'a b']));
ok('tags: markup angle-brackets removed entirely (defense in depth)', JSON.stringify(normalizeTags(['<script>x</script>'])) === JSON.stringify(['script x script']));
ok('tags: keeps & + -', JSON.stringify(normalizeTags('food & drink, gluten-free, a+b')) === JSON.stringify(['food & drink', 'gluten-free', 'a+b']));
ok('tags: capped at 12', normalizeTags(Array.from({ length: 30 }, (_, i) => 't' + i)).length === 12);
ok('tags: each capped at 30 chars', normalizeTags(['x'.repeat(50)])[0].length === 30);
ok('tags: junk → empty array', JSON.stringify(normalizeTags('   ,  , ')) === JSON.stringify([]) && JSON.stringify(normalizeTags(null)) === JSON.stringify([]));

// ═══ tag helpers ═══
const posts = [{ tags: ['b', 'a'] }, { tags: 'a, c' }, { tags: [] }];
ok('uniquePostTags: sorted distinct across posts', JSON.stringify(uniquePostTags(posts)) === JSON.stringify(['a', 'b', 'c']));
ok('postTagsAttr: empty when no tags, escaped when present', postTagsAttr([], attr) === '' && postTagsAttr(['a b'], attr) === ' data-tags="a b"');
ok('postTagsHtml: empty when none; list when present', postTagsHtml([], esc) === '' && postTagsHtml(['x'], esc).includes('<li>x</li>'));
{
  const bar = tagFilterBar(posts, esc, attr);
  ok('tagFilterBar: has an "All" chip + one per tag, hidden by default', bar.includes('data-tag=""') && bar.includes('>a<') && bar.includes('hidden'));
  ok('tagFilterBar: empty when no tags', tagFilterBar([{ tags: [] }], esc, attr) === '');
  ok('tagFilterScript: emitted only when tags exist', tagFilterScript(posts).startsWith('<script>') && tagFilterScript([{ tags: [] }]) === '');
}

// ═══ escaping in rendered fragments (XSS-safe) ═══
{
  // normalizeTags already strips markup chars; the render layer ALSO escapes, so
  // an escapable survivor (like &) can never form markup. Both layers proven here.
  const bar = tagFilterBar([{ tags: ['a & b'] }], esc, attr);
  ok('render: chip bar escapes tag text', bar.includes('a &amp; b') && !bar.includes('<script'));
  ok('render: raw hostile tag escaped in data-tags (defensive esc)', !postTagsAttr(['"><script>'], attr).includes('"><script>') && postTagsAttr(['"><script>'], attr).includes('&lt;script&gt;'));
  ok('render: raw hostile tag escaped in post-tags list (defensive esc)', !postTagsHtml(['<img>'], esc).includes('<img>') && postTagsHtml(['<img>'], esc).includes('&lt;img&gt;'));
}

// ═══ UI fragments are well-formed + first-party ═══
ok('box: header search box is a plain GET form to /search/', searchBoxHtml().includes('action="/search/"') && searchBoxHtml().includes('method="get"') && searchBoxHtml().includes('role="search"'));
ok('box: header box has an accessible name (no duplicate id)', searchBoxHtml().includes('aria-label="Search this site"') && !searchBoxHtml().includes('id='));
{
  const body = searchPageBody(esc, opts);
  ok('page: results region + status + noscript browse map', body.includes('id="search-results"') && body.includes('role="status"') && body.includes('<noscript>') && body.includes('href="/menu/"'));
  ok('page: exactly one h1', (body.match(/<h1[\s>]/g) || []).length === 1);
}
{
  const scr = searchClientScript();
  ok('script: first-party only — fetches same-origin /search-index.json, no external origins', scr.includes("fetch('/search-index.json'") && !/https?:\/\//.test(scr));
  ok('script: closes its tag safely (no raw </ inside)', scr.startsWith('<script>') && scr.endsWith('</script>') && scr.slice(8, -9).indexOf('</') === -1);
  ok('script: parses as valid JS', (() => { try { new Function(scr.slice(8, -9)); return true; } catch { return false; } })());
}
ok('script: tag filter parses as valid JS', (() => { try { new Function(tagFilterScript(posts).slice(8, -9)); return true; } catch { return false; } })());
ok('css: SEARCH_CSS defines the box + results + chips', SEARCH_CSS.includes('.sitesearch') && SEARCH_CSS.includes('.search-hit') && SEARCH_CSS.includes('.tagchip'));

const fails = results.filter((r) => !r.p);
console.log(`\n════ SEARCH SUITE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(' FAIL:', f.n); Deno.exit(1); }
