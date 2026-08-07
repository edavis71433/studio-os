// ── P2-E post-audit hardening (structural) ───────────────────────────────────
//   deno run --allow-read tests/presence/audit_hardening_test.mjs
// Locks the fixes surfaced by the post-P2-E deep audit: AI-ceiling coverage on
// every generative path, the reconcile grace-clock fix (don't lapse a paying
// customer), and the deletion executor ordering.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const editor = read('supabase/functions/presence/routes/editor.ts');
const reviewer = read('supabase/functions/presence/reviewer/engine.ts');
const guardian = read('supabase/functions/presence/guardian/engine.ts');
const polish = read('supabase/functions/presence/concierge/polish.ts');
const sync = read('supabase/functions/presence/commerce/entitlement_sync.ts');
const deletion = read('supabase/functions/presence/commerce/deletion.ts');
const commerce = read('supabase/functions/presence/routes/commerce.ts');

// ── AI ceiling now covers ALL generative paths (was writer/visual/coach only) ──
ok('ceiling: editor turns away an over-ceiling tenant (429, no free fallback)', /const ceil = await checkAiCeiling\(site\.client_id\)/.test(editor) && /ceilingDenial\(cors\)/.test(editor));
ok('ceiling: reviewer skips the PAID model tier over ceiling, keeps free deterministic', /ceilingClear = \(await checkAiCeiling\(site\.client_id\)\)\.allowed/.test(reviewer) && /ceilingClear \? meterModel/.test(reviewer));
ok('ceiling: brand/guardian likewise gates only the paid tier', /ceilingClear = \(await checkAiCeiling\(site\.client_id\)\)\.allowed/.test(guardian) && /ceilingClear \? meterModel/.test(guardian));
ok('ceiling: concierge polish is skipped over ceiling (optional paid enhancement)', /if \(meter && !\(await checkAiCeiling\(meter\.clientId\)\)\.allowed\) return \{ text, polished: false \}/.test(polish));

// ── reconcile grace-clock fix: don't lapse a recovered paying customer ──
ok('reconcile: selects grace_until', /client_id,status,plan,current_period_end,cancel_at_period_end,grace_until,stripe_subscription_id/.test(sync));
ok('reconcile: driftsFrom compares grace PRESENCE (clears a stale anchor on recovery)', /graceState = /.test(sync) && /graceState\(stored\.grace_until\) !== graceState\(patch\.grace_until\)\) diffs\.push\('grace_until'\)/.test(sync));

// ── deletion executor: stop billing BEFORE revoking access ──
ok('deletion: cancels Stripe BEFORE flipping entitlement to deleted', deletion.indexOf('cancelSubscription(ent.stripe_subscription_id)') < deletion.indexOf("body: JSON.stringify({ status: 'deleted' })"));
ok('deletion: request reports created so the confirmation email sends once', /created: boolean/.test(deletion) && /created: !!row,/.test(deletion) && /if \(reqd\.created\)/.test(commerce));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E POST-AUDIT HARDENING (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
