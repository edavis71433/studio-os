// ── Sales item 134: a client's own Stripe reads the right numbers ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/client_stripe_134_test.mjs
//
// The Nov 15 2026 Stripe review (finding 8): the reader asked for charges?limit=100,
// counted up to the last hundred charges of any kind and any date as payments (failed
// and refunded ones included), and read a `total` Stripe never sends, so revenue was
// always blank. Now: the last 30 days, what went through less what was refunded, and
// what Stripe paid out. The provider stays 'planned' (connected_registry_test.mjs says
// what's left before anyone can connect it). Stripe is a fake; every number is made up.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
const C = '../../supabase/functions/presence/connected';
const { stripeAccountNumbers, majorUnits, STRIPE_WINDOW_DAYS } = await import(`${C}/stripe_account.ts`);
const { readStripeAccount, normalize, READ_STRATEGIES } = await import(`${C}/adapters.ts`);
const { providerByKey } = await import(`${C}/providers.ts`);
const { STRIPE_API_VERSION } = await import('../../supabase/functions/presence/commerce/stripe_shape.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const NOW = Date.parse('2026-11-16T12:00:00Z') / 1000;
const day = 86400;
const ch = (id, amount, o = {}) => ({ id, object: 'charge', amount, amount_captured: amount, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, captured: true, created: NOW - 2 * day, ...o });
const CHARGES = [
  ch('ch_1', 10000),                                                // $100 paid
  ch('ch_2', 25000, { amount_refunded: 5000, refunded: false }),   // $250 paid, $50 of it refunded
  ch('ch_3', 4000, { amount_refunded: 4000, refunded: true }),     // $40 paid and refunded in full
  ch('ch_4', 9900, { status: 'failed', paid: false, amount_captured: 0 }),   // a card that failed
  ch('ch_5', 7000, { captured: false, amount_captured: 0 }),       // held on the card, never taken
  ch('ch_6', 12000, { created: NOW - 45 * day }),                  // before the 30 days
  ch('ch_7', 3000, { currency: 'eur' }),                           // another currency
];
const PAYOUTS = [
  { id: 'po_1', object: 'payout', amount: 20000, currency: 'usd', status: 'paid', arrival_date: NOW - 5 * day },
  { id: 'po_2', object: 'payout', amount: 15000, currency: 'usd', status: 'in_transit', arrival_date: NOW + day },   // on its way
  { id: 'po_3', object: 'payout', amount: 8000, currency: 'usd', status: 'failed', arrival_date: NOW - 3 * day },
  { id: 'po_4', object: 'payout', amount: 30000, currency: 'usd', status: 'paid', arrival_date: NOW - 40 * day },   // before the 30 days
];

// ═══ 1. the numbers ═══
{
  const s = stripeAccountNumbers(CHARGES, PAYOUTS, NOW);
  ok('payments: only charges that went through in the last 30 days (not failed, not just held, not older)', s.payments === 3, String(s.payments));
  ok('revenue: what they took less what was refunded, in dollars ($100 + $250 − $50 + $40 − $40)', s.revenue === 300, String(s.revenue));
  ok('refunded is said on its own', s.refunded === 90, String(s.refunded));
  ok('paid out: only payouts that arrived in those days', s.paid_out === 200 && s.payouts === 1, JSON.stringify(s));
  ok('another currency is counted apart, never added in', s.currency === 'usd' && s.other_currency_payments === 1);
  ok('the window is 30 days', s.window_days === 30 && STRIPE_WINDOW_DAYS === 30);
  const y = stripeAccountNumbers([ch('ch_y', 5000, { currency: 'jpy' })], [], NOW);
  ok('a currency with no cents is read as it is (5000 yen, not 50)', y.currency === 'jpy' && y.revenue === 5000 && majorUnits(5000, 'usd') === 50);
  const none = stripeAccountNumbers([], [], NOW);
  ok('nothing yet is zeros, not blanks', none.payments === 0 && none.revenue === 0 && none.paid_out === 0 && none.currency === 'usd');
}

// ═══ 2. the read: the last 30 days, page by page, read only, version named ═══
const calls = [];
let pageSize = 3, failWith = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ method: (init.method || 'GET').toUpperCase(), path: u.pathname, q: u.searchParams, auth: new Headers(init.headers).get('Authorization'), version: new Headers(init.headers).get('Stripe-Version') });
  if (failWith) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: failWith });
  const list = u.pathname === '/v1/charges' ? CHARGES.filter((c) => c.created >= Number(u.searchParams.get('created[gte]')))
    : u.pathname === '/v1/payouts' ? PAYOUTS.filter((p) => p.arrival_date >= Number(u.searchParams.get('arrival_date[gte]'))) : [];
  const after = u.searchParams.get('starting_after');
  const start = after ? list.findIndex((x) => x.id === after) + 1 : 0;
  const data = list.slice(start, start + pageSize);
  return new Response(JSON.stringify({ object: 'list', data, has_more: start + pageSize < list.length }), { status: 200, headers: { 'content-type': 'application/json' } });
};
{
  const r = await readStripeAccount('site-1', 'rk_test_client_token', new Date(NOW * 1000));
  ok('the read answers the numbers', r.ok === true && r.raw.payments === 3 && r.raw.revenue === 300 && r.raw.paid_out === 200, JSON.stringify(r));
  const since = String(NOW - 30 * day);
  ok('it asks Stripe for the last 30 days only: charges by when they were made, payouts by when they arrive', calls.some((c) => c.path === '/v1/charges' && c.q.get('created[gte]') === since) && calls.some((c) => c.path === '/v1/payouts' && c.q.get('arrival_date[gte]') === since));
  ok('it follows the pages instead of stopping at the first hundred', calls.filter((c) => c.path === '/v1/charges').length === 2 && calls.some((c) => c.q.get('starting_after') === 'ch_3'));
  ok('every call only reads, with the client\'s own token and the version these shapes are read in', calls.every((c) => c.method === 'GET' && c.auth === 'Bearer rk_test_client_token' && c.version === STRIPE_API_VERSION));
  ok('nobody asks for a `total` any more, and no call asks for limit=100 without a date', calls.every((c) => c.q.get('created[gte]') || c.q.get('arrival_date[gte]')));
}
{
  calls.length = 0; failWith = 401;
  const r = await readStripeAccount('site-1', 'rk_test_client_token', new Date(NOW * 1000));
  ok('a refused token comes back as its status, so the card says reconnect', r.ok === false && r.status === 401);
  failWith = 0;
}
{
  calls.length = 0; pageSize = 1;
  const many = Array.from({ length: 1001 }, (_, i) => ch('chm_' + i, 100));
  CHARGES.splice(0, CHARGES.length, ...many);
  pageSize = 100;
  const r = await readStripeAccount('site-1', 'rk_test_client_token', new Date(NOW * 1000));
  ok('more than a month\'s worth of pages: it says so instead of showing a short number', r.ok === false && /more payments than Studio OS reads/.test(r.attention || ''));
}

// ═══ 3. what the card gets ═══
{
  const d = normalize('stripe_connect', { payments: 3, revenue: 300, refunded: 90, paid_out: 200, payouts: 1, currency: 'usd', window_days: 30 }, 'your payments');
  ok('the card gets the numbers by name', d.payments === 3 && d.revenue === 300 && d.refunded === 90 && d.paid_out === 200 && d.payouts === 1 && d.currency === 'usd' && d.window_days === 30, JSON.stringify(d));
  const old = normalize('stripe_connect', { object: 'list', data: [{}, {}], total: 5 }, 'your payments');
  ok('an old raw charge list is no longer read as a payment count', old.payments === undefined && old.revenue === undefined);
  ok('the read is registered for this provider', typeof READ_STRATEGIES.stripe_connect === 'function');
  const p = providerByKey('stripe_connect');
  ok('it still can\'t be connected: no Stripe Connect app is registered yet', p.status === 'planned');
  ok('what it says it reads is what it reads (no subscriptions)', JSON.stringify(p.reads) === JSON.stringify(['what you took in the last 30 days, less refunds', 'what Stripe paid out to your bank']));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
