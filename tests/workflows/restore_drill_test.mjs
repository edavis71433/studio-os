// ── restore-drill.yml: the restore drill, and its refusal to touch production (builder item 415) ──
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/restore_drill_test.mjs
// The drill itself needs a throwaway Supabase project, which costs money, so it runs only by
// hand with Eric's yes (docs/RUN-SHEET.md, "Restore"). What can be proved without one is
// proved here: the workflow starts only by hand behind a typed phrase, refuses without the
// drill's database and the passphrase, and the real scripts/restore-drill.sh stops before
// it reads or writes anything when the drill project is production or isn't empty
// (stand-in psql, npx and curl that log every call).

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SCRIPT = decodeURIComponent(new URL('scripts/restore-drill.sh', ROOT).pathname);
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// ── The workflow's shape ─────────────────────────────────────────────────────
const WF = read('.github/workflows/restore-drill.yml');
ok('starts only by hand: no schedule, no push, no pull request', /^on:\n {2}workflow_dispatch:/m.test(WF) && !/^ {2}(schedule|push|pull_request):/m.test(WF));
ok('behind a typed phrase that arrives as data', WF.includes('CONFIRM: ${{ github.event.inputs.confirm }}') && WF.includes('[ "$CONFIRM" = restore-drill ]'));
ok('refuses without the drill\'s database or the passphrase, before checking anything out', WF.indexOf('DRILL_DB_URL (the throwaway project') > 0 && WF.indexOf('DRILL_DB_URL (the throwaway project') < WF.indexOf('actions/checkout'));
ok('restores the files from a weekly copy\'s artifact, the newest green one by default', WF.includes('actions/workflows/storage-copy.yml/runs?status=success') && WF.includes('name: uploaded-files-encrypted'));
ok('may read the repository and the runs, nothing else', /^permissions:\n {2}contents: read\n {2}actions: read\n(?! {2})/m.test(WF));
ok('uploads nothing from the run', !WF.includes('upload-artifact'));
ok('nothing can pass on its own failure', !WF.includes('continue-on-error'));
ok('the same CLI version as the release', WF.match(/SUPABASE_CLI_VERSION: "(.+)"/)?.[1] === read('.github/workflows/deploy.yml').match(/SUPABASE_CLI_VERSION: "(.+)"/)?.[1]);

// ── The script's guards, run for real ────────────────────────────────────────
const dir = await Deno.makeTempDir({ prefix: 'restore-drill-test-' });
const bin = `${dir}/bin`;
await Deno.mkdir(bin);
for (const tool of ['npx', 'curl', 'openssl']) {
  await Deno.writeTextFile(`${bin}/${tool}`, `#!/bin/bash\necho "${tool} $*" >> "${dir}/calls"\nexit 1\n`);
  await Deno.chmod(`${bin}/${tool}`, 0o755);
}
// psql answers how many Studio OS tables the drill database already has.
await Deno.writeTextFile(`${bin}/psql`, `#!/bin/bash\necho "psql $*" >> "${dir}/calls"\ncat "${dir}/tables"\n`);
await Deno.chmod(`${bin}/psql`, 0o755);
const PROD = 'prodref';
async function drill(env, tables = '0') {
  await Deno.writeTextFile(`${dir}/tables`, `${tables}\n`);
  await Deno.remove(`${dir}/calls`).catch(() => {});
  const { code, stdout } = await new Deno.Command('bash', {
    args: [SCRIPT], cwd: dir, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${bin}:${Deno.env.get('PATH')}`, HOME: dir, TMPDIR: dir, SUPABASE_CLI_VERSION: '2.122.0',
      PROD_DB_URL: `postgresql://postgres.${PROD}:pw@pooler.example.invalid:6543/postgres`, PROD_REF: PROD,
      DRILL_DB_URL: 'postgresql://postgres.drillref:pw@pooler.example.invalid:6543/postgres', DRILL_REF: 'drillref',
      SUPABASE_ACCESS_TOKEN: 'sbp_fake', ARCHIVE: `${dir}/copy.enc`, BACKUP_PASSPHRASE: 'p'.repeat(40), ...env },
  }).output();
  const calls = (await Deno.readTextFile(`${dir}/calls`).catch(() => '')).trim().split('\n').filter(Boolean);
  return { code, log: new TextDecoder().decode(stdout), calls };
}
let d = await drill({ DRILL_REF: PROD });
ok('the drill project is production: refuses, and runs nothing', d.code === 1 && d.log.includes('The drill project is production. Nothing was done.') && !d.calls.length);
d = await drill({ DRILL_DB_URL: `postgresql://postgres.${PROD}:pw@pooler.example.invalid:6543/postgres` });
ok('the drill database address points at production: refuses, and runs nothing', d.code === 1 && d.log.includes('points at production') && !d.calls.length);
d = await drill({ DRILL_DB_URL: 'postgresql://postgres.someoneelse:pw@pooler.example.invalid:6543/postgres' });
ok('the drill database address doesn\'t name the drill project: refuses, and runs nothing', d.code === 1 && d.log.includes('doesn\'t name the drill project') && !d.calls.length);
d = await drill({}, '74');
ok('the drill project already holds Studio OS tables: refuses after one read, and copies nothing', d.code === 1 && d.log.includes('already has 74 Studio OS tables') && d.calls.length === 1 && d.calls[0].startsWith('psql postgresql://postgres.drillref'));
d = await drill({});
ok('an empty drill project passes the guards and goes on to the copy (here the stand-in CLI stops it)', d.code !== 0 && d.calls.some((c) => c.startsWith('npx --yes supabase@2.122.0 db dump --db-url postgresql://postgres.prodref')) && !d.calls.some((c) => c.startsWith('npx') && c.includes('drillref')));
for (const name of ['PROD_DB_URL', 'DRILL_DB_URL', 'DRILL_REF', 'ARCHIVE', 'BACKUP_PASSPHRASE']) {
  d = await drill({ [name]: '' });
  ok(`no ${name}: stops before anything`, d.code !== 0 && !d.calls.length);
}
await Deno.remove(dir, { recursive: true });

const passed = results.filter((x) => x.p).length;
console.log(`\n════ RESTORE DRILL (415): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
