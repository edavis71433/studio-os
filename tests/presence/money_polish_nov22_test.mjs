// ── Sales items 162 to 170, money polish of the Nov 22 2026 review ───────────
//   deno run --allow-read --allow-env --allow-net tests/presence/money_polish_nov22_test.mjs
//
// 162  an unpaid invoice can change (title, note, due date; amount and lines while nothing was
//      paid toward it); the number is kept; a new amount gets a fresh pay link; one already sent
//      goes again as corrected; the deal's history keeps each change
// 164  "Save without sending" keeps an invoice as a draft; lines typed on the form go with it
// 165  money given back by hand on an invoice paid by hand: a returns row, the invoice's
//      refunded_cents, the receipt's words, the bookkeeper file's row
// 166  the first send with reminders off asks once; Remind now sends one reminder a day
// 169  the Invoices page's book carries the pay link, the note and the lines
// 170  a customer's name prints once
// Stripe, the mail service and the database are fakes. Every name and number is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('STRIPE_SECRET', 'sk_test_fake_polish');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('APPROVAL_SECRET', 'approval-secret-polish');
const db = installFakePostgrest({ unique: { presence_plan_notices: [['client_id', 'kind', 'period']] } });

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const world = { stripe: [], mail: [], refuse: new Set() };
const fakeDb = globalThis.fetch;
let linkN = 0;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const path = u.pathname.replace('/v1/', '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    world.stripe.push({ method, path, body });
    if ([...world.refuse].some((p) => path.startsWith(p))) return jres(400, { error: { message: 'no' } });
    if (method === 'POST' && path === 'payment_links') { linkN++; return jres(200, { id: `plink_new_${linkN}`, url: `https://pay.example/new-${linkN}` }); }
    if (method === 'POST' && path === 'prices') return jres(200, { id: `price_${linkN + 1}` });
    if (method === 'POST' && path.startsWith('payment_links/')) return jres(200, { id: path.split('/')[1], active: false });
    if (method === 'GET') return jres(200, { object: 'list', data: [] });
    return jres(404, { error: { message: `unplanned Stripe call ${method} ${path}` } });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); world.mail.push({ to: String(b.to), subject: String(b.subject), html: String(b.html) }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, true);
  return fakeDb(input, init);
};

const P = '../../supabase/functions/presence';
const S = await import(`${P}/routes/sales.ts`);
const C = await import(`${P}/routes/invoice_changes.ts`);
const L = await import(`${P}/lib/invoice_changes.ts`);
const I = await import(`${P}/routes/invoices_list.ts`);
const RA = await import(`${P}/lib/reminder_ask.ts`);
const DOC = await import(`${P}/lib/documents.ts`);
const A = await import(`${P}/lib/accounting_export.ts`);

const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const INV = '55555555-5555-4555-8555-555555555555';
const PART = '55555555-5555-4555-8555-555555555557';
const site = { id: STUDIO.id, client_id: STUDIO.client_id, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333339', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const TODAY = '2026-11-18';
const invoice = (over = {}) => ({ id: INV, site_id: STUDIO.id, deal_id: DEAL, customer_client_id: null, number: 12, title: 'Balance at launch', description: 'Balance', amount_cents: 100000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: null, stripe_payment_link_id: null, processing_since: null, paid_at: null, paid_method: '', paid_note: '', payment_for: null, link_gen: 0, first_sent_at: null, due_date: null, lines: null, refunded_cents: 0, dispute_status: null, deleted_at: null, created_at: '2026-10-01T18:00:00Z' , updated_at: '2026-10-01T18:00:00Z', ...over });
const sent = (over = {}) => invoice({ stripe_url: 'https://pay.example/sent', stripe_payment_link_id: 'plink_sent', first_sent_at: '2026-10-02T18:00:00Z', ...over });
const paidByHand = (over = {}) => sent({ status: 'paid', paid_at: '2026-10-20T12:00:00.000Z', paid_method: 'check', paid_note: 'Check #1042', stripe_url: null, stripe_payment_link_id: null, ...over });
function seed(o = {}) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }],
    presence_deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Website care', stage: 'won', contact_id: CONTACT, expected_value_cents: 300000, converted_client_id: null, retainer: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    presence_contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Jordan Ellis', email: o.noEmail ? '' : 'jordan@client.example', phone: '', company: o.company || '', deleted_at: null }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_locations: [{ site_id: STUDIO.id, timezone: 'America/Los_Angeles' }],
    presence_settings: o.settings || [],
    presence_invoices: o.invoices || [],
    presence_proposals: [], presence_contracts: [], presence_deal_events: [], presence_plan_notices: [], presence_money_returns: o.returns || [], clients: [],
  });
  Object.assign(world, { stripe: [], mail: [], refuse: new Set(o.refuse || []) });
}
const inv = (id = INV) => db.tables.presence_invoices.find((x) => x.id === id);
const events = (kind) => db.tables.presence_deal_events.filter((e) => e.kind === kind);

// ═══ 162. the pure rules ═══
{
  const v = L.validateInvoiceEdit({ title: 'Balance, launch', due_date: '2026-12-01' }, invoice(), 0, TODAY);
  ok('162: title and due date change on an unpaid invoice', v.ok && v.changes.map((c) => c.field).join(',') === 'title,due_date' && v.patch.title === 'Balance, launch' && v.patch.due_date === '2026-12-01');
  ok('162: nothing different → no changes', L.validateInvoiceEdit({ title: 'Balance at launch' }, invoice(), 0, TODAY).changes.length === 0);
  const a = L.validateInvoiceEdit({ amount_cents: 120000 }, invoice(), 0, TODAY);
  ok('162: the amount changes while nothing was paid toward it', a.ok && a.patch.amount_cents === 120000);
  const p = L.validateInvoiceEdit({ amount_cents: 120000 }, invoice(), 40000, TODAY);
  ok('162: …but not once a part payment came in (part_paid), while the title still can', !p.ok && p.error === 'part_paid' && L.validateInvoiceEdit({ title: 'New words' }, invoice(), 40000, TODAY).ok);
  ok('162: a paid invoice is a record and refuses', L.validateInvoiceEdit({ title: 'x' }, invoice({ status: 'paid' }), 0, TODAY).error === 'already_paid');
  ok('162: a settling payment refuses', L.validateInvoiceEdit({ title: 'x' }, invoice({ processing_since: '2026-11-01T00:00:00Z' }), 0, TODAY).error === 'processing');
  const l = L.validateInvoiceEdit({ lines: [{ label: 'Design', qty: 1, amount_cents: 70000 }, { label: 'Pages', qty: 3, amount_cents: 40000 }] }, invoice(), 0, TODAY);
  ok('162: lines set the amount (their sum), and are kept', l.ok && l.patch.amount_cents === 110000 && Array.isArray(l.patch.lines) && l.patch.lines.length === 2 && l.changes.some((c) => c.field === 'lines') && l.changes.some((c) => c.field === 'amount_cents' && c.to === 110000));
  ok('162: lines that don’t add up to a typed amount are refused', L.validateInvoiceEdit({ amount_cents: 90000, lines: [{ label: 'Design', qty: 1, amount_cents: 70000 }] }, invoice(), 0, TODAY).error === 'validation');
  ok('162: a line with no words is refused', L.cleanLines([{ label: '', amount_cents: 100 }]).ok === false && L.cleanLines([{ label: 'Design', amount_cents: 100 }]).ok === true);
  ok('162: each change in words', L.changeWords([{ field: 'amount_cents', from: 100000, to: 120000 }, { field: 'due_date', from: null, to: '2026-12-01' }]).join(' | ') === 'amount $1,000.00 to $1,200.00 | due on receipt to 2026-12-01');
}
// ═══ 162. the route ═══
{
  seed({ invoices: [invoice()] });
  let r = await res(await C.handleInvoiceEdit(req('PATCH', `/sales/invoices/${INV}?today=${TODAY}`, { title: 'Balance, launch', due_date: '2026-12-01', description: 'Thank you' }), site, owner, INV, cors));
  ok('162: an unsent invoice changes its title, due date and note; nothing is emailed; the number stays', r.status === 200 && r.body.changed && inv().title === 'Balance, launch' && inv().due_date === '2026-12-01' && inv().description === 'Thank you' && inv().number === 12 && world.mail.length === 0 && r.body.resent === false, JSON.stringify(r.body));
  ok('162: the deal’s history keeps the change, old and new', events('invoice_changed').length === 1 && events('invoice_changed')[0].detail.changes.some((c) => c.field === 'title' && c.from === 'Balance at launch'), JSON.stringify(events('invoice_changed')));
  seed({ invoices: [sent()] });
  r = await res(await C.handleInvoiceEdit(req('PATCH', `/sales/invoices/${INV}?today=${TODAY}`, { amount_cents: 120000 }), site, owner, INV, cors));
  const off = world.stripe.find((c) => c.method === 'POST' && c.path === 'payment_links/plink_sent');
  ok('162: a new amount on a sent invoice: the old link is switched off, a fresh one made, and it goes again as corrected', r.status === 200 && inv().amount_cents === 120000 && !!off && off.body.active === 'false' && inv().stripe_url === 'https://pay.example/new-1' && inv().link_gen === 1 && r.body.resent === true && world.mail.length === 1 && /This replaces the earlier copy of invoice #0012/.test(world.mail[0].html) && /\$1,000\.00 to \$1,200\.00/.test(world.mail[0].html), JSON.stringify({ r: r.body, mail: world.mail.map((m) => m.subject) }));
  ok('162: the corrected email keeps the number in its subject', /#0012/.test(world.mail[0].subject));
  seed({ invoices: [sent()] });
  r = await res(await C.handleInvoiceEdit(req('PATCH', `/sales/invoices/${INV}?today=${TODAY}`, { title: 'New words', resend: false }), site, owner, INV, cors));
  ok('162: resend: false holds the email', r.status === 200 && r.body.changed && world.mail.length === 0 && r.body.sent_before === true);
  seed({ invoices: [sent({ amount_cents: 60000 }), sent({ id: PART, number: null, status: 'paid', payment_for: INV, amount_cents: 40000, paid_method: 'zelle', paid_at: '2026-10-05T12:00:00Z' })] });
  r = await res(await C.handleInvoiceEdit(req('PATCH', `/sales/invoices/${INV}?today=${TODAY}`, { amount_cents: 90000 }), site, owner, INV, cors));
  ok('162: a part payment on it: the amount is refused and nothing changes', r.status === 409 && r.body.error === 'part_paid' && inv().amount_cents === 60000, JSON.stringify(r.body));
  seed({ invoices: [paidByHand()] });
  r = await res(await C.handleInvoiceEdit(req('PATCH', `/sales/invoices/${INV}`, { title: 'x' }), site, owner, INV, cors));
  ok('162: a paid one refuses (409 already_paid)', r.status === 409 && r.body.error === 'already_paid');
}

// ═══ 164. Save without sending, and lines on the form ═══
{
  seed();
  let r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { purpose: 'service', amount_cents: 50000, title: 'Logo refresh', send: false }), site, owner, DEAL, cors));
  const row = db.tables.presence_invoices[0];
  ok('164: Save without sending makes a numbered draft: no pay link, no email, no history line', r.status === 201 && r.body.saved === true && !!row && row.status === 'open' && !row.stripe_url && world.mail.length === 0 && !world.stripe.some((c) => c.path === 'payment_links') && events('invoice_sent').length === 0, JSON.stringify(r.body));
  seed();
  r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { purpose: 'service', amount_cents: 50000, title: 'Logo refresh', lines: [{ label: 'Logo', qty: 1, amount_cents: 30000 }, { label: 'Business cards', qty: 1, amount_cents: 20000 }] }), site, owner, DEAL, cors));
  ok('170: lines typed on the form go with the invoice when they add up', r.status === 201 && Array.isArray(db.tables.presence_invoices[0].lines) && db.tables.presence_invoices[0].lines.length === 2, JSON.stringify(r.body));
  seed();
  r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { purpose: 'service', amount_cents: 50000, lines: [{ label: 'Logo', qty: 1, amount_cents: 30000 }, { label: 'Cards', qty: 1, amount_cents: 10000 }] }), site, owner, DEAL, cors));
  ok('170: lines that don’t add up to the amount are refused', r.status === 422 && db.tables.presence_invoices.length === 0, JSON.stringify(r.body));
}

// ═══ 165. money given back by hand ═══
{
  ok('165: the pure rule: by hand, no more than what is kept, not in the future, one of the five ways', L.validateMoneyBack({ amount_cents: 10000, on: '2026-11-10', method: 'check' }, paidByHand(), 0, TODAY).ok && L.validateMoneyBack({ amount_cents: 100001, on: '2026-11-10', method: 'check' }, paidByHand(), 0, TODAY).error === 'validation' && L.validateMoneyBack({ amount_cents: 100, on: '2026-11-19', method: 'check' }, paidByHand(), 0, TODAY).error === 'validation' && L.validateMoneyBack({ amount_cents: 100, on: '2026-11-10', method: 'card' }, paidByHand(), 0, TODAY).error === 'validation');
  ok('165: an invoice paid online is refunded in Stripe, not here', L.validateMoneyBack({ amount_cents: 100, on: '2026-11-10', method: 'check' }, paidByHand({ paid_method: '' }), 0, TODAY).error === 'online');
  ok('165: the part payments count toward what is kept', L.validateMoneyBack({ amount_cents: 130000, on: '2026-11-10', method: 'check' }, paidByHand({ amount_cents: 100000 }), 40000, TODAY).ok);
  seed({ invoices: [paidByHand()] });
  let r = await res(await C.handleInvoiceMoneyBack(req('POST', `/sales/invoices/${INV}/money-back?today=${TODAY}`, { amount_cents: 10000, on: '2026-11-10', method: 'check', note: 'Goodwill credit' }), site, owner, INV, cors));
  const ret = db.tables.presence_money_returns[0];
  ok('165: a returns row by hand, the invoice reads Paid with $100 refunded, the deal’s history says so', r.status === 200 && r.body.data.refunded_cents === 10000 && inv().refunded_cents === 10000 && inv().status === 'paid' && !!ret && ret.kind === 'refund' && ret.applies_to === 'invoice' && /^hand:/.test(ret.stripe_id) && ret.method === 'check' && ret.counted_cents === 10000 && ret.counted_at === '2026-11-10T12:00:00.000Z' && events('money_back').length === 1, JSON.stringify({ r: r.body, ret }));
  r = await res(await C.handleInvoiceMoneyBack(req('POST', `/sales/invoices/${INV}/money-back?today=${TODAY}`, { amount_cents: 95000, on: '2026-11-11', method: 'zelle' }), site, owner, INV, cors));
  ok('165: more than what is kept is refused', r.status === 422 && inv().refunded_cents === 10000, JSON.stringify(r.body));
  seed({ invoices: [paidByHand({ paid_method: '' })] });
  r = await res(await C.handleInvoiceMoneyBack(req('POST', `/sales/invoices/${INV}/money-back?today=${TODAY}`, { amount_cents: 100, on: '2026-11-10', method: 'check' }), site, owner, INV, cors));
  ok('165: paid online → 409 and a pointer to Stripe', r.status === 409 && r.body.error === 'online' && db.tables.presence_money_returns.length === 0);
  // the receipt's words
  const w = DOC.invoiceReturnWords(paidByHand({ refunded_cents: 10000 }), { tz: 'America/Los_Angeles', returned: [{ cents: 10000, at: '2026-11-10T12:00:00.000Z', kind: 'refund', method: 'check' }] });
  ok('165: the receipt reads "Paid · $100.00 refunded" and says how and when', w.state === 'part' && w.pill === 'Paid · $100.00 refunded' && /refunded by check on Nov 10, 2026/.test(w.line), JSON.stringify(w));
  const html = DOC.renderInvoiceDocument(paidByHand({ refunded_cents: 10000 }), { name: 'Test Studio', accent: '#5b3fa0', accentDark: '#3a2470' }, { tz: 'America/Los_Angeles', returned: [{ cents: 10000, at: '2026-11-10T12:00:00.000Z', kind: 'refund', method: 'check' }] });
  ok('165: …and the page carries it', /by check on Nov 10, 2026/.test(html));
  // the bookkeeper file
  const pay = A.paymentExportRows([{ id: INV, number: 12, title: 'Balance', amount_cents: 100000, status: 'paid', paid_at: '2026-10-20T12:00:00Z', paid_method: 'check', issued_at: '2026-10-10T17:00:00Z', person: 'Ana Ruiz' }], [], { from: '2026-10-01', to: '2026-11-30' }, 420, [{ kind: 'refund', amount_cents: 10000, at: '2026-11-10T12:00:00.000Z', customer: 'Ana Ruiz', invoice_no: '0012', what: 'Balance', by_hand: 'check' }]);
  const back = pay.rows.find((r) => r[3].startsWith('Refund'));
  ok('165: payments.csv says "Given back by check" with a minus amount', !!back && back[4] === 'Given back by check' && back[5] === '-100.00', JSON.stringify(pay.rows));
}

// ═══ 166. asked once; Remind now ═══
{
  seed({ settings: [] });
  ok('166: no settings row: reminders are off and nobody was asked → ask', await RA.shouldAskReminders(STUDIO.id) === true);
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: false, invoice_reminders_asked: false }] });
  ok('166: off and never asked → ask', await RA.shouldAskReminders(STUDIO.id) === true);
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: false, invoice_reminders_asked: true }] });
  ok('166: answered once → never again', await RA.shouldAskReminders(STUDIO.id) === false);
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_reminders_asked: false }] });
  ok('166: already on → nothing to ask', await RA.shouldAskReminders(STUDIO.id) === false);
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: false, invoice_reminders_asked: false }] });
  let r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { purpose: 'service', amount_cents: 50000, title: 'Logo refresh' }), site, owner, DEAL, cors));
  ok('166: the first send’s answer carries ask_reminders', r.status === 201 && r.body.emailed === true && r.body.ask_reminders === true, JSON.stringify(r.body));
  seed({ settings: [{ site_id: STUDIO.id, invoice_reminders: false, invoice_reminders_asked: true }], invoices: [invoice()] });
  r = await res(await S.handleSalesInvoiceSend(req('POST', `/sales/invoices/${INV}/send`), site, owner, INV, cors));
  ok('166: a send after the answer doesn’t ask', r.status === 200 && r.body.ask_reminders === false, JSON.stringify(r.body));
  // Remind now
  seed({ invoices: [sent({ due_date: '2026-11-10' })] });
  r = await res(await C.handleInvoiceRemindNow(req('POST', `/sales/invoices/${INV}/remind?today=${TODAY}`), site, owner, INV, cors));
  ok('166: Remind now emails one reminder in "still open" words for an overdue invoice, and the deal’s history says so', r.status === 200 && r.body.data.sent && r.body.data.slot === 'after' && world.mail.length === 1 && /gentle reminder/i.test(world.mail[0].subject) && world.mail[0].to === 'jordan@client.example' && events('invoice_reminded').length === 1, JSON.stringify({ r: r.body, mail: world.mail }));
  r = await res(await C.handleInvoiceRemindNow(req('POST', `/sales/invoices/${INV}/remind?today=${TODAY}`), site, owner, INV, cors));
  ok('166: a second one the same day is refused', r.status === 409 && r.body.error === 'already_today' && world.mail.length === 1, JSON.stringify(r.body));
  ok('166: the words for a not-yet-due invoice are "coming up", on the day "due today"', L.remindNowSlot('2026-11-25', TODAY) === 'before' && L.remindNowSlot(TODAY, TODAY) === 'due' && L.remindNowSlot(null, TODAY) === 'after');
  seed({ invoices: [invoice()] });
  r = await res(await C.handleInvoiceRemindNow(req('POST', `/sales/invoices/${INV}/remind?today=${TODAY}`), site, owner, INV, cors));
  ok('166: an invoice never sent can’t be reminded about', r.status === 409 && r.body.error === 'not_sent');
  seed({ invoices: [sent()], noEmail: true });
  r = await res(await C.handleInvoiceRemindNow(req('POST', `/sales/invoices/${INV}/remind?today=${TODAY}`), site, owner, INV, cors));
  ok('166: no email on the contact → 409, nothing sent', r.status === 409 && r.body.error === 'no_email' && world.mail.length === 0);
}

// ═══ 169, 170. the Invoices page's book ═══
{
  ok('170: the person is dropped when it is the business, ignoring case and spacing', I.oneName('Maple & Rye', 'maple &  rye') === '' && I.oneName('Maple & Rye', 'Jordan Lee') === 'Jordan Lee' && I.oneName('', 'Jordan Lee') === 'Jordan Lee');
  seed({ invoices: [sent({ description: 'Thanks', lines: [{ label: 'A', qty: 1, amount_cents: 100000 }] })], company: 'Jordan Ellis' });
  const r = await res(await I.handleSalesInvoicesList(req('GET', `/sales/invoices?today=${TODAY}`), site, cors));
  const it = r.body.data.items[0];
  ok('169: the row carries its pay link, its note and its lines for the menu and the Change dialog', r.status === 200 && it.pay_url === 'https://pay.example/sent' && it.note === 'Thanks' && Array.isArray(it.lines) && it.lines.length === 1, JSON.stringify(it));
  ok('170: a person whose company is their own name prints once', it.business === 'Jordan Ellis' && it.person === '', JSON.stringify([it.business, it.person]));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILED:'); for (const r of results.filter((x) => !x.p)) console.log('  ' + r.n); Deno.exit(1); }
