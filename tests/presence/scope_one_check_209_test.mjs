// ── Working inside a client costs one check (builder item 209, Nov 12 review file 06 finding 83) ──
// Every one of the 35 or so requests a page makes inside a client went through the scope
// check, which read the studio's whole client list and then waited for the access record
// to be written before the request could start. Now it asks about the one client, and the
// record is handed to the runtime to write after the response (EdgeRuntime.waitUntil).
// Who may act is still decided on every request, and every request is still recorded.
// This drives the real lib/scope.ts against an in-memory PostgREST that logs each call.
//   deno run --allow-read --allow-env --allow-net tests/presence/scope_one_check_209_test.mjs
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const { resolveScopedSite } = await import('../../supabase/functions/presence/lib/scope.ts');
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const CLIENT = uuid('a'), OTHER_CLIENT = uuid('b'), ARCHIVED = uuid('c'), STRANGER = uuid('d'), AGENCY = uuid('9');
const USERS = { 'jwt-owner': { id: uuid('1'), email: 'eric@studio.example' }, 'jwt-designer': { id: uuid('2'), email: 'dee@studio.example' } };
const SITE = (id) => ({ id, client_id: uuid('7'), status: 'live', last_published_at: null, template_slug: 'atelier', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' });
let DB, calls;
function reset() {
  DB = {
    presence_sites: [SITE(CLIENT), SITE(OTHER_CLIENT), SITE(ARCHIVED), SITE(STRANGER)],
    presence_identity: [{ site_id: CLIENT, business_name: 'Maple & Rye Bakery' }],
    presence_agency_members: [
      { id: uuid('3'), agency_id: AGENCY, email: 'eric@studio.example', user_id: USERS['jwt-owner'].id, role: 'owner', status: 'active' },
      { id: uuid('4'), agency_id: AGENCY, email: 'dee@studio.example', user_id: USERS['jwt-designer'].id, role: 'designer', status: 'active' },
    ],
    presence_agencies: [{ id: AGENCY, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
    // a studio with a long client list: the check must not read it
    presence_agency_clients: [
      { agency_id: AGENCY, site_id: CLIENT, status: 'active' },
      { agency_id: AGENCY, site_id: OTHER_CLIENT, status: 'active' },
      { agency_id: AGENCY, site_id: ARCHIVED, status: 'archived' },
      ...Array.from({ length: 40 }, (_, i) => ({ agency_id: AGENCY, site_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, status: 'active' })),
    ],
    presence_scoped_access_events: [],
  };
  calls = [];
}
const matches = (row, params) => [...params.entries()].every(([k, v]) => ['select', 'limit', 'order', 'or'].includes(k) || (v.startsWith('eq.') ? String(row[k]) === v.slice(3) : true));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const token = (new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
  const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  const table = u.pathname.replace('/rest/v1/', '');
  calls.push({ table, method, query: decodeURIComponent(u.search) });
  if (method === 'POST') { await new Promise((r) => setTimeout(r, 5)); (DB[table] ||= []).push(JSON.parse(init.body)); return reply(null, 201); }
  if (method === 'PATCH') return reply([]);
  // or=(user_id.eq.X,email.eq.Y): the members read
  let rows = (DB[table] || []).filter((r) => matches(r, u.searchParams));
  const or = u.searchParams.get('or');
  if (or) rows = rows.filter((r) => or.slice(1, -1).split(',').some((c) => { const [col, , ...v] = c.split('.'); return String(r[col]) === decodeURIComponent(v.join('.')); }));
  const lim = Number(u.searchParams.get('limit')); if (lim) rows = rows.slice(0, lim);
  return reply(rows);
};
const audit = { route: '/portal/context', method: 'GET', requestId: 'test' };

// ═══ 1. inside a client: one row about this client, never the list ═══
{
  reset();
  const sc = await resolveScopedSite('jwt-owner', CLIENT, audit);
  ok('allowed: the studio opens its own client', sc.ok === true && sc.site?.id === CLIENT && sc.scoped?.name === 'Maple & Rye Bakery');
  const ac = calls.filter((c) => c.table === 'presence_agency_clients');
  ok('one question about this client', ac.length === 1 && ac[0].query.includes(`site_id=eq.${CLIENT}`) && ac[0].query.includes('status=eq.active') && ac[0].query.includes('limit=1'), JSON.stringify(ac));
  ok('never the whole client list', !calls.some((c) => c.table === 'presence_agency_clients' && /limit=1000/.test(c.query)));
  ok('…and the request is still recorded', DB.presence_scoped_access_events.length === 1 && DB.presence_scoped_access_events[0].outcome === 'allowed');
}
// ═══ 2. who may act is still decided afresh, client by client ═══
{
  reset();
  const other = await resolveScopedSite('jwt-owner', STRANGER, audit);
  ok('a site that isn\'t this studio\'s client is refused', other.ok === false && other.status === 403 && other.reason === 'unauthorized');
  ok('…without reading the site it asked for', !calls.some((c) => c.table === 'presence_sites'));
  const arch = await resolveScopedSite('jwt-owner', ARCHIVED, audit);
  ok('an archived client is refused, and recorded as archived', arch.ok === false && DB.presence_scoped_access_events.at(-1)?.reason === 'archived_client');
  reset();
  const dee = await resolveScopedSite('jwt-designer', CLIENT, audit);
  ok('a role that can\'t open clients is refused without asking about the client at all', dee.ok === false && dee.reason === 'role' && !calls.some((c) => c.table === 'presence_agency_clients'));
  ok('…and the refusal is recorded', DB.presence_scoped_access_events.length === 1 && DB.presence_scoped_access_events[0].outcome === 'denied');
  reset();
  DB.presence_agency_clients.find((c) => c.site_id === CLIENT).status = 'archived';
  const now = await resolveScopedSite('jwt-owner', CLIENT, audit);
  ok('archive the client and the very next request is refused', now.ok === false && now.status === 403);
}
// ═══ 3. on the edge runtime, the request no longer waits for the record ═══
{
  reset();
  const handed = [];
  globalThis.EdgeRuntime = { waitUntil: (p) => { handed.push(p); } };
  try {
    const sc = await resolveScopedSite('jwt-owner', CLIENT, audit);
    ok('the answer comes back before the record is written', sc.ok === true && DB.presence_scoped_access_events.length === 0 && handed.length === 1);
    await Promise.all(handed);
    ok('…and the record lands after it', DB.presence_scoped_access_events.length === 1 && DB.presence_scoped_access_events[0].outcome === 'allowed' && DB.presence_scoped_access_events[0].client_name === 'Maple & Rye Bakery');
    handed.length = 0;
    const no = await resolveScopedSite('jwt-owner', STRANGER, audit);
    await Promise.all(handed);
    ok('a refusal is handed over the same way, and recorded', no.ok === false && handed.length === 1 && DB.presence_scoped_access_events.at(-1)?.outcome === 'denied');
  } finally { delete globalThis.EdgeRuntime; }
}
// ═══ 4. what a request inside a client waits for now ═══
{
  reset();
  await resolveScopedSite('jwt-owner', CLIENT, audit);   // the client's name is kept a minute (item 87)
  calls = [];
  globalThis.EdgeRuntime = { waitUntil: () => {} };
  try { await resolveScopedSite('jwt-owner', CLIENT, audit); } finally { delete globalThis.EdgeRuntime; }
  const waited = calls.filter((c) => c.method === 'GET').map((c) => c.table);   // the record's write is the runtime's (section 3)
  ok('a request waits on four reads: the member, the studio, this client and the site', JSON.stringify(waited) === JSON.stringify(['presence_agency_members', 'presence_agencies', 'presence_agency_clients', 'presence_sites']), waited.join(', '));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
