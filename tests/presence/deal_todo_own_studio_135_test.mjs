// ── Sales item 135 (Nov 2026): a to-do goes only on one of this studio's own deals ─
//   deno run --allow-read --allow-env --allow-net tests/presence/deal_todo_own_studio_135_test.mjs
//
// POST /sales/deals/:id/tasks used to save a to-do against any deal id it was given. The to-do
// landed in the caller's own studio, so nothing of the other studio was read or changed, but it
// was the one deal route that didn't refuse a deal that isn't the caller's. Now it answers the
// same 404 the deal's own page, its activity log and its stage moves give, and writes nothing.
//
//   1  a to-do on this studio's own deal still saves, owned by whoever added it
//   2  another studio's deal is refused with 404, and no to-do is written anywhere
//   3  a deleted deal and an id that was never a deal are refused the same way
//   4  the refusal comes before the body is read: another studio's deal never answers 400 or 422
//   5  the other deal routes refuse that same deal with the same 404 (the item's yardstick)
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest({});
Deno.env.set('SITE_URL', 'https://app.example.test');
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

const SITE = '11111111-1111-4111-8111-111111111111', OTHER_SITE = '99999999-9999-4999-8999-999999999999';
const OWNER = '22222222-2222-4222-8222-222222222222';
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333333', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const MINE = 'dddddddd-0000-4000-8000-000000000001', THEIRS = 'dddddddd-0000-4000-8000-000000000002';
const GONE = 'dddddddd-0000-4000-8000-000000000003', NEVER = 'dddddddd-0000-4000-8000-000000000004';
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const world = () => ({
  presence_sites: [{ id: SITE, client_id: OWNER }, { id: OTHER_SITE, client_id: '44444444-4444-4444-8444-444444444444' }],
  presence_deals: [
    { id: MINE, site_id: SITE, title: 'Harbor Dental site', stage: 'proposal', deleted_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' },
    { id: THEIRS, site_id: OTHER_SITE, title: 'Another studio’s deal', stage: 'lead', deleted_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' },
    { id: GONE, site_id: SITE, title: 'A deal put in Recently deleted', stage: 'lead', deleted_at: '2026-11-10T10:00:00Z', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-10T10:00:00Z' },
  ],
  presence_deal_tasks: [],
  presence_deal_events: [],
});
const add = (dealId, body = { title: 'Send the quote', due_date: '2026-11-20' }) => S.handleDealTaskCreate(req('POST', `/sales/deals/${dealId}/tasks`, body), site, owner, dealId, cors);

// ═══ 1. this studio's own deal ═══
{
  db.reset(world());
  const r = await res(await add(MINE));
  eq('a to-do on your own deal saves', r.status, 201);
  const saved = db.tables.presence_deal_tasks;
  eq('one to-do is in the table', saved.length, 1);
  eq('it is on that deal, in this studio', [saved[0].deal_id, saved[0].site_id], [MINE, SITE]);
  eq('with its title, its day and whoever added it as its owner', [saved[0].title, saved[0].due_date, saved[0].assigned_to], ['Send the quote', '2026-11-20', owner.userId]);
  eq('the answer is the saved row', r.body?.data?.id, saved[0].id);
}

// ═══ 2. another studio's deal ═══
{
  db.reset(world());
  const r = await res(await add(THEIRS));
  eq('another studio’s deal is refused as not found', [r.status, r.body?.error], [404, 'not_found']);
  ok('with the words the other deal routes use', r.body?.message === 'That deal is no longer here.', JSON.stringify(r.body));
  eq('no to-do was written, in either studio', db.tables.presence_deal_tasks.length, 0);
  eq('nothing at all was written', db.log.filter((c) => c.method !== 'GET').length, 0);
  eq('the other studio’s deal is as it was', db.tables.presence_deals.find((d) => d.id === THEIRS), world().presence_deals.find((d) => d.id === THEIRS));
}

// ═══ 3. a deleted deal, and an id that was never a deal ═══
for (const [label, id] of [['a deal in Recently deleted', GONE], ['an id that was never a deal', NEVER]]) {
  db.reset(world());
  const r = await res(await add(id));
  eq(`${label} is refused as not found`, [r.status, r.body?.error], [404, 'not_found']);
  eq(`${label}: no to-do was written`, db.tables.presence_deal_tasks.length, 0);
}

// ═══ 4. refused before the body is read ═══
{
  db.reset(world());
  const empty = await res(await add(THEIRS, { title: '' }));
  eq('an empty title on another studio’s deal is still not found, not a validation answer', empty.status, 404);
  const broken = await res(await S.handleDealTaskCreate(req('POST', `/sales/deals/${THEIRS}/tasks`, '{not json'), site, owner, THEIRS, cors));
  eq('a broken body on another studio’s deal is still not found', broken.status, 404);
  db.reset(world());
  const mineEmpty = await res(await add(MINE, { title: '' }));
  eq('on your own deal an empty title is still asked for', [mineEmpty.status, mineEmpty.body?.error], [422, 'validation']);
}

// ═══ 5. the same deal, through the other deal routes ═══
{
  db.reset(world());
  const page = await res(await S.handleSalesDeal(req('GET', `/sales/deals/${THEIRS}`), site, owner, THEIRS, cors));
  const log = await res(await S.handleSalesDealActivity(req('POST', `/sales/deals/${THEIRS}/activity`, { kind: 'call', body: 'Rang them' }), site, owner, THEIRS, cors));
  const todo = await res(await add(THEIRS));
  eq('the deal page, its activity log and its to-dos answer alike', [page.status, log.status, todo.status], [404, 404, 404]);
  eq('and agree on the words', [page.body?.message, log.body?.message, todo.body?.message], Array(3).fill('That deal is no longer here.'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
