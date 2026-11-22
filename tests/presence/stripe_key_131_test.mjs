// ── Sales items 131 and 132: the Stripe key and the ways to pay (Stripe review, Nov 15 2026) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/stripe_key_131_test.mjs
//
// 131: Studio OS held a full-power Stripe key. commerce/stripe_key.ts is now the one list
// of what it asks Stripe to do, the steps Eric followed to make a restricted key come from
// it, and the operators' Health Center asks Stripe about each permission without making
// or changing anything. The test that matters most drives every call commerce/stripe.ts
// can make against a fake Stripe and fails when one reaches a path the list doesn't
// cover: a restricted key would refuse that call in production.
// 132: a pay link named no ways to pay, so it offered whatever Stripe's settings had on,
// Klarna, Cash App Pay and Amazon Pay included. Every link now names card (with the wallets
// switched on in Stripe, Apple Pay today), Link and US bank payment.
// Stripe and the database are fakes; every name and number is made up.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('STRIPE_SECRET', 'rk_test_fake131');
Deno.env.set('SITE_URL', 'https://app.example');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const P = '../../supabase/functions/presence';
const stripe = await import(`${P}/commerce/stripe.ts`);
const { KEY_NEEDS, KEY_MUST_NOT, permissionFor, stripeKeyKind, probeVerdict, keyReport, checkStripeKey } = await import(`${P}/commerce/stripe_key.ts`);
const { STRIPE_API_VERSION } = await import(`${P}/commerce/stripe_shape.ts`);
const { summarizeHealthCenter } = await import(`${P}/lib/health_center.ts`);
const { handleAdmin } = await import(`${P}/routes/admin.ts`);

// ═══ the fake world: Stripe answers like Stripe, the rate limiter like rate_hit ═══
const calls = [];
let stripeAnswer = null;       // (method, path, body) => Response, for one test at a time
let rateOk = true;
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init?.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const body = Object.fromEntries(new URLSearchParams(String(init?.body || '')));
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, version: new Headers(init?.headers).get('Stripe-Version') });
    if (stripeAnswer) return stripeAnswer(method, u.pathname, body);
    if (u.pathname === '/v1/prices') return jres(200, { id: 'price_1' });
    if (u.pathname === '/v1/payment_links') return jres(200, { id: 'plink_1', url: 'https://pay.example/1' });
    if (u.pathname === '/v1/billing_portal/sessions') return jres(200, { id: 'bps_1', url: 'https://billing.example/1' });
    return jres(200, { id: 'x_1', object: 'list', data: [] });
  }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, rateOk);
  return method === 'GET' ? jres(200, []) : jres(201, []);
};
const linkCall = () => calls.find((c) => c.method === 'POST' && c.path === '/v1/payment_links');
const typesOf = (body) => Object.keys(body).filter((k) => /^payment_method_types\[\d+\]$/.test(k)).sort().map((k) => body[k]);

// ═══ 132: the ways to pay a link offers ═══
{
  calls.length = 0;
  await stripe.createServicePaymentLink({ amountCents: 120000, currency: 'usd', description: 'Website build', invoiceId: 'inv-1' });
  const link = linkCall();
  ok('132: an invoice link names exactly card, Link and US bank payment', !!link && JSON.stringify(typesOf(link.body)) === JSON.stringify(['card', 'link', 'us_bank_account']), JSON.stringify(link && typesOf(link.body)));
  ok('132: nothing else rides along: no Klarna, Cash App Pay or Amazon Pay', !!link && !Object.values(link.body).some((v) => /klarna|cashapp|amazon_pay/.test(String(v))));
  ok('132: the price itself carries no ways to pay (they belong on the link)', calls.filter((c) => c.path === '/v1/prices').every((c) => typesOf(c.body).length === 0));
  ok('132: the link still pays this invoice once and tags the payment with it', link?.body['restrictions[completed_sessions][limit]'] === '1' && link?.body['payment_intent_data[metadata][presence_invoice_id]'] === 'inv-1');
}
{
  calls.length = 0;
  await stripe.createServicePaymentLink({ amountCents: 50000, currency: 'EUR', description: 'Logo', invoiceId: 'inv-2' });
  ok('132: a link in another currency leaves US bank payment off (it takes dollars only)', JSON.stringify(typesOf(linkCall()?.body || {})) === JSON.stringify(['card', 'link']));
}
{
  calls.length = 0;
  await stripe.createServiceRetainerLink({ productName: 'Retainer', amountCents: 40000, interval: 'month', dealId: 'deal-1', siteId: 'site-1', askedAt: '2026-11-16T10:00:00Z' });
  const link = linkCall();
  ok('132: a retainer link offers the same three ways to pay', !!link && JSON.stringify(typesOf(link.body)) === JSON.stringify(['card', 'link', 'us_bank_account']));
  ok('132: and still marks itself a retainer for the webhook', link?.body['subscription_data[metadata][purpose]'] === 'service_retainer');
}
ok('132: the one list says it in order: card, link, us_bank_account; dollars-only bank', JSON.stringify(stripe.payMethodTypes()) === JSON.stringify(['card', 'link', 'us_bank_account']) && JSON.stringify(stripe.payMethodTypes('gbp')) === JSON.stringify(['card', 'link']));

// ═══ 131: every call Studio OS can make is on the key's list ═══
// Every function commerce/stripe.ts exports is called, with an id where it takes one
// and a full set of details where it takes an object, so a call added later (a refund
// read, a daily check) is caught the day it lands.
{
  calls.length = 0;
  const NOT_CALLS = new Set(['stripeConfigured', 'heldKeyKind', 'payLinkKey', 'payMethodTypes', 'stripeProbe']);
  const details = { amountCents: 1000, currency: 'usd', description: 'x', invoiceId: 'inv-9', productName: 'x', interval: 'month', dealId: 'deal-9', siteId: 'site-9', askedAt: '2026-11-16T00:00:00Z' };
  const fns = Object.entries(stripe).filter(([name, fn]) => typeof fn === 'function' && !NOT_CALLS.has(name));
  for (const [, fn] of fns) {
    for (const arg of ['zz_KeyTest1', details]) { try { await fn(arg, 'https://app.example/back'); } catch { /* a fake answer some calls don't like; the call is what counts */ } }
  }
  const seen = [...new Set(calls.map((c) => `${c.method} ${c.path}`))];
  const uncovered = seen.filter((c) => !permissionFor(c));
  ok(`131: every Stripe call the code makes (${seen.length} kinds from ${fns.length} functions) is covered by the key's list`, seen.length >= 7 && uncovered.length === 0, `not covered: ${uncovered.join(', ')}`);
  ok('131: every call names the Stripe version the code reads', calls.length > 0 && calls.every((c) => c.version === STRIPE_API_VERSION));
}
ok('131: a call the list doesn\'t hold is caught (a refund is never made by Studio OS)', permissionFor('POST /v1/refunds') === null && permissionFor('POST /v1/payouts') === null);
ok('131: an id in a path matches its call', permissionFor('DELETE /v1/subscriptions/sub_123')?.id === 'subscription_write' && permissionFor('GET /v1/payment_intents/pi_9?expand[]=latest_charge')?.id === 'payment_intent_read' && permissionFor('POST /v1/payment_links/plink_1')?.id === 'payment_links_write');
ok('131: no permission is on both lists', !KEY_NEEDS.some((k) => KEY_MUST_NOT.some((m) => m.id === k.id)));
ok('131: the key may not refund, pay out, charge a card, change a client, move the webhook or the ways to pay',
  ['charge_write', 'payout_write', 'payment_intent_write', 'customer_write', 'webhook_write', 'payment_method_configurations_write'].every((id) => KEY_MUST_NOT.some((m) => m.id === id)));
ok('131: a write question names an object that can\'t exist, so a key that may write still makes nothing',
  [...KEY_NEEDS, ...KEY_MUST_NOT].filter((k) => k.probe.method !== 'GET').every((k) => /StudioOSKeyCheck/.test(k.probe.path + JSON.stringify(k.probe.params || {}))));
ok('131: a read question asks for one item', KEY_NEEDS.filter((k) => k.probe.method === 'GET').every((k) => k.probe.params?.limit === '1'));
// Eric made the key from docs/presence/STRIPE-KEY.md: its table and this list are two
// hand-kept copies, so the table must hold exactly these rows (text_checks_allowed.json)
{
  const doc = Deno.readTextFileSync(new URL('../../docs/presence/STRIPE-KEY.md', import.meta.url));
  const rows = [...doc.matchAll(/^\| ([^|]+) \| (Read|Write) \| ([^|]+) \|$/gm)].map((m) => `${m[1].trim()}|${m[2]}|${m[3].trim()}`);
  ok('131: Eric\'s steps list exactly the permissions the code needs, worded the same', JSON.stringify(rows) === JSON.stringify(KEY_NEEDS.map((k) => `${k.resource}|${k.level}|${k.why}`)), JSON.stringify(rows));
}

// the kind of key, from its prefix alone
{
  const r = stripeKeyKind('rk_live_abc'), s = stripeKeyKind('sk_live_abc'), t = stripeKeyKind('rk_test_abc');
  ok('131: rk_live is a live restricted key, sk_live a live full-power one, rk_test a test one', r.kind === 'restricted' && r.live === true && s.kind === 'secret' && s.live === true && t.kind === 'restricted' && t.live === false);
  ok('131: nothing set reads as none; a publishable key or junk as other', stripeKeyKind('').kind === 'none' && stripeKeyKind('pk_live_x').kind === 'other' && stripeKeyKind('hello').kind === 'other');
  ok('131: the answer never holds the key', !JSON.stringify(stripeKeyKind('rk_live_SECRETPART')).includes('SECRETPART'));
  ok('131: heldKeyKind reads the key this function holds', stripe.heldKeyKind().kind === 'restricted' && stripe.heldKeyKind().live === false);
}
ok('131: a 400 or 404 to a made-up id means the permission is there; 403 means refused; 401 a key Stripe rejects',
  probeVerdict(200) === 'allowed' && probeVerdict(400) === 'allowed' && probeVerdict(404) === 'allowed' && probeVerdict(403) === 'refused' && probeVerdict(401) === 'key_rejected' && probeVerdict(0) === 'unknown' && probeVerdict(500) === 'unknown' && probeVerdict(429) === 'unknown');

// the check, against keys of each kind
const restrictedStripe = (lacking = []) => async (method, rawPath, params) => {
  const path = String(rawPath).replace(/^\/v1\//, '');   // the check passes its own path; the route test passes Stripe's
  const must = KEY_MUST_NOT.find((k) => k.probe.path === path);
  const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});   // two reads share balance_transactions; the check's params tell them apart
  const need = KEY_NEEDS.find((k) => k.probe.path === path && (params === undefined || same(k.probe.params, params)));
  if (must || (need && lacking.includes(need.id))) return { status: 403 };
  return { status: method === 'GET' ? 200 : 404 };
};
{
  const rep = await checkStripeKey({ kind: 'restricted', live: true }, restrictedStripe());
  ok('131: a key made from the steps passes: every need allowed, every must-not refused', rep.ok && rep.needs.every((x) => x.ok) && rep.must_not.every((x) => x.ok));
  ok('131: and says so plainly', /can do everything Studio OS needs/.test(rep.summary));
}
{
  const rep = await checkStripeKey({ kind: 'restricted', live: true }, restrictedStripe(['balance_read']));
  const line = rep.needs.find((x) => x.id === 'balance_read');
  ok('131: a key missing one permission fails and names it', !rep.ok && line && !line.ok && line.verdict === 'refused' && /missing 1 permission/.test(rep.summary));
}
{
  const rep = await checkStripeKey({ kind: 'restricted', live: true }, restrictedStripe(['balance_transaction_source_read']));
  const src = rep.needs.find((x) => x.id === 'balance_transaction_source_read'), bal = rep.needs.find((x) => x.id === 'balance_read');
  ok('Nov 22: a key with Balance but not Balance Transaction Sources fails and names it (how the bookkeeper file and the Stripe card were refused)', !rep.ok && src && src.verdict === 'refused' && bal && bal.ok && /missing 1 permission/.test(rep.summary), rep.summary);
}
{
  calls.length = 0;
  await stripe.listPaymentBalanceTransactions(1_794_000_000, 1_794_086_400, 1);
  const q = calls.find((c) => c.path === '/v1/balance_transactions')?.query || {};
  const need = KEY_NEEDS.find((k) => k.id === 'balance_transaction_source_read');
  ok('Nov 22: the bookkeeper file\'s and the Stripe card\'s read asks for each payment\'s source, and the key check asks the same way', q['expand[]'] === 'data.source' && need?.resource === 'Balance Transaction Sources' && need.level === 'Read' && need.probe.path === 'balance_transactions' && need.probe.params?.['expand[]'] === 'data.source' && need.probe.params?.limit === '1', JSON.stringify(q));
}
{
  const rep = await checkStripeKey({ kind: 'secret', live: true }, async (m) => ({ status: m === 'GET' ? 200 : 404 }));
  ok('131: today\'s full-power key fails: it could refund, pay out and more', !rep.ok && rep.must_not.every((x) => !x.ok && x.verdict === 'allowed') && /can do 6 things Studio OS never needs, such as refund a payment/.test(rep.summary), rep.summary);
}
{
  const rep = await checkStripeKey({ kind: 'restricted', live: true }, async () => ({ status: 401 }));
  ok('131: a deleted or rolled key reads as one Stripe doesn\'t accept', !rep.ok && /doesn’t accept this key/.test(rep.summary));
}
{
  let asked = 0;
  const rep = await checkStripeKey({ kind: 'none', live: null }, async () => { asked++; return { status: 200 }; });
  ok('131: with no key set nothing is asked and it says invoices can\'t be paid online', asked === 0 && !rep.ok && /No Stripe key is set/.test(rep.summary));
}
{
  const rep = await checkStripeKey({ kind: 'restricted', live: true }, async () => { throw new Error('down'); });
  ok('131: Stripe not answering is an honest "didn\'t answer", never a pass', !rep.ok && rep.needs.every((x) => x.verdict === 'unknown') && /didn’t answer/.test(rep.summary));
}
{
  const rep = keyReport({ kind: 'restricted', live: false }, KEY_NEEDS.map(() => 'allowed'), KEY_MUST_NOT.map(() => 'refused'), '2026-11-16T00:00:00Z');
  ok('131: a test key with the right permissions still isn\'t the live key', !rep.ok && /test key/.test(rep.summary));
}

// the probe itself: one status out, and only the permission name kept from Stripe's words
{
  calls.length = 0;
  stripeAnswer = () => jres(403, { error: { type: 'invalid_request_error', message: "The provided key 'rk_test_*****1234' does not have the required permissions for this endpoint on account 'acct_FAKE131'. Having the 'rak_payout_write' permission would allow this request to continue." } });
  const r = await stripe.stripeProbe('POST', 'payouts/po_StudioOSKeyCheck');
  ok('131: a refusal comes back as 403 and the permission it names', r.status === 403 && r.lacks === 'rak_payout_write');
  ok('131: nothing else of Stripe\'s message (part of the key, the account) is passed on', !/1234|acct_FAKE131|provided key/.test(JSON.stringify(r)));
  ok('131: the probe names the version and sends no body to a read', calls[0]?.version === STRIPE_API_VERSION);
  stripeAnswer = () => { throw new TypeError('network'); };
  const z = await stripe.stripeProbe('GET', 'charges', { limit: '1' });
  ok('131: a network failure is status 0, never a throw', z.status === 0 && z.lacks === null);
  stripeAnswer = null;
}

// the route on the operators' Health Center
const STAFF = { kind: 'staff', userId: 'u-staff', tenantId: 't', role: 'owner', email: 'op@example.test', jwt: 'j', requestId: 'r' };
{
  calls.length = 0;
  stripeAnswer = (method, path) => restrictedStripe()(method, path).then((x) => jres(x.status, x.status === 200 ? { object: 'list', data: [] } : { error: { message: 'nope' } }));
  const res = await handleAdmin(new Request('https://x/admin/stripe-key'), '/admin/stripe-key', 'GET', STAFF, {});
  const body = await res.json();
  ok('131: GET /admin/stripe-key answers the report', res.status === 200 && Array.isArray(body.data?.needs) && body.data.needs.length === KEY_NEEDS.length && body.data.must_not.length === KEY_MUST_NOT.length);
  ok('131: it asked Stripe one question per permission, nothing more', calls.length === KEY_NEEDS.length + KEY_MUST_NOT.length);
  ok('131: a test key in this function reads as not the live key', body.data.kind === 'restricted' && body.data.live === false && body.data.ok === false);
  ok('131: no write question could make anything (every POST names a made-up id)', calls.filter((c) => c.method !== 'GET').every((c) => /StudioOSKeyCheck/.test(c.path + JSON.stringify(c.body))));
  rateOk = false; calls.length = 0;
  const limited = await handleAdmin(new Request('https://x/admin/stripe-key'), '/admin/stripe-key', 'GET', STAFF, {});
  ok('131: pressed too often, it waits instead of asking Stripe again', limited.status === 429 && calls.length === 0);
  rateOk = true; stripeAnswer = null;
}

// the Health Center's card
{
  const base = { nowIso: '2026-11-16T12:00:00Z', cronLastRunAt: '2026-11-16T11:55:00Z', secretsMissingRequired: [], domainsWatched: 0, domainsExpiringSoon: 0, billing: { active: 1, paused: 0, lapsed: 0 }, aiConfigured: true, aiOpsThisMonth: 0, emailConfigured: true, sitesLive: 1, failedPublishes: 0, failedRuns: 0, activeNotices: 0, backupsVerified: true };
  const area = (k) => summarizeHealthCenter({ ...base, stripeKey: k }).areas.find((a) => a.key === 'stripe_key');
  ok('131: today\'s full-power key asks for a look', area({ kind: 'secret', live: true })?.state === 'attention' && /full-power/.test(area({ kind: 'secret', live: true }).detail));
  ok('131: a live restricted key is OK', area({ kind: 'restricted', live: true })?.state === 'ok');
  ok('131: no key is Off, a test key asks for a look', area({ kind: 'none', live: null })?.state === 'off' && area({ kind: 'restricted', live: false })?.state === 'attention');
  ok('131: a full-power key turns the page\'s overall to "needs a look"', summarizeHealthCenter({ ...base, stripeKey: { kind: 'secret', live: true } }).overall === 'attention' && summarizeHealthCenter({ ...base, stripeKey: { kind: 'restricted', live: true } }).overall === 'ok');
  ok('131: callers that don\'t pass the key see no new card', !summarizeHealthCenter(base).areas.some((a) => a.key === 'stripe_key'));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
