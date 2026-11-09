// ── Item 65 (Nov 2026): "today" is the studio's local day ─────────────────────
// From 4pm in Los Angeles the server's UTC day is already tomorrow, so an invoice
// or a to-do due today read "overdue" all evening on the record and the pipeline.
// The pages now send their local day as ?today=YYYY-MM-DD; the server judges
// overdue on that day and keeps its UTC day for anything else. Real handlers
// against the shared in-memory PostgREST; every name is made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/local_day_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222';
const DEAL = 'dddddddd-0000-4000-8000-000000000001';
const db = installFakePostgrest();
const L = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const A = await import('../../supabase/functions/presence/crm/activity.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`);
const body = async (r) => (await r.json().catch(() => null)) || {};

// ── callerToday: the page's day when it is a real day within one of UTC's ──
const NOW = '2026-11-10T07:30:00.000Z';   // 11:30pm Nov 9 in Los Angeles
ok('no ?today → the UTC day', L.callerToday(null, NOW) === '2026-11-10');
ok('Los Angeles evening: the page says Nov 9 and is believed', L.callerToday('2026-11-09', NOW) === '2026-11-09');
ok('Auckland morning: a day ahead is believed too', L.callerToday('2026-11-11', NOW) === '2026-11-11');
ok('two days away is no time zone → the UTC day', L.callerToday('2026-11-08', NOW) === '2026-11-10' && L.callerToday('2026-11-12', NOW) === '2026-11-10');
ok('not a real day → the UTC day', L.callerToday('2026-02-30', '2026-03-01T00:00:00Z') === '2026-03-01' && L.callerToday('2026-11-9', NOW) === '2026-11-10');
ok('junk → the UTC day', ['', ' ', 'today', '2026-11-09T00:00', '2026-11-09;drop', 42].every((v) => L.callerToday(v, NOW) === '2026-11-10'));
ok('month and year edges: Dec 31 local beside Jan 1 UTC', L.callerToday('2026-12-31', '2027-01-01T05:00:00Z') === '2026-12-31');

// ── the record's band (crm/activity.ts buildUpcoming) on the caller's day ──
const band = (day) => A.buildUpcoming({
  tasks: [{ id: 't1', status: 'open', title: 'Call Sam', due_date: '2026-11-09' }, { id: 't2', status: 'open', title: 'Send quote', due_date: '2026-11-08' }],
  deal: { id: DEAL, stage: 'proposal', next_step: 'Follow up', next_step_at: '2026-11-09' },
  invoices: [{ id: 'i1', status: 'open', title: 'Deposit', amount_cents: 50000, due_date: '2026-11-09', deal_id: DEAL }],
}, day);
const byTitle = (list, t) => list.find((u) => u.title.startsWith(t));
{
  const utc = band(NOW);   // what an older page gets: the UTC day, Nov 10
  ok('UTC day (old behaviour): today’s to-do reads overdue', byTitle(utc, 'Call Sam').overdue === true);
  const local = band(L.callerToday('2026-11-09', NOW));
  ok('local day: a to-do due today is not overdue', byTitle(local, 'Call Sam').overdue === false);
  ok('local day: the next step due today is not overdue', byTitle(local, 'Next step').overdue === false);
  ok('local day: the invoice due today is not overdue', byTitle(local, 'Unpaid invoice').overdue === false);
  ok('local day: yesterday’s to-do still is', byTitle(local, 'Send quote').overdue === true);
  const tomorrow = band('2026-11-10');
  ok('the next local day: today’s to-do becomes overdue', byTitle(tomorrow, 'Call Sam').overdue === true);
}

// ── /sales/summary and /sales/receivables take ?today= ──
const utcToday = new Date().toISOString().slice(0, 10);
const dayBefore = new Date(Date.parse(utcToday + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
db.reset({
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Acme website', stage: 'proposal', expected_value_cents: 100000, deleted_at: null, updated_at: new Date().toISOString() }],
  presence_invoices: [
    { id: 'i1', site_id: SITE, deal_id: DEAL, title: 'Deposit', amount_cents: 50000, status: 'open', due_date: dayBefore, deleted_at: null, created_at: new Date().toISOString() },
    { id: 'i2', site_id: SITE, deal_id: DEAL, title: 'Balance', amount_cents: 70000, status: 'open', due_date: '2099-01-01', deleted_at: null, created_at: new Date().toISOString() },
  ],
});
{
  const plain = await body(await S.handleSalesSummary(req('/sales/summary'), site, owner, {}));
  ok('summary without ?today: an invoice due yesterday (UTC) is overdue', plain.data?.ar?.overdue_count === 1, JSON.stringify(plain.data?.ar));
  // the studio's local day is still the day before (a Los Angeles evening)
  const local = await body(await S.handleSalesSummary(req('/sales/summary?today=' + dayBefore), site, owner, {}));
  ok('summary with the local day: the same invoice is due today, not overdue', local.data?.ar?.overdue_count === 0 && local.data?.ar?.count === 2, JSON.stringify(local.data?.ar));
  const junk = await body(await S.handleSalesSummary(req('/sales/summary?today=1999-01-01'), site, owner, {}));
  ok('summary with a day no time zone is on: the UTC day', junk.data?.ar?.overdue_count === 1);
  const rv0 = await body(await S.handleSalesReceivables(req('/sales/receivables'), site, owner, {}));
  ok('receivables without ?today: overdue on the UTC day', rv0.data?.overdue_cents === 50000 && rv0.data.items.find((i) => i.id === 'i1')?.state === 'overdue');
  const rv1 = await body(await S.handleSalesReceivables(req('/sales/receivables?today=' + dayBefore), site, owner, {}));
  ok('receivables with the local day: nothing overdue, the item says upcoming', rv1.data?.overdue_cents === 0 && rv1.data.items.find((i) => i.id === 'i1')?.state === 'upcoming' && rv1.data.items.find((i) => i.id === 'i1')?.overdue === false);
  ok('receivables with the local day: the total is unchanged', rv1.data?.total_cents === 120000);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
