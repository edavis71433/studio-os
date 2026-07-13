// ── Service retainers + agreement-renewal suite (PURE) ───────────────────────
// Payment code — tested thoroughly. Proves the frozen billing boundary holds:
//   • a retainer is tagged with a SERVICE purpose and NEVER reads as the SaaS rail
//     (and a SaaS subscription NEVER reads as the retainer rail);
//   • a mocked recurring SERVICE invoice/subscription event routes to the service
//     rail by purpose, so SaaS entitlement is untouched;
//   • amount/interval validation, status mapping, the cancel-is-final merge guard,
//     and the agreement-renewal threshold + send-once dedup.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/retainers_test.mjs
import {
  RETAINER_PURPOSE, isServiceRetainerMeta, billingRailFor, validateRetainerInput,
  retainerStatusFromStripe, mergeRetainerState,
  agreementRenewalWindow, agreementRenewalPeriod, agreementRenewalCopy,
} from '../../supabase/functions/presence/commerce/retainers.ts';
// The SaaS translator — imported ONLY to prove a retainer never feeds it a plan.
import { entitlementPatchFromSubscription } from '../../supabase/functions/presence/commerce/subscriptions.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. PURPOSE METADATA keeps a retainer OFF the SaaS rail ═══
{
  const retMeta = { purpose: RETAINER_PURPOSE, deal_id: 'd1', site_id: 's1' };
  const saasMeta = { plan: 'presence', term: 'monthly', client_id: 'c1' };
  ok('retainer metadata is recognized as a service retainer', isServiceRetainerMeta(retMeta) === true);
  ok('retainer via kind alias is recognized', isServiceRetainerMeta({ kind: RETAINER_PURPOSE }) === true);
  ok('SaaS plan metadata is NOT a service retainer', isServiceRetainerMeta(saasMeta) === false);
  ok('empty/undefined metadata is NOT a service retainer', !isServiceRetainerMeta(undefined) && !isServiceRetainerMeta(null) && !isServiceRetainerMeta({}));
  ok('billingRailFor: retainer → service_retainer', billingRailFor(retMeta) === 'service_retainer');
  ok('billingRailFor: SaaS → saas (isolation invariant)', billingRailFor(saasMeta) === 'saas');
  // The invariant, stated directly: the two rails are mutually exclusive.
  ok('a retainer is NEVER the saas rail; a saas sub is NEVER the retainer rail',
    billingRailFor(retMeta) !== 'saas' && billingRailFor(saasMeta) !== 'service_retainer');
}

// ═══ 2. A mocked recurring SERVICE invoice settles by purpose, not on SaaS ═══
{
  // A Stripe subscription-invoice event carrying the service purpose. The webhook +
  // billing-sync route ANY object whose metadata isServiceRetainerMeta to the
  // service rail BEFORE the SaaS branch — so entitlement is never reached.
  const retainerSub = { object: 'subscription', id: 'sub_ret', status: 'active', metadata: { purpose: RETAINER_PURPOSE, deal_id: 'd1', site_id: 's1' }, current_period_end: 1893456000 };
  const retainerInvoice = { object: 'invoice', subscription: 'sub_ret', subscription_details: { metadata: { purpose: RETAINER_PURPOSE } }, amount_paid: 50000 };
  ok('a recurring retainer SUBSCRIPTION event routes to the service rail', billingRailFor(retainerSub.metadata) === 'service_retainer');
  ok('a recurring retainer INVOICE event is detectable as a retainer (subscription_details)',
    isServiceRetainerMeta(retainerInvoice.subscription_details.metadata) === true);
  // And CRUCIALLY: the retainer carries NO plan/term, so even if the SaaS
  // translator were mistakenly handed it, it would produce no plan/term change to
  // any entitlement — defence in depth behind the purpose routing.
  const stray = entitlementPatchFromSubscription(retainerSub, new Date('2026-07-13T00:00:00Z'));
  ok('a retainer subscription yields NO SaaS plan/term (never mutates entitlement plan)',
    stray.plan === undefined && stray.term === undefined);

  // A genuine SaaS subscription still classifies as SaaS + still translates to a plan.
  const saasSub = { object: 'subscription', id: 'sub_saas', status: 'active', metadata: { plan: 'presence', term: 'monthly' }, current_period_end: 1893456000 };
  ok('a SaaS subscription still routes to the saas rail', billingRailFor(saasSub.metadata) === 'saas');
  const patch = entitlementPatchFromSubscription(saasSub, new Date('2026-07-13T00:00:00Z'));
  ok('a SaaS subscription still translates to its plan (retainers did not disturb SaaS)', patch.plan === 'presence' && patch.term === 'monthly' && patch.status === 'active');
}

// ═══ 3. amount + interval validation ═══
{
  ok('valid monthly retainer accepted', (() => { const r = validateRetainerInput(50000, 'month'); return r.ok && r.value.amount_cents === 50000 && r.value.interval === 'month'; })());
  ok('valid annual retainer accepted', (() => { const r = validateRetainerInput(120000, 'year'); return r.ok && r.value.interval === 'year'; })());
  ok('amount below $1.00 rejected', validateRetainerInput(50, 'month').ok === false);
  ok('non-numeric amount rejected', validateRetainerInput('abc', 'month').ok === false);
  ok('amount over $1,000,000 rejected', validateRetainerInput(100000001, 'month').ok === false);
  ok('bad interval rejected', validateRetainerInput(50000, 'week').ok === false);
  ok('amount is truncated to whole cents', (() => { const r = validateRetainerInput(1999.9, 'month'); return r.ok && r.value.amount_cents === 1999; })());
}

// ═══ 4. Stripe status → calm retainer status ═══
{
  ok('active/trialing → active', retainerStatusFromStripe('active') === 'active' && retainerStatusFromStripe('trialing') === 'active');
  ok('past_due/unpaid → past_due', retainerStatusFromStripe('past_due') === 'past_due' && retainerStatusFromStripe('unpaid') === 'past_due');
  ok('canceled/incomplete_expired → canceled', retainerStatusFromStripe('canceled') === 'canceled' && retainerStatusFromStripe('incomplete_expired') === 'canceled');
  ok('incomplete/unknown → pending', retainerStatusFromStripe('incomplete') === 'pending' && retainerStatusFromStripe('???') === 'pending');
}

// ═══ 5. cancel-is-final merge guard (no zombie resurrection) ═══
{
  const now = '2026-07-13T00:00:00.000Z';
  const canceled = { status: 'canceled', amount_cents: 50000, interval: 'month', stripe_subscription_id: 'sub_1', canceled_at: '2026-07-10T00:00:00Z' };
  const late = mergeRetainerState(canceled, { status: 'active', current_period_end: '2026-08-13T00:00:00Z' }, now);
  ok('a late "active" webhook can NEVER resurrect a canceled retainer', late.status === 'canceled');
  ok('merge stamps updated_at + carries new fields (except the guarded status)', late.updated_at === now && late.current_period_end === '2026-08-13T00:00:00Z');
  // a normal pending → active transition is allowed
  const activated = mergeRetainerState({ status: 'pending', amount_cents: 50000, interval: 'month' }, { status: 'active', stripe_subscription_id: 'sub_x' }, now);
  ok('a pending retainer activates normally', activated.status === 'active' && activated.stripe_subscription_id === 'sub_x');
  // undefined patch fields never clobber prior state
  const kept = mergeRetainerState({ status: 'active', amount_cents: 50000, interval: 'month', stripe_subscription_id: 'sub_1' }, { current_period_end: undefined, stripe_customer_id: 'cus_1' }, now);
  ok('undefined patch fields do not clobber; defined ones apply', kept.amount_cents === 50000 && kept.stripe_customer_id === 'cus_1');
}

// ═══ 6. agreement-renewal threshold + send-once dedup + copy ═══
{
  const now = '2026-07-13T00:00:00.000Z';
  ok('no term_end → no reminder', agreementRenewalWindow(null, now) === null && agreementRenewalWindow(undefined, now) === null);
  ok('~40 days out → not yet (null)', agreementRenewalWindow('2026-08-22', now) === null);
  ok('~25 days out → the 30-day window', agreementRenewalWindow('2026-08-07', now) === 30);
  ok('~5 days out → the 7-day window', agreementRenewalWindow('2026-07-18', now) === 7);
  ok('exactly 7 days out → the 7-day window', agreementRenewalWindow('2026-07-20', now) === 7);
  ok('already past the term-end → no reminder (nothing auto-renews)', agreementRenewalWindow('2026-07-01', now) === null);
  // send-once: the period embeds term_end + window, so 30-day and 7-day each fire once
  const p30 = agreementRenewalPeriod('2026-08-07', 30), p7 = agreementRenewalPeriod('2026-07-18', 7);
  ok('the 30-day and 7-day notices dedup to distinct, stable period keys', p30 === '2026-08-07:30' && p7 === '2026-07-18:7' && p30 !== p7);
  ok('a re-dated agreement gets a fresh dedup key (new term-end → new period)', agreementRenewalPeriod('2027-01-01', 30) === '2027-01-01:30');
  const copy = agreementRenewalCopy('Retainer agreement', '2026-08-07', 30);
  ok('renewal copy names the agreement, the date, and promises no auto-renew',
    copy.headline.includes('Retainer agreement') && /August 7, 2026/.test(copy.body) && /never|automatically/i.test(copy.body) && copy.subject.length > 0);
}

// ═══ SUMMARY ═══
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); Deno.exit(1); }
