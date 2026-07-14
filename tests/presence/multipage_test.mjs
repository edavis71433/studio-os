// ── Multi-page render test ───────────────────────────────────────────────────
// Proves owner-created pages (settings.pages) render as first-class pages across
// EVERY template: their own file + <h1> title, their blocks, the shared shell,
// a nav link on the home page, and a sitemap entry. Plus hostile-escape +
// determinism. Pure local run (no network). The render goldens already prove that
// WITHOUT custom pages the output is byte-identical.
//
//   deno run --allow-read tests/presence/multipage_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://example.test', brand: { credit: 'Site by Davis Digital Studio' } };
const TEMPLATES = ['business-classic', 'editorial', 'restaurant-classic'];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL → ' + n); } };

for (const slug of TEMPLATES) {
  const fixture = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const withPage = structuredClone(fixture);
  withPage.content.settings = withPage.content.settings || {};
  // Two custom pages: a valid one, and one whose slug would collide with a nav key.
  withPage.content.settings.pages = [
    { slug: 'our-team', title: 'Our Team', blocks: [{ type: 'features', title: 'Meet the crew', items: [{ title: 'Jane Doe', text: 'Head chef' }] }] },
    { slug: 'partners-page', title: 'Partners', blocks: [{ type: 'richtext', title: 'Our partners', body: 'We work with **great** people.' }] },
  ];
  const out = renderSnapshot(withPage, SITE);

  ok(`[${slug}] custom page renders its own file`, typeof out['our-team/index.html'] === 'string' && out['our-team/index.html'].length > 0);
  const pg = out['our-team/index.html'] || '';
  ok(`[${slug}] custom page shows its title as an <h1>`, pg.includes('<h1>Our Team</h1>'));
  ok(`[${slug}] custom page renders its blocks`, pg.includes('block-features') && pg.includes('Meet the crew') && pg.includes('Jane Doe'));
  ok(`[${slug}] custom page shares the site shell (header + footer)`, pg.includes('<header class="site"') && pg.includes('<footer class="site"'));
  ok(`[${slug}] a custom page joins the nav on the home page`, out['index.html'].includes('href="/our-team/"') && out['index.html'].includes('Our Team') && out['index.html'].includes('href="/partners-page/"'));
  ok(`[${slug}] custom pages are in the sitemap`, out['sitemap.xml'].includes('/our-team/') && out['sitemap.xml'].includes('/partners-page/'));
  ok(`[${slug}] the second custom page also renders`, (out['partners-page/index.html'] || '').includes('<strong>great</strong>'));

  // hostile content in a custom page must be escaped, never executable
  const hostile = structuredClone(fixture);
  hostile.content.settings = hostile.content.settings || {};
  hostile.content.settings.pages = [{ slug: 'x', title: '<script>alert(1)</script>', blocks: [{ type: 'features', items: [{ title: '<script>bad()</script>' }] }] }];
  const hpg = renderSnapshot(hostile, SITE)['x/index.html'] || '';
  ok(`[${slug}] custom page escapes hostile title + block content`, !hpg.includes('<script>alert') && !hpg.includes('<script>bad') && hpg.includes('&lt;script&gt;'));

  // determinism
  ok(`[${slug}] custom pages render deterministically`, renderSnapshot(withPage, SITE)['our-team/index.html'] === out['our-team/index.html']);

  // no custom pages → the custom file is absent (single-page unchanged)
  ok(`[${slug}] without custom pages, no extra page file appears`, typeof renderSnapshot(fixture, SITE)['our-team/index.html'] === 'undefined');
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  multi-page render — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ MULTI-PAGE GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
