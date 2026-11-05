// ── schema-dump.yml: what a public repo needs from it ────────────────────────
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/schema_dump_test.mjs
// Runs the workflow's real step scripts in order, the way GitHub does (bash -e,
// only that step's env), with `npx` swapped for a stub that writes a fixture
// dump. No network, no secrets, nothing touches production. It lives outside
// tests/presence because ci-pure-tests.sh gives those suites no --allow-run.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// Just enough YAML for this file's shape: steps at 6 spaces, keys at 8, values at 10.
function parseSteps(yml) {
  const lines = yml.split('\n');
  const steps = [];
  for (let i = lines.indexOf('    steps:') + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {6}(- | {2})([\w-]+):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === '- ') steps.push({ env: {}, with: {} });
    const step = steps[steps.length - 1];
    const [key, value] = [m[2], m[3]];
    if (key === 'env' || key === 'with') {
      while (/^ {10}\S/.test(lines[i + 1] ?? '')) {
        const [, k, v] = lines[++i].match(/^ {10}([\w-]+):\s*(.*)$/);
        step[key][k] = v;
      }
    } else if (key === 'run' && value === '|') {
      const body = [];
      while (i + 1 < lines.length && /^( {10}|$)/.test(lines[i + 1])) body.push(lines[++i].slice(10));
      step.run = body.join('\n') + '\n';
    } else {
      step[key] = value;
    }
  }
  return steps;
}

const WORKFLOW = read('.github/workflows/schema-dump.yml');
const steps = parseSteps(WORKFLOW);
const PIN = WORKFLOW.match(/^ {2}SUPABASE_CLI_VERSION: "(.+)"$/m)?.[1];
const FLAGS = WORKFLOW.match(/openssl enc (-aes\S+ .*?) -salt/)?.[1] ?? '';
const DUMP_FILE = '00-schema-foundation.sql';
const FAKE = {
  SUPABASE_DB_URL: 'postgresql://postgres.fakeref:fake-db-password@pooler.example.invalid:6543/postgres',
  SCHEMA_DUMP_PASSPHRASE: 'fake-passphrase-'.repeat(4),
};

const STUB_NPX = `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_CALLS"
[ "$STUB_EXIT" = "0" ] || exit "$STUB_EXIT"
while [ $# -gt 0 ]; do [ "$1" = "-f" ] && out=$2; shift; done
cp "$STUB_DUMP" "$out"
`;

async function runWorkflow({ dump, secrets = FAKE, cliExit = 0 }) {
  const dir = await Deno.makeTempDir({ prefix: 'schema-dump-test-' });
  const [bin, work] = [`${dir}/bin`, `${dir}/work`];
  await Deno.mkdir(bin);
  await Deno.mkdir(work);
  await Deno.writeTextFile(`${bin}/npx`, STUB_NPX, { mode: 0o755 });
  await Deno.writeTextFile(`${dir}/dump.sql`, dump);

  const r = { work, log: '', failedAt: null, uploaded: null, calls: [], files: [] };
  for (const step of steps) {
    if (!step.run) {
      if (step.uses?.startsWith('actions/upload-artifact')) r.uploaded = step.with.path;
      continue;
    }
    const env = {
      PATH: `${bin}:${Deno.env.get('PATH')}`,
      TMPDIR: dir,
      SUPABASE_CLI_VERSION: PIN,
      STUB_DUMP: `${dir}/dump.sql`,
      STUB_CALLS: `${dir}/calls`,
      STUB_EXIT: String(cliExit),
    };
    for (const [k, v] of Object.entries(step.env)) {
      const secret = v.match(/secrets\.(\w+)/)?.[1];
      env[k] = secret ? (secrets[secret] ?? '') : v;
    }
    await Deno.writeTextFile(`${dir}/step.sh`, step.run);
    const { code, stdout, stderr } = await new Deno.Command('bash', {
      args: ['-e', `${dir}/step.sh`], cwd: work, env, clearEnv: true, stdout: 'piped', stderr: 'piped',
    }).output();
    const text = new TextDecoder();
    r.log += text.decode(stdout) + text.decode(stderr);
    if (code !== 0) { r.failedAt = step.name; break; }
  }
  r.files = [...Deno.readDirSync(work)].map((e) => e.name);
  try { r.calls = Deno.readTextFileSync(`${dir}/calls`).trim().split('\n'); } catch { /* the CLI never ran */ }
  return r;
}

// ── Static: the pin, the secrets each step can see, what gets uploaded ───────
for (const f of ['deploy', 'rollback', 'schema-dump']) {
  const yml = read(`.github/workflows/${f}.yml`);
  ok(`${f}.yml pins the same CLI`, PIN && yml.includes(`SUPABASE_CLI_VERSION: "${PIN}"`), PIN);
  ok(`${f}.yml never runs an unpinned supabase`, !/npx[^\n]*\bsupabase(?!@)/.test(yml));
}
const named = (word) => steps.find((s) => s.name?.includes(word));
ok('the passphrase check is the first step', steps[0].name?.includes('passphrase'));
ok('only the dump step sees the production URL', steps.filter((s) => s.env.DB_URL).length === 1 && named('Dump schema').env.DB_URL.includes('SUPABASE_DB_URL'));
ok('the dump and guard steps do not see the passphrase', !named('Dump schema').env.SCHEMA_DUMP_PASSPHRASE && !named('guard').env.SCHEMA_DUMP_PASSPHRASE);
ok('the guard step sees no secrets', Object.keys(named('guard').env).length === 0);
ok('no checkout, so no repo code runs beside the production URL', !steps.some((s) => s.uses?.startsWith('actions/checkout')));
ok('the job has no GitHub token permissions', /^permissions: \{\}$/m.test(WORKFLOW));
const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
ok('only the encrypted file is uploaded, and a missing file fails', upload.with.path === `${DUMP_FILE}.enc` && upload.with['if-no-files-found'] === 'error');
ok('no step prints the dump', !steps.some((s) => s.run && new RegExp(`\\b(head|tail|cat)\\b[^\\n]*${DUMP_FILE}`).test(s.run)));
const runbook = read('docs/runbooks/ENVIRONMENTS.md');
ok('the runbook decrypts with the same flags', FLAGS && runbook.includes(`openssl enc -d ${FLAGS} -pass env:`) && WORKFLOW.includes(`openssl enc -d ${FLAGS} -pass env:`), FLAGS);
ok('the secrets inventory lists the passphrase', read('docs/SECRETS-INVENTORY.md').includes('`SCHEMA_DUMP_PASSPHRASE`'));

// ── A clean dump: 0000_baseline.sql is what this workflow produced in July ───
const BASE = read('supabase/migrations/0000_baseline.sql');
const clean = await runWorkflow({ dump: BASE });
ok('a real dump passes every step', clean.failedAt === null, clean.failedAt ?? '');
ok('the CLI ran once, pinned, with the expected arguments', clean.calls.length === 1 && clean.calls[0] === `--yes supabase@${PIN} db dump --db-url ${FAKE.SUPABASE_DB_URL} --schema public -f ${DUMP_FILE}`);
ok('only the ciphertext is left to upload', clean.files.join() === `${DUMP_FILE}.enc` && clean.uploaded === `${DUMP_FILE}.enc`);
const cipherPath = `${clean.work}/${DUMP_FILE}.enc`;
const cipher = Deno.readFileSync(cipherPath);
ok('the upload is ciphertext, not SQL', new TextDecoder().decode(cipher.slice(0, 8)) === 'Salted__' && !new TextDecoder().decode(cipher).includes('CREATE TABLE'));
const decrypt = (passphrase) => new Deno.Command('openssl', {
  args: ['enc', '-d', ...FLAGS.split(' '), '-pass', 'env:P', '-in', cipherPath],
  env: { P: passphrase }, stdout: 'piped', stderr: 'null',
}).output();
const opened = await decrypt(FAKE.SCHEMA_DUMP_PASSPHRASE);
ok('the runbook flags decrypt it to the exact dump', opened.code === 0 && new TextDecoder().decode(opened.stdout) === BASE);
ok('a wrong passphrase does not open it', (await decrypt('wrong-'.repeat(8))).code !== 0);
ok('the log has no line of the dump', !BASE.split('\n').some((l) => l.length >= 12 && clean.log.includes(l)));
ok('the log has neither secret', !clean.log.includes(FAKE.SCHEMA_DUMP_PASSPHRASE) && !clean.log.includes(FAKE.SUPABASE_DB_URL));

// ── Unsafe dumps: blocked before encryption, and the log never shows the text ─
// Tokens are split so the fake keys don't set off secret scanning on this file.
const jwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9.' + 'eyJyb2xlIjoic2VydmljZSJ9';
const UNSAFE = [
  ['row data as COPY', 'row data', 'COPY "public"."contacts" ("id", "name") FROM stdin;\n1\tJane Customer\n\\.', 'Jane Customer'],
  ['row data as INSERT', 'row data', `INSERT INTO "public"."contacts" VALUES (1, 'Jane Customer');`, 'Jane Customer'],
  ['an address at a client domain', 'email addresses', `DEFAULT 'jane@client-business.example'`, 'jane@client-business'],
  ['an address at a webmail the first list missed', 'email addresses', `DEFAULT 'jane@outlook.com'`, 'jane@outlook'],
  ['a client address beside the studio one', 'email addresses', `DEFAULT 'eric@davisdigitalstudio.com, jane@outlook.com'`, 'jane@outlook'],
  ['a name from the first list, any case', 'known names', `COMMENT ON TABLE "t" IS 'BACCHUS kitchen export';`, 'kitchen export'],
  ['a bare webmail domain from the first list', 'known names', `CHECK (email LIKE '%' || '@gmail.com')`, `'%' || '@gmail`],
  ['a JWT in a function body', 'keys and tokens', `  headers := '{"Authorization": "Bearer ${jwt}"}'`, jwt],
  ['a Stripe live key', 'keys and tokens', `  key := '${'sk_' + 'live_' + 'a1'.repeat(12)}';`, 'a1a1a1a1'],
  ['a webhook secret', 'keys and tokens', `  key := '${'whsec' + '_' + 'b2'.repeat(12)}';`, 'b2b2b2b2'],
  ['a Resend key', 'keys and tokens', `  key := '${'re' + '_' + 'c3'.repeat(12)}';`, 'c3c3c3c3'],
  ['a password in a URL', 'passwords in URLs', `  url := 'postgres://admin:hunter2secret@db.example.invalid/x';`, 'hunter2secret'],
];
for (const [label, check, line, secretText] of UNSAFE) {
  const r = await runWorkflow({ dump: `${BASE}\n${line}\n` });
  const at = (`${BASE}\n`).split('\n').length;
  ok(`blocks ${label}`, r.failedAt?.includes('guard') && r.uploaded === null && !r.files.some((f) => f.endsWith('.enc')), r.failedAt ?? 'not blocked');
  ok(`  names "${check}" and the line, not the text`, r.log.includes(`FAIL  ${check}`) && r.log.includes(`first at: ${at}`) && !r.log.includes(secretText));
}

// ── Nothing usable to scan, or nothing to encrypt with ───────────────────────
const stoppedByGuard = (r) => r.failedAt?.includes('guard') && r.uploaded === null;
ok('an empty dump is blocked', stoppedByGuard(await runWorkflow({ dump: '' })));
ok('a dump with only the header is blocked', stoppedByGuard(await runWorkflow({ dump: BASE.split('CREATE')[0] })));
const cliDown = await runWorkflow({ dump: BASE, cliExit: 1 });
ok('a CLI failure stops the run at the dump step', cliDown.failedAt?.includes('Dump schema') && cliDown.uploaded === null);
for (const [label, secrets] of [['missing', { SUPABASE_DB_URL: FAKE.SUPABASE_DB_URL }], ['short', { ...FAKE, SCHEMA_DUMP_PASSPHRASE: 'too-short' }]]) {
  const r = await runWorkflow({ dump: BASE, secrets });
  ok(`a ${label} passphrase stops the run before production is read`, r.failedAt === steps[0].name && r.calls.length === 0 && r.files.length === 0);
}

const passed = results.filter((x) => x.p).length;
console.log(`\n════ SCHEMA DUMP WORKFLOW: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
