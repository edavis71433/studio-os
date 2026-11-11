// ── Page passwords: the real routes (builder list items 48 and 120, Nov 2026) ──
// POST /page-locks keeps the key a password makes, never the password; GET /page-locks lists
// this site's locks; a publish reads only this site's keys. Before APPLY-0158 the table isn't
// there: setting a password says so plainly, the list is empty, and a publish finds no key
// (so the page stays off the live site). Real handlers against the shared in-memory PostgREST.
//   deno run --allow-read --allow-env --allow-net tests/presence/page_locks_routes_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OTHER = uuid('9'), OWNER = uuid('2'), U = uuid('3');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });

// before the database update: the table answers the way PostgREST does when it isn't there
let tableGone = false;
const pg = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (init.body) sent.push(String(init.body));
  if (tableGone && u.pathname.includes('presence_page_locks')) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table public.presence_page_locks in the schema cache' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return pg(url, init);
};
const R = await import('../../supabase/functions/presence/routes/page_locks.ts');
const { lockKeyFromPassword } = await import('../../supabase/functions/presence/lib/page_access.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, body) => new Request('https://fn.test/functions/v1/presence/page-locks', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-owner' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const locks = () => db.tables.presence_page_locks || [];
const b64 = (u) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const world = () => { db.reset({ presence_sites: [{ id: SITE, client_id: OWNER }], presence_page_locks: [{ id: uuid('8'), site_id: OTHER, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 310000, key: 'B'.repeat(43) + '=' }] }); sent.length = 0; tableGone = false; };

// ═══ a password too short is refused, and nothing is kept ═══
{
  world();
  const r = await res(await R.handlePageLockCreate(req('POST', { password: ' abc ' }), site, owner, cors));
  ok('a short password: 422 and a plain sentence', r.status === 422 && r.body.message === 'Use at least 4 letters or numbers.');
  ok('a short password: nothing written', locks().length === 1);
  const r2 = await res(await R.handlePageLockCreate(req('POST'), site, owner, cors));
  ok('no password at all: the same sentence', r2.status === 422 && /at least 4/.test(r2.body.message));
}

// ═══ a good password: the key is kept, never the password ═══
{
  world();
  const r = await res(await R.handlePageLockCreate(req('POST', { password: 'open sesame' }), site, owner, cors));
  const row = locks().find((x) => x.site_id === SITE);
  ok('it answers the new lock’s id', r.status === 201 && r.body.data.id === row?.id);
  ok('the row is this site’s, with who set it', row && row.site_id === SITE && row.created_by === U);
  ok('the row holds a salt and a key, the right sizes', bytes(row.salt).length === 16 && bytes(row.key).length === 32 && row.iterations === 310000);
  ok('the key is what the password makes with that salt', b64(await lockKeyFromPassword('open sesame', bytes(row.salt), row.iterations)) === row.key);
  ok('the password never reached the database', !sent.some((b) => b.includes('sesame')));
  ok('a provenance line says a password was set, without it', (db.tables.presence_change_events || []).some((e) => e.summary === 'Set a page password') && !JSON.stringify(db.tables.presence_change_events || []).includes('sesame'));
  const again = await res(await R.handlePageLockCreate(req('POST', { password: 'open sesame' }), site, owner, cors));
  const mine = locks().filter((x) => x.site_id === SITE);
  ok('the same password again makes a new lock with its own salt', again.status === 201 && mine.length === 2 && mine[0].salt !== mine[1].salt && mine[0].key !== mine[1].key);

  // ═══ the list: this site's locks only ═══
  const list = await res(await R.handlePageLockList(site, cors));
  ok('the list names this site’s locks and no other', list.status === 200 && list.body.data.ready === true && list.body.data.ids.length === 2 && !list.body.data.ids.includes(uuid('8')));

  // ═══ what a publish reads ═══
  const keys = await R.readPageLocks(SITE, [row.id, uuid('8'), 'not-a-uuid']);
  ok('a publish gets this site’s key by id', keys.get(row.id)?.key === row.key && keys.get(row.id)?.salt === row.salt);
  ok('another site’s lock gives nothing, even named', !keys.has(uuid('8')) && keys.size === 1);
  ok('no ids reads nothing', (await R.readPageLocks(SITE, [])).size === 0);
}

// ═══ before the database update ═══
{
  world(); tableGone = true;
  const r = await res(await R.handlePageLockCreate(req('POST', { password: 'open sesame' }), site, owner, cors));
  ok('setting a password says it needs the update', r.status === 503 && r.body.message === 'Page passwords need a one-time database update before they can be set.');
  const list = await res(await R.handlePageLockList(site, cors));
  ok('the list is empty and says it isn’t ready', list.status === 200 && list.body.data.ready === false && list.body.data.ids.length === 0);
  ok('a publish finds no key, so the page stays off', (await R.readPageLocks(SITE, [uuid('8')])).size === 0);
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  page locks routes — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
