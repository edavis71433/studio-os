// ── deploy.yml and rollback.yml: what has to pass before production changes ──
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/deploy_gate_test.mjs
// Holds three things in place, each one broken before Nov 8 2026:
// - a production deploy runs ci.yml itself, not a weaker copy of it;
// - it waits for the browser check on the commit it deploys, and stops unless it
//   passed (the real step runs here against a stand-in `gh`, so no network);
// - deploy and rollback both cover every function, and rollback smoke-tests the Free Tools.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const DEPLOY = read('.github/workflows/deploy.yml');
const ROLLBACK = read('.github/workflows/rollback.yml');
const CI = read('.github/workflows/ci.yml');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// Each job's lines, by name.
const jobsOf = (wf) => Object.fromEntries([...wf.slice(wf.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)].map((m) => [m[1], m[2]]));
const JOBS = jobsOf(DEPLOY);

// ── The checks a pull request gets, run again before a deploy ────────────────
ok('the pre-deploy gate is ci.yml itself', /^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/m.test(JOBS.test || '') && !/^ {4}steps:/m.test(JOBS.test || ''));
ok('ci.yml can be called by another workflow', /^on:\n(?: {2}.*\n|(?: {4}.*\n))*? {2}workflow_call:/m.test(CI));
ok('the deploy has no test loop or typecheck of its own to drift', !/deno check|_test\.mjs|setup-deno/.test(DEPLOY));
ok('production waits for the gate and for the browser check', /^ {4}needs: \[test, browser-gate\]$/m.test(JOBS['deploy-production'] || ''));
ok('there is no staging job (item 112: no staging project ever existed)', !JOBS['deploy-staging'] && !DEPLOY.includes('SUPABASE_PROJECT_REF_STAGING') && !ROLLBACK.includes('SUPABASE_PROJECT_REF_STAGING'));
ok('a deploy only starts by hand', /^on:\n {2}workflow_dispatch:/m.test(DEPLOY) && !/^ {2}push:/m.test(DEPLOY.slice(0, DEPLOY.indexOf('\njobs:'))));
ok('the browser gate runs for every production deploy', /^ {4}if: github\.event_name == 'workflow_dispatch'$/m.test(JOBS['browser-gate'] || '') && /^ {4}if: github\.event_name == 'workflow_dispatch'$/m.test(JOBS['deploy-production'] || ''));
ok('the browser gate may read checks and nothing else', /^ {4}permissions:\n {6}checks: read\n(?! {6})/m.test(JOBS['browser-gate'] || ''));
ok('nothing can pass on its own failure', !DEPLOY.includes('continue-on-error') && !ROLLBACK.includes('continue-on-error'));
// A typed input pasted into a script runs as part of it.
for (const [name, wf] of [['deploy.yml', DEPLOY], ['rollback.yml', ROLLBACK]]) {
  const scripts = [...wf.matchAll(/run: \|\n((?: {10}.*\n|\n)+)/g)].map((m) => m[1]).join('\n') + [...wf.matchAll(/^ +run: (.+)$/gm)].map((m) => m[1]).join('\n');
  ok(`${name}: no typed input is pasted into a script`, !scripts.includes('github.event.inputs'));
}

// ── One at a time (Nov 9 2026) ───────────────────────────────────────────────
// Two dispatches used to run side by side, and the older could land last. A production
// deploy or rollback now waits its turn in one shared queue.
const queue = (wf) => wf.match(/^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (\w+)$/m);
const dq = queue(DEPLOY), rq = queue(ROLLBACK);
ok('a production deploy waits for the one before it', dq?.[1] === 'deploy-production' && dq?.[2] === 'false', dq?.[0]);
ok('a rollback waits in the same queue as the deploys', rq?.[1] === 'deploy-production' && rq?.[2] === 'false', rq?.[0]);
ok('the queue is set for the whole run, ahead of the jobs', DEPLOY.indexOf('\nconcurrency:') < DEPLOY.indexOf('\njobs:') && ROLLBACK.indexOf('\nconcurrency:') < ROLLBACK.indexOf('\njobs:'));

// ── The browser gate's real step, against a stand-in gh ──────────────────────
const GATE = DEPLOY.match(/id: browser-gate\n[\s\S]*?run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
ok('the browser gate step is found', !!GATE);
const dir = await Deno.makeTempDir({ prefix: 'deploy-gate-test-' });
await Deno.writeTextFile(`${dir}/gate.sh`, GATE || 'exit 9');
// Each call answers with the next line of the script below (the last line repeats);
// "FAIL" makes the call fail, the way a network error would. Every call is logged.
await Deno.writeTextFile(`${dir}/gh`, `#!/bin/bash
echo "$*" >> "${dir}/calls"
n=$(( $(cat "${dir}/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${dir}/n"
line=$(sed -n "\${n}p" "${dir}/answers"); [ -z "$line" ] && line=$(tail -n 1 "${dir}/answers")
[ "$line" = FAIL ] && exit 1
[ "$line" = NONE ] && exit 0
printf '%s\\n' "$line"
`);
await Deno.chmod(`${dir}/gh`, 0o755);
async function gate(answers, env = {}) {
  await Deno.writeTextFile(`${dir}/answers`, answers.join('\n') + '\n');
  for (const f of ['n', 'calls']) await Deno.remove(`${dir}/${f}`).catch(() => {});
  const { code, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${dir}/gate.sh`], stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${dir}:${Deno.env.get('PATH')}`, REPO: 'owner/repo', SHA: 'abc123', GH_TOKEN: 't', POLL_SECONDS: '0', ...env },
  }).output();
  const calls = await Deno.readTextFile(`${dir}/calls`).catch(() => '');
  return { code, log: new TextDecoder().decode(stdout), calls: calls.trim().split('\n').filter(Boolean) };
}
const passed = await gate(['completed success']);
ok('a passed browser check lets the deploy go', passed.code === 0 && passed.log.includes('passed'));
ok('it asks about this commit\'s checks, once per look', passed.calls.length === 1 && passed.calls[0]?.startsWith('api repos/owner/repo/commits/abc123/check-runs?filter=latest&per_page=100') && passed.calls[0].includes('--jq'), passed.calls[0]);
for (const end of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale']) {
  const r = await gate([`completed ${end}`]);
  ok(`a browser check that ended ${end} stops the deploy`, r.code === 1 && r.log.includes(`::error title=Browser check::The browser check on this commit ended ${end}`));
}
const waited = await gate(['queued ', 'in_progress ', 'in_progress ', 'completed success']);
ok('a browser check still running is waited for, then the deploy goes', waited.code === 0 && waited.calls.length === 4 && waited.log.includes('in_progress; waiting'));
const waitedFail = await gate(['in_progress ', 'completed failure']);
ok('a browser check that fails while waited for stops the deploy', waitedFail.code === 1);
const lateStart = await gate(['NONE', 'NONE', 'in_progress ', 'completed success'], { START_MINUTES: '5' });
ok('a browser check that starts late is waited for', lateStart.code === 0 && lateStart.log.includes("hasn't started"));
// Nov 8: the deploy after PR 182 gave up at 15 minutes while all three devices were still
// running, because the browser job only starts once they've all finished.
const devices = await gate(['devices', 'devices', 'completed success'], { START_MINUTES: '0' });
ok('devices still running count as started, past the start window, and the deploy goes once browser passes', devices.code === 0 && devices.calls.length === 3 && devices.log.includes('running on its devices'));
const devicesFail = await gate(['devices', 'completed failure'], { START_MINUTES: '0' });
ok('…and a browser check that fails after its devices stops the deploy', devicesFail.code === 1 && devicesFail.log.includes('ended failure'));
const devicesForever = await gate(['devices'], { WAIT_MINUTES: '0' });
ok('…and devices that never finish stop the deploy in the end', devicesForever.code === 1 && devicesForever.log.includes("hadn't passed after 0 minutes"));
const never = await gate(['NONE'], { START_MINUTES: '0' });
ok('no browser check on the commit stops the deploy', never.code === 1 && never.log.includes('No browser check started on this commit'));
const flaky = await gate(['FAIL', 'FAIL', 'completed success']);
ok('a failed read of the checks is tried again', flaky.code === 0 && flaky.calls.length === 3 && flaky.log.includes("Couldn't read the checks"));
const forever = await gate(['in_progress '], { WAIT_MINUTES: '0' });
ok('a browser check that never finishes stops the deploy in the end', forever.code === 1 && forever.log.includes("hadn't passed after 0 minutes"));

// The filter the step hands to gh, run by jq on made-up answers.
const FILTER = GATE?.match(/--jq '([^']+)'/)?.[1];
const jq = async (body) => {
  const p = new Deno.Command('jq', { args: ['-r', FILTER || '.'], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(JSON.stringify(body))); await w.close();
  const { code, stdout } = await p.output();
  return code === 0 ? new TextDecoder().decode(stdout).replace(/\n$/, '') : `jq exit ${code}`;   // keeps the space a running check ends with, as the step sees it
};
const run = (o) => ({ name: 'browser', app: { slug: 'github-actions' }, started_at: '2026-11-08T10:00:00Z', status: 'completed', conclusion: 'success', ...o });
let hasJq = true;
try { await new Deno.Command('jq', { args: ['--version'], stdout: 'null', stderr: 'null' }).output(); } catch { hasJq = false; }
ok('jq is here to check the filter (GitHub\'s runners have it)', hasJq);
if (hasJq && FILTER) {
  ok('the filter reads a passed check', await jq({ check_runs: [run({})] }) === 'completed success');
  ok('the filter reads a running check', await jq({ check_runs: [run({ status: 'in_progress', conclusion: null })] }) === 'in_progress ');
  ok('the filter says nothing when there is no check', await jq({ check_runs: [] }) === '');
  ok('the filter takes the newest of two runs', await jq({ check_runs: [run({ started_at: '2026-11-08T11:00:00Z', conclusion: 'failure' }), run({})] }) === 'completed failure');
  ok('a check called browser from another app doesn\'t count', await jq({ check_runs: [run({ app: { slug: 'someone-else' } })] }) === '');
  ok('a check with another name doesn\'t count', await jq({ check_runs: [run({ name: 'scope' }), run({ name: 'test' })] }) === '');
  ok('a device job running means the check is under way', await jq({ check_runs: [run({ name: 'scope' }), run({ name: 'browser on tablet', status: 'in_progress', conclusion: null })] }) === 'devices');
  ok('a finished device job, before the browser job starts, still means under way', await jq({ check_runs: [run({ name: 'browser on mobile' })] }) === 'devices');
  ok('once the browser job exists, it decides, whatever the devices say', await jq({ check_runs: [run({ name: 'browser on mobile', conclusion: 'failure' }), run({ status: 'in_progress', conclusion: null })] }) === 'in_progress ');
  ok('a device job from another app doesn\'t count', await jq({ check_runs: [run({ name: 'browser on tablet', app: { slug: 'someone-else' } })] }) === '');
}
await Deno.remove(dir, { recursive: true });

// ── Every function, deployed and rolled back ─────────────────────────────────
const FUNCTIONS = new URL('supabase/functions/', ROOT);
const hasIndex = (name) => { try { return Deno.statSync(new URL(`${name}/index.ts`, FUNCTIONS)).isFile; } catch { return false; } };
const functions = [...Deno.readDirSync(FUNCTIONS)].filter((f) => f.isDirectory && hasIndex(f.name)).map((f) => f.name).sort();
ok('the folder listing finds the functions', functions.includes('presence') && functions.length >= 8, functions.join());
const deployed = (job) => new Set([...(JOBS[job] || '').matchAll(/functions deploy ([\w-]+) /g)].map((m) => m[1]));
const rolledBack = new Set((ROLLBACK.match(/for fn in ([\w -]+); do/)?.[1] || '').trim().split(/\s+/));
for (const name of functions) {
  ok(`production deploys ${name}`, deployed('deploy-production').has(name));
  ok(`rollback puts back ${name}`, rolledBack.has(name));
}
ok('rollback skips a function its ref doesn\'t have, and says so', ROLLBACK.includes('if [ ! -f "supabase/functions/$fn/index.ts" ]') && ROLLBACK.includes('::warning title=Not rolled back::'));
// The Free Tools smoke test deploy.yml runs after a deploy, line for line.
const freeTools = (wf) => wf.match(/- name: Smoke test — Free Tools functions answer and gate\n[\s\S]*?run: \|\n((?: {10}.*\n)+)/)?.[1].replace(/\$\{\{ secrets\.SUPABASE_PROJECT_REF_PROD \}\}|\$PROJECT_REF/g, 'REF');
ok('rollback smoke-tests the Free Tools exactly as a deploy does', !!freeTools(ROLLBACK) && freeTools(ROLLBACK) === freeTools(DEPLOY.slice(DEPLOY.indexOf('  deploy-production:'))));
ok('rollback checks presence still refuses a signed-out caller', ROLLBACK.includes('"$base/presence/connections"'));

const passedN = results.filter((x) => x.p).length;
console.log(`\n════ DEPLOY GATE: ${passedN}/${results.length} ${passedN === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passedN !== results.length) Deno.exit(1);
