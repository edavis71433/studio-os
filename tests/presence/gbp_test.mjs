// ── Google listing + Search Console reads, against a fake Google ─────────────
// Nothing here reaches Google. As with tests/presence/ga4_test.mjs, the fixtures
// are TRANSCRIBED from the published contract (the URLs are in lib/gbp.ts), and the
// fake only answers the documented paths: a read that asks for anything else gets a
// 404, the way the old placeholder endpoint would have failed in production.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/gbp_test.mjs
Deno.env.set('SUPABASE_URL', 'http://supabase.test');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('CONNECTION_ENC_KEY', 'a-long-enough-key-for-the-tests-0123456789');
Deno.env.set('CONNECTED_GOOGLE_BUSINESS_PROFILE_CLIENT_ID', 'cid');
Deno.env.set('CONNECTED_GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET', 'sec');

const P = '../../supabase/functions/presence';
const {
  autoPickGbp, gbpAccountPath, gbpLocationPath, gbpPerformanceQuery, gbpPerformanceWindow, gbpProblem, gbpWaitingOnStudio,
  parseGbpAccounts, parseGbpLocation, parseGbpLocations, parseGbpPerformance, parseGbpReviews, GBP_METRICS, GBP_READ_MASK,
} = await import(`${P}/lib/gbp.ts`);
const { discoverGbpLocations, normalize, readGbp, readProvider, READ_STRATEGIES } = await import(`${P}/connected/adapters.ts`);
const { syncGscForSite } = await import(`${P}/ops/gsc_sync.ts`);
const { gscMonthWindow } = await import(`${P}/lib/gsc.ts`);
const { handleConnectionProperties, handleConnectionPropertySelect, ASKABLE_PROVIDERS } = await import(`${P}/routes/connections.ts`);
const { authorizeUrl, REDIRECT_URI, APP_URL } = await import(`${P}/connected/auth.ts`);
const { seal } = await import(`${P}/connected/crypto.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && note ? ' — ' + note : ''}`); };

const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const SITE = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

// ── the transcribed fixtures ──
const ACCOUNTS = { accounts: [{ name: 'accounts/456', accountName: 'Marlow Kitchen', type: 'LOCATION_GROUP' }] };
const location = (id, title, website) => ({
  name: `locations/${id}`, title, websiteUri: website,
  storefrontAddress: { regionCode: 'US', addressLines: ['12 Main St'], locality: 'Pasadena', administrativeArea: 'CA', postalCode: '91101' },
  phoneNumbers: { primaryPhone: '(626) 555-0100' },
  regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9 }, closeTime: { hours: 17 } }] },
  metadata: { mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://search.google.com/local/writereview?placeid=x', hasVoiceOfMerchant: true },
});
const REVIEWS = {
  averageRating: 4.64, totalReviewCount: 128, nextPageToken: 'more',
  reviews: [
    { reviewId: 'a', starRating: 'FIVE', comment: 'Great', createTime: '2026-11-01T00:00:00Z', updateTime: '2026-11-01T00:00:00Z' },
    { reviewId: 'b', starRating: 'TWO', comment: 'Slow', createTime: '2026-10-20T00:00:00Z', updateTime: '2026-10-20T00:00:00Z', reviewReply: { comment: 'Sorry', updateTime: '2026-10-21T00:00:00Z' } },
    { reviewId: 'c', starRating: 'FOUR', createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-01T00:00:00Z' },
  ],
};
const PERFORMANCE = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
  { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '3' }, { date: { year: 2026, month: 10, day: 2 } }, { date: { year: 2026, month: 10, day: 3 }, value: '2' }] } },
  { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '7' }] } },
  { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 } }] } },
] }] };

// ═══ 1. pure shaping ═══
ok('gbpLocationPath: bare or pathed digits only', gbpLocationPath('123') === 'locations/123' && gbpLocationPath('locations/123') === 'locations/123');
ok('gbpLocationPath: anything else fails closed, so a tampered pick can\'t become some other request',
  gbpLocationPath('locations/1/../../x') === null && gbpLocationPath('') === null && gbpLocationPath(null) === null && gbpLocationPath('accounts/1') === null);
ok('gbpAccountPath: the same rule', gbpAccountPath('accounts/9') === 'accounts/9' && gbpAccountPath('9') === 'accounts/9' && gbpAccountPath('x') === null);
ok('parseGbpAccounts: the documented shape', JSON.stringify(parseGbpAccounts(ACCOUNTS)) === '["accounts/456"]');
ok('parseGbpAccounts: garbage is no accounts, never a throw', parseGbpAccounts(null).length === 0 && parseGbpAccounts({ accounts: 'x' }).length === 0);
{
  const l = parseGbpLocation(location('1', 'Marlow Kitchen', 'https://marlowskitchen.example/'), 'accounts/456');
  ok('parseGbpLocation: keeps the account the v4 reviews path needs', l.id === 'locations/1' && l.account === 'accounts/456');
  ok('parseGbpLocation: one line a person recognises', l.address === '12 Main St, Pasadena, CA');
  ok('parseGbpLocation: maps, review link and hours', l.maps_uri.includes('maps') && l.review_uri.includes('writereview') && l.hours_set === true);
  ok('parseGbpLocation: no usable name → dropped, not a broken row', parseGbpLocation({ title: 'x' }, 'accounts/1') === null);
  ok('parseGbpLocations: the documented shape', parseGbpLocations({ locations: [location('1', 'A', ''), { name: 'nonsense' }] }, 'accounts/1').length === 1);
}
{
  const a = parseGbpLocation(location('1', 'A', 'https://www.alpha.com/menu'), 'accounts/1');
  const b = parseGbpLocation(location('2', 'B', 'https://beta.com'), 'accounts/1');
  ok('autoPick: exactly one listing needs no question', autoPickGbp([a], null)?.id === a.id);
  ok('autoPick: several, one names this domain (www and paths ignored)', autoPickGbp([a, b], 'alpha.com')?.id === a.id);
  ok('autoPick: several and no match → ask, never guess', autoPickGbp([a, b], 'gamma.com') === null);
  ok('autoPick: several and no known domain → ask', autoPickGbp([a, b], null) === null);
  ok('autoPick: two listings on this domain → ask', autoPickGbp([a, { ...a, id: 'locations/3' }], 'alpha.com') === null);
  ok('autoPick: a domain merely containing this one doesn\'t match', autoPickGbp([a, b], 'pha.com') === null);
}
{
  const r = parseGbpReviews(REVIEWS, NOW.getTime());
  ok('reviews: rating and total come from the response totals', r.rating === 4.6 && r.reviewCount === 128);
  ok('reviews: new = the last 30 days of what came back', r.newReviews === 2);
  ok('reviews: unreplied = no reviewReply', r.unreplied === 2);
  const none = parseGbpReviews({}, NOW.getTime());
  ok('reviews: a listing with none is a real zero, with no invented rating', none.reviewCount === 0 && none.rating === undefined);
}
{
  const p = parseGbpPerformance(PERFORMANCE);
  ok('performance: DatedValue.value is a string, and absent means nothing that day', p.calls === 5 && p.directions === 7 && p.websiteClicks === 0);
  ok('performance: a metric Google didn\'t return stays unknown, not zero', parseGbpPerformance({}).calls === undefined);
  const w = gbpPerformanceWindow(NOW);
  ok('performance window: 30 days ending three days back', w.end.month === 11 && w.end.day === 2 && w.start.month === 10 && w.start.day === 4);
  const q = new URLSearchParams(gbpPerformanceQuery(NOW));
  ok('performance query: each metric once, as the API takes them', q.getAll('dailyMetrics').join() === GBP_METRICS.join());
  ok('performance query: the documented date parameters', q.get('dailyRange.startDate.month') === '10' && q.get('dailyRange.endDate.day') === '2' && q.get('dailyRange.endDate.year') === '2026');
}
ok('problem: zero quota never reads as "try again shortly"', /approved the studio’s access/.test(gbpProblem(429, {})));
ok('problem: an API left off is the studio\'s setup, not the customer\'s account',
  /isn’t switched on/.test(gbpProblem(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })));
ok('problem: a plain 403 is the wrong account', /doesn’t manage a business listing/.test(gbpProblem(403, {})));
ok('problem: anything else has no special wording', gbpProblem(500, {}) === null);
ok('problem: only the studio\'s own waits are kept quiet', gbpWaitingOnStudio(429, {}) && gbpWaitingOnStudio(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }) && !gbpWaitingOnStudio(403, {}) && !gbpWaitingOnStudio(401, {}));
{
  const n = normalize('google_business_profile', { rating: 4.6, reviewCount: 128, newReviews: 2, unreplied: 2, calls: 5, directions: 7, websiteClicks: 0, location: { name: 'Marlow', address: 'x', maps_uri: 'm', review_uri: 'r', hours_set: true } }, 'your Google listing');
  ok('normalize: the evidence engine\'s existing fields', n.rating === 4.6 && n.review_count === 128 && n.unreplied_reviews === 2 && n.new_reviews === 2);
  ok('normalize: the listing card\'s fields', n.calls === 5 && n.direction_requests === 7 && n.website_clicks === 0 && n.listing_name === 'Marlow' && n.hours_set === true);
  ok('normalize: nothing known stays unknown', normalize('google_business_profile', {}, 'x').rating === undefined);
}

// ═══ 2. the OAuth return address (the query string must survive) ═══
ok('auth: Google returns to the APP host; the marketing domain\'s redirect drops ?code=',
  REDIRECT_URI === 'https://app.davisdigitalstudio.com/connections-callback.html' && APP_URL === 'https://app.davisdigitalstudio.com');
{
  const u = new URL(authorizeUrl('google_business_profile', 'st'));
  ok('auth: the consent URL carries the app redirect, the full scope and offline access',
    u.searchParams.get('redirect_uri') === REDIRECT_URI && u.searchParams.get('scope') === 'https://www.googleapis.com/auth/business.manage' && u.searchParams.get('access_type') === 'offline');
}
ok('ask: the studio can ask a client to connect their listing too', ASKABLE_PROVIDERS.includes('google_business_profile'));

// ═══ 3. the reads, against the fake ═══
// A pick answers first and reads after, through EdgeRuntime.waitUntil. Holding that
// read here lets a block wait for it. Left running, it carried on in the next
// block's fake, auto-picked that block's listing and failed "nothing recorded"
// there, whenever its token decrypt finished late (CI, Nov 6 2026).
const afterResponse = [];
globalThis.EdgeRuntime = { waitUntil: (p) => afterResponse.push(p) };
const settle = () => Promise.all(afterResponse.splice(0));
function fakeWorld(over = {}) {
  if (afterResponse.length) throw new Error('a read from the last block is still running: await settle() before the next fakeWorld');
  const world = {
    calls: [], config: {}, connected: null, statuses: [], signals: [], terms: [], accountsStatus: 200, accountsBody: ACCOUNTS,
    locations: [location('1', 'Marlow Kitchen', 'https://marlowskitchen.example/')], reviewsStatus: 200, perfStatus: 200, detailStatus: 200,
    externalDomain: null, site: { edition: 'presence', custom_domain: 'marlowskitchen.example', netlify_site_id: null },
    tokenRow: null, ...over,
  };
  const reply = (status, body) => new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    world.calls.push(`${method} ${url.origin}${url.pathname}${url.search}`);
    if (url.host === 'supabase.test') {
      const table = url.pathname.replace('/rest/v1/', '');
      if (table === 'presence_connections' && method === 'GET') return reply(200, [{ config: world.config, provider_key: 'x', status: 'connected' }]);
      if (table === 'presence_connections' && method === 'PATCH') {
        const b = JSON.parse(init.body);
        if (b.config) world.config = b.config;
        if (b.status) world.statuses.push({ status: b.status, health: b.health, last_error: b.last_error });
        return reply(200, []);
      }
      if (table === 'presence_connection_secrets') return reply(200, world.tokenRow ? [world.tokenRow] : []);
      if (table === 'presence_sites') return reply(200, [world.site]);
      if (table === 'presence_monitor_connections') return reply(200, world.externalDomain ? [{ domain: world.externalDomain }] : []);
      if (table === 'presence_connected_data') { if (method === 'POST') world.connected = JSON.parse(init.body); return reply(200, []); }
      if (table === 'signals') { if (method === 'POST') world.signals.push(...JSON.parse(init.body)); return reply(200, world.existingSignals || []); }
      if (table === 'presence_search_terms') { if (method === 'POST') world.terms.push(...JSON.parse(init.body)); return reply(200, []); }
      if (table === 'presence_plan_notices' || table.includes('notice')) { if (method === 'POST') (world.notices ||= []).push(JSON.parse(init.body)); return reply(200, []); }
      return reply(200, []);
    }
    const path = url.pathname;
    if (url.host === 'mybusinessaccountmanagement.googleapis.com' && path === '/v1/accounts') return reply(world.accountsStatus, world.accountsBody);
    if (url.host === 'mybusinessbusinessinformation.googleapis.com') {
      if (!url.searchParams.get('readMask')) return reply(400, {});   // required by the contract
      if (/^\/v1\/accounts\/\d+\/locations$/.test(path)) return reply(200, { locations: world.locations });
      const m = /^\/v1\/locations\/(\d+)$/.exec(path);
      if (m) return reply(world.detailStatus, world.locations.find((l) => l.name === `locations/${m[1]}`) || {});
    }
    if (url.host === 'mybusiness.googleapis.com' && /^\/v4\/accounts\/\d+\/locations\/\d+\/reviews$/.test(path)) return reply(world.reviewsStatus, REVIEWS);
    if (url.host === 'businessprofileperformance.googleapis.com' && /^\/v1\/locations\/\d+:fetchMultiDailyMetricsTimeSeries$/.test(path)) return reply(world.perfStatus, PERFORMANCE);
    if (url.host === 'www.googleapis.com') {
      if (path === '/webmasters/v3/sites') return reply(200, { siteEntry: [{ siteUrl: 'sc-domain:someone-else.com', permissionLevel: 'siteOwner' }] });
      const m = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(path);
      if (m && method === 'POST') return world.gsc ? world.gsc(decodeURIComponent(m[1]), JSON.parse(init.body), reply) : reply(404, {});
    }
    return reply(404, { error: 'not a documented path' });
  };
  return world;
}

{
  const w = fakeWorld();
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: one listing → auto-selected and recorded as automatic', res.ok === true && w.config.location_id === 'locations/1' && w.config.account === 'accounts/456' && w.config.auto_selected === true);
  ok('read: all three parts land in the raw', res.raw.rating === 4.6 && res.raw.calls === 5 && res.raw.location.name === 'Marlow Kitchen');
  ok('read: discovery asks for the fields the card shows', w.calls.some((c) => c.includes('/v1/accounts/456/locations') && decodeURIComponent(c).includes(GBP_READ_MASK)));
  ok('read: reviews use the account + location path', w.calls.some((c) => c.includes('/v4/accounts/456/locations/1/reviews?pageSize=50')));
  ok('read: a Bearer token only ever goes to Google hosts in a GET', w.calls.filter((c) => c.includes('googleapis.com')).every((c) => c.startsWith('GET ')));
}
{
  const w = fakeWorld({ config: { location_id: 'locations/1', account: 'accounts/456' } });
  await readGbp(SITE, 'tok', NOW);
  ok('read: a stored choice skips discovery', !w.calls.some((c) => c.includes('mybusinessaccountmanagement')));
}
{
  const w = fakeWorld({ locations: [location('1', 'A', 'https://alpha.com'), location('2', 'B', 'https://beta.com')] });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: several listings → the human is asked, nothing is recorded', res.ok === false && /Choose which Google listing/.test(res.attention) && !w.config.location_id);
}
{
  const w = fakeWorld({ locations: [location('1', 'A', 'https://alpha.com'), location('2', 'Marlow', 'https://marlowskitchen.example/')] });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: several, one matching this site\'s domain → that one', res.ok === true && w.config.location_id === 'locations/2');
}
{
  fakeWorld({ locations: [] });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: an account with no listing says so', res.ok === false && /doesn’t manage a business listing yet/.test(res.attention));
}
{
  fakeWorld({ accountsStatus: 429 });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: zero quota comes back as the sentence, connected but needing a step', res.ok === false && /approved the studio’s access/.test(res.attention));
}
{
  fakeWorld({ accountsStatus: 401 });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: a lapsed token is a status readProvider turns into Reconnect', res.ok === false && res.status === 401 && !res.attention);
}
{
  fakeWorld({ config: { location_id: 'locations/1', account: 'accounts/456' }, reviewsStatus: 403 });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: reviews refused, listing and numbers still count', res.ok === true && res.raw.rating === undefined && res.raw.calls === 5 && res.raw.location.name === 'Marlow Kitchen');
}
{
  fakeWorld({ config: { location_id: 'locations/1', account: 'accounts/456' }, reviewsStatus: 500, perfStatus: 500, detailStatus: 500 });
  const res = await readGbp(SITE, 'tok', NOW);
  ok('read: all three failing is a failure', res.ok === false && res.status === 500);
}
ok('registry: the listing reads through its strategy', typeof READ_STRATEGIES.google_business_profile === 'function');

// ═══ 4. the provider layer: normalized, cached, status written once ═══
const tokenRow = async (extra = {}) => {
  const sealed = await seal(JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_at: null, ...extra }));
  return { ciphertext: sealed.ciphertext, iv: sealed.iv };
};
{
  const w = fakeWorld({ config: { location_id: 'locations/1', account: 'accounts/456' }, tokenRow: await tokenRow() });
  const data = await readProvider(SITE, 'google_business_profile', 'your Google listing');
  ok('provider: a good read is cached with the card\'s fields', data?.rating === 4.6 && w.connected?.data?.listing_name === 'Marlow Kitchen');
  ok('provider: and the connection reads healthy', w.statuses.at(-1)?.health === 'ok');
}
{
  const w = fakeWorld({ accountsStatus: 429, tokenRow: await tokenRow() });
  const data = await readProvider(SITE, 'google_business_profile', 'your Google listing');
  ok('provider: waiting on Google stays connected, with the reason on the row', data === null && w.statuses.at(-1)?.status === 'connected' && w.statuses.at(-1)?.health === 'attention' && /approved/.test(w.statuses.at(-1)?.last_error));
  ok('provider: and no notice goes out: a client can do nothing about the studio\'s approval', !(w.notices || []).length);
}
{
  const w = fakeWorld({ locations: [location('1', 'A', ''), location('2', 'B', '')], tokenRow: await tokenRow(), site: { client_id: CLIENT, edition: 'presence', custom_domain: 'gamma.com', netlify_site_id: null } });
  await readProvider(SITE, 'google_business_profile', 'your Google listing');
  const note = (w.notices || []).flat()[0];
  ok('provider: a step the customer can take becomes the notice, in those words, not "reconnect"', !!note && /Choose which Google listing/.test(note.body || JSON.stringify(note)) && !/reconnect/i.test(note.headline || ''), JSON.stringify(note));
}
{
  const w = fakeWorld({ accountsStatus: 401, tokenRow: await tokenRow(), site: { client_id: CLIENT, edition: 'presence', custom_domain: 'gamma.com', netlify_site_id: null } });
  await readProvider(SITE, 'google_business_profile', 'your Google listing');
  const note = (w.notices || []).flat()[0];
  ok('provider: a truly lapsed permission still says reconnect', !!note && /reconnect/i.test(note.headline || ''), JSON.stringify(note));
}

// ═══ 5. the picker routes ═══
const site = { id: SITE, client_id: CLIENT, status: 'live', last_published_at: '2026-01-01', template_slug: 't', template_version: '1', custom_domain: 'marlowskitchen.example', netlify_site_id: null, edition: 'presence' };
const principal = { user: { id: 'u' }, email: 'o@example.com' };
const body = async (r) => ({ status: r.status, j: await r.json() });
const post = (b) => new Request('http://x/', { method: 'POST', body: JSON.stringify(b) });
{
  fakeWorld({ locations: [location('1', 'A', ''), location('2', 'B', '')], tokenRow: await tokenRow() });
  const { status, j } = await body(await handleConnectionProperties(site, 'google_business_profile', {}));
  ok('picker: lists real listings with an address to tell them apart', status === 200 && j.data.properties.length === 2 && j.data.properties[0].address === '12 Main St, Pasadena, CA' && j.data.selected === null);
}
{
  fakeWorld({ tokenRow: null });
  const { status, j } = await body(await handleConnectionProperties(site, 'google_business_profile', {}));
  ok('picker: not connected says what to do first', status === 409 && j.error === 'not_connected');
}
{
  const w = fakeWorld({ locations: [location('1', 'A', ''), location('2', 'B', '')], tokenRow: await tokenRow() });
  const { status, j } = await body(await handleConnectionPropertySelect(post({ property_id: 'locations/2' }), site, 'google_business_profile', principal, {}));
  ok('pick: records the location AND the account the reviews path needs', status === 200 && w.config.location_id === 'locations/2' && w.config.account === 'accounts/456' && w.config.auto_selected === false && /Reading B/.test(j.data.message));
  await settle();
  ok('pick: then reads the listing it picked', w.connected?.data?.listing_name === 'B');
}
{
  const w = fakeWorld({ locations: [location('1', 'A', '')], tokenRow: await tokenRow() });
  const { status } = await body(await handleConnectionPropertySelect(post({ property_id: 'locations/99' }), site, 'google_business_profile', principal, {}));
  ok('pick: a listing the account can\'t see is refused, nothing recorded', status === 422 && !w.config.location_id);
}
{
  const w = fakeWorld({ tokenRow: await tokenRow() });
  const { status } = await body(await handleConnectionPropertySelect(post({ property_id: '../../evil' }), site, 'google_business_profile', principal, {}));
  ok('pick: a malformed id never reaches Google', status === 422 && !w.calls.some((c) => c.includes('googleapis')));
}
{
  fakeWorld({ tokenRow: await tokenRow() });
  const { status } = await body(await handleConnectionProperties(site, 'google_search_console', {}));
  ok('picker: Search Console has no picker (the domain decides)', status === 404);
}

// ═══ 6. Search Console: connecting produces numbers ═══
const gscSite = { id: SITE, client_id: CLIENT, custom_domain: 'marlowskitchen.example', netlify_site_id: null, edition: 'presence' };
// `latest` is the month the read is about: 40 clicks there, 10 in every earlier one.
const gscAnswers = (reply, latest = gscMonthWindow(NOW).period) => (prop, q) => {
  if (prop !== 'sc-domain:marlowskitchen.example') return reply(403, {});
  if (q.dimensions?.length) return reply(200, { rows: [{ keys: [q.dimensions[0] === 'query' ? 'wine bar pasadena' : 'https://marlowskitchen.example/menu/'], clicks: 9, impressions: 100, position: 3.2 }] });
  return reply(200, { rows: [{ clicks: q.startDate.startsWith(latest) ? 40 : 10, impressions: 400, ctr: 0.1, position: 5 }] });
};
{
  const w = fakeWorld({ tokenRow: await tokenRow() });
  w.gsc = (p, q, reply) => gscAnswers(reply)(p, q);
  const r = await syncGscForSite(gscSite, NOW, null, { backfill: true });
  ok('gsc: the totals come back for the connection card', r.ok === true && r.totals.clicks === 40);
  const months = new Set(w.signals.filter((s) => s.metric === 'search_clicks').map((s) => s.period));
  ok('gsc: a first read fills in a year of earlier months', months.size === 13 && months.has('2026-10') && months.has('2025-10'));
  ok('gsc: page detail lands for the per-page table', w.terms.some((t) => t.dimension === 'page' && t.key.includes('/menu/')));
}
{
  const w = fakeWorld({ tokenRow: await tokenRow(), existingSignals: [{ period: '2026-08' }, { period: '2026-09' }, { period: '2026-10' }] });
  w.gsc = (p, q, reply) => gscAnswers(reply)(p, q);
  await syncGscForSite(gscSite, NOW, null, { backfill: true });
  ok('gsc: a client with history doesn\'t re-query the year', new Set(w.signals.map((s) => s.period)).size === 1);
}
{
  const w = fakeWorld({ tokenRow: await tokenRow() });
  w.gsc = (p, q, reply) => (q.startDate.startsWith('2026-10') ? gscAnswers(reply)(p, q) : reply(200, { }));
  await syncGscForSite(gscSite, NOW, null, { backfill: true });
  ok('gsc: months before the site was on Google stay absent, not a flat zero', new Set(w.signals.map((s) => s.period)).size === 1);
}
{
  const w = fakeWorld({ tokenRow: await tokenRow() });
  w.gsc = (_p, _q, reply) => reply(403, {});
  const r = await syncGscForSite(gscSite, NOW, null);
  ok('gsc: the wrong Google account is told what it can see', r.ok === false && /It can see someone-else\.com/.test(r.attention) && /someone-else/.test(w.statuses.at(-1)?.last_error));
}
{
  const w = fakeWorld({ tokenRow: await tokenRow() });
  w.gsc = (_p, _q, reply) => reply(500, {});
  const r = await syncGscForSite(gscSite, NOW, null);
  ok('gsc: Google having trouble is NOT reported as a missing property', r.ok === false && r.status === 500 && !r.attention);
}
{
  const w = fakeWorld({ tokenRow: await tokenRow(), site: { id: SITE, client_id: CLIENT, custom_domain: 'marlowskitchen.example', netlify_site_id: null, edition: 'presence' } });
  // readProvider takes no clock, so this read is about last month by the wall clock.
  // Pinned to October 2026, this failed every run from Dec 1 2026.
  w.gsc = (p, q, reply) => gscAnswers(reply, gscMonthWindow(new Date()).period)(p, q);
  const data = await readProvider(SITE, 'google_search_console', 'how you show up in Google Search');
  ok('gsc: connecting (the same read) caches real numbers, not a site list', data?.search_clicks === 40 && data?.search_impressions === 400 && w.connected?.data?.search_clicks === 40);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ GOOGLE READS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
