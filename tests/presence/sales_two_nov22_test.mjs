// ── Sales items 186, 188, 190, 191, 200 (Nov 22 2026 review): the server halves ──
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_two_nov22_test.mjs
// Item 209 (Home's three new set-up steps) is in setup_strip_105_test.mjs, beside the strip; the
// pages (Show more, Change, the to-do editor, Prospects, Download) are in tests/e2e/sales-two-nov22.spec.ts.
// Every check drives the real code: the pure helpers, and the routes on the pretend database,
// with the clock held at the shared pinned moment.
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock, PINNED_NOW, daysFrom } from './clock.mjs';
pinClock();
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const SITE = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999';
const DEAL = 'dddddddd-0000-4000-8000-000000000001', CONTACT = 'cccccccc-0000-4000-8000-000000000001';
const ev = (n) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
const db = installFakePostgrest({ users: { 'jwt-owner': { id: ME, email: 'owner@studio.test' } } });
const A = await import('../../supabase/functions/presence/crm/deal_activity.ts');
const H = await import('../../supabase/functions/presence/routes/sales_history.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
const site = { id: SITE, client_id: null, status: 'live', edition: 'presence' };
const me = { kind: 'client', userId: ME, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const mate = { ...me, userId: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'sam@studio.test' };
const cors = {};
const call = async (fn, method, path, body, who = me) => {
  const req = new Request('https://fn.test/functions/v1/presence' + path, method === 'GET' ? {} : { method, body: JSON.stringify(body || {}) });
  const r = await fn(req, who);
  return { status: r.status, body: await r.json() };
};
const ago = (days) => daysFrom(PINNED_NOW, -days);

// ═══ 1. what changed on a deal, in words (item 191) ═══
eq('191: a value, a close date and an owner each write one line; the same value writes none', A.dealChanges(
  { expected_value_cents: 200000, expected_close: '2026-12-01', assigned_to: null, next_step: 'Call Ana' },
  { expected_value_cents: 250000, expected_close: '2026-12-15', assigned_to: ME }),
  [{ change: 'value', from: 200000, to: 250000 }, { change: 'close', from: '2026-12-01', to: '2026-12-15' }, { change: 'owner', from: null, to: ME }]);
eq('191: nothing changed, nothing written (a Details save sends every box)', A.dealChanges({ expected_value_cents: null, expected_close: null }, { expected_value_cents: 0, expected_close: null }), []);
eq('191: a ticked next step writes "Done", a cleared one alone writes nothing', [A.dealChanges({ next_step: 'Call Ana' }, { next_step: '' }, true), A.dealChanges({ next_step: 'Call Ana' }, { next_step: '' }, false)],
  [[{ change: 'step_done', step: 'Call Ana' }], []]);
eq('191: the lines read plainly, the year only when it isn\'t the line\'s own', [
  A.dealChangeLine({ change: 'step_done', step: 'Call Ana' }),
  A.dealChangeLine({ change: 'value', from: 200000, to: 250000 }),
  A.dealChangeLine({ change: 'value', from: 0, to: 90000 }),
  A.dealChangeLine({ change: 'value', from: 90000, to: 0 }),
  A.dealChangeLine({ change: 'close', from: '2026-12-01', to: '2027-01-15' }, '2026'),
  A.dealChangeLine({ change: 'close', from: null, to: '2026-12-15' }, '2026'),
], ['Done: Call Ana', 'Value changed from $2,000 to $2,500', 'Value set to $900', 'Value cleared (it was $900)', 'Close date moved from Dec 1 to Jan 15, 2027', 'Close date set to Dec 15']);

// ═══ 2. the timeline: removed logs gone, change lines in, the reader's own marked (items 186, 191) ═══
{
  const rows = [
    { id: ev(1), kind: 'note', actor: 'owner@studio.test', created_at: ago(3), detail: { activity_kind: 'call', body: 'Left a voicemail', occurred_at: ago(3) } },
    { id: ev(2), kind: 'note', actor: 'owner@studio.test', created_at: ago(2), detail: { activity_kind: 'removed', removed: { activity_kind: 'note', body: 'Something private' }, removed_at: ago(1) } },
    { id: ev(3), kind: 'note', actor: 'owner@studio.test', created_at: ago(1), detail: { change: 'value', from: 100000, to: 150000 } },
    { id: ev(4), kind: 'note', actor: 'owner@studio.test', created_at: ago(1), detail: { activity_kind: 'email', body: 'Sent the quote', occurred_at: ago(1), via: 'app' } },
    { id: ev(5), kind: 'note', actor: 'sam@studio.test', created_at: ago(1), detail: { activity_kind: 'meeting', body: 'Site visit', occurred_at: ago(1), edited_at: ago(0.5) } },
  ];
  const tl = A.markMine(A.mergeDealTimeline(rows), 'Owner@Studio.test');
  ok('186: a removed log is off the timeline, and its words with it', !tl.some((x) => x.log_id === ev(2)) && !JSON.stringify(tl).includes('Something private'));
  const change = tl.find((x) => x.id === 'evt:' + ev(3));
  ok('191: a change line reads as one, and says what changed', change?.kind === 'deal_change' && change.text === 'Value changed from $1,000 to $1,500' && change.change?.kind === 'value');
  ok('186: only the reader\'s own hand-logged line is theirs to change (not one Studio OS sent, not a teammate\'s)',
    tl.find((x) => x.log_id === ev(1))?.mine === true && !tl.find((x) => x.log_id === ev(4))?.mine && !tl.find((x) => x.log_id === ev(5))?.mine);
  ok('186: an edited line carries when it was edited', tl.find((x) => x.log_id === ev(5))?.edited_at === ago(0.5));
  ok('186: a removed log never counts as the last time you talked', A.lastContactedAt([rows[1]]) === null);
}
{
  const d = { activity_kind: 'note', body: 'Private words', occurred_at: ago(4), edited_at: ago(3) };
  const gone = H.removedDetail(d, 'owner@studio.test', PINNED_NOW);
  ok('186: removing keeps the words only under `removed`, and Restore gives the line back as it was',
    gone.activity_kind === 'removed' && !('body' in gone) && gone.removed.body === 'Private words' && JSON.stringify(H.restoredDetail(gone)) === JSON.stringify({ occurred_at: ago(4), edited_at: ago(3), activity_kind: 'note', body: 'Private words' }));
  eq('186: a correction is checked like a new log', [H.logEditIn({ kind: 'note', body: '  ' }, { kind: 'call', body: '', occurred_at: ago(1) }, PINNED_NOW).ok, H.logEditIn({ kind: 'visit' }, { kind: 'call', body: '', occurred_at: ago(1) }, PINNED_NOW).ok, H.logEditIn({ body: 'Spoke with Ana' }, { kind: 'call', body: '', occurred_at: ago(1) }, PINNED_NOW)],
    [false, false, { ok: true, kind: 'call', body: 'Spoke with Ana', occurred_at: ago(1) }]);
}

// ═══ 3. PATCH /sales/logs/:id (item 186) ═══
const logs = (id, b, who) => call((req, p) => H.handleSalesLog(req, site, p, id, cors), 'PATCH', '/sales/logs/' + id, b, who);
const world = () => ({
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Bakery website', stage: 'proposal', expected_value_cents: 200000, expected_close: '2026-12-01', next_step: 'Call Ana', next_step_at: '2026-11-20', contact_id: CONTACT, deleted_at: null, updated_at: ago(1), created_at: ago(30) }],
  presence_deal_events: [
    { id: ev(1), deal_id: DEAL, site_id: SITE, kind: 'note', actor: 'owner@studio.test', created_at: ago(3), detail: { activity_kind: 'call', body: 'Left a voicemail', occurred_at: ago(3) } },
    { id: ev(4), deal_id: DEAL, site_id: SITE, kind: 'note', actor: 'owner@studio.test', created_at: ago(1), detail: { activity_kind: 'email', body: 'Sent the quote', occurred_at: ago(1), via: 'app' } },
    { id: ev(6), deal_id: DEAL, site_id: OTHER, kind: 'note', actor: 'owner@studio.test', created_at: ago(1), detail: { activity_kind: 'call', body: 'Another studio', occurred_at: ago(1) } },
  ],
  presence_person_events: [{ id: ev(7), site_id: SITE, contact_id: CONTACT, client_id: null, kind: 'note', body: 'Prefers mornings', subject: '', occurred_at: ago(2), via: '', actor: 'owner@studio.test', actor_kind: 'client', created_at: ago(2), deleted_at: null }],
  presence_contacts: [{ id: CONTACT, site_id: SITE, name: 'Ana Ruiz', email: 'ana@harbor.example', phone: '(555) 010-2468', company: 'Harbor Lane Bakery', deleted_at: null, created_at: ago(400) }],
  presence_deal_tasks: [{ id: ev(8), site_id: SITE, deal_id: null, contact_id: null, client_id: null, title: 'Call Maria', due_date: '2026-11-24', status: 'open', deleted_at: null }],
});
db.reset(world());
let r = await logs(ev(1), { kind: 'call', body: 'Spoke with Ana, she wants a quote by Friday' });
const e1 = () => db.tables.presence_deal_events.find((x) => x.id === ev(1));
ok('186: the person who logged a call corrects it, and the line says it was edited', r.status === 200 && e1().detail.body === 'Spoke with Ana, she wants a quote by Friday' && e1().detail.edited_at === new Date(PINNED_NOW).toISOString() && e1().detail.edited_by === 'owner@studio.test' && e1().detail.occurred_at === ago(3), JSON.stringify(r));
r = await logs(ev(1), { body: 'Changed by a teammate' }, mate);
ok('186: a teammate can\'t change a line they didn\'t log', r.status === 403 && e1().detail.body.startsWith('Spoke with Ana'));
r = await logs(ev(4), { body: 'Rewritten' });
ok('186: an email Studio OS sent stays as it happened', r.status === 404 && db.tables.presence_deal_events.find((x) => x.id === ev(4)).detail.body === 'Sent the quote');
r = await logs(ev(6), { remove: true });
ok('186: another studio\'s line is not there to change', r.status === 404 && db.tables.presence_deal_events.find((x) => x.id === ev(6)).detail.activity_kind === 'call');
r = await logs(ev(1), { remove: true });
ok('186: Remove takes it off the deal\'s timeline and says it keeps 30 days', r.status === 200 && r.body.data.keep_days === 30 && e1().detail.activity_kind === 'removed' && !A.mergeDealTimeline([e1()]).length);
{
  const gone = await H.deletedLogs(SITE, 'owner@studio.test');
  ok('186: Recently deleted lists it, with its words and where it lived', gone?.length === 1 && gone[0].id === ev(1) && gone[0].kind === 'call' && gone[0].deal_id === DEAL && gone[0].body.startsWith('Spoke with Ana'), JSON.stringify(gone));
  ok('186: …and only to the person who logged it', (await H.deletedLogs(SITE, 'sam@studio.test'))?.length === 0);
}
r = await logs(ev(1), { restore: true });
ok('186: Restore puts it back exactly', r.status === 200 && e1().detail.activity_kind === 'call' && e1().detail.body.startsWith('Spoke with Ana') && !('removed' in e1().detail) && A.mergeDealTimeline([e1()]).length === 1);
r = await logs(ev(7), { kind: 'note', body: 'Prefers mornings, never Mondays' });
const p7 = () => db.tables.presence_person_events.find((x) => x.id === ev(7));
ok('186: a person\'s own note is corrected too, with its edited mark (APPLY-0273)', r.status === 200 && p7().body === 'Prefers mornings, never Mondays' && p7().edited_by === 'owner@studio.test');
r = await logs(ev(7), { remove: true });
ok('186: …removed into Recently deleted, and back', r.status === 200 && p7().deleted_at && (await H.deletedLogs(SITE, 'owner@studio.test')).some((x) => x.id === ev(7) && x.contact_id === CONTACT) && (await logs(ev(7), { restore: true })).status === 200 && p7().deleted_at === null);
db.failMethod.set('presence_person_events', 'PATCH');
r = await logs(ev(7), { body: 'Before the column' });
ok('186: a correction the database refuses fails plainly, never half-saved', r.status === 502 && p7().body === 'Prefers mornings, never Mondays');
db.failMethod.delete('presence_person_events');

// ═══ 4. the deal's history (item 191): change lines, Done, Undo, and Show older ═══
const deal = (b, who = me) => call((req, p) => S.handleSalesDeal(req, site, p, DEAL, cors), 'PATCH', '/sales/deals/' + DEAL, b, who);
const changeRows = () => db.tables.presence_deal_events.filter((x) => x.kind === 'note' && x.detail && x.detail.change);
db.reset(world());
r = await deal({ expected_value_cents: 250000, expected_close: '2026-12-15', notes: 'Bigger menu' });
ok('191: changing the value and close date writes a line for each, from the deal as it was', r.status === 200 && JSON.stringify(changeRows().map((x) => x.detail)) === JSON.stringify([{ change: 'value', from: 200000, to: 250000 }, { change: 'close', from: '2026-12-01', to: '2026-12-15' }]) && changeRows().every((x) => x.deal_id === DEAL && x.site_id === SITE && x.actor === 'owner@studio.test'), JSON.stringify(changeRows()));
r = await deal({ next_step: '', next_step_at: '', step_done: true });
const done = () => changeRows().filter((x) => x.detail.change === 'step_done');
ok('191: ticking the next step writes "Done: Call Ana"', r.status === 200 && done().length === 1 && A.dealChangeLine(done()[0].detail) === 'Done: Call Ana');
for (const x of done()) x.created_at = PINNED_NOW;   // the database stamps it; the pretend one leaves that to us
r = await deal({ next_step: 'Call Ana', next_step_at: '2026-11-20', step_undo: true });
ok('191: Undo on the tick takes its "Done" line back', r.status === 200 && done().length === 0);
r = await deal({ next_step: '', next_step_at: null });
ok('191: clearing the step in Details (no tick) writes no "Done"', r.status === 200 && done().length === 0);
{
  db.reset(world());
  for (let i = 0; i < 90; i++) db.tables.presence_deal_events.push({ id: `ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, deal_id: DEAL, site_id: SITE, kind: 'stage_change', from_stage: 'lead', to_stage: 'qualified', actor: 'owner@studio.test', created_at: daysFrom(PINNED_NOW, -(i + 10)), detail: {} });
  const read = await call((req, p) => S.handleSalesDeal(req, site, p, DEAL, cors), 'GET', '/sales/deals/' + DEAL);
  const before = read.body.data.history_before;
  ok('191: the deal read holds the newest 80 lines and says where the older ones start', read.status === 200 && read.body.data.events.length === 80 && typeof before === 'string' && before === read.body.data.events[79].created_at);
  ok('186: the read marks the reader\'s own hand-logged call', read.body.data.timeline.some((x) => x.log_id === ev(1) && x.mine === true));
  const older = await call((req, p) => H.handleDealHistory(req, site, p, DEAL, cors), 'GET', `/sales/deals/${DEAL}/history?before=${encodeURIComponent(before)}`);
  ok('191: Show older reads what comes before it, and says when that is all', older.status === 200 && older.body.data.timeline.length > 0 && older.body.data.timeline.every((x) => x.at < before) && older.body.data.more === false, JSON.stringify(older.body.data).slice(0, 200));
  ok('191: a "before" that isn\'t a moment is a 422', (await call((req, p) => H.handleDealHistory(req, site, p, DEAL, cors), 'GET', `/sales/deals/${DEAL}/history?before=soon`)).status === 422);
}

// ═══ 5. a to-do moves, changes and goes to someone else (item 200) ═══
const task = (b) => call((req, p) => S.handleDealTaskUpdate(req, site, p, ev(8), cors), 'PATCH', '/sales/deal-tasks/' + ev(8), b);
const t8 = () => db.tables.presence_deal_tasks.find((x) => x.id === ev(8));
db.reset(world());
r = await task({ title: 'Call Maria about the menu', due_date: '2026-11-27' });
ok('200: its words and its day change in one save', r.status === 200 && t8().title === 'Call Maria about the menu' && t8().due_date === '2026-11-27');
r = await task({ due_date: null });
ok('200: …and it can have no day', r.status === 200 && t8().due_date === null);
ok('200: a day that isn\'t one is a 422', (await task({ due_date: 'Thursday' })).status === 422);
r = await task({ for: { contact_id: CONTACT } });
ok('200: it goes to someone else, checked like a new one', r.status === 200 && t8().contact_id === CONTACT && t8().deal_id === null);
ok('200: …never to someone outside the studio', (await task({ for: { contact_id: 'cccccccc-0000-4000-8000-000000000999' } })).status === 422);
t8().deleted_at = ago(1);
r = await task({ title: 'Edited while deleted' });
ok('200: a deleted to-do is changed only by coming back', t8().title === 'Call Maria about the menu' && (await task({ restore: true })).status === 200 && t8().deleted_at === null);

// ═══ 6. "Is this someone you already have?" on every door (item 190) ═══
const check = (q) => call((req) => S.handlePeopleCheck(req, site, cors), 'GET', '/sales/people/check?' + new URLSearchParams(q).toString());
db.reset(world());
for (let i = 0; i < 1000; i++) db.tables.presence_contacts.push({ id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, site_id: SITE, name: `Person ${i}`, email: `p${i}@example.com`, phone: '', deleted_at: null, created_at: daysFrom(PINNED_NOW, -i / 10) });
r = await check({ name: 'Anna Ruiz', phone: '555.010.2468' });
ok('190: the check finds the person past the newest 1,000, by their phone', r.status === 200 && r.body.data.matches[0]?.id === CONTACT && r.body.data.matches[0].reasons.includes('same phone number'), JSON.stringify(r.body));
r = await check({ email: 'ANA@harbor.example' });
ok('190: …and by their email, whatever its capitals', r.body.data.matches[0]?.id === CONTACT);
ok('190: the newest 1,000 are read first', db.log.some((c) => c.url.includes('presence_contacts') && c.url.includes('order=created_at.desc') && c.url.includes('limit=1000')));
eq('190: nothing to go on, nothing found', (await check({})).body.data.matches, []);
{
  const IMP = 'abababab-0000-4000-8000-000000000001';
  db.reset(world()); db.tables.presence_contact_imports = [{ id: IMP, site_id: SITE, on_existing: 'skip', created_at: PINNED_NOW, undone_at: null }];
  const add = (b) => call((req, p) => S.handleSalesContacts(req, site, p, cors), 'POST', '/sales/contacts', b);
  r = await add({ name: 'Ana R.', phone: '+1 (555) 010-2468', import_id: IMP });
  ok('190: an import row with a phone and no email is the person already there with that phone', r.status === 200 && r.body.deduped === true && r.body.data.id === CONTACT && db.tables.presence_contacts.length === 1, JSON.stringify(r.body));
  r = await add({ name: 'New Person', phone: '(555) 777-1234', import_id: IMP });
  ok('190: …and a new phone is a new person', (r.status === 201 || r.status === 200) && !r.body.deduped && db.tables.presence_contacts.length === 2);
}

// ═══ 7. Pipeline's search reaches every deal (item 188) ═══
{
  db.reset(world());
  db.tables.presence_deals.push({ id: 'dddddddd-0000-4000-8000-000000000002', site_id: SITE, title: 'Spring menu', stage: 'lead', contact_id: null, expected_value_cents: 0, deleted_at: null, updated_at: ago(400), created_at: ago(400) });
  const list = (q) => call((req, p) => S.handleSalesDeals(req, site, p, cors), 'GET', '/sales/deals?' + new URLSearchParams(q).toString());
  r = await list({ q: 'harbor', people: '1', limit: '100' });
  ok('188: people=1 finds a deal by its person\'s company, not only its title', r.status === 200 && r.body.data.map((d) => d.id).join() === DEAL, JSON.stringify(r.body).slice(0, 200));
  r = await list({ q: 'spring', people: '1', limit: '100' });
  ok('188: …and still by its own name, however old', r.body.data.map((d) => d.title).join() === 'Spring menu');
  r = await list({ q: 'harbor', limit: '100' });
  ok('188: without it the search is the deal name alone, as + Create uses it', r.body.data.length === 0);
}

// ═══ 8. a line Studio OS wrote stays as it happened (item 186's live check, Nov 23) ═══
{
  const Act = await import('../../supabase/functions/presence/crm/activity.ts');
  const resent = { id: ev(9), deal_id: DEAL, site_id: SITE, kind: 'note', actor: 'owner@studio.test', created_at: ago(5), detail: { activity_kind: 'email', body: 'Welcome email re-sent to ana@harbor.example', occurred_at: ago(5) } };
  eq('186: the re-sent welcome line is Studio OS\'s, old (by its words) or new (via app); a line you typed is yours', [
    A.writtenByStudioOs(resent.detail), A.writtenByStudioOs({ ...resent.detail, via: 'app' }), A.writtenByStudioOs({ body: 'Sent the quote', via: 'bcc' }), A.writtenByStudioOs({ body: 'I re-sent the welcome email by hand' }),
  ], [true, true, true, false]);
  ok('186: the deal page offers no Change on it', !A.markMine(A.mergeDealTimeline([resent]), 'owner@studio.test')[0].mine);
  const item = Act.mapConversationItem({ id: ev(9), kind: 'activity', activity_kind: 'email', from: 'studio', actor: 'owner@studio.test', body: resent.detail.body, created_at: ago(5), via: '' }, 'owner@studio.test');
  ok('186: …nor does the customer record', item && item.log && item.log.mine === false);
  db.reset(world()); db.tables.presence_deal_events.push(resent);
  r = await logs(ev(9), { remove: true });
  ok('186: …and the route won\'t change or remove it', r.status === 404 && db.tables.presence_deal_events.find((x) => x.id === ev(9)).detail.activity_kind === 'email');
}

console.log(`\n════ SALES ITEMS 186-200 (Nov 22): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
