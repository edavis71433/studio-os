// ── Sales items 163, 167, 168, 171, 172, 174 to 177, money polish part two (Nov 22 2026) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/money_polish_two_nov22_test.mjs
//
// 163  a retainer charge sends a branded receipt once, with its PDF and a page of its own; a
//      yearly retainer gets one note a week before it charges
// 167  a late fee, off by default: added once, N days late, as a line with a fresh link, said in
//      the next reminder
// 168  how else to pay, a tax number and the next invoice number print on the documents and email
// 171  a customer's statement with a running balance, as a PDF and by email
// 172  the client says they paid another way: a Needs-you line, reminders pause, Confirm or Not received
// 174  a refunded retainer charge is marked in the portal, with its receipt
// 175  a Tax column in invoices.csv
// 176  costs paid for a customer: saved, added to the next invoice, in costs.csv
// 177  which payment paid an old row is filled in from Stripe's own record
// Stripe, the mail service and the database are fakes. Every name and number is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('STRIPE_SECRET', 'sk_test_fake_polish2');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('SUPABASE_URL', 'https://db.test');
Deno.env.set('APPROVAL_SECRET', 'approval-secret-polish2');
const db = installFakePostgrest({ unique: { presence_plan_notices: [['client_id', 'kind', 'period']], presence_stripe_checks: [['subject']] } });

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const world = { stripe: [], mail: [], pis: {}, refuse: new Set() };
const fakeDb = globalThis.fetch;
let linkN = 0;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const path = u.pathname.replace('/v1/', '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    world.stripe.push({ method, path, body });
    if (method === 'POST' && path === 'payment_links') { linkN++; return jres(200, { id: `plink_new_${linkN}`, url: `https://pay.example/new-${linkN}` }); }
    if (method === 'POST' && path === 'prices') return jres(200, { id: `price_${linkN + 1}` });
    if (method === 'POST' && path.startsWith('payment_links/')) return jres(200, { id: path.split('/')[1], active: false });
    if (method === 'GET' && path === 'payment_intents/search') { const m = /metadata\['presence_invoice_id'\]:'([^']+)'/.exec(u.searchParams.get('query') || ''); return jres(200, { object: 'search_result', data: (m && world.pis[m[1]]) || [] }); }
    if (method === 'GET') return jres(200, { object: 'list', data: [] });
    return jres(404, { error: { message: `unplanned Stripe call ${method} ${path}` } });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); world.mail.push({ to: String(b.to), subject: String(b.subject), html: String(b.html), attachments: b.attachments || [] }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, true);
  return fakeDb(input, init);
};

const P = '../../supabase/functions/presence';
const S = await import(`${P}/routes/sales.ts`);
const C = await import(`${P}/routes/invoice_changes.ts`);
const IP = await import(`${P}/routes/invoice_payments.ts`);
const I = await import(`${P}/routes/invoices_list.ts`);
const LC = await import(`${P}/commerce/lifecycle.ts`);
const RT = await import(`${P}/commerce/retainers.ts`);
const CR = await import(`${P}/routes/client_retainers.ts`);
const SC = await import(`${P}/commerce/stripe_check.ts`);
const DOC = await import(`${P}/lib/documents.ts`);
const DC = await import(`${P}/lib/doc_context.ts`);
const PDF = await import(`${P}/lib/doc_pdf.ts`);
const A = await import(`${P}/lib/accounting_export.ts`);
const AX = await import(`${P}/routes/accounting_export.ts`);
const CO = await import(`${P}/routes/costs.ts`);
const ST = await import(`${P}/routes/statement.ts`);

const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const CUSTOMER = { id: '99999999-1111-4111-8111-999999999999', client_id: '99999999-2222-4222-8222-999999999999' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const INV = '55555555-5555-4555-8555-555555555555';
const INV2 = '55555555-5555-4555-8555-555555555556';
const COST = '66666666-6666-4666-8666-666666666661';
const EVT = '77777777-7777-4777-8777-777777777771';
const site = { id: STUDIO.id, client_id: STUDIO.client_id, status: 'live', edition: 'presence' };
const customerSite = { id: CUSTOMER.id, client_id: CUSTOMER.client_id, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333339', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const NOW = Date.parse('2026-11-18T20:00:00Z');   // noon in Burbank
const TODAY = '2026-11-18';
const invoice = (over = {}) => ({ id: INV, site_id: STUDIO.id, deal_id: DEAL, customer_client_id: CUSTOMER.client_id, number: 12, title: 'Balance at launch', description: 'Balance', amount_cents: 100000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: null, stripe_payment_link_id: null, processing_since: null, paid_at: null, paid_method: '', paid_note: '', payment_for: null, link_gen: 0, first_sent_at: null, due_date: null, lines: null, refunded_cents: 0, dispute_status: null, client_says_paid: null, late_fee_cents: 0, paid_ref: '', deleted_at: null, created_at: '2026-10-01T18:00:00Z', updated_at: '2026-10-01T18:00:00Z', ...over });
const sent = (over = {}) => invoice({ stripe_url: 'https://pay.example/sent', stripe_payment_link_id: 'plink_sent', first_sent_at: '2026-10-02T18:00:00Z', ...over });
function seed(o = {}) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }, { id: CUSTOMER.id, client_id: CUSTOMER.client_id }],
    presence_deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Website care', stage: 'won', contact_id: CONTACT, expected_value_cents: 300000, converted_client_id: CUSTOMER.client_id, retainer: o.retainer === undefined ? null : o.retainer, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    presence_contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Jordan Ellis', email: o.noEmail ? '' : 'jordan@client.example', phone: '', company: 'Maple & Rye', deleted_at: null }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_locations: [{ site_id: STUDIO.id, timezone: 'America/Los_Angeles' }],
    presence_settings: o.settings || [],
    presence_invoices: o.invoices || [],
    presence_deal_events: o.events || [],
    presence_money_returns: o.returns || [],
    presence_customer_costs: o.costs || [],
    presence_stripe_checks: [],
    presence_proposals: [], presence_contracts: [], presence_plan_notices: [], clients: [{ id: CUSTOMER.client_id, name: 'Maple & Rye', email: 'jordan@client.example' }], presence_media: [],
  });
  Object.assign(world, { stripe: [], mail: [], pis: o.pis || {}, refuse: new Set() });
}
const inv = (id = INV) => db.tables.presence_invoices.find((x) => x.id === id);
const events = (kind) => db.tables.presence_deal_events.filter((e) => e.kind === kind);
const notices = (pred = () => true) => db.tables.presence_plan_notices.filter(pred);

// ═══ 168. on every invoice ═══
{
  ok('168: how else to pay, one way per line or dot', JSON.stringify(DOC.payOtherLines('Zelle: pay@studio.example · Checks to Test Studio, 12 Main St\nCash in person')) === JSON.stringify(['Zelle: pay@studio.example', 'Checks to Test Studio, 12 Main St', 'Cash in person']) && DOC.payOtherLines('').length === 0);
  ok('168: the tax number prints under the studio', DOC.partyLines({ name: 'Test Studio', taxId: 'EIN 12-3456789' }).join('|') === 'Test Studio|Tax ID EIN 12-3456789');
  seed({ settings: [{ site_id: STUDIO.id, invoice_pay_other: 'Zelle: pay@studio.example', invoice_tax_id: 'EIN 12-3456789' }], invoices: [sent()] });
  const ctx = await DC.docContextFor(STUDIO.id, 'invoice', inv());
  ok('168: the document context carries both', ctx.payOther === 'Zelle: pay@studio.example' && ctx.studio.taxId === 'EIN 12-3456789');
  const html = DOC.renderInvoiceDocument(inv(), { name: 'Test Studio', accent: '#5b3fa0', accentDark: '#3a2470' }, ctx);
  ok('168: the unpaid invoice page shows other ways to pay and the tax number', /Other ways to pay/.test(html) && /Zelle: pay@studio.example/.test(html) && /Tax ID EIN 12-3456789/.test(html));
  const paidHtml = DOC.renderInvoiceDocument({ ...inv(), status: 'paid', paid_at: '2026-10-20T12:00:00Z', paid_method: 'check' }, { name: 'Test Studio', accent: '#5b3fa0', accentDark: '#3a2470' }, ctx);
  ok('168: a receipt doesn’t ask how to pay', !/Other ways to pay/.test(paidHtml));
  const pdf = PDF.invoicePdf(inv(), { name: 'Test Studio', accent: '#5b3fa0', accentDark: '#3a2470' }, ctx);
  ok('168: the PDF is made with them', pdf instanceof Uint8Array && pdf.length > 1000);
  const r = await res(await S.handleSalesInvoiceSend(req('POST', `/sales/invoices/${INV}/send`), site, owner, INV, cors));
  ok('168: the invoice email says how else to pay, with the number to quote', r.status === 200 && world.mail.length === 1 && /Other ways to pay:/.test(world.mail[0].html) && /Zelle: pay@studio.example/.test(world.mail[0].html) && /quote #0012/.test(world.mail[0].html), world.mail[0] && world.mail[0].html.slice(0, 200));
}

// ═══ 167. late fees ═══
{
  const s = { late_fee_mode: 'flat', late_fee_value: 2500, late_fee_days: 7 };
  ok('167: off by default', LC.lateFeeDue(sent({ due_date: '2026-11-01' }), null, TODAY) === 0 && LC.lateFeeDue(sent({ due_date: '2026-11-01' }), { late_fee_mode: 'off', late_fee_value: 2500 }, TODAY) === 0);
  ok('167: a flat fee, N days after the due date, once', LC.lateFeeDue(sent({ due_date: '2026-11-11' }), s, TODAY) === 2500 && LC.lateFeeDue(sent({ due_date: '2026-11-12' }), s, TODAY) === 0 && LC.lateFeeDue(sent({ due_date: '2026-11-01', late_fee_cents: 2500 }), s, TODAY) === 0);
  ok('167: a percent of the invoice', LC.lateFeeDue(sent({ due_date: '2026-11-01' }), { late_fee_mode: 'percent', late_fee_value: 5, late_fee_days: 7 }, TODAY) === 5000);
  ok('167: never with no due date, never unsent, never while the client says they paid', LC.lateFeeDue(sent(), s, TODAY) === 0 && LC.lateFeeDue(invoice({ due_date: '2026-11-01' }), s, TODAY) === 0 && LC.lateFeeDue(sent({ due_date: '2026-11-01', client_says_paid: { method: 'zelle' } }), s, TODAY) === 0);
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_remind_after_days: 2, late_fee_mode: 'flat', late_fee_value: 2500, late_fee_days: 7 }], invoices: [sent({ due_date: '2026-11-01' })] });
  const out = await quiet(() => LC.runInvoiceReminders(20, NOW));
  const row = inv();
  const off = world.stripe.find((c) => c.method === 'POST' && c.path === 'payment_links/plink_sent');
  ok('167: the sweep adds the fee as a line, switches the old link off and makes a fresh one', row.amount_cents === 102500 && row.late_fee_cents === 2500 && Array.isArray(row.lines) && row.lines.some((l) => /^Late fee/.test(l.label) && l.amount_cents === 2500) && !!off && row.stripe_url === 'https://pay.example/new-1' && row.link_gen === 1, JSON.stringify({ row, calls: world.stripe.map((c) => c.path) }));
  ok('167: the deal’s history says so', events('invoice_changed').length === 1 && events('invoice_changed')[0].detail.late_fee === true);
  ok('167: the overdue reminder went with the new amount and says the fee was added', out.reminded === 1 && world.mail.length === 1 && /\$1,025\.00/.test(world.mail[0].html) && /A late fee of \$25\.00 was added, as agreed/.test(world.mail[0].html) && /new-1/.test(world.mail[0].html), world.mail[0] && world.mail[0].html.slice(0, 300));
  world.mail = [];
  await quiet(() => LC.runInvoiceReminders(20, NOW + 86400_000));
  ok('167: the next day adds no second fee', inv().late_fee_cents === 2500 && inv().amount_cents === 102500);
  ok('167: the words only on the overdue legs', /late fee/.test(LC.invoiceReminderCopy('after', 'invoice', '$1,025.00', 'Balance', false, 2500).line) && !/late fee/.test(LC.invoiceReminderCopy('before', 'invoice', '$1,025.00', 'Balance', false, 2500).line));
}

// ═══ 172. paid another way? tell us ═══
{
  const { signDocToken } = DOC;
  seed({ invoices: [sent({ due_date: '2026-11-01' })], settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_remind_after_days: 2 }] });
  const token = await signDocToken({ t: 'doc', k: 'invoice', id: INV, site_id: STUDIO.id, exp: Math.floor(NOW / 1000) + 86400 }, 'approval-secret-polish2');
  let r = await res(await C.handleSaidPaid(req('POST', `/sales/doc/${token}/said-paid`, { method: 'zelle', on: '2026-11-15' }), token, cors));
  ok('172: the client’s word is kept on the invoice and the studio gets a Needs-you line', r.status === 200 && /told us you paid by Zelle on Nov 15, 2026/.test(r.body.data.words) && inv().client_says_paid && inv().client_says_paid.method === 'zelle' && notices((n) => n.kind === 'client_said_paid' && n.status === 'active').length === 1 && /Jordan says they paid #0012 \(\$1,000\.00\) by zelle on Nov 15, 2026/.test(notices()[0].headline), JSON.stringify({ r: r.body, n: notices().map((n) => n.headline) }));
  const out = await quiet(() => LC.runInvoiceReminders(20, NOW));
  ok('172: reminders pause while it is checked', out.reminded === 0 && world.mail.length === 0);
  ok('172: a bad day or way is refused', (await res(await C.handleSaidPaid(req('POST', `/sales/doc/${token}/said-paid`, { method: 'card', on: '2026-11-15' }), token, cors))).status === 422 && (await res(await C.handleSaidPaid(req('POST', `/sales/doc/${token}/said-paid`, { method: 'zelle', on: '2099-01-01' }), token, cors))).status === 422);
  ok('172: the page says what they told us instead of asking again', /You told us you paid by Zelle on Nov 15, 2026/.test(DOC.renderInvoiceDocument(inv(), null, { saidPaidUrl: 'https://fn.test/x', saidPaid: inv().client_says_paid })) && /Paid another way\? Tell us/.test(DOC.renderInvoiceDocument(sent(), null, { saidPaidUrl: 'https://fn.test/x' })));
  r = await res(await C.handleInvoiceNotPaid(req('POST', `/sales/invoices/${INV}/not-paid`), site, owner, INV, cors));
  ok('172: Not received clears the claim and its line; reminders carry on', r.status === 200 && inv().client_says_paid === null && notices((n) => n.kind === 'client_said_paid' && n.status === 'active').length === 0);
  await res(await C.handleSaidPaid(req('POST', `/sales/doc/${token}/said-paid`, { method: 'check', on: '2026-11-16' }), token, cors));
  r = await res(await IP.handleInvoicePayment(req('POST', `/sales/invoices/${INV}/payment?today=${TODAY}`, { amount_cents: 100000, paid_on: '2026-11-16', method: 'check', email_receipt: false }), site, owner, INV, cors));
  ok('172: Confirm (recording the payment) clears it too', r.status === 200 && inv().status === 'paid' && inv().client_says_paid === null && notices((n) => n.kind === 'client_said_paid' && n.status === 'active').length === 0, JSON.stringify(r.body));
  seed({ invoices: [sent()] });
  const bad = await signDocToken({ t: 'doc', k: 'proposal', id: INV, site_id: STUDIO.id, exp: Math.floor(NOW / 1000) + 86400 }, 'approval-secret-polish2');
  ok('172: only an invoice’s own token can say so', (await res(await C.handleSaidPaid(req('POST', `/sales/doc/${bad}/said-paid`, { method: 'zelle', on: '2026-11-15' }), bad, cors))).status === 403);
}

// ═══ 163, 174. retainer receipts, the yearly note, a refunded charge in the portal ═══
{
  const retainer = { status: 'active', amount_cents: 40000, interval: 'month', stripe_subscription_id: 'sub_x', stripe_customer_id: 'cus_x', stripe_payment_link_id: null, checkout_url: null, current_period_end: '2026-12-18T00:00:00Z', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', canceled_at: null };
  seed({ retainer });
  const rec = await quiet(() => RT.recordRetainerCharge({ id: 'in_stripe_1', amount_paid: 40000, status_transitions: { paid_at: Math.floor(NOW / 1000) } }, { dealId: DEAL, siteId: STUDIO.id, interval: 'month', fallbackCents: 40000 }));
  const ev = events('invoice_paid')[0];
  ok('163: the charge is recorded and the client gets a branded receipt with its PDF and a page of its own', rec.ok && rec.recorded && !!ev && world.mail.length === 1 && /Receipt: \$400\.00 monthly retainer payment/.test(world.mail[0].subject) && world.mail[0].to === 'jordan@client.example' && world.mail[0].attachments.length === 1 && /doc\.html\?t=/.test(world.mail[0].html), JSON.stringify({ rec, mail: world.mail.map((m) => m.subject) }));
  const again = await quiet(() => RT.recordRetainerCharge({ id: 'in_stripe_1', amount_paid: 40000 }, { dealId: DEAL, siteId: STUDIO.id, interval: 'month', fallbackCents: 40000 }));
  ok('163: the same charge again records nothing and sends nothing', again.ok && !again.recorded && world.mail.length === 1);
  const row = await RT.chargeReceiptRow(String(ev.id), STUDIO.id);
  ok('163: the receipt row reads as a paid invoice: Retainer, monthly: Website care, $400', !!row && row.status === 'paid' && row.amount_cents === 40000 && /Retainer, monthly: Website care/.test(row.title) && DOC.invoiceDocLabel(row) === 'Receipt' && PDF.pdfFileName('charge', row) === 'Receipt-Retainer-monthly-Website-care.pdf', JSON.stringify(row));
  ok('163: a charge of another site is nobody’s receipt', (await RT.chargeReceiptRow(String(ev.id), CUSTOMER.id)) === null);
  // 174: a refund of that charge in Stripe shows in the portal, with the receipt link
  db.tables.presence_money_returns.push({ id: 'r1', site_id: STUDIO.id, deal_id: DEAL, invoice_id: null, kind: 'refund', applies_to: 'retainer', stripe_id: 're_1', stripe_invoice: 'in_stripe_1', amount_cents: 40000, counted_cents: 40000, counted_at: '2026-11-19T00:00:00Z', status: 'succeeded', happened_at: '2026-11-19T00:00:00Z' });
  const list = await CR.clientRetainers(CUSTOMER.client_id);
  const ch = list[0] && list[0].charges[0];
  ok('174: the portal marks the refunded charge and links its receipt', list.length === 1 && !!ch && ch.refunded === 400 && String(ch.refunded_at).startsWith('2026-11-19') && /doc\.html\?t=/.test(String(ch.receipt_url)), JSON.stringify(list));
  const back = await RT.chargeReceiptRow(String(ev.id), STUDIO.id);
  ok('174: the receipt itself reads Refunded', back.refunded_cents === 40000 && DOC.invoiceReturnWords(back, { returned: back.returned }).state === 'refunded');
  // the yearly note
  const yearly = { ...retainer, interval: 'year', current_period_end: '2026-11-24T00:00:00Z' };
  seed({ retainer: yearly });
  let noted = await quiet(() => LC.runRetainerRenewalNotes(20, NOW));
  ok('163: a yearly retainer charging in six days gets one note, with the amount and the day', noted.noted === 1 && world.mail.length === 1 && /Your yearly retainer renews on November 23, 2026/.test(world.mail[0].subject) && /\$400\.00/.test(world.mail[0].html) && /cancel the retainer from your portal/.test(world.mail[0].html), JSON.stringify(world.mail));
  noted = await quiet(() => LC.runRetainerRenewalNotes(20, NOW + 86400_000));
  ok('163: …once', noted.noted === 0 && world.mail.length === 1);
  ok('163: a monthly retainer, or one charging in a month, gets none', !LC.retainerNoteDue(retainer, NOW) && !LC.retainerNoteDue({ ...yearly, current_period_end: '2026-12-30T00:00:00Z' }, NOW) && LC.retainerNoteDue(yearly, NOW));
  // builder item 402: in one 15-minute run the note shares the daily Stripe check's read of the deals
  // with a retainer (the check asked about this one an hour ago, so it changes nothing)
  seed({ retainer: { ...yearly, stripe_subscription_id: 'sub_y' } });
  db.tables.presence_stripe_checks.push({ subject: `retainer:${DEAL}`, checked_at: new Date(NOW - 3600_000).toISOString(), outcome: 'same' });
  const DBH = await import(`${P}/lib/db.ts`);
  DBH.tickMemoBegin();
  try {
    await quiet(() => SC.runStripeCheck({ invoices: 0, retainers: 3, receipts: 0, returns: 0, processing: 0, refs: 0 }, NOW));
    noted = await quiet(() => LC.runRetainerRenewalNotes(20, NOW));
  } finally { DBH.tickMemoEnd(); }
  const dealReads = db.log.filter((c) => c.method === 'GET' && c.url.startsWith('/rest/v1/presence_deals?retainer=not.is.null')).length;
  ok('163: in one run, the note’s read of the retainer deals is answered from the Stripe check’s (one call, not two), and the note still goes', dealReads === 1 && noted.noted === 1 && world.mail.length === 1, `${dealReads} reads, ${noted.noted} noted`);
}

// ═══ 171. the statement ═══
{
  const x = { invoices: [invoice({ number: 12, created_at: '2026-10-01T18:00:00Z', status: 'paid', paid_at: '2026-10-20T12:00:00Z', paid_method: 'check' }), invoice({ id: INV2, number: 13, created_at: '2026-11-03T18:00:00Z', amount_cents: 50000, status: 'open' })], charges: [{ amount_cents: 20000, paid_at: '2026-11-05T12:00:00Z' }], returned: [{ amount_cents: 10000, paid_at: '2026-11-10T12:00:00Z', kind: 'refund', invoice_id: INV }] };
  const s = ST.statementRows(x, { from: '2026-11-01', to: '2026-11-30' }, 0);
  ok('171: a running balance: opening from the days before, then each invoice, payment, charge and refund', s.opening === 0 && s.lines.map((l) => [l.what, l.owed, l.paid, l.balance].join('|')).join(' / ') === 'Invoice: Balance at launch|$500.00||$500.00 / Retainer charge|$200.00|$200.00|$500.00 / Refund|$100.00||$600.00' && s.closing === 60000, JSON.stringify(s));
  ok('171: an earlier stretch opens with what was owed before it', ST.statementRows(x, { from: '2026-10-15', to: '2026-10-31' }, 0).opening === 100000 && ST.statementRows(x, { from: '2026-10-15', to: '2026-10-31' }, 0).closing === 0);
  const pdf = PDF.statementPdf({ from: '2026-11-01', to: '2026-11-30', opening: '$0.00', closing: '$600.00', lines: s.lines, who: 'Maple & Rye', studio: { name: 'Test Studio' }, billTo: { name: 'Jordan Ellis', company: 'Maple & Rye' }, issued: 'Nov 18, 2026' }, null);
  ok('171: one page comes out', pdf instanceof Uint8Array && pdf.length > 1000);
  seed({ invoices: x.invoices, events: [{ id: EVT, site_id: STUDIO.id, deal_id: DEAL, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system', detail: { retainer: true, amount_cents: 20000, stripe_invoice: 'in_1' }, created_at: '2026-11-05T12:00:00Z' }] });
  let r = await res(await ST.handleStatement(req('GET', `/sales/statement?deal=${DEAL}&from=2026-11-01&to=2026-11-30&format=json&today=${TODAY}`), site, owner, cors));
  ok('171: the route reads the customer’s invoices and charges', r.status === 200 && r.body.data.who === 'Maple & Rye' && r.body.data.lines.length === 2 && r.body.data.has_email === true, JSON.stringify(r.body));
  const pdfRes = await ST.handleStatement(req('GET', `/sales/statement?deal=${DEAL}&from=2026-10-01&to=2026-10-31&today=${TODAY}`), site, owner, cors);
  ok('171: …and as a PDF download', pdfRes.status === 200 && /application\/pdf/.test(pdfRes.headers.get('Content-Type')) && /Statement-2026-10-01-to-2026-10-31\.pdf/.test(pdfRes.headers.get('Content-Disposition')), `${pdfRes.status} ${pdfRes.headers.get('Content-Type')} ${pdfRes.headers.get('Content-Disposition')} ${await pdfRes.text().catch(() => '')}`.slice(0, 300));
  r = await res(await ST.handleStatementEmail(req('POST', `/sales/statement/email?today=${TODAY}`, { deal: DEAL, from: '2026-11-01', to: '2026-11-30' }), site, owner, cors));
  ok('171: emailed to the customer with the PDF attached', r.status === 200 && world.mail.length === 1 && /Your statement from Test Studio/.test(world.mail[0].subject) && world.mail[0].attachments.length === 1, JSON.stringify(r.body));
  ok('171: bad days are refused', (await res(await ST.handleStatement(req('GET', `/sales/statement?deal=${DEAL}&from=2026-13-01&to=2026-11-30`), site, owner, cors))).status === 422);
}

// ═══ 175. the Tax column ═══
{
  const items = [{ id: 'a', number: 21, title: 'Website build', amount_cents: 108500, status: 'open', due_date: '2026-11-15', issued_at: '2026-10-05T17:00:00Z', business: 'Harbor Dental', lines: [{ label: 'Design', qty: 1, amount_cents: 100000 }, { label: 'Tax (8.5%)', qty: 1, amount_cents: 8500 }] }];
  const inv2 = A.invoiceExportRows(items, { from: '2026-10-01', to: '2026-10-31' }, 420);
  ok('175: the tax line is its own column, not a Services line', A.INVOICE_HEAD.at(-1) === 'Tax' && inv2.rows.length === 1 && inv2.rows[0][6] === 'Design' && inv2.rows[0][A.INVOICE_HEAD.indexOf('Tax')] === '85.00' && !inv2.rows.some((r) => /^Tax/.test(r[6])), JSON.stringify(inv2.rows));
  ok('175: an invoice with no tax leaves the column blank', A.invoiceExportRows([{ ...items[0], amount_cents: 100000, lines: [{ label: 'Design', qty: 1, amount_cents: 100000 }] }], { from: '2026-10-01', to: '2026-10-31' }, 420).rows[0].at(-1) === '');
}

// ═══ 176. costs paid for a customer ═══
{
  seed();
  let r = await res(await CO.handleDealCosts(req('POST', `/sales/deals/${DEAL}/costs?today=${TODAY}`, { label: 'Domain renewal, example.com', amount_cents: 1800, spent_on: '2026-11-10', note: 'Namecheap' }), site, owner, DEAL, cors));
  ok('176: a cost is saved on the deal, billed next by default', r.status === 201 && r.body.data.label === 'Domain renewal, example.com' && r.body.data.bill === true && r.body.data.customer_client_id === CUSTOMER.client_id, JSON.stringify(r.body));
  ok('176: what it cost and when are checked', (await res(await CO.handleDealCosts(req('POST', `/sales/deals/${DEAL}/costs?today=${TODAY}`, { label: '', amount_cents: 1800 }), site, owner, DEAL, cors))).status === 422 && (await res(await CO.handleDealCosts(req('POST', `/sales/deals/${DEAL}/costs?today=${TODAY}`, { label: 'x', amount_cents: 1800, spent_on: '2099-01-01' }), site, owner, DEAL, cors))).status === 422);
  r = await res(await CO.handleDealCosts(req('GET', `/sales/deals/${DEAL}/costs`), site, owner, DEAL, cors));
  ok('176: the list says what waits for the next invoice', r.status === 200 && r.body.data.items.length === 1 && r.body.data.unbilled_cents === 1800);
  const costId = r.body.data.items[0].id;
  r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { purpose: 'service', amount_cents: 50000, title: 'Logo refresh' }), site, owner, DEAL, cors));
  const made = db.tables.presence_invoices[0];
  ok('176: the next invoice carries the cost as its own line, and the cost says which invoice', r.status === 201 && made.amount_cents === 51800 && Array.isArray(made.lines) && made.lines.some((l) => l.label === 'Cost: Domain renewal, example.com' && l.amount_cents === 1800) && db.tables.presence_customer_costs[0].invoice_id === made.id, JSON.stringify({ made, costs: db.tables.presence_customer_costs }));
  ok('176: a billed cost can’t be removed or re-priced', (await res(await CO.handleCost(req('DELETE', `/sales/costs/${costId}`), site, owner, costId, cors))).status === 409 && (await res(await CO.handleCost(req('PATCH', `/sales/costs/${costId}`, { amount_cents: 1 }), site, owner, costId, cors))).status === 409);
  const bookRows = [{ spent_on: '2026-11-10', customer: 'Maple & Rye', label: 'Domain renewal', amount_cents: 1800, invoice_no: '0014', note: 'Namecheap' }, { spent_on: '2026-09-10', customer: 'X', label: 'Old', amount_cents: 100, invoice_no: '', note: '' }];
  const cx = A.costExportRows(bookRows, { from: '2026-11-01', to: '2026-11-30' });
  ok('176: costs.csv lists the costs in the days, with the invoice each went on', cx.costs === 1 && cx.rows[0].join('|') === '11/10/2026|Maple & Rye|Domain renewal|18.00|0014|Namecheap' && A.COST_HEAD.join(',') === 'Date,Customer,What,Amount,On invoice,Note');
  ok('176: the READ-ME names the file', /costs\.csv     1 cost paid for customers/.test(A.exportReadMe({ from: '2026-11-01', to: '2026-11-30' }, { invoices: 0, cents: 0 }, { payments: 0, cents: 0 }, false, null, cx)));
  void AX;
}

// ═══ 177. which payment paid an old row ═══
{
  seed({ invoices: [sent({ status: 'paid', paid_at: '2026-11-01T12:00:00Z', paid_ref: '' }), sent({ id: INV2, number: 13, status: 'paid', paid_at: '2026-11-02T12:00:00Z', paid_ref: 'pi_already' })], pis: { [INV]: [{ id: 'pi_found', status: 'succeeded', created: 1_761_000_000 }, { id: 'pi_failed', status: 'requires_payment_method', created: 1_760_000_000 }] } });
  const out = await quiet(() => SC.runStripeCheck({ invoices: 0, retainers: 0, receipts: 0, returns: 0, processing: 0, refs: 5 }, NOW));
  ok('177: the daily check fills paid_ref from Stripe’s own record, and leaves a filled one alone', inv().paid_ref === 'pi_found' && inv(INV2).paid_ref === 'pi_already' && !out.skipped_not_set_up, JSON.stringify({ out, a: inv().paid_ref }));
  ok('177: it asked Stripe by the invoice’s own id, a read the key allows', world.stripe.some((c) => c.method === 'GET' && c.path === 'payment_intents/search'));
  const mig = Deno.readTextFileSync(new URL('../../supabase/migrations/0251_fill_paid_ref.sql', import.meta.url));
  ok('177: the migration only touches rows paid online with no paid_ref', /paid_ref = ''/.test(mig) && /paid_method = ''/.test(mig) && /one\.n = 1/.test(mig));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILED:'); for (const r of results.filter((x) => !x.p)) console.log('  ' + r.n); Deno.exit(1); }
