// ── P2-C2 validation runner (Sales Closing Workflow) ─────────────────────────
// One command to execute the P2-C2 validation gate. Pure + structural checks
// always run; the LIVE closing-workflow e2e and closing tenant-isolation run when
// staging creds are present (else they skip and say what's missing). Prove-first,
// same discipline as P2-C1. Human product-experience QA is Phase 6, not here.
//   deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-p2c2.mjs
const DENO = (typeof Deno !== 'undefined' && Deno.execPath) ? Deno.execPath() : 'deno';
const CWD = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP_RE = /need SB|integration creds|requires? (a )?(live|network|db)|SUPABASE_URL/i;
const env = (typeof Deno !== 'undefined' ? Deno.env.toObject() : {});
const haveCreds = !!(env.SALES_E2E_TARGET && env.SALES_E2E_ANON && env.SALES_E2E_JWT);
const haveTwoTenant = haveCreds && !!env.SALES_E2E_JWT2;

const GROUPS = [
  ['Data model + rules (pure — always)', ['sales_lifecycle'], 'offline'],
  ['API tenant/idempotency/integrity (structural — always)', ['sales_routes'], 'offline'],
  ['Closing workflow runtime e2e (staging — proposal→sign→convert→onboard)', ['sales_closing_e2e'], 'live'],
  ['Closing tenant isolation, two workspaces (staging)', ['sales_closing_isolation_e2e'], 'live'],
  ['Regression: P2-C1 foundation + isolation still green (staging)', ['sales_foundation_e2e', 'sales_tenant_isolation_e2e'], 'live'],
];

const runOne = async (name) => {
  try {
    const cmd = new Deno.Command(DENO, { args: ['run', '--allow-read', '--allow-env', '--allow-net', `tests/presence/${name}_test.mjs`], stdout: 'piped', stderr: 'piped', cwd: CWD });
    const { code, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) + '\n' + new TextDecoder().decode(stderr);
    const m = out.match(/(\d+)\/(\d+)\s+(PASSED|FAILED)/);
    // a skip marker (no creds) wins even on exit 0 — a skipped live test must never
    // read as "green" and falsely mark the gate satisfied.
    if (SKIP_RE.test(out) && (!m || m[3] !== 'FAILED')) return { name, state: 'skip', counts: 'creds-needed' };
    if (code === 0 && m && m[3] === 'PASSED') return { name, state: 'pass', counts: `${m[1]}/${m[2]}` };
    if (code === 0 && !m) return { name, state: 'pass', counts: 'ok' };
    return { name, state: 'fail', counts: m ? `${m[1]}/${m[2]}` : '—' };
  } catch { return { name, state: 'fail', counts: 'ERR' }; }
};

console.log('\n══════ P2-C2 — Sales Closing Workflow — Validation ══════\n');
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
console.log('───────────────────────────────────────────────────────────');
console.log('P2-C2 VALIDATION GATE (engineering — human QA is Phase 6):');
console.log(`  1. closing workflow verified on staging ... ${liveOk.has('sales_closing_e2e') ? '✅' : '⏳ needs SALES_E2E_* creds'}`);
console.log(`  2. closing tenant isolation (live) ........ ${liveOk.has('sales_closing_isolation_e2e') ? '✅' : '⏳ needs SALES_E2E_JWT2 (2nd tenant)'}`);
console.log(`  3. P2-C1 regression still green ........... ${liveOk.has('sales_foundation_e2e') && liveOk.has('sales_tenant_isolation_e2e') ? '✅' : '⏳ needs creds'}`);
console.log('  4. architecture confirmed stable .......... judgement after 1–3 (see completion report)');
const liveGreen = liveOk.has('sales_closing_e2e') && liveOk.has('sales_closing_isolation_e2e');
console.log(`\nVERDICT: ${fail === 0 ? (liveGreen ? '✅ automated gate green (offline + live)' : '⏳ offline checks green; apply 0074 + set creds to run the live gate') : '❌ ATTENTION — a check failed'}\n`);
if (fail !== 0) Deno.exit(1);
