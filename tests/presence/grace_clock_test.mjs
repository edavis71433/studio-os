// ── P2-E W9: grace-clock anchor + enforcement (L4, structural) ───────────────
//   deno run --allow-read tests/presence/grace_clock_test.mjs
// A past-due account gets 14 days of full+live grace. The bug: every past_due
// event reset grace_until to now+14, so the window slid forever and the account
// never lapsed — free service indefinitely. Anchor the clock, then enforce it.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sync = read('supabase/functions/presence/commerce/entitlement_sync.ts');
const life = read('supabase/functions/presence/commerce/lifecycle.ts');
const system = read('supabase/functions/presence/routes/system.ts');

// ── anchor (cleanup): the 14-day window can't slide forward forever ──
ok('anchor: reads the prior grace_until', /select=status,grace_until&limit=1/.test(sync) && /priorGrace = pr\.json\?\.\[0\]\?\.grace_until/.test(sync));
ok('anchor: keeps the EARLIER grace_until when still past-due (no sliding window)', /if \(patch\.grace_until && priorGrace && Date\.parse\(priorGrace\) < Date\.parse\(patch\.grace_until\)\)/.test(sync) && /body\['grace_until'\] = priorGrace/.test(sync));

// ── enforcement: when grace passes, the account lapses ──
ok('enforce: sweep reads grace_until', /client_id,status,trial_ends_at,stripe_subscription_id,updated_at,grace_until/.test(life));
ok('enforce: active + grace_until in the past → lapse', /e\.status === 'active' && e\.grace_until && Date\.parse\(e\.grace_until\) < Date\.parse\(nowIso\)/.test(life) && /status: 'lapsed'/.test(life));
ok('enforce: counted as grace_lapsed in the result (observable)', /grace_lapsed\+\+/.test(life) && /grace_lapsed: number/.test(life) && /grace_lapsed \}/.test(life));

// ── ordering: reconcile runs BEFORE lifecycle so enforcement sees fresh state ──
ok('order: billing reconcile runs before the lifecycle sweep in the tick', system.indexOf("await step('reconcile_billing'") > 0 && system.indexOf("await step('reconcile_billing'") < system.indexOf("await step('lifecycle'"));

// ── recovery still clears grace (via the pure mapper, unchanged) ──
ok('recovery: a non-past-due active status clears grace_until (patch mapper)', /status === 'active' && stripeStatus !== 'trialing'/.test(read('supabase/functions/presence/commerce/subscriptions.ts')));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W9 GRACE CLOCK (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
