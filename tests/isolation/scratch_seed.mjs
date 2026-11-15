// ── Two studios on a scratch database (builder item 212) ──────────────────────────
// Run by scripts/isolation-scratch.sh, never against a real project: it creates sign-ins
// and rows with the scratch database's own service key.
//
//   SCRATCH_API=… SCRATCH_ANON_KEY=… SCRATCH_SERVICE_KEY=… \
//     deno run --allow-net --allow-env tests/isolation/scratch_seed.mjs > seed.env
//
// A fresh database has the tables but no rows. This adds what production has had from
// the start, the DDS tenant and its agency row (every client row points at them) and the
// two file buckets, then two studios. Each studio is set up the way the Sites page and /admin/sites leave one:
// an owner who signs in, the business's client record carrying the owner's email, an
// active Presence entitlement, a website and its business details. Hosting is the one
// step left out: there is no Netlify here, and none of the suites publish.
//
// It prints the SALES_E2E_* settings the suites read, studio one as A and studio two
// as B, and checks before it finishes that each owner's sign-in opens their own website
// and not the other's. Anything that doesn't work stops it with a plain reason.

const API = Deno.env.get('SCRATCH_API');
const ANON = Deno.env.get('SCRATCH_ANON_KEY');
const SR = Deno.env.get('SCRATCH_SERVICE_KEY');
if (!API || !ANON || !SR) { console.error('need SCRATCH_API, SCRATCH_ANON_KEY and SCRATCH_SERVICE_KEY'); Deno.exit(2); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) { console.error(`refusing to seed ${API}: this only runs against a scratch database on this machine`); Deno.exit(2); }

const TENANT = '00000000-0000-0000-0000-000000000001';   // DDS, tenant #1 (_shared/auth.ts TENANT_ID)
const RUN = Date.now().toString(36);
const svcH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

function stop(why, detail) { console.error(`seed: ${why}${detail ? `\n${detail}` : ''}`); Deno.exit(1); }
async function rest(path, method = 'GET', body, prefer = 'return=representation') {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...svcH, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, json, text };
}
async function one(path, body, what) {
  const r = await rest(path, 'POST', body);
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (!r.ok || !row) stop(`couldn't create ${what} (${r.status})`, r.text.slice(0, 400));
  return row;
}

// ── what production has had from the start ──
for (const [table, row] of [
  ['tenants', { id: TENANT, name: 'Davis Digital Studio (scratch)', slug: 'dds-scratch' }],
  ['agencies', { id: TENANT, slug: 'dds-scratch', name: 'Davis Digital Studio (scratch)' }],
]) {
  const r = await rest(`${table}?on_conflict=id`, 'POST', row, 'resolution=ignore-duplicates,return=minimal');
  if (!r.ok) stop(`couldn't add the DDS ${table} row (${r.status})`, r.text.slice(0, 400));
}
// The two file buckets were made by hand on production, so no migration makes them. These are
// production's settings, read Nov 12 2026: private, with its size limits and file types.
const BUCKETS = [
  { id: 'presence-media', file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  { id: 'client-files', file_size_limit: 52428800, allowed_mime_types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'video/mp4', 'video/quicktime', 'application/zip'] },
];
for (const b of BUCKETS) {
  const r = await fetch(`${API}/storage/v1/bucket`, { method: 'POST', headers: svcH, body: JSON.stringify({ ...b, name: b.id, public: false }) });
  const text = await r.text();
  if (!r.ok && !/already exists|Duplicate/i.test(text)) stop(`couldn't make the ${b.id} bucket (${r.status})`, text.slice(0, 400));
}

// ── two studios ──
async function studio(n) {
  const email = `studio-${n}-${RUN}@isolation.test`;
  const password = `Iso-${crypto.randomUUID()}`;
  const u = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: svcH, body: JSON.stringify({ email, password, email_confirm: true }) });
  const user = await u.json().catch(() => ({}));
  const userId = user.id || user.user?.id;
  if (!u.ok || !userId) stop(`couldn't create studio ${n}'s owner (${u.status})`, JSON.stringify(user).slice(0, 400));

  const name = `Scratch Studio ${n === 1 ? 'One' : 'Two'}`;
  const client = await one('clients', { name, email, contact_email: email, tenant_id: TENANT }, `studio ${n}'s client record`);
  await one('presence_entitlements', { client_id: client.id, product: 'presence', status: 'active' }, `studio ${n}'s entitlement`);
  const site = await one('presence_sites', { client_id: client.id, status: 'ready' }, `studio ${n}'s website`);
  await one('presence_identity', { site_id: site.id, business_name: name }, `studio ${n}'s business details`);

  const t = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const tok = await t.json().catch(() => ({}));
  if (!t.ok || !tok.access_token) stop(`studio ${n}'s owner couldn't sign in (${t.status})`, JSON.stringify(tok).slice(0, 400));
  return { n, email, userId, clientId: client.id, siteId: site.id, jwt: tok.access_token };
}
const A = await studio(1);
const B = await studio(2);

// ── each owner's sign-in opens their own website, and only theirs ──
async function siteOf(s) {
  const r = await fetch(`${API}/rest/v1/presence_sites?select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${s.jwt}` } });
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows.map((x) => x.id) : null;
}
for (const [s, other] of [[A, B], [B, A]]) {
  const ids = await siteOf(s);
  if (!ids || ids.length !== 1 || ids[0] !== s.siteId) stop(`studio ${s.n}'s sign-in should see exactly its own website`, JSON.stringify(ids));
  if (ids.includes(other.siteId)) stop(`studio ${s.n}'s sign-in can see studio ${other.n}'s website`);
  const r = await fetch(`${API}/functions/v1/presence/portal/context`, { headers: { Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': s.jwt } });
  const body = await r.json().catch(() => ({}));
  const seen = JSON.stringify(body);
  if (!r.ok) stop(`presence didn't open studio ${s.n}'s workspace (${r.status})`, seen.slice(0, 400));
  if (seen.includes(other.siteId)) stop(`presence showed studio ${other.n}'s website to studio ${s.n}`);
  console.error(`seed: studio ${s.n} signs in to its own website`);
}

const out = {
  SALES_E2E_TARGET: `${API}/functions/v1/presence`,
  SALES_E2E_ANON: ANON,
  SALES_E2E_SR: SR,
  SALES_E2E_STORAGE: `${API}/storage/v1`,
  SALES_E2E_JWT: A.jwt,
  SALES_E2E_SITE: '',      // a solo owner: the site comes from the sign-in, not a header
  SALES_E2E_JWT2: B.jwt,
  SALES_E2E_SITE2: '',
};
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
