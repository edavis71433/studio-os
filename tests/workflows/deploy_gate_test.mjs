// ── deploy.yml and rollback.yml: what has to pass before production changes ──
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/deploy_gate_test.mjs
// Holds three things in place, each one broken before Nov 8 2026:
// - a production deploy runs ci.yml itself, not a weaker copy of it, and (item 212, Nov 12)
//   the walls-between-studios check, isolation.yml, and nothing deploys unless it passed;
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
ok('production waits for the gate, the browser check, the walls between studios and the database changes', /^ {4}needs: \[test, browser-gate, isolation, ledger-gate\]$/m.test(JOBS['deploy-production'] || ''));
// Builder item 212: the suites that prove one studio can't read another's data run with every
// deploy, on a scratch database (isolation.yml; tests/workflows/isolation_scope_test.mjs holds its shape).
ok('every deploy checks the walls between studios with isolation.yml itself', /^ {4}uses: \.\/\.github\/workflows\/isolation\.yml$/m.test(JOBS.isolation || '') && !/^ {4}(steps|if):/m.test(JOBS.isolation || ''));
ok('isolation.yml can be called by another workflow', /^on:\n(?: {2}.*\n|(?: {4}.*\n))*? {2}workflow_call:/m.test(read('.github/workflows/isolation.yml')));
ok('…and is handed no secrets', !/secrets/.test(JOBS.isolation || ''));
// Item 212's last step (Nov 15 2026, after it passed on all 11 deploys since Nov 12): it holds
// up the deploy. The rollback never waits for it: putting back what ran before is the way out.
ok('…and holds up the deploy until it has passed', /^ {4}needs:.*\bisolation\b/m.test(JOBS['deploy-production'] || ''));
ok('…and a rollback doesn\'t wait for it', !/isolation/.test(ROLLBACK));
ok('there is no staging job (item 112: GitHub never had the staging project\'s ref, and it runs only the watchdog)', !JOBS['deploy-staging'] && !DEPLOY.includes('SUPABASE_PROJECT_REF_STAGING') && !ROLLBACK.includes('SUPABASE_PROJECT_REF_STAGING'));
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
// Builder item 418: the urgent switch releases without waiting, and says so; nothing else changes.
const urgent = await gate(['in_progress '], { URGENT: 'true' });
ok('an urgent fix doesn\'t wait for the browser check, and asks GitHub nothing', urgent.code === 0 && urgent.calls.length === 0 && urgent.log.includes('::warning title=Urgent fix::Released without waiting for the browser check'), urgent.log.trim());
const notUrgent = await gate(['completed failure'], { URGENT: 'false' });
ok('…while a release that isn\'t urgent still stops on a failed browser check', notUrgent.code === 1);
ok('the switch is a yes/no that starts at no', /^ {6}urgent:\n {8}description: .+\n {8}type: boolean\n {8}default: false$/m.test(DEPLOY));
ok('…and arrives as data, never pasted into the script', (JOBS['browser-gate'] || '').includes('URGENT: ${{ inputs.urgent }}'));
ok('…and an urgent release still needs the fast checks, the walls between studios and the database changes', /^ {4}needs: \[test, browser-gate, isolation, ledger-gate\]$/m.test(JOBS['deploy-production'] || '') && !/urgent/.test((JOBS.test || '') + (JOBS.isolation || '') + (JOBS['ledger-gate'] || '')));
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
  // Builder item 419: each device runs in parts, one machine each ("browser on mobile (2 of 3)").
  ok('a part of a device running means the check is under way', await jq({ check_runs: [run({ name: 'scope' }), run({ name: 'browser on mobile (2 of 3)', status: 'in_progress', conclusion: null })] }) === 'devices');
  ok('…and once the browser job exists it decides, whatever any part says', await jq({ check_runs: [run({ name: 'browser on tablet (3 of 3)', conclusion: 'failure' }), run({ name: 'browser on mobile (1 of 3)' }), run({ conclusion: 'failure' })] }) === 'completed failure');
}
await Deno.remove(dir, { recursive: true });

// ── Builder item 420: the database changes this commit needs are on production ───
// The real step, in a folder holding made-up migrations, with a stand-in curl that answers
// the way Supabase's API does. No network.
ok('the database check runs for every production deploy, with the deploy token and nothing more', /^ {4}if: github\.event_name == 'workflow_dispatch'$/m.test(JOBS['ledger-gate'] || '')
  && /^ {4}permissions:\n {6}contents: read\n(?! {6})/m.test(JOBS['ledger-gate'] || '')
  && (JOBS['ledger-gate'] || '').includes('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}') && !/secrets\.(?!SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF_PROD)/.test(JOBS['ledger-gate'] || ''));
ok('…and a rollback doesn\'t ask it (an older version runs on a newer database)', !/presence_change_ledger|ledger-gate/.test(ROLLBACK));
const LEDGER = DEPLOY.match(/id: ledger-gate\n[\s\S]*?run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
ok('the database check step is found', !!LEDGER);
const ldir = await Deno.makeTempDir({ prefix: 'ledger-gate-test-' });
await Deno.writeTextFile(`${ldir}/gate.sh`, LEDGER || 'exit 9');
await Deno.writeTextFile(`${ldir}/curl`, `#!/bin/bash
echo "$*" >> "${ldir}/calls"
out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && { out="$2"; shift; }; shift; done
cat > /dev/null
cp "${ldir}/body" "$out"
cat "${ldir}/code"
`);
await Deno.chmod(`${ldir}/curl`, 0o755);
async function ledgerGate(newest, code, body) {
  const work = await Deno.makeTempDir({ dir: ldir });
  await Deno.mkdir(`${work}/supabase/migrations`, { recursive: true });
  for (const f of ['0000_baseline.sql', '0247_health_counts.sql', `${newest}_newest.sql`, 'README.md']) await Deno.writeTextFile(`${work}/supabase/migrations/${f}`, '-- x\n');
  await Deno.writeTextFile(`${ldir}/body`, body);
  await Deno.writeTextFile(`${ldir}/code`, code);
  await Deno.remove(`${ldir}/calls`).catch(() => {});
  const { code: exit, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${ldir}/gate.sh`], cwd: work, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${ldir}:${Deno.env.get('PATH')}`, SUPABASE_ACCESS_TOKEN: 'sbp_fake', PROJECT_REF: 'prodref' },
  }).output();
  const calls = await Deno.readTextFile(`${ldir}/calls`).catch(() => '');
  return { exit, log: new TextDecoder().decode(stdout), calls: calls.trim().split('\n').filter(Boolean) };
}
let lg = await ledgerGate('0261', '201', '[{"newest":261,"has":true}]');
ok('production has the newest change: the release goes', lg.exit === 0 && lg.log.includes('Production has database change 0261'), lg.log.trim());
ok('…asked once, of Supabase\'s API for production, with the deploy token', lg.calls.length === 1 && lg.calls[0].includes('https://api.supabase.com/v1/projects/prodref/database/query') && lg.calls[0].includes('Authorization: Bearer sbp_fake'), lg.calls[0]);
lg = await ledgerGate('0262', '201', '[{"newest":261,"has":false}]');
ok('production is a change behind: no release, and it says which packs to run', lg.exit === 1 && lg.log.includes('::error title=Database changes::This release needs database change 0262, and production\'s newest is 0261. Run the apply packs after 0261 in order'), lg.log.trim());
lg = await ledgerGate('0262', '201', '[{"newest":263,"has":false}]');
ok('a ledger without the change, even with newer ones, stops the release', lg.exit === 1);
lg = await ledgerGate('0261', '400', '{"message":"Failed to run sql query: ERROR:  42P01: relation \\"public.presence_change_ledger\\" does not exist"}');
ok('no ledger on production yet: no release, and it says to run APPLY-0260 first', lg.exit === 1 && lg.log.includes('Production has no change ledger yet') && lg.log.includes('APPLY-0260-prod.sql'), lg.log.trim());
lg = await ledgerGate('0261', '503', 'Service Unavailable');
ok('Supabase\'s API not answering: no release, and it says so', lg.exit === 1 && lg.log.includes('Couldn\'t read which database changes production has (Supabase\'s API answered HTTP 503)'));
lg = await ledgerGate('0261', '201', '{"unexpected":true}');
ok('an answer it can\'t read: no release', lg.exit === 1 && lg.log.includes('couldn\'t be read'));
lg = await ledgerGate('0259', '201', '[]');
ok('a commit whose newest change is from before the ledger asks nothing', lg.exit === 0 && lg.calls.length === 0 && lg.log.includes('from before the ledger'));
ok('the answer\'s body never reaches the log', !lg.log.includes('unexpected'));
await Deno.remove(ldir, { recursive: true });

// ── Builder item 418: the rollback can put back the version that is live (`live`) ──
const WHICH = ROLLBACK.match(/id: which\n[\s\S]*?run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
ok('the rollback\'s choice of commit is found', !!WHICH);
const wdir = await Deno.makeTempDir({ prefix: 'rollback-which-test-' });
await Deno.writeTextFile(`${wdir}/which.sh`, WHICH || 'exit 9');
await Deno.writeTextFile(`${wdir}/gh`, `#!/bin/bash
echo "$*" >> "${wdir}/calls"
case "$*" in *deploy.yml/runs*) cat "${wdir}/release" ;; *rollback.yml/runs*) cat "${wdir}/undone" ;; esac
`);
await Deno.chmod(`${wdir}/gh`, 0o755);
async function which(asked, release, undone) {
  await Deno.writeTextFile(`${wdir}/release`, release); await Deno.writeTextFile(`${wdir}/undone`, undone);
  await Deno.writeTextFile(`${wdir}/out`, ''); await Deno.remove(`${wdir}/calls`).catch(() => {});
  const { code, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${wdir}/which.sh`], stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${wdir}:${Deno.env.get('PATH')}`, GH_TOKEN: 't', REPO: 'owner/repo', ASKED: asked, GITHUB_OUTPUT: `${wdir}/out` },
  }).output();
  return { code, log: new TextDecoder().decode(stdout), out: (await Deno.readTextFile(`${wdir}/out`)).trim(), calls: (await Deno.readTextFile(`${wdir}/calls`).catch(() => '')).trim() };
}
const LIVE = 'd'.repeat(40);
let w = await which('abc1234', '', '');
ok('a commit given by hand is used as it is, asking GitHub nothing', w.code === 0 && w.out === 'ref=abc1234' && !w.calls);
w = await which('live', `${LIVE} 2026-11-22T16:33:00Z`, '2026-11-20T10:00:00Z');
ok('live: the commit the last green release shipped', w.code === 0 && w.out === `ref=${LIVE}` && w.log.includes('live is dddddddd'), w.log.trim());
w = await which('live', `${LIVE} 2026-11-22T16:33:00Z`, '2026-11-22T17:00:00Z');
ok('live, when a rollback went out after that release: refuses and asks for the commit', w.code === 1 && w.log.includes('A rollback went out after the last release') && !w.out);
w = await which('live', ' ', '');
ok('live, with no green release to read: refuses', w.code === 1 && w.log.includes('No green release was found'));
ok('the rollback checks out the commit it chose', ROLLBACK.includes('ref: ${{ steps.which.outputs.ref }}') && /ASKED: \$\{\{ github\.event\.inputs\.ref \}\}/.test(ROLLBACK));
await Deno.remove(wdir, { recursive: true });

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
