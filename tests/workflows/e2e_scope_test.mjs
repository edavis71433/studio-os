// ── e2e.yml: can `browser` be a required check, and does it skip only safely? ─
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/e2e_scope_test.mjs
// Runs the workflow's real decision step (bash -e, only that step's env) inside
// real shallow clones, checked out the way GitHub checks them out. No network.
// A wrong skip reads as a green check with nothing tested, so every case that
// must run the suite is pinned here. It lives outside the browser suite because
// a broken gate must not be what decides whether its own test runs.
// It also runs the `browser` job's verdict step, the device step's choice of tests
// and the summary script, each with made-up inputs.

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = Deno.readTextFileSync(new URL('.github/workflows/e2e.yml', ROOT));

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// A step's script: the block under `run: |` in the step that carries `marker`.
const script = (marker) => WORKFLOW.match(new RegExp(`${marker}\\n[\\s\\S]*?run: \\|\\n((?: {10}.*\\n|\\n)+)`))?.[1].replace(/^ {10}/gm, '');
const SCOPE = script('id: scope');
// Each job's lines, by name, and a job's steps.
const JOBS = Object.fromEntries([...WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)].map((m) => [m[1], m[2]]));
const stepsOf = (job) => (job || '').slice((job || '').indexOf('    steps:')).split(/^ {6}- /m).slice(1);
const STEPS = stepsOf(JOBS.scope);
const DEVICE_STEPS = stepsOf(JOBS.devices);

const text = new TextDecoder();
async function sh(cwd, cmd, ...args) {
  const { code, stdout, stderr } = await new Deno.Command(cmd, { args, cwd, stdout: 'piped', stderr: 'piped' }).output();
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${text.decode(stderr)}`);
  return text.decode(stdout).trim();
}

const dir = await Deno.makeTempDir({ prefix: 'e2e-scope-test-' });
const origin = `${dir}/origin`;
const git = (...args) => sh(origin, 'git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args);

async function write(path, body) {
  await Deno.mkdir(`${origin}/${path}`.replace(/\/[^/]*$/, ''), { recursive: true });
  await Deno.writeTextFile(`${origin}/${path}`, body);
}

// One file of each kind, so a case can edit, delete or move any of them.
const TREE = ['index.html', '_redirects', 'docs/plan.md', 'README.md'];
await Deno.mkdir(origin);
await git('init', '--quiet', '-b', 'main');
await git('config', 'uploadpack.allowAnySHA1InWant', 'true'); // as GitHub allows
for (const f of TREE) await write(f, 'first\n');
await git('add', '.');
await git('commit', '--quiet', '-m', 'base');
const BASE = await git('rev-parse', 'HEAD');

// Runs the real step in a clone at `ref`, at the same depth as the workflow's checkout.
let n = 0;
async function decide(ref, env) {
  const [work, output, summary] = [`${dir}/w${++n}`, `${dir}/o${n}`, `${dir}/s${n}`];
  await sh(dir, 'git', 'clone', '--quiet', '--depth=2', '--branch', ref, `file://${origin}`, work);
  await Deno.writeTextFile(`${dir}/step.sh`, SCOPE);
  await Deno.writeTextFile(output, '');
  const { code, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${dir}/step.sh`], cwd: work, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: Deno.env.get('PATH'), HOME: dir, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
  }).output();
  return { code, log: text.decode(stdout), run: Deno.readTextFileSync(output).trim(), summary: Deno.readTextFileSync(summary) };
}

// Applies a change on a branch off the base commit.
async function branch(name, change) {
  await git('checkout', '--quiet', '-b', name, BASE);
  await change();
  await git('add', '-A');
  await git('commit', '--quiet', '--allow-empty', '-m', name);
}

// A pull request as GitHub checks it out: a trial merge whose first parent is the base.
async function pullRequest(change) {
  const name = `pr-${++n}`;
  await branch(name, change);
  await git('checkout', '--quiet', '-b', `${name}-merge`, BASE);
  await git('merge', '--quiet', '--no-ff', '-m', 'trial merge', name);
  return decide(`${name}-merge`, { EVENT: 'pull_request', BEFORE: '' });
}

const edit = (...paths) => async () => { for (const p of paths) await write(p, 'changed\n'); };

// ── Static: the shape a required check depends on ────────────────────────────
ok('no path filter, so a pull request always gets a `browser` result', !/^\s*paths(-ignore)?:/m.test(WORKFLOW));
ok('no branch filter on pull requests', /^ {2}pull_request:\n {2}workflow_dispatch:/m.test(WORKFLOW));
ok('three jobs: the decision, the devices, and the check to require', Object.keys(JOBS).join() === 'scope,devices,browser', Object.keys(JOBS).join());
// GitHub names a job's check after its `name:`, or its key when there is none.
ok('the check to require is called browser', !!JOBS.browser && !/^ {4}name:/m.test(JOBS.browser));
// A job that is skipped reports as a pass, so the check to require must run whatever happened before it.
ok('browser always runs, so it always reports', /^ {4}if: always\(\)$/m.test(JOBS.browser));
ok('browser reads how the decision and the devices ended', /^ {4}needs: \[scope, devices\]$/m.test(JOBS.browser));
ok('no device is called browser', /^ {4}name: browser on \$\{\{ matrix\.project \}\}$/m.test(JOBS.devices));
// GitHub matches a required check by name alone, so a job called browser anywhere else could answer for this one.
for (const { name } of Deno.readDirSync(new URL('.github/workflows/', ROOT))) {
  if (name === 'e2e.yml' || !name.endsWith('.yml')) continue;
  const other = Deno.readTextFileSync(new URL(`.github/workflows/${name}`, ROOT));
  ok(`${name} has no job called browser`, !/^ {2}browser:$/m.test(other) && !/^ {4}name: browser\s*$/m.test(other));
}
ok('the decision has no if: of its own, which could skip it', !/^ {4}if:/m.test(JOBS.scope));
ok('the decision hands its answer on', /^ {4}outputs:\n {6}run: \$\{\{ steps\.scope\.outputs\.run \}\}$/m.test(JOBS.scope));
ok('the checkout reaches the first parent', /actions\/checkout@\S+\n {8}with:\n {10}fetch-depth: 2\n/.test(STEPS[0]));
ok('the decision comes straight after the checkout, and is the last step', STEPS.length === 2 && STEPS[1].includes('id: scope'));
ok('the devices run only on the decision\'s yes', /^ {4}needs: scope$/m.test(JOBS.devices) && /^ {4}if: needs\.scope\.outputs\.run == 'true'$/m.test(JOBS.devices));
ok('nothing can pass on its own failure', !WORKFLOW.includes('continue-on-error'));
// The two steps that report on a failed run have to run after one; nothing else may be skipped.
const reporting = DEVICE_STEPS.filter((st) => /^ {8}if:/m.test(st));
ok('every device step runs, apart from the two that report', reporting.length === 2 && reporting.every((st) => st.includes('if: ${{ !cancelled() }}') && /e2e-summary\.mjs|upload-artifact/.test(st)));

// ── The devices ──────────────────────────────────────────────────────────────
const CONFIG = Deno.readTextFileSync(new URL('playwright.config.ts', ROOT));
const projects = [...CONFIG.matchAll(/\{ name: '([\w-]+)'/g)].map((m) => m[1]);
const matrix = JOBS.devices?.match(/^ {8}project: \[([^\]]*)\]$/m)?.[1].split(',').map((x) => x.trim()) || [];
ok('each device in playwright.config.ts gets a machine, and only those', projects.length === 3 && matrix.join() === projects.join(), matrix.join());
ok('one device failing doesn\'t cancel the others', /^ {6}fail-fast: false$/m.test(JOBS.devices));
const lock = JSON.parse(Deno.readTextFileSync(new URL('package-lock.json', ROOT)));
const pw = lock.packages?.['node_modules/@playwright/test']?.version;
const image = JOBS.devices?.match(/^ {6}image: (\S+)$/m)?.[1] || '';
ok('the devices run in Playwright\'s own image, at the version package-lock.json installs', !!pw && image === `mcr.microsoft.com/playwright:v${pw}-noble`, `${image} for ${pw}`);
ok('Playwright\'s two packages are on the same version', lock.packages?.['node_modules/playwright-core']?.version === pw);

// The device step's real script, with a stand-in npx that prints what it was asked to run.
const RUN_DEVICE = script('name: Run the browser suite on this device\\n {8}env:\\n[\\s\\S]*?EVENT: .*');
const bin = await Deno.makeTempDir({ prefix: 'e2e-device-bin-' });
await Deno.writeTextFile(`${bin}/npx`, '#!/bin/sh\necho "$@"\n');
await Deno.chmod(`${bin}/npx`, 0o755);
await Deno.writeTextFile(`${bin}/step.sh`, RUN_DEVICE || 'exit 9');
async function device(PROJECT, EVENT) {
  const { code, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${bin}/step.sh`], stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${bin}:${Deno.env.get('PATH')}`, PROJECT, EVENT },
  }).output();
  return { code, ran: new TextDecoder().decode(stdout).trim() };
}
const tabletPr = await device('tablet', 'pull_request');
ok('on a pull request the tablet runs the touch and layout tests', tabletPr.code === 0 && tabletPr.ran === 'playwright test --project=tablet --grep @touch|@layout', tabletPr.ran);
for (const [p, e] of [['tablet', 'push'], ['tablet', 'workflow_dispatch'], ['desktop-chromium', 'pull_request'], ['mobile', 'pull_request'], ['mobile', 'push']]) {
  const r = await device(p, e);
  ok(`${p} on ${e} runs everything`, r.code === 0 && r.ran === `playwright test --project=${p}`, r.ran);
}
// A tag nobody carries would leave the tablet with nothing to run, and an empty run passes.
const specs = [...Deno.readDirSync(new URL('tests/e2e/', ROOT))].filter((e) => e.name.endsWith('.spec.ts'))
  .map((e) => Deno.readTextFileSync(new URL(`tests/e2e/${e.name}`, ROOT))).join('\n');
for (const tag of ['@touch', '@layout']) ok(`tests carry ${tag}`, specs.split(`{ tag: '${tag}' }`).length - 1 >= 3);

// ── The verdict: browser passes only on every device passing, or nothing to test ─
const VERDICT = script('id: verdict');
await Deno.writeTextFile(`${bin}/verdict.sh`, VERDICT || 'exit 9');
async function verdict(SCOPE, RUN, DEVICES) {
  const { code, stdout } = await new Deno.Command('bash', {
    args: ['-e', `${bin}/verdict.sh`], stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: Deno.env.get('PATH'), SCOPE, RUN, DEVICES },
  }).output();
  return { code, log: new TextDecoder().decode(stdout) };
}
const allPassed = await verdict('success', 'true', 'success');
ok('every device passed: browser passes', allPassed.code === 0);
const skippedSuite = await verdict('success', 'false', 'skipped');
ok('nothing to test: browser passes, and says it was a skip', skippedSuite.code === 0 && skippedSuite.log.includes('skipped, not passed'));
for (const [s, r, d, why] of [
  ['success', 'true', 'failure', 'a device failed'],
  ['success', 'true', 'cancelled', 'a device was cancelled'],
  ['success', 'true', 'skipped', 'the devices were skipped though the decision said run'],
  ['failure', '', 'skipped', 'the decision failed'],
  ['cancelled', '', 'skipped', 'the decision was cancelled'],
  ['success', '', 'skipped', 'the decision gave no answer'],
]) {
  const v = await verdict(s, r, d);
  ok(`${why}: browser fails`, v.code === 1 && v.log.includes('::error title=Browser check::'));
}

// ── The summary names each flaky and failed test ─────────────────────────────
const fixture = {
  stats: { expected: 1203, flaky: 1, unexpected: 1, skipped: 30 },
  suites: [{ title: 'site-home.spec.ts', file: 'site-home.spec.ts', specs: [], suites: [{ title: 'Pages', file: 'site-home.spec.ts', specs: [
    { title: 'Add a link', file: 'site-home.spec.ts', line: 721, tests: [{ status: 'flaky' }] },
    { title: 'Remove a page', file: 'site-home.spec.ts', line: 760, tests: [{ status: 'unexpected' }] },
    { title: 'Rename a page', file: 'site-home.spec.ts', line: 790, tests: [{ status: 'expected' }] },
  ] }] }],
};
await Deno.writeTextFile(`${bin}/results.json`, JSON.stringify(fixture));
async function summary(file) {
  const { code, stdout } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-read', new URL('scripts/e2e-summary.mjs', ROOT).pathname, file, 'tablet'], stdout: 'piped', stderr: 'piped',
  }).output();
  return { code, text: new TextDecoder().decode(stdout) };
}
const sum = await summary(`${bin}/results.json`);
ok('the summary counts the run', sum.code === 0 && sum.text.includes('1,203 passed, 1 flaky, 1 failed, 30 skipped.'), sum.text.split('\n')[2]);
ok('the summary names the flaky test with its place', sum.text.includes('- `site-home.spec.ts:721` Pages › Add a link'));
ok('the summary names the failed test', /\*\*Failed:\*\*\n\n- `site-home\.spec\.ts:760` Pages › Remove a page/.test(sum.text));
ok('a passing test is not named', !sum.text.includes('Rename a page'));
const none = await summary(`${bin}/missing.json`);
ok('no results file: the summary says the run stopped, and the step still exits 0', none.code === 0 && none.text.includes('No results'));
await Deno.remove(bin, { recursive: true });

// ── Pull requests: nothing the suite can reach may skip it ───────────────────
const MUST_RUN = [
  // Specs read these from disk, or serve them to a page
  'index.html', 'about.css', 'site-review.js', 'shell.js', 'shell.css', 'sw.js',
  '_redirects', '_headers', 'sitemap.xml', 'tools-sitemap.xml', 'robots.txt', 'tools-robots.txt',
  'security.txt', 'manifest.json', 'manifest-app.json', 'eric-davis-small.jpg', 'tools-logo.webp', 'favicon.png',
  'fonts/inter.woff2', 'life/eric-dog.jpg', 'case-studies/example.html', 'vendor/lib.js',
  // Specs run these
  'scripts/build-public.sh', 'scripts/sync-marketing-chrome.mjs', 'scripts/marketing-chrome.template.html',
  // A spec imports this one from under a skipped folder
  'supabase/functions/presence/lib/site_roles.ts',
  // The suite and its toolchain
  'tests/e2e/shell.spec.ts', 'tests/e2e/__screenshots__/a.png', 'playwright.config.ts', 'package.json', 'package-lock.json',
  '.github/workflows/e2e.yml',
  // How the repo is built or read
  'netlify.toml', '.gitattributes',
  // Would reach dist/ through an asset folder and trip build-public.sh
  'case-studies/notes.md', 'vendor/dump.sql',
  // Nobody has shown these can't matter
  'brand-new-folder/thing.txt', 'brand-new-file.xyz', '.github/workflows/new-workflow.yml', 'tests/new-suite/a.mjs',
];
for (const file of MUST_RUN) {
  const r = await pullRequest(edit(file));
  ok(`runs for ${file}`, r.code === 0 && r.run === 'run=true', r.run);
}

const MAY_SKIP = [
  'docs/plan.md', 'docs/mockup.html', 'docs/café notes.md', 'supabase/functions/presence/index.ts', 'supabase/functions/presence/lib/other.ts', 'supabase/email.html',
  'runbooks/deploy.md', 'sql/seed.sql', 'templates/PROPOSAL-TEMPLATE.md',
  'tests/presence/render_test.mjs', 'tests/isolation/a.mjs', 'tests/smoke/a.mjs', 'tests/workflows/e2e_scope_test.mjs',
  '.github/workflows/ci.yml', '.github/workflows/deploy.yml', '.github/workflows/rollback.yml', '.github/workflows/schema-dump.yml',
  'README.md', 'MASTER-CHECKLIST.md', '01-add-scheduler-columns.sql',
];
for (const file of MAY_SKIP) {
  const r = await pullRequest(edit(file));
  ok(`skips for ${file}`, r.code === 0 && r.run === 'run=false', r.run);
}

// ── What the specs depend on can't be skipped, wherever it lives ─────────────
// A spec can import a file or read one by path, which puts that file in the suite's
// reach even under a skipped folder. A failure here means: give the file its own
// `run=true` line above `supabase/*` in the step's `case`.
const isFile = (u) => { try { return Deno.statSync(u).isFile; } catch { return false; } };
const inRepo = (u) => u.href.slice(ROOT.href.length);
const tsFiles = (dir) => [...Deno.readDirSync(dir)].flatMap((e) =>
  e.isDirectory ? tsFiles(new URL(`${e.name}/`, dir)) : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []);

const reached = new Set();
const queue = tsFiles(new URL('tests/e2e/', ROOT));
while (queue.length) {
  const file = queue.pop();
  const src = Deno.readTextFileSync(file);
  const imports = [...src.matchAll(/(?:from|import\()\s*['"`](\.\.?\/[^'"`]+)['"`]/g)]
    .map(([, s]) => [s, `${s}.ts`].map((p) => new URL(p, file)).find(isFile));
  const named = [...src.matchAll(/['"`]\/?([\w.-]+(?:\/[\w.-]+)+|[\w.-]+\.(?:md|sql))['"`]/g)]
    .map(([, s]) => new URL(s, ROOT)).filter(isFile);
  for (const u of [...imports, ...named]) {
    if (!u || !u.href.startsWith(ROOT.href) || reached.has(inRepo(u)) || inRepo(u).startsWith('tests/e2e/')) continue;
    reached.add(inRepo(u));
    if (/\.m?[jt]s$/.test(u.href)) queue.push(u);
  }
}
ok('the guard finds what a spec imports from the server', reached.has('supabase/functions/presence/lib/site_roles.ts'), `${reached.size} files`);
for (const file of [...reached].sort()) {
  const r = await pullRequest(edit(file));
  ok(`runs for ${file}, which the specs reach`, r.code === 0 && r.run === 'run=true', r.run);
}

// ── Pull requests: the shape of the change ───────────────────────────────────
const mixed = await pullRequest(edit('docs/plan.md', 'supabase/x.ts', '_redirects'));
ok('one reachable file among many unrelated ones runs it', mixed.run === 'run=true');
const allOut = await pullRequest(edit('docs/plan.md', 'supabase/x.ts', 'README.md'));
ok('several unrelated files together skip it', allOut.run === 'run=false');
const removed = await pullRequest(() => Deno.remove(`${origin}/_redirects`));
ok('deleting a file the suite reads runs it', removed.run === 'run=true');
const movedOut = await pullRequest(() => git('mv', 'index.html', 'docs/index.html'));
ok('moving a page into docs/ runs it, because it left the site', movedOut.run === 'run=true');
const movedIn = await pullRequest(async () => { await Deno.mkdir(`${origin}/life`, { recursive: true }); await git('mv', 'docs/plan.md', 'life/plan.md'); });
ok('moving a doc into an asset folder runs it', movedIn.run === 'run=true');
const empty = await pullRequest(async () => {});
ok('an empty change runs it, since nothing proves it safe', empty.code === 0 && empty.run === 'run=true');
ok('the summary names the changed files', allOut.summary.includes('docs/plan.md') && allOut.summary.includes('did not run'));
ok('the summary says when the suite runs', mixed.summary.includes('is running'));
ok('the log says what was compared, so a failed comparison can be told from a real run', allOut.log.includes('Compared with HEAD^1: 3 changed files') && empty.log.includes(': 0 changed files'));
ok('the log carries no file names, which could be read as workflow commands', !allOut.log.includes('docs/plan.md'));

// ── Pushes: compare with what the branch was before the push ─────────────────
await branch('push-docs', edit('docs/plan.md'));
const pushDocs = await decide('push-docs', { EVENT: 'push', BEFORE: BASE });
ok('a docs push skips it', pushDocs.code === 0 && pushDocs.run === 'run=false');

await branch('push-many', edit('_redirects'));
await write('docs/plan.md', 'later\n');
await git('add', '-A');
await git('commit', '--quiet', '-m', 'a docs commit on top');
const pushMany = await decide('push-many', { EVENT: 'push', BEFORE: BASE });
ok('a push of several commits counts them all, not just the last', pushMany.code === 0 && pushMany.run === 'run=true');

const zeros = await decide('push-docs', { EVENT: 'push', BEFORE: '0'.repeat(40) });
ok('a new branch runs it', zeros.code === 0 && zeros.run === 'run=true');
const gone = await decide('push-docs', { EVENT: 'push', BEFORE: 'f'.repeat(40) });
ok('a force push whose old commit is gone runs it', gone.code === 0 && gone.run === 'run=true');
const missing = await decide('push-docs', { EVENT: 'push', BEFORE: '' });
ok('a push with no old commit runs it', missing.code === 0 && missing.run === 'run=true');

// ── Manual runs: someone asked ───────────────────────────────────────────────
const manual = await decide('push-docs', { EVENT: 'workflow_dispatch', BEFORE: '' });
ok('a manual run always runs it', manual.code === 0 && manual.run === 'run=true' && manual.log.includes('Compared with nothing'));

await Deno.remove(dir, { recursive: true });
const passed = results.filter((x) => x.p).length;
console.log(`\n════ E2E SCOPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
