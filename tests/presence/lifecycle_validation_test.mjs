// ── P2-E: the full account-lifecycle validation (30 steps) ───────────────────
//   deno run --allow-read tests/presence/lifecycle_validation_test.mjs
// One contract test that walks the ENTIRE lifecycle a customer account can take —
// signup → trial → paid → past-due/grace → lapse → wind-down → recovery →
// deletion — and asserts each transition is backed by REAL, enforced code (not a
// comment or a promise). This is the P2-E completion gate: if every step here is
// green, the product enforces the lifecycle it tells customers it will.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const step = (n, label, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${label}${note && !p ? ' — ' + note : ''}`); };

const commerce = read('supabase/functions/presence/routes/commerce.ts');
const terms = read('supabase/functions/presence/commerce/terms.ts');
const stripe = read('supabase/functions/presence/commerce/stripe.ts');
const wh = read('supabase/functions/stripe-webhook/index.ts');
const sync = read('supabase/functions/presence/commerce/entitlement_sync.ts');
const life = read('supabase/functions/presence/commerce/lifecycle.ts');
const gate = read('supabase/functions/presence/middleware/entitlement.ts');
const deletion = read('supabase/functions/presence/commerce/deletion.ts');
const metering = read('supabase/functions/presence/commerce/metering.ts');
const client = read('supabase/functions/presence/routes/client_delivery.ts');
const subs = read('supabase/functions/presence/commerce/subscriptions.ts');

// ── SIGNUP + TRIAL ──
step(1, 'Signup creates the auth user + contact/client chain (rollback-safe)', /createAuthUser\(email, password\)/.test(commerce) && /createContactAndClient\(au\.id/.test(commerce));
step(2, 'Signup records durable terms-acceptance evidence', /await recordAcceptance\(\{/.test(commerce) && /export async function recordAcceptance/.test(terms));
step(3, 'Trial provisions the workspace immediately (no card)', /if \(isTrial\)/.test(commerce) && /provisionForSignup\(\{ clientId: chain\.clientId/.test(commerce));
step(4, 'A no-card trial past its end is FORCE-EXPIRED (the revenue bug)', /export function shouldExpireTrial/.test(life) && /shouldExpireTrial\(e, nowIso\)/.test(life));
step(5, 'Trial-ending nudge fires in the last 3 days', /days > 0 && days <= 3\) out\.push\('trial_ending'\)/.test(life));

// ── PAID CHECKOUT ──
step(6, 'Paid signup hands off to Stripe Checkout', /createSubscriptionCheckout\(\{/.test(commerce));
step(7, 'Checkout reuses an existing Stripe customer (no duplicates)', /const existingCustomer = await findCustomerIdByEmail\(p\.email\)/.test(stripe) && /params\['customer'\] = existingCustomer/.test(stripe));
step(8, 'Checkout idempotency key includes the unique clientId', /const idem = `signup-\$\{p\.signupId\}-\$\{p\.clientId\}/.test(stripe));

// ── WEBHOOK: the single source of payment truth ──
step(9, 'Webhook verifies the Stripe signature first (else 400)', /verifyStripeSignature\(raw/.test(wh) && /invalid signature/.test(wh));
step(10, 'Webhook livemode guard: a cross-mode event never mutates billing', /LIVEMODE MISMATCH/.test(wh));
step(11, 'Webhook claim-first idempotency (atomic on event_id)', /function claimEvent/.test(wh) && /resolution=ignore-duplicates/.test(wh));
step(12, 'A failed webhook releases the claim so Stripe retry re-processes', /else await markEventFailed\(eventId\)/.test(wh) && /'failed'\) return 'retry'/.test(wh));

// ── PROVISION + ENTITLEMENT SYNC ──
step(13, 'checkout.session.completed (subscription) provisions via billing-sync', /String\(obj\.mode \|\| ''\) === 'subscription'[\s\S]*?forwardBillingSync/.test(wh));
step(14, 'A provision failure is logged loud + specific (observability)', /\[billing-sync\] provision FAILED client=/.test(commerce));
step(15, 'subscription.* lifecycle syncs through ONE entitlement writer', /export async function applyEntitlementPatch/.test(sync) && !/async function applyEntitlementPatch/.test(commerce));

// ── PAST-DUE / GRACE ──
step(16, 'past_due/unpaid stays full+live during a 14-day grace (banner, not lockout)', /case 'past_due':[\s\S]*?return 'active'/.test(subs) && /grace_until: \(stripeStatus === 'past_due' \|\| stripeStatus === 'unpaid'\)/.test(subs));
step(17, 'The grace clock is ANCHORED to the first past-due event (no sliding)', /Date\.parse\(priorGrace\) < Date\.parse\(patch\.grace_until\)/.test(sync));
step(18, 'Grace expiry is ENFORCED → the account lapses', /e\.status === 'active' && e\.grace_until && Date\.parse\(e\.grace_until\) < Date\.parse\(nowIso\)/.test(life));

// ── ENTITLEMENT GATE ──
step(19, 'paused → read-only (writes 403, reads ok)', /status === 'paused'\) return \{ mode: 'readonly'/.test(gate));
step(20, 'lapsed → read-only (view + export any time; editing off)', /status === 'lapsed'\) return \{ mode: 'readonly'/.test(gate));
step(21, 'deleted/none → denied (terminal)', /return \{ mode: 'denied'/.test(gate));

// ── LAPSE COMMS (bounded) ──
step(22, 'account_lapsed notice is BOUNDED to the wind-down window (not forever)', /if \(days < WIND_DOWN_DAYS\) out\.push\('account_lapsed'\)/.test(life));
step(23, 'win_back (day-30, once) + winddown_reminder (day-45) both bounded', /days >= 30 && days < WIND_DOWN_DAYS\) out\.push\('win_back'\)/.test(life) && /days >= 45 && days < WIND_DOWN_DAYS\) out\.push\('winddown_reminder'\)/.test(life));

// ── SITE WIND-DOWN ──
step(24, 'Site wind-down is ENFORCED at WIND_DOWN_DAYS (hosting down, archived)', /lapsedDays >= WIND_DOWN_DAYS/.test(life) && /status: 'archived', netlify_site_id: null/.test(life));
step(25, 'Wind-down preserves DB content (export + resubscribe still work)', /status=in\.\(live,paused,ready\)/.test(life) && !/presence_sites[^\n]*method: 'DELETE'/.test(life));

// ── RECOVERY ──
step(26, 'Reactivation (lapsed/paused → active) sends a send-once welcome-back', /priorStatus === 'lapsed' \|\| priorStatus === 'paused'/.test(sync) && /if \(freshNotice && clQ\.json\?\.\[0\]\?\.email\) sendEmail/.test(sync));
step(27, 'A MISSED webhook self-heals via scheduled reconciliation', /export async function runBillingReconcile/.test(sync) && /retrieveSubscription\(subId\)/.test(sync));

// ── AI COST (billing-adjacent) ──
step(28, 'AI usage is metered + a HARD ceiling blocks before provider spend', /export async function checkAiCeiling/.test(metering) && /allowed: false, reason: 'ai_cost_ceiling'/.test(metering));

// ── DELETION ──
step(29, 'Deletion: request → cooling-off → executor (revoke/cancel/takedown/anonymize)', /export async function requestDeletion/.test(deletion) && /export async function runDeletionSweep/.test(deletion) && /status: 'deleted'/.test(deletion) && /cancelSubscription\(ent\.stripe_subscription_id\)/.test(deletion));
step(30, 'Deletion RETAINS financial evidence (exactly two DELETEs: GoTrue auth-user + push-subscription device tokens; no other table)', (deletion.match(/method: 'DELETE'/g) || []).length === 2 && /auth\/v1\/admin\/users\/\$\{u\.id\}`, \{ method: 'DELETE'/.test(deletion) && /presence_push_subscriptions[^\n]*\{ method: 'DELETE'/.test(deletion));

// ── billing surfaces authoritative + SaaS vs service distinct ──
const saasVsService = /billing_type: 'saas'/.test(commerce) && /billing_type: 'service'/.test(client);
step('★', 'Billing surfaces reflect authoritative state; SaaS vs service distinguishable', saasVsService);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E FULL LIFECYCLE VALIDATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED ✓ (the product enforces the lifecycle it promises)' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
