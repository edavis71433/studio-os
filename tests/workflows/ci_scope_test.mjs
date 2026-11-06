// ── ci.yml: can `test` be a required check, and does it run for every change? ───
//   deno run --allow-read tests/workflows/ci_scope_test.mjs
// `test` has no decision step, because it has no skip list: it runs whatever
// changed. So there is no logic to run here, only a shape to hold. A `paths:` line
// back in ci.yml would bring back two problems at once: a required check that waits
// on "Expected" forever, and a page change that runs none of the suites pinning it.
// e2e_scope_test.mjs is the same idea for `browser`, which does have a decision step.

const ROOT = new URL('../../', import.meta.url);
const WORKFLOWS = new URL('.github/workflows/', ROOT);
const WORKFLOW = Deno.readTextFileSync(new URL('ci.yml', WORKFLOWS));

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

const STEPS = WORKFLOW.slice(WORKFLOW.indexOf('    steps:')).split(/^ {6}- /m).slice(1);
const runs = (command) => STEPS.some((s) => new RegExp(`^(?: {8})?run: ${command}`, 'm').test(s));

// ── The shape a required check depends on ────────────────────────────────────
ok('no path filter, so every pull request gets a `test` result', !/^\s*paths(-ignore)?:/m.test(WORKFLOW));
ok('no branch or event filter on pull requests', /^ {2}pull_request:\n {2}workflow_dispatch:/m.test(WORKFLOW));
ok('the job is called test, the name the required check will use', /^jobs:\n {2}test:\n/m.test(WORKFLOW) && !/^ {4}name:/m.test(WORKFLOW));
ok('the job has no if: of its own, which could skip it before it reports', !/^ {4}if:/m.test(WORKFLOW));
// If a job this one needs failed, this one would be skipped, and GitHub counts a skipped job as a pass.
ok('the job waits on no other job', !/^ {4}needs:/m.test(WORKFLOW));
ok('no step can be skipped', STEPS.length > 0 && STEPS.every((s) => !/^(?: {8})?if:/m.test(s)));
ok('nothing can pass on its own failure', !WORKFLOW.includes('continue-on-error'));

// GitHub matches a required check by name alone, and deploy.yml has a job called
// test too. That's safe only while the job can't report on a pull request.
for (const { name } of Deno.readDirSync(WORKFLOWS)) {
  if (name === 'ci.yml' || !name.endsWith('.yml')) continue;
  const other = Deno.readTextFileSync(new URL(name, WORKFLOWS));
  if (/^ {2}test:$/m.test(other)) ok(`${name}'s job called test never runs on a pull request`, !/^ {2}pull_request\b/m.test(other));
}

// ── What it runs ─────────────────────────────────────────────────────────────
ok('the typecheck runs', STEPS.some((s) => s.includes('deno check supabase/functions/presence/index.ts')));
ok('the suites run', runs('bash scripts/ci-pure-tests.sh'));
// A test of a workflow that no workflow runs protects nothing. This covers this file too.
for (const { name } of Deno.readDirSync(new URL('tests/workflows/', ROOT))) {
  if (name.endsWith('_test.mjs')) ok(`runs tests/workflows/${name}`, runs(`deno run .*tests/workflows/${name}$`));
}

const passed = results.filter((x) => x.p).length;
console.log(`\n════ CI SCOPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
