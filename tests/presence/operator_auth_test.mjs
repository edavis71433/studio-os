// ── P5 · first-class operator credential (x-operator-secret) ─────────────────
//   deno run --allow-env --allow-read --allow-net tests/presence/operator_auth_test.mjs
// The operator-secret branch resolves BEFORE any network call, so these run pure.
Deno.env.set('OPERATOR_SECRET', 'op-secret-xyz');
Deno.env.set('SCHEDULER_SECRET', 'sched-secret-abc');
const { resolvePrincipal } = await import('../../supabase/functions/_shared/auth.ts');

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const reqWith = (headers) => new Request('https://x/presence', { method: 'POST', headers });

// correct operator secret via header → system principal, role 'operator'
const p1 = await resolvePrincipal(reqWith({ 'x-operator-secret': 'op-secret-xyz' }), null);
ok('correct operator secret → kind system', p1.kind === 'system');
ok('operator principal is tagged role=operator (honest audit actor)', p1.role === 'operator');

// wrong secret + no JWT → public (fail-closed, not operator)
const p2 = await resolvePrincipal(reqWith({ 'x-operator-secret': 'WRONG' }), null);
ok('wrong operator secret → public, never operator', p2.kind === 'public' && p2.role !== 'operator');

// no header at all → public
const p3 = await resolvePrincipal(reqWith({}), null);
ok('no operator header → public', p3.kind === 'public');

// the service-role key is NOT an operator credential (defense-in-depth) — a caller
// presenting it as the operator header must still be denied
const p4 = await resolvePrincipal(reqWith({ 'x-operator-secret': Deno.env.get('SERVICE_ROLE_KEY') || 'svc' }), null);
ok('service-role value in the operator header → still public', p4.kind === 'public');

// the scheduler secret is NOT the operator secret (distinct credentials)
const p5 = await resolvePrincipal(reqWith({ 'x-operator-secret': 'sched-secret-abc' }), null);
ok('scheduler secret is not accepted as the operator secret', p5.kind === 'public');

// empty OPERATOR_SECRET must never let an empty header through (guarded by the &&)
const p6 = await resolvePrincipal(reqWith({ 'x-operator-secret': '' }), null);
ok('empty operator header never bypasses', p6.kind === 'public');

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPERATOR AUTH (P5): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
