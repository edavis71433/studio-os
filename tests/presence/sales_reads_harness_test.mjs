// ── One harness for the sales reads: whose rows, and what a failure looks like ──
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_reads_harness_test.mjs
// Final pass on the sales side, batch D (Nov 8 2026). My tasks, the reports,
// saved views, picked lists, the audience counts and the calendar link were
// guarded by counting substrings of their source. This drives the real
// handlers on the shared in-memory PostgREST (fake_pgrst.mjs) instead:
//   1  every read of a studio's table carries that studio's site
//   2  a read that fails says so (partial / unavailable / couldn't count) —
//      it never reads as an empty list or a zero
//   3  a picked list in use can't be removed; a missing one is a 404
//   4  the calendar link's address is only for someone who can manage it
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const DEAL = '44444444-4444-4444-8444-444444444444', PROJ = '55555555-5555-4555-8555-555555555555', CUST = '66666666-6666-4666-8666-666666666666';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const B = await import('../../supabase/functions/presence/routes/broadcasts.ts');
const CAL = await import('../../supabase/functions/presence/routes/calendar.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const seat = { ...owner, userId: '77777777-7777-4777-8777-777777777777', email: 'seat@studio.test', member: { site_id: SITE, role: 'business_staff' } };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const LIST = 'aaaaaaaa-0000-4000-8000-000000000001';
const TOKEN = 'ab'.repeat(20);
const world = () => ({
  presence_deals: [
    { id: DEAL, site_id: SITE, title: 'Website rebuild', stage: 'proposal', next_step: 'Send the quote', next_step_at: day(1), expected_value_cents: 240000, created_at: day(-30), updated_at: day(-2), deleted_at: null, source: 'manual' },
    { id: 'abababab-0000-4000-8000-000000000001', site_id: SITE, title: 'Logo refresh', stage: 'won', converted_client_id: CUST, converted_at: day(-10), expected_value_cents: 90000, created_at: day(-60), updated_at: day(-1), deleted_at: null, source: 'manual' },
  ],
  presence_deal_tasks: [{ id: '88888888-8888-4888-8888-888888888888', site_id: SITE, deal_id: DEAL, title: 'Price the add-ons', due_date: day(0), status: 'open', created_at: day(-3), deleted_at: null }],
  presence_tasks: [{ id: '99999999-9999-4999-8999-999999999999', site_id: SITE, project_id: PROJ, title: 'Build the pages', status: 'todo', due_date: day(3), assigned_to: null, client_action_required: false, sort_order: 1, created_at: day(-4), deleted_at: null }],
  presence_projects: [{ id: PROJ, site_id: SITE, name: 'Larkspur site', status: 'active', deleted_at: null }],
  presence_invoices: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', site_id: SITE, status: 'paid', amount_cents: 50000, paid_at: day(-5), deleted_at: null }],
  presence_form_submissions: [{ id: 'cccccccc-0000-4000-8000-000000000001', site_id: SITE, email: 'riley@example.com', name: 'Riley', status: 'new', spam: false, created_at: day(-1), source_page: '/contact' }],
  presence_deal_events: [{ id: 'dddddddd-0000-4000-8000-000000000001', deal_id: DEAL, site_id: SITE, kind: 'stage_change', from_stage: 'qualified', to_stage: 'proposal', created_at: day(-2) }],
  presence_contacts: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', site_id: SITE, name: 'Ana Ruiz', email: 'ana@example.com', deleted_at: null }],
  presence_service_links: [{ project_id: PROJ, agency_site_id: SITE, customer_client_id: CUST, status: 'active' }],
  clients: [{ id: CUST, name: 'Jordan Ellis', email: 'jordan@example.com', contact_email: null }],
  presence_sales_templates: [
    { id: 'tpl-views', site_id: SITE, kind: 'proposal', name: '__saved_views__', body: JSON.stringify({ pipeline: [{ id: 'view-0001', name: 'Hot deals', base: 'proposal', q: '', cols: [], sort: null }] }), deleted_at: null, updated_at: day(-1) },
    { id: 'tpl-lists', site_id: SITE, kind: 'proposal', name: '__broadcast_lists__', body: JSON.stringify([{ id: LIST, name: 'Spring offer', people: [{ email: 'ana@example.com', name: 'Ana' }], created_at: day(-3) }]), deleted_at: null, updated_at: day(-3) },
    { id: 'tpl-cal', site_id: SITE, kind: 'proposal', name: '__calendar_feed__', body: JSON.stringify({ token: TOKEN, user_id: U, created_at: day(-2) }), deleted_at: null, updated_at: day(-2) },
  ],
  presence_broadcasts: [{ id: 'ffffffff-0000-4000-8000-000000000001', site_id: SITE, subject: 'Spring offer', audience: `list:${LIST}`, status: 'scheduled' }],
});

// ═══ 1. every read of a studio's table carries that studio's site ═══
{
  db.reset(world());
  await S.handleSalesMyTasks(req('GET', '/sales/my-tasks'), site, owner, cors);
  await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors);
  await S.handleSalesViews(req('GET', '/sales/views'), site, owner, cors);
  await S.handleSalesViews(req('PUT', '/sales/views', { list: 'pipeline', views: [{ name: 'Mine', base: '', q: '', cols: [], sort: { key: 'name', dir: 'desc' } }] }), site, owner, cors);
  await B.handleBroadcastSegments(site, cors);
  await B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { name: 'Picked', people: [{ email: 'bo@example.com' }] }), site, owner, cors);
  await CAL.handleCalendarLink(req('GET', '/calendar/link'), site, owner, cors);
  const reads = db.log.filter((c) => c.method === 'GET');
  // `clients` has no site: it is read only by the ids this studio's own links name. Sales item 37:
  // My tasks asks who the caller is (/auth/v1/user, their own sign-in) and their team
  // (presence_agency_members by the agency that sign-in belongs to), so it can show only theirs
  const stray = reads.filter((c) => !c.url.startsWith('/rest/v1/clients?') && !c.url.startsWith('/auth/v1/user') && !c.url.startsWith('/rest/v1/presence_agency_members?agency_id=eq.') && !c.url.includes(`site_id=eq.${SITE}`));
  ok('1: every read of a studio table names this studio\'s site', reads.length > 10 && stray.length === 0, stray.map((c) => c.url.slice(0, 90)).join(' | '));
  const cl = reads.filter((c) => c.url.startsWith('/rest/v1/clients?'));
  ok('1: the client names are read only for this studio\'s own customers', cl.every((c) => c.url.includes(`id=in.(${CUST})`)), cl.map((c) => c.url).join(' | '));
}

// ═══ 2. a read that fails says so ═══
{
  db.reset(world()); db.fail.add('presence_deal_tasks');
  const t = await res(await S.handleSalesMyTasks(req('GET', '/sales/my-tasks'), site, owner, cors));
  ok('2: My tasks with a failed read is partial, and still lists what it could read', t.status === 200 && t.body?.data?.partial === true && t.body.data.items.length >= 1 && !t.body.data.items.some((i) => i.kind === 'deal_task'), JSON.stringify(t.body?.data));

  db.reset(world()); db.fail.add('presence_invoices');
  let r = await res(await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors));
  ok('2: reports — money that couldn\'t be read is "unavailable", not $0', r.body?.data?.revenue?.unavailable === true && r.body?.data?.overdue?.unavailable === true, JSON.stringify([r.body?.data?.revenue, r.body?.data?.overdue]));
  const rv = await res(await S.handleSalesReceivables(req('GET', '/sales/receivables'), site, owner, cors));
  ok('2: Who owes you that couldn\'t be read is an error, never "all paid up"', rv.status === 502 && rv.body?.error === 'read_failed', JSON.stringify(rv));
  db.reset(world()); db.fail.add('presence_deal_events');
  r = await res(await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors));
  ok('2: reports — stage times and close dates that couldn\'t be read are "partial"', r.body?.data?.pipeline?.partial === true && r.body?.data?.outcomes?.partial === true, JSON.stringify([r.body?.data?.pipeline?.partial, r.body?.data?.outcomes?.partial]));
  db.reset(world()); db.fail.add('presence_deals');
  r = await res(await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors));
  ok('2: reports — no deals read means no pipeline and no won/lost, never zeros', r.body?.data?.pipeline?.unavailable === true && r.body?.data?.outcomes?.unavailable === true);

  db.reset(world()); db.fail.add('presence_sales_templates');
  const v = await res(await S.handleSalesViews(req('GET', '/sales/views'), site, owner, cors));
  ok('2: saved views that couldn\'t be read are an error, not "no views"', v.status === 502 && v.body?.error === 'read_failed', JSON.stringify(v));
  // S4: a list only holds the studio's own people, so the save path is reached with a contact (Ana)
  const l = await res(await B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { name: 'Picked', people: [{ email: 'ana@example.com' }] }), site, owner, cors));
  ok('2: a picked list that couldn\'t be saved says so', l.status === 502 && l.body?.error === 'write_failed', JSON.stringify(l));

  db.reset(world()); db.fail.add('presence_contacts');
  const g = await res(await B.handleBroadcastSegments(site, cors));
  const seg = (k) => (g.body?.data?.segments || []).find((s) => s.key === k);
  ok('2: an audience that couldn\'t be counted is "unknown", never 0', seg('contacts') && seg('contacts').count === null && g.body.data.partial === true, JSON.stringify(seg('contacts')));
  ok('2: …and the others still count', typeof seg('enquiries')?.count === 'number' && seg('enquiries').count >= 1, JSON.stringify(seg('enquiries')));
  db.reset(world());
  const g2 = await res(await B.handleBroadcastSegments(site, cors));
  const segs = g2.body?.data?.segments || [];
  ok('2: with every read fine nothing is partial', g2.body?.data?.partial === false && segs.length > 0 && segs.every((s) => typeof s.count === 'number'), JSON.stringify(g2.body?.data?.segments?.map((s) => [s.key, s.count])));
  const cust = async (setup) => { db.reset(world()); setup(); const r = await res(await B.handleBroadcastSegments(site, cors)); return (r.body?.data?.segments || []).find((s) => s.key === 'customers'); };
  ok('2: "Your customers" shows when the studio has some', (await cust(() => {}))?.count === 1);
  ok('2: …is left out when it has none', (await cust(() => { db.tables.presence_service_links = []; })) === undefined);
  ok('2: …and stays, without a number, when they couldn\'t be counted', (await cust(() => db.fail.add('presence_service_links')))?.count === null);
}

// ═══ 3. picked lists: in use, missing ═══
{
  db.reset(world());
  let d = await res(await B.handleBroadcastListDelete(site, owner, LIST, cors));
  ok('3: a list a scheduled update goes to can\'t be removed (409)', d.status === 409 && d.body?.error === 'in_use', JSON.stringify(d));
  d = await res(await B.handleBroadcastListDelete(site, owner, 'aaaaaaaa-0000-4000-8000-00000000ffff', cors));
  ok('3: a list that isn\'t there is a 404', d.status === 404, JSON.stringify(d));
  db.tables.presence_broadcasts[0].status = 'sent';
  d = await res(await B.handleBroadcastListDelete(site, owner, LIST, cors));
  ok('3: once nothing is going to it, it can be removed', d.status === 200 && JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === '__broadcast_lists__').body).length === 0, JSON.stringify(d));
}

// ═══ 4. the calendar link ═══
{
  db.reset(world());
  let c = await res(await CAL.handleCalendarLink(req('GET', '/calendar/link'), site, owner, cors));
  ok('4: the owner sees the private address', c.body?.data?.on === true && String(c.body.data.url || '').includes(TOKEN) && c.body.data.can_manage === true, JSON.stringify(c.body?.data));
  c = await res(await CAL.handleCalendarLink(req('GET', '/calendar/link'), site, seat, cors));
  ok('4: a seat that can\'t manage it sees that it is on, never the address', c.body?.data?.on === true && c.body.data.url === null && c.body.data.can_manage === false, JSON.stringify(c.body?.data));
  c = await res(await CAL.handleCalendarLink(req('POST', '/calendar/link'), site, seat, cors));
  ok('4: …and can\'t make a new one', c.status === 403 && JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === '__calendar_feed__').body).token === TOKEN);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
