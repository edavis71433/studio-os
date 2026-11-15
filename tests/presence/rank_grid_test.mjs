// ── Builder list item 185: the map rank grid ──
//   deno run --allow-read --allow-env tests/presence/rank_grid_test.mjs
// For a client and a search ("plumber"), where the business comes up on Google Maps from a
// grid of spots around it. Every spot asks Google for place ids only (free); one location
// look-up a scan costs half a cent; names are asked for when shown and never kept. Off until
// the studio switches it on; once a month on the 1st, plus three "Scan now" a day. Google and
// the database are both scripted here: nothing in this file reaches Google.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', PLACES_KEY: 'places-test-key' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));
const G = await import(`${P}/lib/rank_grid.ts`);
const NOV = '2026-11-12T09:00:00.000Z';
const ME = 'ChIJ_copperline_plumbing_01';

// ── 1. the setting ──
{
  const n = G.normalizeGridSetting({ enabled: 'yes', phrases: [' plumber ', 'Plumber', 'x', 'emergency plumber', 'water heater repair', 'drain cleaning'], size: 9, spacing: 3, place: { id: 'bad id!' } });
  eq('setting: anything stored reads safely (off, three searches each once, 7 by 7, a mile apart, no place)', [n.enabled, n.phrases, n.size, n.spacing, n.place], [false, ['plumber', 'emergency plumber', 'water heater repair'], 7, 1, null]);
  const base = G.normalizeGridSetting({});
  const refused = (b) => G.applyGridChange(base, b, 'eric@x', NOV).error || '';
  ok('change: switching on needs the business confirmed first, said in words', /Confirm the business on Google first/.test(refused({ enabled: true })));
  const placed = { ...base, place: { id: ME, source: 'listing', confirmed_by: 'e', confirmed_at: NOV } };
  ok('change: …and a search to scan', /Add a search/.test(G.applyGridChange(placed, { enabled: true }, 'e', NOV).error || ''));
  ok('change: four searches, a 9 by 9 grid, 3 miles apart and a one-letter search are refused', [{ phrases: ['a1', 'b1', 'c1', 'd1'] }, { size: 9 }, { spacing: 3 }, { phrases: ['a'] }].every((b) => !!refused(b)));
  const on = G.applyGridChange(placed, { enabled: true, phrases: ['plumber', ' Plumber '], size: 5, spacing: 0.5 }, 'eric@x', NOV);
  eq('change: on, one search (any case once), 5 by 5, half a mile apart, who and when', [on.enabled, on.phrases, on.size, on.spacing, on.updated_by, on.updated_at], [true, ['plumber'], 5, 0.5, 'eric@x', NOV]);
  ok('change: the last search can’t go while the grid is on', !!G.applyGridChange(on, { phrases: [] }, 'e', NOV).error);
  const handled = { ...placed, phrases: ['plumber'], month: '2026-11' };
  eq('change: switching on again makes this month’s scan due at once', G.applyGridChange(handled, { enabled: true }, 'e', NOV).month, null);
  ok('due: on, with a business and a search, and this month not handled', G.gridDueNow({ ...on, month: '2026-10' }, NOV) && !G.gridDueNow({ ...on, month: '2026-11' }, NOV) && !G.gridDueNow({ ...on, enabled: false }, NOV) && !G.gridDueNow({ ...on, place: null }, NOV));
  const t1 = G.afterGridFailure({ ...on, month: '2026-11' }, '2026-11', '2026-10', 'google_unreachable', NOV);
  eq('failure: the month is given back for a later tick', [t1.month, t1.tries], ['2026-10', { month: '2026-11', count: 1 }]);
  const t3 = G.afterGridFailure({ ...on, month: '2026-11', tries: { month: '2026-11', count: 2 } }, '2026-11', '2026-10', 'google_refused', NOV);
  eq('failure: the third in a month is the last, and says why', [t3.month, t3.last_result.status, t3.last_result.reason], ['2026-11', 'failed', 'google_refused']);
  eq('next scan: the 1st of next month', [G.nextScanDay(NOV), G.nextScanDay('2026-12-31T23:00:00Z')], ['Dec 1', 'Jan 1']);
}

// ── 2. the grid of spots ──
{
  const c = { lat: 34.18, lng: -118.33 };
  const pts = G.gridPoints(c, 7, 1);
  const mid = pts.find((p) => p.r === 3 && p.c === 3);
  eq('grid: 7 by 7 is 49 spots, the middle one is the business', [pts.length, mid.lat, mid.lng], [49, 34.18, -118.33]);
  const north = pts.find((p) => p.r === 2 && p.c === 3), east = pts.find((p) => p.r === 3 && p.c === 4);
  const miles = (a, b) => { const R = 3958.8, t = (d) => d * Math.PI / 180; const dl = t(b.lat - a.lat), dg = t(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  ok('grid: row 0 is north, column 0 is west', north.lat > c.lat && east.lng > c.lng && pts[0].lat > c.lat && pts[0].lng < c.lng);
  ok('grid: a mile between spots, north and east alike', Math.abs(miles(mid, north) - 1) < 0.01 && Math.abs(miles(mid, east) - 1) < 0.01, `${miles(mid, north)} ${miles(mid, east)}`);
  eq('grid: 5 by 5 at half a mile is 25 spots, 2 miles across', [G.gridPoints(c, 5, 0.5).length, Math.round(miles(G.gridPoints(c, 5, 0.5)[0], G.gridPoints(c, 5, 0.5)[4]) * 10) / 10], [25, 2]);
  eq('lean: half the gap, between 400 m and 2 km', [G.biasRadius(0.5), G.biasRadius(1), G.biasRadius(2)], [402, 805, 1609]);
  eq('words: where a spot is', [G.spotWords(5, 0, 7, 1), G.spotWords(3, 3, 7, 1), G.spotWords(0, 2, 5, 0.5), G.spotWords(2, 3, 5, 0.5), G.spotWords(4, 4, 5, 2)], ['2 miles south, 3 miles west', 'the business’s own spot', '1 mile north', 'half a mile east', '4 miles south, 4 miles east']);
}

// ── 3. reading a scan ──
{
  eq('rank: the place in the list, from 1; absent or past 20 is none', [G.rankIn(['a', ME, 'c'], ME), G.rankIn(['a', 'b'], ME), G.rankIn([...Array(25).keys()].map((i) => i === 22 ? ME : 'x' + i), ME)], [2, null, null]);
  eq('bands: top 3, 4 to 10, 11 to 20, not in the top 20', [1, 3, 4, 10, 11, 20, null].map(G.bandOf), ['top3', 'top3', 'top10', 'top10', 'top20', 'top20', 'out']);
  const pts = [{ r: 0, c: 0, rank: 1, top: [ME, 'R1', 'R2'] }, { r: 0, c: 1, rank: 4, top: ['R1', 'R2', 'R3'] }, { r: 1, c: 0, rank: null, top: ['R1', 'R3', 'R2'] }, { r: 1, c: 1, rank: null, top: [], err: true }];
  eq('summary: a spot Google didn’t answer counts in none of the numbers', G.summarize(pts), { total: 4, read: 3, top3: 1, top10: 2, found: 2, out: 1, avg: 2.5 });
  eq('rivals: first at the most spots, then in the top 3 at the most; never the business itself', G.rivalsOf(pts, ME), [{ id: 'R1', first: 2, top3: 3 }, { id: 'R2', first: 0, top3: 3 }, { id: 'R3', first: 0, top3: 2 }]);
  eq('cost: spots are free, the location look-up half a cent, a name 1.7 cents, finding 3.2 cents', [G.scanCost({ ids_only: 49, location: 1 }), G.scanCost({ names: 3 }), G.scanCost({ finds: 1 })], [0.005, 0.051, 0.032]);
  eq('cost in words', [G.costWords(0), G.costWords(0.005), G.costWords(0.01), G.costWords(0.015), G.costWords(0.051), G.costWords(1.2)], ['Free', 'half a cent', '1 cent', '1½ cents', '5 cents', '$1.20']);
  eq('prices: dated, with where they were read', [G.PRICES.as_of, G.PRICES.source], ['2026-11-12', 'https://developers.google.com/maps/billing-and-pricing/pricing']);
  eq('place id from a listing’s review link', [G.placeIdFromReviewUri(`https://search.google.com/local/writereview?placeid=${ME}`), G.placeIdFromReviewUri('https://example.com/?placeid=no'), G.placeIdFromReviewUri('')], [ME, null, null]);
  ok('links that cost nothing: a place, and a search from a spot', G.mapsPlaceUrl(ME) === `https://www.google.com/maps/place/?q=place_id:${ME}` && G.mapsSpotUrl('water heater', 34.1, -118.2) === 'https://www.google.com/maps/search/water%20heater/@34.1,-118.2,14z');
}

// ── the scripted world: Google and the database ──
const SITE = '11111111-1111-4111-8111-111111111111';
const CENTER = { lat: 34.18, lng: -118.33 };
let google = [], googleDown = false, googleRefuses = false, rateOk = true, quotaLeft = Infinity;
let grid = null, scans = [], patches = [], listingUri = null, pasted = null, failSpots = 0, meHidden = false, noAddress = false;
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
// at each spot the business comes up lower the farther the spot is from it: 1 at home, 6 a mile out, gone past four miles
const distMiles = (lat, lng) => Math.hypot((lat - CENTER.lat) * 69.05, (lng - CENTER.lng) * 69.05 * Math.cos(CENTER.lat * Math.PI / 180));
const fakeGoogle = async (url, init = {}) => {
  const u = new URL(url); const mask = (init.headers || {})['X-Goog-FieldMask'] || ''; const key = (init.headers || {})['X-Goog-Api-Key'];
  google.push({ path: u.pathname, mask, key, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  if (googleDown) throw new TypeError('network down');
  if (googleRefuses) return reply({ error: { status: 'PERMISSION_DENIED' } }, 403);
  if (u.pathname === '/v1/places:searchText' && quotaLeft-- <= 0) return reply({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'SearchTextRequest' and limit 'SearchTextRequest per day'" } }, 429);
  if (u.pathname === '/v1/places:searchText' && mask === 'places.id') {
    const at = JSON.parse(init.body).locationBias.circle.center;
    if (failSpots > 0) { failSpots--; return reply({ error: {} }, 500); }
    const rank = 1 + Math.round(distMiles(at.latitude, at.longitude) * 5);
    const ids = Array.from({ length: 20 }, (_, i) => `ChIJ_rival_${String.fromCharCode(65 + (i + Math.round(at.latitude * 100)) % 26)}${i}`);
    if (rank <= 20) ids[rank - 1] = ME;
    return reply({ places: ids.map((id) => ({ id })) });
  }
  if (u.pathname === '/v1/places:searchText' && mask === 'places.location') return reply({ places: JSON.parse(init.body).textQuery.includes('Burbank') ? [{ location: { latitude: CENTER.lat, longitude: CENTER.lng } }] : [] });
  if (u.pathname === '/v1/places:searchText') return reply({ places: [{ id: ME, displayName: { text: 'Copperline Plumbing' }, formattedAddress: '4410 W Olive Ave, Burbank, CA 91505', primaryTypeDisplayName: { text: 'Plumber' }, googleMapsUri: 'https://maps.google.com/?cid=1' }, { id: 'ChIJ_other_place_0002', displayName: { text: 'Copper Line Electric' }, formattedAddress: '233 E Magnolia Blvd, Burbank', primaryTypeDisplayName: { text: 'Electrician' } }] });
  const id = decodeURIComponent(u.pathname.replace('/v1/places/', ''));
  if (mask === 'location') return id === ME ? reply(meHidden ? {} : { location: { latitude: CENTER.lat, longitude: CENTER.lng } }) : reply({}, 404);   // a business that hides its address has no location
  if (mask === 'id,movedPlaceId') return id.startsWith('ChIJ_') ? reply(id === 'ChIJ_old_moved_place' ? { id, movedPlaceId: ME } : { id }) : reply({ error: {} }, 404);
  if (mask === 'displayName,shortFormattedAddress,googleMapsUri') return reply({ displayName: { text: `Name of ${id.slice(-3)}` }, shortFormattedAddress: '1 Main St, Burbank', googleMapsUri: `https://maps.google.com/?cid=${id.length}` });
  return reply({}, 400);
};
G.placesDeps.fetch = fakeGoogle;
const dbWrites = () => patches.length + scans.length;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'stub.local') return reply({ error: 'outside' }, 599);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search); const m = (init.method || 'GET').toUpperCase();
  if (table === 'rpc/rate_hit') return reply(rateOk);
  if (table === 'presence_sales_templates') {
    const named = m === 'POST' ? JSON.parse(init.body).name === '__rank_grid__' : (q.includes('__rank_grid__') || q.includes('id=eq.g'));
    if (!named) return reply([]);
    if (m === 'GET') return reply(grid ? [{ id: 'g', site_id: SITE, body: grid.body, updated_at: grid.updated_at }] : []);
    if (m === 'POST') { grid = { body: JSON.parse(init.body).body, updated_at: 't' + Math.random() }; return reply([{ id: 'g' }], 201); }
    if (m === 'PATCH') { grid = { body: JSON.parse(init.body).body, updated_at: 't' + Math.random() }; return reply([{ id: 'g' }]); }
  }
  if (table === 'presence_rank_grid_scans') {
    if (scansMissing) return reply({ code: 'PGRST205', message: 'Could not find the table' }, 404);
    if (m === 'POST') { const row = { id: `00000000-0000-4000-8000-${String(scans.length + 1).padStart(12, '0')}`, ...JSON.parse(init.body) }; scans.push(row); return reply([row], 201); }
    if (m === 'PATCH') { patches.push({ q, body: JSON.parse(init.body) }); return reply(null, 204); }
    let list = scans.filter((s) => !q.includes('site_id=eq.') || q.includes(`site_id=eq.${s.site_id}`));
    const inIds = /id=in\.\(([^)]*)\)/.exec(q); if (inIds) list = list.filter((s) => inIds[1].split(',').includes(s.id));
    const kind = /kind=eq\.(\w+)/.exec(q); if (kind) list = list.filter((s) => s.kind === kind[1]);
    const gte = /scanned_at=gte\.([^&]+)/.exec(q); if (gte) list = list.filter((s) => Date.parse(s.scanned_at) >= Date.parse(gte[1]));
    return reply(list.slice().sort((a, b) => Date.parse(b.scanned_at) - Date.parse(a.scanned_at)));
  }
  if (table === 'presence_connected_data') return reply(listingUri ? [{ data: { listing_review_uri: listingUri } }] : []);
  if (table === 'presence_identity') return reply([{ business_name: 'Copperline Plumbing', google_place_id: pasted }]);
  if (table === 'presence_locations') return reply(noAddress ? [] : [{ address_line1: '4410 W Olive Ave', city: 'Burbank', region: 'CA', postal_code: '91505' }]);
  return reply([]);
};
let scansMissing = false;
const reset = (s) => { grid = s ? { body: JSON.stringify(s), updated_at: 't0' } : null; scans = []; patches = []; google = []; googleDown = false; googleRefuses = false; rateOk = true; listingUri = null; pasted = null; failSpots = 0; scansMissing = false; meHidden = false; noAddress = false; quotaLeft = Infinity; Deno.env.set('PLACES_KEY', 'places-test-key'); };
const stored = () => G.normalizeGridSetting(JSON.parse(grid.body));
const ON = { enabled: true, phrases: ['plumber', 'emergency plumber'], size: 7, spacing: 1, place: { id: ME, source: 'listing', confirmed_by: 'e', confirmed_at: NOV }, month: '2026-10' };

// ── 4. one scan, as Google sees it ──
{
  reset();
  const r = await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber');
  const spotCalls = google.filter((g) => g.path === '/v1/places:searchText');
  ok('scan: 49 spot searches and one location look-up, all with the key', r.ok && spotCalls.length === 49 && google.filter((g) => g.mask === 'location').length === 1 && google.every((g) => g.key === 'k'));
  ok('scan: every spot asks for place ids ONLY, the free level', spotCalls.every((g) => g.mask === 'places.id'));
  ok('scan: every spot leans on a circle around itself, for the words the customer types', spotCalls.every((g) => g.body.textQuery === 'plumber' && g.body.locationBias.circle.radius === 805 && g.body.pageSize === 20));
  ok('scan: businesses that hide their address are asked for too (Text Search leaves them out otherwise)', spotCalls.every((g) => g.body.includePureServiceAreaBusinesses === true));
  const mid = r.points.find((p) => p.r === 3 && p.c === 3), corner = r.points.find((p) => p.r === 0 && p.c === 0);
  eq('scan: first at home; sixth a mile out; not in the top 20 at the far corner', [mid.rank, r.points.find((p) => p.r === 2 && p.c === 3).rank, corner.rank], [1, 6, null]);
  ok('scan: the first three ids at each spot are kept for who comes up ahead', r.points.every((p) => p.top.length === 3) && mid.top[0] === ME);
  eq('scan: what it asked for, centred on the business’s own pin', [r.requests, r.from], [{ ids_only: 49, location: 1, address: 0, from: 'place' }, 'place']);
  reset(); failSpots = 5;
  const holes = await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber');
  ok('scan: a few spots Google didn’t answer are marked, not guessed', holes.ok && holes.points.filter((p) => p.err).length === 5 && holes.points.filter((p) => p.err).every((p) => p.rank === null && p.top.length === 0));
  reset(); failSpots = 13;
  eq('scan: more than a quarter missing fails, rather than show a grid with holes', (await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber')).reason, 'too_many_gaps');
  reset(); googleDown = true;
  eq('scan: Google out of reach fails at the location look-up, with nothing else asked', [(await G.scanGrid('k', { size: 5, spacing: 1, placeId: ME }, 'plumber')).reason, google.length], ['google_unreachable', 1]);
  // a business that hides its address on Google (a service-area business, like the studio's own listing)
  reset(); meHidden = true;
  const hid = await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber', { address: '4410 W Olive Ave, Burbank, CA 91505' });
  const look = google.find((g) => g.mask === 'places.location');
  ok('hidden address: the grid centres on the address in the business details, looked up once', hid.ok && hid.from === 'address' && hid.center.lat === CENTER.lat && look && look.body.textQuery === '4410 W Olive Ave, Burbank, CA 91505' && look.body.pageSize === 1);
  eq('hidden address: what it asked for', hid.requests, { ids_only: 49, location: 1, address: 1, from: 'address' });
  eq('hidden address: it costs about 3.7 cents', [G.scanCost(hid.requests), G.costWords(G.scanCost(hid.requests))], [0.037, '3½ cents']);
  reset(); meHidden = true;
  eq('hidden address, none on file: no centre, said so, nothing else asked', [(await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber')).reason, google.length], ['no_center', 1]);
  reset(); meHidden = true;
  eq('hidden address, an address Google can’t find: no centre', (await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber', { address: 'Nowhere at all' })).reason, 'no_center');
  // Google's daily allowance for text searches (found Nov 12 2026 on the platform's own project)
  reset(); quotaLeft = 10;
  const q = await G.scanGrid('k', { size: 7, spacing: 1, placeId: ME }, 'plumber');
  eq('daily limit: the scan stops at the first sign of it, told apart from a refusal', [q.reason, google.filter((g) => g.path === '/v1/places:searchText').length], ['google_quota', 14]);
  reset(); googleRefuses = true;
  eq('a refusal is still a refusal', (await G.searchIdsAt('k', 'plumber', CENTER, 805)).reason, 'google_refused');
}

// ── 5. the monthly job ──
const J = await import(`${P}/ops/rank_grid_scans.ts`);
{
  reset({ ...ON, enabled: false });
  eq('job: switched off, nothing is asked of Google and nothing is kept', [await J.runRankGridScans(1, NOV), google.length, scans.length], [{ scanned: 0, failed: 0, skipped: 1 }, 0, 0]);
  reset(ON);
  const r = await J.runRankGridScans(1, NOV);
  eq('job: one client, every search scanned and kept, the month handled', [r, scans.map((s) => [s.phrase, s.kind]), stored().month, stored().last_result.status], [{ scanned: 1, failed: 0, skipped: 0 }, [['plumber', 'monthly'], ['emergency plumber', 'monthly']], '2026-11', 'scanned']);
  const row = scans[0];
  eq('job: a row holds ranks (0 = not in the top 20), the first three ids, the rivals by id and the cost', [row.ranks.length, row.ranks[24], row.ranks[0], row.tops.length, row.tops[24][0], row.cost_usd, row.requests], [49, 1, 0, 49, ME, 0.005, { ids_only: 49, location: 1, address: 0, from: 'place' }]);
  ok('job: no Google name or address is ever stored', !/displayName|formattedAddress|"name"|Copperline Plumbing|Burbank/.test(JSON.stringify(scans)));
  ok('job: the rivals are place ids with counts', row.rivals.length > 0 && row.rivals.every((x) => /^ChIJ_rival_/.test(x.id) && Number.isInteger(x.first) && Number.isInteger(x.top3)));
  ok('job: the summary columns match the ranks', row.total === 49 && row.found === row.ranks.filter((v) => v > 0).length && row.top3 === row.ranks.filter((v) => v >= 1 && v <= 3).length);
  ok('job: no address is asked for while Google shows the business’s own pin', !google.some((g) => g.mask === 'places.location'));
  const asked = google.length;
  eq('job: run again the same month, nothing more is asked', [(await J.runRankGridScans(1, NOV)).scanned, google.length], [0, asked]);
  ok('job: every run clears the centre of scans older than 30 days (Google’s rule)', patches.length >= 2 && patches.every((p) => /scanned_at=lt\.2026-10-13T09:00:00\.000Z/.test(p.q) && /center_lat=not\.is\.null/.test(p.q) && p.body.center_lat === null && p.body.center_lng === null));
}
{
  reset(ON); Deno.env.delete('PLACES_KEY');
  eq('job: without Google’s key nothing is claimed and the tick isn’t failed', [await J.runRankGridScans(1, NOV), stored().month], [{ scanned: 0, failed: 0, skipped: 1, skipped_no_key: true }, '2026-10']);
  reset(ON); scansMissing = true;
  eq('job: before migration 0209 nothing runs (nowhere to keep it)', [(await J.runRankGridScans(1, NOV)).not_ready, google.length], [true, 0]);
  reset(ON); googleDown = true;
  const r = await J.runRankGridScans(1, NOV);
  eq('job: a scan that fails gives the month back, for a later tick', [r.failed, stored().month, stored().tries], [1, '2026-10', { month: '2026-11', count: 1 }]);
  reset({ ...ON, tries: { month: '2026-11', count: 2 } }); googleDown = true;
  await J.runRankGridScans(1, NOV);
  eq('job: the third failure in a month is the last, and says why', [stored().month, stored().last_result.status, stored().last_result.reason], ['2026-11', 'failed', 'google_unreachable']);
  reset(ON);
  scans.push({ id: '00000000-0000-4000-8000-0000000000aa', site_id: SITE, phrase: 'plumber', kind: 'monthly', scanned_at: '2026-11-01T08:00:00.000Z', top3: 9 });
  await J.runRankGridScans(1, NOV);
  eq('job: a search already scanned this month (a try that stopped halfway) isn’t scanned twice', scans.filter((s) => s.kind === 'monthly').map((s) => s.phrase), ['plumber', 'emergency plumber']);
  reset(ON); meHidden = true;
  await J.runRankGridScans(1, NOV);
  eq('job: a business that hides its address scans from the address in its business details, and its cost says so', [scans.length, scans[0].requests.from, scans[0].cost_usd, google.find((g) => g.mask === 'places.location').body.textQuery], [2, 'address', 0.037, '4410 W Olive Ave, Burbank, CA 91505']);
  reset(ON); quotaLeft = 3;
  const tired = await J.runRankGridScans(1, NOV);
  eq('job: Google’s daily limit rests the job: the month given back, no try counted, nothing failed', [tired, stored().month, stored().tries, scans.length], [{ scanned: 0, failed: 0, skipped: 0, resting: true }, '2026-10', null, 0]);
  reset(ON); meHidden = true; noAddress = true;
  const none = await J.runRankGridScans(1, NOV);
  eq('job: …and with no address on file the month is given back, said as no centre', [none.failed, stored().tries.count, scans.length], [1, 1, 0]);
  const blank = await J.addressOnFile(SITE); noAddress = false;
  eq('address on file: the street, the town and the zip; nothing when there is none', [await J.addressOnFile(SITE), blank], ['4410 W Olive Ave, Burbank, CA 91505', '']);
  const { sweepIssues } = await import(`${P}/routes/system.ts`);
  eq('tick: no key, not ready, resting and quiet runs are not failures; a failed scan is', [sweepIssues({ rank_grids: { scanned: 0, failed: 0, skipped: 1, skipped_no_key: true } }), sweepIssues({ rank_grids: { scanned: 0, failed: 0, skipped: 0, not_ready: true } }), sweepIssues({ rank_grids: { scanned: 0, failed: 0, skipped: 0, resting: true } }), sweepIssues({ rank_grids: { scanned: 0, failed: 1, skipped: 0 } })], [[], [], [], ['rank_grids.failed=1']]);
}

// ── 6. the routes ──
const R = await import(`${P}/routes/rank_grid.ts`);
const site = { id: SITE, client_id: 'c', status: 'live', edition: 'presence', custom_domain: 'copperline.example' };
const owner = { kind: 'client', email: 'owner@client.example', scope: null };
const studio = { kind: 'client', email: 'eric@studio.example', scope: { site_id: SITE, name: 'Copperline' } };
const staff = { kind: 'staff', email: 'eric@studio.example', scope: null };
const seat = { kind: 'client', email: 'seat@client.example', scope: null, member: { site_id: SITE, role: 'developer' } };
const call = async (fn, ...a) => { const r = await fn(...a); return { status: r.status, body: await r.json() }; };
const put = (body) => new Request('http://x/visibility/maps', { method: 'PUT', body: JSON.stringify(body) });
const post = (body) => new Request('http://x/visibility/maps/scan', { method: 'POST', body: JSON.stringify(body) });
{
  ok('studio: platform staff and a studio scoped in; never the owner or a seat', R.isStudio(staff) && R.isStudio(studio) && !R.isStudio(owner) && !R.isStudio(seat));
  reset();
  const off = await call(R.handleMapsGet, site, owner, {});
  eq('get: the client sees nothing while it is off', off.body.data, { ready: true, studio: false, enabled: false });
  listingUri = `https://search.google.com/local/writereview?placeid=${ME}`;
  const setup = (await call(R.handleMapsGet, site, studio, {})).body.data;
  eq('get: the studio sees it off, with the business suggested from the connected listing, and the price', [setup.enabled, setup.suggested, setup.key, setup.prices.scan_words, setup.prices.hidden_words, setup.today], [false, { id: ME, source: 'listing', maps: G.mapsPlaceUrl(ME) }, true, 'half a cent', '3½ cents', { used: 0, cap: 3 }]);
  listingUri = null; pasted = 'ChIJ_pasted_for_reviews_9';
  eq('get: …or from a place id pasted for reviews', (await call(R.handleMapsGet, site, staff, {})).body.data.suggested.source, 'pasted');
  for (const [who, p] of [['the owner', owner], ['a seat', seat]]) {
    const before = dbWrites(), g0 = google.length;
    const outs = [await call(R.handleMapsPut, put({ enabled: true }), site, p, {}), await call(R.handleMapsPlace, new Request('http://x', { method: 'PUT', body: JSON.stringify({ place_id: ME }) }), site, p, {}), await call(R.handleMapsFind, new Request('http://x', { method: 'POST', body: '{}' }), site, p, {}), await call(R.handleMapsNames, new Request(`http://x/visibility/maps/names?ids=${ME}`), site, p, {}), await call(R.handleMapsScan, post({}), site, p, {})];
    ok(`writes: ${who} is refused every one, nothing written, nothing asked of Google`, outs.every((o) => o.status === 403 && o.body.error === 'forbidden') && dbWrites() === before && google.length === g0 && grid === null);
  }
}
{
  reset();
  const noPlace = await call(R.handleMapsPut, put({ enabled: true, phrases: ['plumber'] }), site, studio, {});
  eq('put: on without the business is refused in words', [noPlace.status, noPlace.body.message], [400, 'Confirm the business on Google first.']);
  const bad = await call(R.handleMapsPlace, new Request('http://x', { method: 'PUT', body: JSON.stringify({ place_id: 'not a place' }) }), site, studio, {});
  eq('place: something that isn’t a place id is refused before Google is asked', [bad.status, google.length], [400, 0]);
  const moved = await call(R.handleMapsPlace, new Request('http://x', { method: 'PUT', body: JSON.stringify({ place_id: 'ChIJ_old_moved_place', source: 'search' }) }), site, studio, {});
  eq('place: checked with the id field only (free); a place that moved keeps its new id', [moved.status, google.map((g) => g.mask), moved.body.data.place.id, moved.body.data.place.source, moved.body.data.place.confirmed_by], [200, ['id,movedPlaceId'], ME, 'search', 'eric@studio.example']);
  const gone = await call(R.handleMapsPlace, new Request('http://x', { method: 'PUT', body: JSON.stringify({ place_id: 'XYZ_unknown_place_1' }) }), site, studio, {});
  eq('place: one Google doesn’t know is refused', [gone.status, gone.body.error], [400, 'not_found']);
  const on = await call(R.handleMapsPut, put({ enabled: true, phrases: ['plumber', 'emergency plumber'] }), site, studio, {});
  eq('put: on, with two searches, the next scan named', [on.status, on.body.data.enabled, on.body.data.phrases, on.body.data.next], [200, true, ['plumber', 'emergency plumber'], G.nextScanDay(new Date().toISOString())]);
  eq('put: nothing to change is refused', (await call(R.handleMapsPut, put({}), site, studio, {})).status, 400);
  google = [];
  const found = await call(R.handleMapsFind, new Request('http://x', { method: 'POST', body: '{}' }), site, studio, {});
  eq('find: starts from the name and address on file; Google’s Pro search; about 3 cents', [found.body.data.query, google[0].mask.split(',').sort().join(','), found.body.data.found.map((f) => f.name), found.body.data.cost_words], ['Copperline Plumbing, 4410 W Olive Ave, Burbank, CA', 'places.displayName,places.formattedAddress,places.googleMapsUri,places.id,places.primaryTypeDisplayName', ['Copperline Plumbing', 'Copper Line Electric'], '3 cents']);
  ok('find: what Google found is shown, never kept', !JSON.stringify(grid).includes('Copper Line Electric') && scans.length === 0);
  ok('find: a business that hides its address can be found too', google[0].body.includePureServiceAreaBusinesses === true);
  rateOk = false;
  eq('find: ten a day', (await call(R.handleMapsFind, new Request('http://x', { method: 'POST', body: '{}' }), site, studio, {})).status, 429);
  rateOk = true; google = [];
  const names = await call(R.handleMapsNames, new Request(`http://x/visibility/maps/names?ids=ChIJ_rival_A0,ChIJ_rival_A0,bad!,ChIJ_rival_B1`), site, studio, {});
  eq('names: each id once, asked of Google now (Pro), never kept', [names.body.data.names.map((n) => n.name), google.map((g) => g.mask), names.body.data.cost_words, scans.length + patches.length], [['Name of _A0', 'Name of _B1'], ['displayName,shortFormattedAddress,googleMapsUri', 'displayName,shortFormattedAddress,googleMapsUri'], '3½ cents', 0]);
  eq('names: six at most', (await call(R.handleMapsNames, new Request(`http://x/visibility/maps/names?ids=${Array.from({ length: 9 }, (_, i) => 'ChIJ_rival_x' + i).join(',')}`), site, studio, {})).body.data.names.length, 6);
}
{
  google = [];
  const s1 = await call(R.handleMapsScan, post({ phrase: 'Plumber' }), site, studio, {});
  eq('scan now: the search asked for (any case), kept as Scan now, by whom, with its cost for the studio', [s1.status, scans[0].phrase, scans[0].kind, scans[0].created_by, s1.body.data.cost_words, s1.body.data.ranks.length], [201, 'plumber', 'now', 'eric@studio.example', 'half a cent', 49]);
  eq('scan now: not one of this client’s searches is refused', (await call(R.handleMapsScan, post({ phrase: 'electrician' }), site, studio, {})).status, 400);
  await call(R.handleMapsScan, post({ phrase: 'plumber' }), site, studio, {});
  await call(R.handleMapsScan, post({ phrase: 'emergency plumber' }), site, studio, {});
  const fourth = await call(R.handleMapsScan, post({ phrase: 'plumber' }), site, studio, {});
  eq('scan now: three a day per client, the fourth refused in words', [fourth.status, /3 scans today/.test(fourth.body.message), scans.length], [429, true, 3]);
  scans[0].scanned_at = new Date(Date.now() - 120_000).toISOString(); scans[1].scanned_at = new Date(Date.now() - 60_000).toISOString();
  scans[0].top3 = 6;
  const g = (await call(R.handleMapsGet, site, studio, {})).body.data;
  const latest = g.latest.plumber;
  ok('get: each search’s newest scan in full, with the change since the one before', latest && latest.ranks.length === 49 && latest.change.top3 === latest.top3 - 6 && g.latest['emergency plumber'].change === null);
  ok('get: the studio’s view has the rivals, the spots’ ids, the centre and the cost', latest.rivals.length === 3 && latest.tops.length === 49 && latest.center && latest.center.lat === CENTER.lat && latest.cost_words === 'half a cent');
  eq('get: today’s Scan now count, and the history newest first', [g.today, g.history.length, g.history[0].phrase], [{ used: 3, cap: 3 }, 3, 'emergency plumber']);
  const client = (await call(R.handleMapsGet, site, owner, {})).body.data;
  const cl = client.latest.plumber;
  ok('get: the client sees the grid and its numbers once it is on', client.enabled && cl.ranks.length === 49 && typeof cl.top3 === 'number' && client.history.length === 3);
  ok('get: …never a cost, a rival, a place id, where the spots are, the setup or the price', !/cost|rivals|tops|center|place_id|"place"|suggested|prices|today|"key"/.test(JSON.stringify(client)), JSON.stringify(Object.keys(cl)));
  scans[0].scanned_at = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const old = R.scanView(scans[0], true, Date.now(), null);
  eq('get: a scan over 30 days old has no centre to open spots from', old.center, null);
  googleRefuses = true;
  const refusedNow = await call(R.handleMapsScan, post({ phrase: 'plumber' }), { ...site, id: '22222222-2222-4222-8222-222222222222' }, studio, {});
  ok('scan now: other sites keep their own three a day; Google’s refusal is said in words', refusedNow.status === 409 || refusedNow.status === 502);
  googleRefuses = false; quotaLeft = 0; scans = []; grid = { body: JSON.stringify({ ...ON, phrases: ['plumber'] }), updated_at: 'tq' };
  const limit = await call(R.handleMapsScan, post({ phrase: 'plumber' }), site, studio, {});
  eq('scan now: Google’s daily limit is said as that, not as a fault', [limit.status, limit.body.error, /used up for the platform/.test(limit.body.message), scans.length], [429, 'google_quota', true, 0]);
}

// ── 7. wiring ──
{
  const src = { idx: read(`${P}/index.ts`), roles: read(`${P}/lib/site_roles.ts`), sys: read(`${P}/routes/system.ts`), store: read(`${P}/lib/reserved_store.ts`) };
  for (const [m, r, h] of [['GET', '/visibility/maps', 'handleMapsGet'], ['PUT', '/visibility/maps', 'handleMapsPut'], ['PUT', '/visibility/maps/place', 'handleMapsPlace'], ['POST', '/visibility/maps/find', 'handleMapsFind'], ['GET', '/visibility/maps/names', 'handleMapsNames'], ['POST', '/visibility/maps/scan', 'handleMapsScan']]) {
    ok(`router: ${m} ${r}`, src.idx.includes(`if (route === '${r}' && method === '${m}') return ${h}(`));
  }
  ok('roles: no seat may run it: none of its writes is on the member table', !/visibility\/maps/.test(src.roles));
  ok('scheduler: one client a run, after the monthly reports, in both tick lists', /\['monthly_reports', \(\) => runMonthlyReports\(20\)\],[^\n]*\n\s+\['rank_grids', \(\) => runRankGridScans\(1\)\],/.test(src.sys) && /await step\('monthly_reports'[^\n]*\n\s+await step\('rank_grids', \(\) => runRankGridScans\(1\)\);/.test(src.sys));
  ok('store: its own reserved name', /rankGrid: '__rank_grid__'/.test(src.store));
  for (const [name, sql] of [['migration', read('../../supabase/migrations/0209_rank_grid_scans.sql')], ['pack', read('../../docs/presence/APPLY-0209-prod.sql')]]) {
    ok(`${name}: one row a scan, closed to everyone but the function`, /create table if not exists public\.presence_rank_grid_scans/.test(sql) && /enable row level security/.test(sql) && /revoke all on public\.presence_rank_grid_scans from anon, authenticated/.test(sql) && /on delete cascade/.test(sql));
    ok(`${name}: no column for a Google name or address`, !/\b(name|display_name|address|formatted_address)\b\s+text/.test(sql));
  }
}

const failed = results.filter((r) => !r.p).length;
console.log(`rank_grid: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
