// ── Sales item 133: the bookkeeper file shows what reached the bank ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/stripe_fees_payouts_133_test.mjs
//
// The Nov 15 2026 Stripe review (finding 7): payments.csv listed what clients paid, but
// Stripe keeps its fee and sends the rest out in payouts days later, so no line matched
// anything that arrived. Now each payment Stripe took shows its fee, what was kept and the
// day the payout carrying it arrived, and payouts.csv has one row per deposit with what
// made it up. The pure folding first, then the real route on the in-memory PostgREST with
// a pretend Stripe. Every name, number and id is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('STRIPE_SECRET', 'rk_test_fake133');
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222';
const DEAL = 'aaaaaaaa-0000-4000-8000-000000000001', CUST = '66666666-6666-4666-8666-666666666666', PERSON = 'cccccccc-0000-4000-8000-000000000001';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = installFakePostgrest();
const A = await import('../../supabase/functions/presence/lib/accounting_export.ts');
const L = await import('../../supabase/functions/presence/lib/stripe_ledger.ts');
const X = await import('../../supabase/functions/presence/routes/accounting_export.ts');
const { STRIPE_API_VERSION } = await import('../../supabase/functions/presence/commerce/stripe_shape.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);
const sec = (iso) => Date.parse(iso) / 1000;

// ═══ Stripe's side, as Stripe sends it (2026-05-27.dahlia) ═══
const INV_A = id('ffffffff', 1), INV_B = id('ffffffff', 2), INV_C = id('ffffffff', 3), INV_D = id('ffffffff', 4);
const charge = (chId, pi, meta = {}) => ({ id: chId, object: 'charge', payment_intent: pi, metadata: meta });
const bt = (txn, type, amount, fee, createdIso, source, payout = null) => ({ id: txn, object: 'balance_transaction', type, amount, fee, net: amount - fee, created: sec(createdIso), currency: 'usd', status: 'available', source, _payout: payout });
const BTS = [
  bt('txn_R', 'charge', 25000, 755, '2026-10-15T15:59:00Z', charge('ch_R', 'pi_R'), 'po_1'),                                  // a retainer's monthly charge: no notes of ours on it
  bt('txn_A', 'charge', 120000, 3510, '2026-10-20T17:59:00Z', charge('ch_A', 'pi_A', { presence_invoice_id: INV_A }), 'po_1'), // card, invoice 41
  bt('txn_A2', 'charge', 120000, 3510, '2026-10-20T19:00:00Z', charge('ch_A2', 'pi_A2', { presence_invoice_id: INV_A }), 'po_1'), // the same invoice paid twice
  bt('txn_X', 'charge', 9900, 317, '2026-10-05T12:00:00Z', charge('ch_X', 'pi_X', { kind: 'audit' }), 'po_1'),                // a free-tools order, not an invoice
  bt('txn_C', 'payment', 30000, 240, '2026-10-24T12:00:00Z', charge('py_C', 'pi_C', { presence_invoice_id: INV_C }), 'po_2'), // a bank payment, settled Oct 28, paid out Nov 2
  bt('txn_old', 'charge', 5000, 175, '2026-08-01T12:00:00Z', charge('ch_old', 'pi_old', { presence_invoice_id: 'gone' })),    // long before: never asked for
  { id: 'txn_re', object: 'balance_transaction', type: 'refund', amount: -9900, fee: 0, net: -9900, created: sec('2026-10-21T12:00:00Z'), source: 're_X', _payout: 'po_1' },
];
const PAYOUTS = [
  { id: 'po_0', object: 'payout', amount: 1000, arrival_date: sec('2026-09-30T00:00:00Z'), status: 'paid', automatic: true, reconciliation_status: 'completed' },
  { id: 'po_1', object: 'payout', amount: 256908, arrival_date: sec('2026-10-22T00:00:00Z'), status: 'paid', automatic: true, reconciliation_status: 'completed' },
  { id: 'po_3', object: 'payout', amount: 5000, arrival_date: sec('2026-10-30T00:00:00Z'), status: 'in_transit', automatic: false, reconciliation_status: 'not_applicable' },
  { id: 'po_2', object: 'payout', amount: 29760, arrival_date: sec('2026-11-02T00:00:00Z'), status: 'paid', automatic: true, reconciliation_status: 'completed' },
];
const payoutTxn = (po) => [...BTS.filter((t) => t._payout === po).map((t) => ({ ...t, source: typeof t.source === 'object' ? t.source.id : t.source })),
  { id: 'txn_' + po, object: 'balance_transaction', type: 'payout', amount: -(PAYOUTS.find((x) => x.id === po).amount), fee: 0, net: -(PAYOUTS.find((x) => x.id === po).amount), source: po }];

// ═══ 1. the pure folding ═══
{
  const f = L.paymentFee(BTS[1]);
  eq('a card payment: its fee, what was kept, and the invoice its notes name', [f.charge, f.intent, f.invoice, f.gross_cents, f.fee_cents, f.net_cents], ['ch_A', 'pi_A', INV_A, 120000, 3510, 116490]);
  ok('a bank payment counts too; a refund or a payout is not a payment', L.paymentFee(BTS[4])?.invoice === INV_C && L.paymentFee(BTS[6]) === null && L.paymentFee({ type: 'payout', amount: -5 }) === null);
  const l = L.indexPayments(BTS);
  ok('an invoice paid twice keeps its first payment', l.byInvoice.get(INV_A)?.charge === 'ch_A');
  ok('found by charge and by payment too', l.byCharge.get('py_C')?.invoice === INV_C && l.byIntent.get('pi_R')?.charge === 'ch_R');
  eq('a payout\'s day is read as Stripe dates it, never moved to the day before', L.arrivalYmd(sec('2026-10-22T00:00:00Z')), '2026-10-22');
  const carried = new Map([['po_1', payoutTxn('po_1')], ['po_2', payoutTxn('po_2')]]);
  L.attachPayouts(l, PAYOUTS, carried);
  ok('each payment learns the deposit that carried it', l.byCharge.get('ch_A')?.paid_out_on === '2026-10-22' && l.byCharge.get('py_C')?.paid_out_on === '2026-11-02' && l.byCharge.get('ch_R')?.payout === 'po_1');
  const outs = L.payoutExportRows(PAYOUTS, carried, { from: '2026-10-01', to: '2026-10-31' });
  eq('payouts.csv: the deposits due in the days asked for, oldest first', outs.rows.map((r) => [r[0], r[1], r[2], r[7]]), [['10/22/2026', '2569.08', 'Paid', 'po_1'], ['10/30/2026', '50.00', 'On its way', 'po_3']]);
  const r1 = outs.rows[0];
  eq('a deposit\'s columns add up to it: paid by clients, less fees, plus refunds and the rest', [r1[3], r1[4], r1[5], r1[6]], ['4', '2749.00', '80.92', '-99.00']);
  ok('and they do add up', Math.round((Number(r1[4]) - Number(r1[5]) + Number(r1[6])) * 100) === 256908);
  ok('a manual payout Stripe can\'t itemize says only what it can', outs.rows[1].slice(3, 7).every((c) => c === ''));
  eq('the total counts only deposits that arrived', [outs.payouts, outs.cents], [2, 256908]);
}

// ═══ 2. payments.csv with Stripe's side ═══
const P = { from: '2026-10-01', to: '2026-10-31' };
{
  const l = L.indexPayments(BTS);
  L.attachPayouts(l, PAYOUTS, new Map([['po_1', payoutTxn('po_1')], ['po_2', payoutTxn('po_2')]]));
  const look = L.stripeSide(l, new Map([['in_R1', 'pi_R']]));
  const items = [
    { id: INV_A, number: 41, title: 'Website build', amount_cents: 120000, status: 'paid', paid_at: '2026-10-20T18:00:00Z', paid_method: '', business: 'Harbor Dental' },
    { id: INV_B, number: 42, title: 'Logo', amount_cents: 50000, status: 'paid', paid_at: '2026-10-21T18:00:00Z', paid_method: 'check', paid_note: 'Check #77', business: 'Harbor Dental' },
    { id: INV_C, number: 43, title: 'Hosting', amount_cents: 30000, status: 'paid', paid_at: '2026-10-28T18:00:00Z', paid_method: '', business: 'Harbor Dental' },
    { id: INV_D, number: 44, title: 'Photos', amount_cents: 10000, status: 'paid', paid_at: '2026-10-29T18:00:00Z', paid_method: '', business: 'Harbor Dental' },
  ];
  const ret = [{ amount_cents: 25000, paid_at: '2026-10-15T16:00:00Z', customer: 'Blue Finch Café', deal_title: 'Care plan', stripe_invoice: 'in_R1' }];
  const pay = A.paymentExportRows(items, ret, P, 420, look);
  const col = (name) => A.PAYMENT_HEAD.indexOf(name);
  const pick = (r) => [r[col('Invoice')], r[col('Amount')], r[col('Stripe fee')], r[col('You kept')], r[col('Paid out on')]];
  eq('the header: the three new columns sit after Amount, the note stays last', A.PAYMENT_HEAD, ['Date', 'Customer', 'Invoice', 'For', 'How it was paid', 'Amount', 'Stripe fee', 'You kept', 'Paid out on', 'Note']);
  eq('each payment with its fee, what was kept and the day it was paid out', pay.rows.map(pick), [
    ['', '250.00', '7.55', '242.45', '10/22/2026'],     // the retainer charge, found through the Stripe invoice it paid
    ['0041', '1200.00', '35.10', '1164.90', '10/22/2026'],
    ['0042', '500.00', '', '500.00', ''],                 // a check: no fee, kept whole
    ['0043', '300.00', '2.40', '297.60', '11/02/2026'],   // a bank payment, paid out after the stretch
    ['0044', '100.00', '', '', ''],                       // Stripe had nothing for it: blank, never a guess
  ]);
  ok('the note still rides along, last', pay.rows[2][col('Note')] === 'Check #77');
  eq('totals for the READ-ME: fees, kept, and how many Stripe had no fee for', [pay.fee_cents, pay.kept_cents, pay.fees_missing], [4505, 220495, 1]);
  const none = A.paymentExportRows(items, ret, P, 420);
  ok('without Stripe read, a Stripe payment\'s columns are blank and nothing is counted missing', none.rows.find((r) => r[col('Invoice')] === '0041')[col('Stripe fee')] === '' && none.fees_missing === 0 && none.rows.find((r) => r[col('Invoice')] === '0042')[col('You kept')] === '500.00');
  const rm = A.exportReadMe(P, { invoices: 0, cents: 0 }, pay, false, { payouts: 2, cents: 256908, capped: false });
  ok('READ-ME: the fees, what was kept, and the deposits', rm.includes('Stripe kept $45.05 in fees from the ones it took, so you kept $2,204.95.') && rm.includes('payouts.csv   2 payouts from Stripe due in these days, $2,569.08 arrived.') && rm.includes('Paid out on says which deposit carried each payment'), rm);
  ok('READ-ME: a payment Stripe had no fee for is said, not hidden', rm.includes('Stripe had no fee for 1 payment it took'));
  ok('READ-ME without Stripe read says nothing about payouts', !A.exportReadMe(P, { invoices: 0, cents: 0 }, none, false).includes('payouts.csv'));
}

// ═══ 3. the route, with a pretend Stripe ═══
const stripeCalls = [];
let stripeDown = false;
const dbFetch = globalThis.fetch;
const page = (all, q, size) => {
  const after = q.get('starting_after');
  const start = after ? all.findIndex((x) => x.id === after) + 1 : 0;
  const data = all.slice(start, start + size);
  return { object: 'list', data, has_more: start + size < all.length };
};
const strip = (t) => { const { _payout, ...rest } = t; return rest; };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.stripe.com') return dbFetch(url, init);
  const method = (init.method || 'GET').toUpperCase();
  stripeCalls.push({ method, path: u.pathname, q: u.searchParams.toString(), version: new Headers(init.headers).get('Stripe-Version') });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (stripeDown) return json({ error: { message: 'down' } }, 500);
  const q = u.searchParams;
  if (u.pathname === '/v1/balance_transactions' && q.get('payout')) return json(page(payoutTxn(q.get('payout')), q, 100));
  if (u.pathname === '/v1/balance_transactions') {
    const gte = Number(q.get('created[gte]')), lt = Number(q.get('created[lt]'));
    const list = BTS.filter((t) => t.type === q.get('type') && t.created >= gte && t.created < lt).map(strip);
    return json(page(list, q, 2));   // two at a time, so the pages are followed
  }
  if (u.pathname === '/v1/payouts') {
    const gte = Number(q.get('arrival_date[gte]')), lt = Number(q.get('arrival_date[lt]'));
    return json(page(PAYOUTS.filter((p) => p.arrival_date >= gte && p.arrival_date < lt), q, 100));
  }
  if (u.pathname === '/v1/invoice_payments') return json({ object: 'list', has_more: false, data: q.get('invoice') === 'in_R1' ? [{ id: 'inpay_1', object: 'invoice_payment', invoice: 'in_R1', status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_R' } }] : [] });
  return json({ error: { message: 'no such route' } }, 404);
};
const unzip = (buf) => { const u = new Uint8Array(buf), dv = new DataView(u.buffer), out = {}; let o = 0; while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) { const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true); const name = new TextDecoder().decode(u.slice(o + 30, o + 30 + nl)); out[name] = new TextDecoder().decode(u.slice(o + 30 + nl + xl, o + 30 + nl + xl + size)); o += 30 + nl + xl + size; } return out; };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const operator = { kind: 'staff', userId: 'u-op', tenantId: 't1', role: 'owner', email: 'op@studio.test', jwt: 'jwt', requestId: 't' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const world = () => ({
  presence_invoices: [
    { id: INV_A, site_id: SITE, number: 41, title: 'Website build', amount_cents: 120000, status: 'paid', paid_at: '2026-10-20T18:00:00Z', paid_method: null, created_at: '2026-10-05T17:00:00Z', deal_id: DEAL, deleted_at: null },
    { id: INV_B, site_id: SITE, number: 42, title: 'Logo', amount_cents: 50000, status: 'paid', paid_at: '2026-10-21T18:00:00Z', paid_method: 'check', created_at: '2026-10-06T17:00:00Z', deal_id: DEAL, deleted_at: null },
    { id: INV_C, site_id: SITE, number: 43, title: 'Hosting', amount_cents: 30000, status: 'paid', paid_at: '2026-10-28T18:00:00Z', paid_method: null, created_at: '2026-10-07T17:00:00Z', deal_id: DEAL, deleted_at: null },
  ],
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Harbor website', contact_id: PERSON, converted_client_id: CUST }],
  presence_contacts: [{ id: PERSON, site_id: SITE, name: 'Marcus Bell', email: 'marcus@example.com', company: 'Harbor Dental' }],
  clients: [{ id: CUST, name: 'Harbor Dental', email: 'office@example.com' }],
  presence_deal_events: [{ id: id('dddddddd', 1), site_id: SITE, deal_id: DEAL, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 25000, stripe_invoice: 'in_R1' }, created_at: '2026-10-15T16:00:00Z' }],
});
const get = (who) => X.handleAccountingExport(new Request('https://fn.test/functions/v1/presence/sales/export/accounting?from=2026-10-01&to=2026-10-31&tzo=420&today=2026-11-16'), site, who, {});

db.reset(world()); stripeCalls.length = 0;
let r = await get(operator);
ok('route, the platform\'s studio: a zip', r.status === 200 && r.headers.get('Content-Type') === 'application/zip');
const files = unzip(await r.arrayBuffer());
eq('route: four files, payouts.csv among them', Object.keys(files).sort(), ['READ-ME.txt', 'invoices.csv', 'payments.csv', 'payouts.csv']);
const lines = files['payments.csv'].trim().split('\r\n');
ok('route: the card payment with its fee, what was kept and its deposit', lines.some((l) => l.startsWith('10/20/2026,Harbor Dental,0041,Harbor website,"Card or bank, through Stripe",1200.00,35.10,1164.90,10/22/2026,')), lines.join('\n'));
ok('route: the bank payment paid out after the stretch still names its deposit', lines.some((l) => l.includes(',0043,') && l.includes(',300.00,2.40,297.60,11/02/2026,')));
ok('route: the retainer charge, found through the Stripe invoice it paid', lines.some((l) => l.startsWith('10/15/2026,Harbor Dental,,Retainer: Harbor website,') && l.includes(',250.00,7.55,242.45,10/22/2026,')));
ok('route: the check is kept whole, with no fee', lines.some((l) => l.includes(',0042,') && l.includes(',Check,500.00,,500.00,,')));
ok('route: payouts.csv has the two deposits due in October', files['payouts.csv'].includes('10/22/2026,2569.08,Paid,4,2749.00,80.92,-99.00,po_1') && files['payouts.csv'].includes('10/30/2026,50.00,On its way,,,,,po_3') && !files['payouts.csv'].includes('po_2') && !files['payouts.csv'].includes('po_0'), files['payouts.csv']);
ok('route: READ-ME says what Stripe kept and what arrived', files['READ-ME.txt'].includes('Stripe kept $45.05 in fees') && files['READ-ME.txt'].includes('$2,569.08 arrived'));
ok('route: every Stripe call only reads, and names the version', stripeCalls.length > 0 && stripeCalls.every((c) => c.method === 'GET' && c.version === STRIPE_API_VERSION));
ok('route: payments are looked for from ten days before to three after, cards and bank payments both', ['charge', 'payment'].every((t) => stripeCalls.some((c) => c.path === '/v1/balance_transactions' && c.q.includes(`type=${t}`) && c.q.includes(`created%5Bgte%5D=${sec('2026-09-21T00:00:00Z')}`) && c.q.includes(`created%5Blt%5D=${sec('2026-11-04T00:00:00Z')}`) && c.q.includes('expand%5B%5D=data.source'))));
ok('route: a long list is followed page by page', stripeCalls.filter((c) => c.path === '/v1/balance_transactions' && c.q.includes('type=charge')).length >= 2 && stripeCalls.some((c) => c.q.includes('starting_after=')));
ok('route: a manual payout isn\'t itemized; an automatic one is', !stripeCalls.some((c) => c.q.includes('payout=po_3')) && stripeCalls.some((c) => c.q.includes('payout=po_1')));

db.reset(world()); stripeCalls.length = 0;
r = await get(owner);
const own = unzip(await r.arrayBuffer());
ok('route, anyone but the platform\'s staff: Stripe isn\'t asked and there is no payouts.csv', r.status === 200 && stripeCalls.length === 0 && !('payouts.csv' in own) && own['payments.csv'].includes(',Check,500.00,,500.00,,'));
db.reset(world()); stripeCalls.length = 0;
r = await get({ ...operator, scope: { site_id: SITE, name: 'A client' } });
ok('route, staff drilled into a client: the platform\'s payouts stay out', r.status === 200 && stripeCalls.length === 0 && !('payouts.csv' in unzip(await r.arrayBuffer())));
db.reset(world()); stripeDown = true;
r = await get(operator);
ok('route: Stripe not answering downloads nothing and says so', r.status === 502 && /Stripe’s fees and payouts couldn’t load just now, so nothing was downloaded/.test((await r.json()).message));
stripeDown = false;

console.log(`\n════ SALES ITEM 133 (what reached the bank): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
