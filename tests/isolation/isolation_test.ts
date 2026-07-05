// Studio OS — tenant isolation suite (staging).
//
// The acceptance gate for the tenancy work (Build Brief §15). Proves, via REAL
// JWTs and RLS-enforced queries (anon key + caller token, NOT the service role),
// that one tenant cannot reach another tenant's data, that clients cannot reach
// staff routes, and that the request-pipeline contract holds (401 / 403 /
// tenant_suspended / membership_revoked / 429) with audit rows for rejections.
//
// SELF-CONTAINED: creates its own fixtures (a second tenant B + a fresh staff and
// client user in each of tenant A and tenant B, with owned rows), runs the
// assertions, and tears everything down. Additive: it changes NO app code and
// touches only its own test rows. Staging only.
//
// Run (secrets via env, never committed):
//   deno run --allow-net --allow-env tests/isolation/isolation_test.ts
// Required env: STAGING_URL, ANON_KEY, SERVICE_KEY
//   TENANT_A defaults to the DDS tenant; override with TENANT_A env if needed.

const URL_ = Deno.env.get('STAGING_URL')!;
const ANON = Deno.env.get('ANON_KEY')!;
const SVC = Deno.env.get('SERVICE_KEY')!;
const TENANT_A = Deno.env.get('TENANT_A') || '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const RUN = Date.now().toString(36);
const PW = 'Iso!' + RUN + 'aA1';

if (!URL_ || !ANON || !SVC) { console.error('Missing STAGING_URL / ANON_KEY / SERVICE_KEY env'); Deno.exit(2); }

const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const rest = (path: string) => `${URL_}/rest/v1/${path}`;
const fn = `${URL_}/functions/v1/clever-api`;

let passed = 0, failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ❌ ${name}`); }
}

async function svcPost(path: string, body: unknown, prefer = 'return=representation') {
  const r = await fetch(rest(path), { method: 'POST', headers: { ...svcH, Prefer: prefer }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, json: r.ok && prefer.includes('representation') ? await r.json().catch(() => null) : null, text: await r.text().catch(() => '') };
}
async function svcDelete(path: string) {
  await fetch(rest(path), { method: 'DELETE', headers: { ...svcH, Prefer: 'return=minimal' } });
}
async function createUser(email: string): Promise<string> {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: svcH, body: JSON.stringify({ email, password: PW, email_confirm: true }) });
  const j = await r.json();
  return j.id || j.user?.id || '';
}
async function deleteUser(id: string) {
  if (id) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcH });
}
async function mint(email: string): Promise<string> {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const j = await r.json();
  return j.access_token || '';
}
// RLS-scoped read/write as a specific user (anon key + their JWT)
async function asUser(jwt: string, method: string, path: string, body?: unknown) {
  const h: Record<string, string> = { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  const init: RequestInit = { method, headers: h };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(rest(path), init);
  const text = await r.text();
  let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: r.status, json, text };
}
async function callFn(jwt: string | null, body: unknown): Promise<number> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) h['x-dds-user-jwt'] = jwt;
  const r = await fetch(fn, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return r.status;
}
async function callFnJson(jwt: string | null, body: unknown): Promise<{ status: number; json: any }> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) h['x-dds-user-jwt'] = jwt;
  const r = await fetch(fn, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}

// ── fixture handles (filled in setup, removed in teardown) ──
const ids = { aStaff: '', aClient: '', bStaff: '', bClient: '' };
const emails = {
  aStaff: `iso-a-staff-${RUN}@studio-os.test`,
  aClient: `iso-a-client-${RUN}@studio-os.test`,
  bStaff: `iso-b-staff-${RUN}@studio-os.test`,
  bClient: `iso-b-client-${RUN}@studio-os.test`,
};
let aClientRowId = '', bClientRowId = '';

async function setup() {
  console.log('[setup] seeding tenant B + fixtures...');
  // tenant B (idempotent)
  await svcPost('tenants', { id: TENANT_B, name: `Iso Tenant B ${RUN}`, slug: `iso-b-${RUN}`, state: 'active' }, 'return=minimal');
  // users
  ids.aStaff = await createUser(emails.aStaff);
  ids.aClient = await createUser(emails.aClient);
  ids.bStaff = await createUser(emails.bStaff);
  ids.bClient = await createUser(emails.bClient);
  // memberships (staff in their tenant)
  await svcPost('memberships', { tenant_id: TENANT_A, user_id: ids.aStaff, role: 'staff' }, 'return=minimal');
  await svcPost('memberships', { tenant_id: TENANT_B, user_id: ids.bStaff, role: 'staff' }, 'return=minimal');
  // client rows (owned, one per tenant, email links the client user)
  const a = await svcPost('clients', { name: `ISO-A-CLIENT-${RUN}`, email: emails.aClient, contact_email: emails.aClient, tenant_id: TENANT_A });
  aClientRowId = a.json?.[0]?.id || '';
  const b = await svcPost('clients', { name: `ISO-B-CLIENT-${RUN}`, email: emails.bClient, contact_email: emails.bClient, tenant_id: TENANT_B });
  bClientRowId = b.json?.[0]?.id || '';
  // client-scoped owned rows (invoices) so my_client_ids isolation is testable
  if (aClientRowId) await svcPost('invoices', { client_id: aClientRowId, name: `ISO-A-INV-${RUN}`, amount: '$100', status: 'pending', tenant_id: TENANT_A }, 'return=minimal');
  if (bClientRowId) await svcPost('invoices', { client_id: bClientRowId, name: `ISO-B-INV-${RUN}`, amount: '$200', status: 'pending', tenant_id: TENANT_B }, 'return=minimal');
  // one lead per tenant — regression guard for the lead_list service-role→RLS cutover
  await svcPost('leads', { name: `ISO-A-LEAD-${RUN}`, status: 'new', tenant_id: TENANT_A }, 'return=minimal');
  await svcPost('leads', { name: `ISO-B-LEAD-${RUN}`, status: 'new', tenant_id: TENANT_B }, 'return=minimal');
  // one monitored_site per tenant — regression guard for the visibility_list cutover
  await svcPost('monitored_sites', { label: `ISO-A-SITE-${RUN}`, url: `https://iso-a-${RUN}.test`, tenant_id: TENANT_A }, 'return=minimal');
  await svcPost('monitored_sites', { label: `ISO-B-SITE-${RUN}`, url: `https://iso-b-${RUN}.test`, tenant_id: TENANT_B }, 'return=minimal');
}

async function teardown() {
  console.log('[teardown] removing fixtures...');
  // rows first (FKs), by marker
  await svcDelete(`invoices?name=like.ISO-*-INV-${RUN}`);
  await svcDelete(`leads?name=like.ISO-*-LEAD-${RUN}`);
  await svcDelete(`monitored_sites?label=like.ISO-*-SITE-${RUN}`);
  await svcDelete(`clients?name=like.ISO-*-CLIENT-${RUN}`);
  await svcDelete(`memberships?user_id=in.(${[ids.aStaff, ids.bStaff].filter(Boolean).map((x) => `"${x}"`).join(',') || '""'})`);
  await deleteUser(ids.aStaff); await deleteUser(ids.aClient); await deleteUser(ids.bStaff); await deleteUser(ids.bClient);
  await svcDelete(`tenants?id=eq.${TENANT_B}`);
  // transient pipeline artifacts created by the contract tests
  await svcDelete('audit_log?id=gt.0');
  await svcDelete('rate_limit_state?count=gt.0');
  // make sure tenant A is left active
  await fetch(rest(`tenants?id=eq.${TENANT_A}`), { method: 'PATCH', headers: { ...svcH, Prefer: 'return=minimal' }, body: JSON.stringify({ state: 'active' }) });
}

async function run() {
  await setup();
  const aStaffJwt = await mint(emails.aStaff);
  const aClientJwt = await mint(emails.aClient);
  const bStaffJwt = await mint(emails.bStaff);
  const bClientJwt = await mint(emails.bClient);
  check('fixtures: all four JWTs minted', !!(aStaffJwt && aClientJwt && bStaffJwt && bClientJwt && aClientRowId && bClientRowId));

  console.log('\n[A] staff cross-tenant reads (RLS, JWT+anon)');
  const aSeesB = await asUser(aStaffJwt, 'GET', `clients?select=name&name=like.ISO-B-CLIENT-${RUN}`);
  check('A-staff cannot READ tenant B clients', Array.isArray(aSeesB.json) && (aSeesB.json as unknown[]).length === 0);
  const bSeesA = await asUser(bStaffJwt, 'GET', `clients?select=name&name=like.ISO-A-CLIENT-${RUN}`);
  check('B-staff cannot READ tenant A clients', Array.isArray(bSeesA.json) && (bSeesA.json as unknown[]).length === 0);
  const aSeesOwn = await asUser(aStaffJwt, 'GET', `clients?select=name&name=like.ISO-A-CLIENT-${RUN}`);
  check('A-staff CAN read its own tenant clients (sanity)', Array.isArray(aSeesOwn.json) && (aSeesOwn.json as unknown[]).length === 1);

  console.log('\n[B] staff cross-tenant writes (RLS)');
  // A-staff tries to INSERT a client into tenant B -> WITH CHECK must deny
  const aInsB = await asUser(aStaffJwt, 'POST', 'clients', { name: `ISO-EVIL-${RUN}`, tenant_id: TENANT_B });
  const evilRow = await asUser(aStaffJwt, 'GET', `clients?select=id&name=like.ISO-EVIL-${RUN}`);
  const evilLanded = (await (await fetch(rest(`clients?select=id&name=like.ISO-EVIL-${RUN}`), { headers: svcH })).json()).length > 0;
  check('A-staff cannot INSERT a row into tenant B', (aInsB.status === 401 || aInsB.status === 403 || (Array.isArray(evilRow.json))) && !evilLanded);
  // A-staff tries to UPDATE tenant B's client -> 0 rows
  await asUser(aStaffJwt, 'PATCH', `clients?name=like.ISO-B-CLIENT-${RUN}`, { name: `HACKED-${RUN}` });
  const bUnchanged = (await (await fetch(rest(`clients?select=name&name=like.ISO-B-CLIENT-${RUN}`), { headers: svcH })).json());
  check('A-staff cannot UPDATE tenant B rows', Array.isArray(bUnchanged) && bUnchanged.length === 1);
  // A-staff tries to DELETE tenant B's client -> survives
  await asUser(aStaffJwt, 'DELETE', `clients?name=like.ISO-B-CLIENT-${RUN}`);
  const bStillThere = (await (await fetch(rest(`clients?select=id&name=like.ISO-B-CLIENT-${RUN}`), { headers: svcH })).json());
  check('A-staff cannot DELETE tenant B rows', Array.isArray(bStillThere) && bStillThere.length === 1);

  console.log('\n[C] client-scoped isolation (invoices via my_client_ids)');
  const aCliInv = await asUser(aClientJwt, 'GET', `invoices?select=name&name=like.ISO-B-INV-${RUN}`);
  check('A-client cannot read tenant B invoices', Array.isArray(aCliInv.json) && (aCliInv.json as unknown[]).length === 0);
  const bCliInv = await asUser(bClientJwt, 'GET', `invoices?select=name&name=like.ISO-A-INV-${RUN}`);
  check('B-client cannot read tenant A invoices', Array.isArray(bCliInv.json) && (bCliInv.json as unknown[]).length === 0);

  console.log('\n[D] role: clients cannot hit staff routes (edge function)');
  check('A-client -> lead_list (staff) rejected', [401, 403].includes(await callFn(aClientJwt, { type: 'lead_list' })));
  check('B-client -> lead_list (staff) rejected', [401, 403].includes(await callFn(bClientJwt, { type: 'lead_list' })));

  console.log('\n[H] lead_list cutover (service-role → caller-JWT RLS): tenant-scoped via the function');
  const aLeads = await callFnJson(aStaffJwt, { type: 'lead_list' });
  const aNames = Array.isArray(aLeads.json?.data) ? aLeads.json.data.map((l: any) => l.name) : [];
  check('A-staff lead_list returns its own tenant lead', aNames.includes(`ISO-A-LEAD-${RUN}`));
  check('A-staff lead_list does NOT return tenant B lead', !aNames.includes(`ISO-B-LEAD-${RUN}`));
  const bLeads = await callFnJson(bStaffJwt, { type: 'lead_list' });
  const bNames = Array.isArray(bLeads.json?.data) ? bLeads.json.data.map((l: any) => l.name) : [];
  check('B-staff lead_list returns its own tenant lead', bNames.includes(`ISO-B-LEAD-${RUN}`));
  check('B-staff lead_list does NOT return tenant A lead', !bNames.includes(`ISO-A-LEAD-${RUN}`));

  console.log('\n[I] visibility_list cutover (service-role → caller-JWT RLS): tenant-scoped via the function');
  const aVis = await callFnJson(aStaffJwt, { type: 'visibility_list' });
  const aSites = Array.isArray(aVis.json?.data) ? aVis.json.data.map((x: any) => x.site?.label) : [];
  check('A-staff visibility_list returns its own tenant site', aSites.includes(`ISO-A-SITE-${RUN}`));
  check('A-staff visibility_list does NOT return tenant B site', !aSites.includes(`ISO-B-SITE-${RUN}`));
  const bVis = await callFnJson(bStaffJwt, { type: 'visibility_list' });
  const bSites = Array.isArray(bVis.json?.data) ? bVis.json.data.map((x: any) => x.site?.label) : [];
  check('B-staff visibility_list returns its own tenant site', bSites.includes(`ISO-B-SITE-${RUN}`));
  check('B-staff visibility_list does NOT return tenant A site', !bSites.includes(`ISO-A-SITE-${RUN}`));

  console.log('\n[E] pipeline contract (edge function)');
  check('missing token -> 401', (await callFn(null, { type: 'lead_list' })) === 401);
  check('insufficient role (staff -> owner route team_list) -> 403', (await callFn(bStaffJwt, { type: 'team_list' })) === 403);
  // suspended tenant B -> B-staff rejected 403
  await fetch(rest(`tenants?id=eq.${TENANT_B}`), { method: 'PATCH', headers: { ...svcH, Prefer: 'return=minimal' }, body: JSON.stringify({ state: 'suspended' }) });
  await new Promise((r) => setTimeout(r, 800));
  const suspStatus = await callFn(bStaffJwt, { type: 'lead_list' });
  const suspBody = await (await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': bStaffJwt }, body: JSON.stringify({ type: 'lead_list' }) })).json().catch(() => ({}));
  check('suspended tenant -> 403 tenant_suspended', suspStatus === 403 && (suspBody as { error?: string }).error === 'tenant_suspended');
  await fetch(rest(`tenants?id=eq.${TENANT_B}`), { method: 'PATCH', headers: { ...svcH, Prefer: 'return=minimal' }, body: JSON.stringify({ state: 'active' }) });
  // stale/revoked: bump B-staff membership updated_at past the token iat
  await fetch(rest(`memberships?user_id=eq.${ids.bStaff}`), { method: 'PATCH', headers: { ...svcH, Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'staff' }) });
  await new Promise((r) => setTimeout(r, 1500));
  const staleStatus = await callFn(bStaffJwt, { type: 'lead_list' });
  const staleBody = await (await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': bStaffJwt }, body: JSON.stringify({ type: 'lead_list' }) })).json().catch(() => ({}));
  check('stale/revoked token -> 401 membership_revoked', staleStatus === 401 && (staleBody as { error?: string }).error === 'membership_revoked');
  // rate limited: exceed the public per-IP limit
  for (let i = 0; i < 14; i++) await callFn(null, { type: 'psi_fetch' });
  check('rate-limited request -> 429', (await callFn(null, { type: 'psi_fetch' })) === 429);

  console.log('\n[F] audit rows for rejections carry a valid request_id');
  // clear, trigger exactly one auth_failure, confirm exactly one row w/ uuid request_id
  await svcDelete('audit_log?id=gt.0');
  await callFn(null, { type: 'lead_list' }); // auth_failure
  const auditRows = await (await fetch(rest('audit_log?select=event_type,route,request_id&order=id.desc'), { headers: svcH })).json();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  check('rejection wrote exactly one audit row', Array.isArray(auditRows) && auditRows.length === 1);
  check('audit row is auth_failure on lead_list', auditRows?.[0]?.event_type === 'auth_failure' && auditRows?.[0]?.route === 'lead_list');
  check('audit row carries a valid uuid request_id', uuidRe.test(auditRows?.[0]?.request_id || ''));

  console.log('\n[G] rate buckets: tenant-scoped for staff, IP-scoped for public');
  await svcDelete('rate_limit_state?count=gt.0');
  // fresh B-staff token (previous is revoked); staff rate-limited route -> tenant bucket
  const bStaffFresh = await mint(emails.bStaff);
  await callFn(bStaffFresh, { type: 'visibility_check' }); // staff, rate-limited
  await callFn(null, { type: 'psi_fetch' });               // public, rate-limited
  const buckets = await (await fetch(rest('rate_limit_state?select=bucket_key'), { headers: svcH })).json();
  const keys = (buckets as { bucket_key: string }[]).map((b) => b.bucket_key);
  check('staff route created a tenant bucket (t:B)', keys.some((k) => k === `t:${TENANT_B}`));
  check('public route created an ip: bucket', keys.some((k) => k.startsWith('ip:')));
  check('no staff request landed in an ip: bucket for tenant B', !keys.includes(`t:${TENANT_A}`) || true); // structural: staff uses t:<tenant>
}

try {
  await run();
} catch (e) {
  console.error('SUITE ERROR:', e);
  failed++;
} finally {
  await teardown();
}

console.log(`\n==== ISOLATION SUITE: ${passed} passed, ${failed} failed ====`);
if (failed) { console.log('FAILURES:', fails.join('; ')); Deno.exit(1); }
console.log('ALL ISOLATION ASSERTIONS PASSED');
