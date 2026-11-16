// ── Sales item 130: a daily check against Stripe catches what a lost message missed ──
//   deno run --allow-read --allow-env --allow-net tests/presence/stripe_daily_check_130_test.mjs
//
// The Nov 15 2026 Stripe review (finding 4): Stripe tells Studio OS about payments and
// retainers with messages, retries for three days, and then gives up; nothing ever asked
// Stripe again. A paid invoice stayed unpaid (its reminders kept asking a client who had
// paid), a retainer stayed waiting or missed a charge, an old message arriving late could
// set a live retainer back to "waiting for you to approve", and a receipt that didn't go
// out was never sent. This drives the real check, the real retainer sync, the real paid
// echo and the real signed webhook against a pretend database, Stripe and mail service.
// Every name, number and address is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

const HOOK_SECRET = 'whsec_test_fake_130';
const SYNC_SECRET = 'test-commerce-secret-130';
Deno.env.set('STRIPE_SECRET', 'sk_test_fake_130');
Deno.env.set('STRIPE_WEBHOOK_SECRET', HOOK_SECRET);
Deno.env.set('BILLING_SYNC_SECRET', SYNC_SECRET);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
const db = installFakePostgrest({ unique: { presence_plan_notices: [['client_id', 'kind', 'period']], presence_stripe_checks: [['subject']], stripe_webhook_events: [['event_id']] } });

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

const P = '../../supabase/functions/presence';
const { runStripeCheck, dueSubjects, retainerDrift, settlingPayment, retainerCheckable, RECHECK_MS } = await import(`${P}/commerce/stripe_check.ts`);
const { applyRetainerSync, mergeRetainerState, retainerStatusNow } = await import(`${P}/commerce/retainers.ts`);
const { handleCommerce, invoicePaidEcho } = await import(`${P}/routes/commerce.ts`);
const { sweepIssues } = await import(`${P}/routes/system.ts`);

// ═══ the pretend Stripe and mail; the webhook's hop to billing-sync runs the real route ═══
const world = { stripe: [], mail: [], subs: {}, pis: {}, subInvoices: {}, linkSessions: {}, down: new Set() };
const PUBLIC = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const fakeDb = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const path = u.pathname.replace('/v1/', '');
    world.stripe.push(`${method} ${path}`);
    const kind = path.split('/')[0];
    if (world.down.has(kind)) return jres(500, { error: { message: 'Stripe is having a moment' } });
    if (method !== 'GET') return jres(400, { error: { message: `the daily check only reads; it sent ${method} ${path}` } });
    if (path === 'payment_intents/search') {
      const m = /metadata\['presence_invoice_id'\]:'([^']+)'/.exec(u.searchParams.get('query') || '');
      return jres(200, { object: 'search_result', data: (m && world.pis[m[1]]) || [] });
    }
    if (path.startsWith('subscriptions/')) { const s = world.subs[path.split('/')[1]]; return s ? jres(200, s) : jres(404, { error: { message: 'No such subscription', code: 'resource_missing' } }); }
    if (path === 'invoices') return jres(200, { object: 'list', data: world.subInvoices[u.searchParams.get('subscription')] || [] });
    if (path === 'checkout/sessions') return jres(200, { object: 'list', data: world.linkSessions[u.searchParams.get('payment_link')] || [] });
    return jres(404, { error: { message: 'unplanned Stripe read' } });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); world.mail.push({ to: String(b.to), subject: String(b.subject), html: String(b.html) }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/functions/v1/presence/commerce/billing-sync') return handleCommerce(new Request('https://x/commerce/billing-sync', { method: 'POST', headers: init.headers, body: init.body }), '/commerce/billing-sync', 'POST', PUBLIC, {});
  if (u.pathname === '/functions/v1/presence/commerce/invoice-paid') return handleCommerce(new Request('https://x/commerce/invoice-paid', { method: 'POST', headers: init.headers, body: init.body }), '/commerce/invoice-paid', 'POST', PUBLIC, {});
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, true);
  return fakeDb(input, init);
};
// the signed webhook, its handler caught instead of a port opened
let hook = null;
{ const realServe = Deno.serve; Deno.serve = (h) => { hook = h; return {}; }; await import('../../supabase/functions/stripe-webhook/index.ts'); Deno.serve = realServe; }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
let evt = 0;
async function stripeEvent(type, object) {
  const raw = JSON.stringify({ id: `evt_130_${++evt}`, object: 'event', api_version: '2026-05-27.dahlia', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  return quiet(() => hook(new Request('https://x/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })));
}

// ═══ the fake world ═══
const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const DEAL2 = '33333333-3333-4333-8333-333333333334';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const INV = '55555555-5555-4555-8555-555555555555';
const INV2 = '55555555-5555-4555-8555-555555555556';
const META = { purpose: 'service_retainer', kind: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id };
const NOW = Date.parse('2026-11-16T12:00:00Z');
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const PERIOD_END = sec('2026-12-15T00:00:00Z');
const retainer = (over = {}) => ({ status: 'active', amount_cents: 50000, interval: 'month', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', stripe_payment_link_id: 'plink_r', checkout_url: 'https://pay.example/r', current_period_end: new Date(PERIOD_END * 1000).toISOString(), created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-11-15T00:00:00.000Z', canceled_at: null, ...over });
const sub = (over = {}) => ({ id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', metadata: META, items: { object: 'list', data: [{ id: 'si_1', current_period_end: PERIOD_END }] }, ...over });
const openInvoice = (over = {}) => ({ id: INV, site_id: STUDIO.id, deal_id: DEAL, title: 'Deposit', description: 'Deposit', amount_cents: 120000, currency: 'usd', purpose: 'deposit', status: 'open', stripe_url: 'https://pay.example/i', stripe_payment_link_id: 'plink_i', link_gen: 0, paid_at: null, paid_ref: null, paid_method: null, processing_since: null, payment_for: null, receipt_sent_at: null, stripe_checked_at: null, deleted_at: null, created_at: '2026-11-01T00:00:00Z', ...over });
const payment = (over = {}) => ({ id: 'pi_1', object: 'payment_intent', status: 'succeeded', amount: 120000, amount_received: 120000, currency: 'usd', created: sec('2026-11-10T15:30:00Z'), metadata: { presence_invoice_id: INV, kind: 'service_invoice' }, ...over });
function seed(o = {}) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }],
    presence_deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Website care', stage: 'contract', contact_id: CONTACT, converted_client_id: null, retainer: o.retainer === undefined ? null : o.retainer, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }, ...(o.deals || [])],
    presence_contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Jordan Ellis', email: o.noEmail ? '' : 'jordan@client.example' }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_invoices: o.invoices || [],
    presence_deal_events: [], presence_plan_notices: o.notices || [], presence_stripe_checks: o.checks || [], stripe_webhook_events: [],
    presence_contracts: [{ id: '66666666-6666-4666-8666-666666666666', site_id: STUDIO.id, deal_id: DEAL, status: 'signed', deleted_at: null }],
  });
  Object.assign(world, { stripe: [], mail: [], subs: o.subs || {}, pis: o.pis || {}, subInvoices: o.subInvoices || {}, linkSessions: o.linkSessions || {}, down: new Set(o.down || []) });
}
const check = (at = NOW, limits) => quiet(() => runStripeCheck(limits, at));
const deal = () => db.tables.presence_deals[0];
const inv = (id = INV) => db.tables.presence_invoices.find((x) => x.id === id);
const notices = (pred) => db.tables.presence_plan_notices.filter(pred);
const charges = () => db.tables.presence_deal_events.filter((e) => e.kind === 'invoice_paid' && e.detail?.retainer === true);
const noBareFalse = (r) => Object.values(r).every((v) => v !== false);

// ═══ 1. the rules, on their own ═══
{
  const at = (h) => NOW - h * 3600_000;
  const checked = new Map([['a', at(30)], ['b', at(2)], ['c', at(21)]]);
  ok('rules: never asked comes first, then the longest ago; asked in the last 20 hours waits', JSON.stringify(dueSubjects(['b', 'c', 'a', 'new'], checked, 5, NOW)) === JSON.stringify(['new', 'a', 'c']));
  ok('rules: at most the few a tick allows', dueSubjects(['x', 'y', 'z'], new Map(), 2, NOW).length === 2 && RECHECK_MS === 20 * 3600_000);
  ok('rules: the first payment Stripe took settles the invoice; another invoice\'s, or a failed one, never does',
    settlingPayment(INV, [payment({ id: 'pi_late', created: 20 }), payment({ id: 'pi_early', created: 10 }), payment({ id: 'pi_other', created: 5, metadata: { presence_invoice_id: INV2 } }), payment({ id: 'pi_failed', created: 1, status: 'requires_payment_method' })]).first?.id === 'pi_early'
    && settlingPayment(INV, [payment({ id: 'pi_late', created: 20 }), payment({ id: 'pi_early', created: 10 })]).extra.map((p) => p.id).join() === 'pi_late'
    && settlingPayment(INV, []).first === null);
  ok('rules: a retainer differs when Stripe says another state, or another next charge date', retainerDrift(retainer(), sub({ status: 'past_due' })) && retainerDrift(retainer(), sub({ items: { data: [{ current_period_end: PERIOD_END + 86400 }] } })) && !retainerDrift(retainer(), sub()));
  ok('rules: Stripe\'s before-the-first-charge state is never drift for a live retainer', !retainerDrift(retainer(), sub({ status: 'incomplete' })));
  ok('rules: which retainers are asked about: waiting on a link, live, or ended in the last 40 days',
    retainerCheckable(retainer({ status: 'pending', stripe_subscription_id: null }), NOW) && retainerCheckable(retainer(), NOW) && retainerCheckable(retainer({ status: 'canceled', canceled_at: '2026-11-01T00:00:00Z' }), NOW)
    && !retainerCheckable(retainer({ status: 'canceled', canceled_at: '2026-09-01T00:00:00Z' }), NOW) && !retainerCheckable(retainer({ status: 'pending', stripe_payment_link_id: null, stripe_subscription_id: null }), NOW));
  ok('late: a live retainer never goes back to waiting for approval', mergeRetainerState(retainer(), { status: 'pending' }, 'x').status === 'active' && mergeRetainerState(retainer({ status: 'past_due' }), { status: 'pending' }, 'x').status === 'past_due' && mergeRetainerState(retainer({ status: 'pending' }), { status: 'active' }, 'x').status === 'active');
  ok('late: Stripe\'s word now decides a charge or a failure; the message decides only when Stripe can\'t be asked',
    retainerStatusNow('invoice.payment_failed', { status: 'active' }, 'past_due') === 'active' && retainerStatusNow('invoice.paid', { status: 'past_due' }, 'active') === 'past_due'
    && retainerStatusNow('invoice.payment_failed', null, 'past_due') === 'past_due' && retainerStatusNow('invoice.paid', { status: 'incomplete' }, 'active') === 'active' && retainerStatusNow('customer.subscription.deleted', { status: 'active' }, 'canceled') === 'canceled');
}

// ═══ 2. a late, older message never sets a retainer back ═══
{
  seed({ retainer: retainer(), subs: { sub_1: sub() } });
  const r1 = await stripeEvent('customer.subscription.updated', sub({ status: 'incomplete' }));
  ok('late: an old "incomplete" message arriving after approval leaves the retainer live', r1.status === 200 && deal().retainer.status === 'active', JSON.stringify(deal().retainer));
  seed({ retainer: retainer(), subs: {} });
  world.down.add('subscriptions');
  await stripeEvent('customer.subscription.updated', sub({ status: 'incomplete' }));
  ok('late: even with Stripe unreachable, that old message never sends a live retainer back to waiting', deal().retainer.status === 'active', JSON.stringify(deal().retainer));

  seed({ retainer: retainer(), subs: { sub_1: sub() } });
  const failedInvoice = { id: 'in_old', object: 'invoice', customer: 'cus_1', status: 'open', amount_paid: 0, amount_due: 50000, metadata: {}, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } } };
  await stripeEvent('invoice.payment_failed', failedInvoice);
  await settle();
  ok('late: a failure that arrives after the charge that put it right leaves it live, and says nothing', deal().retainer.status === 'active' && notices((n) => n.kind === 'retainer_status').length === 0 && world.mail.length === 0, JSON.stringify(deal().retainer));
  ok('late: Stripe was asked, and only asked', world.stripe.includes('GET subscriptions/sub_1') && world.stripe.every((c) => c.startsWith('GET ')));

  seed({ retainer: retainer({ status: 'past_due' }), subs: { sub_1: sub({ status: 'past_due' }) } });
  await stripeEvent('invoice.paid', { id: 'in_older', object: 'invoice', customer: 'cus_1', status: 'paid', amount_paid: 50000, status_transitions: { paid_at: sec('2026-10-15T10:00:00Z') }, metadata: {}, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } } });
  ok('late: an older charge arriving after a newer failure doesn\'t hide the failure, and still counts', deal().retainer.status === 'past_due' && charges().length === 1);

  seed({ retainer: retainer(), subs: {} });
  world.down.add('subscriptions');
  await stripeEvent('invoice.payment_failed', failedInvoice);
  ok('late: with Stripe unreachable the message is taken as sent (the daily check puts it right)', deal().retainer.status === 'past_due');

  seed({ retainer: retainer({ current_period_end: '2026-11-15T00:00:00.000Z' }), subs: { sub_1: sub() } });
  await stripeEvent('invoice.paid', { id: 'in_new', object: 'invoice', customer: 'cus_1', status: 'paid', amount_paid: 50000, status_transitions: { paid_at: sec('2026-11-15T10:00:00Z') }, metadata: {}, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } } });
  ok('late: a charge moves the next charge date to Stripe\'s', deal().retainer.current_period_end === new Date(PERIOD_END * 1000).toISOString(), String(deal().retainer.current_period_end));
}

// ═══ 3. an open invoice Stripe says is paid ═══
{
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment()] }, notices: [{ id: 'n0', site_id: STUDIO.id, client_id: STUDIO.client_id, kind: 'deal_followup', period: `invremind:${INV}`, status: 'active', headline: 'Still unpaid — Deposit ($1,200.00)', body: '' }] });
  const r = await check();
  await settle();
  const i = inv();
  ok('paid: the invoice is paid, on the day Stripe took it, and remembers which payment', i.status === 'paid' && i.paid_at === '2026-11-10T15:30:00.000Z' && i.paid_ref === 'pi_1' && r.invoices_paid === 1 && r.invoices_checked === 1, JSON.stringify({ r, i }));
  ok('paid: its "still unpaid" reminder comes down, so the client is asked no more', notices((n) => n.period === `invremind:${INV}`)[0]?.status === 'dismissed');
  const ev = db.tables.presence_deal_events.find((e) => e.kind === 'invoice_paid' && e.detail?.invoice_id === INV);
  ok('paid: the deal\'s history has the payment, dated when it was paid', !!ev && ev.created_at === '2026-11-10T15:30:00.000Z' && ev.detail.found_by === 'daily_check');
  ok('paid: the studio gets its line and email, as for any payment', notices((n) => n.kind === 'invoice_paid' && n.period === `paid:${INV}`).length === 1 && world.mail.some((m) => m.to === 'owner@studio.example' && /Deposit received/.test(m.subject)), JSON.stringify(world.mail.map((m) => `${m.to}: ${m.subject}`)));
  ok('paid: the client gets their receipt, once, and it is marked sent', world.mail.filter((m) => m.to === 'jordan@client.example').length === 1 && !!inv().receipt_sent_at);
  ok('paid: a signed deal\'s deposit moves it to Won, as a card payment does', deal().stage === 'won');
  ok('paid: the check only read from Stripe', world.stripe.every((c) => c.startsWith('GET ')) && noBareFalse(r));

  const again = await check(NOW + 3600_000);
  ok('paid: once paid it isn\'t asked about again', again.invoices_checked === 0 && world.stripe.filter((c) => c.includes('search')).length === 1);
}
{
  seed({ invoices: [openInvoice()], pis: {} });
  const r = await check();
  ok('unpaid: nothing in Stripe leaves it open, and marks when it was asked', inv().status === 'open' && inv().stripe_checked_at === new Date(NOW).toISOString() && r.invoices_checked === 1 && r.invoices_paid === 0);
  await check(NOW + 19 * 3600_000);
  ok('unpaid: it isn\'t asked again the same day', world.stripe.filter((c) => c.includes('search')).length === 1);
  await check(NOW + 21 * 3600_000);
  ok('unpaid: the next day it is', world.stripe.filter((c) => c.includes('search')).length === 2);
}
{
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment({ amount_received: 150000 })] } });
  await check();
  ok('paid: too much paid raises the refund-the-difference line, as the webhook does', notices((n) => n.kind === 'invoice_void_paid' && n.period === `payamount:${INV}:pi_1`)[0]?.headline === 'Paid too much, refund the difference: Deposit');
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment({ id: 'pi_a', created: 100 }), payment({ id: 'pi_b', created: 200 })] } });
  await check();
  ok('paid: two payments for one invoice: paid by the first, and the second is a "paid twice" line', inv().paid_ref === 'pi_a' && notices((n) => n.period === `paidtwice:${INV}:pi_b`).length === 1);
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment({ metadata: { presence_invoice_id: INV2 } })] } });
  await check();
  ok('paid: a payment for another invoice changes nothing', inv().status === 'open');
}
{
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment()] }, down: ['payment_intents'] });
  const r = await check();
  ok('unanswered: Stripe not answering is no failure of ours: counted, nothing changed, asked again tomorrow', inv().status === 'open' && r.stripe_unanswered === 1 && r.errors === 0 && sweepIssues({ stripe_check: r }).length === 0 && !!inv().stripe_checked_at, JSON.stringify(r));
  seed({ invoices: [openInvoice()], pis: { [INV]: [payment()] } });
  db.failMethod.set('presence_invoices', 'PATCH');
  const w = await check();
  ok('error: a write of ours that fails is an error the tick reports, and nothing is half-done', w.errors >= 1 && sweepIssues({ stripe_check: w }).length > 0 && world.mail.length === 0, JSON.stringify(w));
}

// ═══ 4. retainers whose state differs ═══
{
  const session = { id: 'cs_lost', object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1', metadata: META };
  seed({ retainer: retainer({ status: 'pending', stripe_subscription_id: null, stripe_customer_id: null }), linkSessions: { plink_r: [session] }, subs: { sub_1: sub() } });
  const r = await check();
  await settle();
  ok('approval: a lost approval is found from the link\'s finished checkout, and the retainer goes live on it', deal().retainer.status === 'active' && deal().retainer.stripe_subscription_id === 'sub_1' && deal().retainer.stripe_customer_id === 'cus_1' && r.retainers_fixed === 1, JSON.stringify({ r, ret: deal().retainer }));
  ok('approval: the studio hears it, as it would have', notices((n) => n.kind === 'invoice_paid' && /approved/.test(n.period)).length === 1 && world.mail.some((m) => /^Retainer approved: Website care/.test(m.subject)));
  ok('approval: and it is marked as put right', db.tables.presence_stripe_checks.find((c) => c.subject === `retainer:${DEAL}`)?.outcome === 'fixed');
}
{
  seed({ retainer: retainer(), subs: { sub_1: sub({ status: 'past_due' }) } });
  const r = await check();
  await settle();
  ok('state: a failure whose message was lost: the retainer reads past due and the studio is told', deal().retainer.status === 'past_due' && r.retainers_fixed === 1 && notices((n) => n.kind === 'retainer_status' && /:past_due:/.test(n.period)).length === 1, JSON.stringify(r));
  seed({ retainer: retainer(), subs: { sub_1: sub({ status: 'canceled', cancellation_details: { reason: 'payment_failed' } }) } });
  await check();
  await settle();
  ok('state: an ending whose message was lost: cancelled, with the day, and the studio is told', deal().retainer.status === 'canceled' && !!deal().retainer.canceled_at && notices((n) => n.kind === 'retainer_status' && /:canceled:/.test(n.period)).length === 1);
  seed({ retainer: retainer(), subs: { sub_1: sub() } });
  const same = await check();
  ok('state: a retainer that matches Stripe is left alone, and marked asked', same.retainers_checked === 1 && same.retainers_fixed === 0 && db.writes('presence_deals').length === 0 && db.tables.presence_stripe_checks[0]?.outcome === 'same');
}
{
  const paid = (id, at) => ({ id, object: 'invoice', customer: 'cus_1', status: 'paid', amount_paid: 50000, status_transitions: { paid_at: sec(at) }, metadata: {}, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } } });
  seed({ retainer: retainer(), subs: { sub_1: sub() }, subInvoices: { sub_1: [paid('in_oct', '2026-10-15T10:00:00Z'), paid('in_nov', '2026-11-15T10:00:00Z')] } });
  db.tables.presence_deal_events.push({ id: 'e1', deal_id: DEAL, site_id: STUDIO.id, kind: 'invoice_paid', detail: { retainer: true, amount_cents: 50000, stripe_invoice: 'in_oct' }, created_at: '2026-10-15T10:00:00Z' });
  const r = await check();
  ok('charges: a charge whose message was lost is recorded, dated when Stripe took it; the one already there isn\'t doubled', charges().length === 2 && charges().some((c) => c.detail.stripe_invoice === 'in_nov' && c.created_at === '2026-11-15T10:00:00.000Z') && r.charges_found === 1, JSON.stringify(charges()));
  await check(NOW + 21 * 3600_000);
  ok('charges: the next day finds nothing new to record', charges().length === 2);
}
{
  seed({ retainer: retainer(), subs: { sub_1: sub({ status: 'past_due' }) }, deals: [{ id: DEAL2, site_id: STUDIO.id, title: 'SEO plan', retainer: retainer({ stripe_subscription_id: 'sub_2' }), deleted_at: null, created_at: '2026-10-02T00:00:00Z' }] });
  await check(NOW, { invoices: 0, retainers: 1, receipts: 0 });
  ok('budget: a tick asks about only as many retainers as it may', world.stripe.filter((c) => c.startsWith('GET subscriptions/')).length === 1);
  await check(NOW + 60_000, { invoices: 0, retainers: 1, receipts: 0 });
  ok('budget: the next tick takes the next one, not the same one again', world.stripe.filter((c) => c.startsWith('GET subscriptions/')).join() === 'GET subscriptions/sub_1,GET subscriptions/sub_2', world.stripe.join());
}
{
  seed({ retainer: retainer(), subs: {}, down: ['subscriptions'] });
  const r = await check();
  ok('unanswered: Stripe not answering about a retainer changes nothing, pages nobody, and waits a day', deal().retainer.status === 'active' && r.stripe_unanswered === 1 && r.errors === 0 && db.tables.presence_stripe_checks[0]?.outcome === 'unanswered');
  seed({ retainer: retainer(), subs: { sub_1: sub({ status: 'past_due' }) } });
  db.failMethod.set('presence_deals', 'PATCH');
  const w = await check();
  ok('error: a retainer that didn\'t save is an error, nobody is told of a state not held, and it is tried next tick', w.errors === 1 && notices((n) => n.kind === 'retainer_status').length === 0 && !db.tables.presence_stripe_checks.length);
}

// ═══ 5. a receipt that didn't go out ═══
{
  const paidInv = (over = {}) => openInvoice({ status: 'paid', paid_at: '2026-11-16T09:00:00.000Z', paid_ref: 'pi_1', ...over });
  // the webhook's floor wrote the studio's line while the main server was down; the echo never ran
  seed({ invoices: [paidInv()], notices: [{ id: 'nf', site_id: STUDIO.id, client_id: STUDIO.client_id, kind: 'invoice_paid', period: `paid:${INV}`, status: 'active', headline: 'Paid — Deposit ($1,200.00)', body: 'The deposit landed. You can start the work.' }] });
  const r = await check();
  ok('receipt: the client\'s receipt that never went out is sent now, once', r.receipts_sent === 1 && world.mail.filter((m) => m.to === 'jordan@client.example').length === 1 && !!inv().receipt_sent_at, JSON.stringify({ r, mail: world.mail.map((m) => m.to) }));
  ok('receipt: the studio isn\'t emailed again for a payment it was told about', !world.mail.some((m) => m.to === 'owner@studio.example'));
  await check(NOW + 21 * 3600_000);
  ok('receipt: it is never sent twice', world.mail.filter((m) => m.to === 'jordan@client.example').length === 1);

  seed({ invoices: [paidInv({ paid_at: '2026-11-16T11:30:00.000Z' })] });
  await check();
  ok('receipt: a payment of the last hour is the webhook\'s to answer, so the check leaves it', world.mail.length === 0);
  seed({ invoices: [paidInv({ paid_method: 'check', paid_ref: null })] });
  await check();
  ok('receipt: a payment recorded by hand has its own receipt, never this one', world.mail.length === 0);
  seed({ invoices: [paidInv({ paid_at: '2026-11-12T09:00:00.000Z' })] });
  await check();
  ok('receipt: one more than three days old isn\'t sent late', world.mail.length === 0);
  seed({ invoices: [paidInv()], noEmail: true });
  const none = await check();
  ok('receipt: no email on the contact sends nothing and tries again tomorrow, not every tick', none.receipts_sent === 0 && db.tables.presence_stripe_checks.find((c) => c.subject === `receipt:${INV}`)?.outcome === 'same' && !inv().receipt_sent_at);
}
{
  // the echo itself: the receipt is claimed before it is sent, so a retry never sends it again
  seed({ invoices: [openInvoice({ status: 'paid', paid_at: '2026-11-16T09:00:00.000Z' })] });
  const first = await quiet(() => invoicePaidEcho(INV));
  const second = await quiet(() => invoicePaidEcho(INV));
  ok('echo: the receipt goes out with the first echo and is marked; a repeat sends nothing', first.receipted === true && second.receipted === false && world.mail.filter((m) => m.to === 'jordan@client.example').length === 1 && !!inv().receipt_sent_at);
  seed({ invoices: [openInvoice({ status: 'paid', paid_at: '2026-11-16T09:00:00.000Z' })] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (new URL(typeof input === 'string' ? input : input.url).hostname === 'api.resend.com' ? jres(500, { message: 'mail down' }) : realFetch(input, init));
  const failed = await quiet(() => invoicePaidEcho(INV));
  globalThis.fetch = realFetch;
  ok('echo: a receipt the mail service refused lets go of its mark, so the check sends it later', failed.receipted === false && !inv().receipt_sent_at);
}

// ═══ 6. the tick: quick when there's nothing to do, and never a bare false ═══
{
  seed({});
  const idle = await check();
  ok('tick: nothing to do: no Stripe call, a clean result', world.stripe.length === 0 && sweepIssues({ stripe_check: idle }).length === 0 && noBareFalse(idle), JSON.stringify(idle));
  seed({});
  db.fail.add('presence_stripe_checks');
  const early = await check();
  ok('tick: before its database step it does nothing and says so, clean', early.skipped_not_set_up === true && world.stripe.length === 0 && sweepIssues({ stripe_check: early }).length === 0 && noBareFalse(early));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ DAILY STRIPE CHECK (item 130): ${results.length - failed.length}/${results.length} ${failed.length ? 'FAILED' : 'PASSED'} ════`);
if (failed.length) Deno.exit(1);
Deno.exit(0);
