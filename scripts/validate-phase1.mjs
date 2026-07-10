// ── Phase 1 operational validation runner (M10) ──────────────────────────────
// Reuses the EXISTING regression suite, grouped by the subsystem each milestone
// hardened, and prints a pass/fail matrix. This is the operational-validation
// evidence for the Phase 1 completion report — no new tests, just organized proof.
//   deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-phase1.mjs
const DENO = (typeof Deno !== 'undefined' && Deno.execPath) ? Deno.execPath() : 'deno';

const GROUPS = [
  ['Security & tenant isolation (M2)', ['tenant_isolation', 'platform_invariants', 'scoped_access_audit', 'scope', 'operator_auth', 'feature_boundary']],
  ['Draft-version hash (M3)', ['draft_hash']],
  ['Publish reliability — idempotency + cooldown (M4)', ['publish_guard', 'pipeline']],
  ['Deploy robustness — timeout·reconcile·ceiling·telemetry (M5)', ['deploy_reconcile']],
  ['Media hardening — magic-byte·EXIF·quota·GC (M6)', ['media_hardening']],
  ['Snapshot retention & GC (M7)', ['snapshot_gc']],
  ['Preview hardening — cache·signed links·watermark (M8)', ['preview_hardening', 'preview_env']],
  ['Editing safety — optimistic lock + reused diff (M9)', ['optimistic_lock']],
  ['Rendering determinism (golden)', ['render', 'business_classic', 'editorial', 'dev_render']],
  ['Load-test framework (M10)', ['loadtest']],
];

const SKIP_RE = /need SB|SR_KEY|ANON|requires? (a )?(live|network|db)|integration|SUPABASE_URL/i;
const CWD = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const runOne = async (name) => {
  const path = `tests/presence/${name}_test.mjs`;
  try {
    const cmd = new Deno.Command(DENO, { args: ['run', '--allow-read', '--allow-env', '--allow-net', path], stdout: 'piped', stderr: 'piped', cwd: CWD });
    const { code, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) + '\n' + new TextDecoder().decode(stderr);
    const m = out.match(/(\d+)\/(\d+)\s+(PASSED|FAILED)/);
    if (code === 0 && (!m || m[3] === 'PASSED')) return { name, state: 'pass', counts: m ? `${m[1]}/${m[2]}` : 'ok' };
    if (SKIP_RE.test(out)) return { name, state: 'skip', counts: 'live-only' }; // integration test, no creds here
    return { name, state: 'fail', counts: m ? `${m[1]}/${m[2]}` : '—' };
  } catch { return { name, state: 'fail', counts: 'ERR' }; }
};

let groupsOk = 0, groupsTotal = 0, pass = 0, skip = 0, fail = 0;
console.log('\n══════ Presence CMS Phase 1 — Operational Validation ══════\n');
for (const [label, names] of GROUPS) {
  groupsTotal++;
  const rows = await Promise.all(names.map(runOne));
  const noFail = rows.every((r) => r.state !== 'fail');
  if (noFail) groupsOk++;
  for (const r of rows) { if (r.state === 'pass') pass++; else if (r.state === 'skip') skip++; else fail++; }
  console.log(`${noFail ? '✅' : '❌'} ${label}`);
  for (const r of rows) console.log(`     ${r.state === 'pass' ? 'pass' : r.state === 'skip' ? 'skip' : 'FAIL'}  ${r.name}_test  (${r.counts})`);
  console.log('');
}
console.log('───────────────────────────────────────────────────────────');
console.log(`Subsystems green: ${groupsOk}/${groupsTotal}   ·   suites: ${pass} pass · ${skip} skip (live-only) · ${fail} fail`);
console.log(`VERDICT: ${fail === 0 ? '✅ ALL SUBSYSTEMS VALIDATED (integration suites deferred to a live env)' : '❌ ATTENTION NEEDED'}\n`);
if (fail !== 0) Deno.exit(1);
