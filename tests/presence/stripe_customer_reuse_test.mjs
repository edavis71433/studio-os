// ── P2-E W8: Stripe customer reuse + idempotency-key fix (L1, L2 structural) ──
//   deno run --allow-read tests/presence/stripe_customer_reuse_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const stripe = read('supabase/functions/presence/commerce/stripe.ts');

// L1 — reuse, don't duplicate
ok('L1: looks up an existing customer by email before checkout', /const existingCustomer = await findCustomerIdByEmail\(p\.email\)/.test(stripe));
ok('L1: passes `customer` when found, else `customer_email` (never both)', /if \(existingCustomer\) params\['customer'\] = existingCustomer;/.test(stripe) && /else params\['customer_email'\] = p\.email;/.test(stripe));
ok('L1: customer_email is no longer set unconditionally', !/'customer_email': p\.email,/.test(stripe));

// L2 — idempotency key can't collide across customers
ok('L2: idempotency key includes the unique clientId', /const idem = `signup-\$\{p\.signupId\}-\$\{p\.clientId\}-\$\{p\.plan\}-\$\{p\.term\}`/.test(stripe));
ok('L2: the old client-blind key (nosignup collision) is gone', !/`signup-\$\{p\.signupId\}-\$\{p\.plan\}-\$\{p\.term\}`/.test(stripe));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W8 STRIPE CUSTOMER REUSE (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
