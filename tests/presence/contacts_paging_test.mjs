// ── Item 66 (Nov 2026): contacts page past 100 and say how many there are ─────
// The server caps a contacts read at 100 (MAX_PAGE); Contacts asked for 500 and
// People for 200, got 100, and never said so. GET /sales/contacts now takes
// total=1 (one HEAD count beside the page read) and keeps a steady order
// (updated_at, then id) so offset pages never repeat or skip anyone. Real
// handler against the shared in-memory PostgREST; every name is made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/contacts_paging_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999';
const db = installFakePostgrest();
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: 'c1', status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const get = async (qs) => { const r = await S.handleSalesContacts(new Request(`https://fn.test/functions/v1/presence/sales/contacts?${qs}`), site, owner, {}); return { status: r.status, body: await r.json().catch(() => null) }; };
const id = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 240 people; twenty share one updated_at (an import lands them in the same second)
const people = Array.from({ length: 240 }, (_, i) => ({
  id: id(i + 1), site_id: SITE, name: i < 3 ? `Riley Marsh ${i + 1}` : `Person ${i + 1}`, email: `p${i + 1}@example.com`, phone: '', company: '',
  deleted_at: null, client_id: null, updated_at: i < 20 ? '2026-11-01T00:00:00.000Z' : new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60_000).toISOString(),
}));
const removed = { ...people[0], id: id(999), name: 'Gone Person', email: 'gone@example.com', deleted_at: '2026-11-02T00:00:00Z' };
const stranger = { ...people[0], id: id(998), site_id: OTHER, name: 'Riley Marsh elsewhere', email: 'x@other.test' };
db.reset({ presence_contacts: [...people, removed, stranger] });

{
  db.log = [];
  const p1 = await get('limit=100&offset=0&total=1');
  ok('page 1: 100 people and the total of everyone on this site', p1.status === 200 && p1.body.data.length === 100 && p1.body.total === 240, JSON.stringify({ n: p1.body?.data?.length, t: p1.body?.total }));
  const reads = db.log.filter((c) => c.url.startsWith('/rest/v1/presence_contacts'));
  ok('a page costs one page read and one count, whatever the roster size', reads.length === 2 && reads.filter((c) => c.method === 'GET').length === 1 && reads.filter((c) => c.method === 'HEAD').length === 1, JSON.stringify(reads.map((c) => c.method)));
  ok('the page read orders by updated_at, then id', reads.some((c) => c.method === 'GET' && c.url.includes('order=updated_at.desc,id.desc') && c.url.includes('limit=100') && c.url.includes('offset=0')));
  ok('the count reads ids only, with no limit', reads.some((c) => c.method === 'HEAD' && c.url.includes('select=id') && !c.url.includes('limit=')));
  const p2 = await get('limit=100&offset=100&total=1');
  const p3 = await get('limit=100&offset=200&total=1');
  ok('page 3 holds the last 40', p3.body.data.length === 40 && p3.body.total === 240);
  const all = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((c) => c.id);
  ok('three pages hold all 240, nobody twice (ties on updated_at included)', all.length === 240 && new Set(all).size === 240);
  ok('never a removed person or another site’s', !all.includes(removed.id) && !all.includes(stranger.id));
}
{
  db.log = [];
  const plain = await get('limit=100');
  ok('without total=1 there is no count, and no total in the answer', !('total' in plain.body) && db.log.every((c) => c.method !== 'HEAD'));
  const big = await get('limit=500&total=1');
  ok('asking for 500 still gets a page of 100 (the cap), now with the total', big.body.data.length === 100 && big.body.limit === 100 && big.body.total === 240);
}
{
  const q = await get('limit=100&offset=0&total=1&q=Riley');
  ok('a search counts its own matches (this site only)', q.body.data.length === 3 && q.body.total === 3, JSON.stringify({ n: q.body?.data?.length, t: q.body?.total }));
  const labels = await get('limit=100&include_deleted=1&total=1');
  ok('include_deleted counts the removed too (labels only)', labels.body.total === 241);
  const ids = await get(`limit=100&include_deleted=1&ids=${[id(5), id(200), removed.id, stranger.id].join(',')}`);
  ok('ids= looks up exactly those, removed included, never another site’s', ids.body.data.length === 3 && !ids.body.data.some((c) => c.id === stranger.id));
}
{
  db.failMethod.set('presence_contacts', 'HEAD');
  const r = await get('limit=100&total=1');
  ok('a failed count still returns the page, with total null (never a made-up number)', r.status === 200 && r.body.data.length === 100 && r.body.total === null);
  db.failMethod.delete('presence_contacts');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
