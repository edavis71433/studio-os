// ── Approvals — pure decision logic (P2-D-2) ─────────────────────────────────
//   deno run --allow-read tests/presence/approvals_test.mjs
import { isDecision, isSubjectType, canDecideApproval, approvalHash } from '../../supabase/functions/presence/lib/approvals.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

ok('isDecision guards approve/reject/changes_requested', isDecision('approved') && isDecision('rejected') && isDecision('changes_requested') && !isDecision('maybe') && !isDecision(''));
ok('isSubjectType guards the enum', isSubjectType('deliverable') && isSubjectType('task') && isSubjectType('project') && isSubjectType('custom') && !isSubjectType('invoice'));
ok('canDecideApproval only from pending', canDecideApproval('pending') && !canDecideApproval('approved') && !canDecideApproval('superseded') && !canDecideApproval('rejected'));

const h1 = await approvalHash('deliverable', 'abc', 'v1');
const h2 = await approvalHash('deliverable', 'abc', 'v1');
const h3 = await approvalHash('deliverable', 'abc', 'v2');
ok('approvalHash is 64-hex SHA-256', /^[0-9a-f]{64}$/.test(h1));
ok('approvalHash is deterministic (same inputs → same hash)', h1 === h2);
ok('approvalHash binds to the version (different version → different hash)', h1 !== h3);
ok('approvalHash binds to the subject (different subject → different hash)', (await approvalHash('task', 'abc', 'v1')) !== h1);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ APPROVALS (P2-D-2 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
