// ── Sales items 86 + 105: an import that updates people already there and can be
//    undone, and two records for one person merged (and unmerged) ───────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/contact_import_merge_test.mjs
// Drives the real routes (routes/sales.ts POST /sales/contacts with an import id,
// routes/contacts_more.ts) on the in-memory PostgREST (fake_pgrst.mjs).
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const C1 = 'aaaaaaaa-0000-4000-8000-000000000001', C2 = 'aaaaaaaa-0000-4000-8000-000000000002', C3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const D1 = 'dddddddd-0000-4000-8000-000000000001', CUST = 'cccccccc-0000-4000-8000-000000000001', CUST2 = 'cccccccc-0000-4000-8000-000000000002';
const db = installFakePostgrest({ unique: { presence_contacts: [{ cols: ['site_id', 'email'], where: (r) => r.deleted_at == null && String(r.email || '') !== '', key: (r) => r.site_id + '|' + String(r.email || '').toLowerCase() }] } });
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const M = await import('../../supabase/functions/presence/routes/contacts_more.ts');
const L = await import('../../supabase/functions/presence/lib/contact_merge.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const contact = (id, extra = {}) => ({ id, site_id: SITE, name: '', email: '', phone: '', company: '', notes: '', custom: {}, client_id: null, found_via: '', job_title: '', phone2: '', address: {}, tags: [], deleted_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra });
const live = (id) => db.tables.presence_contacts.find((c) => c.id === id);
const post = (b) => S.handleSalesContacts(req('POST', '/sales/contacts', b), site, owner, cors).then(res);

// ═══ the pure rules ═══
{
  const ex = { name: 'Ana Ruiz', phone: '555-0101', company: '', tags: ['dental'], notes: 'Met at the expo', address: {}, custom: { size: '5' } };
  const { patch, changes } = L.importChanges(ex, { name: 'Ana Ruiz', phone: '', company: 'Bluebird Bakery', tags: ['referral', 'dental'], notes: 'Wants a quote', address: { city: 'Glendale' }, custom: { size: '', area: 'North' } });
  ok('importChanges: an empty cell never blanks a field (phone stays)', !('phone' in patch));
  ok('importChanges: a filled cell fills in (company), same value writes nothing (name)', patch.company === 'Bluebird Bakery' && !('name' in patch));
  ok('importChanges: tags are added to, not replaced', JSON.stringify(patch.tags) === JSON.stringify(['dental', 'referral']));
  ok('importChanges: notes go under the ones there', patch.notes === 'Met at the expo\n\nWants a quote');
  ok('importChanges: your own fields fill in key by key', JSON.stringify(patch.custom) === JSON.stringify({ size: '5', area: 'North' }));
  ok('importChanges: every change keeps its before and after', changes.company.before === '' && changes.company.after === 'Bluebird Bakery' && Object.keys(changes).length === Object.keys(patch).length);
  const back = L.undoPatch({ ...ex, ...patch, company: 'Changed since' }, changes);
  ok('undoPatch: puts fields back, leaves one changed since', back.patch.notes === 'Met at the expo' && !('company' in back.patch) && back.kept.includes('company'));
  const m = L.mergeValues({ name: 'Jordan Ellis', email: 'jordan@ellis.example', phone: '', tags: ['referral'], notes: 'A', custom: { a: '1' } }, { name: 'J. Ellis', email: 'j.ellis@mail.example', phone: '555-0144', tags: ['dental'], notes: 'B', custom: { a: '2', b: '3' } }, { email: 'other' });
  ok('mergeValues: the picked email, the kept name, an empty phone filled from the other', m.values.email === 'j.ellis@mail.example' && m.values.name === 'Jordan Ellis' && m.values.phone === '555-0144');
  ok('mergeValues: tags from both, your own fields from both (kept wins)', JSON.stringify(m.values.tags) === JSON.stringify(['referral', 'dental']) && JSON.stringify(m.values.custom) === JSON.stringify({ a: '1', b: '3' }));
  ok('mergeValues: notes from both, and the email not kept is noted', m.values.notes === 'A\n\nB\n\nAlso wrote from jordan@ellis.example');
  ok('mergeValues: two different customers is a merge to refuse', L.mergeValues({ client_id: CUST }, { client_id: CUST2 }).conflict === 'different_customers' && L.mergeValues({ client_id: CUST }, { client_id: null }).values.client_id === CUST);
}

// ═══ an import that updates, and its Undo ═══
{
  db.reset({ presence_contacts: [contact(C1, { name: 'Ana Ruiz', email: 'ana@example.com', phone: '555-0101', notes: 'Met at the expo', tags: ['dental'] }), contact(C2, { name: 'Bo Reyes', email: 'bo@example.com' })], presence_deals: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const start = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { file_name: 'google-contacts.csv', on_existing: 'update' }), site, owner, cors));
  const IMP = start.body?.data?.id;
  ok('import: starts a record of its own', start.status === 201 && !!IMP && db.tables.presence_contact_imports[0]?.on_existing === 'update');
  db.tables.presence_contact_imports[0].created_at = new Date().toISOString();   // the fake's clock runs days behind the real one
  const r1 = await post({ name: 'Ana Ruiz', email: 'ANA@example.com', phone: '', company: 'Bluebird Bakery', tags: 'referral', import_id: IMP });
  ok('import: someone already here is updated with what the file has (capitals don’t matter)', r1.status === 200 && r1.body?.updated === true && live(C1).company === 'Bluebird Bakery' && live(C1).phone === '555-0101' && JSON.stringify(live(C1).tags) === JSON.stringify(['dental', 'referral']));
  const r2 = await post({ name: 'Cy New', email: 'cy@example.com', import_id: IMP });
  const cy = db.tables.presence_contacts.find((c) => c.email === 'cy@example.com');
  ok('import: a new person is added and noted', r2.status === 201 && !!cy && db.tables.presence_contact_import_rows.some((x) => x.contact_id === cy.id && x.action === 'added'));
  const r3 = await post({ name: 'Di Deal', email: 'di@example.com', import_id: IMP });
  const di = db.tables.presence_contacts.find((c) => c.email === 'di@example.com');
  db.tables.presence_deals.push({ id: D1, site_id: SITE, contact_id: di.id, title: 'Di — site', stage: 'lead', deleted_at: null });
  ok('import: the update is noted with its before and after', db.tables.presence_contact_import_rows.some((x) => x.contact_id === C1 && x.action === 'updated' && x.changes.company.before === '' && x.changes.company.after === 'Bluebird Bakery'));
  const latest = await res(await M.handleContactImports(req('GET', '/sales/contacts/imports'), site, owner, cors));
  ok('import: the latest import of the day says what it did', latest.body?.data?.id === IMP && latest.body.data.added === 2 && latest.body.data.updated === 1 && !!latest.body.data.undo_until);
  live(C1).notes = 'Edited by hand';   // a field the import didn't touch, edited since: Undo doesn't care
  live(C1).tags = ['dental', 'referral', 'vip'];   // tags changed again since: Undo leaves them
  const undo = await res(await M.handleContactImportUndo(req('POST', `/sales/contacts/imports/${IMP}/undo`), site, owner, IMP, cors));
  ok('undo: the added person goes; the one with a deal now stays and is counted', undo.status === 200 && !!cy.deleted_at && !di.deleted_at && undo.body?.data?.removed === 1 && undo.body.data.kept >= 1, JSON.stringify(undo.body));
  ok('undo: the updated person’s company goes back; tags changed since stay', live(C1).company === '' && JSON.stringify(live(C1).tags) === JSON.stringify(['dental', 'referral', 'vip']) && undo.body.data.restored === 1);
  const again = await res(await M.handleContactImportUndo(req('POST', `/sales/contacts/imports/${IMP}/undo`), site, owner, IMP, cors));
  ok('undo: pressed twice, the second does nothing', again.status === 200 && again.body?.data?.already === true);
  const after = await post({ name: 'Ed', email: 'ed@example.com', import_id: IMP });
  ok('undo: an undone import takes no more rows (they come in as plain adds)', after.status === 201 && !db.tables.presence_contact_import_rows.some((x) => x.contact_id === after.body?.data?.id));
}
{
  db.reset({ presence_contacts: [contact(C1, { name: 'Ana', email: 'ana@example.com' })], presence_contact_imports: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', site_id: SITE, on_existing: 'skip', created_at: new Date(Date.now() - 3600_000).toISOString(), undone_at: null }], presence_contact_import_rows: [], presence_sales_templates: [] });
  const r = await post({ name: 'Ana NEW', email: 'ana@example.com', company: 'X', import_id: 'bbbbbbbb-0000-4000-8000-000000000001' });
  ok('import that skips: someone already here is left exactly as they were', r.status === 200 && r.body?.deduped === true && !r.body?.updated && live(C1).name === 'Ana' && live(C1).company === '');
  db.tables.presence_contact_imports[0].created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
  const old = await res(await M.handleContactImportUndo(req('POST', '/sales/contacts/imports/bbbbbbbb-0000-4000-8000-000000000001/undo'), site, owner, 'bbbbbbbb-0000-4000-8000-000000000001', cors));
  ok('undo: older than a day is refused with a sentence', old.status === 409 && old.body?.error === 'too_old');
  const other = await res(await M.handleContactImportUndo(req('POST', '/sales/contacts/imports/bbbbbbbb-0000-4000-8000-000000000009/undo'), { ...site, id: '99999999-9999-4999-8999-999999999999' }, owner, 'bbbbbbbb-0000-4000-8000-000000000001', cors));
  ok('undo: another site’s import is not found', other.status === 404);
}
// ═══ sales item 122: the whole file in one go, and its Undo ═══
{
  db.reset({ presence_contacts: [contact(C1, { name: 'Ana Ruiz', email: 'ana@example.com', phone: '555-0101', notes: 'Met at the expo', tags: ['dental'] }), contact(C2, { name: 'Bo Reyes', email: 'Bo@Example.com' })], presence_deals: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const file = [{ name: 'Ana Ruiz', email: 'ANA@example.com', company: 'Bluebird Bakery', tags: ['referral'] }, { name: 'Bo Reyes', email: 'bo@example.com' }];
  for (let i = 0; i < 250; i++) file.push({ name: `Person ${i}`, email: `P${i}@Example.com`, phone: `555-${1000 + i}`, address: { city: 'Burbank', state: 'CA' }, found_via: 'Google', tags: 'restaurant' });
  file.push({ name: 'Person 3 again', email: 'p3@example.com' });   // the same email twice in one file is one person
  file.push({ name: 'No Email' });                                   // a name alone is someone to add
  file.push({ phone: '555-9999' });                                  // neither a name nor an email: nothing to keep
  const before = db.log.length;
  const r = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { file_name: 'big.csv', on_existing: 'update', rows: file }), site, owner, cors));
  const calls = db.log.slice(before);
  const c = r.body?.data?.counts || {};
  ok('item 122: one request takes the whole file and counts what each row did', r.status === 201 && c.added === 251 && c.updated === 1 && c.existed === 2 && c.failed === 1, JSON.stringify(r.body));
  ok('item 122: …in a handful of database calls, not one or more per row', calls.length <= 15, `${calls.length} calls`);
  console.log(`      (the ${file.length}-row file took ${calls.length} database calls)`);
  const added = db.tables.presence_contacts.filter((x) => /^Person \d+$/.test(x.name));
  ok('item 122: the new people are stored as one added by hand would be (email lower-cased, address in parts, tags, found via)', added.length === 250 && added.every((x) => x.email === x.email.toLowerCase()) && added[0].address?.city === 'Burbank' && JSON.stringify(added[0].tags) === JSON.stringify(['restaurant']) && added[0].found_via === 'Google');
  ok('item 122: someone already here (capitals and all) is updated with what the file has', live(C1).company === 'Bluebird Bakery' && JSON.stringify(live(C1).tags) === JSON.stringify(['dental', 'referral']) && live(C1).phone === '555-0101');
  ok('item 122: someone the file has nothing new for is left as they were', live(C2).name === 'Bo Reyes' && live(C2).email === 'Bo@Example.com');
  ok('item 122: a second row for the same email is not a second person', db.tables.presence_contacts.filter((x) => x.email === 'p3@example.com').length === 1);
  const IMP = r.body.data.id;
  ok('item 122: the import is kept for Undo, with every row it touched', r.body.data.undo === true && db.tables.presence_contact_imports[0]?.on_existing === 'update' && db.tables.presence_contact_import_rows.filter((x) => x.action === 'added').length === 251 && db.tables.presence_contact_import_rows.filter((x) => x.action === 'updated').length === 1);
  db.tables.presence_contact_imports[0].created_at = new Date().toISOString();
  db.tables.presence_deals.push({ id: D1, site_id: SITE, contact_id: added[0].id, title: 'Person 0 — site', stage: 'lead', deleted_at: null });
  const u0 = db.log.length;
  const undo = await res(await M.handleContactImportUndo(req('POST', `/sales/contacts/imports/${IMP}/undo`), site, owner, IMP, cors));
  const undoCalls = db.log.length - u0;
  ok('item 122: Undo takes the added people off (one with a deal now stays) and puts the updated one back', undo.status === 200 && undo.body?.data?.removed === 250 && undo.body.data.restored === 1 && undo.body.data.kept === 1 && live(C1).company === '', JSON.stringify(undo.body));
  ok('item 122: …in a handful of calls too', undoCalls <= 15, `${undoCalls} calls`);
  console.log(`      (its Undo took ${undoCalls} database calls)`);
}
{
  // a big "update" import's Undo reads back a hundred at a time and writes eight at a time
  const people = []; for (let i = 0; i < 230; i++) people.push(contact(`aaaaaaaa-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, { name: `Up ${i}`, email: `up${i}@example.com` }));
  db.reset({ presence_contacts: people, presence_deals: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const r = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { file_name: 'u.csv', on_existing: 'update', rows: people.map((x) => ({ name: x.name, email: x.email, company: 'New Co' })) }), site, owner, cors));
  ok('item 122: 230 people updated in one request', r.body?.data?.counts?.updated === 230 && people.every((x) => live(x.id).company === 'New Co'));
  db.tables.presence_contact_imports[0].created_at = new Date().toISOString();
  const before = db.log.length;
  const undo = await res(await M.handleContactImportUndo(req('POST', `/sales/contacts/imports/${r.body.data.id}/undo`), site, owner, r.body.data.id, cors));
  const reads = db.log.slice(before).filter((x) => x.method === 'GET' && x.url.startsWith('/rest/v1/presence_contacts?'));
  ok('item 122: Undo of a 230-person update reads them back three times, not 230', undo.body?.data?.restored === 230 && reads.length === 3 && people.every((x) => live(x.id).company === ''), `${reads.length} reads, ${JSON.stringify(undo.body)}`);
}
{
  // "Leave them as they are", an over-long file, and a file with no one in it
  db.reset({ presence_contacts: [contact(C1, { name: 'Ana', email: 'ana@example.com' })], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const r = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { on_existing: 'skip', rows: [{ name: 'Ana NEW', email: 'ana@example.com', company: 'X' }, { name: 'Cy', email: 'cy@example.com' }] }), site, owner, cors));
  ok('item 122: skipping leaves someone already here exactly as they were', r.body?.data?.counts?.existed === 1 && r.body.data.counts.added === 1 && live(C1).name === 'Ana' && live(C1).company === '');
  const big = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { rows: Array.from({ length: 501 }, (_, i) => ({ name: 'P' + i })) }), site, owner, cors));
  ok('item 122: more than 500 is refused with a sentence, nothing written', big.status === 413 && /500 people at a time/.test(big.body?.message || '') && db.tables.presence_contacts.length === 2);
  const none = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { rows: [] }), site, owner, cors));
  ok('item 122: an empty file is refused plainly', none.status === 422);
}
{
  // someone with one of the file's emails is added between the read and the write: that hundred goes again one by one
  db.reset({ presence_contacts: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const real = globalThis.fetch; let raced = false;
  globalThis.fetch = async (url, init = {}) => {
    if (!raced && String(url).includes('/rest/v1/presence_contacts?columns=') && (init.method || 'GET') === 'POST') { raced = true; db.tables.presence_contacts.push(contact('aaaaaaaa-0000-4000-8000-00000000beef', { name: 'Already', email: 'race@example.com' })); }
    return real(url, init);
  };
  const r = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { rows: [{ name: 'One', email: 'one@example.com' }, { name: 'Race', email: 'RACE@example.com' }, { name: 'Two', email: 'two@example.com' }] }), site, owner, cors));
  globalThis.fetch = real;
  ok('item 122: a clash mid-file costs only that row: the rest still go in, and the one added meanwhile counts as already here', r.body?.data?.counts?.added === 2 && r.body.data.counts.existed === 1 && db.tables.presence_contacts.filter((x) => x.email === 'race@example.com').length === 1, JSON.stringify(r.body));
}
{
  // the add form and a whole-file import store one person the same way
  db.reset({ presence_contacts: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  const person = { name: '  Dee Lane ', email: 'Dee@Example.com', phone: '555-0303', company: 'Lane Co', job_title: 'Owner', phone2: '555-0404', address: { street: '1 Elm', city: 'Glendale' }, tags: 'vip, restaurant', notes: 'Hi', found_via: 'referral' };
  await post(person);
  const one = { ...db.tables.presence_contacts[0] };
  db.reset({ presence_contacts: [], presence_contact_imports: [], presence_contact_import_rows: [], presence_sales_templates: [] });
  await M.handleContactImports(req('POST', '/sales/contacts/imports', { rows: [person] }), site, owner, cors);
  const two = { ...db.tables.presence_contacts[0] };
  const strip = (x) => { const o = { ...x }; for (const k of ['id', 'created_at', 'updated_at']) delete o[k]; return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); };
  ok('item 122: the same fields, cleaned the same way, by the one set of rules (lib/contact_row.ts)', strip(one) === strip(two), strip(one) + ' vs ' + strip(two));
}
{
  db.reset({ presence_contacts: [], presence_sales_templates: [] });
  db.fail.add('presence_contact_imports');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => String(url).includes('/rest/v1/presence_contact_imports') ? new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }), { status: 404 }) : real(url, init);
  const r = await res(await M.handleContactImports(req('POST', '/sales/contacts/imports', { file_name: 'x.csv' }), site, owner, cors));
  globalThis.fetch = real;
  ok('before APPLY-0168: the import still runs, and says Undo needs a database update', r.status === 200 && r.body?.data?.id === null && /APPLY-0168/.test(r.body?.message || ''));
}

// ═══ merging two records for one person ═══
const mergeWorld = () => ({
  presence_contacts: [
    contact(C1, { name: 'Jordan Ellis', email: 'jordan@ellis.example', phone: '', company: 'Ellis Plumbing', tags: ['referral'], notes: 'Prefers texts' }),
    contact(C2, { name: 'J. Ellis', email: 'j.ellis@mail.example', phone: '(555) 010-0144', job_title: 'Owner', tags: ['dental'], notes: 'Asked about SEO', client_id: CUST }),
    contact(C3, { name: 'Someone Else', email: 'else@example.com', client_id: CUST2 }),
  ],
  presence_deals: [{ id: D1, site_id: SITE, contact_id: C2, title: 'Ellis — new site', stage: 'proposal', deleted_at: null }, { id: 'dddddddd-0000-4000-8000-000000000002', site_id: SITE, contact_id: C2, title: 'Gone deal', stage: 'lead', deleted_at: '2026-10-01T00:00:00Z' }],
  presence_appointments: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', site_id: SITE, contact_id: C2 }],
  presence_reviews: [{ id: 'eeeeeeee-0000-4000-8000-000000000002', site_id: SITE, contact_id: C2 }],
  presence_sales_templates: [],
});
{
  db.reset(mergeWorld());
  const dry = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C1}/merge`, { from: C2, pick: { email: 'other' } }), site, owner, C1, cors));
  ok('merge: without confirm it shows both records and what would move, and writes nothing', dry.status === 200 && dry.body?.data?.dry_run === true && dry.body.data.moves.deals === 1 && dry.body.data.moves.bookings === 1 && dry.body.data.result.email === 'j.ellis@mail.example' && db.log.filter((c) => c.method !== 'GET').length === 0);
  const go = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C1}/merge`, { from: C2, pick: { email: 'other' }, confirm: true }), site, owner, C1, cors));
  ok('merge: done, and says what moved', go.status === 200 && go.body?.data?.merged === true && go.body.data.moved.deals === 1 && go.body.data.moved.bookings === 1 && go.body.data.moved.reviews === 1, JSON.stringify(go.body));
  ok('merge: the deal, the booking and the review now belong to the kept record (a deleted deal stays put)', db.tables.presence_deals[0].contact_id === C1 && db.tables.presence_deals[1].contact_id === C2 && db.tables.presence_appointments[0].contact_id === C1 && db.tables.presence_reviews[0].contact_id === C1);
  const keep = live(C1), away = live(C2);
  ok('merge: the kept record takes the picked email (freed by the other stepping aside), fills its empty phone, gets both tags and the customer link', keep.email === 'j.ellis@mail.example' && keep.phone === '(555) 010-0144' && keep.job_title === 'Owner' && JSON.stringify(keep.tags) === JSON.stringify(['referral', 'dental']) && keep.client_id === CUST);
  ok('merge: notes from both, and the email no longer on the record is noted', /Prefers texts/.test(keep.notes) && /Asked about SEO/.test(keep.notes) && /Also wrote from jordan@ellis\.example/.test(keep.notes));
  ok('merge: the other record steps aside, keeping what it takes to undo', !!away.deleted_at && away.merged_into === C1 && away.merge_record?.moved?.deals?.includes(D1));
  const un = await res(await M.handleContactUnmerge(req('POST', `/sales/contacts/${C2}/unmerge`), site, owner, C2, cors));
  ok('unmerge: everything goes back', un.status === 200 && !live(C2).deleted_at && live(C2).merged_into == null && live(C1).email === 'jordan@ellis.example' && live(C1).phone === '' && db.tables.presence_deals[0].contact_id === C2 && db.tables.presence_appointments[0].contact_id === C2, JSON.stringify(un.body));
  const twice = await res(await M.handleContactUnmerge(req('POST', `/sales/contacts/${C2}/unmerge`), site, owner, C2, cors));
  ok('unmerge: a second time is a plain 404', twice.status === 404);
}
{
  db.reset(mergeWorld());
  const r = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C2}/merge`, { from: C3, confirm: true }), site, owner, C2, cors));
  ok('merge: two different customers are refused, nothing written', r.status === 409 && r.body?.error === 'different_customers' && db.log.filter((c) => c.method !== 'GET').length === 0);
  const self = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C1}/merge`, { from: C1, confirm: true }), site, owner, C1, cors));
  ok('merge: a record with itself is refused', self.status === 400);
  const elsewhere = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C1}/merge`, { from: C2, confirm: true }), { ...site, id: '99999999-9999-4999-8999-999999999999' }, owner, C1, cors));
  ok('merge: another site’s records are not found', elsewhere.status === 404);
}
{
  db.reset(mergeWorld());
  db.failMethod.set('presence_deals', 'PATCH');
  const r = await res(await M.handleContactMerge(req('POST', `/sales/contacts/${C1}/merge`, { from: C2, confirm: true }), site, owner, C1, cors));
  ok('merge: a part that fails puts everything back and says so', r.status === 502 && !live(C2).deleted_at && live(C1).email === 'jordan@ellis.example' && db.tables.presence_appointments[0].contact_id === C2, JSON.stringify(r.body));
}

console.log(`\n════ IMPORT UNDO + MERGE (items 86, 105): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
