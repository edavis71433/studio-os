// ── P2-D validation runner (Service Delivery) ────────────────────────────────
// One command to execute the P2-D engineering gate. Pure + structural always run;
// the LIVE project-lifecycle e2e and tenant-isolation run when staging creds are
// present (else they skip and say what's missing). Human product-experience QA is
// Phase 6, not here. NOTE: this covers the P2-D-1 FOUNDATION (projects/tasks/
// milestones/events + convert handoff); later increments (deliverables/approvals/
// messaging/notifications/surveys/support/reporting/UI) add their own suites.
//   deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-p2d.mjs
const DENO = (typeof Deno !== 'undefined' && Deno.execPath) ? Deno.execPath() : 'deno';
const CWD = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP_RE = /need SB|integration creds|requires? (a )?(live|network|db)|SUPABASE_URL/i;
const env = (typeof Deno !== 'undefined' ? Deno.env.toObject() : {});
const haveCreds = !!(env.SALES_E2E_TARGET && env.SALES_E2E_ANON && env.SALES_E2E_JWT);
const haveTwoTenant = haveCreds && !!env.SALES_E2E_JWT2;

const GROUPS = [
  ['Data model + rules (pure — always)', ['service_delivery'], 'offline'],
  ['API tenant/visibility/idempotency (structural — always)', ['projects_routes'], 'offline'],
  ['Project lifecycle runtime e2e (staging)', ['projects_e2e'], 'live'],
  ['Project tenant isolation, two workspaces (staging)', ['projects_isolation_e2e'], 'live'],
];

const runOne = async (name) => {
  try {
    const cmd = new Deno.Command(DENO, { args: ['run', '--allow-read', '--allow-env', '--allow-net', `tests/presence/${name}_test.mjs`], stdout: 'piped', stderr: 'piped', cwd: CWD });
    const { code, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) + '\n' + new TextDecoder().decode(stderr);
    const m = out.match(/(\d+)\/(\d+)\s+(PASSED|FAILED)/);
    if (SKIP_RE.test(out) && (!m || m[3] !== 'FAILED')) return { name, state: 'skip', counts: 'creds-needed' };
    if (code === 0 && m && m[3] === 'PASSED') return { name, state: 'pass', counts: `${m[1]}/${m[2]}` };
    if (code === 0 && !m) return { name, state: 'pass', counts: 'ok' };
    return { name, state: 'fail', counts: m ? `${m[1]}/${m[2]}` : '—' };
  } catch { return { name, state: 'fail', counts: 'ERR' }; }
};

console.log('\n══════ P2-D — Service Delivery (foundation) — Validation ══════\n');
console.log(`staging creds: ${haveCreds ? 'present' : 'ABSENT (live steps will skip)'}   ·   two-tenant creds: ${haveTwoTenant ? 'present' : 'absent'}\n`);
let fail = 0; const liveOk = new Set();
for (const [label, names, kind] of GROUPS) {
  const rows = await Promise.all(names.map(runOne));
  const bad = rows.some((r) => r.state === 'fail');
  const mark = bad ? '❌' : rows.every((r) => r.state === 'pass') ? '✅' : '⏳';
  console.log(`${mark} ${label}`);
  for (const r of rows) { console.log(`     ${r.state === 'pass' ? 'pass' : r.state === 'skip' ? 'skip' : 'FAIL'}  ${r.name}_test  (${r.counts})`); if (r.state === 'fail') fail++; if (kind === 'live' && r.state === 'pass') liveOk.add(r.name); }
  console.log('');
}
const liveGreen = liveOk.has('projects_e2e') && liveOk.has('projects_isolation_e2e');
console.log('───────────────────────────────────────────────────────────');
console.log(`VERDICT: ${fail === 0 ? (liveGreen ? '✅ foundation gate green (offline + live)' : '⏳ offline checks green; apply 0075 + set creds to run the live gate') : '❌ ATTENTION — a check failed'}`);
console.log('NOTE: P2-D is NOT complete — this is the FOUNDATION increment (P2-D-1). Later increments add deliverables/approvals/messaging/notifications/surveys/support/reporting/UI + the full 16-step lifecycle gate.\n');
if (fail !== 0) Deno.exit(1);
