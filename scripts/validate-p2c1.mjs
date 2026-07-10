// ── P2-C1 validation runner (Lead · CRM · Opportunity · Pipeline) ────────────
// One command the team runs to execute the P2-C1 validation gate. Structural/pure
// checks always run; the LIVE runtime + tenant-isolation e2e run when staging creds
// are present (else they skip and the runner tells you what's missing). Prove-first:
// this is the "step 2–3 automated" harness — browser/mobile/AT (step 4) is human.
//   deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-p2c1.mjs
const DENO = (typeof Deno !== 'undefined' && Deno.execPath) ? Deno.execPath() : 'deno';
const CWD = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP_RE = /need SB|integration creds|requires? (a )?(live|network|db)|SUPABASE_URL/i;
const env = (typeof Deno !== 'undefined' ? Deno.env.toObject() : {});
const haveCreds = !!(env.SALES_E2E_TARGET && env.SALES_E2E_ANON && env.SALES_E2E_JWT);
const haveTwoTenant = haveCreds && !!env.SALES_E2E_JWT2;

const GROUPS = [
  ['Data model + rules (pure — always)', ['sales_lifecycle'], 'offline'],
  ['API tenant/idempotency/integrity (structural — always)', ['sales_routes'], 'offline'],
  ['Foundation runtime e2e (staging — step 2)', ['sales_foundation_e2e'], 'live'],
  ['Tenant isolation, two workspaces (staging — step 3)', ['sales_tenant_isolation_e2e'], 'live'],
];

const runOne = async (name) => {
  try {
    const cmd = new Deno.Command(DENO, { args: ['run', '--allow-read', '--allow-env', '--allow-net', `tests/presence/${name}_test.mjs`], stdout: 'piped', stderr: 'piped', cwd: CWD });
    const { code, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) + '\n' + new TextDecoder().decode(stderr);
    const m = out.match(/(\d+)\/(\d+)\s+(PASSED|FAILED)/);
    // a skip marker (no creds) wins even on exit 0 — otherwise a skipped live test
    // would look "green" and falsely mark the gate satisfied.
    if (SKIP_RE.test(out) && (!m || m[3] !== 'FAILED')) return { name, state: 'skip', counts: 'creds-needed' };
    if (code === 0 && m && m[3] === 'PASSED') return { name, state: 'pass', counts: `${m[1]}/${m[2]}` };
    if (code === 0 && !m) return { name, state: 'pass', counts: 'ok' };
    return { name, state: 'fail', counts: m ? `${m[1]}/${m[2]}` : '—' };
  } catch { return { name, state: 'fail', counts: 'ERR' }; }
};

console.log('\n══════ P2-C1 — Lead/CRM/Opportunity/Pipeline — Validation ══════\n');
console.log(`staging creds: ${haveCreds ? 'present' : 'ABSENT (live steps will skip)'}   ·   two-tenant creds: ${haveTwoTenant ? 'present' : 'absent'}\n`);
let fail = 0, liveRan = 0;
for (const [label, names, kind] of GROUPS) {
  const rows = await Promise.all(names.map(runOne));
  const bad = rows.some((r) => r.state === 'fail');
  const mark = bad ? '❌' : rows.every((r) => r.state === 'pass') ? '✅' : '⏳';
  console.log(`${mark} ${label}`);
  for (const r of rows) { console.log(`     ${r.state === 'pass' ? 'pass' : r.state === 'skip' ? 'skip' : 'FAIL'}  ${r.name}_test  (${r.counts})`); if (r.state === 'fail') fail++; if (kind === 'live' && r.state === 'pass') liveRan++; }
  console.log('');
}
console.log('───────────────────────────────────────────────────────────');
console.log('VALIDATION GATE STATUS (from P2C-FOUNDATION-FIRST-SPLIT.md):');
console.log(`  1. migration 0074 applied ......... ${haveCreds ? '(run + these live tests confirm)' : '⏳ OWNER — apply, then re-run with creds'}`);
console.log(`  2. runtime verified on staging .... ${liveRan >= 1 ? '✅' : '⏳ needs SALES_E2E_* creds'}`);
console.log(`  3. tenant isolation (live) ........ ${liveRan >= 2 ? '✅' : '⏳ needs SALES_E2E_JWT2 (2nd tenant)'}`);
console.log('  4. browser/mobile/AT QA ........... ⏳ HUMAN — see P2C1-VALIDATION-RUNBOOK.md checklist');
console.log('  5. architecture confirmed stable .. ⏳ after 1–4');
console.log(`\nVERDICT: ${fail === 0 ? (liveRan >= 2 ? '✅ automated gate green — do the human QA (step 4)' : '⏳ offline checks green; apply 0074 + set creds to run the live gate') : '❌ ATTENTION — a check failed'}\n`);
if (fail !== 0) Deno.exit(1);
