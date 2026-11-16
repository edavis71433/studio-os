// ── Sales item 129: when a retainer card fails, the client hears and can fix it ──
//   deno run --allow-read --allow-env --allow-net tests/presence/retainer_cards_129_test.mjs
//
// The Nov 15 2026 Stripe review (finding 3): when a retainer's monthly charge failed,
// the client was never told and had no way to put in a new card. Their portal said
// "message your studio", and the studio's line said to send a fresh approval link,
// which the deal refuses while the retainer is past due. Now the portal has Update your
// card, the deal and the record have Email the card link, and the emailed link opens
// card.html; all three open Stripe's own page for a new card. This drives the real
// routes and the real retainer sync against a pretend database, Stripe and mail
// service. Every name, number and address is made up.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('STRIPE_SECRET', 'sk_test_fake_129');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('APPROVAL_SECRET', 'test-link-secret-129');
const db = installFakePostgrest({ unique: { presence_plan_notices: [['client_id', 'kind', 'period']] } });

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Stripe and the mail service, pretend; everything else goes to the pretend database
const world = { stripe: [], mail: [], stripeAnswer: null, rateRefuse: false };
const fakeDb = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const body = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    world.stripe.push({ method, path: u.pathname, body, version: new Headers(init.headers).get('Stripe-Version') });
    const a = world.stripeAnswer ? world.stripeAnswer(u.pathname, body) : null;
    if (a) return a;
    if (u.pathname === '/v1/billing_portal/sessions') return jres(200, { id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/test_1' });
    return jres(404, { error: { message: 'unplanned Stripe call' } });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); world.mail.push({ to: String(b.to), subject: b.subject, html: String(b.html) }); return jres(200, { id: 'm' }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, !world.rateRefuse);
  return fakeDb(input, init);
};
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

const P = '../../supabase/functions/presence';
const { retainerPortalView, applyRetainerSync, retainerNoticeCopy } = await import(`${P}/commerce/retainers.ts`);
const { clientRetainers } = await import(`${P}/routes/client_retainers.ts`);
const { handleClientRetainerCard, handleSalesRetainerCardLink, handleRetainerCardOpen, signCardToken, readCardToken } = await import(`${P}/routes/retainer_card.ts`);
const { signSalesToken, verifySalesToken } = await import(`${P}/routes/sales.ts`);
const { readDocToken } = await import(`${P}/lib/documents.ts`);
const { STRIPE_API_VERSION } = await import(`${P}/commerce/stripe_shape.ts`);

// ═══ the fake world ═══
const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const CUSTOMER = { id: '55555555-5555-4555-8555-555555555555', client_id: '99999999-2222-4222-8222-999999999999' };
const OTHER = { id: '66666666-6666-4666-8666-666666666666', client_id: '77777777-7777-4777-8777-777777777777' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const SECRET = 'test-link-secret-129';
const META = { purpose: 'service_retainer', kind: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id };
const studioPrincipal = { kind: 'client', userId: 'u-studio', email: 'owner@studio.example', role: 'client', jwt: 'jwt-studio', requestId: 't' };
const clientPrincipal = { kind: 'client', userId: 'u-client', email: 'jordan@client.example', role: 'client', jwt: 'jwt-client', requestId: 't' };
const live = (over = {}) => ({ status: 'past_due', amount_cents: 50000, interval: 'month', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', stripe_payment_link_id: 'plink_r', checkout_url: 'https://pay.example/r', current_period_end: '2026-12-15T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-11-15T00:00:00.000Z', canceled_at: null, ...over });
function seed(retainer, o = {}) {
  db.reset({
    presence_sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }, { id: CUSTOMER.id, client_id: CUSTOMER.client_id }, { id: OTHER.id, client_id: OTHER.client_id }],
    presence_deals: [{ id: DEAL, site_id: o.dealSite || STUDIO.id, title: 'Website care', contact_id: CONTACT, converted_client_id: CUSTOMER.client_id, retainer, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    presence_contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Jordan Ellis', email: o.noEmail ? '' : 'jordan@client.example' }],
    presence_identity: [{ site_id: STUDIO.id, business_name: 'Test Studio', email: 'owner@studio.example' }],
    presence_deal_events: [],
    presence_plan_notices: [],
  });
  Object.assign(world, { stripe: [], mail: [], stripeAnswer: null, rateRefuse: false });
}
const post = (path, body = {}) => new Request(`https://x${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const stripeRefuses = () => { world.stripeAnswer = (path) => (path === '/v1/billing_portal/sessions' ? jres(400, { error: { message: 'You can’t create a portal session in live mode until you save your customer portal settings in live mode.' } }) : null); };
const nowSec = () => Math.floor(Date.now() / 1000);

// ═══ 1. the client's portal shows a card that can be put right ═══
{
  const view = (r) => retainerPortalView({ id: DEAL, title: 'Website care', retainer: r }, [{ at: '2026-10-15T00:00:00Z', amount: 500 }]);
  ok('portal: a past-due retainer offers Update your card, and still Cancel', view(live()).can_update_card === true && view(live()).can_cancel === true);
  ok('portal: so does an active one (a card about to expire)', view(live({ status: 'active' })).can_update_card === true);
  ok('portal: not one still waiting for approval, nor one that ended', view(live({ status: 'pending', stripe_customer_id: null })).can_update_card === false && view(live({ status: 'canceled' })).can_update_card === false);
  ok('portal: not before Stripe has named the customer', view(live({ status: 'active', stripe_customer_id: null })).can_update_card === false);
  seed(live());
  const mine = await clientRetainers(CUSTOMER.client_id);
  ok('portal: the client\'s own read carries it, and still no Stripe id leaves the server', mine.length === 1 && mine[0].can_update_card === true && !/cus_|sub_|plink_/.test(JSON.stringify(mine)), JSON.stringify(mine));
}

// ═══ 2. Update your card, on the client's portal ═══
{
  seed(live());
  const r = await answer(await handleClientRetainerCard(post(`/client/retainers/${DEAL}/card`), CUSTOMER, clientPrincipal, DEAL, {}));
  ok('update: the client gets Stripe\'s page', r.status === 200 && r.body?.data?.url === 'https://billing.stripe.com/p/session/test_1', JSON.stringify(r));
  const c = world.stripe[0] || { body: {} };
  ok('update: one call, to Stripe\'s customer portal, for this retainer\'s own customer', world.stripe.length === 1 && c.method === 'POST' && c.path === '/v1/billing_portal/sessions' && c.body.customer === 'cus_1', JSON.stringify(world.stripe));
  ok('update: the page opens on "update your payment method" and nothing else', c.body['flow_data[type]'] === 'payment_method_update' && c.body['flow_data[after_completion][type]'] === 'redirect');
  ok('update: a saved card comes back to the shelf with a thank-you; leaving comes back without one',
    c.body['flow_data[after_completion][redirect][return_url]'] === 'https://app.example/client.html?card=saved#invoices' && c.body.return_url === 'https://app.example/client.html#invoices', JSON.stringify(c.body));
  ok('update: the call names the Stripe version, like every call', c.version === STRIPE_API_VERSION);
  ok('update: nothing is written here and nobody is emailed: the card is Stripe\'s to keep', db.writes('presence_deals').length === 0 && db.writes('presence_plan_notices').length === 0 && world.mail.length === 0);

  seed(live({ status: 'active' }));
  ok('update: an active retainer\'s card can be changed too', (await answer(await handleClientRetainerCard(post('/'), CUSTOMER, clientPrincipal, DEAL, {}))).status === 200);

  seed(live());
  const theirs = await answer(await handleClientRetainerCard(post('/'), OTHER, clientPrincipal, DEAL, {}));
  ok('update: another client\'s retainer isn\'t there, and Stripe is never asked', theirs.status === 404 && world.stripe.length === 0);
  ok('update: nor is a made-up one', (await answer(await handleClientRetainerCard(post('/'), CUSTOMER, clientPrincipal, 'not-a-deal', {}))).status === 404);

  for (const [label, r, words] of [['waiting for approval', live({ status: 'pending', stripe_customer_id: null }), 'hasn’t started yet'], ['ended', live({ status: 'canceled', canceled_at: '2026-11-01T00:00:00Z' }), 'has ended'], ['with no Stripe customer yet', live({ stripe_customer_id: null }), 'message your studio']]) {
    seed(r);
    const out = await answer(await handleClientRetainerCard(post('/'), CUSTOMER, clientPrincipal, DEAL, {}));
    ok(`update: a retainer ${label} says so, and Stripe is never asked`, out.status === 409 && String(out.body?.message || '').includes(words) && world.stripe.length === 0, JSON.stringify(out));
  }

  seed(live());
  stripeRefuses();
  const refused = await quiet(async () => answer(await handleClientRetainerCard(post('/'), CUSTOMER, clientPrincipal, DEAL, {})));
  ok('update: Stripe saying no (its portal not saved yet) is a plain "try again or message your studio"', refused.status === 502 && /couldn’t open Stripe’s card page/.test(refused.body?.message || '') && !/portal settings/.test(JSON.stringify(refused.body)), JSON.stringify(refused));

  seed(live());
  db.fail.add('presence_deals');
  const down = await answer(await handleClientRetainerCard(post('/'), CUSTOMER, clientPrincipal, DEAL, {}));
  ok('update: a database that doesn\'t answer is "try again", never "not found"', down.status === 503 && world.stripe.length === 0);
}

// ═══ 3. Email the card link, on the deal ═══
{
  seed(live());
  const r = await answer(await handleSalesRetainerCardLink(post(`/sales/deals/${DEAL}/retainer/card-link`), STUDIO, studioPrincipal, DEAL, {}));
  const m = world.mail[0] || { html: '' };
  ok('email: the client gets it, at the deal\'s contact', r.status === 200 && r.body?.data?.emailed === true && world.mail.length === 1 && m.to === 'jordan@client.example', JSON.stringify(r));
  ok('email: a failed charge says so in the subject', m.subject === 'Your retainer payment didn’t go through');
  const url = String(r.body?.data?.url || '');
  ok('email: the link opens card.html on the app, and is the one in the email', url.startsWith('https://app.example/card.html?t=') && m.html.includes(url), url);
  const tok = await readCardToken(new URL(url).searchParams.get('t'), SECRET, nowSec());
  ok('email: the link names this deal on this studio\'s site', tok?.ok === true && tok.id === DEAL && tok.site_id === STUDIO.id, JSON.stringify(tok));
  const later = await readCardToken(new URL(url).searchParams.get('t'), SECRET, nowSec() + 29 * 86400);
  const tooLate = await readCardToken(new URL(url).searchParams.get('t'), SECRET, nowSec() + 31 * 86400);
  ok('email: the link lasts 30 days', later?.ok === true && tooLate?.ok === false && tooLate?.expired === true);
  ok('email: the studio is told where it went, without the whole address', r.body?.data?.to && r.body.data.to !== 'jordan@client.example' && r.body.data.to.endsWith('@client.example'), String(r.body?.data?.to));
  ok('email: the email names the amount and Stripe\'s own page, and greets them by name', m.html.includes('$500.00 a month') && m.html.includes('Stripe’s secure page') && m.html.includes('Hi Jordan,'));
  ok('email: Stripe isn\'t asked until the client opens the link', world.stripe.length === 0);

  seed(live({ status: 'active' }));
  await handleSalesRetainerCardLink(post('/'), STUDIO, studioPrincipal, DEAL, {});
  ok('email: for a live card, the subject asks them to update it', world.mail.length === 1 && world.mail[0].subject === 'Update the card for your retainer');

  seed(live(), { noEmail: true });
  const none = await answer(await handleSalesRetainerCardLink(post('/'), STUDIO, studioPrincipal, DEAL, {}));
  ok('email: no email on the contact: nothing is sent, and the link comes back to copy', none.status === 200 && none.body?.data?.emailed === false && none.body?.data?.reason === 'no_email' && /^https:\/\/app\.example\/card\.html\?t=/.test(none.body?.data?.url || '') && world.mail.length === 0, JSON.stringify(none));

  for (const [label, r, words] of [['still waiting for approval', live({ status: 'pending', stripe_customer_id: null }), 'Copy its approval link instead'], ['that ended', live({ status: 'canceled' }), 'Set it up again']]) {
    seed(r);
    const out = await answer(await handleSalesRetainerCardLink(post('/'), STUDIO, studioPrincipal, DEAL, {}));
    ok(`email: a retainer ${label} sends nothing and says what to do instead`, out.status === 409 && String(out.body?.message || '').includes(words) && world.mail.length === 0, JSON.stringify(out));
  }
  seed(live(), { dealSite: OTHER.id });
  ok('email: another studio\'s deal isn\'t there', (await answer(await handleSalesRetainerCardLink(post('/'), STUDIO, studioPrincipal, DEAL, {}))).status === 404 && world.mail.length === 0);
}

// ═══ 4. the link opens Stripe's page and nothing else ═══
{
  const good = await signCardToken(DEAL, STUDIO.id, nowSec(), SECRET);
  const [body, sig] = good.split('.');
  ok('link: our own link reads back', (await readCardToken(good, SECRET, nowSec()))?.ok === true);
  ok('link: a changed signature, or another secret, reads as nothing', (await readCardToken(`${body}.${sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')}`, SECRET, nowSec())) === null && (await readCardToken(good, 'another-secret', nowSec())) === null);
  ok('link: an agreement link can\'t open a card page', (await readCardToken(await signSalesToken({ t: 'flow', id: DEAL, site_id: STUDIO.id, exp: nowSec() + 999 }, SECRET), SECRET, nowSec())) === null);
  ok('link: a card link can\'t open an agreement or a document', (await verifySalesToken(good, SECRET, nowSec())) === null && (await readDocToken(good, SECRET)) === null);
}

// ═══ 5. opening the emailed link ═══
{
  seed(live());
  const token = await signCardToken(DEAL, STUDIO.id, nowSec(), SECRET);
  const r = await answer(await handleRetainerCardOpen(post('/retainer-card', { token }), {}));
  const c = world.stripe[0] || { body: {} };
  ok('open: a fresh Stripe page, for this retainer\'s customer', r.status === 200 && r.body?.data?.url === 'https://billing.stripe.com/p/session/test_1' && c.path === '/v1/billing_portal/sessions' && c.body.customer === 'cus_1' && c.body['flow_data[type]'] === 'payment_method_update', JSON.stringify(r));
  ok('open: Stripe brings them back to card.html, saying whether a card was saved', c.body['flow_data[after_completion][redirect][return_url]'] === 'https://app.example/card.html?done=1' && c.body.return_url === 'https://app.example/card.html?left=1');
  ok('open: the page wears the studio\'s name', r.body?.data?.studio?.name === 'Test Studio');
  ok('open: nothing is written, nobody is emailed', db.writes('presence_deals').length === 0 && world.mail.length === 0);

  seed(live());
  const old = await signCardToken(DEAL, STUDIO.id, nowSec() - 31 * 86400, SECRET);
  const ran = await answer(await handleRetainerCardOpen(post('/retainer-card', { token: old }), {}));
  ok('open: a link past its 30 days says so, and whom to ask', ran.status === 410 && ran.body?.error === 'expired' && /Ask Test Studio/.test(ran.body?.message || '') && world.stripe.length === 0, JSON.stringify(ran));
  ok('open: a made-up link reads as not right', (await answer(await handleRetainerCardOpen(post('/retainer-card', { token: 'abc.def' }), {}))).status === 404 && world.stripe.length === 0);

  seed(live({ status: 'canceled', canceled_at: '2026-11-01T00:00:00Z' }));
  const ended = await answer(await handleRetainerCardOpen(post('/retainer-card', { token }), {}));
  ok('open: a retainer that ended since the email says so', ended.status === 409 && /has ended/.test(ended.body?.message || '') && world.stripe.length === 0, JSON.stringify(ended));

  seed(live());
  stripeRefuses();
  const refused = await quiet(async () => answer(await handleRetainerCardOpen(post('/retainer-card', { token }), {})));
  ok('open: Stripe saying no is "try again in a minute"', refused.status === 502 && /try again in a minute/.test(refused.body?.message || ''), JSON.stringify(refused));

  seed(live());
  world.rateRefuse = true;
  const busy = await handleRetainerCardOpen(post('/retainer-card', { token }), {});
  ok('open: a burst of tries is slowed down before Stripe is asked', busy.status === 429 && world.stripe.length === 0);
}

// ═══ 6. the studio's line says what to do ═══
{
  const invoice = (over = {}) => ({ id: 'in_f1', object: 'invoice', customer: 'cus_1', currency: 'usd', status: 'open', billing_reason: 'subscription_cycle', amount_due: 50000, amount_paid: 0, metadata: {},
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: META } }, ...over });
  seed(live({ status: 'active' }));
  const r = await quiet(() => applyRetainerSync('invoice.payment_failed', invoice()));
  await settle();
  const n = db.tables.presence_plan_notices.find((x) => x.kind === 'retainer_status');
  ok('line: a failed charge is a line for the studio, as before', r.synced === true && !!n && db.tables.presence_deals[0].retainer.status === 'past_due', JSON.stringify(db.tables.presence_plan_notices));
  ok('line: it says to Email the card link, never to send a new approval the deal refuses', /Email the card link/.test(n?.body || '') && !/authorization link|approval link/.test(n?.body || '') && n?.headline === 'A retainer card didn’t go through: Website care', JSON.stringify(n));
  const mail = world.mail.find((x) => x.to === 'owner@studio.example') || { html: '' };
  ok('line: its email\'s button opens the deal\'s Billing, where that button is', mail.html.includes(`/pipeline.html?deal=${DEAL}&amp;dtab=billing`) || mail.html.includes(`/pipeline.html?deal=${DEAL}&dtab=billing`), mail.html.slice(0, 300));
  ok('line: and it no longer sends the studio to Stripe\'s dashboard to fix it', !mail.html.includes('dashboard.stripe.com'));

  seed(live());
  await quiet(() => applyRetainerSync('customer.subscription.deleted', { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'canceled', metadata: META, cancellation_details: { reason: 'payment_failed' } }));
  await settle();
  const e = db.tables.presence_plan_notices.find((x) => x.kind === 'retainer_status');
  ok('line: a retainer Stripe ended after its card kept failing says so, and how to start again', e?.headline === 'A retainer ended after its card kept failing: Website care' && /set up the retainer again/.test(e?.body || ''), JSON.stringify(e));

  const asked = retainerNoticeCopy('canceled', 'Website care', 50000, 'month', 'cancellation_requested');
  ok('line: an ending for any other reason reads as before', asked.headline === 'A retainer ended — Website care' && /won’t bill again/.test(asked.body));
  const esc = retainerNoticeCopy('past_due', '<b>Care</b>', 50000, 'month');
  ok('line: a deal name is never markup in the email', !esc.html.includes('<b>Care</b>') && esc.html.includes('&lt;b&gt;Care&lt;/b&gt;'));
}

// ═══ 7. the link works with no sign-in, through the real server ═══
{
  // std's serve() handed a fake listener: no socket opens (the scoped_commerce_test idiom)
  const queue = []; let wake = null;
  Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
  Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
  await import('../../supabase/functions/presence/index.ts');
  const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
  seed(live());
  const token = await signCardToken(DEAL, STUDIO.id, nowSec(), SECRET);
  const res = await send(new Request('https://db.test/functions/v1/presence/retainer-card', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://app.davisdigitalstudio.com' }, body: JSON.stringify({ token }) }));
  const out = { status: res.status, body: await res.json().catch(() => null) };
  ok('router: a client with no sign-in opens the link and gets Stripe\'s page', out.status === 200 && out.body?.data?.url === 'https://billing.stripe.com/p/session/test_1', JSON.stringify(out));
  const res2 = await send(new Request('https://db.test/functions/v1/presence/retainer-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'nope.nope' }) }));
  ok('router: a link that isn\'t ours is refused as a bad link, not a sign-in wall', res2.status === 404);
  const res3 = await send(new Request(`https://db.test/functions/v1/presence/client/retainers/${DEAL}/card`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  ok('router: the portal\'s own button still needs the client signed in', res3.status === 401 && world.stripe.length === 1);
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ RETAINER CARDS (item 129): ${results.length - failed.length}/${results.length} ${failed.length ? 'FAILED' : 'PASSED'} ════`);
if (failed.length) Deno.exit(1);
Deno.exit(0);
