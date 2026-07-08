// ── L1 Self-Serve Signup & Commerce suite ───────────────────────────────────
// Pure tiers (run anywhere): the commercial ladder (seven rungs, ranks, self-
// serve honesty, founder rate-lock math, monthly/annual pricing, edition
// mapping, upgrade/downgrade rules) and the Stripe-subscription → entitlement
// translation across every lifecycle state (active, past-due grace, voluntary
// pause, cancellation, trial). Integration (staging) tiers live at the bottom
// and only run when SUPABASE_URL + keys are present.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/commerce_test.mjs
import {
  PLANS, planByKey, selfServePlans, isPlanKey, isTerm, priceCents, displayPrice,
  editionFor, changeKind, evaluateChange, stripeInterval, grantFounder, FOUNDERS_OPEN,
} from '../../supabase/functions/presence/commerce/catalog.ts';
import {
  mapStatus, entitlementPatchFromSubscription, trialEntitlementPatch,
} from '../../supabase/functions/presence/commerce/subscriptions.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. the ladder — seven rungs (Phase D1 added CMS-Only + Business-OS-Only) ═══
{
  ok('catalog: exactly seven rungs', PLANS.length === 7);
  const keys = PLANS.map((p) => p.key);
  ok('catalog: the rungs, in order', JSON.stringify(keys) === JSON.stringify(['presence_monitor', 'cms_only', 'business_os_only', 'presence', 'presence_managed', 'agency', 'enterprise']));
  const ranks = PLANS.map((p) => p.rank);
  ok('catalog: ranks are 1..7, unique and ascending', JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]));
  ok('catalog: CMS-Only + Business-OS-Only are self-serve, priced, trial-eligible',
    planByKey('cms_only').selfServe && planByKey('cms_only').monthly === 29 && planByKey('cms_only').founderMonthly === 24 && planByKey('cms_only').trialEligible &&
    planByKey('business_os_only').selfServe && planByKey('business_os_only').monthly === 29 && planByKey('business_os_only').trialEligible);
  ok('catalog: CMS-Only hosts a website (presence); Business-OS-Only does not (monitor)',
    planByKey('cms_only').edition === 'presence' && planByKey('business_os_only').edition === 'monitor');
  ok('catalog: Monitor/CMS/BusinessOS/Presence/Managed are self-serve; Agency/Enterprise are not (§3.10/§3.11)',
    planByKey('presence_monitor').selfServe && planByKey('presence').selfServe && planByKey('presence_managed').selfServe &&
    !planByKey('agency').selfServe && !planByKey('enterprise').selfServe);
  ok('catalog: self-serve plans expose a price; contact plans do not',
    selfServePlans().every((p) => p.monthly != null) && planByKey('agency').monthly === null && planByKey('enterprise').monthly === null);
  ok('catalog: Monitor/CMS/BusinessOS/Presence are trial-eligible (Managed is concierge)',
    planByKey('presence_monitor').trialEligible && planByKey('presence').trialEligible && !planByKey('presence_managed').trialEligible);
  ok('catalog: every rung has a plain-language tagline + features', PLANS.every((p) => p.tagline.length > 10 && p.features.length >= 3));
  ok('type guards: isPlanKey / isTerm', isPlanKey('presence') && isPlanKey('cms_only') && isPlanKey('business_os_only') && !isPlanKey('nope') && isTerm('monthly') && isTerm('annual') && !isTerm('weekly'));
}

// ═══ 2. pricing — founder rate-lock + annual discount, no metered anything ═══
{
  // annual charges 10 months (two free) — the "calm of not thinking about it" (§3.2)
  const m = priceCents('presence', 'monthly', false);
  const a = priceCents('presence', 'annual', false);
  ok('pricing: annual = 10× monthly (two months free)', a === m * 10);
  ok('pricing: founder rate is a real discount, still one product (§3.3)',
    priceCents('presence', 'monthly', true) < priceCents('presence', 'monthly', false) && planByKey('presence').founderMonthly < planByKey('presence').monthly);
  ok('pricing: cents are whole and positive', Number.isInteger(m) && m > 0);
  ok('pricing: display price is whole dollars', displayPrice('presence', 'monthly', false) === Math.round(m / 100));
  ok('pricing: contact plans have no online price', priceCents('agency', 'monthly', false) === null && priceCents('enterprise', 'annual', true) === null);
  ok('interval: term → Stripe interval', stripeInterval('monthly') === 'month' && stripeInterval('annual') === 'year');
  ok('founder gate: grantFounder tracks FOUNDERS_OPEN', grantFounder() === FOUNDERS_OPEN);
}

// ═══ 3. edition mapping + plan changes ═══
{
  ok('edition: Monitor→monitor, the rest→presence', editionFor('presence_monitor') === 'monitor' && editionFor('presence') === 'presence' && editionFor('presence_managed') === 'presence');
  ok('change kind: up/down/same by rank', changeKind('presence_monitor', 'presence') === 'upgrade' && changeKind('presence', 'presence_monitor') === 'downgrade' && changeKind('presence', 'presence') === 'same');
  const up = evaluateChange('presence_monitor', 'presence');
  ok('upgrade: allowed, immediate + prorated (§3.7)', up.allowed && up.timing === 'immediate');
  const down = evaluateChange('presence', 'presence_monitor');
  ok('downgrade: allowed but at renewal, never mid-cycle / never data loss (§3.6)', down.allowed && down.timing === 'at_renewal');
  ok('same plan: not a change', !evaluateChange('presence', 'presence').allowed);
  ok('to a contact plan: self-serve change is blocked (a sales conversation)', !evaluateChange('presence', 'agency').allowed && !evaluateChange('presence', 'enterprise').allowed);
  ok('from a contact plan: self-serve change is blocked', !evaluateChange('agency', 'presence').allowed);
}

// ═══ 4. Stripe status → entitlement status (the lifecycle ladder, §3.5) ═══
{
  ok('active/trialing → active', mapStatus('active') === 'active' && mapStatus('trialing') === 'active');
  ok('past_due/unpaid → active (grace: full + live, a banner not a lockout)', mapStatus('past_due') === 'active' && mapStatus('unpaid') === 'active');
  ok('paused → paused (voluntary hold, read-only)', mapStatus('paused') === 'paused');
  ok('canceled/incomplete → lapsed', mapStatus('canceled') === 'lapsed' && mapStatus('incomplete') === 'lapsed' && mapStatus('incomplete_expired') === 'lapsed');
  ok('unknown status → lapsed (fail safe)', mapStatus('who_knows') === 'lapsed');
}

// ═══ 5. subscription object → entitlement patch ═══
{
  const NOW = new Date('2026-07-07T00:00:00.000Z');
  const base = (over) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1783000000, cancel_at_period_end: false, metadata: { plan: 'presence', term: 'monthly', founder: 'true' }, ...over });

  const active = entitlementPatchFromSubscription(base(), NOW);
  ok('patch/active: status active, ids + period carried, no grace', active.status === 'active' && active.stripe_subscription_id === 'sub_1' && active.stripe_customer_id === 'cus_1' && active.current_period_end && active.grace_until === null);
  ok('patch/active: plan/term/founder read from metadata', active.plan === 'presence' && active.term === 'monthly' && active.founder === true);

  const pastDue = entitlementPatchFromSubscription(base({ status: 'past_due' }), NOW);
  const graceMs = new Date(pastDue.grace_until).getTime() - NOW.getTime();
  ok('patch/past_due: status stays active, grace ≈ 14 days out (§3.5)', pastDue.status === 'active' && Math.round(graceMs / 86400000) === 14);

  const canceled = entitlementPatchFromSubscription(base({ status: 'canceled', canceled_at: 1783500000 }), NOW);
  ok('patch/canceled: lapsed + canceled_at set', canceled.status === 'lapsed' && canceled.canceled_at !== null);

  const paused = entitlementPatchFromSubscription(base({ status: 'paused' }), NOW);
  ok('patch/paused: paused (read-only hold)', paused.status === 'paused');

  const trialing = entitlementPatchFromSubscription(base({ status: 'trialing', trial_end: 1783600000 }), NOW);
  ok('patch/trialing: active + trial clock carried', trialing.status === 'active' && trialing.trial_ends_at !== undefined && trialing.trial_ends_at !== null);

  const cape = entitlementPatchFromSubscription(base({ cancel_at_period_end: true }), NOW);
  ok('patch/cancel-at-period-end: still active, flag carried (lapses when it actually ends)', cape.status === 'active' && cape.cancel_at_period_end === true);

  const bad = entitlementPatchFromSubscription(base({ metadata: { plan: 'garbage', term: 'weekly', founder: 'maybe' } }), NOW);
  ok('patch/malformed metadata: unknown plan/term omitted (never corrupts a good plan)', bad.plan === undefined && bad.term === undefined && bad.founder === false);
}

// ═══ 6. trial entitlement (card-free) ═══
{
  const NOW = new Date('2026-07-07T00:00:00.000Z');
  const t = trialEntitlementPatch('presence', NOW, 14);
  const days = Math.round((new Date(t.trial_ends_at).getTime() - NOW.getTime()) / 86400000);
  ok('trial: active, 14-day clock, no card/stripe ids (§3.4 no upfront hostage)',
    t.status === 'active' && days === 14 && t.plan === 'presence' && t.stripe_customer_id === null && t.stripe_subscription_id === null && t.founder === false);
}

// ═══ SUMMARY ═══
const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ─────────────────────────────────────────────────────────────────────────────
// Integration (staging) tiers run only with credentials present. They exercise
// the live signup → provision → entitlement → subscription-sync path end to end.
const SB_URL = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const SERVICE = (globalThis.Deno && (Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || '';
const ANON = (globalThis.Deno && (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'))) || '';
if (!SB_URL || !SERVICE || !ANON) {
  console.log('\n(integration tiers skipped — set SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY to run)');
} else {
  await runIntegration({ SB_URL, SERVICE, ANON });
}

async function runIntegration({ SB_URL, SERVICE, ANON }) {
  const ires = [];
  const iok = (n, p, note = '') => { ires.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  [int] ${n}${note ? ' — ' + note : ''}`); };
  const FN = `${SB_URL}/functions/v1/presence`;
  const svcH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  // Public commerce calls still cross the functions gateway (verify_jwt on): the
  // anon key is a valid JWT that satisfies it; the real identity (when any) rides
  // in x-dds-user-jwt, exactly like the room's api() helper.
  const authH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const stamp = Date.now();
  const email = `l1-acceptance+${stamp}@example.com`;
  const password = 'meadow-lantern-4279-test';
  let signupRow = null, siteId = null, clientId = null, authUserId = null, jwt = null;

  try {
    // public: the catalog
    const plansR = await fetch(`${FN}/commerce/plans`, { headers: authH });
    const plans = await plansR.json();
    iok('GET /commerce/plans is public and lists seven rungs', plansR.status === 200 && plans?.data?.plans?.length === 7);

    // public: a Monitor trial signs up and provisions with no operator, no card
    const suR = await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'L1 Acceptance Co', plan: 'presence_monitor', trial: true }) });
    const su = await suR.json();
    iok('POST /commerce/signup (Monitor trial) provisions immediately', suR.status === 201 && su?.data?.mode === 'trial' && !!su?.data?.site_id, su?.error || '');
    siteId = su?.data?.site_id || null;

    // the funnel row exists and is marked provisioned
    const sgR = await fetch(`${SB_URL}/rest/v1/presence_signups?email=eq.${encodeURIComponent(email)}&select=id,status,client_id,site_id,auth_user_id,verify_token&limit=1`, { headers: svcH });
    signupRow = (await sgR.json())?.[0] || null;
    iok('signup funnel row is provisioned', signupRow?.status === 'provisioned' && signupRow?.site_id === siteId);
    clientId = signupRow?.client_id || null;
    authUserId = signupRow?.auth_user_id || null;

    // the entitlement is a Monitor plan, active, trial clock set
    const entR = await fetch(`${SB_URL}/rest/v1/presence_entitlements?client_id=eq.${clientId}&product=eq.presence&select=plan,status,trial_ends_at&limit=1`, { headers: svcH });
    const ent = (await entR.json())?.[0];
    iok('entitlement: plan=presence_monitor, status=active, trial clock set', ent?.plan === 'presence_monitor' && ent?.status === 'active' && !!ent?.trial_ends_at);

    // the site is a Monitor edition (hosts nothing) with starter rows seeded
    const siteR = await fetch(`${SB_URL}/rest/v1/presence_sites?id=eq.${siteId}&select=edition,status&limit=1`, { headers: svcH });
    const siteRow = (await siteR.json())?.[0];
    iok('site: Monitor edition, ready', siteRow?.edition === 'monitor' && siteRow?.status === 'ready');
    const brandR = await fetch(`${SB_URL}/rest/v1/presence_brand_profile?site_id=eq.${siteId}&select=site_id&limit=1`, { headers: svcH });
    const frR = await fetch(`${SB_URL}/rest/v1/presence_first_run?site_id=eq.${siteId}&select=site_id&limit=1`, { headers: svcH });
    iok('provisioning seeded brand profile + first-run rows', (await brandR.json())?.length === 1 && (await frR.json())?.length === 1);

    // duplicate signup is refused (never silently reuses an account)
    const dupR = await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'Dup', plan: 'presence_monitor', trial: true }) });
    iok('duplicate signup → 409 account_exists', dupR.status === 409);

    // email verify (non-blocking)
    if (signupRow?.verify_token) {
      const vR = await fetch(`${FN}/commerce/verify`, { method: 'POST', headers: authH, body: JSON.stringify({ token: signupRow.verify_token }) });
      iok('POST /commerce/verify marks the signup verified', vR.status === 200);
    }

    // sign in as the new customer and read their own subscription + first-run
    const signIn = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password }) });
    jwt = (await signIn.json())?.access_token || null;
    iok('the new account can sign in immediately', !!jwt);
    if (jwt) {
      const jH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': jwt, 'Content-Type': 'application/json' };
      const subR = await fetch(`${FN}/commerce/subscription`, { headers: jH });
      const sub = await subR.json();
      iok('GET /commerce/subscription (authed) returns their plan', subR.status === 200 && sub?.data?.plan === 'presence_monitor');
      const frGet = await fetch(`${FN}/commerce/first-run`, { headers: jH });
      const fr = await frGet.json();
      iok('GET /commerce/first-run returns a derived checklist', frGet.status === 200 && Array.isArray(fr?.data?.steps) && fr.data.steps.length === 4);
    }

    // billing-sync: an upgrade to Presence via a subscription event flips edition + plan
    if (clientId) {
      const secret = (Deno.env.get('BILLING_SYNC_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '');
      if (secret) {
        const evt = { type: 'customer.subscription.updated', object: { id: `sub_test_${stamp}`, customer: `cus_test_${stamp}`, status: 'active', current_period_end: 1793000000, cancel_at_period_end: false, metadata: { client_id: clientId, plan: 'presence', term: 'monthly', founder: 'false' } } };
        const bsR = await fetch(`${FN}/commerce/billing-sync`, { method: 'POST', headers: { ...authH, 'x-commerce-secret': secret }, body: JSON.stringify(evt) });
        iok('POST /commerce/billing-sync (subscription.updated) syncs the entitlement', bsR.status === 200);
        const ent2R = await fetch(`${SB_URL}/rest/v1/presence_entitlements?client_id=eq.${clientId}&product=eq.presence&select=plan,status,stripe_subscription_id&limit=1`, { headers: svcH });
        const ent2 = (await ent2R.json())?.[0];
        iok('entitlement now reflects the synced subscription', ent2?.plan === 'presence' && ent2?.stripe_subscription_id === `sub_test_${stamp}`);
      } else {
        iok('billing-sync tier skipped (no BILLING_SYNC_SECRET/SCHEDULER_SECRET)', true);
      }
    }
    // billing-sync rejects an unsigned caller
    const badBs = await fetch(`${FN}/commerce/billing-sync`, { method: 'POST', headers: authH, body: JSON.stringify({ type: 'noop', object: {} }) });
    iok('billing-sync without the shared secret → 403', badBs.status === 403);

  } finally {
    // teardown — leave the environment as clean as we found it
    try {
      if (siteId) await fetch(`${SB_URL}/rest/v1/presence_sites?id=eq.${siteId}`, { method: 'DELETE', headers: svcH });
      if (clientId) {
        await fetch(`${SB_URL}/rest/v1/presence_entitlements?client_id=eq.${clientId}`, { method: 'DELETE', headers: svcH });
        await fetch(`${SB_URL}/rest/v1/clients?id=eq.${clientId}`, { method: 'DELETE', headers: svcH });
      }
      await fetch(`${SB_URL}/rest/v1/presence_signups?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: svcH });
      if (authUserId) await fetch(`${SB_URL}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: svcH });
    } catch (_) { /* best-effort */ }
  }

  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
