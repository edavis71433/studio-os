// ── The Search tab: the composition, and the routes against stubbed stores ───
//   deno run --allow-read --allow-env --allow-net tests/presence/search_visibility_test.mjs
Deno.env.set('SUPABASE_URL', 'http://supabase.test');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');

const P = '../../supabase/functions/presence';
const { aiSummary, liveAddress, reportUrlCandidates, reportUrlFilter, reviewBusinessType, scoreSummary, visibilityState } = await import(`${P}/lib/search_visibility.ts`);
const { checkDeps, handleVisibility, handleVisibilityCheck } = await import(`${P}/routes/visibility.ts`);
const { featureForRoute } = await import(`${P}/middleware/feature.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && note ? ' — ' + note : ''}`); };

const ID = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const base = 'https://tools.example.com';

// ═══ 1. where can this website be read from? ═══
{
  const live = liveAddress({ id: ID, edition: 'presence', custom_domain: 'marlows.example', last_published_at: '2026-01-01' }, null);
  ok('address: hosted and live → its domain', live.url === 'https://marlows.example/' && live.hosted === true);
  const noDomain = liveAddress({ id: ID, edition: 'presence', custom_domain: null, last_published_at: '2026-01-01' }, null);
  ok('address: hosted without a domain → the hosting name the provisioner gives it', noDomain.domain === 'presence-111111111111.netlify.app');
  ok('address: a draft has nothing to read, even with a domain attached', liveAddress({ id: ID, edition: 'presence', custom_domain: 'marlows.example', last_published_at: null }, null) === null);
  const rebuild = liveAddress({ id: ID, edition: 'presence', custom_domain: null, last_published_at: null }, 'old-site.com');
  ok('address: a draft whose old site is still live → that old site', rebuild.domain === 'old-site.com' && rebuild.hosted === false);
  const watch = liveAddress({ id: ID, edition: 'monitor', custom_domain: null, last_published_at: null }, 'https://www.theirs.com/');
  ok('address: a watch plan → the recorded address, tidied', watch.url === 'https://www.theirs.com/' && watch.hosted === false);
  ok('address: a watch plan with nothing recorded → nothing', liveAddress({ id: ID, edition: 'monitor' }, null) === null);
  ok('state: the three reasons', visibilityState({ edition: 'monitor' }, null) === 'no_domain' && visibilityState({ edition: 'presence' }, null) === 'draft' && visibilityState({}, { url: 'x' }) === 'ready');
}
// ═══ 2. which report is this website's? ═══
{
  const c = reportUrlCandidates('www.marlows.example');
  ok('match: both schemes, www or not, slash or not', c.length === 8 && c.includes('https://marlows.example/') && c.includes('http://www.marlows.example'));
  ok('match: whole values only, so another site can\'t lend its score', !c.some((u) => u.includes('*') || u.includes('%')) && decodeURIComponent(reportUrlFilter('marlows.example')).startsWith('input->>url=in.("https://marlows.example/"'));
  ok('match: no domain → no filter, never every report', reportUrlFilter('') === '');
  ok('match: an address that isn\'t a hostname can\'t reach the filter, so it can\'t widen it', reportUrlFilter('x.com","https://victim.com/') === '' && liveAddress({ id: ID, edition: 'monitor' }, 'a b.com') === null);
}
ok('business type: the site\'s industry maps onto the review\'s types', reviewBusinessType('coffee_shop') === 'restaurant' && reviewBusinessType('barber') === 'salon' && reviewBusinessType('plumber') === 'home services' && reviewBusinessType('dental') === 'health and wellness' && reviewBusinessType('law') === 'other' && reviewBusinessType(null) === 'other');

// ═══ 3. what a report becomes ═══
const REVIEW_ROW = {
  id: 'r1', created_at: '2026-11-01T10:00:00Z',
  scores: { overall: 82, label: 'Strong', notes: ['One page only.'], pillars: [{ key: 'search', name: 'Search', weight: 40, score: 90, note: '' }, { key: 'performance', name: 'Performance', weight: 30, score: null, note: 'Not measured' }] },
  findings: { summary: 'Solid.', items: Array.from({ length: 9 }, (_, i) => ({ title: `Issue ${i}`, what_we_found: 'w', why_it_matters: 'y', fix: 'f', priority: 'Fix now', pillar: 'Search' })) },
};
{
  const s = scoreSummary(REVIEW_ROW, base);
  ok('score: the headline and its label', s.overall === 82 && s.label === 'Strong');
  ok('score: a pillar that wasn\'t measured stays unmeasured, not zero', s.pillars[1].score === null);
  ok('score: the owner sees the findings, with the full count', s.issues.length === 6 && s.issue_count === 9 && s.issues[0].fix === 'f');
  ok('score: links to the full report', s.report_url === `${base}/report/r1`);
  ok('score: no row → no score', scoreSummary(null, base) === null);
  ok('score: a report with no number is no score, never a zero', scoreSummary({ id: 'x', scores: { overall: null }, findings: {} }, base) === null);
  const a = aiSummary({ id: 'a1', created_at: '2026-10-01', input: { business_name: 'Marlow', city: 'Pasadena', email: 'not@ours.com' }, scores: { overall: 46, label: 'Fix now', pillars: [{ name: 'Awareness', score: 10 }] } }, base);
  ok('ai: the result, under the name it ran for', a.overall === 46 && a.business_name === 'Marlow' && a.city === 'Pasadena');
  ok('ai: nothing else from the input crosses over', !JSON.stringify(a).includes('not@ours'));
  ok('ai: no row → no card', aiSummary(null, base) === null);
}
ok('plans: the tab\'s routes aren\'t gated on the website feature, so a watch plan gets them', featureForRoute('/visibility', 'GET') === null && featureForRoute('/visibility/check', 'POST') === null);

// ═══ 4. the routes ═══
function fakeWorld(over = {}) {
  const w = { calls: [], inserted: [], usage: [], rateAllowed: true, spend: 0, connections: [], connected: [], reports: {}, signals: [], terms: [], external: null, ...over };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    w.calls.push(`${method} ${url.pathname}${url.search}`);
    const table = url.pathname.replace('/rest/v1/', '');
    if (table === 'rpc/rate_hit') return reply(w.rateAllowed);
    if (table === 'rpc/tool_spend_today') return reply(w.spend);
    if (table === 'presence_monitor_connections') return reply(w.external ? [{ domain: w.external }] : []);
    if (table === 'presence_connections') return reply(w.connections);
    if (table === 'presence_connected_data') return reply(w.connected);
    if (table === 'signals') return reply(w.signals);
    if (table === 'presence_search_terms') return reply(w.terms);
    if (table === 'presence_identity') return reply([{ business_name: 'Marlow Kitchen' }]);
    if (table === 'presence_locations') return reply([{ city: 'Pasadena', region: 'CA' }]);
    if (table === 'presence_settings') return reply([{ industry_key: 'restaurant' }]);
    if (table === 'tool_usage_log') { w.usage.push(JSON.parse(init.body)); return reply([{}]); }
    if (table === 'tool_reports' && method === 'POST') { const row = { id: 'new-report', created_at: '2026-11-05T00:00:00Z', ...JSON.parse(init.body) }; w.inserted.push(row); return reply([row]); }
    if (table === 'tool_reports') { const tool = url.searchParams.get('tool')?.replace('eq.', ''); w.lastReportQuery = url.search; return reply(w.reports[tool] ? [w.reports[tool]] : []); }
    return reply([]);
  };
  return w;
}
const site = (over = {}) => ({ id: ID, client_id: CLIENT, status: 'live', last_published_at: '2026-01-01', template_slug: 't', template_version: '1', custom_domain: 'marlows.example', netlify_site_id: null, edition: 'presence', ...over });
const read = async (r) => ({ status: r.status, j: await r.json() });

{
  fakeWorld({});
  const { status, j } = await read(await handleVisibility(site({ last_published_at: null, custom_domain: null }), {}));
  ok('read: a draft → honest state, no score', status === 200 && j.data.state === 'draft' && j.data.score === null && j.data.address === null);
  ok('read: the draft\'s Search Console card says publish first', j.data.console.readiness === 'draft');
}
{
  fakeWorld({});
  const { j } = await read(await handleVisibility(site({ edition: 'monitor', last_published_at: null, custom_domain: null }), {}));
  ok('read: a watch plan with no address is asked for it, never to publish', j.data.state === 'no_domain' && j.data.console.readiness === 'no_domain');
}
{
  const w = fakeWorld({ reports: { site_review: REVIEW_ROW, ai_visibility: { id: 'a1', created_at: '2026-10-01', input: { business_name: 'Marlow', city: 'Pasadena' }, scores: { overall: 46, label: 'Fix now', pillars: [] } } } });
  const { j } = await read(await handleVisibility(site(), {}));
  ok('read: score and AI result come from the tools\' own reports', j.data.score.overall === 82 && j.data.ai.overall === 46);
  ok('read: a report is matched on this domain', decodeURIComponent(w.lastReportQuery).includes('"https://marlows.example/"'));
  ok('read: the AI check has a door', /\/ai-visibility$/.test(j.data.ai_check_url));
  ok('read: nothing connected → both cards say so', j.data.console.status === 'disconnected' && j.data.listing.status === 'disconnected' && j.data.listing.data === null);
}
{
  fakeWorld({
    connections: [{ provider_key: 'google_search_console', status: 'connected', health: 'ok', last_error: '' }, { provider_key: 'google_business_profile', status: 'connected', health: 'attention', last_error: 'Choose which Google listing is this business. That account manages 3.', config: { location_id: 'locations/1', location_name: 'Marlow', auto_selected: true } }],
    connected: [{ provider_key: 'google_business_profile', data: { rating: 4.6, review_count: 128, label: 'x' }, fetched_at: new Date().toISOString() }, { provider_key: 'google_search_console', data: { search_clicks: 40 }, fetched_at: new Date().toISOString() }],
    signals: [{ metric: 'search_clicks', value: 40, period: '2026-10' }, { metric: 'search_impressions', value: 400, period: '2026-10' }, { metric: 'search_clicks', value: 30, period: '2026-09' }, { metric: 'search_impressions', value: 300, period: '2026-09' }],
    terms: [{ dimension: 'query', key: 'wine bar', clicks: 9, impressions: 90 }, { key: 'https://marlows.example/menu/', clicks: 5, impressions: 50 }],
  });
  const { j } = await read(await handleVisibility(site(), {}));
  ok('read: connected Search Console brings its numbers and a trend', j.data.console.clicks === 40 && j.data.console.prior_clicks === 30 && j.data.console.monthly.map((m) => m.period).join() === '2026-09,2026-10');
  ok('read: the listing brings its data and its choice', j.data.listing.data.rating === 4.6 && j.data.listing.property.name === 'Marlow');
  ok('read: a reason is passed on in plain words', /Choose which Google listing/.test(j.data.listing.reason));
}

// a check, end to end, with the outside world stubbed
const HOME = `<!doctype html><html lang="en"><head><title>Marlow Kitchen | Wine bar in Pasadena</title><meta name="description" content="A neighborhood wine bar in Pasadena with a seasonal menu."></head><body><h1>Marlow Kitchen</h1><p>${'Food and wine. '.repeat(60)}</p></body></html>`;
const stubScan = () => {
  checkDeps.guard = async () => {};
  checkDeps.siteFetch = async (u) => (String(u).endsWith('/') || !/\.[a-z]+$/.test(new URL(String(u)).pathname)
    ? new Response(HOME, { status: 200, headers: { 'content-type': 'text/html' } })
    : new Response('', { status: 404 }));
  checkDeps.psiFetch = async () => new Response('{}', { status: 500 });
  checkDeps.claudeFetch = async () => new Response('{}', { status: 500 });
};
{
  const w = fakeWorld({});
  const { status, j } = await read(await handleVisibilityCheck(site({ last_published_at: null, custom_domain: null }), {}));
  ok('check: a draft has nothing to check, and nothing was spent', status === 409 && /Publish/.test(j.message) && !w.calls.some((c) => c.includes('rate_hit')));
}
{
  const w = fakeWorld({});
  const { status, j } = await read(await handleVisibilityCheck(site({ edition: 'monitor', last_published_at: null, custom_domain: null }), {}));
  ok('check: a watch plan with no address is asked for it', status === 409 && /address/.test(j.message) && !w.inserted.length);
}
{
  const w = fakeWorld({ rateAllowed: false });
  const { status, j } = await read(await handleVisibilityCheck(site(), {}));
  ok('check: over the daily limit is refused before any scan', status === 429 && /tomorrow/.test(j.message) && !w.inserted.length);
}
{
  const w = fakeWorld({ spend: 999 });
  const { status } = await read(await handleVisibilityCheck(site(), {}));
  ok('check: the tools\' daily spend cap applies here too', status === 503 && !w.inserted.length);
}
{
  stubScan();
  const w = fakeWorld({});
  const { status, j } = await read(await handleVisibilityCheck(site(), {}));
  const row = w.inserted[0];
  ok('check: a real run produces a score', status === 200 && typeof j.data.score.overall === 'number' && j.data.score.report_url.endsWith('/report/new-report'), JSON.stringify(j).slice(0, 200));
  ok('check: saved in the tools\' store, opened for the owner', row?.tool === 'site_review' && row?.unlocked === true && !!row?.unlocked_at);
  ok('check: stored under this site\'s address, so the next read finds it', row?.input?.url === 'https://marlows.example/');
  ok('check: named with the business\'s own name', row?.input?.business_name === 'Marlow Kitchen' && row?.input?.business_type === 'restaurant' && row?.input?.city === 'Pasadena, CA');
  ok('check: counted against the shared spend log', w.usage.length === 1 && w.usage[0].kind === 'scan' && w.usage[0].report_id === 'new-report');
}
{
  stubScan();
  checkDeps.siteFetch = async () => new Response('nope', { status: 403 });
  const w = fakeWorld({});
  const { status, j } = await read(await handleVisibilityCheck(site(), {}));
  ok('check: a site that blocks the checker says so, nothing saved', status === 422 && j.error === 'blocked' && !w.inserted.length);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SEARCH TAB: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
