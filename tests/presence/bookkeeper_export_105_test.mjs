// ── Sales item 105: the export for a bookkeeper (Nov 2026) ───────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/bookkeeper_export_105_test.mjs
// One zip for the days picked: invoices.csv in the columns QuickBooks Online's invoice
// import maps, payments.csv with every payment that came in (retainer charges too), and
// READ-ME.txt. Pure shaping first, then the real route on the in-memory PostgREST.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222';
const DEAL = 'aaaaaaaa-0000-4000-8000-000000000001', CUST = '66666666-6666-4666-8666-666666666666', PERSON = 'cccccccc-0000-4000-8000-000000000001';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = installFakePostgrest();
const A = await import('../../supabase/functions/presence/lib/accounting_export.ts');
const X = await import('../../supabase/functions/presence/routes/accounting_export.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);

// ═══ 1. the days ═══
eq('a stretch of days', A.exportPeriod('2026-01-01', '2026-12-31', '2026-11-12'), { from: '2026-01-01', to: '2026-11-12' });   // never past today
eq('to defaults to today', A.exportPeriod('2026-11-01', '', '2026-11-12'), { from: '2026-11-01', to: '2026-11-12' });
ok('a day that isn\'t one is refused', 'error' in A.exportPeriod('2026-02-30', '2026-03-01', '2026-11-12'));
ok('first after last is refused', 'error' in A.exportPeriod('2026-11-02', '2026-11-01', '2026-11-12'));
ok('more than six years is refused', 'error' in A.exportPeriod('2010-01-01', '2026-11-01', '2026-11-12'));
eq('a moment is the studio\'s own day (7pm in Los Angeles on Oct 31 stays Oct 31)', A.localYmd('2026-11-01T02:00:00Z', 420), '2026-10-31');
eq('dates as QuickBooks in the US reads them', A.usDate('2026-11-03'), '11/03/2026');
eq('the number without its #', [A.exportNo(13), A.exportNo(null)], ['0013', '']);

// ═══ 2. invoices.csv ═══
const P = { from: '2026-10-01', to: '2026-10-31' };
const items = [
  { id: 'a', number: 21, title: 'Website build', amount_cents: 300000, status: 'open', due_date: '2026-11-15', issued_at: '2026-10-05T17:00:00Z', business: 'Harbor Dental', person: 'Marcus Bell', deal_title: 'Harbor Dental — website',
    lines: [{ label: 'Design', qty: 1, amount_cents: 200000 }, { label: 'Pages', qty: 4, amount_cents: 100000 }] },
  { id: 'b', number: 22, title: 'Balance', amount_cents: 100000, status: 'paid', paid_at: '2026-10-20T18:00:00Z', paid_method: 'check', paid_note: 'Check #1042', issued_at: '2026-10-10T17:00:00Z', business: '', person: 'Ana Ruiz',
    lines: [{ label: 'Website refresh', qty: 1, amount_cents: 200000 }, { label: 'Less deposit #0012', qty: 1, amount_cents: -50000 }] },
  { id: 'b-part', title: 'Part payment — Balance', amount_cents: 50000, status: 'paid', paid_at: '2026-10-12T18:00:00Z', paid_method: 'zelle', payment_for: 'b', issued_at: '2026-10-12T18:00:00Z', person: 'Ana Ruiz' },
  { id: 'v', number: 23, title: 'Voided', amount_cents: 5000, status: 'void', issued_at: '2026-10-11T17:00:00Z', business: 'X' },
  { id: 'old', number: 9, title: 'Last month', amount_cents: 7000, status: 'paid', paid_at: '2026-10-02T18:00:00Z', issued_at: '2026-09-20T17:00:00Z', business: 'Y' },
];
const inv = A.invoiceExportRows(items, P, 420);
eq('the header QuickBooks maps', A.INVOICE_HEAD.slice(0, 4).concat(A.INVOICE_HEAD[9]), ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'ItemAmount']);
eq('one row per line, the business as the customer', inv.rows.filter((r) => r[0] === '0021').map((r) => [r[1], r[2], r[3], r[6], r[7], r[8], r[9], r[10]]),
  [['Harbor Dental', '10/05/2026', '11/15/2026', 'Design', '1', '2000.00', '2000.00', 'Open'], ['Harbor Dental', '10/05/2026', '11/15/2026', 'Pages', '4', '250.00', '1000.00', 'Open']]);
const b = inv.rows.filter((r) => r[0] === '0022');
ok('a negative line (Less deposit) goes in as one line of what it billed: what is left plus the part paid', b.length === 1 && b[0][9] === '1500.00' && b[0][6].includes('Less deposit #0012 -$500.00'), JSON.stringify(b));
ok('no person\'s business: the person is the customer; paid says when', b[0]?.[1] === 'Ana Ruiz' && b[0]?.[10] === 'Paid' && b[0]?.[11] === '10/20/2026');
ok('a voided invoice and a part payment are not invoices', !inv.rows.some((r) => r[0] === '0023') && inv.rows.length === 3);
ok('an invoice issued outside the days is left out', !inv.rows.some((r) => r[0] === '0009'));
eq('totals for the READ-ME', [inv.invoices, inv.cents], [2, 450000]);

// ═══ 3. payments.csv ═══
const ret = [{ amount_cents: 20000, paid_at: '2026-10-15T16:00:00Z', customer: 'Blue Finch Café', deal_title: 'Care plan' }, { amount_cents: 20000, paid_at: '2026-11-15T16:00:00Z', customer: 'Blue Finch Café', deal_title: 'Care plan' }];
const pay = A.paymentExportRows(items, ret, P, 420);
eq('every payment in the days, oldest first: a recorded one, a part payment, a retainer charge, a paid invoice', pay.rows.map((r) => [r[0], r[2], r[4], r[5]]),
  [['10/02/2026', '0009', 'Card or bank, through Stripe', '70.00'], ['10/12/2026', '0022', 'Zelle', '500.00'], ['10/15/2026', '', 'Card or bank, through Stripe', '200.00'], ['10/20/2026', '0022', 'Check', '1000.00']]);
ok('a part payment says so, under its invoice', pay.rows[1][3] === 'Balance (part payment)' && pay.rows[1][1] === 'Ana Ruiz');
ok('a retainer charge names its deal', pay.rows[2][3] === 'Retainer: Care plan' && pay.rows[2][1] === 'Blue Finch Café');
ok('the note printed on the receipt rides along', pay.rows[3][6] === 'Check #1042');
eq('payment totals', [pay.payments, pay.cents], [4, 177000]);
const rm = A.exportReadMe(P, inv, pay, false);
ok('READ-ME: what is in it and how to bring it into QuickBooks', rm.includes('2 invoices issued in these days, $4,500.00 billed') && rm.includes('4 payments received') && rm.includes('Settings, then Import data, then Invoices') && rm.includes('100 invoices at a time'));

// ═══ 4. the route ═══
const unzip = (buf) => { const u = new Uint8Array(buf), dv = new DataView(u.buffer), out = {}; let o = 0; while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) { const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true); const name = new TextDecoder().decode(u.slice(o + 30, o + 30 + nl)); out[name] = new TextDecoder().decode(u.slice(o + 30 + nl + xl, o + 30 + nl + xl + size)); o += 30 + nl + xl + size; } return out; };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const world = () => ({
  presence_invoices: [
    { id: id('ffffffff', 1), site_id: SITE, number: 31, title: 'Website build', amount_cents: 300000, status: 'open', due_date: '2026-11-20', created_at: '2026-10-05T17:00:00Z', deal_id: DEAL, deleted_at: null, lines: [] },
    { id: id('ffffffff', 2), site_id: SITE, number: 32, title: 'Balance', amount_cents: 80000, status: 'paid', paid_at: '2026-10-20T18:00:00Z', paid_method: 'cash', created_at: '2026-10-10T17:00:00Z', deal_id: DEAL, deleted_at: null },
    { id: id('ffffffff', 3), site_id: '99999999-9999-4999-8999-999999999999', number: 1, title: 'Someone else\'s', amount_cents: 1, status: 'paid', paid_at: '2026-10-20T18:00:00Z', created_at: '2026-10-10T17:00:00Z', deleted_at: null },
  ],
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Harbor website', contact_id: PERSON, converted_client_id: CUST }],
  presence_contacts: [{ id: PERSON, site_id: SITE, name: 'Marcus Bell', email: 'marcus@example.com', company: 'Harbor Dental' }],
  clients: [{ id: CUST, name: 'Harbor Dental', email: 'office@example.com' }],
  presence_deal_events: [
    { id: id('dddddddd', 1), site_id: SITE, deal_id: DEAL, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 25000 }, created_at: '2026-10-15T16:00:00Z' },
    { id: id('dddddddd', 2), site_id: SITE, deal_id: DEAL, kind: 'invoice_paid', detail: { invoice_id: 'x', amount_cents: 80000 }, created_at: '2026-10-20T18:00:00Z' },
  ],
});
const get = (q, who = owner) => X.handleAccountingExport(new Request(`https://fn.test/functions/v1/presence/sales/export/accounting?${q}`), site, who, cors);
db.reset(world());
let r = await get('from=2026-10-01&to=2026-10-31&tzo=420&today=2026-11-12');
ok('route: a zip, named for the days, never cached', r.status === 200 && r.headers.get('Content-Type') === 'application/zip' && /for-your-bookkeeper-2026-10-01-to-2026-10-31\.zip/.test(r.headers.get('Content-Disposition') || '') && r.headers.get('Cache-Control') === 'no-store');
const files = unzip(await r.arrayBuffer());
eq('route: three files', Object.keys(files).sort(), ['READ-ME.txt', 'invoices.csv', 'payments.csv']);
ok('route: invoices.csv has this studio\'s two invoices for its customer', files['invoices.csv'].includes('0031,Harbor Dental,10/05/2026,11/20/2026') && files['invoices.csv'].includes('0032,Harbor Dental') && !files['invoices.csv'].includes('Someone else'));
ok('route: payments.csv has the cash payment and the retainer charge, and not an invoice\'s own deal event twice', files['payments.csv'].includes('10/20/2026,Harbor Dental,0032,Harbor website,Cash,800.00') && files['payments.csv'].includes('10/15/2026,Harbor Dental,,Retainer: Harbor website,"Card or bank, through Stripe",250.00') && files['payments.csv'].trim().split('\r\n').length === 3, files['payments.csv']);
ok('route: the reads are this studio\'s own', db.reads('presence_invoices').every((c) => c.url.includes(`site_id=eq.${SITE}`)) && db.reads('presence_deal_events').every((c) => c.url.includes(`site_id=eq.${SITE}`)));
r = await get('from=2026-11-02&to=2026-11-01');
ok('route: days that make no sense are a 422 with a sentence', r.status === 422 && /Swap them/.test((await r.json()).message));
db.reset(world()); db.fail.add('presence_invoices');
r = await get('from=2026-10-01&to=2026-10-31');
ok('route: invoices that couldn\'t be read download nothing and say so', r.status === 502 && /nothing was downloaded/.test((await r.json()).message));
db.reset(world()); db.fail.add('presence_deal_events');
r = await get('from=2026-10-01&to=2026-10-31');
ok('route: retainer payments that couldn\'t be read download nothing either', r.status === 502);
db.reset(world());
r = await get('from=2026-10-01&to=2026-10-31', { ...owner, member: { site_id: SITE, role: 'client_reviewer' } });
ok('route: a reviewer seat can\'t take the books', r.status === 403);
r = await get('from=2026-10-01&to=2026-10-31', { ...owner, member: { site_id: SITE, role: 'business_staff' } });
ok('route: a staff seat that may see everything and export can', r.status === 200);

console.log(`\n════ SALES ITEM 105 (bookkeeper export): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
