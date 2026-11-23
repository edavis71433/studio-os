// ── Builder item 387: what a studio's client may do on their own site ───────────
//   deno run --allow-read --allow-env --allow-net tests/presence/studio_holds_387_test.mjs
// A studio's client owns their site record, so the server took their own sign-in for Publish,
// Take offline, the template, the domain and inviting people (Nov 22 2026 review, file 05
// finding 9). Now the studio keeps those unless it switches "They can publish and run their
// website" on for that client. Drives the real router (index.ts) on the in-memory PostgREST:
//   1  which requests are the studio's: going live, offline, template, domain, people; reads never
//   2  a studio's client, switched off: each refused in plain words; the draft still edits
//   3  switched on: let through; a business no studio looks after: let through
//   4  the studio's own people, signed in on the client's site, aren't held; the client's seats are
//   5  an unreadable link refuses; a database before migration 0265 reads as off
//   6  the studio's switch: any seat reads it, a manager changes it, another studio's site is 404
import { installFakePostgrest } from './fake_pgrst.mjs';

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('a'), SOLO = uuid('b'), OTHER_SITE = uuid('c'), AGENCY = uuid('d'), OTHER_AGENCY = uuid('e');
const U = { owner: uuid('1'), solo: uuid('2'), seat: uuid('3'), insider: uuid('4') };
const USERS = {
  'jwt-owner': { id: U.owner, email: 'owner@bakery.example' },
  'jwt-solo': { id: U.solo, email: 'owner@solo.example' },
  'jwt-seat': { id: U.seat, email: 'helper@bakery.example' },
  'jwt-insider': { id: U.insider, email: 'designer@studio.example' },
};
const db = installFakePostgrest({ users: USERS, ownSite: { 'jwt-owner': SITE, 'jwt-solo': SOLO, 'jwt-insider': SITE } });
Deno.env.delete('RESEND_API_KEY'); Deno.env.delete('OPS_ALERT_EMAIL');
const site = (id, client) => ({ id, client_id: client, status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' });
const seed = () => {
  db.tables.presence_sites = [site(SITE, 'client-a'), site(SOLO, 'client-b'), site(OTHER_SITE, 'client-c')];
  db.tables.presence_entitlements = ['client-a', 'client-b', 'client-c'].map((c) => ({ client_id: c, product: 'presence', plan: 'presence', status: 'active' }));
  db.tables.clients = [
    { id: 'client-a', email: 'owner@bakery.example', tenant_id: 'tenant-1', name: 'Bakery' },
    { id: 'client-b', email: 'owner@solo.example', tenant_id: 'tenant-1', name: 'Solo' },
    { id: 'client-i', email: 'designer@studio.example', tenant_id: 'tenant-1', name: 'Insider' },
  ];
  db.tables.presence_site_members = [{ id: uuid('5'), site_id: SITE, email: 'helper@bakery.example', user_id: U.seat, role: 'business_staff', status: 'active', created_at: '2026-11-01T00:00:00Z' }];
  db.tables.presence_agencies = [{ id: AGENCY, name: 'Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }, { id: OTHER_AGENCY, name: 'Other', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }];
  db.tables.presence_agency_members = [{ id: uuid('6'), agency_id: AGENCY, email: 'designer@studio.example', user_id: U.insider, role: 'designer', status: 'active' }];
  db.tables.presence_agency_clients = [
    { site_id: SITE, agency_id: AGENCY, status: 'active', client_runs_site: false },
    { site_id: OTHER_SITE, agency_id: OTHER_AGENCY, status: 'active', client_runs_site: false },
  ];
};
seed();

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const H = await import('../../supabase/functions/presence/lib/studio_holds.ts');

// ═══ 1. which requests are the studio's ═══
{
  const cases = [
    ['POST', '/publish', 'publish'], ['POST', '/restore', 'publish'], ['POST', '/schedule', 'publish'], ['POST', '/preview/publish', 'publish'], ['POST', '/preview/promote', 'publish'],
    ['POST', '/site/coming-soon', 'publish'], ['POST', `/launches/${uuid('7')}/promote`, 'publish'], ['POST', `/launches/${uuid('7')}/schedule`, 'publish'],
    ['POST', '/site/offline', 'offline'], ['POST', '/site/online', 'offline'], ['POST', '/site/password', 'offline'],
    ['PUT', '/site/template', 'template'], ['POST', '/foundations/domain', 'domain'], ['DELETE', '/foundations/domain', 'domain'], ['POST', '/foundations/domain/forward', 'domain'],
    ['POST', '/portal/members', 'people'], ['POST', `/portal/members/${uuid('7')}/role`, 'people'], ['POST', `/portal/members/${uuid('7')}/revoke`, 'people'],
  ];
  const wrong = cases.filter(([m, r, want]) => H.heldPowerOf(r, m) !== want);
  ok('going live, offline, the template, the domain and people are the studio\'s', wrong.length === 0, JSON.stringify(wrong));
  const free = [['GET', '/publish'], ['GET', '/foundations/domain'], ['GET', '/portal/members'], ['PUT', '/identity'], ['POST', '/sections'], ['POST', `/launches/${uuid('7')}/decide`], ['POST', '/client/approvals/x/decide'], ['POST', '/portal/transfer'], ['GET', '/export']];
  ok('reads, draft edits, approvals, a hand-over and the export are never held', free.every(([m, r]) => H.heldPowerOf(r, m) === null));
  ok('no studio, or the studio switched it on, or the caller is the studio: not held', !H.studioHolds(null, false) && !H.studioHolds({ agency_id: AGENCY, client_runs_site: true }, false) && !H.studioHolds({ agency_id: AGENCY, client_runs_site: false }, true) && H.studioHolds({ agency_id: AGENCY, client_runs_site: false }, false));
  ok('every refusal says what happened and what to do, in plain words', ['publish', 'offline', 'template', 'domain', 'people'].every((p) => /^Your studio /.test(H.heldSentence(p)) && /ask your studio/i.test(H.heldSentence(p)) && !/—/.test(H.heldSentence(p))));
}

/* ── the real index.ts, with std's serve() handed a fake listener: no socket opens ── */
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const { forgetWhoAsks } = await import('../../supabase/functions/_shared/auth.ts');
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => resolve(await r) }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
async function call(jwt, method, route, body) {
  forgetWhoAsks();
  const res = await send(new Request(`http://stub.local/functions/v1/presence${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json };
}
const held = (r) => r.status === 403 && r.json?.error === 'studio_holds';
const HELD = [['POST', '/publish', {}], ['POST', '/site/offline', {}], ['PUT', '/site/template', { slug: 'aurora' }], ['POST', '/foundations/domain', { domain: 'bakery.example' }], ['POST', '/portal/members', { email: 'new@bakery.example', role: 'business_staff' }]];

// ═══ 2. a studio's client, switched off ═══
{
  const rs = [];
  for (const [m, r, b] of HELD) rs.push([r, await call('jwt-owner', m, r, b)]);
  ok('the client\'s own sign-in: Publish, Take offline, the template, the domain and people are each refused', rs.every(([, r]) => held(r)), rs.map(([r, x]) => `${r} ${x.status} ${x.json?.error}`).join(' | '));
  const pub = rs[0][1];
  ok('…with the studio\'s words: nothing went live, the draft is saved, ask the studio', /nothing went live/.test(pub.json?.message || '') && pub.json?.power === 'publish');
  ok('…and nothing was written for any of them', !db.log.some((l) => l.method !== 'GET' && /presence_(publishes|sites|site_members|domain)/.test(l.url) && !/rate_hit/.test(l.url)));
  const draft = await call('jwt-owner', 'PUT', '/identity', { tagline: 'Fresh bread' });
  ok('editing the draft still goes through to its route (not held)', draft.json?.error !== 'studio_holds' && draft.status !== 403, `${draft.status} ${draft.json?.error}`);
  const reads = await Promise.all([call('jwt-owner', 'GET', '/foundations/domain'), call('jwt-owner', 'GET', '/portal/members')]);
  ok('reading the domain and the people is never held', reads.every((r) => r.json?.error !== 'studio_holds'));
  const seat = await call('jwt-seat', 'POST', '/publish', {});
  ok('a seat on the client\'s side (their Staff) is held too', held(seat), `${seat.status} ${seat.json?.error}`);
}

// ═══ 3. switched on; no studio ═══
{
  db.tables.presence_agency_clients[0].client_runs_site = true;
  const on = await call('jwt-owner', 'POST', '/publish', {});
  ok('switched on for this client: Publish goes through to its route', !held(on), `${on.status} ${on.json?.error}`);
  db.tables.presence_agency_clients[0].client_runs_site = false;
  const solo = await Promise.all(HELD.map(([m, r, b]) => call('jwt-solo', m, r, b)));
  ok('a business no studio looks after runs its own site as before: nothing held', solo.every((r) => !held(r)), solo.map((r) => `${r.status} ${r.json?.error}`).join(' | '));
}

// ═══ 4. the studio's own people ═══
{
  const insider = await call('jwt-insider', 'POST', '/publish', {});
  ok('someone on the studio\'s own team, signed in on the client\'s site, isn\'t held (they are the studio)', !held(insider), `${insider.status} ${insider.json?.error}`);
  db.tables.presence_agency_members[0].status = 'revoked';
  const gone = await call('jwt-insider', 'POST', '/publish', {});
  ok('…but once they leave the studio, they are', held(gone));
  db.tables.presence_agency_members[0].status = 'active';
}

// ═══ 5. an unreadable link; before migration 0265 ═══
{
  db.fail.add('presence_agency_clients');
  const stop = await H.holdStop(SITE, 'publish', { userId: U.owner, email: 'owner@bakery.example' });
  ok('the studio link can\'t be read: refused, nothing changes, try again', stop?.status === 503 && stop.body.error === 'hold_unreadable');
  db.fail.delete('presence_agency_clients');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('presence_agency_clients') && String(url).includes('client_runs_site'))
    ? new Response(JSON.stringify({ code: '42703', message: 'column presence_agency_clients.client_runs_site does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    : real(url, init);
  const before = await H.holdStop(SITE, 'publish', { userId: U.owner, email: 'owner@bakery.example' });
  const solo = await H.holdStop(SOLO, 'publish', { userId: U.solo, email: 'owner@solo.example' });
  globalThis.fetch = real;
  ok('before the column exists: a studio\'s client reads as switched off (held), a business with no studio as free', before?.status === 403 && solo === null);
}

// ═══ 6. the studio's switch ═══
{
  seed();
  const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
  const member = (role, agency = AGENCY) => ({ agency_id: agency, member_id: uuid('8'), email: `${role}@studio.example`, role, agency_name: 'Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} });
  const P = { kind: 'client', userId: U.insider, email: 'designer@studio.example', tenantId: null, role: 'client', jwt: 'jwt-insider', requestId: 't' };
  const runs = async (m, method, siteId, body) => {
    const req = new Request(`http://stub.local/functions/v1/presence/agency/sites/${siteId}/runs`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const res = await handleAgency(req, `/agency/sites/${siteId}/runs`, method, m, P, {});
    return { status: res.status, json: await res.json() };
  };
  const read = await runs(member('readonly'), 'GET', SITE);
  ok('any seat reads it: off by default, and says whether they may change it', read.status === 200 && read.json.data.on === false && read.json.data.can_change === false);
  const no = await runs(member('readonly'), 'PUT', SITE, { on: true });
  ok('a view-only seat can\'t switch it, and nothing changes', no.status === 403 && db.tables.presence_agency_clients[0].client_runs_site === false);
  const yes = await runs(member('account_manager'), 'PUT', SITE, { on: true });
  ok('a manager switches it on: kept, with when and who', yes.status === 200 && yes.json.data.on === true && db.tables.presence_agency_clients[0].client_runs_site === true && db.tables.presence_agency_clients[0].client_runs_site_by === 'account_manager@studio.example' && typeof yes.json.data.at === 'string');
  ok('…and off again', (await runs(member('owner'), 'PUT', SITE, { on: false })).json.data.on === false && db.tables.presence_agency_clients[0].client_runs_site === false);
  ok('a yes or no is needed', (await runs(member('owner'), 'PUT', SITE, { on: 'yes' })).status === 400);
  const theirs = await runs(member('owner'), 'PUT', OTHER_SITE, { on: true });
  ok('another studio\'s client: not yours (404), and theirs stays as it was', theirs.status === 404 && db.tables.presence_agency_clients[1].client_runs_site === false);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ STUDIO HOLDS, ITEM 387: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
