// ── A page rename taken back leaves no forward behind (G7, SC-7) ─────────────
// A rename adds a forward from the old address if that address was live. Publishing
// writes each forward's file last, over any page at that address, and refuses a
// forward that points at itself. So when a page goes back to an address, by Undo or by
// renaming it back, the forward away from that address has to go: left alone it
// replaced the page, and re-pointed like the others it stopped every publish.
//
// Drives the REAL handleSettings and redirectsForRenames against a stubbed PostgREST.
//   deno run --allow-read --allow-env --allow-net tests/presence/page_rename_forwards_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleSettings } = await import('../../supabase/functions/presence/routes/content.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const SITE = '11111111-1111-4111-8111-111111111111';
const SNAP = '22222222-2222-4222-8222-222222222222';
const site = { id: SITE, status: 'ready', edition: 'presence' };
const principal = { kind: 'client', userId: 'u1', tenantId: null, role: 'client', email: 'owner@example.com', jwt: 'jwt', requestId: 'r1' };

let T;
function reset({ live = ['gallery'], redirects = [] } = {}) {
  T = {
    presence_settings: [{ site_id: SITE, pages: [{ slug: 'gallery', title: 'Gallery', blocks: [] }], updated_at: '2026-01-01T00:00:00Z' }],
    presence_publishes: [{ site_id: SITE, status: 'live', snapshot_id: SNAP, created_at: '2026-01-01T00:00:00Z' }],
    presence_snapshots: [{ id: SNAP, site_id: SITE, content: { settings: { pages: live.map((slug) => ({ slug })) } } }],
    presence_redirects: redirects.map((r) => ({ id: crypto.randomUUID(), site_id: SITE, ...r })),
    presence_change_events: [],
  };
}
function matches(row, params) {
  for (const [k, v] of params.entries()) {
    if (['select', 'limit', 'order', 'on_conflict', 'offset'].includes(k)) continue;
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v === 'is.null' && row[k] != null) return false;
  }
  return true;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''), method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null, rows = (T[table] ||= []);
  const hit = rows.filter((r) => matches(r, u.searchParams));
  if (method === 'GET') return reply(hit);
  if (method === 'PATCH') { hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'DELETE') { T[table] = rows.filter((r) => !hit.includes(r)); return reply(hit); }
  if (method === 'POST') {
    const conflict = u.searchParams.get('on_conflict'), prefer = new Headers(init.headers).get('Prefer') || '';
    let row = conflict ? rows.find((r) => r[conflict] === body[conflict]) : null;
    if (row) Object.assign(row, body); else { row = { id: crypto.randomUUID(), ...body }; rows.push(row); }
    return prefer.includes('return=representation') ? reply([row], 201) : reply(null, 201);
  }
  return reply([]);
};

const db = (path, init) => svc(path, init);
async function rename(from, to) {
  const pages = [{ slug: to, title: to, blocks: [], prev_slug: from }];
  const req = new Request('http://stub.local/functions/v1/presence/settings', { method: 'PUT', body: JSON.stringify({ pages }), headers: { 'Content-Type': 'application/json' } });
  const res = await handleSettings(req, db, site, principal, {});
  if (res.status !== 200) throw new Error(`PUT /settings answered ${res.status}: ${await res.text()}`);
}
const forwards = () => T.presence_redirects.map((r) => `${r.from_path} -> ${r.to_path}`).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

{
  reset({ redirects: [{ from_path: '/old-gallery/', to_path: '/gallery/' }] });
  await rename('gallery', 'pics');
  ok('a rename of a live page forwards the old address, and forwards to it follow', same(forwards(), ['/gallery/ -> /pics/', '/old-gallery/ -> /pics/']), forwards().join(', '));
  await rename('pics', 'gallery');
  ok('taken back: the forward it made is gone, and the others follow the page back', same(forwards(), ['/old-gallery/ -> /gallery/']), forwards().join(', '));
  await rename('gallery', 'pics');
  ok('done again: the same forwards as the first time', same(forwards(), ['/gallery/ -> /pics/', '/old-gallery/ -> /pics/']), forwards().join(', '));
}
{
  reset();
  await rename('gallery', 'pics');
  T.presence_snapshots[0].content = { settings: { pages: [{ slug: 'pics' }] }, redirects: [{ from_path: '/gallery/', to_path: '/pics/' }] };   // published under the new address
  await rename('pics', 'gallery');
  ok('taken back after a publish: the address that went live forwards to the page', same(forwards(), ['/pics/ -> /gallery/']), forwards().join(', '));
  await rename('gallery', 'pics');
  ok('and done again: the old address, live as a forward, keeps it, and nothing points at itself', same(forwards(), ['/gallery/ -> /pics/']), forwards().join(', '));
}
{
  reset({ live: [] });
  await rename('gallery', 'pics');
  await rename('pics', 'gallery');
  ok('never live: no forward at any point', same(forwards(), []), forwards().join(', '));
}
{
  reset({ redirects: [{ from_path: '/pics/', to_path: 'https://elsewhere.example/' }] });
  await rename('gallery', 'pics');
  ok('an owner\'s forward from the new address to somewhere else is theirs, and stays', forwards().includes('/pics/ -> https://elsewhere.example/'), forwards().join(', '));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
