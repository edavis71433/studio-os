// ── Builder list item 219: near-miss searches, why visits fell, clicks to contact ──
//   deno run --allow-read --allow-env tests/presence/near_miss_219_test.mjs
// Search Console's search-and-page pairs kept as 'query_page' (migration 0220); the
// searches Google showed a site for at places 8 to 20, each with its page and one thing
// to fix there, checked against the page's own headline; the likely reason a month's
// visits fell; and the monthly report's phone and email taps (item 381's words). No Supabase and no Google
// are touched: the reads run against a stubbed database.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const G = await import(`${P}/lib/gsc.ts`);
const N = await import(`${P}/lib/near_miss.ts`);
const V = await import(`${P}/lib/visit_drop.ts`);
const R = await import(`${P}/ops/monthly_report.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── 1. the pairs Search Console gives, kept whole ──
{
  eq('pair: a search and its page as one key, and back', G.splitPairKey(G.pairKey('homes  for sale burbank', 'https://maple.example/listings/')), { query: 'homes for sale burbank', page: 'https://maple.example/listings/' });
  ok('pair: spaces in a search are one space; a tab in the page, or nothing, is no key', G.pairKey('a\tb', 'https://x/') === 'a b\thttps://x/' && G.pairKey('a', 'https://x/\ty') === '' && G.pairKey('', 'https://x/') === '' && G.pairKey('a', '') === '');
  ok('pair: one that would not fit whole is left out, never cut', G.pairKey('q', 'https://x.example/' + 'a'.repeat(400)) === '');
  eq('pair: a key without its page reads as nothing', [G.splitPairKey('no tab'), G.splitPairKey('\tpage'), G.splitPairKey('q\t')], [null, null, null]);
  const resp = { rows: [
    { keys: ['realtor near me', 'https://maple.example/'], clicks: 9, impressions: 2100, position: 14.2 },
    { keys: ['realtor near me', 'https://maple.example/'], clicks: 1, impressions: 3, position: 14.2 },
    { keys: ['far away', 'https://maple.example/x/'], clicks: 0, impressions: 50, position: 41 },
    { keys: ['no page'], clicks: 1, impressions: 2, position: 3 },
  ] };
  const parsed = G.parsePairRows(resp);
  eq('pair: rows read as search, page and numbers; a row without a page is dropped', parsed.map((r) => [r.query, r.page, r.position]), [['realtor near me', 'https://maple.example/', 14.2], ['realtor near me', 'https://maple.example/', 14.2], ['far away', 'https://maple.example/x/', 41]]);
  const store = G.pairRowsToStore('c1', '2026-10', parsed);
  eq('pair: kept once each, within place 30, as query_page', store.map((r) => [r.dimension, r.key, r.position]), [['query_page', 'realtor near me\thttps://maple.example/', 14.2]]);
  const sync = read(`${P}/ops/gsc_sync.ts`);
  ok('sync: asks for the search and the page together, 250 rows', /gscQueryBody\(startDate, endDate, \['query', 'page'\], PAIR_ROWS\)/.test(sync));
  ok('sync: the pairs are a write of their own, refused quietly before 0220', /pairRowsToStore\(site\.client_id, period, parsePairRows\(pairs\.json\)\)/.test(sync) && /\.catch\(\(\) => \{\}\);\n  \}\n/.test(sync.slice(sync.indexOf('pairRowsToStore('))));
  const mig = read('../../supabase/migrations/0220_search_page_pairs.sql'), pack = read('../../docs/presence/APPLY-0220-prod.sql');
  ok('0220: the check keeps every dimension it had and adds query_page', /check \(dimension in \('query', 'page', 'country', 'device', 'query_page'\)\)/.test(mig) && /check \(dimension in \('query', 'page', 'country', 'device', 'query_page'\)\)/.test(pack));
  ok('0220: a rollback note and a verify query', /^-- rollback:/.test(mig) && /-- Verify/.test(pack));
  ok('0220 is the only migration with that number', [...Deno.readDirSync(new URL('../../supabase/migrations/', import.meta.url))].filter((e) => e.name.startsWith('0220_')).length === 1);
}

// ── 2. the searches just off page one ──
{
  const pr = (q, page, imp, pos, clicks = 0) => ({ key: G.pairKey(q, page), clicks, impressions: imp, position: pos });
  const site = 'https://maple.example';
  const pairs = [
    pr('homes for sale burbank', `${site}/listings/`, 1000, 11, 18), pr('homes for sale burbank', `${site}/`, 240, 13),
    pr('sell my house burbank', `${site}/sell-your-home/`, 860, 9.4, 22),
    pr('realtor near me', `${site}/`, 2100, 14, 9),
    pr('main realty homes', `${site}/`, 400, 10),
    pr('toluca lake real estate agent', `${site}/about/`, 310, 17, 2),
    pr('maple and main reviews', `${site}/reviews/`, 140, 19.6),
    pr('on page one already', `${site}/`, 900, 3),
    pr('just past twenty', `${site}/`, 900, 20.6),
    pr('only twice', `${site}/`, 2, 12),
    pr('another address', 'https://app.maple.example/pricing/', 5000, 12),
    pr('old page', `${site}/old-page/`, 50, 7.5),
    pr('a post', `${site}/updates/spring-market/`, 60, 12),
  ];
  const prior = [pr('homes for sale burbank', `${site}/listings/`, 900, 13), pr('realtor near me', `${site}/`, 1900, 11)];
  const headlines = [
    { key: 'home', label: 'Home', title: 'Maple & Main Realty, homes in Burbank' },
    { key: 'about', label: 'About', title: 'About — Maple & Main Realty' },
    { key: 'page:listings', label: 'Listings', title: 'Homes for sale — Maple & Main Realty' },
    { key: 'page:reviews', label: 'Reviews', title: 'Reviews of Maple and Main Realty' },
  ];
  const list = N.nearMisses({ pairs, prior, origin: `${site}/`, headlines, hidden: ['page:sell-your-home'], ownDescriptions: ['page:reviews'], offeringPath: '/services/' });
  eq('near: places 8 to 20, seen at least five times, this site only, most seen first', list.map((x) => x.term), ['realtor near me', 'homes for sale burbank', 'sell my house burbank', 'main realty homes', 'toluca lake real estate agent', 'maple and main reviews', 'a post', 'old page']);
  const homes = list.find((x) => x.term === 'homes for sale burbank');
  eq('near: one search over two pages: its place weighed by how often each showed, the page shown most', [homes.place, homes.path, homes.page, homes.seen, homes.clicks, homes.prior_place], [11.4, '/listings/', 'Listings', 1240, 18, 13]);
  const realtor = list.find((x) => x.term === 'realtor near me');
  eq('near: a search missing a word from the page’s title names the word', [realtor.fix, realtor.words], ['title', 'The page’s title on Google doesn’t say “realtor”.']);
  eq('near: a page hidden from Google says so first', list.find((x) => x.term === 'sell my house burbank').fix, 'hidden');
  eq('near: the listings page’s title lacks “burbank”', [homes.fix, homes.words], ['title', 'The page’s title on Google doesn’t say “burbank”.']);
  eq('near: words in the title, no description of its own', list.find((x) => x.term === 'main realty homes').fix, 'description');
  eq('near: title and description both say it', list.find((x) => x.term === 'maple and main reviews').fix, 'already');
  eq('near: “toluca lake” is named when the About title lacks it', list.find((x) => x.term === 'toluca lake real estate agent').words, 'The page’s title on Google doesn’t say “toluca lake real”.');
  ok('near: a blog post or an unknown page asks to check its title, never guesses', ['a post', 'old page'].every((t) => list.find((x) => x.term === t).fix === 'check'));
  ok('near: place 7.5 counts as 8, 20.6 doesn’t count', list.some((x) => x.term === 'old page') && !list.some((x) => x.term === 'just past twenty'));
  const hosted = N.nearMisses({ pairs, prior: null, origin: `${site}/`, headlines: null, hidden: [], ownDescriptions: [], offeringPath: '/services/' });
  ok('near: a site hosted elsewhere gets the list, each to check', hosted.length === 8 && hosted.every((x) => x.fix === 'check' && x.key === null && x.prior_place === null));
  eq('near: page keys for a site built here', ['/', '/services/', '/about/', '/faq/', '/updates/', '/contact/', '/listings/', '/updates/a-post/', '/a/b/'].map((p) => N.pageKeyOf(p, '/services/')), ['home', 'offerings', 'about', 'faq', 'updates', 'contact', 'page:listings', null, null]);
  ok('near: ten at most', N.nearMisses({ pairs: Array.from({ length: 30 }, (_, i) => pr(`search ${i}`, `${site}/`, 100 + i, 12)), prior: null, origin: site, headlines: null, hidden: [], ownDescriptions: [], offeringPath: '/services/' }).length === N.NEAR_MAX);
}

// ── 3. why visits fell ──
{
  eq('channels: Google, other search engines, social, AI, your links, straight in, other sites', [
    ['www.google.com', ''], ['google.co.uk', ''], ['bing.com', ''], ['duckduckgo.com', ''], ['l.facebook.com', ''], ['t.co', ''], ['chatgpt.com', ''], ['', 'newsletter'], ['', ''], ['yelp.com', ''],
  ].map(([h, u]) => V.channelOf(h, u)), ['google', 'google', 'search', 'search', 'social', 'social', 'ai', 'links', 'direct', 'sites']);
  const src = (google, direct, sites, social) => [{ ref_host: 'www.google.com', utm_source: '', visits: google }, { ref_host: '', utm_source: '', visits: direct }, { ref_host: 'yelp.com', utm_source: '', visits: sites }, { ref_host: 'instagram.com', utm_source: '', visits: social }];
  const terms = (rows) => rows.map(([key, clicks]) => ({ key, clicks }));
  const d = V.visitDrop({ now: 389, was: 660, wasLabel: 'September', sourcesNow: src(214, 101, 41, 33), sourcesWas: src(394, 163, 59, 28), termsNow: terms([['bluebird bakery', 64], ['cakes burbank', 30]]), termsWas: terms([['bluebird bakery', 140], ['cakes burbank', 31]]), name: 'Bluebird Bakery' });
  eq('drop: the fall, said plainly', [d.pct, d.short], [41, 'Mostly fewer Google searches for your name']);
  eq('drop: where the visits came from, the biggest fall first', d.parts.map((p) => [p.name, p.change]), [['Google searches', -180], ['Straight to the site', -62], ['Other websites', -18], ['Social media', 5]]);
  ok('drop: the sentence names the month and the search', d.sentence === '389 visits, against 660 in September. Most of the drop came from Google searches: 180 fewer visits. Fewer people looked you up by name: “bluebird bakery” brought 64 clicks from Google, against 140.', d.sentence);
  const spread = V.visitDrop({ now: 60, was: 100, wasLabel: 'September', sourcesNow: src(30, 20, 5, 5), sourcesWas: src(45, 35, 10, 10), name: 'X' });
  eq('drop: spread thin, it says so and names the three biggest', [spread.short, spread.sentence], ['Fewer visits from several places', '60 visits, against 100 in September. The drop was spread out: 15 fewer from Google searches, 15 fewer from people coming straight to the site, 5 fewer from other websites.']);
  eq('drop: too few visits the month before, or a fall under 10%, says nothing', [V.visitDrop({ now: 5, was: 19, wasLabel: 'S', sourcesNow: [], sourcesWas: [] }), V.visitDrop({ now: 91, was: 100, wasLabel: 'S', sourcesNow: [], sourcesWas: [] }), V.visitDrop({ now: 120, was: 100, wasLabel: 'S', sourcesNow: [], sourcesWas: [] })], [null, null, null]);
  const bare = V.visitDrop({ now: 50, was: 100, wasLabel: 'September', sourcesNow: null, sourcesWas: null });
  eq('drop: without the sources it says only the numbers, never a guessed reason', [bare.short, bare.sentence, bare.parts.length], ['', '50 visits, against 100 in September.', 0]);
  eq('loss: a search gone from a short list had no clicks', V.biggestLoss(terms([['a', 5]]), terms([['a', 6], ['b', 20]])), { term: 'b', now: 0, was: 20 });
  eq('loss: gone from a full list of 25 can’t be known, so it is passed', V.biggestLoss(terms(Array.from({ length: 25 }, (_, i) => [`t${i}`, 50])), terms([['gone', 40], ['t0', 52]])), { term: 't0', now: 50, was: 52 });
  ok('name: every word of the business name, & and “and” aside', V.namesBusiness('maple and main realty', 'Maple & Main Realty') && !V.namesBusiness('maple realty', 'Maple & Main Realty') && !V.namesBusiness('bakery near me', 'Bluebird Bakery'));
  eq('sources: from the report’s rows, page views only, a person once', V.sourcesFromRows([{ kind: 'pageview', ref_host: 'google.com', visitor_hash: 'a' }, { kind: 'pageview', ref_host: 'google.com', visitor_hash: 'a' }, { kind: 'pageview', ref_host: 'google.com', visitor_hash: 'b' }, { kind: 'phone', ref_host: '', visitor_hash: 'a' }, { kind: 'pageview', ref_host: '', visitor_hash: '' , ts: 't1' }]), [{ ref_host: 'google.com', utm_source: '', visits: 2 }, { ref_host: '', utm_source: '', visits: 1 }]);
  eq('months: last whole month and the one before, over a new year', V.lastWholeMonths('2027-01-15T10:00:00Z'), { month: '2026-12', prior: '2026-11', label: 'December', priorLabel: 'November', startIso: '2026-12-01T00:00:00.000Z', endIso: '2027-01-01T00:00:00.000Z', priorStartIso: '2026-11-01T00:00:00.000Z' });
}

// ── 4. the monthly report: the phone and email taps (item 381: taps, never calls), and the reason under Visits ──
{
  eq('contact: taps on the phone number and the email address, with the change', [R.contactWords({ calls: 15, emails: 8, prior: 18 }, 'September'), R.contactWords({ calls: 1, emails: 0, prior: 1 }, 'September'), R.contactWords({ calls: 0, emails: 2, prior: null }, 'September'), R.contactWords({ calls: 0, emails: 0, prior: 4 }, 'September')],
    ['15 taps on your phone number and 8 on your email address, up 5 on September', '1 tap on your phone number, the same as September', '2 taps on your email address', 'Nobody pressed a phone number or email address, down 4 on September']);
  eq('contact: nobody this month or the one before says nothing', R.contactWords({ calls: 0, emails: 0, prior: 0 }, 'September'), null);
  const win = { month: '2026-10', label: 'October 2026', startIso: '2026-10-01T00:00:00.000Z', endIso: '2026-11-01T00:00:00.000Z' };
  const rows = [
    { ts: '2026-10-03T12:00:00.000Z', kind: 'pageview', path: '/', visitor_hash: 'a' }, { ts: '2026-10-03T12:01:00.000Z', kind: 'phone', path: '/', visitor_hash: 'a' },
    { ts: '2026-10-04T12:01:00.000Z', kind: 'phone', path: '/', visitor_hash: 'b' }, { ts: '2026-10-05T12:01:00.000Z', kind: 'email', path: '/contact/', visitor_hash: 'c' },
    { ts: '2026-10-06T12:01:00.000Z', kind: 'cta', path: '/', visitor_hash: 'c' },
  ];
  const base = R.foldReport({ month: win.month, label: win.label, startMs: Date.parse(win.startIso), endMs: Date.parse(win.endIso), visits: rows, enquiries: 2, publishes: [], address: '', visitsCap: 5000 });
  eq('fold: the presses it already counted are kept, a call or an email only', base.contacts, { calls: 2, emails: 1, prior: null });
  eq('fold: a read that failed has no presses, never zero', R.foldReport({ month: win.month, label: win.label, startMs: 0, endMs: 1, visits: null, enquiries: null, publishes: null, address: '', visitsCap: 5000 }).contacts, null);
  const d = { ...base, priorLabel: 'September', priorVisitors: 2, contacts: { calls: 2, emails: 1, prior: 1 }, drop: { pct: 41, now: 389, was: 660, short: 'Mostly fewer Google searches for <your> name', sentence: 's', parts: [], search: null } };
  const html = R.reportHtml(d, { studioName: 'S', note: '' }).html;
  ok('report: three tiles share the row, a third each', (html.match(/<td width="33%"/g) || []).length === 3 && /Visits.*Phone and email taps.*Enquiries/s.test(html));
  ok('report: the taps in words, with the change', /Phone and email taps<\/div><div[^>]*>3<\/div><div[^>]*>2 taps on your phone number and 1 on your email address, up 2 on September/.test(html) && !/\bcalls?\b/.test(html));
  ok('report: the reason sits under Visits, in red, escaped', /<span style="color:#bf3535">mostly fewer Google searches for &lt;your&gt; name<\/span>/.test(html));
  const off = R.reportHtml(d, { studioName: 'S', note: '', off: ['enquiries'] }).html;
  ok('report: it rides the Enquiries switch: off, it leaves with Enquiries, and Visits has the row', !/Phone and email taps/.test(off) && (off.match(/<td width="100%"/g) || []).length === 1);
  const none = R.reportHtml({ ...d, contacts: { calls: 0, emails: 0, prior: 0 }, drop: null }, { studioName: 'S', note: '' }).html;
  ok('report: nobody pressed, now or before: no tile, two halves as before', !/Phone and email taps/.test(none) && (none.match(/<td width="50%"/g) || []).length === 2);
  const mr = read(`${P}/ops/monthly_report.ts`);
  ok('report: the month before’s presses are counted, calls and emails only', /svcCount\(`presence_visits\?site_id=eq\.\$\{site\.id\}&kind=in\.\(phone,email\)&ts=gte\.\$\{priorWin\.startIso\}&ts=lt\.\$\{win\.startIso\}`\)/.test(mr));
  ok('report: the reason uses the rows already read, unless they were cut short', /sourcesNow: visits && !vq\?\.truncated \? sourcesFromRows\(visits\) : null/.test(mr));
  const pdf = read(`${P}/lib/report_pdf.ts`);
  ok('pdf: a Phone and email taps box riding Enquiries, and the reason under the boxes', /boxes\.push\(\['Phone and email taps'/.test(pdf) && /if \(c && on\('enquiries'\)/.test(pdf) && /Why visits fell: \$\{d\.drop\.sentence\}/.test(pdf));
}

// ── 5. the reads, against a stubbed database ──
{
  const SITE = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222', status: 'live', last_published_at: '2026-06-01T00:00:00Z', template_slug: 'x', template_version: '1', custom_domain: 'maple.example', netlify_site_id: 'n', edition: 'presence' };
  const asked = [];
  const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  const visitStats = { '2026-10-01': { visitors: 389, sources: [{ ref_host: 'www.google.com', utm_source: '', visits: 214 }, { ref_host: '', utm_source: '', visits: 175 }] }, '2026-09-01': { visitors: 660, sources: [{ ref_host: 'www.google.com', utm_source: '', visits: 394 }, { ref_host: '', utm_source: '', visits: 266 }] } };
  let pairsReady = true;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
    asked.push(`${table}?${q}`);
    if (table === 'rpc/presence_visit_stats') { const b = JSON.parse(init.body); return reply(visitStats[String(b.p_start).slice(0, 10)] || { visitors: 0, sources: [] }); }
    if (table === 'presence_identity') return reply([{ business_name: 'Maple & Main Realty', seo_title: 'Maple & Main Realty, homes in Burbank', seo_description: '' }]);
    if (table === 'presence_settings') return reply([{ page_seo: {}, pages: [{ slug: 'listings', title: 'Listings' }], pages_noindex: [], industry_key: 'real_estate' }]);
    if (table === 'presence_search_terms') {
      if (/dimension=eq\.query_page/.test(q)) return pairsReady ? reply([{ key: 'realtor near me\thttps://maple.example/', period: '2026-10', clicks: 9, impressions: 2100, position: 14 }, { key: 'realtor near me\thttps://maple.example/', period: '2026-09', clicks: 9, impressions: 1900, position: 11 }]) : reply({ code: '22P02' }, 400);
      if (/dimension=eq\.query&period=in/.test(q)) return reply([{ key: 'maple and main realty', period: '2026-10', clicks: 64 }, { key: 'maple and main realty', period: '2026-09', clicks: 140 }]);
      return reply([]);
    }
    return reply([]);
  };
  const S = await import(`${P}/routes/search_tab.ts`);
  const nm = await S.nearMissView(SITE, '2026-10', 'https://maple.example/');
  eq('tab: the near-miss card’s list, with its month', [nm.period, nm.from, nm.to, nm.list.map((x) => [x.term, x.place, x.prior_place, x.page, x.fix])], ['2026-10', 8, 20, [['realtor near me', 14, 11, 'Home', 'title']]]);
  pairsReady = false;
  eq('tab: before 0220 (or the first sync after it) the card waits: null, never “none”', await S.nearMissView(SITE, '2026-10', ''), null);
  const drop = await S.dropView(SITE, '2026-11-15T10:00:00Z');
  eq('tab: why October’s visits fell, from the two months counted in the database', [drop.month, drop.prior_label, drop.pct, drop.short, drop.search], ['2026-10', 'September', 41, 'Mostly fewer Google searches for your name', { term: 'maple and main realty', now: 64, was: 140, own_name: true }]);
  eq('tab: a site hosted elsewhere has no visit counter, so no drop', await S.dropView({ ...SITE, edition: 'monitor' }, '2026-11-15T10:00:00Z'), null);
  const tab = read(`${P}/routes/search_tab.ts`);
  ok('tab: both ride GET /visibility, best-effort', /near_miss: nearMiss,\n    drop,/.test(tab) && /safe\(nearMissView\(/.test(tab) && /safe\(dropView\(site\)\)/.test(tab));
  const nums = read(`${P}/agency/site_numbers.ts`);
  ok('sites: drops ride /agency/site-numbers, for the sites that fell, a dozen at most', /const drops = await siteDrops\(sites, data, nowIso\)/.test(nums) && /return json\(\{ data, \.\.\.head, partial, drops \}/.test(nums) && /\.slice\(0, DROPS_READ_MAX\)/.test(nums));
}

const failed = results.filter((r) => !r.p).length;
console.log(`near_miss_219: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
