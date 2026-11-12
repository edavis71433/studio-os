// ── Builder list item 156 (Nov 2026): a whole list of old page addresses at once ──
//   deno run --allow-read --allow-env --allow-net tests/presence/redirect_import_test.mjs
// Moving a client from another website: a pasted list or a CSV comes in at once, each
// line says what it will do before anything is saved, the old site's own page list can
// suggest the matches, and the rules publishing keeps (500 at most, no chains, no
// loops) hold, so an import never leaves a site that won't publish.
import * as R from '../../supabase/functions/presence/lib/redirect_import.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const rowOf = (plan, line) => plan.rows.find((r) => r.line === line);

// ── reading the list ──
{
  const { pairs, problems } = R.parseRedirectList('Old URL,New URL\n/about-us,/about/\n"/our menu",/menu/\n\n# a note\n/team\t/about/\n/contact-us -> /contact/\n/gallery  /photos/\n/lonely\n');
  ok('a spreadsheet heading is left out', pairs[0].from === '/about-us');
  ok('commas, quotes, tabs, arrows and spaces all split a line', pairs.map((p) => p.from + '>' + p.to).join(' | ') === '/about-us>/about/ | /our menu>/menu/ | /team>/about/ | /contact-us>/contact/ | /gallery>/photos/');
  ok('blank lines and # notes are skipped, and each pair keeps its line number', pairs.map((p) => p.line).join() === '2,3,6,7,8');
  ok('a line with one address says what it needs', problems.length === 1 && problems[0].line === 9 && /two addresses/.test(problems[0].reason));
  ok('a first line that is addresses is kept', R.parseRedirectList('/a/ /b/').pairs.length === 1);
  ok('a byte-order mark from Excel is ignored', R.parseRedirectList('﻿/a/,/b/').pairs[0].from === '/a/');
  ok('no more than 1,000 lines are read', R.parseRedirectList(Array.from({ length: 1200 }, (_, i) => `/p${i}/ /x/`).join('\n')).pairs.length === 1000);
}

// ── cleaning an old address ──
{
  const o = (v) => R.normalizeOldPath(v);
  ok('a full old address keeps its path', o('https://www.oldsite.com/About-Us').path === '/about-us/');
  ok('an address with no https:// is read too', o('oldsite.com/blog/first-post').path === '/blog/first-post/');
  ok('a file keeps its name, with no slash added', o('/menu.pdf').path === '/menu.pdf' && o('/services.html').path === '/services.html');
  ok('underscores and dots are fine', o('/Our_Team.php').path === '/our_team.php');
  ok('an address with a ? part is refused, saying why', !o('/page?id=4').ok && /\?/.test(o('/page?id=4').reason));
  ok('the old home page needs no forward', !o('https://oldsite.com/').ok && /home page/.test(o('/').reason));
  ok('dot and empty parts are refused', !o('/a/../b').ok && !o('/a//b').ok && !o('/./a').ok);
  ok('other kinds of address are refused', !o('mailto:x@y.z').ok && !o('').ok);
}

// ── cleaning where it goes ──
{
  const t = (v, h) => R.normalizeNewTarget(v, h);
  ok('a page here gets its slash', t('/Services').to === '/services/' && t('about').to === '/about/');
  ok('a full address on this site becomes its path', t('https://www.bakery.example/menu', ['bakery.example']).to === '/menu/');
  ok('another https site is kept as it is', t('https://booking.example/marlow').to === 'https://booking.example/marlow');
  ok('a plain http address elsewhere is refused', !t('http://elsewhere.example/x').ok);
  ok('a page anchor is kept', t('/about#team').to === '/about/#team');
}

// ── the plan ──
{
  const existing = [
    { id: 'r1', from_path: '/old-about/', to_path: '/about/' },
    { id: 'r2', from_path: '/specials/', to_path: '/menu/' },
    { id: 'r3', from_path: '/promo/', to_path: '/winter-menu/' },
  ];
  const own = ['/', '/about/', '/menu/', '/contact/', '/services/'];
  const list = [
    '/about-us /about/',            // 1 new
    '/specials /services/',         // 2 replaces r2
    '/old-about /about/',           // 3 already there
    '/about /contact/',             // 4 an own page: skipped
    '/loop /loop/',                 // 5 points at itself
    '/about-us /contact/',          // 6 listed twice
    '/winter-menu /menu/',          // 7 new, and r3 (→ /winter-menu/) now goes straight to /menu/
    '/a /b/', '/b /a/',             // 8, 9 a circle between the two
    '/gift-cards /gifts/',          // 10 new, but not a page here yet
    '/press https://news.example/marlow',   // 11 new, to another site
    '/team /old-about/',            // 12 a chain into r1: goes straight to /about/
  ].join('\n');
  const { pairs, problems } = R.parseRedirectList(list);
  const plan = R.planImport({ pairs, problems, existing, ownPages: own });
  ok('a new old address is added', rowOf(plan, 1).verdict === 'add' && rowOf(plan, 1).from === '/about-us/' && rowOf(plan, 1).to === '/about/');
  ok('an address already forwarded elsewhere is replaced, saying from what', rowOf(plan, 2).verdict === 'replace' && /\/menu\//.test(rowOf(plan, 2).note));
  ok('the same forward again changes nothing', rowOf(plan, 3).verdict === 'same');
  ok('an address of a page here is skipped, so the page isn’t hidden', rowOf(plan, 4).verdict === 'skip' && /page on this site/.test(rowOf(plan, 4).reason));
  ok('a forward to itself is skipped', rowOf(plan, 5).verdict === 'skip' && /itself/.test(rowOf(plan, 5).reason));
  ok('a second line for the same old address is skipped, naming the first', rowOf(plan, 6).verdict === 'skip' && /line 1/.test(rowOf(plan, 6).reason));
  ok('a circle between two lines is skipped', [8, 9].some((l) => rowOf(plan, l).verdict === 'skip' && /circle/.test(rowOf(plan, l).reason)));
  ok('a target that isn’t a page yet is still added, and says so', rowOf(plan, 10).verdict === 'add' && /Not a page on this site yet/.test(rowOf(plan, 10).note));
  ok('another https site is a fine target', rowOf(plan, 11).verdict === 'add' && rowOf(plan, 11).to === 'https://news.example/marlow');
  ok('a line into another forward goes straight to the final page', rowOf(plan, 12).verdict === 'add' && rowOf(plan, 12).to === '/about/' && /straight to \/about\//.test(rowOf(plan, 12).note));
  ok('an older forward landing on a newly forwarded address is pointed at the final page', plan.repoint.length === 1 && plan.repoint[0].id === 'r3' && plan.repoint[0].to === '/menu/');
  ok('in a circle the first line is skipped and the second, now alone, comes in', rowOf(plan, 8).verdict === 'skip' && rowOf(plan, 9).verdict === 'add');
  ok('the counts add up', plan.add === 6 && plan.replace === 1 && plan.same === 1 && plan.skipped === plan.rows.filter((r) => r.verdict === 'skip').length && plan.total_after === existing.length + 6, JSON.stringify({ add: plan.add, replace: plan.replace, same: plan.same, skipped: plan.skipped }));
  // the result keeps publishing's own rules: no forward lands on another forward's old address
  const after = new Map(existing.map((e) => [e.from_path, e.to_path]));
  for (const r of plan.rows) if (r.verdict === 'add' || r.verdict === 'replace') after.set(r.from, r.to);
  for (const x of plan.repoint) { const e = existing.find((y) => y.id === x.id); after.set(e.from_path, x.to); }
  ok('after the import, no forward chains into another and none points at itself', [...after].every(([f, t]) => t !== f && !(t.startsWith('/') && after.has(t.split('#')[0]))));
}

// ── the cap ──
{
  const existing = Array.from({ length: 498 }, (_, i) => ({ id: 'e' + i, from_path: `/old-${i}/`, to_path: '/' }));
  const plan = R.planImport({ ...R.parseRedirectList('/x1 /a/\n/x2 /a/\n/x3 /a/\n/old-1 /b/'), existing, ownPages: ['/', '/a/', '/b/'] });
  ok('the 500 limit counts what’s there: two more fit, the third is skipped', plan.add === 2 && plan.rows.filter((r) => r.verdict === 'skip' && /500/.test(r.reason)).length === 1);
  ok('replacing one already there still fits at the limit', plan.replace === 1);
  ok('the limit is publishing’s own', R.REDIRECT_CAP === 500 && /> 500/.test(read('supabase/functions/presence/lib/manifest_validate.ts')));
}

// ── suggestions from the old website's page list ──
{
  const pages = [{ path: '/', title: 'Home' }, { path: '/about/', title: 'About' }, { path: '/menu/', title: 'Menu' }, { path: '/contact/', title: 'Contact' }, { path: '/updates/', title: 'Updates' }, { path: '/catering-orders/', title: 'Catering orders' }];
  const s = R.suggestTargets(['/about-us', '/our-menu', '/contact-us', '/catering', '/blog/fresh-bread-day', '/careers', '/menu/', '/About-Us'], pages);
  const to = (f) => (s.find((x) => x.from === f) || {}).to;
  ok('the usual names match their page: about-us, our-menu, contact-us', to('/about-us/') === '/about/' && to('/our-menu/') === '/menu/' && to('/contact-us/') === '/contact/');
  ok('a shared word is enough (catering → Catering orders)', to('/catering/') === '/catering-orders/');
  ok('an old blog post goes to Updates', to('/blog/fresh-bread-day/') === '/updates/');
  ok('no close match goes home, marked unsure', to('/careers/') === '/' && s.find((x) => x.from === '/careers/').sure === false);
  ok('an address the new site already has is left out', !s.some((x) => x.from === '/menu/'));
  ok('each old address once', s.filter((x) => x.from === '/about-us/').length === 1);
  const sm = R.sitemapLocs('<?xml version="1.0"?><urlset><url><loc>https://old.example/a</loc></url><url><loc> https://old.example/b?x=1&amp;y=2 </loc></url></urlset>');
  ok('a sitemap’s page addresses are read', sm.pages.length === 2 && sm.pages[1] === 'https://old.example/b?x=1&y=2' && !sm.children.length);
  const ix = R.sitemapLocs('<sitemapindex><sitemap><loc>https://old.example/pages-sitemap.xml</loc></sitemap></sitemapindex>');
  ok('a sitemap index names its child lists', ix.children.length === 1 && !ix.pages.length);
}

// ── the wiring ──
{
  const src = read('supabase/functions/presence/routes/search.ts');
  const idx = read('supabase/functions/presence/index.ts');
  ok('POST /redirects with a list goes to the import (the same edit route, nothing new to classify)', /if \(typeof b\?\.list === 'string'\) return importRedirects\(b, site, principal, cors\);/.test(src));
  ok('a check (dry_run) saves nothing', /if \(b\.dry_run === true\) return json\(\{ data: \{ \.\.\.plan, dry_run: true \} \}/.test(src));
  ok('the import saves in one upsert, marked as imported', /presence_redirects\?on_conflict=site_id,from_path[\s\S]{0,200}resolution=merge-duplicates/.test(src) && /source: 'import'/.test(src));
  ok('a failed read brings nothing in', /if \(!exQ\.ok \|\| !setQ\.ok\) return json\(\{ error: 'read_failed'/.test(src));
  ok('the list and the single add both allow 500', /limit=\$\{REDIRECT_CAP\}`\)/.test(src) && /length >= REDIRECT_CAP\)/.test(src) && !/capped at 50/.test(src));
  ok('the old site is read only through the public-address guard, and never this site itself', /assertPublicHttpUrl\(u\)/.test(src) && /fetchPublic\(/.test(src) && /error: 'same_site'/.test(src));
  ok('GET /redirects/suggest is a read, before the forward-by-id routes', /route === '\/redirects\/suggest' && method === 'GET'\) return handleRedirectSuggest/.test(idx) && idx.indexOf("'/redirects/suggest'") < idx.indexOf('route.match(/^\\/redirects\\/([0-9a-f-]{36})$/)'));
  const page = read('presence.html');
  ok('the editor checks the list first and brings in only what it checked', /api\("POST", "\/redirects", \{ list: text, dry_run: true \}\)/.test(page) && /api\("POST", "\/redirects", \{ list: checked \}\)/.test(page) && /checked !== ta\.value/.test(page));
  ok('it reads the old site’s pages through the suggest route', /api\("GET", "\/redirects\/suggest\?from=" \+ encodeURIComponent\(v\)\)/.test(page));
}

const passed = results.filter((x) => x.p).length;
console.log(`\n════ BULK FORWARDS (item 156): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
