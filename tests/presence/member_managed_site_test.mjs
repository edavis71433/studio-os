// ── A staff or developer seat on a bridged site gets the workspace (MC-4) ────
// A site linked to a studio gives its customer the calm client surface: one menu link
// and a /client.html landing. That check looked at the site alone, so anyone invited to
// work on the site got the customer's menu too, and reached their pages only by typing
// the address. Found on production with a real staff seat, 2026-11-05.
//
// This drives the REAL /portal/context handler against a stubbed PostgREST.
//   · a staff or developer seat gets the workspace menu, on a bridged site or not
//   · the customer, an owner seat and a reviewer see what they always saw
//   · a studio scoped in and platform staff are unchanged
//
//   deno run --allow-read --allow-env --allow-net tests/presence/member_managed_site_test.mjs
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example' })) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const { handlePortalContext } = await import(`${P}/routes/workspace.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('a'), CLIENT = uuid('c');
const USERS = {
  'jwt-customer': { id: uuid('1'), email: 'customer@example.com' },
  'jwt-coowner': { id: uuid('2'), email: 'coowner@example.com' },
  'jwt-staff': { id: uuid('3'), email: 'staff@example.com' },
  'jwt-dev': { id: uuid('4'), email: 'dev@example.com' },
  'jwt-reviewer': { id: uuid('5'), email: 'reviewer@example.com' },
  'jwt-studio': { id: uuid('6'), email: 'studio@example.com' },
  'jwt-platform': { id: uuid('7'), email: 'platform@example.com' },
};
const seat = (jwt, role) => ({ id: crypto.randomUUID(), site_id: SITE, email: USERS[jwt].email, user_id: USERS[jwt].id, role, status: 'active' });
const SEATS = [seat('jwt-coowner', 'business_owner'), seat('jwt-staff', 'business_staff'), seat('jwt-dev', 'developer'), seat('jwt-reviewer', 'client_reviewer')];

let bridged = true, linkReads = 0;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'content-range': '*/0' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const token = (new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  const table = u.pathname.replace('/rest/v1/', '');
  const query = decodeURIComponent(u.search);
  if (table === 'presence_site_members') {
    const who = Object.values(USERS).find((x) => query.includes(`user_id.eq.${x.id}`));
    return reply(SEATS.filter((s) => !who || s.user_id === who.id));
  }
  if (table === 'presence_service_links') { linkReads++; return reply(bridged ? [{ project_id: uuid('d'), agency_site_id: uuid('e') }] : []); }
  return reply([]);
};

const site = { id: SITE, client_id: CLIENT, status: 'live', last_published_at: '2026-01-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', edition: 'presence' };
const client = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const seated = (jwt, role) => client(jwt, { member: { site_id: SITE, role } });
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const contextOf = async (principal, scopedName) => {
  linkReads = 0;
  const res = await quiet(() => handlePortalContext(principal.jwt, site, principal, {}, scopedName));
  const body = await res.json();
  return { ...body.data, status: res.status, linkReads };
};
const clientSurface = (c) => c.is_managed_client === true && c.landing === '/client.html' && c.nav.length === 1 && c.nav[0].key === 'client';
const workspace = (c) => c.is_managed_client === false && c.landing !== '/client.html' && c.nav.length > 1 && !c.nav.some((s) => s.key === 'client');

// ═══ on a bridged site ═══
{
  bridged = true;
  for (const [role, jwt] of [['business_staff', 'jwt-staff'], ['developer', 'jwt-dev']]) {
    const c = await contextOf(seated(jwt, role));
    ok(`${role} on a bridged site: the workspace menu, not the client's`, workspace(c), JSON.stringify({ managed: c.is_managed_client, landing: c.landing, nav: c.nav.map((s) => s.key) }));
    ok(`${role} on a bridged site: the menu has places to work`, ['pipeline', 'customers', 'projects', 'settings'].every((k) => c.nav.some((s) => s.key === k)), c.nav.map((s) => s.key).join(', '));
    ok(`${role} on a bridged site: holds their role`, c.site_role === role && c.sees_full_workspace === true);
    ok(`${role} on a bridged site: the links aren't read, since nothing uses them`, c.linkReads === 0, String(c.linkReads));
  }
  const staff = await contextOf(seated('jwt-staff', 'business_staff'));
  const dev = await contextOf(seated('jwt-dev', 'developer'));
  ok('a staff seat isn\'t offered Sharing: that is the owner\'s', !JSON.stringify(staff.nav).includes('/sharing.html'));
  ok('a developer seat is offered Developer Mode', JSON.stringify(dev.nav).includes('/developer.html'));
  ok('a staff seat isn\'t', !JSON.stringify(staff.nav).includes('/developer.html'));

  const customer = await contextOf(client('jwt-customer'));
  ok('the customer on their own bridged site: still the calm client surface', clientSurface(customer), JSON.stringify({ managed: customer.is_managed_client, landing: customer.landing }));
  ok('the customer: still reads the links', customer.linkReads >= 1);
  const coowner = await contextOf(seated('jwt-coowner', 'business_owner'));
  ok('an owner seat on a bridged site: still the client surface, as before', clientSurface(coowner), JSON.stringify({ managed: coowner.is_managed_client, landing: coowner.landing }));
  const reviewer = await contextOf(seated('jwt-reviewer', 'client_reviewer'));
  ok('a reviewer on a bridged site: still the client surface, as before', reviewer.landing === '/client.html' && reviewer.nav.length === 1 && reviewer.nav[0].key === 'client' && reviewer.is_managed_client === true);

  const scoped = await contextOf(client('jwt-studio', { scope: { site_id: SITE, name: 'Alpha' } }), 'Alpha');
  ok('a studio scoped in: unchanged, never the client surface', scoped.is_managed_client === false && scoped.landing !== '/client.html' && scoped.linkReads === 0);
  const platform = await contextOf(client('jwt-platform', { kind: 'staff', role: 'owner' }));
  ok('platform staff: unchanged, never the client surface', platform.is_managed_client === false && platform.landing !== '/client.html' && platform.linkReads === 0);
}

// ═══ on a site with no studio behind it: nothing to change ═══
{
  bridged = false;
  const owner = await contextOf(client('jwt-customer'));
  ok('the owner of an unlinked site: the workspace', workspace(owner));
  const staff = await contextOf(seated('jwt-staff', 'business_staff'));
  ok('a staff seat on an unlinked site: the same workspace as on a bridged one', workspace(staff));
  bridged = true;
  const onBridged = await contextOf(seated('jwt-staff', 'business_staff'));
  ok('…so a bridge makes no difference to a staff seat\'s menu', JSON.stringify(onBridged.nav) === JSON.stringify(staff.nav) && onBridged.landing === staff.landing);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEMBER ON A MANAGED SITE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
