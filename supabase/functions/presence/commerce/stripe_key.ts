// ── The Stripe key Studio OS holds, and what it may do (sales item 131) ──────
// The Nov 15 2026 Stripe review (finding 5) found a full-power secret key named
// "Studio OS production" behind STRIPE_SECRET. Supabase shares that secret with every
// server function, the free tools that open other people's pages included, so a leak
// would let anyone refund payments, send payouts, read every client's details or move
// the webhook. Studio OS needs far less, and a restricted key can do only what it is
// given.
//
// KEY_NEEDS is the one list of what Studio OS asks Stripe to do, named the way Stripe's
// own permission table names it (docs.stripe.com/keys/permissions-reference), with the
// call that needs each one. KEY_MUST_NOT is what the key must be refused. Eric's steps
// for making the key (docs/presence/STRIPE-KEY.md) are written from these two lists, and
// tests/presence/stripe_key_131_test.mjs drives every money call and fails when one
// reaches Stripe on a path this list doesn't cover.
//
// checkStripeKey asks Stripe about each permission without making or changing anything:
//   a read          lists one item (GET ...?limit=1) and keeps nothing of the answer
//   a write         names an object that can't exist (price_StudioOSKeyCheck ...), so a
//                   key that may write gets "no such price" (404 or 400) and a key that
//                   may not gets Stripe's 403, which names the permission it lacks.
// Nothing can be made, changed or charged by any of them, whatever the key may do.
// Stripe's request log shows the writes as refused requests; that is expected.
import { fewAtATime } from '../lib/few_at_a_time.ts';

export type ProbeMethod = 'GET' | 'POST' | 'DELETE';
export interface Probe { method: ProbeMethod; path: string; params?: Record<string, string> }
export interface KeyPermission {
  id: string;          // Stripe's permission, e.g. plan_write ('rak_' + this in a 403)
  resource: string;    // the row in Stripe's "Create restricted API key" form, word for word (seen Nov 16 2026)
  level: 'Read' | 'Write';
  why: string;         // what Studio OS uses it for, in plain words
  calls: string[];     // every call it covers: METHOD /v1/path, ids as {id}
  probe: Probe;
}

const NO = 'StudioOSKeyCheck';   // part of every made-up id; no Stripe object is ever named this

export const KEY_NEEDS: readonly KeyPermission[] = [
  { id: 'plan_write', resource: 'Prices', level: 'Write', why: 'make the price behind each invoice and retainer link',
    calls: ['POST /v1/prices'], probe: { method: 'POST', path: `prices/price_${NO}` } },
  { id: 'product_write', resource: 'Products', level: 'Write', why: 'name what the price is for (Stripe makes the product with the price)',
    calls: [], probe: { method: 'POST', path: `products/prod_${NO}` } },
  { id: 'payment_links_write', resource: 'Payment Links', level: 'Write', why: 'make each invoice and retainer pay link, and switch one off when an invoice is withdrawn',
    calls: ['POST /v1/payment_links', 'POST /v1/payment_links/{id}'], probe: { method: 'POST', path: `payment_links/plink_${NO}` } },
  { id: 'subscription_write', resource: 'Subscriptions', level: 'Write', why: 'cancel a retainer or a plan, and read one back',
    calls: ['DELETE /v1/subscriptions/{id}', 'GET /v1/subscriptions/{id}', 'GET /v1/subscriptions'], probe: { method: 'POST', path: `subscriptions/sub_${NO}` } },
  { id: 'customer_portal_write', resource: 'Customer Portal', level: 'Write', why: 'open Stripe’s page where a client manages a plan or puts in a new card',
    calls: ['POST /v1/billing_portal/sessions'], probe: { method: 'POST', path: 'billing_portal/sessions', params: { customer: `cus_${NO}` } } },
  { id: 'checkout_session_read', resource: 'Checkout Sessions', level: 'Read', why: 'read back a payment page a client finished',
    calls: ['GET /v1/checkout/sessions/{id}', 'GET /v1/checkout/sessions'], probe: { method: 'GET', path: 'checkout/sessions', params: { limit: '1' } } },
  { id: 'payment_intent_read', resource: 'Payment Intents', level: 'Read', why: 'find which invoice a payment, refund or dispute belongs to',
    calls: ['GET /v1/payment_intents/{id}', 'GET /v1/payment_intents', 'GET /v1/payment_intents/search'], probe: { method: 'GET', path: 'payment_intents', params: { limit: '1' } } },
  { id: 'charge_read', resource: 'Charges and Refunds', level: 'Read', why: 'read a payment, its refunds and which invoice it paid',
    calls: ['GET /v1/charges/{id}', 'GET /v1/charges', 'GET /v1/refunds', 'GET /v1/refunds/{id}'], probe: { method: 'GET', path: 'charges', params: { limit: '1' } } },
  { id: 'dispute_read', resource: 'Payment Disputes', level: 'Read', why: 'read a dispute, its deadline and how it ended',
    calls: ['GET /v1/disputes/{id}', 'GET /v1/disputes'], probe: { method: 'GET', path: 'disputes', params: { limit: '1' } } },
  { id: 'invoice_read', resource: 'Invoices', level: 'Read', why: 'read each monthly retainer charge',
    calls: ['GET /v1/invoices/{id}', 'GET /v1/invoices', 'GET /v1/invoice_payments'], probe: { method: 'GET', path: 'invoices', params: { limit: '1' } } },
  { id: 'balance_read', resource: 'Balance', level: 'Read', why: 'Stripe’s fee on each payment, for the bookkeeper file',
    calls: ['GET /v1/balance_transactions', 'GET /v1/balance_transactions/{id}'], probe: { method: 'GET', path: 'balance_transactions', params: { limit: '1' } } },
  { id: 'payout_read', resource: 'Payouts', level: 'Read', why: 'the list of what Stripe sent to your bank, for the bookkeeper file',
    calls: ['GET /v1/payouts', 'GET /v1/payouts/{id}'], probe: { method: 'GET', path: 'payouts', params: { limit: '1' } } },
];

export const KEY_MUST_NOT: readonly KeyPermission[] = [
  { id: 'charge_write', resource: 'Charges and Refunds', level: 'Write', why: 'refund a payment', calls: [], probe: { method: 'POST', path: `refunds/re_${NO}` } },
  { id: 'payout_write', resource: 'Payouts', level: 'Write', why: 'send money out of Stripe', calls: [], probe: { method: 'POST', path: `payouts/po_${NO}` } },
  { id: 'payment_intent_write', resource: 'Payment Intents', level: 'Write', why: 'charge a card', calls: [], probe: { method: 'POST', path: `payment_intents/pi_${NO}/capture` } },
  { id: 'customer_write', resource: 'Customers', level: 'Write', why: 'change a client’s details or saved cards', calls: [], probe: { method: 'POST', path: `customers/cus_${NO}` } },
  { id: 'webhook_write', resource: 'Webhook Endpoints, Event Destinations', level: 'Write', why: 'change where Stripe sends its messages', calls: [], probe: { method: 'POST', path: `webhook_endpoints/we_${NO}` } },
  { id: 'payment_method_configurations_write', resource: 'Payment Method Configurations', level: 'Write', why: 'change which ways to pay are switched on', calls: [], probe: { method: 'POST', path: `payment_method_configurations/pmc_${NO}` } },
];

/** Which permission covers a call Studio OS makes, or null when none on the list does.
 *  `call` is "METHOD /v1/path"; an id in the path matches {id}. Pure. */
export function permissionFor(call: string): KeyPermission | null {
  const [method, rawPath] = String(call || '').trim().split(/\s+/);
  const want = `${String(method || '').toUpperCase()} ${String(rawPath || '').split('?')[0].replace(/\/+$/, '')}`;
  const fits = (tpl: string) => new RegExp('^' + tpl.split('{id}').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$').test(want);
  return KEY_NEEDS.find((k) => k.calls.includes(want)) || KEY_NEEDS.find((k) => k.calls.some(fits)) || null;
}

/** What kind of key STRIPE_SECRET holds, from its prefix alone. The key itself is
 *  never returned or kept. Pure. */
export function stripeKeyKind(key: string): { kind: 'restricted' | 'secret' | 'none' | 'other'; live: boolean | null } {
  const k = String(key || '').trim();
  if (!k) return { kind: 'none', live: null };
  const m = k.match(/^(rk|sk)_(live|test)_/);
  if (!m) return { kind: 'other', live: null };
  return { kind: m[1] === 'rk' ? 'restricted' : 'secret', live: m[2] === 'live' };
}

export type ProbeVerdict = 'allowed' | 'refused' | 'key_rejected' | 'unknown';
/** What one answer says about the key. A write probe names an object that can't exist,
 *  so 400 or 404 means Stripe got past the permission check; 403 is the permission
 *  refused; 401 is a key Stripe doesn't accept at all. Pure. */
export function probeVerdict(status: number): ProbeVerdict {
  if (status >= 200 && status < 300) return 'allowed';
  if (status === 400 || status === 404) return 'allowed';
  if (status === 403) return 'refused';
  if (status === 401) return 'key_rejected';
  return 'unknown';
}

export interface KeyLine { id: string; resource: string; level: 'Read' | 'Write'; why: string; verdict: ProbeVerdict; ok: boolean }
export interface KeyReport {
  kind: 'restricted' | 'secret' | 'none' | 'other'; live: boolean | null;
  ok: boolean;                 // every need allowed, every must-not refused, a live restricted key
  needs: KeyLine[];            // ok = allowed
  must_not: KeyLine[];         // ok = refused
  summary: string;             // one plain sentence
  checked_at: string;
}

/** The report from the answers. Pure. */
export function keyReport(kind: ReturnType<typeof stripeKeyKind>, needs: ProbeVerdict[], mustNot: ProbeVerdict[], nowIso: string): KeyReport {
  const n = KEY_NEEDS.map((k, i) => ({ id: k.id, resource: k.resource, level: k.level, why: k.why, verdict: needs[i] || 'unknown', ok: needs[i] === 'allowed' }));
  const m = KEY_MUST_NOT.map((k, i) => ({ id: k.id, resource: k.resource, level: k.level, why: k.why, verdict: mustNot[i] || 'unknown', ok: mustNot[i] === 'refused' }));
  const missing = n.filter((x) => !x.ok && x.verdict === 'refused').length;
  const tooMuch = m.filter((x) => x.verdict === 'allowed').length;
  const unsure = [...n, ...m].filter((x) => x.verdict === 'unknown').length;
  const rejected = [...n, ...m].some((x) => x.verdict === 'key_rejected');
  const ok = kind.kind === 'restricted' && kind.live === true && n.every((x) => x.ok) && m.every((x) => x.ok);
  const summary = kind.kind === 'none' ? 'No Stripe key is set, so invoices can’t be paid online.'
    : rejected ? 'Stripe doesn’t accept this key. It may have been deleted or rolled in Stripe.'
    : ok ? 'A restricted key that can do everything Studio OS needs and nothing it was refused.'
    : missing ? `This key is missing ${missing} permission${missing === 1 ? '' : 's'} Studio OS needs, so some money steps would fail.`
    : tooMuch ? `This key can do ${tooMuch} thing${tooMuch === 1 ? '' : 's'} Studio OS never needs, such as ${m.find((x) => x.verdict === 'allowed')!.why}.`
    : kind.live === false ? 'This is a test key, so real payments can’t be taken.'
    : unsure ? `Stripe didn’t answer ${unsure} of the checks just now. Try again in a minute.`
    : 'This key works, but it isn’t a restricted key.';
  return { kind: kind.kind, live: kind.live, ok, needs: n, must_not: m, summary, checked_at: nowIso };
}

/** Ask Stripe about every permission on both lists. `kind` is commerce/stripe.ts's
 *  heldKeyKind() and `probe` its stripeProbe, so the key never leaves that file (a
 *  test hands in fakes). Never throws. */
export async function checkStripeKey(kind: ReturnType<typeof stripeKeyKind>, probe: (method: ProbeMethod, path: string, params?: Record<string, string>) => Promise<{ status: number }>, nowIso = new Date().toISOString()): Promise<KeyReport> {
  if (kind.kind === 'none') return keyReport(kind, [], [], nowIso);
  const all = [...KEY_NEEDS, ...KEY_MUST_NOT];
  const verdicts = await fewAtATime(all, 4, async (k) => probeVerdict((await probe(k.probe.method, k.probe.path, k.probe.params || {}).catch(() => ({ status: 0 }))).status));
  return keyReport(kind, verdicts.slice(0, KEY_NEEDS.length), verdicts.slice(KEY_NEEDS.length), nowIso);
}
