// ── Sales items 126, 127: refunds and disputes made in Stripe reach Studio OS (Stripe review, Nov 15 2026) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/stripe_refunds_disputes_126_127_test.mjs
//
// The review found that a refund or a dispute made in Stripe never reached Studio OS:
// the invoice kept saying Paid, revenue, the weekly email and the bookkeeper file kept
// counting the money, the client heard nothing, and a dispute's deadline passed with
// nothing on Today. Every block below drives the real code: Stripe's events are built
// in the shape the endpoint's version (2026-05-27.dahlia) sends and signed the way
// Stripe signs them, the webhook hands them to the real presence route, and Stripe,
// the mail service and the database are fakes. Every name and number is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

const SECRET = 'test-commerce-secret-126';
const HOOK_SECRET = 'whsec_test_fake_126';
Deno.env.set('STRIPE_SECRET', 'sk_test_fake_126');
Deno.env.set('STRIPE_WEBHOOK_SECRET', HOOK_SECRET);
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
const db = installFakePostgrest({ unique: {
  presence_money_returns: [['stripe_id']],
  presence_plan_notices: [['client_id', 'kind', 'period']],
  stripe_webhook_events: [['event_id']],
} });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ═══ the fake world beyond the database: Stripe, the mail service, the hop ═══
const stripe = { charges: {}, refunds: {}, disputes: {}, intents: {}, invoicePayments: {}, down: false, calls: [] };
const mail = [];
const dbFetch = globalThis.fetch;
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PUBLIC = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
let handleCommerce = null;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    stripe.calls.push({ method, path: u.pathname, version: new Headers(init.headers).get('Stripe-Version') });
    if (stripe.down) return jres(500, { error: { message: 'Stripe is having a moment' } });
    if (method !== 'GET') return jres(400, { error: { message: 'this test never writes to Stripe' } });
    const [, , kind, id] = u.pathname.split('/');
    const missing = () => jres(404, { error: { message: `No such ${kind}: ${id}` } });
    if (kind === 'charges') return stripe.charges[id] ? jres(200, stripe.charges[id]) : missing();
    if (kind === 'refunds' && !id) return jres(200, { object: 'list', data: (stripe.refunds[u.searchParams.get('charge')] || []).slice().reverse() });
    if (kind === 'disputes' && id) return stripe.disputes[id] ? jres(200, stripe.disputes[id]) : missing();
    if (kind === 'disputes') return jres(200, { object: 'list', data: Object.values(stripe.disputes).filter((d) => d.charge === u.searchParams.get('charge')) });
    if (kind === 'payment_intents') return stripe.intents[id] ? jres(200, stripe.intents[id]) : missing();
    if (kind === 'invoice_payments') { const inv = stripe.invoicePayments[u.searchParams.get('payment[payment_intent]')]; return jres(200, { object: 'list', data: inv ? [{ object: 'invoice_payment', invoice: inv, status: 'paid' }] : [] }); }
    return missing();
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); mail.push({ to: String(b.to), subject: b.subject, html: b.html }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/functions/v1/presence/commerce/charge-event') {
    return handleCommerce(new Request('https://x/commerce/charge-event', { method: 'POST', headers: init.headers, body: init.body }), '/commerce/charge-event', 'POST', PUBLIC, {});
  }
  if (u.pathname.startsWith('/functions/v1/')) return jres(200, { data: { notice: true } });
  return dbFetch(input, init);
};

const P = '../../supabase/functions/presence';
({ handleCommerce } = await import(`${P}/routes/commerce.ts`));
const CR = await import(`${P}/commerce/charge_returns.ts`);
const { moneyState, moneyBuckets } = await import(`${P}/lib/money_state.ts`);
const { noticeTier } = await import(`${P}/lib/inbox_feed.ts`);
const { noticeHrefFor } = await import(`${P}/routes/workspace.ts`);
const { revenueByMonth } = await import(`${P}/lib/sales_reports.ts`);
const { returnedPayments, disputeFees } = await import(`${P}/lib/money_returns.ts`);
const { paymentExportRows, exportReadMe } = await import(`${P}/lib/accounting_export.ts`);
const { STRIPE_API_VERSION } = await import(`${P}/commerce/stripe_shape.ts`);

// the webhook is a served function: catch its handler instead of opening a port
let hook = null;
{ const realServe = Deno.serve; Deno.serve = (h) => { hook = h; return {}; }; await import('../../supabase/functions/stripe-webhook/index.ts'); Deno.serve = realServe; }

// a Stripe event in the version the endpoint is on, signed the way Stripe signs it
let evt = 0;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function stripeEvent(type, object, opt = {}) {
  const raw = JSON.stringify({ id: opt.id || `evt_126_${++evt}`, object: 'event', api_version: STRIPE_API_VERSION, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const quiet = [console.error, console.warn, console.log]; console.error = console.warn = console.log = () => {};
  try { return await hook(new Request('https://x/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })); }
  finally { [console.error, console.warn, console.log] = quiet; }
}
const quietly = async (f) => { const q = [console.error, console.warn, console.log]; console.error = console.warn = console.log = () => {}; try { return await f(); } finally { [console.error, console.warn, console.log] = q; } };

// ═══ the studio, its client and their invoices ═══
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STUDIO = { id: id('11111111', 1), client_id: id('22222222', 1) };
const DEAL = id('33333333', 1), PERSON = id('44444444', 1);
const INV = (n) => id('55555555', n);
const T0 = Date.parse('2026-11-16T15:00:00Z') / 1000;   // when the refunds and disputes below were made
const invoice = (n, over = {}) => ({ id: INV(n), site_id: STUDIO.id, deal_id: DEAL, customer_client_id: null, title: 'Website build', amount_cents: 100000, purpose: 'service', status: 'paid', number: 13, paid_at: '2026-11-02T10:00:00Z', paid_ref: `pi_test${n}aaaa`, paid_method: '', refunded_cents: 0, dispute_status: null, deleted_at: null, created_at: '2026-10-20T10:00:00Z', ...over });
const charge = (n, over = {}) => ({ id: `ch_test${n}aaaa`, object: 'charge', amount: 100000, amount_captured: 100000, amount_refunded: 0, refunded: false, disputed: false, currency: 'usd', payment_intent: `pi_test${n}aaaa`, payment_method_details: { type: 'card' }, metadata: {}, livemode: false, created: T0 - 14 * 86400, ...over });
const refund = (n, k, amount, over = {}) => ({ id: `re_test${n}${k}aaa`, object: 'refund', amount, charge: `ch_test${n}aaaa`, payment_intent: `pi_test${n}aaaa`, currency: 'usd', created: T0 + k * 3600, status: 'succeeded', reason: 'requested_by_customer', ...over });
const DUE = T0 + 14 * 86400;
const dispute = (n, over = {}) => ({ id: `du_test${n}aaaa`, object: 'dispute', amount: 100000, charge: `ch_test${n}aaaa`, payment_intent: `pi_test${n}aaaa`, currency: 'usd', created: T0, reason: 'product_not_received', status: 'needs_response',
  evidence_details: { due_by: DUE, has_evidence: false, past_due: false, submission_count: 0 }, balance_transactions: [{ object: 'balance_transaction', amount: -100000, fee: 1500, net: -101500 }],
  payment_method_details: { type: 'card', card: { brand: 'visa', case_type: 'chargeback' } }, is_charge_refundable: false, livemode: false, metadata: {}, ...over });

function seed(invoices = [invoice(1)]) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Harbor website', contact_id: PERSON, converted_client_id: null, deleted_at: null }],
    presence_contacts: [{ id: PERSON, site_id: STUDIO.id, name: 'Marcus Bell', email: 'marcus@client.example' }],
    presence_invoices: invoices,
    presence_plan_notices: [], presence_money_returns: [], presence_deal_events: [], stripe_webhook_events: [],
  });
  Object.assign(stripe, { charges: {}, refunds: {}, disputes: {}, intents: {}, invoicePayments: {}, down: false, calls: [] });
  mail.length = 0;
}
const inv = (n) => db.tables.presence_invoices.find((i) => i.id === INV(n));
const returns = () => db.tables.presence_money_returns || [];
const notices = () => db.tables.presence_plan_notices || [];
const lines = (re) => notices().filter((x) => re.test(x.period));
const history = () => (db.tables.presence_deal_events || []).filter((e) => e.kind === 'payment_undone');
const TODAY = '2026-11-16';
const stateOf = (n) => moneyState(inv(n), TODAY);

// ═══ 1. a refund in full of an invoice's own payment ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 100000)];
  const res = await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('full refund: Stripe gets its 200', res.status === 200);
  ok('full refund: the invoice reads Refunded, and its bucket counts nothing', inv(1).refunded_cents === 100000 && stateOf(1) === 'refunded' && moneyBuckets([inv(1)], TODAY).paid.cents === 0, JSON.stringify(inv(1)));
  const r = returns()[0];
  ok('full refund: one record, keyed by Stripe’s refund, all of it counted, on the day it was made', returns().length === 1 && r.stripe_id === 're_test11aaa' && r.kind === 'refund' && r.applies_to === 'invoice' && r.counted_cents === 100000 && r.counted_at === new Date((T0 + 3600) * 1000).toISOString() && r.status === 'succeeded', JSON.stringify(r));
  const m = mail.find((x) => x.to === 'marcus@client.example');
  ok('full refund: the client gets an email that says how much, for what, and where it goes', !!m && m.subject === 'Your refund of $1,000.00 is on its way' && /refunded your payment of <strong>\$1,000\.00<\/strong> for invoice 0013 \(Website build\) in full\./.test(m.html) && /goes back to the card or account you paid with/.test(m.html), JSON.stringify(m));
  ok('full refund: the record says the client was emailed', r.client_emailed === true);
  const ln = lines(/^refund:/)[0];
  ok('full refund: the studio gets a line under Updates, naming the money and the month', lines(/^refund:/).length === 1 && ln.kind === 'invoice_paid' && noticeTier(ln.kind) === 'update' && ln.headline === 'Refunded in full: Website build ($1,000.00)' && /The invoice now reads Refunded, and it comes off November’s revenue\. We emailed Marcus Bell to say so\./.test(ln.body), JSON.stringify(ln));
  ok('full refund: the line opens the deal’s Billing', noticeHrefFor(ln) === `/pipeline.html?deal=${DEAL}&dtab=billing`);
  ok('full refund: the deal’s history keeps it', history().length === 1 && history()[0].detail.refund === true && history()[0].detail.amount_cents === 100000 && history()[0].detail.full === true);
  ok('every read named the version Studio OS was built for, and nothing was written to Stripe', stripe.calls.length > 0 && stripe.calls.every((c) => c.method === 'GET' && c.version === STRIPE_API_VERSION));

  // Stripe repeats itself: the same event, and a refund.updated for the same refund
  const before = { mail: mail.length, notices: notices().length, returns: returns().length, history: history().length };
  const again = await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  const upd = await stripeEvent('refund.updated', stripe.refunds.ch_test1aaaa[0]);
  ok('a repeat, and another event about the same refund: nothing recorded twice, nobody told twice', again.status === 200 && upd.status === 200 && mail.length === before.mail && notices().length === before.notices && returns().length === before.returns && history().length === before.history);
}

// ═══ 2. part refunds, then more, then a refund that fails ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 20000 });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 20000)];
  await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('part refund: the invoice stays Paid, with $200.00 refunded, and its bucket counts what was kept', inv(1).refunded_cents === 20000 && stateOf(1) === 'paid' && moneyBuckets([inv(1)], TODAY).paid.cents === 80000);
  const ln = lines(/^refund:/)[0];
  ok('part refund: the line says what the invoice now reads', ln.headline === 'Refunded $200.00: Website build' && /The invoice now reads Paid with \$200\.00 refunded, and it comes off November’s revenue\./.test(ln.body), JSON.stringify(ln));
  ok('part refund: the client’s email says part of it', mail.length === 1 && /refunded <strong>\$200\.00<\/strong> of your payment for invoice 0013/.test(mail[0].html));
  // a second part refund, a day later
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 50000 });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 20000), refund(1, 25, 30000, { status: 'pending' })];
  await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('a second refund: added up on the invoice, its own record, its own line and email', inv(1).refunded_cents === 50000 && returns().length === 2 && lines(/^refund:/).length === 2 && mail.length === 2);
  // the second one fails at the bank
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 20000 });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 20000), refund(1, 25, 30000, { status: 'failed', failure_reason: 'lost_or_stolen_card' })];
  const res = await stripeEvent('refund.updated', stripe.refunds.ch_test1aaaa[1]);
  const failed = returns().find((r) => r.stripe_id === 're_test125aaa');
  ok('a refund that failed: it counts for nothing and the invoice goes back to $200.00 refunded', res.status === 200 && failed.status === 'failed' && failed.counted_cents === 0 && inv(1).refunded_cents === 20000);
  const fl = lines(/^refundfailed:/)[0];
  ok('a refund that failed: a Needs you line says the money is back in Stripe and what to do', !!fl && fl.kind === 'invoice_void_paid' && noticeTier(fl.kind) === 'needs_you' && fl.headline === 'A refund didn’t go through: Website build ($300.00)' && /in your Stripe balance again/.test(fl.body) && mail.length === 2, JSON.stringify(fl));
}

// two part refunds Stripe reports at once (a message was lost): each says its own amount, and the invoice reads Refunded
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 30000), refund(1, 2, 70000)];
  await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  const heads = lines(/^refund:/).map((x) => x.headline).sort();
  ok('two part refunds at once: the invoice reads Refunded, and neither line nor email says "in full"',
    stateOf(1) === 'refunded' && JSON.stringify(heads) === JSON.stringify(['Refunded $300.00: Website build', 'Refunded $700.00: Website build'])
    && lines(/^refund:/).every((x) => /The invoice now reads Refunded/.test(x.body)) && mail.length === 2 && mail.every((x) => !/in full/.test(x.html)) && history().every((e) => e.detail.full === false), JSON.stringify(heads));
}

// ═══ 3. what was never counted never comes off ═══
{
  // they paid $1,200.00 for a $1,000.00 invoice, and the studio sends the $200.00 back
  seed([invoice(1)]);
  db.tables.presence_plan_notices.push({ id: id('66666666', 1), site_id: STUDIO.id, client_id: STUDIO.client_id, kind: 'invoice_void_paid', period: `payamount:${INV(1)}:pi_test1aaaa`, status: 'active', headline: 'Paid too much, refund the difference: Website build', body: '' });
  stripe.charges.ch_test1aaaa = charge(1, { amount: 120000, amount_captured: 120000, amount_refunded: 20000 });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 20000)];
  await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('overpaid, the extra refunded: the invoice stays Paid with nothing refunded, nothing comes off revenue', inv(1).refunded_cents === 0 && stateOf(1) === 'paid' && returns()[0].counted_cents === 0);
  ok('overpaid, the extra refunded: the "refund the difference" line goes, and the studio is told the extra went back', notices().find((x) => x.period.startsWith('payamount:')).status === 'dismissed' && /^Refunded what they overpaid: Website build \(\$200\.00\)$/.test(lines(/^refund:/)[0].headline));
  // a later full refund of the rest counts the invoice's whole amount
  stripe.charges.ch_test1aaaa = charge(1, { amount: 120000, amount_captured: 120000, amount_refunded: 120000, refunded: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 20000), refund(1, 2, 100000)];
  await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('…then the rest refunded: the invoice’s whole amount comes off, never the overpayment', inv(1).refunded_cents === 100000 && stateOf(1) === 'refunded' && returns().find((r) => r.stripe_id === 're_test12aaa').counted_cents === 100000);

  // paid twice: the second payment refunded
  seed([invoice(2, { paid_ref: 'pi_test1aaaa' })]);
  db.tables.presence_plan_notices.push({ id: id('66666666', 2), site_id: STUDIO.id, client_id: STUDIO.client_id, kind: 'invoice_void_paid', period: `paidtwice:${INV(2)}:pi_test2aaaa`, status: 'active', headline: 'Paid twice, refund one', body: '' });
  stripe.charges.ch_test2aaaa = charge(2, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test2aaaa = [refund(2, 1, 100000)];
  stripe.intents.pi_test2aaaa = { id: 'pi_test2aaaa', object: 'payment_intent', metadata: { presence_invoice_id: INV(2), kind: 'service_invoice' } };
  await stripeEvent('charge.refunded', stripe.charges.ch_test2aaaa);
  ok('paid twice, one refunded: the invoice stays Paid in full, nothing comes off', inv(2).refunded_cents === 0 && stateOf(2) === 'paid' && returns()[0].applies_to === 'extra' && returns()[0].counted_cents === 0);
  ok('paid twice, one refunded: "Paid twice, refund one" goes, and the line says the invoice stays paid', notices().find((x) => x.period.startsWith('paidtwice:')).status === 'dismissed' && /^Refunded an extra payment: Website build \(\$1,000\.00\)$/.test(lines(/^refund:/)[0].headline) && /The invoice stays paid/.test(lines(/^refund:/)[0].body));
  ok('paid twice, one refunded: the client is told which payment went back', mail.length === 1 && /refunded your extra payment of <strong>\$1,000\.00<\/strong>/.test(mail[0].html));

  // money on a withdrawn invoice, refunded
  seed([invoice(3, { status: 'void', paid_ref: null, paid_at: null })]);
  db.tables.presence_plan_notices.push({ id: id('66666666', 3), site_id: STUDIO.id, client_id: STUDIO.client_id, kind: 'invoice_void_paid', period: `voidpaid:${INV(3)}`, status: 'active', headline: 'Payment received on a withdrawn invoice', body: '' });
  stripe.charges.ch_test3aaaa = charge(3, { amount_refunded: 100000, refunded: true, metadata: { presence_invoice_id: INV(3) } });
  stripe.refunds.ch_test3aaaa = [refund(3, 1, 100000)];
  await stripeEvent('charge.refunded', stripe.charges.ch_test3aaaa);
  ok('money on a withdrawn invoice, refunded: it stays withdrawn, its line goes, nothing comes off', inv(3).status === 'void' && inv(3).refunded_cents === 0 && returns()[0].applies_to === 'void' && notices().find((x) => x.period.startsWith('voidpaid:')).status === 'dismissed');
}

// ═══ 4. an invoice paid before Stripe's payment was remembered (before Nov 12) ═══
{
  seed([invoice(4, { paid_ref: null })]);
  stripe.charges.ch_test4aaaa = charge(4, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test4aaaa = [refund(4, 1, 100000)];
  stripe.intents.pi_test4aaaa = { id: 'pi_test4aaaa', object: 'payment_intent', metadata: { presence_invoice_id: INV(4), kind: 'service_invoice' } };
  await stripeEvent('charge.refunded', stripe.charges.ch_test4aaaa);
  ok('an older invoice: found through the payment’s own note, refunded, and the payment remembered from now on', stateOf(4) === 'refunded' && inv(4).paid_ref === 'pi_test4aaaa' && returns()[0].applies_to === 'invoice');
}

// ═══ 5. a retainer charge refunded ═══
{
  seed([]);
  db.tables.presence_deal_events.push({ id: id('77777777', 1), site_id: STUDIO.id, deal_id: DEAL, kind: 'invoice_paid', actor: 'stripe', actor_kind: 'system', detail: { retainer: true, amount_cents: 50000, interval: 'month', stripe_invoice: 'in_test5aaaa' }, created_at: '2026-11-01T10:00:00Z' });
  stripe.charges.ch_test5aaaa = charge(5, { amount: 50000, amount_captured: 50000, amount_refunded: 50000, refunded: true });
  stripe.refunds.ch_test5aaaa = [refund(5, 1, 50000)];
  stripe.intents.pi_test5aaaa = { id: 'pi_test5aaaa', object: 'payment_intent', metadata: {} };
  stripe.invoicePayments.pi_test5aaaa = 'in_test5aaaa';
  await stripeEvent('charge.refunded', stripe.charges.ch_test5aaaa);
  const r = returns()[0];
  ok('a retainer charge: found through Stripe’s invoice, recorded on the deal and counted', !!r && r.applies_to === 'retainer' && r.deal_id === DEAL && r.stripe_invoice === 'in_test5aaaa' && r.counted_cents === 50000);
  ok('a retainer charge: the studio’s line and the client’s email', /^Refunded \$500\.00: Retainer: Harbor website$/.test(lines(/^refund:/)[0]?.headline || '') && mail.length === 1 && /refunded your payment of <strong>\$500\.00<\/strong> for your retainer charge in full\./.test(mail[0].html), JSON.stringify(lines(/^refund:/)[0]));
  const rows = returnedPayments([r]);
  const rev = revenueByMonth([], '2026-11-20T00:00:00Z', [{ amount_cents: 50000, paid_at: '2026-11-01T10:00:00Z' }], rows);
  ok('a retainer charge refunded: revenue takes it off the month it happened, the retainer part too', rev.months[11].this_year === 0 && rev.months[11].retainer === 0 && rev.months[11].returned === 50000 && rev.returned_this_year === 50000);
}

// ═══ 6. not Studio OS's own payment, and Stripe or the database not answering ═══
{
  seed();
  stripe.charges.ch_test9aaaa = charge(9, { amount_refunded: 4900, refunded: true, payment_intent: 'pi_test9aaaa' });
  stripe.refunds.ch_test9aaaa = [refund(9, 1, 4900)];
  stripe.intents.pi_test9aaaa = { id: 'pi_test9aaaa', object: 'payment_intent', metadata: { order_id: 'audit-1' } };
  const res = await stripeEvent('charge.refunded', stripe.charges.ch_test9aaaa);
  ok('a charge that isn’t Studio OS’s (an audit order): acknowledged, nothing recorded, nobody told', res.status === 200 && returns().length === 0 && notices().length === 0 && mail.length === 0);

  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 100000)];
  stripe.down = true;
  const down = await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa, { id: 'evt_126_retry' });
  ok('Stripe not answering: the webhook answers 500 so Stripe sends it again, and nothing half-happens', down.status === 500 && returns().length === 0 && inv(1).refunded_cents === 0 && mail.length === 0);
  stripe.down = false;
  const back = await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa, { id: 'evt_126_retry' });
  ok('…and when Stripe sends the same event again, it lands', back.status === 200 && stateOf(1) === 'refunded' && mail.length === 1);

  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 100000, refunded: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 100000)];
  db.fail.add('presence_money_returns');
  const noTable = await stripeEvent('charge.refunded', stripe.charges.ch_test1aaaa);
  ok('before the database step (no table for it yet): 500, so Stripe keeps it until it can land', noTable.status === 500 && inv(1).refunded_cents === 0 && mail.length === 0);
  db.fail.delete('presence_money_returns');
}

// ═══ 7. a dispute: opened, answered, won ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { disputed: true });
  stripe.disputes.du_test1aaaa = dispute(1);
  const res = await stripeEvent('charge.dispute.created', stripe.disputes.du_test1aaaa);
  const due = CR.dueDay(new Date(DUE * 1000).toISOString());
  ok('dispute opened: the invoice reads Disputed, and its bucket counts nothing while Stripe holds the money', res.status === 200 && inv(1).dispute_status === 'open' && stateOf(1) === 'disputed' && moneyBuckets([inv(1)], TODAY).paid.cents === 0);
  const ln = lines(/^dispute:/)[0];
  ok('dispute opened: a Needs you line with Stripe’s deadline, the money and the fee taken, and what to do', !!ln && ln.kind === 'invoice_void_paid' && noticeTier(ln.kind) === 'needs_you' && ln.status === 'active'
    && ln.headline === `Disputed: Website build ($1,000.00). Answer by ${due}` && /Marcus Bell’s card company is asking for the money back: they say the work wasn’t delivered\. Stripe has taken \$1,000\.00 and a \$15\.00 fee/.test(ln.body) && /download your proof, then answer in Stripe by /.test(ln.body), JSON.stringify(ln));
  ok('dispute opened: the line opens the deal’s Billing', noticeHrefFor(ln) === `/pipeline.html?deal=${DEAL}&dtab=billing`);
  const om = mail.find((x) => x.to === 'owner@studio.example');
  ok('dispute opened: the studio gets an email with the way to answer it in Stripe, and the client gets nothing', !!om && om.subject === ln.headline && om.html.includes('https://dashboard.stripe.com/test/disputes/du_test1aaaa') && !mail.some((x) => x.to === 'marcus@client.example'));
  const r = returns()[0];
  ok('dispute opened: recorded with its deadline and fee, nothing counted yet', r.kind === 'dispute' && r.status === 'open' && r.fee_cents === 1500 && Date.parse(r.due_by) === DUE * 1000 && r.counted_cents === 0);
  const deal = await CR.returnsForDeal(STUDIO.id, DEAL);
  ok('the deal’s page gets the dispute with where to answer it', deal.length === 1 && deal[0].answer_url === 'https://dashboard.stripe.com/test/disputes/du_test1aaaa' && deal[0].invoice_id === INV(1) && !('stripe_id' in deal[0]));
  // evidence sent: an update, nobody told again
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'under_review', evidence_details: { due_by: DUE, has_evidence: true, past_due: false, submission_count: 1 } });
  const before = notices().length, mails = mail.length;
  await stripeEvent('charge.dispute.updated', stripe.disputes.du_test1aaaa);
  ok('evidence sent: still Disputed, nobody told again', stateOf(1) === 'disputed' && notices().length === before && mail.length === mails);
  // won: the money comes back
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'won', balance_transactions: [{ amount: -100000, fee: 1500 }, { amount: 100000, fee: 0 }] });
  await stripeEvent('charge.dispute.closed', stripe.disputes.du_test1aaaa);
  ok('won: Paid again, the open line goes, and an update says the money stays', stateOf(1) === 'paid' && inv(1).dispute_status === 'won' && ln.status === 'dismissed' && lines(/^disputewon:/)[0]?.headline === 'Dispute won: Website build ($1,000.00)' && /Stripe kept its \$15\.00 dispute fee/.test(lines(/^disputewon:/)[0]?.body || ''));
  ok('won: nothing comes off revenue', returns()[0].status === 'won' && returns()[0].counted_cents === 0 && returnedPayments(returns()).length === 0);
  await stripeEvent('charge.dispute.funds_reinstated', stripe.disputes.du_test1aaaa);
  ok('the money given back: no second line', lines(/^disputewon:/).length === 1);
  ok('the deal’s history: opened, then won', history().map((e) => e.detail.dispute).join(',') === 'opened,won');
}

// ═══ 8. a dispute lost, and appealed ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { disputed: true });
  stripe.disputes.du_test1aaaa = dispute(1);
  await stripeEvent('charge.dispute.created', stripe.disputes.du_test1aaaa);
  const t0 = Date.now();
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'lost' });
  await stripeEvent('charge.dispute.closed', stripe.disputes.du_test1aaaa);
  const r = returns()[0];
  ok('lost: the invoice reads Dispute lost, and the money counts as gone the day it closed', stateOf(1) === 'lost' && r.status === 'lost' && r.counted_cents === 100000 && Date.parse(r.counted_at) >= t0 - 1000 && returnedPayments([r]).length === 1);
  const ll = lines(/^disputelost:/)[0];
  ok('lost: a Needs you line, with the money and the fee gone, and what to do next', !!ll && ll.kind === 'invoice_void_paid' && ll.headline === 'Dispute lost: Website build ($1,000.00)' && /\$1,000\.00 went back to Marcus Bell and Stripe kept its \$15\.00 fee/.test(ll.body) && /raise a new invoice from the deal/.test(ll.body) && lines(/^dispute:/)[0].status === 'dismissed', JSON.stringify(ll));
  const fees = disputeFees([r]);
  ok('lost: Stripe’s fee is there for the bookkeeper, on the day it was taken', fees.length === 1 && fees[0].amount_cents === 1500 && fees[0].paid_at === new Date(T0 * 1000).toISOString());
  // appealed and won after all
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'appeal_needs_response' });
  await stripeEvent('charge.dispute.updated', stripe.disputes.du_test1aaaa);
  ok('an appeal reopens it: Disputed again, nothing counted, a fresh Needs you line', stateOf(1) === 'disputed' && returns()[0].counted_cents === 0 && lines(/^dispute:.*:again$/)[0]?.status === 'active');
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'won' });
  await stripeEvent('charge.dispute.closed', stripe.disputes.du_test1aaaa);
  ok('…won on appeal: Paid, the lost line and the appeal line go, an update says so', stateOf(1) === 'paid' && lines(/^disputelost:/)[0].status === 'dismissed' && lines(/^dispute:.*:again$/)[0].status === 'dismissed' && lines(/^disputewon:/).length === 1);
}

// ═══ 9. a bank payment disputed, and a card company's question ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { disputed: true, id: 'py_test1aaaa', payment_method_details: { type: 'us_bank_account' } });
  stripe.charges.py_test1aaaa = stripe.charges.ch_test1aaaa;
  stripe.disputes.du_test1aaaa = dispute(1, { charge: 'py_test1aaaa', reason: 'debit_not_authorized', status: 'needs_response', payment_method_details: null });
  await stripeEvent('charge.dispute.created', stripe.disputes.du_test1aaaa);
  const ln = lines(/^dispute:/)[0];
  ok('a bank payment disputed: the line says it can’t be fought and what to do instead, with no deadline', !!ln && ln.headline === 'Bank payment disputed: Website build ($1,000.00)' && /Bank payment disputes are final, so there’s nothing to answer in Stripe/.test(ln.body) && returns()[0].due_by === null && returns()[0].method === 'bank', JSON.stringify(ln));
  const deal = await CR.returnsForDeal(STUDIO.id, DEAL);
  ok('a bank payment disputed: the deal offers no way to answer it', deal[0].bank === true && deal[0].answer_url === null);
  ok('a bank payment disputed: the studio’s email has no "answer it in Stripe" link', mail.some((x) => x.to === 'owner@studio.example' && !x.html.includes('dashboard.stripe.com')));

  seed();
  stripe.charges.ch_test1aaaa = charge(1);
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'warning_needs_response', reason: 'general', balance_transactions: [] });
  await stripeEvent('charge.dispute.created', stripe.disputes.du_test1aaaa);
  const q = lines(/^dispute:/)[0];
  ok('a card company’s question: no money has moved, it says so, with the deadline', /^A card company is asking about \$1,000\.00: Website build\. Answer by /.test(q?.headline || '') && /No money has moved yet/.test(q?.body || '') && stateOf(1) === 'disputed', JSON.stringify(q));
  stripe.disputes.du_test1aaaa = dispute(1, { status: 'warning_closed', reason: 'general', balance_transactions: [] });
  await stripeEvent('charge.dispute.closed', stripe.disputes.du_test1aaaa);
  ok('the question closed: Paid, the line goes, an update says nothing moved', stateOf(1) === 'paid' && q.status === 'dismissed' && lines(/^disputewon:/)[0]?.headline === 'Question closed: Website build ($1,000.00)');
}

// ═══ 10. the daily check's door (sales item 130) ═══
{
  seed();
  stripe.charges.ch_test1aaaa = charge(1, { amount_refunded: 30000, disputed: true });
  stripe.refunds.ch_test1aaaa = [refund(1, 1, 30000)];
  stripe.disputes.du_test1aaaa = dispute(1, { amount: 70000 });
  const a = await quietly(() => CR.syncCharge('ch_test1aaaa'));
  ok('syncCharge: one call records the refund and the dispute on a charge, and says which invoice', a.ok === true && a.found === 'invoice' && a.invoice_id === INV(1) && a.changed === true && inv(1).refunded_cents === 30000 && inv(1).dispute_status === 'open' && returns().length === 2);
  const n = { mail: mail.length, notices: notices().length };
  const b = await quietly(() => CR.syncCharge('ch_test1aaaa'));
  ok('syncCharge again: nothing changed, nothing recorded, nobody told twice', b.ok === true && b.changed === false && mail.length === n.mail && notices().length === n.notices);
  stripe.down = true;
  const c = await quietly(() => CR.syncCharge('ch_test1aaaa'));
  ok('syncCharge with Stripe down: ok is false, never a throw', c.ok === false);
  stripe.down = false;
  const d = await quietly(() => CR.syncChargeRefunds('not a charge'));
  ok('a junk id: nothing read, nothing written', d.ok === true && d.found === 'none' && stripe.calls.filter((x) => x.path.includes('not')).length === 0);
}

// ═══ 11. the money reports take it off the month it happened ═══
{
  const returned = returnedPayments([
    { kind: 'refund', applies_to: 'invoice', counted_cents: 20000, counted_at: '2026-11-16T16:00:00Z', invoice_id: INV(1) },
    { kind: 'dispute', applies_to: 'invoice', counted_cents: 100000, counted_at: '2026-10-05T16:00:00Z', invoice_id: INV(2), method: 'bank' },
    { kind: 'refund', applies_to: 'extra', counted_cents: 0, counted_at: '2026-11-16T16:00:00Z' },        // an extra payment: never counted
    { kind: 'refund', applies_to: 'invoice', counted_cents: 0, counted_at: '2026-11-16T16:00:00Z' },      // a failed refund
  ]);
  ok('only what was counted comes off', returned.length === 2 && returned[1].bank === true);
  const rev = revenueByMonth([{ amount_cents: 100000, paid_at: '2026-11-02T10:00:00Z' }, { amount_cents: 100000, paid_at: '2026-10-01T10:00:00Z' }], '2026-11-20T00:00:00Z', [], returned);
  ok('revenue by month: each comes off its own month, and the year says how much went back', rev.months[11].this_year === 80000 && rev.months[10].this_year === 0 && rev.months[11].returned === 20000 && rev.returned_this_year === 120000 && rev.total_this_year === 80000);
  const P = { from: '2026-11-01', to: '2026-11-30' };
  const items = [{ id: INV(1), number: 13, title: 'Website build', amount_cents: 100000, status: 'paid', paid_at: '2026-11-02T10:00:00Z', paid_method: '', deal_title: 'Harbor website', business: 'Harbor Dental' }];
  const back = [
    { kind: 'refund', amount_cents: 20000, at: '2026-11-16T16:00:00Z', customer: 'Harbor Dental', invoice_no: '0013', what: 'Harbor website' },
    { kind: 'fee', amount_cents: 1500, at: '2026-11-10T16:00:00Z', customer: 'Harbor Dental', invoice_no: '0013', what: 'Harbor website' },
    { kind: 'dispute', amount_cents: 70000, at: '2026-12-02T16:00:00Z', customer: 'Harbor Dental', invoice_no: '0013', what: 'Harbor website', bank: true },   // outside the days
  ];
  const pay = paymentExportRows(items, [], P, 0, back);
  ok('the bookkeeper file: each refund and fee is its own row with a minus amount, on its day, in order', JSON.stringify(pay.rows.map((r) => [r[0], r[2], r[3], r[4], r[5]])) === JSON.stringify([
    ['11/02/2026', '0013', 'Harbor website', 'Card or bank, through Stripe', '1000.00'],
    ['11/10/2026', '0013', 'Stripe dispute fee: Harbor website', 'Stripe fee', '-15.00'],
    ['11/16/2026', '0013', 'Refund: Harbor website', 'Refunded through Stripe', '-200.00'],
  ]), JSON.stringify(pay.rows));
  ok('the bookkeeper file: what came in and what went back are counted apart', pay.payments === 1 && pay.cents === 100000 && pay.returned === 2 && pay.returned_cents === 21500);
  const rm = exportReadMe(P, { invoices: 1, cents: 100000 }, pay, false);
  ok('the READ-ME says what the minus rows are', rm.includes('2 rows of money that went back, $215.00 in all: refunds made in Stripe, disputes lost and Stripe\'s dispute fees'));
  ok('a lost bank dispute says so in the file', paymentExportRows(items, [], { from: '2026-12-01', to: '2026-12-31' }, 0, back).rows[0]?.[4] === 'Bank dispute, through Stripe');
}

// ═══ 12. the pure rules ═══
{
  const c = (paid, counted, list, full) => [...CR.countedRefunds(paid, counted, list, full).values()];
  ok('counted: part refunds come off in full, never past what was counted', JSON.stringify(c(100000, 100000, [{ id: 'a', amount: 30000, live: true }, { id: 'b', amount: 90000, live: true }], false)) === '[30000,70000]');
  ok('counted: an overpayment goes back first and takes nothing off', JSON.stringify(c(120000, 100000, [{ id: 'a', amount: 15000, live: true }, { id: 'b', amount: 15000, live: true }], false)) === '[0,10000]');
  ok('counted: a short payment refunded in full takes off everything counted', JSON.stringify(c(80000, 100000, [{ id: 'a', amount: 80000, live: true }], true)) === '[100000]');
  ok('counted: a failed refund takes nothing, and the next one counts', JSON.stringify(c(100000, 100000, [{ id: 'a', amount: 40000, live: false }, { id: 'b', amount: 40000, live: true }], false)) === '[0,40000]');
  ok('dispute words: open, won (an inquiry closed and a prevented one too), lost', ['needs_response', 'under_review', 'warning_needs_response', 'appeal_under_review'].every((s) => CR.disputeOutcome(s) === 'open') && ['won', 'warning_closed', 'prevented'].every((s) => CR.disputeOutcome(s) === 'won') && CR.disputeOutcome('lost') === 'lost');
  ok('refund words: requires_action is on its way, failed and canceled never left', CR.refundStatus('requires_action') === 'pending' && CR.refundLive('pending') && !CR.refundLive(CR.refundStatus('canceled')));
  ok('a deadline names its year only when it isn’t this one', CR.dueDay('2026-11-30T23:59:59Z', '2026-11-16T00:00:00Z') === 'Nov 30' && CR.dueDay('2026-01-04T00:00:00Z', '2025-12-28T00:00:00Z') === 'Jan 4, 2026');
  ok('a lost dispute never takes off more than was counted and not refunded', CR.disputeCounted(100000, 100000, 30000) === 70000 && CR.disputeCounted(50000, 100000, 0) === 50000);
  ok('a line with no deal still has a home', noticeHrefFor({ kind: 'invoice_void_paid', period: CR.returnPeriod('dispute', null, 'du_x12345') }) === '/pipeline.html');
}

// ═══ 13. the proof for a dispute, in one download ═══
{
  const { handleDisputeProof } = await import(`${P}/routes/dispute_proof.ts`);
  const { moneyBackLine } = await import(`${P}/crm/deal_activity.ts`);
  const unzip = (buf) => { const u = new Uint8Array(buf), dv = new DataView(u.buffer), out = {}; let o = 0; while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) { const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true); const name = new TextDecoder().decode(u.slice(o + 30, o + 30 + nl)); out[name] = u.slice(o + 30 + nl + xl, o + 30 + nl + xl + size); o += 30 + nl + xl + size; } return out; };
  const OTHER = { id: id('99999999', 1), client_id: id('99999999', 2) };
  seed();
  db.tables.presence_contracts = [{ id: id('88888888', 1), site_id: STUDIO.id, deal_id: DEAL, title: 'Service agreement', body: 'The studio builds the website. The client pays the invoice.', content_hash: 'abc123', status: 'signed', signer_name: 'Marcus Bell', signer_email: 'marcus@client.example', signed_at: '2026-10-21T16:00:00Z', signed_evidence: { ip: '203.0.113.7', user_agent: 'Test browser' }, sent_at: '2026-10-20T16:00:00Z', created_at: '2026-10-20T15:00:00Z', deleted_at: null }];
  db.tables.presence_proposals = [{ id: id('88888888', 2), site_id: STUDIO.id, deal_id: DEAL, title: 'Website proposal', line_items: [{ label: 'Website build', qty: 1, unit_cents: 100000 }], subtotal_cents: 100000, currency: 'usd', terms: '', status: 'accepted', sent_at: '2026-10-19T16:00:00Z', decided_at: '2026-10-20T16:00:00Z', deleted_at: null }];
  db.tables.presence_deal_events = [
    { id: id('77777777', 2), site_id: STUDIO.id, deal_id: DEAL, kind: 'contract_signed', detail: { signer: 'Marcus Bell' }, created_at: '2026-10-21T16:00:00Z' },
    { id: id('77777777', 3), site_id: STUDIO.id, deal_id: DEAL, kind: 'invoice_paid', detail: { invoice_id: INV(1), amount_cents: 100000, purpose: 'service' }, created_at: '2026-11-02T10:00:00Z' },
    { id: id('77777777', 4), site_id: STUDIO.id, deal_id: DEAL, kind: 'payment_undone', detail: { dispute: 'opened', amount_cents: 100000 }, created_at: '2026-11-16T15:00:00Z' },
  ];
  db.tables.presence_projects = [{ id: id('56565656', 1), site_id: STUDIO.id, deal_id: DEAL, name: 'Harbor website build', deleted_at: null, created_at: '2026-10-22T10:00:00Z' }];
  db.tables.presence_project_events = [
    { id: id('57575757', 1), project_id: id('56565656', 1), site_id: STUDIO.id, kind: 'milestone_completed', detail: { title: 'Homepage design' }, created_at: '2026-10-28T10:00:00Z' },
    { id: id('57575757', 2), project_id: id('56565656', 1), site_id: STUDIO.id, kind: 'approval_decided', detail: { title: 'Final site', decision: 'approved' }, created_at: '2026-11-01T10:00:00Z' },
  ];
  db.tables.presence_money_returns = [
    { id: id('12121212', 1), site_id: STUDIO.id, invoice_id: INV(1), deal_id: DEAL, kind: 'dispute', applies_to: 'invoice', stripe_id: 'du_test1aaaa', amount_cents: 100000, due_by: new Date(DUE * 1000).toISOString(), status: 'open' },
    { id: id('12121212', 2), site_id: OTHER.id, invoice_id: null, deal_id: null, kind: 'dispute', applies_to: 'invoice', stripe_id: 'du_other1aa', amount_cents: 5000, status: 'open' },
  ];
  const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.example', jwt: 'jwt', requestId: 't' };
  const res = await quietly(() => handleDisputeProof(new Request('https://x'), { id: STUDIO.id, client_id: STUDIO.client_id }, owner, id('12121212', 1), {}));
  const files = res.status === 200 ? unzip(await res.arrayBuffer()) : {};
  const names = Object.keys(files);
  ok('the proof: one zip, named for the deal', res.status === 200 && res.headers.get('Content-Type') === 'application/zip' && /filename="dispute-proof-harbor-website\.zip"/.test(res.headers.get('Content-Disposition') || ''), `${res.status} ${names.join(', ')}`);
  ok('the proof: the signed agreement, the accepted proposal and the paid invoice (its receipt) as PDFs, the history and a READ-ME', names[0] === 'READ-ME.txt' && names.some((n) => /^Signed-agreement.*\.pdf$/.test(n)) && names.some((n) => /^Proposal.*\.pdf$/.test(n)) && names.some((n) => /^Receipt.*\.pdf$/.test(n)) && names.includes('history.txt')
    && names.filter((n) => n.endsWith('.pdf')).every((n) => new TextDecoder().decode(files[n].slice(0, 5)) === '%PDF-'), names.join(', '));
  const readMe = new TextDecoder().decode(files['READ-ME.txt'] || new Uint8Array());
  const hist = new TextDecoder().decode(files['history.txt'] || new Uint8Array());
  ok('the proof: the READ-ME names the deadline and where each file goes in Stripe', readMe.includes('Proof for the disputed payment: Website build ($1,000.00)') && readMe.includes('Answer in Stripe by November 30, 2026.') && /The signed agreement: under the customer's signature/.test(readMe) && /The receipt: under receipt/.test(readMe), readMe);
  ok('the proof: the history, oldest first, from the signature to the payment and the dispute', /2026-10-21 16:00 UTC {2}Agreement signed — Marcus Bell[\s\S]*2026-11-02 10:00 UTC {2}Invoice paid — \$1,000[\s\S]*Payment disputed — \$1,000/.test(hist), hist);
  ok('the proof: then the project’s own history, the work delivered and approved', /The project: Harbor website build, oldest first\r\n\r\n2026-10-28 10:00 UTC {2}A milestone was completed: Homepage design\r\n2026-11-01 10:00 UTC {2}An approval was decided: Final site \(approved\)/.test(hist), hist);
  const theirs = await quietly(() => handleDisputeProof(new Request('https://x'), { id: STUDIO.id, client_id: STUDIO.client_id }, owner, id('12121212', 2), {}));
  ok('the proof: another studio’s dispute is not there', theirs.status === 404);
  const designer = await quietly(() => handleDisputeProof(new Request('https://x'), { id: STUDIO.id, client_id: STUDIO.client_id }, { ...owner, member: { role: 'designer' } }, id('12121212', 1), {}));
  ok('the proof: a seat that may not download everything is refused, in words', designer.status === 403 && /for the studio’s owner/.test((await designer.json()).message || ''));
  ok('the deal’s history reads each money-back line in words', moneyBackLine({ refund: true, full: true, amount_cents: 100000 }) === 'Refunded in full — $1,000' && moneyBackLine({ refund: true, applies_to: 'extra', amount_cents: 2500 }) === 'Extra payment refunded — $25'
    && moneyBackLine({ dispute: 'opened', bank: true, amount_cents: 30000 }) === 'Bank payment disputed — $300' && moneyBackLine({ dispute: 'lost', amount_cents: 30000 }) === 'Dispute lost — $300' && moneyBackLine({ dispute: 'closed' }) === 'Card company’s question closed' && moneyBackLine({ amount_cents: 5000 }) === 'Payment undone — $50');
}

const failed = results.filter((r) => !r.p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
