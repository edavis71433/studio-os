// ── One read, not six or seven, to learn who is asking (builder item 401) ────────
// Nov 22 review, file 14, finding 5: every signed-in answer made 6 to 7 database trips in a
// row before its own work (who is this, which studio, which client, which role, which plan),
// 338 ms at the middle. Now the answer is remembered for a minute per worker, keyed by the
// sign-in token and the client asked for, so a page's seven calls share one lookup; a write
// in this worker to any table the answer rests on forgets it at once, and a minute bounds
// what another worker can't see. Refusals are never remembered. Proven on the real router
// with the pretend PostgREST and GoTrue (nothing leaves the process), counting every call:
//   · a studio inside a client, a business owner on their own site, a Designer's seat;
//   · the first call's trips, then the second's, then seven at once;
//   · the same refusals: a Designer turned away twice, a stranger 401 twice, a seat
//     revoked in this worker refused on the very next call, one revoked elsewhere
//     within a minute (the clock is pinned);
//   · every call out of the database helpers carries a time limit.
//   deno run --allow-read --allow-env --allow-net tests/presence/who_asks_401_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock } from './clock.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const STUDIO = uuid('1'), CLIENT_SITE = uuid('2'), OWNER_CLIENT = uuid('3'), STUDIO_CLIENT = uuid('4'), AGENCY = uuid('5');
const STUDIO_USER = uuid('a'), OWNER_USER = uuid('b'), DESIGNER_USER = uuid('c'), STRANGER_USER = uuid('d');
const SITE = (id, client) => ({ id, client_id: client, status: 'live', last_published_at: null, template_slug: 'atelier', template_version: '1', custom_domain: null, netlify_site_id: null, edition: 'presence', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });

// a pinned clock: it moves only when the test says so
let NOW = Date.parse('2026-11-22T12:00:00Z');
let unpin = pinClock(NOW);

const db = installFakePostgrest({
  users: {
    'jwt-studio': { id: STUDIO_USER, email: 'studio@example.test' },
    'jwt-owner': { id: OWNER_USER, email: 'owner@example.test' },
    'jwt-designer': { id: DESIGNER_USER, email: 'designer@example.test' },
    'jwt-stranger': { id: STRANGER_USER, email: 'stranger@example.test' },
  },
  ownSite: { 'jwt-studio': STUDIO, 'jwt-owner': CLIENT_SITE },
});
const world = () => ({
  memberships: [],
  contacts: [],
  clients: [
    { id: STUDIO_CLIENT, tenant_id: uuid('9'), email: 'studio@example.test', contact_email: null },
    { id: OWNER_CLIENT, tenant_id: uuid('9'), email: 'owner@example.test', contact_email: null },
  ],
  presence_sites: [SITE(STUDIO, STUDIO_CLIENT), SITE(CLIENT_SITE, OWNER_CLIENT)],
  presence_entitlements: [
    { client_id: STUDIO_CLIENT, product: 'presence', status: 'active', plan: 'agency' },
    { client_id: OWNER_CLIENT, product: 'presence', status: 'active', plan: 'presence' },
  ],
  presence_agency_members: [{ id: uuid('6'), agency_id: AGENCY, email: 'studio@example.test', role: 'owner', user_id: STUDIO_USER, status: 'active' }],
  presence_agencies: [{ id: AGENCY, name: 'A studio', status: 'active', seat_limit: 5, client_limit: 50, plan: 'agency', branding: {} }],
  presence_agency_clients: [{ agency_id: AGENCY, site_id: CLIENT_SITE, status: 'active' }],
  presence_site_members: [{ id: uuid('7'), site_id: CLIENT_SITE, email: 'designer@example.test', user_id: DESIGNER_USER, role: 'designer', status: 'active', can_publish: false, created_at: '2026-02-01T00:00:00Z' }],
  presence_identity: [{ site_id: CLIENT_SITE, business_name: 'Maple Bakery' }, { site_id: STUDIO, business_name: 'A studio' }],
  presence_scoped_access_events: [],
});
db.reset(world());

// the real router, as client_record_test.mjs drives it
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
await quiet(() => import('../../supabase/functions/presence/index.ts'));
const { flushAfterResponse } = await import('../../supabase/functions/presence/lib/after_response.ts').catch(() => ({ flushAfterResponse: null }));
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const call = async (jwt, path, scope = '', method = 'GET') => {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  if (scope) headers['x-dds-scope-site'] = scope;
  const r = await quiet(() => send(new Request(`http://stub.local/functions/v1/presence${path}`, { method, headers })));
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
};
// the trips a call made: reads of the database and GoTrue, before the route's own read
const trips = () => db.log.filter((c) => c.method === 'GET' || c.method === 'HEAD').length;
const settle = async () => { await new Promise((r) => setTimeout(r, 5)); };   // after-response work lands

// ═══ 1. the studio inside a client: GET /identity reads presence_identity once ═══
db.reset(world());
const a1 = await call('jwt-studio', '/identity', CLIENT_SITE); await settle();
const studioFirst = trips();
ok('studio in a client: the first call answers', a1.status === 200 && a1.body?.data?.business_name === 'Maple Bakery', `${a1.status} ${a1.text.slice(0, 100)}`);
db.log = [];
const a2 = await call('jwt-studio', '/identity', CLIENT_SITE); await settle();
const studioSecond = trips();
ok('studio in a client: the second call learns who is asking from memory: 2 reads, the site row as it is now and the route\'s own', a2.status === 200 && studioSecond === 2 && db.reads('presence_sites?id=eq.').length === 1, `first ${studioFirst} trips, second ${studioSecond}: ${db.log.map((c) => c.url.split('?')[0]).join(' ')}`);
db.log = [];
const seven = await Promise.all(Array.from({ length: 7 }, () => call('jwt-studio', '/identity', CLIENT_SITE))); await settle();
ok('…and seven calls at once make fourteen reads, two each', seven.every((r) => r.status === 200) && trips() === 14, `${trips()} trips`);
ok('…the studio\'s visit inside the client is still recorded each time', db.tables.presence_scoped_access_events.length === 9 && db.tables.presence_scoped_access_events.every((e) => e.outcome === 'allowed' && e.client_name === 'Maple Bakery'), String(db.tables.presence_scoped_access_events.length));

// ═══ 2. the business owner on their own site, and a Designer's seat ═══
db.reset(world());
const b1 = await call('jwt-owner', '/identity'); await settle();
const ownerFirst = trips(); db.log = [];
const b2 = await call('jwt-owner', '/identity'); await settle();
ok('owner on their own site: first call answers, second makes 2 reads', b1.status === 200 && b2.status === 200 && trips() === 2, `first ${ownerFirst}, second ${trips()}`);
db.log = [];
const d1 = await call('jwt-designer', '/identity', CLIENT_SITE); await settle();
const designerFirst = trips(); db.log = [];
const d2 = await call('jwt-designer', '/identity', CLIENT_SITE); await settle();
ok('a Designer\'s seat: first call answers, second makes 2 reads', d1.status === 200 && d2.status === 200 && trips() === 2, `first ${designerFirst}, second ${trips()}`);
// the site row is read fresh each time: a template switched or a site deleted by another worker shows at once
{
  db.tables.presence_sites.find((s) => s.id === CLIENT_SITE).template_slug = 'harbor';
  const t = await call('jwt-studio', '/site', CLIENT_SITE);
  ok('a template switched elsewhere shows on the very next call', t.status === 200 && JSON.stringify(t.body).includes('harbor'), `${t.status} ${t.text.slice(0, 120)}`);
  db.tables.presence_sites = db.tables.presence_sites.filter((s) => s.id !== CLIENT_SITE);
  const g = await call('jwt-studio', '/identity', CLIENT_SITE);
  ok('a site deleted elsewhere is refused on the very next call', g.status === 404 || g.status === 403, `${g.status} ${g.text.slice(0, 80)}`);
  db.reset(world());
}

// ═══ 3. the same refusals ═══
const r1 = await call('jwt-designer', '/crm/record?client_id=' + OWNER_CLIENT, CLIENT_SITE);
const r2 = await call('jwt-designer', '/crm/record?client_id=' + OWNER_CLIENT, CLIENT_SITE);
ok('a Designer is turned away from the business twice, from memory too', r1.status === 403 && r1.body?.role === 'designer' && r2.status === 403 && r2.body?.role === 'designer', `${r1.status} ${r2.status}`);
const s1 = await call('jwt-stranger', '/identity', CLIENT_SITE);
db.log = [];
const s2 = await call('jwt-stranger', '/identity', CLIENT_SITE);
ok('a signed-in stranger is refused twice, and a refusal is never remembered (looked up again)', s1.status === 401 && s2.status === 401 && trips() > 1, `${s1.status} ${s2.status} ${trips()} trips`);
const n1 = await call(null, '/identity', CLIENT_SITE);
ok('no sign-in is a 401', n1.status === 401);
const w1 = await call('jwt-owner', '/identity', STUDIO);
const w2 = await call('jwt-owner', '/identity', STUDIO);
ok('an owner asking for a site that isn\'t theirs is refused twice', w1.status === 403 && w2.status === 403, `${w1.status} ${w2.status}`);

// a seat revoked in this worker: the next call is refused, however fresh the memory
{
  const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
  await svc(`presence_site_members?id=eq.${uuid('7')}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) });
  const d3 = await call('jwt-designer', '/identity', CLIENT_SITE);
  ok('a seat revoked in this worker is refused on the very next call (no seat, no sign-in here: 401, as before)', d3.status === 401 && d3.body?.error === 'unauthorized', `${d3.status} ${d3.text.slice(0, 80)}`);
}
// a client removed from the studio elsewhere (not through this worker): within a minute
{
  db.reset(world());
  const ok1 = await call('jwt-studio', '/identity', CLIENT_SITE); await settle();
  db.tables.presence_agency_clients[0].status = 'archived';   // changed by another worker: no write seen here
  const still = await call('jwt-studio', '/identity', CLIENT_SITE); await settle();
  unpin(); NOW += 61_000; unpin = pinClock(NOW);
  const gone = await call('jwt-studio', '/identity', CLIENT_SITE); await settle();
  ok('a client removed elsewhere: still answered inside the minute, refused after it', ok1.status === 200 && still.status === 200 && gone.status === 403 && gone.body?.error === 'scope_denied', `${ok1.status} ${still.status} ${gone.status}`);
  ok('…and that refusal is recorded as the studio\'s denied visit', db.tables.presence_scoped_access_events.some((e) => e.outcome === 'denied'));
}
// a paused subscription bites within the minute too, and a write here at once
{
  db.reset(world());
  const first = await call('jwt-owner', '/identity', '', 'GET'); await settle();
  const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
  await svc(`presence_entitlements?client_id=eq.${OWNER_CLIENT}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
  const paused = await call('jwt-owner', '/identity', '', 'PUT');
  ok('a subscription paused in this worker: the next write is refused', first.status === 200 && paused.status === 403 && paused.body?.error === 'entitlement_paused', `${first.status} ${paused.status} ${paused.text.slice(0, 80)}`);
}

// ═══ 4. the numbers, and the time limit ═══
console.log(`\nTRIPS before the route's own read — studio in a client: ${studioFirst - 1} cold, ${studioSecond - 1} warm; owner: ${ownerFirst - 1} cold; designer: ${designerFirst - 1} cold`);
ok('the first call still needs its chain (at least 5 trips cold)', studioFirst - 1 >= 5, String(studioFirst - 1));
{
  const dbTs = Deno.readTextFileSync(new URL('../../supabase/functions/presence/lib/db.ts', import.meta.url));
  const authTs = Deno.readTextFileSync(new URL('../../supabase/functions/_shared/auth.ts', import.meta.url));
  ok('every database call from the helpers carries a 10-second limit', /DB_TIMEOUT_MS = 10_000/.test(dbTs) && (dbTs.match(/AbortSignal\.timeout\(DB_TIMEOUT_MS\)/g) || []).length >= 3 && /AbortSignal\.timeout\(/.test(authTs));
}

unpin();
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
Deno.exit(0);
