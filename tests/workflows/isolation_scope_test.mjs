// ── isolation.yml: the walls between studios, checked before every release ─────────
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/isolation_scope_test.mjs
// Builder item 212. The suites that prove one studio can't read another's data run on a
// scratch database (scripts/isolation-scratch.sh). This holds in place what makes that
// run worth trusting:
// - it reads no repository secret and can only read the code, in a public repository
//   whose logs any signed-in account can open;
// - it sets the scratch database up with the CLI version production deploys with, and
//   with production's migrations, the fenced 0003 to 0005 left out;
// - a suite that skips, fails or never says PASS fails the run (its real counting
//   function runs here against stand-in suites);
// - the seed refuses any database but one on this machine;
// - every scratch stack (this one, the rehearsal's, the publish journey's) listens
//   below the ports the machine hands its own outgoing connections, and tries a start
//   once more if a port is taken anyway (scripts/scratch-stack.sh).

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const WF = read('.github/workflows/isolation.yml');
const DEPLOY = read('.github/workflows/deploy.yml');
const SCRIPT = read('scripts/isolation-scratch.sh');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// ── What the workflow may touch ──────────────────────────────────────────────
ok('no repository secret is read', !/secrets\./.test(WF) && !/secrets\./.test(SCRIPT));
ok('the token can read the code and nothing else', /^permissions:\n {2}contents: read\n(?! {2}\S)/m.test(WF) && !/^ {4}permissions:/m.test(WF));
ok('nothing here deploys or names production', !/functions deploy|db push|link --project-ref|SUPABASE_PROJECT_REF|SUPABASE_ACCESS_TOKEN|qksstlqzbhesadrrofgn/.test(WF + SCRIPT));
ok('nothing can pass on its own failure', !WF.includes('continue-on-error') && !/^ {4,}if:/m.test(WF));

// ── When it runs ─────────────────────────────────────────────────────────────
const ON = WF.slice(WF.indexOf('\non:\n'), WF.indexOf('\npermissions:'));
ok('deploy.yml can call it', /^ {2}workflow_call:$/m.test(ON));
ok('it can be run by hand', /^ {2}workflow_dispatch:$/m.test(ON));
ok('a pull request runs it only when one of its own files changes',
  /^ {2}pull_request:\n {4}paths:\n {6}- \.github\/workflows\/isolation\.yml\n {6}- scripts\/isolation-scratch\.sh\n {6}- scripts\/scratch-stack\.sh\n {6}- tests\/isolation\/\*\*\n/m.test(ON));
ok('no other trigger (a push or a schedule would only fill the queue)', !/^ {2}(push|schedule|pull_request_target):/m.test(ON));
ok('one job, and it runs the script', /^jobs:\n {2}isolation:\n/m.test(WF) && /^ {8}run: bash scripts\/isolation-scratch\.sh$/m.test(WF));
ok('it has a time limit', /^ {4}timeout-minutes: \d+$/m.test(WF));

// ── The same tools as production ─────────────────────────────────────────────
const pin = (wf) => wf.match(/^ {2}SUPABASE_CLI_VERSION: "([\d.]+)"$/m)?.[1];
ok('the scratch database is made by the CLI version production deploys with', !!pin(WF) && pin(WF) === pin(DEPLOY), `${pin(WF)} vs ${pin(DEPLOY)}`);
ok('the script uses that pin and no other', /npx --yes "supabase@\$CLI_VERSION"/.test(SCRIPT) && !/supabase@\d/.test(SCRIPT));
ok('the Deno version matches ci.yml', WF.match(/deno-version: "([\d.]+)"/)?.[1] === read('.github/workflows/ci.yml').match(/deno-version: "([\d.]+)"/)?.[1]);
ok('the migrations are production\'s: only the fenced 0003, 0004 and 0005 are left out',
  /0003_\*\|0004_\*\|0005_\*\) .*continue ;;/.test(SCRIPT) && (SCRIPT.match(/\b00\d\d_\*/g) || []).length === 3);
ok('both servers come from this commit, unchecked by the gateway as in production', /cp -R "\$REPO\/supabase\/functions"/.test(SCRIPT) && /functions serve --no-verify-jwt/.test(SCRIPT));

// ── Which suites run ─────────────────────────────────────────────────────────
const SUITES = ['sales_tenant_isolation_e2e', 'sales_closing_isolation_e2e', 'projects_isolation_e2e', 'sales_e2e', 'sales_foundation_e2e',
  'sales_closing_e2e', 'projects_e2e', 'project_comms_e2e', 'project_delivery_e2e', 'project_report_e2e', 'service_intake_e2e', 'service_lifecycle_e2e'];
const loop = SCRIPT.match(/for s in ([\s\S]*?); do/)?.[1].replace(/\\\n/g, ' ').trim().split(/\s+/) || [];
ok('the tenant isolation suite runs', /tests\/isolation\/isolation_test\.ts/.test(SCRIPT));
for (const s of SUITES) ok(`runs ${s}`, loop.includes(s));
ok('and every suite it names exists', loop.length === SUITES.length && loop.every((s) => { try { return Deno.statSync(new URL(`tests/presence/${s}_test.mjs`, ROOT)).isFile; } catch { return false; } }));

// ── Its counting, run for real against stand-in suites ───────────────────────
const FN = SCRIPT.match(/^run_suite\(\) \{[\s\S]*?^\}$/m)?.[0];
ok('the counting function is found', !!FN);
const dir = await Deno.makeTempDir({ prefix: 'isolation-scope-test-' });
async function count(lines, code = 0) {
  const suite = `${dir}/suite.sh`;
  await Deno.writeTextFile(suite, `printf '%s\\n' ${lines.map((l) => `'${l.replace(/'/g, "'\\''")}'`).join(' ')}\nexit ${code}\n`);
  const { stdout } = await new Deno.Command('bash', {
    args: ['-c', `say() { :; }\npassed=0; failed=0; bad=""\n${FN}\nrun_suite one bash ${suite}\necho "RESULT $passed $failed [$bad]"`],
    stdout: 'piped', stderr: 'null',
  }).output();
  const m = new TextDecoder().decode(stdout).match(/RESULT (\d+) (\d+) \[(.*)\]/);
  return m ? { passed: +m[1], failed: +m[2], flagged: m[3].trim() === 'one' } : null;
}
const green = await count(['PASS  A can read its own deal', 'PASS  B cannot read A\'s deal']);
ok('a suite whose every check passes counts its passes', green?.passed === 2 && green?.failed === 0 && !green.flagged, JSON.stringify(green));
const iso = await count(['  ✅ A-staff cannot READ tenant B clients', '  ❌ B-staff cannot READ tenant A clients'], 1);
ok('the tenant suite\'s ticks and crosses are counted, and a cross fails it', iso?.passed === 1 && iso?.failed === 1 && iso.flagged, JSON.stringify(iso));
const skipped = await count(['need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)']);
ok('a suite that skips itself fails the run, though it exits 0', skipped?.flagged === true, JSON.stringify(skipped));
const partSkip = await count(['PASS  proposal sent', 'SKIP  token: A’s proposal link is bound to that one proposal id — link secret not configured on target']);
ok('a suite that skips one of its checks fails the run', partSkip?.flagged === true, JSON.stringify(partSkip));
const passSkip = await count(['PASS  5b/c. accept link (skipped — no signing secret in env)']);
ok('a check that passes by skipping fails the run', passSkip?.flagged === true, JSON.stringify(passSkip));
const crashed = await count(['PASS  setup: project created'], 1);
ok('a suite that exits non-zero fails the run', crashed?.flagged === true, JSON.stringify(crashed));
const silent = await count(['nothing to see here']);
ok('a suite that never says PASS fails the run', silent?.flagged === true, JSON.stringify(silent));
await Deno.remove(dir, { recursive: true });

// ── Every scratch stack gets its ports ───────────────────────────────────────
// Nov 23 2026: two releases' walls check stopped before testing anything, each on a
// fresh machine: "failed to bind host port 0.0.0.0:54322/tcp: address already in use".
// `supabase init` puts a stack on 54320 to 54329, inside the range the machine hands
// out to its own outgoing connections, and an image download had been given 54322.
// scripts/scratch-stack.sh moves the ports below that range and, if a port is taken
// anyway, tries a start once more. Its two functions run here for real.
const HELPER = 'scripts/scratch-stack.sh';
const HELPER_PATH = decodeURIComponent(new URL(HELPER, ROOT).pathname);
const STACKS = ['scripts/isolation-scratch.sh', 'scripts/rehearse-changes.sh', 'scripts/publish-journey.sh'];
const PORTS_CALL = 'scratch_ports "$WORK/supabase/config.toml" || fail';
const START_CALL = 'scratch_start "$WORK/start.log"';
const code = (p) => read(p).replace(/^\s*#.*$/gm, '');
const starters = [...Deno.readDirSync(new URL('scripts/', ROOT))].map((e) => `scripts/${e.name}`)
  .filter((p) => p.endsWith('.sh') && p !== HELPER && /\bsupabase start\b/.test(code(p))).sort();
ok('the scripts that start a scratch stack are these three', starters.join() === [...STACKS].sort().join(), starters.join(', '));
for (const p of STACKS) {
  const s = code(p);
  const at = (needle) => s.indexOf(needle);
  ok(`${p} loads the helper once its own \`supabase\` is defined`, at('supabase() {') > -1 && at('. "$REPO/scripts/scratch-stack.sh"') > at('supabase() {'));
  ok(`${p} moves the ports after \`supabase init\` and before the start`,
    at('supabase init') > -1 && at(PORTS_CALL) > at('supabase init') && at(START_CALL) > at(PORTS_CALL));
  ok(`${p} starts the stack only through the helper`, !/supabase start (?!--help)/.test(s));
}
ok('the email stand-in listens below that range too', Number(SCRIPT.match(/^MAIL_PORT=(\d+)\b/m)?.[1]) < 32768, SCRIPT.match(/^MAIL_PORT=.*$/m)?.[0]);

const tmp = await Deno.makeTempDir({ prefix: 'scratch-stack-test-' });
const sh = async (script, arg) => {
  const out = await new Deno.Command('bash', { args: ['-c', script, '_', HELPER_PATH, arg], stdout: 'piped', stderr: 'piped' }).output();
  return { code: out.code, text: new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr) };
};
// The config `supabase init` writes (CLI 2.x), cut down to its ports and a few neighbours.
const INIT = [
  'project_id = "isolation-scratch"', '',
  '[api]', 'enabled = true', '# Port to use for the API URL.', 'port = 54321', 'schemas = ["public", "graphql_public"]', '',
  '[db]', '# Port to use for the local database URL.', 'port = 54322', '# Port used by db diff command to initialize the shadow database.', 'shadow_port = 54320', 'major_version = 17', '',
  '[db.pooler]', 'enabled = false', 'port = 54329', '',
  '[studio]', 'enabled = true', 'port = 54323', 'api_url = "http://127.0.0.1"', '',
  '[inbucket]', 'enabled = true', 'port = 54324', '# smtp_port = 54325', '# pop3_port = 54326', '',
  '[edge_runtime]', 'inspector_port = 8083', '',
  '[analytics]', 'enabled = true', 'port = 54327', '',
].join('\n');
async function ports(config) {
  const cfg = `${tmp}/config.toml`;
  await Deno.writeTextFile(cfg, config);
  const r = await sh('. "$1"; scratch_ports "$2"', cfg);
  return { ...r, after: await Deno.readTextFile(cfg) };
}
const moved = await ports(INIT);
const listening = [...moved.after.matchAll(/^(?:[a-z0-9]+_)?port = (\d+)$/gm)].map((m) => +m[1]);
ok('the API and the database move to 24321 and 24322', moved.code === 0 && /^port = 24321$/m.test(moved.after) && /^port = 24322$/m.test(moved.after), moved.text.trim());
ok('every port in the config is below 32768: the shadow and the services left off too', listening.length === 8 && listening.every((n) => n < 32768), listening.join(' '));
ok('nothing else in the config changes', moved.after.replace(/= 243(\d\d)$/gm, '= 543$1') === INIT);
const smtp = await ports(INIT.replace('# smtp_port = 54325', 'smtp_port = 54325'));
ok('a port the CLI switches on later moves too', smtp.code === 0 && /^smtp_port = 24325$/m.test(smtp.after));
const renamed = await ports(INIT.replace('port = 54321', 'api_port = 54321'));
ok('a config whose API port isn\'t where this expects is refused, and the run says what it found',
  renamed.code !== 0 && /doesn't have the API and database ports/.test(renamed.text) && /api_port = 24321/.test(renamed.text), renamed.text.trim());

async function start(plan) {   // what each `supabase start` does, in order: ok, taken or broken
  const d = await Deno.makeTempDir({ dir: tmp });
  await Deno.writeTextFile(`${d}/plan`, plan.join('\n') + '\n');
  const r = await sh(`. "$1"
D="$2"; n=0
supabase() {
  echo "$*" >> "$D/calls"
  [ "$1" = start ] || return 0
  n=$((n + 1))
  case "$(sed -n "\${n}p" "$D/plan")" in
    ok) echo 'Started supabase local development setup.' ;;
    taken) echo 'failed to start docker container "supabase_db_x": failed to bind host port 0.0.0.0:24322/tcp: address already in use'; return 1 ;;
    *) echo 'ERROR: relation "deals" does not exist'; return 1 ;;
  esac
}
SCRATCH_RETRY_SECONDS=0 scratch_start "$D/start.log" -x studio`, d);
  const calls = (await Deno.readTextFile(`${d}/calls`).catch(() => '')).trim().split('\n');
  return { ...r, calls: calls.join(' | '), log: await Deno.readTextFile(`${d}/start.log`).catch(() => '') };
}
const once = await start(['ok']);
ok('a stack that starts is started once', once.code === 0 && once.calls === 'start -x studio', once.calls);
const retried = await start(['taken', 'ok']);
ok('a port taken on the first try: it stops what started and starts once more',
  retried.code === 0 && retried.calls === 'start -x studio | stop --no-backup | start -x studio' && /Started/.test(retried.log), retried.calls);
ok('and the run says which port', /A port was taken \(host port 0\.0\.0\.0:24322\/tcp\)/.test(retried.text), retried.text.trim());
const twice = await start(['taken', 'taken']);
ok('taken twice: it stops there and says it is the machine, not the code',
  twice.code !== 0 && twice.calls === 'start -x studio | stop --no-backup | start -x studio' && /the machine, not the code/.test(twice.text), twice.calls);
const broken = await start(['broken']);
ok('any other failure is not tried again: a broken migration fails at once',
  broken.code !== 0 && broken.calls === 'start -x studio' && /does not exist/.test(broken.log), broken.calls);
await Deno.remove(tmp, { recursive: true });

// ── The servers can be served at all ─────────────────────────────────────────
// `supabase functions serve` follows every import-looking path in the functions'
// files, comments included, and stops at one that doesn't exist. The first scratch
// run, Nov 12 2026, stopped on two comments (lib/lazy.ts, industry/sdk.ts). This is
// the same pattern, so a comment like that fails here rather than at the deploy.
const IMPORTISH = /(?:import|export)\s+(?:\{[^{}]+\}|.*?)\s*(?:from)?\s*['"](.*?)['"]|import\(\s*['"](.*?)['"]\)/gi;
const unresolved = [];
const walk = (dir) => {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) { walk(u); continue; }
    if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
    Deno.readTextFileSync(u).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(IMPORTISH)) {
        const spec = m[1] || m[2] || '';
        if (!spec.startsWith('.')) continue;
        try { Deno.statSync(new URL(spec, u)); } catch { unresolved.push(`${u.pathname.split('/supabase/functions/')[1]}:${i + 1} ${spec}`); }
      }
    });
  }
};
walk(new URL('supabase/functions/', ROOT));
ok('every path the local server tool follows exists, comments included', unresolved.length === 0, unresolved.join(', '));

// ── The seed only ever touches a database on this machine ────────────────────
const seed = await new Deno.Command(Deno.execPath(), {
  args: ['run', '--allow-env', new URL('tests/isolation/scratch_seed.mjs', ROOT).pathname],
  env: { SCRATCH_API: 'https://example.supabase.co', SCRATCH_ANON_KEY: 'a', SCRATCH_SERVICE_KEY: 's' }, stdout: 'piped', stderr: 'piped',
}).output();
ok('the seed refuses a database that isn\'t on this machine, before any request', seed.code === 2 && /refusing to seed https:\/\/example\.supabase\.co/.test(new TextDecoder().decode(seed.stderr)));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ ISOLATION SCOPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
