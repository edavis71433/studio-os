// ── Builder list item 211: a published page has a weight limit ──────────────────
// Review file 01, finding 1: a Squarespace home page is 1.26 MB in 58 requests; a page
// Studio OS publishes is about 25 kB. The limit keeps it that way: every page of every
// template, drawn the way a publish draws it, weighs at most PAGE_WEIGHT_LIMIT_KB with
// the style sheets and scripts it loads (photos wait until scrolled to, so they're out),
// for three samples:
//   · the template's own sample business (a typical site): under TYPICAL_PAGE_KB too
//   · the full sample: one of every section the builder offers (full_fixture.mjs)
//   · a site filled to the caps: 80 menu items, 50 posts, 20 FAQs, 12 testimonials
// Each template's heaviest page is printed, so a change that adds weight shows here first.
//
//   deno run --allow-read --allow-env tests/presence/page_weight_211_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { pageWeights, PAGE_WEIGHT_LIMIT_KB, TYPICAL_PAGE_KB } from '../../supabase/functions/presence/lib/page_weight.ts';
import { TEMPLATES, fixture, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
// as a publish calls it: the form, booking and counter addresses on, so their scripts are drawn
const SITE = { baseUrl: 'https://example-site.example', siteId: '11111111-1111-4111-8111-111111111111', formEndpoint: 'https://fn.example/functions/v1/presence/forms/x/submit', bookEndpoint: 'https://fn.example/functions/v1/presence/book/x' };
const kB = (b) => (b / 1024).toFixed(1);

function maxedOf(slug) {
  const snap = structuredClone(fixture(slug));
  const c = snap.content;
  while (c.offerings.length < 80) c.offerings.push({ id: 'm' + c.offerings.length, name: `Item number ${c.offerings.length} with a reasonably long name`, category: 'Section ' + (c.offerings.length % 8), description: 'A full description of this item, about as long as owners write them.', price_text: '$' + (10 + (c.offerings.length % 30)) });
  while (c.faqs.length < 20) c.faqs.push({ id: 'mf' + c.faqs.length, question: `Question number ${c.faqs.length}?`, answer: 'A plain answer that runs a sentence or three, giving customers what they need to know. '.repeat(2) });
  while (c.testimonials.length < 12) c.testimonials.push({ id: 'mt' + c.testimonials.length, quote: 'Wonderful from start to finish, we will absolutely be back with friends.', author: 'Customer ' + c.testimonials.length });
  while (c.posts.length < 50) c.posts.push({ id: 'mp' + c.posts.length, title: `Update number ${c.posts.length}`, slug: `update-${c.posts.length}`, body_md: 'A paragraph of news.\n\n## Details\n\n- one point\n- another\n\n**Bold** closing line.\n'.repeat(6), published_at: '2026-03-01T00:00:00Z' });
  return snap;
}

const LIMIT = PAGE_WEIGHT_LIMIT_KB * 1024, TYPICAL = TYPICAL_PAGE_KB * 1024;
ok('the limit is about 100 kB, as the list says', PAGE_WEIGHT_LIMIT_KB === 100);
for (const slug of TEMPLATES) {
  const line = [];
  for (const [label, snap, cap] of [['sample', fixture(slug), TYPICAL], ['full', fullFixture(slug), LIMIT], ['to the caps', maxedOf(slug), LIMIT]]) {
    const pages = pageWeights(await renderSnapshot(snap, SITE));
    const top = pages[0];
    const over = pages.filter((p) => p.bytes > cap);
    line.push(`${label} ${top.path} ${kB(top.bytes)} kB`);
    ok(`${slug}, ${label}: every page under ${cap / 1024} kB`, pages.length > 3 && over.length === 0, over.map((p) => `${p.path} ${kB(p.bytes)} kB`).join(', ') || `${pages.length} pages`);
    ok(`${slug}, ${label}: the heaviest page's style sheet is counted in it`, top.parts.some((x) => x.endsWith('.css')), top.parts.join());
  }
  console.log(`      heaviest: ${line.join(' · ')}`);
}

// the weight is what the page names from the site, no more
{
  const files = { 'index.html': '<link href="/assets/a.css"><script src="/assets/b.js"></script><img src="/img/x-800.webp"><link href="https://cdn.example/c.css">', 'assets/a.css': 'x'.repeat(1000), 'assets/b.js': 'y'.repeat(500), 'img/x-800.webp': new Uint8Array(50_000), 'about/index.html': '<p>hi</p>' };
  const w = pageWeights(files);
  ok('weight: the page plus its own style sheet and script; photos and other hosts are left out', w[0].path === 'index.html' && w[0].bytes === files['index.html'].length + 1500 && w[0].parts.join() === 'assets/a.css,assets/b.js', JSON.stringify(w[0]));
  ok('weight: heaviest first', w.length === 2 && w[1].path === 'about/index.html' && w[1].bytes === 9);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
