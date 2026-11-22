// ── Sales item 173: the Invoices page as a money home (direction A, the money wall) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/money_home_173_test.mjs
// The owed bar by age and the three debtors (lib/money_home.ts owedByAge; the page mirrors it),
// the months (homeMonths over revenueByMonth), Stripe's side of the month (stripeStrip), and
// the route: months for everyone, Stripe for the platform's own studio only, and an honest
// "couldn't be read" when Stripe is down. Stripe and the database are fakes.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('STRIPE_SECRET', 'sk_test_fake_173');
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const world = { stripe: [], down: false };
const fakeDb = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.hostname === 'api.stripe.com') {
    const path = u.pathname.replace('/v1/', '');
    world.stripe.push(path);
    if (world.down) return jres(500, { error: { message: 'down' } });
    if (path === 'balance_transactions') return jres(200, { object: 'list', has_more: false, data: u.searchParams.get('type') === 'charge' ? [{ type: 'charge', amount: 180000, fee: 5520, net: 174480, created: 1_794_000_000, source: { payment_intent: 'pi_1', metadata: {} } }] : [] });
    if (path === 'payouts') return jres(200, { object: 'list', has_more: false, data: [{ id: 'po_1', status: 'paid', amount: 139500, arrival_date: 1_794_100_000 }, { id: 'po_2', status: 'pending', amount: 35000, arrival_date: 1_795_000_000 }, { id: 'po_3', status: 'in_transit', amount: 1000, arrival_date: 1_795_500_000 }] });
    return jres(404, { error: { message: `unplanned ${path}` } });
  }
  return fakeDb(input, init);
};
const P = '../../supabase/functions/presence';
const H = await import(`${P}/lib/money_home.ts`);
const R = await import(`${P}/routes/money_home.ts`);

const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const site = { id: STUDIO.id, client_id: STUDIO.client_id, status: 'live', edition: 'presence' };
const staff = { kind: 'staff', userId: 'u-staff', email: 'staff@platform.example', tenantId: null, role: 'owner', jwt: 'jwt', requestId: 't' };
const owner = { kind: 'client', userId: 'u-owner', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'GET' });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const TODAY = '2026-11-18';

// ═══ owed by age ═══
{
  const items = [
    { id: 'a', status: 'open', due_date: '2026-11-25', amount_cents: 180000, business: 'Maple & Rye' },
    { id: 'b', status: 'open', due_date: '2026-11-07', amount_cents: 65000, business: 'Harbor Yoga' },
    { id: 'c', status: 'open', due_date: '2026-10-03', amount_cents: 120000, business: 'Blue Heron' },
    { id: 'd', status: 'open', due_date: '2026-08-01', amount_cents: 10000, business: 'Blue Heron' },
    { id: 'e', status: 'open', processing: true, due_date: '2026-10-01', amount_cents: 35000, business: 'Northside' },
    { id: 'f', status: 'open', not_sent: true, due_date: '2026-10-01', amount_cents: 99900, business: 'Draft Co' },
    { id: 'g', status: 'paid', amount_cents: 1, business: 'X' },
    { id: 'h', status: 'open', payment_for: 'b', amount_cents: 1, business: 'Harbor Yoga' },
  ];
  const a = H.owedByAge(items, TODAY);
  ok('the bar: not due · 1 to 30 · 31 to 60 · over 60, from sent open invoices only', JSON.stringify(a.buckets) === JSON.stringify({ current: 180000, d30: 65000, d60: 120000, d90: 10000 }) && a.total === 375000, JSON.stringify(a));
  ok('who owes most: the oldest debt first, then the biggest', a.rows.map((r) => r.name).join(',') === 'Blue Heron,Harbor Yoga,Maple & Rye' && a.rows[0].total === 130000 && a.rows[0].oldest === 109 && a.rows[2].oldest === 0);
}

// ═══ the months and Stripe's side ═══
{
  const m = H.homeMonths([{ month: '2026-10', label: 'Oct 2026', this_year: 4000, last_year: 1, retainer: 1000, returned: 500 }, { month: '2026-11', label: 'Nov 2026', this_year: -100, last_year: 0, retainer: 0, returned: 0 }]);
  ok('months: what came in less what went back, never below nothing', m.length === 2 && m[0].cents === 4000 && m[0].retainer_cents === 1000 && m[1].cents === 0);
  const s = H.stripeStrip('2026-11', [{ type: 'charge', amount: 180000, fee: 5520, net: 174480 }, { type: 'payment', amount: 35000, fee: 280, net: 34720 }, { type: 'refund', amount: -100, fee: 0, net: -100 }], [{ status: 'paid', amount: 139500, arrival_date: 1_794_100_000 }, { status: 'paid', amount: 999, arrival_date: 1_792_000_000 }, { status: 'pending', amount: 35000, arrival_date: 1_795_000_000 }, { status: 'in_transit', amount: 1000, arrival_date: 1_794_900_000 }, { status: 'canceled', amount: 5, arrival_date: 1_794_500_000 }], 1_794_500_000);
  ok('Stripe this month: paid online, the fees, what was kept', s.paid_online_cents === 215000 && s.fee_cents === 5800 && s.net_cents === 209200);
  ok('what reached the bank this month, and the next payout on its way (the soonest)', s.reached_bank_cents === 139500 && s.next_payout && s.next_payout.cents === 1000 && s.next_payout.arrival === '2025-11-23'.slice(0, 0) + new Date(1_794_900_000 * 1000).toISOString().slice(0, 10), JSON.stringify(s));
  ok('a month with nothing', JSON.stringify(H.stripeStrip('2026-11', [], [], 1).next_payout) === 'null');
}

// ═══ the route ═══
{
  db.reset({
    presence_invoices: [{ id: 'i1', site_id: STUDIO.id, status: 'paid', paid_at: '2026-11-05T18:00:00Z', amount_cents: 180000, deleted_at: null }, { id: 'i2', site_id: STUDIO.id, status: 'paid', paid_at: '2026-10-05T18:00:00Z', amount_cents: 50000, deleted_at: null }],
    presence_deal_events: [{ id: 'e1', site_id: STUDIO.id, deal_id: 'd', kind: 'invoice_paid', detail: { retainer: true, amount_cents: 40000 }, created_at: '2026-11-02T18:00:00Z' }],
    presence_money_returns: [{ id: 'r1', site_id: STUDIO.id, kind: 'refund', applies_to: 'invoice', invoice_id: 'i2', deal_id: 'd', amount_cents: 10000, counted_cents: 10000, counted_at: '2026-11-10T18:00:00Z', status: 'succeeded', happened_at: '2026-11-10T18:00:00Z', method: 'card' }],
    presence_locations: [{ site_id: STUDIO.id, timezone: 'America/Los_Angeles' }],
  });
  world.stripe = [];
  let r = await res(await R.handleMoneyHome(req(`/sales/money-home?today=${TODAY}`), site, owner, cors));
  const nov = r.body.data.months.find((m) => m.month === '2026-11'), oct = r.body.data.months.find((m) => m.month === '2026-10');
  ok('a studio gets twelve months (invoices and retainer charges, less what went back) and no Stripe strip', r.status === 200 && r.body.data.months.length === 12 && nov.cents === 210000 && nov.retainer_cents === 40000 && oct.cents === 50000 && r.body.data.stripe === null && r.body.data.stripe_books === false && world.stripe.length === 0, JSON.stringify(r.body));
  r = await res(await R.handleMoneyHome(req(`/sales/money-home?today=${TODAY}`), site, staff, cors));
  const s = r.body.data.stripe;
  ok('the platform’s own studio gets Stripe’s side, read with the two allowed calls', r.status === 200 && s && s.paid_online_cents === 180000 && s.fee_cents === 5520 && s.reached_bank_cents === 139500 && s.next_payout.cents === 35000 && world.stripe.every((p) => p === 'balance_transactions' || p === 'payouts'), JSON.stringify(r.body.data));
  world.down = true;
  r = await res(await R.handleMoneyHome(req(`/sales/money-home?today=${TODAY}`), site, staff, cors));
  ok('a Stripe that can’t be read says so, and the months still come', r.status === 200 && r.body.data.stripe === null && r.body.data.stripe_failed === true && r.body.data.months.length === 12);
  world.down = false;
  db.fail.add('presence_invoices');
  r = await res(await R.handleMoneyHome(req(`/sales/money-home?today=${TODAY}`), site, owner, cors));
  ok('a failed read of the payments is a 502, never twelve empty months', r.status === 502);
  db.fail.delete('presence_invoices');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILED:'); for (const r of results.filter((x) => !x.p)) console.log('  ' + r.n); Deno.exit(1); }
