// ── Sales item 128: retainer charges get recorded (Stripe review, Nov 15 2026) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/stripe_retainer_charges_128_test.mjs
//
// The review found the Stripe account and its webhook on 2026-05-27.dahlia while
// the retainer code read the fields Stripe moved in 2025-03-31.basil, and the
// webhook not listening for the monthly charge at all. So no retainer charge was
// ever recorded, the client's portal said "No charges yet", no next charge date
// showed, and the studio was never told a client approved. Each block below fails
// on the code as it was. Events are built in the dahlia shape and signed the way
// Stripe signs them; Stripe, the mail service and the database are fakes. Every
// name and number is made up.
const SECRET = 'test-commerce-secret';
const HOOK_SECRET = 'whsec_test_fake_128';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');
Deno.env.set('STRIPE_WEBHOOK_SECRET', HOOK_SECRET);
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const P = '../../supabase/functions/presence';
const { STRIPE_API_VERSION, stripeMetaOf, stripeSubscriptionIdOf, subscriptionPeriodEnd, invoicePaidCents, invoicePaidAt } = await import(`${P}/commerce/stripe_shape.ts`);
const { createServicePaymentLink } = await import(`${P}/commerce/stripe.ts`);
const { retainerApproved, retainerApprovedPeriod, retainerApprovedCopy, retainerChargeRow, isRetainerChargeEvent, retainerTransition } = await import(`${P}/commerce/retainers.ts`);
const { handleCommerce } = await import(`${P}/routes/commerce.ts`);
const { clientRetainers } = await import(`${P}/routes/client_retainers.ts`);
const { retainerPayments } = await import(`${P}/lib/invoice_billing.ts`);
const { noticeTier } = await import(`${P}/lib/inbox_feed.ts`);
const { noticeHrefFor } = await import(`${P}/routes/workspace.ts`);
const { entitlementPatchFromSubscription } = await import(`${P}/commerce/subscriptions.ts`);

// the webhook is a served function: catch its handler instead of opening a port
let hook = null;
{ const realServe = Deno.serve; Deno.serve = (h) => { hook = h; return {}; }; await import('../../supabase/functions/stripe-webhook/index.ts'); Deno.serve = realServe; }

// ═══ the fake world ═══
const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const CUSTOMER = { client_id: '99999999-2222-4222-8222-999999999999' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const ASKED = '2026-11-15T10:00:00.000Z';
const PUBLIC = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const TABLES = { presence_deal_events: 'events', presence_plan_notices: 'notices', presence_deals: 'deals', presence_sites: 'sites', presence_identity: 'identity', stripe_webhook_events: 'hooks' };
const world = {};
const fail = { events: false, dealPatch: false };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const field = (row, key) => { if (key.includes('->>')) { const [a, b] = key.split('->>'); return row[a] && typeof row[a] === 'object' ? row[a][b] : undefined; } return row[key]; };
const test = (row, key, expr) => {
  const v = field(row, key);
  if (expr === 'is.null') return v === null || v === undefined;
  if (expr === 'not.is.null') return v !== null && v !== undefined;
  const dot = expr.indexOf('.'); const op = expr.slice(0, dot); const want = expr.slice(dot + 1);
  if (op === 'eq') return String(v ?? '') === want;
  if (op === 'neq') return String(v ?? '') !== want;
  if (op === 'like') return String(v ?? '').startsWith(want.replace(/\*$/, ''));
  if (op === 'in') return want.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  return true;
};
const SKIP = ['select', 'order', 'limit', 'offset', 'on_conflict'];
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init?.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    world.stripe.push({ method, path: u.pathname, version: new Headers(init?.headers).get('Stripe-Version') });
    if (u.pathname === '/v1/prices') return jres(200, { id: 'price_1' });
    if (u.pathname === '/v1/payment_links') return jres(200, { id: 'plink_1', url: 'https://pay.example/1' });
    return jres(200, { id: 'x' });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); world.mail.push({ to: String(b.to), subject: b.subject, html: b.html }); return jres(200, { id: 'm' }); }
  if (u.hostname !== 'example.supabase.co') { world.escaped.push(u.href); return jres(500, {}); }
  if (u.pathname === '/functions/v1/presence/commerce/billing-sync') {
    world.hops.push('billing-sync');
    return handleCommerce(new Request('https://x/commerce/billing-sync', { method: 'POST', headers: init.headers, body: init.body }), '/commerce/billing-sync', 'POST', PUBLIC, {});
  }
  if (u.pathname.startsWith('/functions/v1/')) { world.hops.push(u.pathname.split('/').pop()); return jres(200, { data: { notice: true } }); }
  const table = u.pathname.replace('/rest/v1/', '');
  const bucket = TABLES[table] ? world[TABLES[table]] : null;
  if (!bucket) return method === 'GET' ? jres(200, []) : jres(201, []);
  const hit = () => { let out = bucket.slice(); for (const [k, e] of u.searchParams) { if (SKIP.includes(k)) continue; out = out.filter((r) => test(r, k, e)); } return out; };
  if (method === 'GET') return jres(200, hit());
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (table === 'presence_deal_events' && fail.events) return jres(500, { message: 'down' });
    if (table === 'presence_plan_notices' && bucket.some((r) => r.client_id === body.client_id && r.kind === body.kind && r.period === body.period)) return jres(200, []);
    if (table === 'stripe_webhook_events' && bucket.some((r) => r.event_id === body.event_id)) return jres(200, []);
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...body }; bucket.push(row); return jres(201, [row]);
  }
  if (method === 'PATCH') {
    if (table === 'presence_deals' && fail.dealPatch) return jres(500, { message: 'down' });
    const rows = hit(); const patch = JSON.parse(init.body); for (const r of rows) Object.assign(r, patch); return jres(200, rows);
  }
  return jres(405, {});
};
const pendingRetainer = () => ({ status: 'pending', amount_cents: 50000, interval: 'month', stripe_subscription_id: null, stripe_customer_id: null, stripe_payment_link_id: 'plink_r', checkout_url: 'https://pay.example/r', current_period_end: null, created_at: ASKED, updated_at: ASKED, canceled_at: null });
const seed = (retainer = pendingRetainer()) => {
  Object.assign(world, { events: [], notices: [], hooks: [], stripe: [], mail: [], hops: [], escaped: [],
    deals: [{ id: DEAL, site_id: STUDIO.id, title: 'Website care', converted_client_id: CUSTOMER.client_id, retainer, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }],
    identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }] });
  fail.events = false; fail.dealPatch = false;
};
const deal = () => world.deals[0];
const charges = () => world.events.filter((e) => e.kind === 'invoice_paid' && e.detail?.retainer === true);
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

// a Stripe event, in the version the endpoint is on unless told otherwise, signed the way Stripe signs it
let evt = 0;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function stripeEvent(type, object, opt = {}) {
  const raw = JSON.stringify({ id: opt.id || `evt_128_${++evt}`, object: 'event', api_version: opt.version || '2026-05-27.dahlia', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const logged = [];
  const quiet = console.error, quietW = console.warn, quietL = console.log; console.error = (...a) => logged.push(a.join(' ')); console.warn = console.log = () => {};
  try { const res = await hook(new Request('https://x/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })); res.logged = logged; return res; }
  finally { console.error = quiet; console.warn = quietW; console.log = quietL; }
}
const META = { purpose: 'service_retainer', kind: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id };
const PAID_AT = 1794700800;   // 2026-11-15T00:00:00Z, the day Stripe took the charge
// a monthly charge as Stripe sends it since basil: the invoice's own metadata is
// EMPTY, and the subscription and its notes sit under parent.subscription_details
const invoice = (over = {}) => ({ id: 'in_1', object: 'invoice', customer: 'cus_1', currency: 'usd', status: 'paid', billing_reason: 'subscription_cycle', amount_due: 50000, amount_paid: 50000, status_transitions: { paid_at: PAID_AT }, metadata: {},
  parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } }, ...over });
// a subscription as Stripe sends it since basil: its period sits on its items
const subscription = (over = {}) => ({ id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', metadata: META, items: { object: 'list', data: [{ id: 'si_1', object: 'subscription_item', current_period_start: PAID_AT, current_period_end: PAID_AT + 30 * 86400 }] }, ...over });
const session = (over = {}) => ({ id: 'cs_r1', object: 'checkout.session', mode: 'subscription', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1', amount_total: 50000, currency: 'usd', metadata: META, ...over });

// ═══ one Stripe version, named on every call ═══
{
  ok('version: the code is written for the version the webhook endpoint is on', STRIPE_API_VERSION === '2026-05-27.dahlia');
  const hookSrc = read('supabase/functions/stripe-webhook/index.ts');
  ok('version: the webhook reads the same version (its own copy, held to this one)', hookSrc.includes(`const EXPECTED_STRIPE_VERSION = '${STRIPE_API_VERSION}';`));
  ok('version: the webhook header tells whoever sets up Stripe to listen for the monthly charge', /invoice\.paid, invoice\.payment_failed/.test(hookSrc));
  const stripeSrc = read('supabase/functions/presence/commerce/stripe.ts');
  ok('version: every Stripe call goes through one function, and it names the version', (stripeSrc.match(/\bfetch\(/g) || []).length === 1 && /'Stripe-Version': STRIPE_API_VERSION/.test(stripeSrc));
  seed();
  await createServicePaymentLink({ amountCents: 1000, description: 'Invoice', invoiceId: '44444444-4444-4444-8444-444444444444' });
  ok('version: a real call carries it', world.stripe.length === 2 && world.stripe.every((c) => c.version === STRIPE_API_VERSION), JSON.stringify(world.stripe));
}

// ═══ reading Stripe's current shape, and the old one ═══
{
  ok('shape: an invoice\'s empty metadata no longer hides its subscription\'s notes', stripeMetaOf(invoice()).deal_id === DEAL);
  ok('shape: the older invoice shape still reads', stripeMetaOf({ object: 'invoice', metadata: {}, subscription: 'sub_old', subscription_details: { metadata: META } }).deal_id === DEAL);
  ok('shape: a subscription and a checkout session carry their own notes', stripeMetaOf(subscription()).site_id === STUDIO.id && stripeMetaOf(session()).purpose === 'service_retainer');
  ok('shape: which subscription, in every shape', stripeSubscriptionIdOf(invoice()) === 'sub_1' && stripeSubscriptionIdOf({ object: 'invoice', subscription: 'sub_old' }) === 'sub_old' && stripeSubscriptionIdOf(subscription()) === 'sub_1' && stripeSubscriptionIdOf(session()) === 'sub_1' && stripeSubscriptionIdOf({ object: 'invoice' }) === '');
  ok('shape: the next charge date from the items, the latest of them, or the old top-level field',
    subscriptionPeriodEnd(subscription()) === PAID_AT + 30 * 86400
    && subscriptionPeriodEnd({ items: { data: [{ current_period_end: 5 }, { current_period_end: 9 }] } }) === 9
    && subscriptionPeriodEnd({ current_period_end: 7 }) === 7 && subscriptionPeriodEnd({}) === null);
  ok('shape: what an invoice took, and when', invoicePaidCents(invoice()) === 50000 && invoicePaidCents(invoice({ amount_paid: 0 })) === 0 && invoicePaidCents({}) === null && invoicePaidAt(invoice()) === '2026-11-15T00:00:00.000Z' && invoicePaidAt({}) === null);
  ok('charge events: invoice.paid and its older name; a failure is not a charge', isRetainerChargeEvent('invoice.paid') && isRetainerChargeEvent('invoice.payment_succeeded') && !isRetainerChargeEvent('invoice.payment_failed'));
  ok('a $0 invoice is not a charge', retainerChargeRow(invoice({ amount_paid: 0 }), { dealId: DEAL, siteId: STUDIO.id, interval: 'month', fallbackCents: 50000 }) === null);
  const r = retainerChargeRow(invoice(), { dealId: DEAL, siteId: STUDIO.id, interval: 'month', fallbackCents: 1 });
  ok('a charge row carries its Stripe invoice and the day Stripe took it', r.detail.stripe_invoice === 'in_1' && r.detail.amount_cents === 50000 && r.detail.retainer === true && r.created_at === '2026-11-15T00:00:00.000Z');
  ok('approval: only waiting to live; a recovery stays the dunning rail\'s', retainerApproved('pending', 'active') && !retainerApproved('active', 'active') && !retainerApproved('past_due', 'active') && retainerTransition('pending', 'active') === null);
  ok('approval copy names the deal, the amount and how often', retainerApprovedCopy('Website care', 50000, 'month').headline === 'Retainer approved: Website care, $500.00 a month');
}

// ═══ the client approves: the studio is told, once, as news ═══
{
  seed();
  const r = await stripeEvent('checkout.session.completed', session());
  await settle();
  ok('approve: Stripe is answered 200 and the retainer is live on its subscription', r.status === 200 && deal().retainer.status === 'active' && deal().retainer.stripe_subscription_id === 'sub_1', JSON.stringify(deal().retainer));
  const n = world.notices.find((x) => x.period === retainerApprovedPeriod(DEAL, ASKED));
  ok('approve: the studio gets a line, on the Updates tier like money landing', !!n && n.kind === 'invoice_paid' && noticeTier(n.kind) === 'update' && n.headline === 'Retainer approved: Website care, $500.00 a month', JSON.stringify(world.notices));
  ok('approve: a tap opens the deal\'s Billing', noticeHrefFor({ kind: n?.kind, period: n?.period }) === `/pipeline.html?deal=${DEAL}&dtab=billing`);
  const m = world.mail.filter((x) => x.to === 'owner@studio.example');
  ok('approve: and an email, once', m.length === 1 && /^Retainer approved: Website care/.test(m[0].subject), JSON.stringify(world.mail.map((x) => x.subject)));
  await stripeEvent('customer.subscription.created', subscription());
  await stripeEvent('customer.subscription.updated', subscription());
  await settle();
  ok('approve: the subscription events that follow raise nothing more', world.notices.filter((x) => /approved/.test(x.period)).length === 1 && world.mail.length === 1);
  ok('approve: the next charge date comes from the subscription\'s items', deal().retainer.current_period_end === new Date((PAID_AT + 30 * 86400) * 1000).toISOString(), String(deal().retainer.current_period_end));
  ok('approve: nothing escaped to the outside world', world.escaped.length === 0, world.escaped.join(' '));
}

// ═══ each monthly charge is recorded, once, everywhere it counts ═══
{
  seed({ ...pendingRetainer(), status: 'active', stripe_subscription_id: 'sub_1', current_period_end: '2026-12-15T00:00:00.000Z' });
  const r = await stripeEvent('invoice.paid', invoice());
  ok('charge: Stripe is answered 200, through the retainer rail', r.status === 200 && world.hops.includes('billing-sync'));
  ok('charge: it is on the deal, with its amount, its Stripe invoice and the day Stripe took it',
    charges().length === 1 && charges()[0].detail.amount_cents === 50000 && charges()[0].detail.stripe_invoice === 'in_1' && charges()[0].created_at === '2026-11-15T00:00:00.000Z', JSON.stringify(world.events));
  await stripeEvent('invoice.payment_succeeded', invoice());
  await stripeEvent('invoice.paid', invoice());
  ok('charge: the same charge under its older name, or sent again, is recorded once', charges().length === 1);
  await stripeEvent('invoice.paid', invoice({ id: 'in_zero', amount_paid: 0, amount_due: 0 }));
  ok('charge: a $0 invoice records nothing', charges().length === 1);
  await stripeEvent('invoice.paid', invoice({ id: 'in_2', status_transitions: { paid_at: PAID_AT + 30 * 86400 } }));
  ok('charge: next month\'s charge is its own line', charges().length === 2);
  ok('charge: revenue, the weekly email and the bookkeeper file count both', retainerPayments(world.events).reduce((a, p) => a + p.amount_cents, 0) === 100000);
  const portal = await clientRetainers(CUSTOMER.client_id);
  ok('charge: the client\'s portal shows both charges and the next charge date, not "No charges yet"',
    portal.length === 1 && portal[0].charges.length === 2 && portal[0].next_charge === '2026-12-15T00:00:00.000Z' && portal[0].status === 'active', JSON.stringify(portal));
  ok('charge: a charge raises no line of its own (the deal and the portal carry it)', world.notices.length === 0);
}

// ═══ a charge that fails, in the new shape ═══
{
  seed({ ...pendingRetainer(), status: 'active', stripe_subscription_id: 'sub_1' });
  const r = await stripeEvent('invoice.payment_failed', invoice({ status: 'open', amount_paid: 0 }));
  await settle();
  ok('failed: the retainer is past due and the studio is told, as before', r.status === 200 && deal().retainer.status === 'past_due' && world.notices.some((x) => x.kind === 'retainer_status' && /:past_due:w\d+$/.test(x.period)), JSON.stringify(world.notices));
  ok('failed: a tap on that line opens the deal\'s Billing too', noticeHrefFor({ kind: 'retainer_status', period: world.notices.find((x) => x.kind === 'retainer_status')?.period }) === `/pipeline.html?deal=${DEAL}&dtab=billing`);
  ok('failed: nothing is recorded as a charge', charges().length === 0);
}

// ═══ a charge that didn't save is sent again by Stripe, and lands once ═══
{
  seed({ ...pendingRetainer(), status: 'active', stripe_subscription_id: 'sub_1' });
  fail.events = true;
  const first = await stripeEvent('invoice.paid', invoice(), { id: 'evt_retry_1' });
  ok('retry: a charge that didn\'t save answers Stripe 500, so Stripe sends it again', first.status === 500 && charges().length === 0 && world.hooks.find((h) => h.event_id === 'evt_retry_1')?.status === 'failed', `${first.status} ${JSON.stringify(world.hooks)}`);
  fail.events = false;
  const again = await stripeEvent('invoice.paid', invoice(), { id: 'evt_retry_1' });
  ok('retry: Stripe\'s next try records it, once', again.status === 200 && charges().length === 1 && world.hooks.find((h) => h.event_id === 'evt_retry_1')?.status === 'done');
  seed({ ...pendingRetainer(), status: 'active', stripe_subscription_id: 'sub_1' });
  fail.dealPatch = true;
  const down = await stripeEvent('customer.subscription.updated', subscription({ status: 'past_due' }));
  ok('retry: a retainer that didn\'t save asks again too, and tells nobody of a state it doesn\'t hold', down.status === 500 && world.notices.length === 0);
  seed();
  const stray = await stripeEvent('invoice.paid', invoice({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_unknown', metadata: { purpose: 'service_retainer' } } } }));
  ok('retry: an invoice for no retainer here is answered 200 and asks nothing again', stray.status === 200 && charges().length === 0);
}

// ═══ the older shape still lands (a resend from the dashboard, an old event) ═══
{
  seed({ ...pendingRetainer(), status: 'active', stripe_subscription_id: 'sub_1' });
  const r = await stripeEvent('invoice.payment_succeeded', { id: 'in_old', object: 'invoice', subscription: 'sub_1', amount_paid: 50000, metadata: {}, subscription_details: { metadata: META } }, { version: '2024-06-20' });
  ok('old shape: recorded', r.status === 200 && charges().length === 1 && charges()[0].detail.stripe_invoice === 'in_old');
  ok('old shape: and the log says the version differs', r.logged.some((l) => /VERSION MISMATCH/.test(l) && /2024-06-20/.test(l)), JSON.stringify(r.logged));
}

// ═══ the plan rail reads its renewal date the same way ═══
{
  const p = entitlementPatchFromSubscription(subscription({ metadata: { client_id: 'c1', plan: 'presence' } }), new Date('2026-11-15T00:00:00Z'));
  ok('plans: a studio\'s plan keeps its renewal date in the new shape', p.current_period_end === new Date((PAID_AT + 30 * 86400) * 1000).toISOString(), String(p.current_period_end));
  const q = entitlementPatchFromSubscription({ id: 'sub_x', status: 'active', current_period_end: PAID_AT, metadata: {} }, new Date());
  ok('plans: and in the old one', q.current_period_end === new Date(PAID_AT * 1000).toISOString());
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
