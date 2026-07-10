// ── P2-E W7: billing-sync observability + reconciliation (M5, structural) ────
//   deno run --allow-read tests/presence/billing_reconcile_test.mjs
// The webhook can miss deliveries (outage, exhausted retries, livemode filter).
// Without a reconcile a customer could keep access after cancelling — or lose it
// after paying. And a silent provision failure is a lost customer. Lock both.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sync = read('supabase/functions/presence/commerce/entitlement_sync.ts');
const commerce = read('supabase/functions/presence/routes/commerce.ts');
const system = read('supabase/functions/presence/routes/system.ts');

// ── single-writer dedup (no drifting second copy of the apply) ──
ok('apply: applyEntitlementPatch now lives in ONE shared module', /export async function applyEntitlementPatch/.test(sync));
ok('apply: routes/commerce imports it instead of defining its own', /import \{ applyEntitlementPatch \} from '\.\.\/commerce\/entitlement_sync\.ts'/.test(commerce) && !/async function applyEntitlementPatch/.test(commerce));
ok('apply: keeps the lapsed/paused → active welcome-back (reactivation preserved)', /priorStatus === 'lapsed' \|\| priorStatus === 'paused'/.test(sync) && /welcome_back/.test(sync));

// ── reconciliation ──
ok('reconcile: re-derives truth from Stripe for entitlements with a live sub', /retrieveSubscription\(subId\)/.test(sync) && /stripe_subscription_id=not\.is\.null/.test(sync));
ok('reconcile: corrects only REAL drift (status/plan/cancel/period)', /function driftsFrom/.test(sync) && /if \(diffs\.length\)/.test(sync) && /applyEntitlementPatch\(String\(row\.client_id\), patch\)/.test(sync));
ok('reconcile: bounded + no-Stripe is a clean no-op + never throws', /Math\.min\(100, limit\)/.test(sync) && /if \(!stripeConfigured\(\)\) return/.test(sync) && /skipped_no_stripe: true/.test(sync) && /catch \(e\)/.test(sync));
ok('reconcile: an unreadable/deleted sub is skipped, not force-lapsed (safe)', /could not read subscription[\s\S]*?skipped/.test(sync));
ok('reconcile: logs corrections + failures (operator-visible)', /\[reconcile\] corrected client/.test(sync) && /\[reconcile\] FAILED to correct/.test(sync));

// ── observability on the sync path (M5) ──
ok('observe: provision failure is logged loud + specific, not just echoed 502', /\[billing-sync\] provision FAILED client=/.test(commerce));
ok('observe: no-client + successful sync both log a structured line', /could not resolve a client/.test(commerce) && /\[billing-sync\] \$\{type\} client=\$\{clientId\} → status=/.test(commerce));

// ── wired into the cron (owner scheduler) ──
ok('wiring: reconcile runs each default cron tick + has a named task', /const reconcile_billing = await runBillingReconcile\(30\)/.test(system) && /task === 'reconcile_billing'/.test(system) && /reconcile_billing,/.test(system));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W7 BILLING RECONCILE + OBSERVABILITY (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
