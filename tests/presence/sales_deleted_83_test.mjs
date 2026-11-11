// ── Sales item 83 (Nov 2026): a deleted deal can be brought back, from one place ─
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_deleted_83_test.mjs
//
//   1  GET /sales/deleted lists the deals, contacts and to-dos deleted in the last 30 days,
//      with who a deal was with and which deal a to-do was on; a merged-away contact is not
//      there (its own Undo brings it back); a failed read says so
//   2  POST /sales/deals/:id/restore brings a deal back; its website enquiry is its own again,
//      unless the enquiry became another deal since (one enquiry, one deal)
//   3  a deleted to-do comes back (PATCH restore); nothing there is a 404
//   4  the routes, the roles and the deal's delete (asks in place, then Undo)
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest({});
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const R = await import('../../supabase/functions/presence/lib/site_roles.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const SITE = '11111111-1111-4111-8111-111111111111';
const site = { id: SITE, client_id: '22222222-2222-4222-8222-222222222222', status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333333', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();
const did = (n) => `dddddddd-0000-4000-8000-00000000000${n}`, cid = (n) => `cccccccc-0000-4000-8000-00000000000${n}`, tid = (n) => `abababab-0000-4000-8000-00000000000${n}`;
const SUB = 'ffffffff-0000-4000-8000-000000000001';
const world = () => ({
  presence_deals: [
    { id: did(1), site_id: SITE, title: 'Harbor Dental site', stage: 'proposal', expected_value_cents: 320000, contact_id: cid(1), source_submission_id: SUB, deleted_at: ago(2), created_at: ago(40), updated_at: ago(2) },
    { id: did(2), site_id: SITE, title: 'Old logo job', stage: 'lead', expected_value_cents: 0, contact_id: null, deleted_at: ago(45), created_at: ago(90), updated_at: ago(45) },
    { id: did(3), site_id: SITE, title: 'Juniper Floral shop', stage: 'qualified', expected_value_cents: 250000, contact_id: null, deleted_at: null, created_at: ago(9), updated_at: ago(1) },
  ],
  presence_contacts: [
    { id: cid(1), site_id: SITE, name: 'Avery Stone', email: 'avery@example.com', company: 'Stone Bakery', deleted_at: null },
    { id: cid(2), site_id: SITE, name: 'Blake Rowe', email: 'blake@example.com', company: '', deleted_at: ago(5), merged_into: null },
    { id: cid(3), site_id: SITE, name: 'Blake R.', email: 'b2@example.com', company: '', deleted_at: ago(1), merged_into: cid(2) },
  ],
  presence_deal_tasks: [
    { id: tid(1), site_id: SITE, deal_id: did(1), title: 'Send the quote', due_date: null, status: 'open', deleted_at: ago(2) },
    { id: tid(2), site_id: SITE, deal_id: did(3), title: 'Call back', due_date: '2030-01-05', status: 'open', deleted_at: ago(3) },
    { id: tid(3), site_id: SITE, deal_id: did(3), title: 'Still here', status: 'open', deleted_at: null },
  ],
  presence_form_submissions: [{ id: SUB, site_id: SITE, status: 'new', email: 'avery@example.com' }],
  presence_sales_templates: [{ id: 'tpl-stages', site_id: SITE, kind: 'proposal', name: '__stage_names__', body: JSON.stringify({ proposal: 'Quote out' }), deleted_at: null, updated_at: ago(3) }],
});

// ═══ 1. the list ═══
{
  db.reset(world());
  const r = await res(await S.handleSalesDeleted(site, cors));
  const d = r.body.data;
  eq('the deals deleted in the last 30 days, newest first (45 days ago has gone)', d.deals.map((x) => x.title), ['Harbor Dental site']);
  ok('…with who it was with, its value and its stage by the studio\'s own name for it', d.deals[0].person === 'Avery Stone' && d.deals[0].value_cents === 320000 && d.deals[0].stage === 'proposal' && typeof d.deals[0].stage_label === 'string' && d.deals[0].stage_label.length > 0, JSON.stringify(d.deals[0]));
  eq('the contacts, leaving out one merged into another', d.contacts.map((x) => x.name), ['Blake Rowe']);
  eq('the to-dos, newest first, each with the deal it was on', d.todos.map((x) => [x.title, x.deal_title, x.deal_gone]), [['Send the quote', 'Harbor Dental site', true], ['Call back', 'Juniper Floral shop', false]]);
  eq('it says how long things stay', d.days, 30);
  eq('nothing failed', d.partial, []);
  db.reset(world()); db.fail.add('presence_deal_tasks');
  const r2 = await res(await S.handleSalesDeleted(site, cors));
  ok('a read that fails is named, and the rest still lists', r2.status === 200 && r2.body.data.partial.includes('todos') && r2.body.data.deals.length === 1, JSON.stringify(r2.body.data.partial));
}

// ═══ 2. a deal comes back ═══
{
  db.reset(world());
  let r = await res(await S.handleSalesRestoreDeal(site, did(1), cors));
  const d1 = db.tables.presence_deals.find((x) => x.id === did(1));
  ok('the deal is back, as it was', r.status === 200 && r.body.data.restored === true && d1.deleted_at === null && d1.stage === 'proposal', JSON.stringify(r));
  ok('its website enquiry is its own again', db.tables.presence_form_submissions[0].status === 'converted');
  r = await res(await S.handleSalesRestoreDeal(site, did(3), cors));
  ok('a deal that was never deleted is a 404 that says where to look', r.status === 404 && /Recently deleted/.test(r.body.message), JSON.stringify(r));
  r = await res(await S.handleSalesRestoreDeal(site, 'nope', cors));
  ok('a bad id is a 400', r.status === 400);
  // the enquiry became another deal while this one was deleted
  const w = world();
  w.presence_deals.push({ id: did(4), site_id: SITE, title: 'Harbor Dental, again', stage: 'lead', contact_id: cid(1), source_submission_id: SUB, deleted_at: null, created_at: ago(1), updated_at: ago(1) });
  w.presence_form_submissions[0].status = 'converted';
  db.reset(w);
  r = await res(await S.handleSalesRestoreDeal(site, did(1), cors));
  const back = db.tables.presence_deals.find((x) => x.id === did(1));
  ok('one enquiry, one deal: it comes back without the link when the enquiry became another deal', r.status === 200 && back.deleted_at === null && back.source_submission_id === null, JSON.stringify(back));
  db.reset(world()); db.failMethod.set('presence_deals', 'PATCH');
  r = await res(await S.handleSalesRestoreDeal(site, did(1), cors));
  ok('a write that fails says so and changes nothing', r.status === 502 && db.tables.presence_deals.find((x) => x.id === did(1)).deleted_at !== null, JSON.stringify(r));
}

// ═══ 3. a to-do comes back ═══
{
  db.reset(world());
  let r = await res(await S.handleDealTaskUpdate(req('PATCH', `/sales/deal-tasks/${tid(2)}`, { restore: true }), site, owner, tid(2), cors));
  ok('a deleted to-do comes back', r.status === 200 && r.body.data.restored === true && db.tables.presence_deal_tasks.find((x) => x.id === tid(2)).deleted_at === null, JSON.stringify(r));
  r = await res(await S.handleDealTaskUpdate(req('PATCH', `/sales/deal-tasks/${tid(3)}`, { restore: true }), site, owner, tid(3), cors));
  ok('one that was never deleted is a 404', r.status === 404, JSON.stringify(r));
  r = await res(await S.handleDealTaskUpdate(req('PATCH', `/sales/deal-tasks/${tid(3)}`, { delete: true }), site, owner, tid(3), cors));
  ok('deleting still works as before', r.status === 200 && db.tables.presence_deal_tasks.find((x) => x.id === tid(3)).deleted_at !== null);
}

// ═══ 4. routes, roles, the delete itself ═══
{
  const idx = read('supabase/functions/presence/index.ts'), pipe = read('pipeline.html');
  ok('index: GET /sales/deleted and POST /sales/deals/:id/restore are routed', idx.includes("if (route === '/sales/deleted' && method === 'GET') return handleSalesDeleted(site, cors);") && idx.includes("if (m && method === 'POST') return handleSalesRestoreDeal(site, m[1], cors);"));
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  eq('roles: bringing a deal back is an edit, like a contact; deleting one stays delete', [R.memberWriteNeeds(`/sales/deals/${ID}/restore`, 'POST'), R.memberWriteNeeds(`/sales/contacts/${ID}/restore`, 'POST'), R.memberWriteNeeds(`/sales/deals/${ID}`, 'DELETE')], ['edit', 'edit', 'delete']);
  ok('Pipeline: deleting a deal asks in place (not a pop-up) and says it can come back', pipe.includes("k.confirmIn(delDeal,{text:q,yes:'Yes, delete it'})") && pipe.includes('You can bring it back from Recently deleted for 30 days.'));
  ok('Pipeline: …then Undo brings it straight back', pipe.includes("api('/sales/deals/'+encodeURIComponent(id)+'/restore','POST',{})") && pipe.includes("k.undoToast('Deal deleted. It stays in Recently deleted for 30 days.',back)"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
