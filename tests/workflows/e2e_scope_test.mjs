// ── e2e.yml: can `browser` be a required check, and does it skip only safely? ─
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/e2e_scope_test.mjs
// Runs the workflow's real decision step (bash -e, only that step's env) inside
// real shallow clones, checked out the way GitHub checks them out. No network.
// A wrong skip reads as a green check with nothing tested, so every case that
// must run the suite is pinned here. It lives outside the browser suite because
// a broken gate must not be what decides whether its own test runs.

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = Deno.readTextFileSync(new URL('.github/workflows/e2e.yml', ROOT));

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

const SCOPE = WORKFLOW.match(/id: scope\n[\s\S]*?run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
const STEPS = WORKFLOW.slice(WORKFLOW.indexOf('    steps:')).split(/^ {6}- /m).slice(1);

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
ok('the job is called browser, the name the required check will use', /^jobs:\n {2}browser:\n/m.test(WORKFLOW) && !/^ {4}name:/m.test(WORKFLOW));
ok('the job has no if: of its own, which could skip it before it reports', !/^ {4}if:/m.test(WORKFLOW));
ok('the checkout reaches the first parent', /actions\/checkout@\S+\n {8}with:\n {10}fetch-depth: 2\n/.test(STEPS[0]));
ok('the decision comes straight after the checkout', STEPS[1].includes('id: scope'));
const gated = STEPS.slice(2);
ok('every later step waits on the decision', gated.length === 5 && gated.every((s) => s.includes("steps.scope.outputs.run == 'true'")));
ok('the decision step cannot be set to pass on its own failure', !STEPS[1].includes('continue-on-error'));

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
