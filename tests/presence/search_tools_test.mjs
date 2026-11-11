// ── Builder list items 124 and 181: the Search tab's tools, to-do list and followed searches ──
//   deno run --allow-read --allow-env tests/presence/search_tools_test.mjs
// Hide from search (every page noindex, robots.txt left open), llms.txt (the owner's,
// published at /llms.txt; a first draft from the details), the ranked to-do list with
// done dots, the pages that moved most, and up to ten followed searches with their
// months from Search Console. Nothing changes on a site that uses none of it. No
// Supabase and no Google are touched.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const T = await import(`${P}/lib/search_tools.ts`);
const G = await import(`${P}/lib/gsc.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── 1. Hide from search and llms.txt ──
{
  const files = { 'index.html': '<!doctype html><html><head><title>A</title></head><body>x</body></html>', 'about/index.html': '<html><head lang="en"><meta name="robots" content="noindex"></head></html>', 'robots.txt': 'User-agent: *\nAllow: /\n', 'style.css': 'body{}' };
  ok('choices: none set draws the very same files', T.withSearchChoices(files, {}) === files && T.withSearchChoices(files, undefined) === files);
  const hid = T.withSearchChoices(files, { search_hidden: true });
  ok('hide: every page asks not to be listed, once', /<head>\n<meta name="robots" content="noindex">/.test(hid['index.html']) && (hid['about/index.html'].match(/noindex/g) || []).length === 1);
  eq('hide: robots.txt stays open, so search engines can read the noindex', hid['robots.txt'], files['robots.txt']);
  eq('hide: other files untouched', hid['style.css'], 'body{}');
  ok('hide: the drawn files are not changed in place', !/noindex/.test(files['index.html']));
  const llms = T.withSearchChoices(files, { llms_txt: '# Maple & Main\n\n> Homes in Burbank.' });
  eq('llms: the owner’s words at /llms.txt', llms['llms.txt'], '# Maple & Main\n\n> Homes in Burbank.\n');
  eq('llms: capped at 4,000 characters', T.withSearchChoices(files, { llms_txt: 'x'.repeat(5000) })['llms.txt'].length, 4001);
  const draft = T.draftLlmsTxt({ name: 'Maple & Main Realty', origin: 'https://maple.example/', description: 'A Burbank real estate office.', city: 'Burbank', region: 'CA', phone: '(555) 010-0199', email: 'hello@maple.example', street: '12 Main St', postal: '91502', pages: [{ title: 'Home', path: '/' }, { title: 'Listings', path: '/listings/' }, { title: 'Bad', path: 'javascript:x' }] });
  ok('draft: the name, a one-line summary, contact and pages', draft.startsWith('# Maple & Main Realty\n\n> A Burbank real estate office.') && draft.includes('- Phone: (555) 010-0199') && draft.includes('- Address: 12 Main St, Burbank, CA, 91502') && draft.includes('- [Listings](https://maple.example/listings/)'));
  ok('draft: only real page paths', !draft.includes('javascript'));
  eq('draft: with nothing, still a sentence', T.draftLlmsTxt({ name: '', origin: '' }), '# Our business\n\n> Our business.');
  const src = { render: read(`${P}/lib/render.ts`), ser: read(`${P}/lib/serializer.ts`), content: read(`${P}/routes/content.ts`), diff: read(`${P}/lib/diff.ts`) };
  ok('render: applied once after the AI crawler choice, before the phone bar', /const searched = withSearchChoices\(drawn, \(snapshot\.content as SnapshotContent\)\?\.settings\);/.test(src.render) && /applyPhoneBar\(searched,/.test(src.render));
  ok('snapshot: only a set choice reaches it, so other sites’ snapshots are unchanged', /\.\.\.\(settings\.search_hidden === true \? \{ search_hidden: true \} : \{\}\)/.test(src.ser) && /String\(settings\.llms_txt \|\| ''\)\.trim\(\) \? \{ llms_txt:/.test(src.ser));
  ok('settings: a yes/no and up to 4,000 characters, stepping down without 0171 first', /search_hidden: \{ kind: 'bool' \}, llms_txt: \{ max: 4000 \}/.test(src.content) && /SEARCH_SETTINGS_COLS = 'search_hidden,llms_txt'/.test(src.content) && /OPTIONAL_SETTINGS_COLS = \[SEARCH_SETTINGS_COLS, (?:[A-Z_]+_SETTINGS_COLS, )*CRAWLER_SETTINGS_COLS,/.test(src.content) && /\+ ',' \+ SEARCH_SETTINGS_COLS,/.test(src.content));
  ok('publish review: says what each change does', /hidden from search engines: every page asks Google and Bing not to list it/.test(src.diff) && /Your llms\.txt for AI tools is updated\./.test(src.diff));
  for (const [name, sql] of [['migration', read('../../supabase/migrations/0171_search_tools.sql')], ['pack', read('../../docs/presence/APPLY-0171-prod.sql')]]) {
    ok(`${name}: hidden off by default, llms.txt empty and capped`, /add column if not exists search_hidden boolean not null default false;/.test(sql) && /add column if not exists llms_txt text;/.test(sql) && /check \(llms_txt is null or char_length\(llms_txt\) <= 4000\)/.test(sql) && /drop constraint if exists presence_settings_llms_txt_len;/.test(sql));
  }
}

// ── 2. the to-do list ──
{
  const base = { edition: 'presence', live: true, customDomain: true, hidden: false, console: true, listing: true, title: true, description: true, llms: true, followed: 2, issues: [], review: [] };
  const done = T.searchTasks(base);
  ok('tasks: all done is a list of green dots', done.length && done.every((t) => t.done && t.go === null));
  const t = T.searchTasks({ ...base, live: false, customDomain: false, console: false, listing: false, description: false, llms: false, followed: 0,
    issues: [{ type: 'links.internal_broken', severity: 'critical', n: 2 }, { type: 'seo.description_missing', severity: 'warning', n: 3 }, { type: 'accessibility.img_alt_missing', severity: 'warning', n: 12 }, { type: 'seo.h1_missing', severity: 'warning', n: 1 }, { type: 'performance.image_oversized', severity: 'warning', n: 4 }],
    review: [{ title: 'Your phone number isn’t tappable', priority: 'Fix now', fix: 'Add it in Business.' }, { title: 'No reviews on the site', priority: 'Later', fix: '' }] });
  const open = t.filter((x) => !x.done);
  eq('tasks: open first, Critical, then High, then Medium', [...new Set(open.map((x) => x.priority))], ['critical', 'high', 'medium']);
  ok('tasks: done ones after every open one', t.findIndex((x) => x.done) > t.findLastIndex((x) => !x.done));
  eq('tasks: critical ones', open.filter((x) => x.priority === 'critical').map((x) => x.key), ['publish', 'health:links.internal_broken']);
  ok('tasks: the counts are in the words', open.some((x) => x.title === 'Add a search description to 3 pages') && open.some((x) => x.title === 'Describe 12 photos for Google'));
  ok('tasks: the Site Review’s findings join, Fix now as High', open.some((x) => x.priority === 'high' && x.title === 'Your phone number isn’t tappable') && open.some((x) => x.priority === 'medium' && x.title === 'No reviews on the site'));
  ok('tasks: a speed problem isn’t a Search task', !t.some((x) => x.key === 'health:performance.image_oversized'));
  ok('tasks: following searches waits for Search Console', !t.some((x) => x.key === 'follow'));
  ok('tasks: each open task says where to go', open.every((x) => x.go));
  const watch = T.searchTasks({ ...base, edition: 'monitor', customDomain: false });
  ok('tasks: a site we only watch is never told to publish or move its domain', !watch.some((x) => x.key === 'publish' || x.key === 'domain'));
  const hidden = T.searchTasks({ ...base, hidden: true, issues: [{ type: 'seo.noindex', severity: 'warning', n: 9 }] });
  ok('tasks: hidden on purpose is one Critical task, not nine noindex warnings', hidden[0].key === 'hidden' && !hidden.some((x) => x.key === 'health:seo.noindex'));
}

// ── 3. the pages that moved most ──
{
  const now = [{ path: '/listings/', clicks: 28 }, { path: '/sell/', clicks: 14 }, { path: '/new/', clicks: 3 }, { path: '/about/', clicks: 3 }];
  const before = [{ path: '/listings/', clicks: 16 }, { path: '/sell/', clicks: 7 }, { path: '/about/', clicks: 8 }, { path: '/blog/', clicks: 9 }];
  const m = T.pageMovers(now, before);
  eq('movers: the biggest rises', m.up.map((x) => [x.path, x.delta]), [['/listings/', 12], ['/sell/', 7], ['/new/', 3]]);
  eq('movers: the biggest falls, a page gone counts as none', m.down.map((x) => [x.path, x.clicks, x.prior]), [['/blog/', 0, 9], ['/about/', 3, 8]]);
}

// ── 4. followed searches ──
{
  eq('follow: one spelling, as Google writes queries', T.followTerm('  Burbank   REALTOR\n'), 'burbank realtor');
  const n = T.normalizeFollowed({ terms: [{ term: 'a' }, { term: 'A ' }, ...Array.from({ length: 14 }, (_, i) => ({ term: `t${i}` }))] });
  eq('follow: each once, ten at most', [n.terms.length, n.terms[0].term, n.terms[1].term], [10, 'a', 't0']);
  const cur = { terms: [{ term: 'burbank realtor', added_at: '2026-10-01T00:00:00Z', added_by: 'a@x' }] };
  const r = T.applyFollow(cur, ['Burbank realtor', 'homes for sale burbank'], 'b@x', '2026-11-11T00:00:00Z');
  eq('follow: keeps when each was first followed, and says what is new', [r.terms[0].added_at, r.terms[1].added_by, r.added], ['2026-10-01T00:00:00Z', 'b@x', ['homes for sale burbank']]);
  ok('follow: more than ten is refused, in words', 'error' in T.applyFollow(cur, Array.from({ length: 11 }, (_, i) => `t${i}`), null, '') && 'error' in T.applyFollow(cur, 'nope', null, ''));
  const series = T.followedSeries(cur.terms, [{ key: 'burbank realtor', period: '2026-10', clicks: 18, impressions: 300, position: 4.04 }, { key: 'burbank realtor', period: '2026-09', clicks: 12, impressions: 280, position: 6.2 }, { key: 'other', period: '2026-10', clicks: 1, impressions: 1, position: 1 }], '2026-10', '2026-09');
  eq('follow: months oldest first, the last two compared, place to one decimal', [series[0].months.map((m) => m.period), series[0].now.position, series[0].prior.clicks], [['2026-09', '2026-10'], 4, 12]);
  eq('follow: a month it didn’t show is missing, not a zero place', T.followedSeries([{ term: 'x', added_at: '', added_by: null }], [], '2026-10', '2026-09')[0], { term: 'x', added_at: '', months: [], now: null, prior: null });
  const body = G.gscTermBody('2026-10-01', '2026-10-31', 'burbank realtor', ['date'], 250);
  eq('gsc: asked for by name, exactly', body.dimensionFilterGroups, [{ filters: [{ dimension: 'query', operator: 'equals', expression: 'burbank realtor' }] }]);
  eq('gsc: days folded into months, the place weighted by times seen', G.foldDaysToMonths({ rows: [{ keys: ['2026-09-30'], clicks: 1, impressions: 10, position: 8 }, { keys: ['2026-10-01'], clicks: 2, impressions: 30, position: 4 }, { keys: ['2026-10-02'], clicks: 1, impressions: 10, position: 8 }, { keys: ['2026-08-01'], clicks: 0, impressions: 0, position: 50 }] }), [{ period: '2026-09', clicks: 1, impressions: 10, position: 8 }, { period: '2026-10', clicks: 3, impressions: 40, position: 5 }]);
  const sync = read(`${P}/ops/gsc_sync.ts`);
  ok('sync: a followed search outside the top 25 gets its own month, asked for by name', /if \(dim === 'query'\) await syncFollowed\(site, prop, startDate, endDate, period, new Set\(terms\.map\(\(t\) => t\.key\)\), tokenState\)/.test(sync) && /if \(have\.has\(t\.term\)\) continue;/.test(sync) && /gscTermBody\(startDate, endDate, t\.term, \['query'\], 1\)/.test(sync));
  ok('sync: a new search gets six months by day, never overwriting a kept month', /gscBackMonths\(now, 5\)/.test(sync) && /gscTermBody\(first\.startDate, last\.endDate, term, \['date'\], 250\)/.test(sync) && /resolution=ignore-duplicates/.test(sync));
}

// ── 5. the routes, against a stubbed database ──
{
  const SITE = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222', status: 'live', last_published_at: '2026-06-01T00:00:00Z', template_slug: 'x', template_version: '1', custom_domain: 'maple.example', netlify_site_id: 'n', edition: 'presence' };
  let stored = null, settingsReady = true, writes = [];
  const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search); const m = (init.method || 'GET').toUpperCase();
    if (table === 'presence_sales_templates') {
      if (m === 'GET') return reply(stored ? [{ id: 'r1', body: JSON.stringify(stored), updated_at: '2026-11-11T00:00:00Z' }] : []);
      writes.push({ m, body: JSON.parse(init.body) });
      stored = JSON.parse(JSON.parse(init.body).body);
      return reply([{ id: 'r1' }], 201);
    }
    if (table === 'presence_settings') { if (/search_hidden/.test(q) && !settingsReady) return reply({ code: '42703' }, 400); return reply([{ google_site_verification: 'abc', bing_site_verification: '', search_hidden: true, llms_txt: '# x', pages: [{ slug: 'listings', title: 'Listings' }, { slug: 'secret', title: 'Secret' }], pages_noindex: ['page:secret'] }]); }
    if (table === 'presence_identity') return reply([{ business_name: 'Maple & Main Realty', seo_title: 'Maple', seo_description: '', phone: '(555) 010-0199' }]);
    if (table === 'presence_locations') return reply([{ city: 'Burbank', region: 'CA' }]);
    if (table === 'presence_redirects') return reply([{ id: 1 }, { id: 2 }, { id: 3 }]);
    if (table === 'presence_health_days') return reply([{ day: '2026-11-11', issues: [{ type: 'seo.description_missing', severity: 'warning', n: 3 }] }]);
    if (table === 'signals') return reply([{ period: '2026-10' }]);
    if (table === 'presence_connections') return reply([{ status: 'connected' }]);
    if (table === 'presence_search_terms') {
      if (/dimension=eq\.page/.test(q)) return reply(/period=eq\.2026-10/.test(q) ? [{ key: 'https://maple.example/listings/', clicks: 28, impressions: 400 }] : [{ key: 'https://maple.example/listings/', clicks: 16, impressions: 300 }]);
      if (/key=in\./.test(q)) return reply([{ key: 'burbank realtor', period: '2026-10', clicks: 18, impressions: 300, position: 4 }]);
      return reply([{ key: 'burbank realtor', clicks: 18, impressions: 300 }, { key: 'realtor near me', clicks: 3, impressions: 42 }]);
    }
    return reply([]);
  };
  const S = await import(`${P}/routes/search_tab.ts`);
  const x = await S.searchTabExtras(SITE, { address: { url: 'https://maple.example/' }, consoleConnected: true, listingConnected: false, period: '2026-10', review: null });
  eq('extras: the tools row', [x.tools.ready, x.tools.redirects, x.tools.verification, x.tools.sitemap, x.tools.llms.set, x.tools.llms.url, x.tools.hidden], [true, 3, { google: true, bing: false }, 'https://maple.example/sitemap.xml', true, 'https://maple.example/llms.txt', true]);
  ok('extras: the to-do list from what the tab knows', x.tasks[0].key === 'hidden' && x.tasks.some((t) => t.title === 'Add a search description to 3 pages') && x.tasks.some((t) => t.key === 'listing' && !t.done));
  eq('extras: the pages that moved', x.movers.up.map((m) => [m.path, m.delta]), [['/listings/', 12]]);
  settingsReady = false;
  const before = await S.searchTabExtras(SITE, { address: null, consoleConnected: false, listingConnected: false, period: null, review: null });
  eq('extras: before 0171 the tools row says it isn’t ready, nothing else breaks', [before.tools.ready, before.tools.verification.google, before.movers], [false, true, null]);
  settingsReady = true;
  const put = await S.handleFollowPut(new Request('http://x', { method: 'PUT', body: JSON.stringify({ terms: ['Burbank Realtor'] }) }), SITE, { email: 'owner@x' }, {});
  const pj = await put.json();
  eq('follow: saved, with its month and the suggestions not followed', [put.status, stored.terms[0].term, pj.data.terms[0].now.clicks, pj.data.suggestions.map((s) => s.term), pj.data.added], [200, 'burbank realtor', 18, ['realtor near me'], ['burbank realtor']]);
  const bad = await S.handleFollowPut(new Request('http://x', { method: 'PUT', body: JSON.stringify({ terms: Array.from({ length: 11 }, (_, i) => `t${i}`) }) }), SITE, { email: 'owner@x' }, {});
  eq('follow: eleven is refused and nothing is saved', [bad.status, stored.terms.length], [400, 1]);
  const d = await (await S.handleLlmsDraft(SITE, {})).json();
  ok('llms draft: from the details and the pages, leaving out a hidden page', d.data.text.startsWith('# Maple & Main Realty') && d.data.text.includes('[Listings](https://maple.example/listings/)') && !d.data.text.includes('Secret') && d.data.max === 4000);
  const idx = read(`${P}/index.ts`), roles = read(`${P}/lib/site_roles.ts`);
  ok('routes: wired under /visibility (search works whoever hosts the site)', /route === '\/visibility\/follow' && method === 'PUT'\) return handleFollowPut\(req, site, principal, cors\)/.test(idx) && /route === '\/visibility\/llms-draft' && method === 'GET'\)/.test(idx));
  ok('routes: following a search is an edit for a member', /'PUT \/visibility\/follow',/.test(roles));
  eq('months: the month before, over a new year', [S.monthBefore('2026-10'), S.monthBefore('2026-01')], ['2026-09', '2025-12']);
}

const failed = results.filter((r) => !r.p).length;
console.log(`search_tools: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
