// ── Sales item 120: the money shows everywhere (Nov 2026) ───────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/money_everywhere_120_test.mjs
// The Nov 12 code pass (findings 54 to 56) found money that one page counted and
// another didn't:
//   1  revenue by month left out retainer payments, which the record counted in Paid
//   2  search couldn't find an invoice by its number ("0013" was read as $13.00)
//   3  the client's portal showed no invoice numbers, and a part payment looked like a
//      second paid invoice beside one that had shrunk
// Drives the real handlers on the in-memory PostgREST (fake_pgrst.mjs).
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('APPROVAL_SECRET', 'test-link-secret');
Deno.env.set('RESEND_KEY', 're_test');   // read when the mail module loads: the weekly email below is captured, never sent
Deno.env.set('OPS_ALERT_EMAIL', 'owner@studio.test');
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const AG = '44444444-4444-4444-8444-444444444444', MEMBER = '55555555-5555-4555-8555-555555555555';
const DEAL = 'aaaaaaaa-0000-4000-8000-000000000001', DEAL2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const CUST = '66666666-6666-4666-8666-666666666666', CUST_SITE = '77777777-7777-4777-8777-777777777777';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } } });
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const C = await import('../../supabase/functions/presence/routes/crm.ts');
const D = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const B = await import('../../supabase/functions/presence/lib/invoice_billing.ts');
const Q = await import('../../supabase/functions/presence/lib/record_search.ts');
const L = await import('../../supabase/functions/presence/commerce/lifecycle.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`);
const body = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const month = new Date().toISOString().slice(0, 7);
const thisMonth = `${month}-01T09:00:00Z`;
const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) + '-15T09:00:00Z'; })();

// ═══ 1. revenue counts retainer payments ═══
{
  const events = [
    { kind: 'invoice_paid', detail: { retainer: true, amount_cents: 20000, interval: 'month' }, created_at: '2026-11-03T10:00:00Z' },
    { kind: 'invoice_paid', detail: { retainer: true, extra: true, amount_cents: 20000 }, created_at: '2026-10-03T10:00:00Z' },   // a second approval still charged: money in
    { kind: 'invoice_paid', detail: { invoice_id: 'x', amount_cents: 30000, recorded: true }, created_at: '2026-11-04T10:00:00Z' },   // an invoice's own payment: it is in the invoice rows already
    { kind: 'invoice_paid', detail: { retainer: true, amount_cents: 0 }, created_at: '2026-11-05T10:00:00Z' },
    { kind: 'stage_change', detail: { retainer: true, amount_cents: 5 }, created_at: '2026-11-05T10:00:00Z' },
  ];
  eq('retainerPayments: one payment per retainer charge, never an invoice\'s own payment', B.retainerPayments(events), [{ amount_cents: 20000, paid_at: '2026-11-03T10:00:00Z' }, { amount_cents: 20000, paid_at: '2026-10-03T10:00:00Z' }]);
  eq('retainerPaid (the record\'s Paid) still adds up the same charges', B.retainerPaid(events), { cents: 40000, count: 2, last_at: '2026-11-03T10:00:00Z' });
  const rev = R.revenueByMonth([{ amount_cents: 50000, paid_at: '2026-11-02T10:00:00Z' }], '2026-11-08T15:00:00Z', B.retainerPayments(events));
  eq('revenue by month adds retainer payments to the invoices of their month', [rev.months[11].this_year, rev.months[10].this_year], [70000, 20000]);
  eq('each month says how much of it was retainer, and so does the year', [rev.months[11].retainer, rev.months[10].retainer, rev.retainer_this_year, rev.total_this_year], [20000, 20000, 40000, 90000]);
  eq('without retainers nothing changes', R.revenueByMonth([{ amount_cents: 50000, paid_at: '2026-11-02T10:00:00Z' }], '2026-11-08T15:00:00Z').total_this_year, 50000);

  // the real /sales/reports
  const world = () => ({
    presence_invoices: [{ id: id('bbbbbbbb', 1), site_id: SITE, status: 'paid', amount_cents: 50000, paid_at: thisMonth, deleted_at: null }],
    presence_deal_events: [
      { id: id('dddddddd', 1), deal_id: DEAL, site_id: SITE, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 20000 }, created_at: thisMonth },
      { id: id('dddddddd', 2), deal_id: DEAL, site_id: SITE, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 20000 }, created_at: lastMonth },
      { id: id('dddddddd', 3), deal_id: DEAL, site_id: SITE, kind: 'invoice_paid', detail: { invoice_id: id('bbbbbbbb', 1), amount_cents: 50000 }, created_at: thisMonth },
      { id: id('dddddddd', 4), deal_id: DEAL2, site_id: '99999999-9999-4999-8999-999999999999', kind: 'invoice_paid', detail: { retainer: true, amount_cents: 99900 }, created_at: thisMonth },   // another studio's
    ],
    presence_deals: [], presence_form_submissions: [],
  });
  db.reset(world());
  let r = await body(await S.handleSalesReports(req('/sales/reports'), site, owner, cors));
  const rv = r.body?.data?.revenue || {};
  eq('reports: this month is the invoice plus this studio\'s retainer charge', [rv.months?.[11]?.this_year, rv.months?.[10]?.this_year, rv.retainer_this_year], [70000, 20000, 40000]);
  ok('reports: the retainer read is this studio\'s own, and asks for retainer charges only', db.reads('presence_deal_events').some((c) => c.url.includes(`site_id=eq.${SITE}`) && c.url.includes('detail->>retainer=eq.true')));
  db.reset(world()); db.fail.add('presence_deal_events');
  r = await body(await S.handleSalesReports(req('/sales/reports'), site, owner, cors));
  ok('reports: retainer payments that couldn\'t be read make revenue "unavailable", never a low number', r.body?.data?.revenue?.unavailable === true, JSON.stringify(r.body?.data?.revenue));
}

// ═══ 2. search finds an invoice by its number ═══
{
  const cases = [['#0013', 13, true], ['#13', 13, true], ['0013', 13, true], ['invoice 13', 13, true], ['inv #0013', 13, true], ['Invoice no. 13', 13, true], ['13', 13, false], ['$13', null], ['13.00', null], ['#', null], ['0', null], ['invoice', null]];
  for (const [q, n, only] of cases) { const got = Q.invoiceNumberQuery(q); eq(`invoiceNumberQuery(${JSON.stringify(q)})`, got, n === null ? null : { number: n, only }); }

  const at = '2026-11-03T10:00:00Z';
  const world = () => ({
    presence_agency_members: [{ id: MEMBER, agency_id: AG, email: 'owner@studio.test', role: 'owner', status: 'active', user_id: U }],
    presence_agencies: [{ id: AG, name: 'Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
    presence_sites: [{ id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' }],
    presence_invoices: [
      { id: id('ffffffff', 13), site_id: SITE, title: 'Website build', amount_cents: 150000, status: 'open', number: 13, deal_id: DEAL, deleted_at: null, created_at: at },
      { id: id('ffffffff', 2), site_id: SITE, title: 'Logo files', amount_cents: 1300, status: 'paid', number: 2, deal_id: DEAL, deleted_at: null, created_at: at },   // $13.00
      { id: id('ffffffff', 3), site_id: SITE, title: 'Part payment — Website build', amount_cents: 50000, status: 'paid', number: null, payment_for: id('ffffffff', 13), deal_id: DEAL, deleted_at: null, created_at: at },
      { id: id('ffffffff', 4), site_id: '99999999-9999-4999-8999-999999999999', title: 'Someone else\'s', amount_cents: 1300, status: 'open', number: 13, deleted_at: null, created_at: at },
    ],
  });
  const search = async (q) => { const r = await C.handleCrmSearch(new Request(`https://fn.test/functions/v1/presence/crm/search?q=${encodeURIComponent(q)}`), 'jwt-owner', site, owner, cors); return (await r.json()).data?.results || []; };
  const money = (rs) => rs.filter((x) => x.kind === 'invoice');
  for (const q of ['#0013', '0013', 'invoice 13', 'inv #0013']) {
    db.reset(world());
    const rs = money(await search(q));
    eq(`search "${q}" finds invoice #0013, and only that one`, rs.map((x) => x.label), ['Website build — $1,500']);
    ok(`search "${q}": the result shows its number`, rs[0]?.sub?.startsWith('Invoice #0013'), rs[0]?.sub);
  }
  db.reset(world());
  let rs = money(await search('13'));
  eq('search "13" finds invoice 13 and the $13.00 one', rs.map((x) => x.label).sort(), ['Logo files — $13', 'Website build — $1,500']);
  db.reset(world());
  rs = money(await search('Website build'));
  ok('a part payment found by its words says it is one', rs.some((x) => x.sub.startsWith('Part payment')), JSON.stringify(rs.map((x) => x.sub)));
  ok('another studio\'s invoice 13 never shows', !db.reads('presence_invoices').some((c) => !c.url.includes(`site_id=eq.${SITE}`)));
}

// ═══ 3. the portal's invoices carry their numbers; a part payment sits under its invoice ═══
{
  const parts = B.nestPartPayments([
    { id: 'a', amount_cents: 100000, created_at: '3' },
    { id: 'p2', payment_for: 'a', amount_cents: 20000, paid_at: '2026-11-05' },
    { id: 'p1', payment_for: 'a', amount_cents: 30000, paid_at: '2026-11-01' },
    { id: 'orphan', payment_for: 'gone', amount_cents: 5000, paid_at: '2026-10-01' },
    { id: 'b', amount_cents: 7000 },
  ]);
  eq('nestPartPayments: parts leave the list; an orphan part stays; order kept', parts.map((x) => x.id), ['a', 'orphan', 'b']);
  eq('nestPartPayments: the parts sit under their invoice, oldest first, with the totals', [parts[0].parts.map((p) => p.id), parts[0].paid_so_far_cents, parts[0].total_cents], [['p1', 'p2'], 50000, 150000]);
  ok('nestPartPayments: an invoice without parts is unchanged', !('parts' in parts[2]) && !('total_cents' in parts[2]));

  const client = { ...site, id: CUST_SITE, client_id: CUST };
  const world = () => ({
    presence_invoices: [
      { id: id('cccccccc', 1), site_id: SITE, customer_client_id: CUST, title: 'Website build', description: '', amount_cents: 100000, status: 'open', due_date: '2099-01-01', number: 13, stripe_url: 'https://pay.example/13', created_at: '2026-11-01T00:00:00Z', deleted_at: null },
      { id: id('cccccccc', 2), site_id: SITE, customer_client_id: CUST, title: 'Part payment — Website build', description: '', amount_cents: 50000, status: 'paid', paid_at: '2026-11-03T00:00:00Z', paid_method: 'check', payment_for: id('cccccccc', 1), created_at: '2026-11-03T00:00:00Z', deleted_at: null },
      { id: id('cccccccc', 3), site_id: SITE, customer_client_id: CUST, title: 'Deposit', description: '', amount_cents: 60000, status: 'paid', paid_at: '2026-10-01T00:00:00Z', number: 12, created_at: '2026-10-01T00:00:00Z', deleted_at: null },
      { id: id('cccccccc', 4), site_id: SITE, customer_client_id: 'someone-else', title: 'Not theirs', amount_cents: 1, status: 'open', number: 99, created_at: '2026-11-01T00:00:00Z', deleted_at: null },
    ],
  });
  db.reset(world());
  const r = await body(await D.handleClientBilling(req('/client/billing'), client, { kind: 'client', userId: 'u2', email: 'ivy@example.com' }, cors));
  const inv = r.body?.data?.invoices || [];
  eq('portal: the part payment is not a second paid invoice', inv.map((i) => i.name), ['Website build', 'Deposit']);
  eq('portal: every invoice carries its number', inv.map((i) => i.number), ['#0013', '#0012']);
  const wb = inv[0] || {};
  eq('portal: what was paid toward it sits under it, how and when', (wb.payments || []).map((p) => [p.amount, p.method, p.paid_at]), [[500, 'Check', '2026-11-03T00:00:00Z']]);
  eq('portal: what is left, what was paid, and the whole', [wb.amount, wb.paid_so_far, wb.total], [1000, 500, 1500]);
  ok('portal: the part payment keeps its own receipt link', typeof wb.payments?.[0]?.view_url === 'string' && wb.payments[0].view_url.length > 10);
  ok('portal: the rest can still be paid', wb.pay_url === 'https://pay.example/13');
  eq('portal: counts are of invoices, not payments', [r.body?.data?.summary?.open_count, r.body?.data?.summary?.paid_count], [1, 1]);
  ok('portal: reads only this client\'s invoices', db.reads('presence_invoices').every((c) => c.url.includes(`customer_client_id=eq.${CUST}`)));
}

// ═══ 4. the page draws them ═══
{
  const html = Deno.readTextFileSync(new URL('../../client.html', import.meta.url));
  ok('client.html: a shelf invoice row is named with its number', /kind:i\.number\?'Invoice '\+i\.number:'Invoice'/.test(html));
  ok('client.html: part payments are drawn under their invoice, each with a Receipt', /class="fparts"/.test(html) && /Part payment · /.test(html) && />Receipt<\/a>/.test(html));
  const an = Deno.readTextFileSync(new URL('../../analytics.html', import.meta.url));
  ok('analytics.html: revenue is named for what it counts', /Paid invoices and retainer payments by the month they were paid/.test(an) && !/Paid invoices by the month they were paid/.test(an));
}

// ═══ 5. the weekly email's "collected" counts a retainer charge too ═══
{
  const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
  const world = () => ({
    presence_ops_state: [{ id: 1, last_digest_at: null }],
    presence_identity: [{ site_id: SITE, email: 'owner@studio.test' }],
    presence_invoices: [{ id: id('bbbbbbbb', 7), site_id: SITE, status: 'paid', amount_cents: 50000, paid_at: recent, deleted_at: null }],
    presence_deal_events: [{ id: id('dddddddd', 7), deal_id: DEAL, site_id: SITE, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 20000 }, created_at: recent }],
    presence_deals: [],
  });
  const mail = () => db.log.filter((c) => c.method === 'POST' && c.url.startsWith('/emails')).map((c) => String(c.body?.html || '')).pop() || '';
  db.reset(world());
  await L.runWeeklyDigest();
  ok('weekly email: the money line adds the retainer charge to the paid invoice', mail().includes('$700.00</strong> collected across 2 payments'), mail().slice(mail().indexOf('Your business'), mail().indexOf('Your business') + 600));
  db.reset(world()); db.fail.add('presence_deal_events');
  await L.runWeeklyDigest();
  ok('weekly email: payments that couldn\'t be read leave the block out, never "No payments collected"', mail().length > 0 && !mail().includes('Your business this week') && !mail().includes('No payments collected'));
}

console.log(`\n════ SALES ITEM 120: ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
