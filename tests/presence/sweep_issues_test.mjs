// ── sweepIssues predicate + tick/split parity ─────────────────────────────────
// sweepIssues() decides what pages the watchdog: a false positive = permanent
// alert fatigue (the digest.sent:false bug marked EVERY healthy tick failed);
// a false negative = silent failures. This pins its judgment against the REAL
// return shape of every sweep in the chain, and pins split-mode GROUPS parity
// with the default chain (a sweep added to one but not the other fails silently
// for the other mode).
//
//   deno run --allow-read --allow-env tests/presence/sweep_issues_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'test');
Deno.env.set('SUPABASE_ANON_KEY', 'test');
const { sweepIssues } = await import('../../supabase/functions/presence/routes/system.ts');

// ── a fully HEALTHY tick, using each sweep's real no-op/success shape ─────────
const healthy = {
  cycle: { ok: true, run_type: 'cycle', considered: 3, ran: 3, failures: 0, results: [] },
  scheduled_publishes: { ok: true, run_type: 'scheduled-publish', considered: 0, ran: 0, failures: 0, results: [] },
  reconcile: { ok: true, run_type: 'reconcile', scanned: 0, live: 0, failed: 0, abandoned: 0, pending: 0 },
  reconcile_billing: { checked: 0, corrected: 0, errors: 0, skipped_no_stripe: true },   // no-Stripe env
  lifecycle: { expired_trials: 0, notices: 0, emails: 0, wound_down: 0, grace_lapsed: 0, failures: 0 },
  deletion: { due: 0, completed: 0, failed: 0 },
  digest: { sent: 0, skipped_dedupe: true },            // THE bug shape: ~671/672 ticks — must be clean
  domains: { checked: 0, warned: 0 },
  leads: { nudged: 0 },
  deal_nudges: { nudged: 0 },
  renewals: { reminded: 0 },
  invoice_nudges: { reminded: 0 },
  doc_reminders: { reminded: 0 },
  nurture: { sent: 0, skipped_off: true },              // owner gate off — must be clean
  retention: { visits: true, search_terms: true, scheduled_runs: true, ops_errors: true, rate_limit_state: true, audit_leads: true, evidence_runs: 0 },
  media_gc: { reaped: 0 },
  snapshot_gc: { pruned: 0 },
  stale_runs: { ok: true },
};
ok('healthy tick → ZERO issues (incl. non-Monday digest + nurture off + no-Stripe)', sweepIssues(healthy).length === 0, JSON.stringify(sweepIssues(healthy)));
ok('healthy tick + digest no-email skip → still clean', sweepIssues({ ...healthy, digest: { sent: 0, skipped_no_email: true } }).length === 0);
ok('healthy Monday tick (digest sent) → clean', sweepIssues({ ...healthy, digest: { sent: 1 } }).length === 0);

// ── each real failure shape MUST page ─────────────────────────────────────────
ok('cycle failures page', sweepIssues({ ...healthy, cycle: { ...healthy.cycle, ok: false, failures: 2 } }).length > 0);
ok('billing reconcile errors page', sweepIssues({ ...healthy, reconcile_billing: { checked: 3, corrected: 0, errors: 2, skipped_no_stripe: false } }).length > 0);
ok('a failed retention prune pages', sweepIssues({ ...healthy, retention: { ...healthy.retention, rate_limit_state: false } }).length > 0);
ok('a FAILED weekly digest send pages', sweepIssues({ ...healthy, digest: { sent: 0, failures: 1 } }).length > 0);
ok('deletion executor failure pages', sweepIssues({ ...healthy, deletion: { due: 1, completed: 0, failed: 1 } }).length > 0);
ok('stale-run reaper failure pages', sweepIssues({ ...healthy, stale_runs: { ok: false } }).length > 0);
ok('wind-down takedown failure pages (OB-1)', sweepIssues({ ...healthy, lifecycle: { ...healthy.lifecycle, failures: 1 } }).length > 0);
ok('interrupted scheduled publish pages', sweepIssues({ ...healthy, scheduled_publishes: { ...healthy.scheduled_publishes, ok: false, failures: 1 } }).length > 0);

// ── the digest regression, pinned forever ─────────────────────────────────────
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/commerce/lifecycle.ts', import.meta.url));
  ok('runWeeklyDigest NEVER returns a bare false boolean (the permanent-paging bug)', !/return \{ sent: false/.test(src) && /skipped_dedupe: true/.test(src) && /skipped_no_email: true/.test(src));
}

// ── split-mode GROUPS ↔ default-chain parity ──────────────────────────────────
{
  const sys = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/system.ts', import.meta.url));
  const groupsBlock = sys.slice(sys.indexOf('const GROUPS'), sys.indexOf("json({ data: summarizeProgress"));
  const groupNames = [...groupsBlock.matchAll(/\['([a-z_]+)', \(\) =>/g)].map((m) => m[1]);
  const chainBlock = sys.slice(sys.indexOf('// ── The default tick'));
  const chainNames = [...chainBlock.matchAll(/await step(?:<[^>]+>)?\('([a-z_]+)'/g)].map((m) => m[1]);
  const gs = new Set(groupNames), cs = new Set(chainNames);
  const onlyGroups = groupNames.filter((n) => !cs.has(n));
  const onlyChain = chainNames.filter((n) => !gs.has(n));
  ok(`parity: every split-mode sweep is in the default chain (${groupNames.length} names)`, groupNames.length >= 15 && onlyGroups.length === 0, onlyGroups.join(','));
  ok(`parity: every default-chain sweep is in a split group (${chainNames.length} names)`, chainNames.length >= 15 && onlyChain.length === 0, onlyChain.join(','));
  const rb = groupsBlock.indexOf("'reconcile_billing'"), lc = groupsBlock.indexOf("'lifecycle'");
  ok('parity: billing reconcile stays BEFORE lifecycle in the revenue group', rb > 0 && lc > rb);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SWEEP-ISSUES PREDICATE + TICK PARITY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
