// ── rehearsal.yml: every pull request rehearses the database changes (builder item 420) ──
//   deno run --allow-read tests/workflows/rehearsal_test.mjs
// The rehearsal itself needs Docker, so it runs on GitHub, on every pull request, and its
// result is the real test (a migration that won't apply, or a pack that can't run twice,
// turns it red). This holds the shape that makes it trustworthy: it runs for every pull
// request, reads no secret, builds the database with the same CLI production's functions
// go out with, leaves out the same fenced migrations as the walls test, runs each pack from
// 0260 on twice, and asks the ledger the release's own question.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

const WF = read('.github/workflows/rehearsal.yml');
const SCRIPT = read('scripts/rehearse-changes.sh');
const DEPLOY = read('.github/workflows/deploy.yml');
const ISOLATION = read('scripts/isolation-scratch.sh');

ok('runs on every pull request: no path or branch filter', /^ {2}pull_request:\n {2}workflow_dispatch:$/m.test(WF) && !/^\s*(paths|branches)(-ignore)?:/m.test(WF));
ok('reads no repository secret', !/secrets\./.test(WF) && !/secrets\./.test(SCRIPT));
ok('may read the repository and nothing else', /^permissions:\n {2}contents: read\n(?! {2})/m.test(WF));
ok('runs the script, and nothing can pass on its own failure', /run: bash scripts\/rehearse-changes\.sh$/m.test(WF) && !WF.includes('continue-on-error'));
ok('no job is called browser or test (GitHub matches required checks by name)', !/^ {2}(browser|test):$/m.test(WF));
const pin = (s) => s.match(/^ {2}SUPABASE_CLI_VERSION: "(.+)"$/m)?.[1];
ok('builds the scratch database with the CLI version production\'s functions go out with', !!pin(WF) && pin(WF) === pin(DEPLOY), `${pin(WF)} / ${pin(DEPLOY)}`);
const fenced = (s) => s.match(/^\s+(0003_\*\|0004_\*\|0005_\*)\)/m)?.[1];
ok('leaves out the same fenced migrations production never applied, as the walls test does', fenced(SCRIPT) === '0003_*|0004_*|0005_*' && fenced(ISOLATION) === fenced(SCRIPT));
ok('every migration, in order: the CLI applies the folder on start, and the run fails if one doesn\'t apply', SCRIPT.includes('scratch_start "$WORK/start.log"') && SCRIPT.includes("fail \"A migration didn't apply on a fresh database"));
ok('each apply pack from 0260 on runs twice, stopping at its first error', /FIRST_LEDGER=260/.test(SCRIPT) && /for run in 1 2; do/.test(SCRIPT) && /ON_ERROR_STOP=1/.test(SCRIPT));
ok('the ledger must hold every migration from 0260 on, each pack\'s runs, and the newest number', SCRIPT.includes('wrote no ledger row') && SCRIPT.includes("didn't write its number on each run") && SCRIPT.includes("the ledger's newest number is"));
// The release asks production this; the rehearsal asks the scratch database the same thing first.
const gateQuery = DEPLOY.match(/query="(select coalesce\(max\(number\), 0\) as newest, coalesce\(bool_or\(number = \$n\), false\) as has from public\.presence_change_ledger)"/)?.[1];
ok('the release\'s question is found in deploy.yml', !!gateQuery);
ok('…and the rehearsal asks the same table the same thing', SCRIPT.includes('coalesce(max(number), 0)') && SCRIPT.includes('coalesce(bool_or(number = ') && SCRIPT.includes('from public.presence_change_ledger'));
ok('the scratch database stops when the run ends', /trap cleanup EXIT/.test(SCRIPT) && /supabase stop --no-backup/.test(SCRIPT));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ REHEARSAL: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
