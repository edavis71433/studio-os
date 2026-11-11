// ── Builder list item 184: a fuller monthly report, and one Do next list per client ──
//   deno run --allow-read --allow-env tests/presence/report_do_next_test.mjs
// The report adds Google (and the searches followed), AI answers, reviews and website
// health, each left out when it can't be read, with a PDF copy attached and one to
// download. The Do next list joins Needs you, health, Search, reviews, AI answers and
// the coach's ideas for one client, with Done (away 30 days) and Not relevant (away
// for good). No Supabase, Google or email leaves the test.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', RESEND_INBOUND_DOMAIN: 'reply.example.com' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const D = await import(`${P}/lib/do_next.ts`);
const R = await import(`${P}/ops/monthly_report.ts`);
const PDF = await import(`${P}/lib/report_pdf.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));
const NOW = '2026-11-11T10:00:00.000Z';
const SITE = '11111111-1111-4111-8111-111111111111';

// ── 1. the Do next list ──
const facts = {
  siteId: SITE,
  needs: [{ key: 'enquiry:e1', what: 'Reply to 2 enquiries', when: 'Waiting since Monday', verb: 'Reply', href: '/inbox.html?site=' + SITE }],
  health: [{ type: 'seo.description_missing', severity: 'warning', n: 3 }, { type: 'links.internal_broken', severity: 'critical', n: 1 }],
  search: [{ key: 'health:links.internal_broken', priority: 'critical', done: false, title: 'Links to pages that aren’t there', sub: '', go: 'health' }, { key: 'console', priority: 'high', done: false, title: 'Connect Google Search Console', sub: 'See what people search.', go: 'connect:console' }, { key: 'llms', priority: 'medium', done: false, title: 'Write your llms.txt', sub: '', go: 'tool:llms' }, { key: 'title', priority: 'high', done: true, title: 'Add a search headline', sub: '', go: null }],
  reviews: { googleUnreplied: 1, pending: 2 },
  ai: { results: [{ q: 'Is Maple & Main Realty good?', kind: 'branded', answers: [{ named: false }] }, { q: 'Who is a good realtor in Burbank?', kind: 'unbranded', answers: [{ named: false }] }] },
  ideas: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', opportunity: 'Post this weekend’s open house as an update', suggested_next_step: 'Write it', timing_phrase: 'This week' }],
};
{
  const none = { decided: {} };
  const l = D.composeDoNext(facts, none, NOW);
  eq('list: Needs you first, then health (critical first), Search, reviews, AI, ideas', l.items.map((i) => i.source), ['needs', 'health', 'health', 'search', 'reviews', 'reviews', 'ai', 'idea']);
  ok('list: a Search task the health check already lists isn’t there twice', !l.items.some((i) => i.key === 'search:health:links.internal_broken') && l.items.some((i) => i.key === 'health:links.internal_broken'));
  ok('list: done tasks and Medium ones stay on the Search tab', !l.items.some((i) => i.key === 'search:title' || i.key === 'search:llms'));
  eq('list: the words', [l.items[1].title, l.items[2].sub, l.items[4].title, l.items[5].title], ['Links to pages that aren’t there', 'Google can read it · 3 places', 'Reply to a Google review', 'Approve 2 new reviews']);
  eq('list: Claude missing them for a question that doesn’t name them', [l.items[6].key, l.items[6].title], ['ai:who-is-a-good-realtor-in-burbank', 'Claude doesn’t suggest them for “Who is a good realtor in Burbank?”']);
  ok('list: each item opens the thing to do, in that client', l.items.every((i) => i.href) && l.items[7].href === `/presence.html?client=${SITE}#plan` && l.items[1].href.endsWith('#health'));
  eq('list: eight shown, the rest counted', [l.items.length, l.more], [8, 0]);
  const many = D.composeDoNext({ ...facts, needs: Array.from({ length: 9 }, (_, i) => ({ key: `money:m${i}`, what: `Invoice ${i}`, when: '', verb: 'Resend', href: '/x' })) }, none, NOW);
  eq('list: past eight, “more” counts the rest of every source', [many.items.length, many.more], [8, 8]);
  eq('list: a Needs you line written to follow the site’s name stands alone here', D.composeDoNext({ ...facts, needs: [{ key: 'publish:s', what: 'changes are sitting unpublished', when: '', verb: 'Review', href: '/x' }] }, none, NOW).items[0].title, 'Changes are sitting unpublished');
  let dec = D.applyDecision(none, 'reviews:pending', 'done', 'Approve 2 new reviews', 'eric@studio.example', NOW);
  dec = D.applyDecision(dec, 'ai:who-is-a-good-realtor-in-burbank', 'not_relevant', 'Claude…', 'eric@studio.example', NOW);
  const after = D.composeDoNext(facts, dec, NOW);
  ok('done: off the list', !after.items.some((i) => i.key === 'reviews:pending'));
  ok('not relevant: off the list', !after.items.some((i) => i.key.startsWith('ai:')));
  eq('this month’s decisions, to show again', after.decided.map((d) => [d.key, d.state]).sort(), [['ai:who-is-a-good-realtor-in-burbank', 'not_relevant'], ['reviews:pending', 'done']]);
  const later = D.composeDoNext(facts, dec, '2026-12-12T10:00:00.000Z');
  ok('done: back after 30 days when it is still true; not relevant stays away', later.items.some((i) => i.key === 'reviews:pending') && !later.items.some((i) => i.key.startsWith('ai:')));
  const undone = D.applyDecision(dec, 'reviews:pending', 'undo', '', null, NOW);
  ok('undo: back on the list', D.composeDoNext(facts, undone, NOW).items.some((i) => i.key === 'reviews:pending'));
  ok('decide: a strange key or word is refused', 'error' in D.applyDecision(none, 'bad key!', 'done', '', null, NOW) && 'error' in D.applyDecision(none, 'reviews:x', 'maybe', '', null, NOW));
  const capped = D.normalizeDecisions({ decided: Object.fromEntries(Array.from({ length: 320 }, (_, i) => [`money:m${i}`, { state: 'done', at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }])) });
  eq('decisions: the newest 300 kept', [Object.keys(capped.decided).length, !!capped.decided['money:m319'], !!capped.decided['money:m0']], [300, true, false]);
}

// ── 2. the fuller report’s parts ──
const extras = R.foldExtras({
  month: '2026-10', prior: '2026-09',
  priorVisitors: [{ month: '2026-09', visitors: 688 }, { month: '2026-10', visitors: 812 }],
  signals: [{ metric: 'search_clicks', period: '2026-10', value: 64 }, { metric: 'search_impressions', period: '2026-10', value: 2140 }, { metric: 'search_clicks', period: '2026-09', value: 59 }],
  followed: ['burbank realtor', 'homes for sale burbank', 'sell my house burbank'],
  terms: [{ key: 'burbank realtor', period: '2026-10', clicks: 18, position: 4.2 }, { key: 'burbank realtor', period: '2026-09', clicks: 12, position: 6.1 }, { key: 'homes for sale burbank', period: '2026-10', clicks: 6, position: 11 }, { key: 'homes for sale burbank', period: '2026-09', clicks: 8, position: 8 }],
  ai: [{ month: '2026-11', asked: 10, named: 6, results: [{ q: 'Who is a good realtor in Burbank?', answers: [{ named: true, name: 'Claude' }] }, { q: 'Which agent helps first-time buyers?', answers: [{ named: true, name: 'Claude' }] }, { q: 'How do I sell fast?', answers: [{ named: false, name: 'Claude' }] }] },
    { month: '2026-10', asked: 10, named: 4, results: [{ q: 'Who is a good realtor in Burbank?', answers: [{ named: true }] }] }],
  gbp: { rating: 4.6, review_count: 28, new_reviews: 2, unreplied_reviews: 1 }, ownNew: 1,
  health: [{ day: '2026-10-31', critical: 0, warning: 2, fingerprints: ['s|seo.description_missing|/'] }, { day: '2026-10-01', critical: 1, warning: 4, fingerprints: ['s|links.internal_broken|/team/', 's|seo.description_missing|/', 's|accessibility.img_alt_missing|m1'] }],
});
{
  eq('report: last month against the month before', [extras.priorVisitors, extras.search], [688, { clicks: 64, impressions: 2140, priorClicks: 59, priorImpressions: null }]);
  eq('report: the searches followed, place and clicks, one not seen', extras.followed, [{ term: 'burbank realtor', position: 4.2, priorPosition: 6.1, clicks: 18 }, { term: 'homes for sale burbank', position: 11, priorPosition: 8, clicks: 6 }, { term: 'sell my house burbank', position: null, priorPosition: null, clicks: 0 }]);
  eq('report: AI answers, against the check before, and what is newly named', [extras.ai.named, extras.ai.priorNamed, extras.ai.engines, extras.ai.newlyNamed, extras.ai.questions.map((q) => q.named)], [6, 4, 'Claude', 'Which agent helps first-time buyers?', [true, true, false]]);
  eq('report: reviews', extras.reviews, { rating: 4.6, count: 28, newGoogle: 2, unreplied: 1, ownNew: 1 });
  eq('report: health now, a month ago, and how many kinds were fixed', extras.health, { n: 2, then: 5, fixed: 2 });
  const nothing = R.foldExtras({ month: '2026-10', prior: '2026-09', priorVisitors: null, signals: null, followed: [], terms: null, ai: null, gbp: null, ownNew: null, health: null });
  eq('report: what couldn’t be read is left out, never a zero', [nothing.priorVisitors, nothing.search, nothing.ai, nothing.reviews, nothing.health], [null, null, null, null, null]);
  const d = { month: '2026-10', monthLabel: 'October 2026', visitors: 812, pageviews: 1900, truncated: false, enquiries: 3, topPages: [{ path: '/listings/', views: 402 }], publishes: 2, lastPublishedAt: '2026-10-24T00:00:00Z', address: 'https://maple.example', siteName: 'Maple & Main Realty', priorLabel: 'September', ...extras };
  const { html } = R.reportHtml(d, { studioName: 'Brightline Studio', note: '', clientName: 'Sam', pdf: 'Maple-and-Main-Realty-October-2026.pdf' });
  ok('email: visitors with their change', html.includes('up 18% on September'));
  ok('email: On Google, clicks and the searches followed, with their places', html.includes('<strong>On Google</strong>') && html.includes('64 clicks to your site and 2,140 times seen') && html.includes('<strong>4th</strong> on Google') && html.includes('up 2 places') && html.includes('down 3 places') && html.includes('not seen this month'));
  ok('email: a drop is red, a rise green', /color:#bf3535">down 3 places/.test(html) && /color:#11744a">up 2 places/.test(html));
  ok('email: AI answers in a sentence', html.includes('Claude named Maple &amp; Main Realty for 6 of the 10 questions we ask it each month, up from 4.') && html.includes('New this month: “Which agent helps first-time buyers?”'));
  ok('email: reviews and website health', html.includes('4.6 stars from 28 Google reviews. 2 new in the last 30 days. 1 waiting for your reply. 1 new on your site.') && html.includes('2 things to look at, 3 fewer than a month ago. 2 fixed this month.'));
  ok('email: says the PDF is attached', html.includes('Maple-and-Main-Realty-October-2026.pdf is attached'));
  ok('email: no score anywhere (Law 13)', !/score|out of 100/i.test(html));
  const pdf = new TextDecoder().decode(PDF.reportPdf(d, { studioName: 'Brightline Studio', accent: '#6d3fd4', clientName: 'Sam', siteName: 'Maple & Main Realty' }));
  const enc = (t) => t.replace(/[()\\]/g, '\\$&').replace(/·/g, '\\267').replace(/’/g, '\\222').replace(/“/g, '\\223').replace(/”/g, '\\224');
  for (const s of ['%PDF-1.4', 'Brightline Studio', 'Your website in October', 'Visits', 'Google clicks', 'AI answers', '6 of 10', 'On Google', '“burbank realtor”: 4th on Google, up 2 places · 18 clicks', 'In AI answers', 'Reviews', 'Website health', 'What people read most', 'What changed', '1 of 1']) ok(`pdf: says ${s}`, pdf.includes(enc(s)), s);
  eq('pdf: the file name', PDF.reportFileName('Maple & Main Realty', 'October 2026'), 'Maple-and-Main-Realty-October-2026.pdf');
  eq('words: the change on a month', [PDF.changeOn(812, 688, 'September'), PDF.changeOn(389, 659, 'September'), PDF.changeOn(5, 5, 'September'), PDF.changeOn(40, 0, 'September'), PDF.changeOn(null, 5, 'x')], ['up 18% on September', 'down 41% on September', 'the same as September', 'new since September', '']);
  const s0 = R.normalizeReportSetting({});
  ok('setting: the PDF copy is on unless switched off', s0.pdf === true && R.normalizeReportSetting({ pdf: false }).pdf === false && R.applyReportChange(s0, { pdf: false }, 'x', NOW).pdf === false);
}

// ── 3. the email carries the PDF; the download route; the Do next route ──
{
  let sends = [], decided = null, oppPatched = null, monthAsks = [];
  const reply = (b, s = 200, h = {}) => new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const m = (init.method || 'GET').toUpperCase();
    if (u.hostname === 'api.resend.com') { sends.push(JSON.parse(init.body)); return reply({ id: 'em_1' }); }
    const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
    if (m === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
    if (table === 'presence_sales_templates') {
      if (q.includes('__do_next__')) { if (m === 'GET') return reply(decided ? [{ id: 'd1', body: JSON.stringify(decided), updated_at: 'x' }] : []); decided = JSON.parse(JSON.parse(init.body).body); return reply([{ id: 'd1' }], m === 'POST' ? 201 : 200); }
      if (m === 'POST' && JSON.parse(init.body).name === '__do_next__') { decided = JSON.parse(JSON.parse(init.body).body); return reply([{ id: 'd1' }], 201); }
      return reply([]);
    }
    if (table === 'presence_identity') return reply([{ business_name: 'Maple & Main Realty' }]);
    if (table === 'presence_agency_clients') return reply([{ site_id: SITE }]);
    if (table === 'presence_sites') return reply([{ id: SITE, client_id: 'c1', status: 'live', last_published_at: '2026-06-01T00:00:00Z', template_slug: 'x', template_version: '1', custom_domain: 'maple.example', netlify_site_id: 'n', edition: 'presence' }]);
    if (table === 'presence_health_days') return reply([{ day: '2026-11-11', issues: [{ type: 'links.internal_broken', severity: 'critical', n: 1 }], critical: 1, warning: 0, fingerprints: [] }]);
    if (table === 'presence_growth_opportunities') { if (m === 'PATCH') { oppPatched = JSON.parse(init.body); return reply([{}]); } return reply([{ id: 'aaaaaaaa-0000-4000-8000-000000000001', opportunity: 'Post the open house', suggested_next_step: 'Write it', timing_phrase: 'This week', handoff: {} }]); }
    if (table === 'presence_reviews') return reply([{ id: 'r1' }]);
    if (table === 'rpc/presence_month_visitors') { monthAsks.push(JSON.parse(init.body)); return reply([]); }
    return reply([]);
  };
  const site = { id: SITE, client_id: 'c1', status: 'live', last_published_at: '2026-06-01T00:00:00Z', template_slug: 'x', template_version: '1', custom_domain: 'maple.example', netlify_site_id: 'n', edition: 'presence' };
  const sent = await R.sendReport(site, R.lastMonth(NOW), R.normalizeReportSetting({ enabled: true }), 'owner@client.example');
  ok('email: the PDF goes with it, named for the client and month', sent && sends[0].attachments?.[0]?.filename === 'Maple-and-Main-Realty-October-2026.pdf' && atob(sends[0].attachments[0].content).startsWith('%PDF-1.4'));
  await R.sendReport(site, R.lastMonth(NOW), R.normalizeReportSetting({ enabled: true, pdf: false }), 'owner@client.example');
  ok('email: switched off, no attachment and no line about one', !sends[1].attachments && !/is attached/.test(sends[1].html));
  const la = await R.loadReportData(site, R.lastMonth(NOW, 'America/Los_Angeles'), 'America/Los_Angeles');
  eq('the month before is counted on the site’s clock too (bug hunt D7)', [monthAsks.at(-1), la.priorLabel], [{ p_site_ids: [SITE], p_since: '2026-09-01T07:00:00.000Z', p_tz: 'America/Los_Angeles' }, 'September']);
  const dl = await R.handleReportPdf(site, {});
  ok('download: last month’s PDF, as a file, never cached', dl.status === 200 && dl.headers.get('Content-Type') === 'application/pdf' && /filename="Maple-and-Main-Realty-October-2026\.pdf"/.test(dl.headers.get('Content-Disposition')) && dl.headers.get('Cache-Control') === 'no-store');
  ok('download: the page on the app’s host can read the file’s name', dl.headers.get('Access-Control-Expose-Headers') === 'Content-Disposition');
  const N = await import(`${P}/agency/do_next.ts`);
  const member = { agency_id: 'ag', member_id: 'm1', email: 'eric@studio.example', role: 'owner' };
  const deps = { needs: async () => ({ rows: [{ key: 'enquiry:e1', site_id: SITE, what: 'Reply to an enquiry', when: 'Since Monday', verb: 'Reply', href: '/inbox.html' }, { key: 'money:x', site_id: 'other', what: 'Not theirs', when: '', verb: 'Open', href: '/' }], rest: [] }) };
  const g = await (await N.handleDoNext(new Request('http://x'), `/agency/sites/${SITE}/do-next`, 'GET', member, {}, {}, deps)).json();
  eq('route: this client’s list, from each source', ['enquiry:e1', 'health:links.internal_broken', 'search:console', 'reviews:pending', 'idea:aaaaaaaa-0000-4000-8000-000000000001'].map((k) => g.data.items.some((i) => i.key === k)), [true, true, true, true, true]);
  eq('route: in order, Needs you first', g.data.items[0].key, 'enquiry:e1');
  ok('route: another client’s Needs you row never shows', !g.data.items.some((i) => i.key === 'money:x'));
  const post = (key, decision) => N.handleDoNext(new Request('http://x', { method: 'POST', body: JSON.stringify({ key, decision, title: 'T' }) }), `/agency/sites/${SITE}/do-next/decide`, 'POST', member, {}, {}, deps);
  const p1 = await (await post('idea:aaaaaaaa-0000-4000-8000-000000000001', 'not_relevant')).json();
  ok('decide: not relevant is kept, and the coach is told (dismissed)', decided.decided['idea:aaaaaaaa-0000-4000-8000-000000000001'].state === 'not_relevant' && oppPatched?.status === 'dismissed' && !p1.data.items.some((i) => i.key.startsWith('idea:')));
  eq('decide: a strange word is refused', (await post('reviews:pending', 'maybe')).status, 400);
  const other = await N.handleDoNext(new Request('http://x'), '/agency/sites/22222222-2222-4222-8222-222222222222/do-next', 'GET', member, {}, {}, deps);
  eq('route: a site that isn’t the studio’s is not found', other.status, 404);
  const src = { routes: read(`${P}/agency/routes.ts`), idx: read(`${P}/index.ts`) };
  ok('wired: the studio’s routes and the report’s PDF', /handleDoNext\(req, route, method, member, principal, cors, \{ needs: \(\) => computeStudioNeeds\(member, principal, jwt, now\) \}\)/.test(src.routes) && /route === '\/report\/monthly\/pdf' && method === 'GET'\)/.test(src.idx));
}

const failed = results.filter((r) => !r.p).length;
console.log(`report_do_next: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
