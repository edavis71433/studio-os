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
// - the seed refuses any database but one on this machine.

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
  /^ {2}pull_request:\n {4}paths:\n {6}- \.github\/workflows\/isolation\.yml\n {6}- scripts\/isolation-scratch\.sh\n {6}- tests\/isolation\/\*\*\n/m.test(ON));
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
