// ── Sales items 139–160, the money bugs of the Nov 22 2026 review ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/money_fixes_nov22_test.mjs
//
// Each block fails on the code as it was:
// 139  Delete refuses while the deal has a sent unpaid invoice or a waiting or live retainer
// 140  a replaced waiting retainer's old link is switched off (and a failed switch-off stops
//      the set-up); an approval through an old link, or after a cancel, is an extra the studio
//      hears about; the amount is read back from Stripe
// 141  an invoice nobody sent is a draft: not owed, never overdue, out of the portal, and the
//      studio is asked "Part 2 is due Friday. Send it?"
// 142  the acknowledgement and the follow-ups make the writer a contact first and answer to the Inbox
// 144  the agreement and its deposit are priced from the proposal the client saw
// 145  a refunded or disputed invoice's page and PDF say so
// 147  the receipt falls back to the email Stripe collected, saved on a contact that had none
// 148  the Invoices page's Record a payment asks about the receipt and says what happened
// 149  pay links and retainers only for the platform's own studio
// 152  one clock: the studio's day, reminders in its morning, a refund in its own month
// 157  the Invoices page shows and totals the whole invoice; the download has the parts, guarded
// 159  an invoice stuck on Processing is asked about and bounced when Stripe says it failed
// 160  a revised proposal's old version can't be accepted when the newer one names it
// Stripe, the mail service and the database are fakes. Every name and number is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('STRIPE_SECRET', 'sk_test_fake_nov22');
Deno.env.set('BILLING_SYNC_SECRET', 'test-commerce-secret-nov22');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('APPROVAL_SECRET', 'approval-secret-nov22');
const HOOK_SECRET = 'whsec_test_fake_nov22';
Deno.env.set('STRIPE_WEBHOOK_SECRET', HOOK_SECRET);
const db = installFakePostgrest({ unique: { presence_plan_notices: [['client_id', 'kind', 'period']], presence_stripe_checks: [['subject']] } });

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(`${n}`, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ═══ the pretend Stripe and mail; the database is the fake above ═══
const world = { stripe: [], mail: [], pis: {}, subs: {}, refuse: new Set() };
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
    if (method === 'DELETE' && path.startsWith('subscriptions/')) return jres(200, { id: path.split('/')[1], status: 'canceled' });
    if (method === 'GET' && path === 'payment_intents/search') {
      const m = /metadata\['presence_invoice_id'\]:'([^']+)'/.exec(u.searchParams.get('query') || '');
      return jres(200, { object: 'search_result', data: (m && world.pis[m[1]]) || [] });
    }
    if (method === 'GET' && path.startsWith('subscriptions/')) { const s = world.subs[path.split('/')[1]]; return s ? jres(200, s) : jres(404, { error: { message: 'No such subscription' } }); }
    if (method === 'GET') return jres(200, { object: 'list', data: [] });
    return jres(404, { error: { message: `unplanned Stripe call ${method} ${path}` } });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); world.mail.push({ to: String(b.to), subject: String(b.subject), html: String(b.html), reply_to: b.reply_to || null }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, true);
  if (u.pathname.startsWith('/functions/v1/')) return jres(200, { data: { notice: true } });
  return fakeDb(input, init);
};

const P = '../../supabase/functions/presence';
const S = await import(`${P}/routes/sales.ts`);
const I = await import(`${P}/routes/invoices_list.ts`);
const CD = await import(`${P}/routes/client_delivery.ts`);
const CM = await import(`${P}/routes/commerce.ts`);
const MS = await import(`${P}/lib/money_state.ts`);
const LC = await import(`${P}/commerce/lifecycle.ts`);
const RT = await import(`${P}/commerce/retainers.ts`);
const SH = await import(`${P}/commerce/stripe_shape.ts`);
const SC = await import(`${P}/commerce/stripe_check.ts`);
const OS = await import(`${P}/commerce/own_stripe.ts`);
const CK = await import(`${P}/lib/studio_clock.ts`);
const SR = await import(`${P}/lib/sales_reports.ts`);
const DOC = await import(`${P}/lib/documents.ts`);
const PDF = await import(`${P}/lib/doc_pdf.ts`);
const LCT = await import(`${P}/lib/lead_contact.ts`);
const CR = await import(`${P}/commerce/charge_returns.ts`);
// the signed webhook, its handler caught instead of a port opened (sales item 147)
let hook = null;
{ const realServe = Deno.serve; Deno.serve = (h) => { hook = h; return {}; }; await import('../../supabase/functions/stripe-webhook/index.ts'); Deno.serve = realServe; }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function stripeEvent(type, object) {
  const raw = JSON.stringify({ id: `evt_nov22_${Math.random().toString(36).slice(2)}`, object: 'event', api_version: '2026-05-27.dahlia', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  return quiet(() => hook(new Request('https://x/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })));
}

// ═══ the fake world ═══
const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const CUSTOMER = { id: '99999999-1111-4111-8111-999999999999', client_id: '99999999-2222-4222-8222-999999999999' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const INV = '55555555-5555-4555-8555-555555555555';
const INV2 = '55555555-5555-4555-8555-555555555556';
const PART = '55555555-5555-4555-8555-555555555557';
const PROP1 = '77777777-7777-4777-8777-777777777771', PROP2 = '77777777-7777-4777-8777-777777777772';
const site = { id: STUDIO.id, client_id: STUDIO.client_id, status: 'live', edition: 'presence' };
const customerSite = { id: CUSTOMER.id, client_id: CUSTOMER.client_id, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333339', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const NOW = Date.parse('2026-11-18T18:00:00Z');   // 10 in the morning in Burbank
const invoice = (over = {}) => ({ id: INV, site_id: STUDIO.id, deal_id: DEAL, customer_client_id: CUSTOMER.client_id, number: 12, title: 'Balance at launch', description: 'Balance', amount_cents: 100000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: null, stripe_payment_link_id: null, processing_since: null, paid_at: null, paid_method: '', paid_note: '', payment_for: null, link_gen: 0, first_sent_at: null, due_date: null, refunded_cents: 0, dispute_status: null, deleted_at: null, created_at: '2026-10-01T18:00:00Z', ...over });
const sent = (over = {}) => invoice({ stripe_url: 'https://pay.example/sent', stripe_payment_link_id: 'plink_sent', first_sent_at: '2026-10-02T18:00:00Z', ...over });
const META = { purpose: 'service_retainer', kind: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id };
const pending = (over = {}) => ({ status: 'pending', amount_cents: 40000, interval: 'month', stripe_subscription_id: null, stripe_customer_id: null, stripe_payment_link_id: 'plink_cur', checkout_url: 'https://pay.example/cur', current_period_end: null, canceled_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over });
const subAt = (cents, over = {}) => ({ id: 'sub_x', object: 'subscription', customer: 'cus_x', status: 'active', metadata: META, items: { object: 'list', data: [{ id: 'si_x', current_period_end: 1_800_000_000, price: { id: 'price_x', unit_amount: cents, recurring: { interval: 'month' } } }] }, ...over });
const session = (over = {}) => ({ id: 'cs_x', object: 'checkout.session', mode: 'subscription', payment_status: 'paid', subscription: 'sub_x', customer: 'cus_x', payment_link: 'plink_cur', amount_total: 40000, currency: 'usd', metadata: META, ...over });
function seed(o = {}) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }, { id: CUSTOMER.id, client_id: CUSTOMER.client_id }],
    presence_deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Website care', stage: 'contract', contact_id: CONTACT, expected_value_cents: o.value ?? 300000, converted_client_id: null, converted_at: null, retainer: o.retainer === undefined ? null : o.retainer, source_submission_id: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    presence_contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Jordan Ellis', email: o.noEmail ? '' : 'jordan@client.example', phone: '', deleted_at: null }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_locations: o.locations || [{ site_id: STUDIO.id, timezone: 'America/Los_Angeles' }],
    presence_settings: o.settings || [],
    presence_invoices: o.invoices || [],
    presence_proposals: o.proposals || [],
    presence_contracts: [], presence_deal_events: [], presence_plan_notices: [], presence_stripe_checks: [], presence_money_returns: o.returns || [], stripe_payments: o.payments || [], presence_form_submissions: o.enquiries || [], stripe_webhook_events: [],
  });
  Object.assign(world, { stripe: [], mail: [], pis: o.pis || {}, subs: o.subs || {}, refuse: new Set(o.refuse || []) });
}
const inv = (id = INV) => db.tables.presence_invoices.find((x) => x.id === id);
const deal = () => db.tables.presence_deals[0];
const notices = (pred = () => true) => db.tables.presence_plan_notices.filter(pred);

// ═══ 139. Delete refuses while money is running ═══
{
  seed({ invoices: [sent({ number: 12 })] });
  let r = await res(await S.handleSalesDeal(req('DELETE', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('139: a deal with a sent, unpaid invoice is not deleted, and the refusal names the invoice', r.status === 409 && r.body.error === 'money_running' && /Void invoice #0012 first/.test(r.body.message) && deal().deleted_at === null, JSON.stringify(r.body));
  seed({ retainer: pending() });
  r = await res(await S.handleSalesDeal(req('DELETE', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('139: a waiting retainer stops the delete too, in its own words', r.status === 409 && /Cancel the retainer that is waiting for approval first/.test(r.body.message), JSON.stringify(r.body));
  seed({ retainer: pending({ status: 'active', stripe_subscription_id: 'sub_live' }), invoices: [sent({ number: 12 }), sent({ id: INV2, number: 13 })] });
  r = await res(await S.handleSalesDeal(req('DELETE', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('139: a live retainer and two invoices: "Cancel the retainer and void its 2 unpaid invoices first"', r.status === 409 && /Cancel the retainer and void its 2 unpaid invoices first/.test(r.body.message), r.body.message);
  seed({ invoices: [invoice({ number: 12 }), sent({ id: INV2, number: 13, status: 'paid', paid_at: '2026-10-05T00:00:00Z' }), sent({ id: PART, number: 14, status: 'void' })], retainer: pending({ status: 'canceled', stripe_payment_link_id: null, canceled_at: '2026-11-02T00:00:00Z' }) });
  r = await res(await S.handleSalesDeal(req('DELETE', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('139: a draft nobody sent, a paid one, a voided one and a cancelled retainer let the delete through', r.status === 200 && deal().deleted_at !== null, JSON.stringify(r.body));
  eq('139: the pure rule, with the words', await S.moneyStillRunning(STUDIO.id, DEAL, null), '');
  db.fail.add('presence_invoices');
  ok('139: a read that fails refuses rather than deleting and hoping', /wasn’t deleted/.test(await S.moneyStillRunning(STUDIO.id, DEAL, null)));
  db.fail.delete('presence_invoices');
}

// ═══ 140. Retainer links and the amount Stripe charges ═══
{
  // (a) a set-up that replaces a waiting retainer switches the old link off first
  seed({ retainer: pending() });
  let r = await res(await S.handleSalesRetainer(req('POST', `/sales/deals/${DEAL}/retainer`, { amount_cents: 50000, interval: 'month' }), site, owner, DEAL, cors));
  const off = world.stripe.find((c) => c.method === 'POST' && c.path === 'payment_links/plink_cur');
  ok('140a: setting up again at a new price switches the old waiting link off before the new one is made', r.status === 201 && !!off && off.body.active === 'false' && world.stripe.indexOf(off) < world.stripe.findIndex((c) => c.path === 'payment_links' && c.method === 'POST'), JSON.stringify({ status: r.status, calls: world.stripe.map((c) => c.path) }));
  ok('140a: the deal now holds the new link and the new amount', deal().retainer.amount_cents === 50000 && deal().retainer.stripe_payment_link_id === 'plink_new_1');
  seed({ retainer: pending(), refuse: ['payment_links/plink_cur'] });
  r = await res(await S.handleSalesRetainer(req('POST', `/sales/deals/${DEAL}/retainer`, { amount_cents: 50000, interval: 'month' }), site, owner, DEAL, cors));
  ok('140a: when Stripe won’t switch the old link off, nothing changes and it says so', r.status === 502 && r.body.error === 'old_link_live' && deal().retainer.amount_cents === 40000 && !world.stripe.some((c) => c.path === 'payment_links' && c.method === 'POST'), JSON.stringify(r.body));
  // (c) Cancel on a waiting retainer says so when the link stayed live
  seed({ retainer: pending(), refuse: ['payment_links/plink_cur'] });
  r = await res(await S.handleSalesRetainerCancel(req('POST', `/sales/deals/${DEAL}/retainer/cancel`), site, owner, DEAL, cors));
  ok('140c: Cancel of a waiting retainer refuses to read "cancelled" while Stripe keeps the link live', r.status === 502 && r.body.error === 'cancel_failed' && deal().retainer.status === 'pending', JSON.stringify(r.body));
  seed({ retainer: pending() });
  r = await res(await S.handleSalesRetainerCancel(req('POST', `/sales/deals/${DEAL}/retainer/cancel`), site, owner, DEAL, cors));
  ok('140c: …and cancels when Stripe confirms', r.status === 200 && deal().retainer.status === 'canceled');
  // the pure rules
  ok('140: an approval landing on a retainer cancelled while it waited is an extra, never its own', RT.isExtraSubscription(pending({ status: 'canceled', stripe_payment_link_id: null }), 'sub_late') && !RT.isExtraSubscription(pending(), 'sub_first') && !RT.isExtraSubscription(null, 'sub_x'));
  ok('140: an approval through a link that is not the retainer’s own is an extra', RT.approvedThroughOldLink(pending(), session({ payment_link: 'plink_old' })) && !RT.approvedThroughOldLink(pending(), session()) && !RT.approvedThroughOldLink(pending({ stripe_payment_link_id: null }), session({ payment_link: 'plink_old' })));
  eq('140: what a subscription charges, read from Stripe', SH.subscriptionAmount(subAt(50000)), { amount_cents: 50000, interval: 'month' });
  ok('140: no readable price → nothing (the deal keeps what was set up)', SH.subscriptionAmount({ items: { data: [] } }) === null && SH.subscriptionAmount(null) === null);
  // (c) an approval after Cancel: the retainer stays cancelled, the studio hears "approved after you cancelled it", and Cancel stops it
  seed({ retainer: pending({ status: 'canceled', stripe_payment_link_id: 'plink_cur', canceled_at: '2026-11-02T00:00:00Z' }), subs: { sub_x: subAt(40000) } });
  let s = await quiet(() => RT.applyRetainerSync('checkout.session.completed', session()));
  ok('140c: the late approval is recorded as an extra and the retainer stays Cancelled', s.synced && s.reason === 'second_approval' && deal().retainer.status === 'canceled' && (deal().retainer.extra_subscription_ids || []).includes('sub_x'), JSON.stringify({ s, r: deal().retainer }));
  ok('140c: the studio is told, in the "approved after you cancelled it" words', notices((n) => /Retainer approved after you cancelled it/.test(n.headline)).length === 1, JSON.stringify(notices().map((n) => n.headline)));
  r = await res(await S.handleSalesRetainerCancel(req('POST', `/sales/deals/${DEAL}/retainer/cancel`), site, owner, DEAL, cors));
  ok('140c: Cancel now stops the charges (it used to answer "already cancelled")', r.status === 200 && !r.body.data.already && world.stripe.some((c) => c.method === 'DELETE' && c.path === 'subscriptions/sub_x'), JSON.stringify(r.body));
  ok('140c: the client’s portal offers Cancel on it too', RT.retainerPortalView({ id: DEAL, title: 'Website care', retainer: pending({ status: 'canceled', extra_subscription_ids: ['sub_x'] }) }, [{ at: '2026-11-03T00:00:00Z', amount: 400 }])?.can_cancel === true);
  // (a, narrow) the old link finished after a cancel and a new set-up: an extra, told as after-cancel
  seed({ retainer: pending({ stripe_payment_link_id: 'plink_cur' }), subs: { sub_x: subAt(50000) } });
  s = await quiet(() => RT.applyRetainerSync('checkout.session.completed', session({ payment_link: 'plink_old' })));
  ok('140a: an approval through the OLD link never becomes the new waiting retainer', s.synced && s.reason === 'second_approval' && deal().retainer.status === 'pending' && (deal().retainer.extra_subscription_ids || []).includes('sub_x') && notices((n) => /approved after you cancelled it/.test(n.headline)).length === 1, JSON.stringify({ s, r: deal().retainer }));
  // (b) on approval the amount is read from Stripe
  seed({ retainer: pending(), subs: { sub_x: subAt(50000) } });
  s = await quiet(() => RT.applyRetainerSync('checkout.session.completed', session()));
  ok('140b: the amount Stripe is charging is stored on approval (set up at $400, Stripe charges $500)', s.synced && deal().retainer.status === 'active' && deal().retainer.amount_cents === 50000, JSON.stringify({ s, r: deal().retainer }));
  const approved = notices((n) => /Retainer approved:/.test(n.headline))[0];
  ok('140b: the approved line says Stripe charges $500, not the $400 that was set up', !!approved && /\$500\.00 a month/.test(approved.headline) && /Stripe is charging \$500\.00 a month, not the \$400\.00 a month that was set up/.test(approved.body), approved && approved.body);
  seed({ retainer: pending(), subs: { sub_x: subAt(40000) } });
  await quiet(() => RT.applyRetainerSync('checkout.session.completed', session()));
  const same = notices((n) => /Retainer approved:/.test(n.headline))[0];
  ok('140b: the same amount says nothing of the kind', !!same && !/not the/.test(same.body));
}

// ═══ 141. An invoice nobody sent is a draft ═══
{
  ok('141: the rule: no link, no first-sent day, no earlier link, nothing settling → not sent', MS.invoiceNotSent(invoice()) && !MS.invoiceNotSent(sent()) && !MS.invoiceNotSent(invoice({ first_sent_at: '2026-10-02T00:00:00Z' })) && !MS.invoiceNotSent(invoice({ link_gen: 1 })) && !MS.invoiceNotSent(invoice({ processing_since: '2026-10-02T00:00:00Z' })) && !MS.invoiceNotSent(invoice({ status: 'paid' })) && !MS.invoiceNotSent(null));
  ok('141: the one formula reads the server’s flag as draft; a draft counts in no bucket', MS.moneyState({ status: 'open', due_date: '2020-01-01', not_sent: true }, '2026-11-18') === 'draft' && MS.MONEY_WORD.draft === 'Not sent yet' && MS.moneyBuckets([{ status: 'open', due_date: '2020-01-01', not_sent: true, amount_cents: 5000 }], '2026-11-18').overdue.count === 0);
  ok('141: the filter the counters of money owed use', MS.SENT_INVOICE_FILTER === 'or=(stripe_url.not.is.null,first_sent_at.not.is.null,link_gen.gt.0,processing_since.not.is.null)');
  seed({ invoices: [invoice({ due_date: '2026-11-01', title: 'Part 2 of 3' }), sent({ id: INV2, number: 13, due_date: '2026-11-01', title: 'Part 1 of 3' })] });
  let r = await res(await I.handleSalesInvoicesList(req('GET', '/sales/invoices?today=2026-11-18'), site, cors));
  const by = Object.fromEntries(r.body.data.items.map((i) => [i.title, i]));
  ok('141: the Invoices page: the unsent part reads "draft", the sent one past its date "overdue"', by['Part 2 of 3'].state === 'draft' && by['Part 2 of 3'].not_sent === true && by['Part 1 of 3'].state === 'overdue' && by['Part 1 of 3'].not_sent === false, JSON.stringify(r.body.data.items.map((i) => [i.title, i.state])));
  r = await res(await CD.handleClientBilling(req('GET', '/client/billing'), customerSite, owner, cors));
  ok('141: the client’s portal leaves the unsent part out, and shows the sent one', r.status === 200 && r.body.data.invoices.length === 1 && r.body.data.invoices[0].name === 'Part 1 of 3', JSON.stringify(r.body.data.invoices.map((i) => i.name)));
  const rc = await res(await S.handleSalesReceivables(req('GET', '/sales/receivables?today=2026-11-18'), site, owner, cors));
  ok('141: Who owes you lists the sent part only, so Owed and Overdue leave the draft out', rc.status === 200 && rc.body.data.items.length === 1 && rc.body.data.items[0].title === 'Part 1 of 3' && rc.body.data.total_cents === 100000, JSON.stringify(rc.body.data));
  const d = await res(await S.handleSalesDeal(req('GET', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  const rowsOnDeal = d.body.data.invoices || [];
  ok('141: the deal read ships not_sent and the draft state, so the page’s mirror reads it the same', rowsOnDeal.find((i) => i.id === INV)?.state === 'draft' && rowsOnDeal.find((i) => i.id === INV)?.not_sent === true && rowsOnDeal.find((i) => i.id === INV2)?.state === 'overdue', JSON.stringify(rowsOnDeal.map((i) => [i.title, i.state, i.not_sent])));
  // the nudge: "Part 2 is due Friday. Send it?"
  ok('141: when to ask: within three days of its date, or past it; never for a sent one or a part payment', LC.draftNudgeDue(invoice({ due_date: '2026-11-21' }), '2026-11-18') && !LC.draftNudgeDue(invoice({ due_date: '2026-11-22' }), '2026-11-18') && LC.draftNudgeDue(invoice({ due_date: '2026-11-01' }), '2026-11-18') && !LC.draftNudgeDue(sent({ due_date: '2026-11-19' }), '2026-11-18') && !LC.draftNudgeDue(invoice({ due_date: '2026-11-19', payment_for: INV2 }), '2026-11-18') && !LC.draftNudgeDue(invoice({ due_date: null }), '2026-11-18'));
  eq('141: the words for the day', ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-25', '2026-11-17', '2026-11-13', '2026-10-01'].map((due) => LC.draftDueWords(due, '2026-11-18')), ['is due today', 'is due tomorrow', 'is due Friday', 'is due Nov 25', 'was due yesterday', 'was due Friday', 'was due Oct 1']);
  eq('141: the line itself', LC.draftNudgeCopy('Part 2 of 3', '$1,000.00', '2026-11-20', '2026-11-18').headline, 'Part 2 of 3 is due Friday. Send it?');
  seed({ invoices: [invoice({ due_date: '2026-11-20', title: 'Part 2 of 3' }), invoice({ id: INV2, due_date: '2026-12-20', title: 'Part 3 of 3' }), sent({ id: PART, number: 13, due_date: '2026-11-19' })] });
  let n = await quiet(() => LC.runDraftInvoiceNudges(NOW, 20));
  const line = notices((x) => /Send it\?/.test(x.headline));
  ok('141: the sweep raises one Needs-you line for the part due Friday, none for the one a month out or the sent one', n.raised === 1 && line.length === 1 && line[0].headline === 'Part 2 of 3 is due Friday. Send it?' && line[0].kind === 'deal_followup' && line[0].period === `invremind:${INV}:draft:2026-11-20`, JSON.stringify({ n, h: notices().map((x) => x.headline) }));
  n = await quiet(() => LC.runDraftInvoiceNudges(NOW + 3600_000, 20));
  ok('141: …and never twice', n.raised === 0 && notices().length === 1);
  const sweep = await quiet(() => LC.runInvoiceReminders(20, NOW));
  ok('141: the reminder sweep runs the nudge too (nothing to remind, the draft already asked about)', sweep.reminded === 0 && notices().length === 1);
}

// ═══ 142. Automatic emails make the writer a contact and answer to the Inbox ═══
{
  // the first follow-up to a quiet enquiry, three days old, with the switch on
  const ENQ = '12121212-1212-4121-8121-121212121212';
  const enquiry = { id: ENQ, site_id: STUDIO.id, form_kind: 'contact', name: 'Sam Writer', email: 'Sam.Writer@Example.com', phone: '555-0199', message: 'Can you build us a site?', status: 'new', spam: false, created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), fields: {} };
  seed({ enquiries: [enquiry], settings: [{ site_id: STUDIO.id, enquiry_followups: true, enquiry_followup_1_days: 2, enquiry_followup_2_days: 7 }] });
  const sentN = await quiet(() => LC.runEnquiryFollowups(20));
  const fu = world.mail.find((m) => m.to === 'sam.writer@example.com' || m.to === 'Sam.Writer@Example.com');
  const madeFirst = db.tables.presence_contacts.find((c) => c.email === 'sam.writer@example.com');
  ok('142: the follow-up goes out, and the writer is a contact by then, with their name and phone', sentN.sent === 1 && !!fu && !!madeFirst && madeFirst.name === 'Sam Writer' && madeFirst.phone === '555-0199', JSON.stringify({ sentN, mail: world.mail.map((m) => [m.to, m.subject]), made: madeFirst }));
  ok('142: the follow-up no longer answers to the owner’s own mailbox (the Inbox address is sendEmail’s default)', !!fu && fu.reply_to !== 'owner@studio.example', JSON.stringify(fu && fu.reply_to));
  const order = db.log.filter((c) => c.url.includes('/rest/v1/presence_contacts'));
  ok('142: the contact is made (its read and write) before the email is sent', order.length >= 2 && order.some((c) => c.method === 'POST'));
  seed();
  await LCT.ensureLeadContact(STUDIO.id, 'New.Writer@Example.com', 'New Writer', '555-0100');
  const made = db.tables.presence_contacts.find((c) => c.email === 'new.writer@example.com');
  ok('142: the helper makes the contact, lower-cased, with name and phone', !!made && made.name === 'New Writer' && made.phone === '555-0100');
  await LCT.ensureLeadContact(STUDIO.id, 'new.writer@example.com', 'Again', '');
  ok('142: …and leaves an existing one alone', db.tables.presence_contacts.filter((c) => c.email === 'new.writer@example.com').length === 1 && made.name === 'New Writer');
}

// ═══ 144. The agreement is priced from the proposal the client saw ═══
{
  const items = (cents) => [{ label: 'Website', qty: 1, unit_cents: cents }];
  seed({ value: 300000, proposals: [{ id: PROP1, site_id: STUDIO.id, deal_id: DEAL, status: 'accepted', line_items: items(345000), version: 1, deleted_at: null, created_at: '2026-10-05T00:00:00Z' }] });
  let p = await S.dealPriceCents(STUDIO.id, deal());
  eq('144: an accepted proposal at $3,450 prices the agreement, and differs from the $3,000 typed on the deal', p, { cents: 345000, from: 'proposal', proposal_cents: 345000, differs: true });
  seed({ value: 300000 });
  p = await S.dealPriceCents(STUDIO.id, deal());
  eq('144: with no proposal the deal’s value stands', p, { cents: 300000, from: 'deal', proposal_cents: null, differs: false });
  seed({ value: 0, proposals: [{ id: PROP1, site_id: STUDIO.id, deal_id: DEAL, status: 'sent', line_items: items(345000), version: 1, deleted_at: null, created_at: '2026-10-05T00:00:00Z' }, { id: PROP2, site_id: STUDIO.id, deal_id: DEAL, status: 'draft', line_items: items(999900), version: 1, deleted_at: null, created_at: '2026-10-06T00:00:00Z' }] });
  p = await S.dealPriceCents(STUDIO.id, deal());
  ok('144: a sent one counts, a draft never does, and an empty deal value is no difference', p.cents === 345000 && p.from === 'proposal' && p.differs === false, JSON.stringify(p));
  seed({ value: 300000, proposals: [{ id: PROP1, site_id: STUDIO.id, deal_id: DEAL, status: 'sent', line_items: [...items(345000), { __meta__: { superseded_by: PROP2 } }], version: 1, deleted_at: null, created_at: '2026-10-05T00:00:00Z' }] });
  p = await S.dealPriceCents(STUDIO.id, deal());
  ok('144: a revised-away version is not the one the client saw', p.from === 'deal' && p.cents === 300000, JSON.stringify(p));
  // the agreement drafted from a template prints the proposal's figures
  seed({ value: 300000, proposals: [{ id: PROP1, site_id: STUDIO.id, deal_id: DEAL, status: 'accepted', line_items: items(345000), version: 1, deleted_at: null, created_at: '2026-10-05T00:00:00Z' }] });
  db.tables.presence_sales_templates = [{ id: '88888888-8888-4888-8888-888888888888', site_id: STUDIO.id, kind: 'contract', name: 'Standard', title: 'Service agreement', body: 'Fee {{deal_value}}. Deposit {{deposit_amount}}, balance {{balance_amount}}.', deleted_at: null }];
  const c = await res(await S.handleSalesContractCreate(req('POST', `/sales/deals/${DEAL}/contracts`, { template_id: '88888888-8888-4888-8888-888888888888' }), site, owner, DEAL, cors));
  ok('144: an agreement drafted from a template prints $3,450, a $1,725 deposit and a $1,725 balance (not $3,000 / $1,500 / $1,500)', c.status === 201 && c.body.data.body === 'Fee $3,450. Deposit $1,725, balance $1,725.', JSON.stringify(c.body));
  const pipe = read('pipeline.html');
  ok('144: the deal page fills the agreement from the proposal the client saw, and warns before Send when the deal’s value differs', /function proposalPriceCents\(proposals\)/.test(pipe) && /docPlaceholderValues\(dealForDocs\(d,data\.proposals\),c,biz\)/.test(pipe) && (pipe.match(/await confirmPriceMismatch\(d,data\.proposals\)/g) || []).length === 3 && /The deal’s value doesn’t match the proposal/.test(pipe));
}

// ═══ 145. A refunded or disputed invoice's page and PDF say so ═══
{
  const paid = invoice({ status: 'paid', paid_at: '2026-10-20T18:00:00Z', paid_ref: 'pi_paid', refunded_cents: 100000 });
  const ctx = { tz: 'America/Los_Angeles', returned: [{ cents: 100000, at: '2026-11-03T20:00:00Z', kind: 'refund' }], payments: [] };
  let w = DOC.invoiceReturnWords(paid, ctx);
  ok('145: refunded in full, with the day', w.state === 'refunded' && w.pill === 'Refunded' && w.line === 'Refunded in full on Nov 3, 2026: $1,000.00 went back to you.', JSON.stringify(w));
  w = DOC.invoiceReturnWords({ ...paid, refunded_cents: 25000 }, ctx);
  ok('145: part refunded: still a receipt, with what went back', w.state === 'part' && w.pill === 'Paid · $250.00 refunded' && /\$250\.00 of it was refunded on Nov 3, 2026\./.test(w.line));
  ok('145: disputed, and lost', DOC.invoiceReturnWords({ ...paid, refunded_cents: 0, dispute_status: 'open' }, ctx).pill === 'Disputed' && DOC.invoiceReturnWords({ ...paid, refunded_cents: 0, dispute_status: 'lost' }, ctx).pill === 'Dispute lost' && DOC.invoiceReturnWords({ ...paid, refunded_cents: 0 }, ctx).state === null && DOC.invoiceReturnWords(invoice(), ctx).state === null);
  const brand = { name: 'Test Studio', accent: '#5b3cc4' };
  const page = DOC.renderInvoiceDocument(paid, brand, ctx);
  ok('145: the page says Refunded, never "Paid in full. Thank you."', /Refunded/.test(page) && /\$1,000\.00 went back to you/.test(page) && !/Paid in full\. Thank you\./.test(page) && !/this is your receipt of payment/.test(page));
  const plain = DOC.renderInvoiceDocument({ ...paid, refunded_cents: 0 }, brand, { ...ctx, returned: [] });
  ok('145: a plain receipt still reads Paid in full', /Paid in full\. Thank you\./.test(plain) && !/Refunded/.test(plain));
  const pdf = PDF.invoicePdf(paid, brand, ctx);
  ok('145: the PDF builds with the refund on it', pdf instanceof Uint8Array && pdf.length > 1000 && new TextDecoder('latin1').decode(pdf).includes('%PDF'));
  const part = DOC.renderInvoiceDocument({ ...paid, refunded_cents: 25000 }, brand, ctx);
  ok('145: a part refund keeps the receipt banner and adds the line', /Paid in full\. Thank you\./.test(part) && /\$250\.00 of it was refunded/.test(part));
  seed({ invoices: [paid] });
  const row = await S.docRow('invoice', INV, STUDIO.id);
  ok('145: the document reader now loads what came back, so the page it renders can say so', !!row && row.refunded_cents === 100000 && 'dispute_status' in row, JSON.stringify(row));
}

// ═══ 147. The receipt falls back to the email Stripe collected ═══
{
  seed({ noEmail: true, invoices: [invoice({ status: 'paid', paid_at: '2026-11-10T18:00:00Z', paid_ref: 'pi_text', stripe_url: 'https://pay.example/x' })], payments: [{ id: 1, stripe_payment_intent: 'pi_text', email: 'Payer@Phone.Example', invoice_id: INV, created_at: '2026-11-10T18:00:00Z' }] });
  eq('147: the email the payer gave Stripe, by the payment that paid the invoice', await CM.payerEmailFromStripe(INV, 'pi_text'), 'payer@phone.example');
  eq('147: …or by the invoice, when the payment’s id isn’t stored', await CM.payerEmailFromStripe(INV, ''), 'payer@phone.example');
  eq('147: nothing recorded → no address', await CM.payerEmailFromStripe(INV2, 'pi_none'), '');
  const echo = await quiet(() => CM.invoicePaidEcho(INV));
  const receipt = world.mail.find((m) => /Payment received — thank you/.test(m.subject));
  ok('147: the receipt goes to the address Stripe collected when the contact has none', !!receipt && receipt.to === 'payer@phone.example', JSON.stringify({ echo, mail: world.mail.map((m) => [m.to, m.subject]) }));
  ok('147: that address is saved on the contact, which had none', db.tables.presence_contacts[0].email === 'payer@phone.example');
  const told = notices((n) => /Paid —/.test(n.headline))[0];
  ok('147: the studio’s line says where the receipt went and that the contact now has it', !!told && /went to payer@phone\.example, the address they gave Stripe, and it is now on their contact/.test(told.body), told && told.body);
  seed({ invoices: [invoice({ status: 'paid', paid_at: '2026-11-10T18:00:00Z', paid_ref: 'pi_text', stripe_url: 'https://pay.example/x' })], payments: [{ id: 1, stripe_payment_intent: 'pi_text', email: 'payer@phone.example', invoice_id: INV }] });
  await quiet(() => CM.invoicePaidEcho(INV));
  ok('147: a contact with an email keeps it, and the receipt goes there', world.mail.find((m) => /Payment received — thank you/.test(m.subject))?.to === 'jordan@client.example' && db.tables.presence_contacts[0].email === 'jordan@client.example');
  seed({ noEmail: true, invoices: [sent({ status: 'open' })] });
  const hr = await stripeEvent('checkout.session.completed', { id: 'cs_text', object: 'checkout.session', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_text2', amount_total: 100000, currency: 'usd', customer_details: { email: 'Texted@Payer.Example' }, metadata: { presence_invoice_id: INV, kind: 'service_invoice' } });
  const kept = db.tables.stripe_payments.find((p) => p.stripe_payment_intent === 'pi_text2');
  ok('147: the webhook keeps the payer’s email against the service invoice it paid', hr.status === 200 && !!kept && kept.invoice_id === INV && kept.email === 'Texted@Payer.Example', JSON.stringify({ status: hr.status, kept }));
  eq('147: …so the receipt can find it by the invoice', await CM.payerEmailFromStripe(INV, ''), 'texted@payer.example');
}

// ═══ 148. The Invoices page asks about the receipt and says what happened ═══
{
  const page = read('invoices.html');
  ok('148: the box, shown only when there is someone to email, named', /<input type="checkbox" id="payRcpt" checked>/.test(page) && /\$\('payRcptWrap'\)\.hidden=!i\.has_email/.test(page) && /'Email '\+\(i\.first\|\|'them'\)\+' a receipt \(the PDF is attached\)'/.test(page));
  ok('148: the request says either way', /email_receipt:wantReceipt/.test(page) && /const wantReceipt=!!\(i\.has_email&&\$\('payRcpt'\)\.checked\)/.test(page));
  ok('148: the same after-messages as the deal page: the receipt, a card link that may still be live, a fresh link that failed', /Receipt emailed to \$\{i\.first\|\|'them'\}/.test(page) && /The receipt email didn’t go out\./.test(page) && /Its card link may still be live, so switch it off in Stripe\./.test(page) && /A new payment link couldn’t be made just now: press Send on the invoice to make one\./.test(page));
  seed({ invoices: [sent()] });
  const r = await res(await I.handleSalesInvoicesList(req('GET', '/sales/invoices?today=2026-11-18'), site, cors));
  ok('148: the list says whether the person has an email, and their first name', r.body.data.items[0].has_email === true && r.body.data.items[0].first === 'Jordan');
  seed({ noEmail: true, invoices: [sent()] });
  const r2 = await res(await I.handleSalesInvoicesList(req('GET', '/sales/invoices?today=2026-11-18'), site, cors));
  ok('148: …and when they have none', r2.body.data.items[0].has_email === false);
}

// ═══ 149. Pay links and retainers only for the platform's own studio ═══
{
  ok('149: with the platform site set, only that site may bill', OS.ownStripeAllowed(STUDIO.id, owner, STUDIO.id) && !OS.ownStripeAllowed(CUSTOMER.id, owner, STUDIO.id) && !OS.ownStripeAllowed(CUSTOMER.id, { ...owner, scope: null }, STUDIO.id));
  ok('149: without it, the one case the code can see is refused: a studio drilled into a client’s business', OS.ownStripeAllowed(CUSTOMER.id, owner, '') && !OS.ownStripeAllowed(CUSTOMER.id, { ...owner, scope: { site_id: CUSTOMER.id, name: 'Client' } }, undefined));
  Deno.env.set('AGENCY_SITE_ID', STUDIO.id);
  seed({ invoices: [invoice()] });
  let r = await res(await S.handleSalesInvoice(req('POST', `/sales/deals/${DEAL}/invoice`, { amount_cents: 50000 }), customerSite, owner, DEAL, cors));
  ok('149: "Send an invoice" on another business’s site is refused in plain words, and no Stripe link is made', r.status === 403 && r.body.error === 'not_your_stripe' && /platform studio’s own Stripe account/.test(r.body.message) && world.stripe.length === 0, JSON.stringify(r.body));
  r = await res(await S.handleSalesInvoiceSend(req('POST', `/sales/invoices/${INV}/send`), customerSite, owner, INV, cors));
  ok('149: so is Send on an existing invoice', r.status === 403 && r.body.error === 'not_your_stripe');
  r = await res(await S.handleSalesRetainer(req('POST', `/sales/deals/${DEAL}/retainer`, { amount_cents: 50000, interval: 'month' }), customerSite, owner, DEAL, cors));
  ok('149: and a retainer', r.status === 403 && r.body.error === 'not_your_stripe');
  r = await res(await S.handleSalesSchedule(req('POST', `/sales/deals/${DEAL}/schedule`, { stages: [] }), customerSite, owner, DEAL, cors));
  ok('149: and a payment plan', r.status === 403 && r.body.error === 'not_your_stripe');
  r = await res(await S.handleSalesInvoiceSend(req('POST', `/sales/invoices/${INV}/send`), site, owner, INV, cors));
  ok('149: the studio’s own site sends as before', r.status === 200 && world.stripe.some((c) => c.path === 'payment_links' && c.method === 'POST'), JSON.stringify(r.body));
  Deno.env.delete('AGENCY_SITE_ID');
}

// ═══ 152. One clock ═══
{
  eq('152: the month on the studio’s day: 6 pm on Nov 30 in Burbank is still November (UTC says December)', [CK.monthIn('2026-12-01T02:00:00Z', 'America/Los_Angeles'), CK.monthIn('2026-12-01T02:00:00Z', null), CK.monthIn('2026-12-01T02:00:00Z', '')], ['2026-11', '2026-12', '2026-11']);
  ok('152: the morning rule', CK.morningYet({ hour: 9 }) && !CK.morningYet({ hour: 8 }) && CK.STUDIO_MORNING_HOUR === 9);
  const rev = SR.revenueByMonth([{ amount_cents: 50000, paid_at: '2026-12-01T02:00:00Z' }], '2026-12-02T00:00:00Z', [], [], 'America/Los_Angeles');
  ok('152: revenue by month, told the studio’s zone, counts that payment in November', rev.months.find((m) => m.month === '2026-11').this_year === 50000 && rev.months.find((m) => m.month === '2026-12').this_year === 0, JSON.stringify(rev.months.slice(-2)));
  const utc = SR.revenueByMonth([{ amount_cents: 50000, paid_at: '2026-12-01T02:00:00Z' }], '2026-12-02T00:00:00Z');
  ok('152: without a zone the pure report keeps UTC, as its older tests expect', utc.months.find((m) => m.month === '2026-12').this_year === 50000);
  ok('152: the refund words name the studio’s month', CR.monthOf('2026-12-01T02:00:00Z', 'America/Los_Angeles') === 'November' && CR.monthOf('2026-12-01T02:00:00Z') === 'December');
  seed({ invoices: [invoice({ status: 'paid', paid_at: '2026-11-01T02:00:00Z', stripe_url: 'https://pay.example/x' })] });   // 7 pm on Oct 31 in Burbank
  const rep = await res(await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors));
  const mo = (k) => (rep.body.data.revenue.months || []).find((m) => m.month === k);
  const inOct = (mo('2026-10') && mo('2026-10').this_year === 50000 * 2) || (mo('2027-10') && mo('2027-10').last_year === 100000);
  const notNov = !(mo('2026-11') && mo('2026-11').this_year > 0) && !(mo('2027-11') && mo('2027-11').last_year > 0);
  ok('152: the reports route counts that payment in October, the studio’s month (UTC would say November)', rep.status === 200 && inOct && notNov, JSON.stringify(rep.body.data.revenue));
  // the reminder sweep: on the studio's day, in its morning
  const dueInv = sent({ due_date: '2026-11-18', created_at: '2026-11-01T18:00:00Z', first_sent_at: '2026-11-01T18:00:00Z' });
  seed({ invoices: [dueInv], settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_remind_after_days: 2 }] });
  let r = await quiet(() => LC.runInvoiceReminders(20, Date.parse('2026-11-18T15:00:00Z')));   // 7 in the morning in Burbank
  ok('152: at 7 in the studio’s morning nothing goes yet', r.reminded === 0 && world.mail.length === 0, JSON.stringify(r));
  r = await quiet(() => LC.runInvoiceReminders(20, Date.parse('2026-11-18T18:00:00Z')));   // 10 in the morning
  ok('152: at 10 the "Due today" reminder goes, on the studio’s day', r.reminded === 1 && world.mail.length === 1 && /Due today/.test(world.mail[0].subject), JSON.stringify({ r, mail: world.mail.map((m) => m.subject) }));
  seed({ invoices: [dueInv], settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_remind_after_days: 2 }] });
  r = await quiet(() => LC.runInvoiceReminders(20, Date.parse('2026-11-18T02:00:00Z')));   // 6 pm on Nov 17 in Burbank, already Nov 18 in UTC
  ok('152: at 6 pm the evening before (UTC already on the due day) it is still "Coming up", never "Due today" (which used to go then)', r.reminded === 1 && world.mail.length === 1 && /Coming up/.test(world.mail[0].subject), JSON.stringify({ r, mail: world.mail.map((m) => m.subject) }));
  // the Invoices page: a refund comes off the month it happened
  const page = read('invoices.html');
  ok('152: the Invoices page takes a refund off the month it happened (the server’s returned rows), not the month the invoice was paid', /const hasBack=items\.some\(i=>Array\.isArray\(i\.returned\)\)/.test(page) && /pm:Math\.max\(0,keptSum\(pm\)-back\(month\)\)/.test(page) && /py:Math\.max\(0,keptSum\(py\)-back\(year\)\)/.test(page));
  seed({ invoices: [invoice({ status: 'paid', paid_at: '2026-10-20T18:00:00Z', refunded_cents: 100000, stripe_url: 'https://pay.example/x' })], returns: [{ id: 'r1', site_id: STUDIO.id, invoice_id: INV, applies_to: 'invoice', kind: 'refund', counted_cents: 100000, counted_at: '2026-11-03T20:00:00Z', status: 'succeeded' }] });
  const list = await res(await I.handleSalesInvoicesList(req('GET', '/sales/invoices?today=2026-11-18'), site, cors));
  eq('152: the invoice book carries each return with its day', list.body.data.items[0].returned, [{ cents: 100000, at: '2026-11-03T20:00:00Z', kind: 'refund' }]);
  // the page's totals, run on those rows
  const totalsSrc = page.slice(page.indexOf('function totals(items,today){'), page.indexOf('const plural='));
  const helpers = `const isPart=(i)=>!!i.payment_for;const kindOf=(i)=>i.status==='void'||i.status==='canceled'?'void':i.status==='paid'?'paid':'unpaid';const localDay=(iso)=>String(iso||'').slice(0,10);const dayDiff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);`;
  const totals = new Function(helpers + totalsSrc + ';return totals;')();
  const rows = [{ id: 'a', status: 'paid', paid_at: '2026-10-20', amount_cents: 100000, refunded_cents: 100000, returned: [{ cents: 100000, at: '2026-11-03T20:00:00Z' }] }, { id: 'b', status: 'paid', paid_at: '2026-11-10', amount_cents: 60000, refunded_cents: 0, returned: [] }];
  ok('152: paid in October $1,000, refunded in November: October shows $1,000, November shows $600 less the $1,000 that went back (floored at $0)', totals(rows, '2026-10-25').pm === 100000 && totals(rows, '2026-11-18').pm === 0 && totals(rows, '2026-11-18').py === 60000, JSON.stringify([totals(rows, '2026-10-25').pm, totals(rows, '2026-11-18').pm, totals(rows, '2026-11-18').py]));
  const old = [{ id: 'a', status: 'paid', paid_at: '2026-10-20', amount_cents: 100000, refunded_cents: 100000 }];
  ok('152: an older server (no returned rows) falls back to counting what was kept', totals(old, '2026-10-25').pm === 0);
}

// ═══ 157. The whole invoice on the Invoices page and in its download ═══
{
  const page = read('invoices.html');
  ok('157: the Amount column, the foot and the cards show the whole invoice (the row plus its part payments)', /const wholeOf=\(i\)=>\(Number\(i\.amount_cents\)\|\|0\)\+partsOf\(i\)\.reduce/.test(page) && /<td class="num amt">\$\{money\(wholeOf\(i\)\)\}/.test(page) && /reduce\(\(a,i\)=>a\+wholeOf\(i\),0\);   \/\/ sales item 157/.test(page) && /<span class="amt">\$\{money\(wholeOf\(i\)\)\}<\/span>/.test(page));
  const csvSrc = page.slice(page.indexOf('function csvCell(v){'), page.indexOf('function downloadCsv(){'));
  const csvCell = new Function(csvSrc + ';return csvCell;')();
  eq('157: a cell that starts like a formula is kept as text, a plain negative number is a number, commas are quoted', ['=SUM(A1)', '+1+1', '@cmd', '-99.00', 'Acme, Inc.', 'plain'].map(csvCell), ["'=SUM(A1)", "'+1+1", "'@cmd", '-99.00', '"Acme, Inc."', 'plain']);
  ok('157: the download has a Paid so far column and a row per part payment', /\['Number','Customer','Person','What for','Amount','Paid so far','Issued','Due','Status'\]/.test(page) && /'Part payment toward '\+\(i\.number_label\|\|i\.title\|\|'the invoice'\)/.test(page));
  const totalsSrc = page.slice(page.indexOf('function totals(items,today){'), page.indexOf('const plural='));
  ok('157: Owed still counts what is left on an invoice, not the whole', /return\{owed:sum\(open\)/.test(totalsSrc));
}

// ═══ 159. An invoice stuck on Processing ═══
{
  const pi = (over = {}) => ({ id: 'pi_s', object: 'payment_intent', status: 'processing', amount: 100000, currency: 'usd', created: 1_763_000_000, metadata: { presence_invoice_id: INV }, ...over });
  ok('159: the verdict: a payment that succeeded settles it; the newest having failed means a bounce; still processing, or nothing, means wait', SC.stuckPaymentVerdict(INV, [pi({ status: 'succeeded' })]).verdict === 'paid' && SC.stuckPaymentVerdict(INV, [pi({ status: 'requires_payment_method', last_payment_error: { code: 'x' } })]).verdict === 'failed' && SC.stuckPaymentVerdict(INV, [pi({ status: 'canceled' })]).verdict === 'failed' && SC.stuckPaymentVerdict(INV, [pi()]).verdict === 'processing' && SC.stuckPaymentVerdict(INV, []).verdict === 'unknown' && SC.stuckPaymentVerdict(INV, [pi({ metadata: { presence_invoice_id: INV2 }, status: 'canceled' })]).verdict === 'unknown');
  ok('159: the newest decides: a retry that is still processing after a failed one means wait', SC.stuckPaymentVerdict(INV, [pi({ id: 'pi_old', status: 'canceled', created: 10 }), pi({ id: 'pi_new', status: 'processing', created: 20 })]).verdict === 'processing' && SC.PROCESSING_DAYS === 4);
  const stuck = sent({ processing_since: '2026-11-10T18:00:00Z', stripe_url: null, stripe_payment_link_id: null, link_gen: 0, due_date: '2026-11-12' });
  const limits = { invoices: 0, retainers: 0, receipts: 0, returns: 0 };
  seed({ invoices: [stuck], pis: { [INV]: [pi({ status: 'requires_payment_method', last_payment_error: { code: 'debit_not_authorized' } })] } });
  let r = await quiet(() => SC.runStripeCheck(limits, NOW));
  ok('159: five days on Processing and Stripe says the bank refused it: open again, the link number moved on, a fresh link made, the client and the studio told', r.processing_checked === 1 && r.processing_bounced === 1 && r.errors === 0 && inv().processing_since === null && inv().link_gen === 1 && /^https:\/\/pay\.example\/new-/.test(inv().stripe_url) && world.mail.some((m) => /didn’t go through/.test(m.subject)) && notices((n) => /Bank payment bounced/.test(n.headline)).length === 1, JSON.stringify({ r, inv: inv(), mail: world.mail.map((m) => m.subject) }));
  seed({ invoices: [stuck], pis: { [INV]: [pi({ status: 'succeeded', amount_received: 100000 })] } });
  r = await quiet(() => SC.runStripeCheck(limits, NOW));
  ok('159: …and when Stripe says it did land, the invoice is paid', r.processing_checked === 1 && r.invoices_paid === 1 && inv().status === 'paid', JSON.stringify({ r, inv: inv() }));
  seed({ invoices: [stuck], pis: { [INV]: [pi()] } });
  r = await quiet(() => SC.runStripeCheck(limits, NOW));
  ok('159: still processing: nothing changes', r.processing_checked === 1 && r.processing_bounced === 0 && inv().processing_since === stuck.processing_since);
  seed({ invoices: [sent({ processing_since: '2026-11-17T18:00:00Z' })], pis: { [INV]: [pi({ status: 'canceled' })] } });
  r = await quiet(() => SC.runStripeCheck(limits, NOW));
  ok('159: one day on Processing is normal for a bank payment: not asked about yet', r.processing_checked === 0 && inv().processing_since !== null);
  seed({ invoices: [stuck], pis: {} });
  world.refuse.add('payment_intents/search');
  r = await quiet(() => SC.runStripeCheck(limits, NOW));
  ok('159: Stripe not answering is counted, never a change', r.stripe_unanswered === 1 && r.processing_bounced === 0 && inv().processing_since !== null);
}

// ═══ 160. A revised proposal's old version can't be accepted ═══
{
  const items = [{ label: 'Website', qty: 1, unit_cents: 300000 }];
  const named = [{ id: PROP2, line_items: [...items, { __meta__: { revised_from: PROP1 } }] }];
  ok('160: the rule: a newer version naming this one as revised', S.supersededByNewer(PROP1, named) && !S.supersededByNewer(PROP1, [{ id: PROP2, line_items: items }]) && !S.supersededByNewer(PROP1, []) && !S.supersededByNewer(PROP1, [{ id: PROP1, line_items: [...items, { __meta__: { revised_from: PROP1 } }] }]));
  // the old version, its "superseded" stamp lost; the new draft names it
  const old = { id: PROP1, site_id: STUDIO.id, deal_id: DEAL, title: 'Website', status: 'sent', line_items: items, subtotal_cents: 300000, currency: 'usd', version: 1, sent_at: '2026-11-01T00:00:00Z', deleted_at: null, created_at: '2026-11-01T00:00:00Z' };
  const newer = { id: PROP2, site_id: STUDIO.id, deal_id: DEAL, title: 'Website', status: 'draft', line_items: [...items, { __meta__: { revised_from: PROP1 } }], subtotal_cents: 300000, currency: 'usd', version: 2, deleted_at: null, created_at: '2026-11-02T00:00:00Z' };
  const token = await S.signSalesToken({ t: 'proposal', id: PROP1, site_id: STUDIO.id, exp: Math.floor(Date.now() / 1000) + 3600 }, S.linkSecret());
  seed({ proposals: [old, newer] });
  let r = await res(await S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP1}/decide`, { token, decision: 'accepted', name: 'Riley Park' }), PROP1, cors));
  ok('160: accepting the old version is refused when the newer one names it, though its own stamp is missing', r.status === 409 && r.body.error === 'superseded' && db.tables.presence_proposals[0].status === 'sent', JSON.stringify(r.body));
  seed({ proposals: [old] });
  r = await res(await S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP1}/decide`, { token, decision: 'accepted', name: 'Riley Park' }), PROP1, cors));
  ok('160: with no newer version it accepts as before', r.status === 200 && db.tables.presence_proposals[0].status === 'accepted', JSON.stringify(r.body));
  seed({ proposals: [old, newer] });
  db.fail.add('presence_proposals');
  r = await res(await S.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP1}/decide`, { token, decision: 'accepted', name: 'Riley Park' }), PROP1, cors));
  db.fail.delete('presence_proposals');
  ok('160: a read that fails refuses rather than accepting and hoping', r.status !== 200);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILED:'); for (const r of results.filter((x) => !x.p)) console.log('  ' + r.n); Deno.exit(1); }
