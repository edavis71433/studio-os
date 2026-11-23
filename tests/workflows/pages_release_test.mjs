// ── Builder item 400: the pages build only when they change, and go live with the release ──
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/pages_release_test.mjs
// Runs the real scripts in real git repositories with stand-ins for Netlify, so no network:
//   · scripts/netlify-ignore.sh, netlify.toml's ignore rule, with the environment Netlify
//     gives it. A wrong skip keeps old pages live after a change to them, so every case
//     that must build is pinned, and the skip list is held to what build-public.sh copies;
//   · scripts/publish-pages.sh, the release's upload of its own pages, behind the one-word
//     switch scripts/pages-go-live.txt;
//   · scripts/pages-live.sh, the release's check that the live pages are its own.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SCRIPT = decodeURIComponent(new URL('scripts/netlify-ignore.sh', ROOT).pathname);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };
const text = new TextDecoder();
async function sh(cwd, cmd, ...args) {
  const { code, stdout, stderr } = await new Deno.Command(cmd, { args, cwd, stdout: 'piped', stderr: 'piped' }).output();
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${text.decode(stderr)}`);
  return text.decode(stdout).trim();
}

// ── The wiring ──────────────────────────────────────────────────────────────
const TOML = read('netlify.toml');
ok('netlify.toml runs the rule before every build', /^\[build\][\s\S]*?^ {2}ignore = "bash scripts\/netlify-ignore\.sh"$/m.test(TOML));
ok('…and still publishes the allowlisted dist/ that build-public.sh makes', /^ {2}command = "bash scripts\/build-public\.sh"$/m.test(TOML) && /^ {2}publish = "dist"$/m.test(TOML));

// ── The rule, in a real repository ──────────────────────────────────────────
const dir = await Deno.makeTempDir({ prefix: 'netlify-ignore-test-' });
const rule0 = Deno.readTextFileSync(SCRIPT);
// Eric's steps were done on Nov 23 2026 (NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID set), and the
// switch moved to "release". It can go back to "merge" with one word if a release can't publish.
ok('the switch holds one of its two words', ['merge', 'release'].includes(read('scripts/pages-go-live.txt').trim()), read('scripts/pages-go-live.txt').trim());
const git = (...args) => sh(dir, 'git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args);
async function write(path, body) {
  await Deno.mkdir(`${dir}/${path}`.replace(/\/[^/]*$/, ''), { recursive: true });
  await Deno.writeTextFile(`${dir}/${path}`, body);
}
const TREE = ['index.html', 'docs/plan.md', 'README.md', 'supabase/functions/presence/index.ts', 'life/photo.jpg'];
await git('init', '--quiet', '-b', 'main');
for (const f of TREE) await write(f, 'first\n');
await git('add', '.');
await git('commit', '--quiet', '-m', 'base');
const BASE = await git('rev-parse', 'HEAD');

// The rule reads the switch beside itself, so these run a copy of it next to the word
// "merge", whatever the repository's own switch says today; "release" has its own checks below.
const RULE_DIR = await Deno.makeTempDir({ prefix: 'netlify-ignore-rule-' });
await Deno.writeTextFile(`${RULE_DIR}/netlify-ignore.sh`, rule0);
await Deno.writeTextFile(`${RULE_DIR}/pages-go-live.txt`, 'merge\n');
async function decide(env) {
  const { code, stdout } = await new Deno.Command('bash', {
    args: [`${RULE_DIR}/netlify-ignore.sh`], cwd: dir, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: Deno.env.get('PATH'), HOME: dir, ...env },
  }).output();
  return { code, log: text.decode(stdout).trim() };
}
// A change on top of the base, then Netlify's question about it.
let n = 0;
async function change(edit, context = 'production') {
  await git('checkout', '--quiet', '-b', `c${++n}`, BASE);
  await edit();
  await git('add', '-A');
  await git('commit', '--quiet', '--allow-empty', '-m', `c${n}`);
  return decide({ CONTEXT: context, CACHED_COMMIT_REF: BASE, COMMIT_REF: await git('rev-parse', 'HEAD') });
}
const edit = (...paths) => async () => { for (const p of paths) await write(p, `changed ${n}\n`); };
const BUILD = 1, SKIP = 0;

const MUST_BUILD = [
  // what build-public.sh copies
  'index.html', 'about.css', 'shell.js', '_redirects', '_headers', 'robots.txt', 'sitemap.xml', 'manifest.json', 'whats-new.json',
  'favicon.png', 'eric.webp', 'life/photo.jpg', 'case-studies/a.html', 'vendor/lib.js', 'fonts/inter.woff2', 'thumbs/a.webp',
  // what builds it
  'scripts/build-public.sh', 'scripts/pack-public.mjs', 'scripts/marketing-chrome.template.html', 'netlify.toml', 'package.json', 'package-lock.json', '.gitattributes',
  // an .md inside an asset folder reaches dist/ (and trips build-public.sh's own refusal)
  'case-studies/notes.md',
  // nobody has shown these can't matter
  'brand-new-folder/a.txt', 'brand-new.xyz', 'deno.json',
];
for (const f of MUST_BUILD) {
  const r = await change(edit(f));
  ok(`builds for ${f}`, r.code === BUILD, r.log);
}
const MAY_SKIP = [
  'docs/plan.md', 'supabase/functions/presence/index.ts', 'supabase/migrations/0999_x.sql', 'tests/e2e/a.spec.ts', 'tests/presence/a_test.mjs',
  'runbooks/a.md', 'sql/a.sql', 'templates/PROPOSAL.md', '.github/workflows/ci.yml', 'README.md', 'NOTES.md', 'seed.sql', 'playwright.config.ts', '.gitignore',
];
for (const f of MAY_SKIP) {
  const r = await change(edit(f));
  ok(`skips for ${f}`, r.code === SKIP && r.log.includes('skipped'), r.log);
}
const mixed = await change(edit('docs/plan.md', 'supabase/x.ts', 'index.html'));
ok('one published file among unpublished ones builds', mixed.code === BUILD);
const many = await change(edit('docs/plan.md', 'supabase/x.ts', 'tests/a.mjs'));
ok('many unpublished files together skip, and say how many', many.code === SKIP && many.log.includes('3 changed files'), many.log);
const moved = await change(() => git('mv', 'index.html', 'docs/index.html'));
ok('a page moved into docs/ builds: it left the site', moved.code === BUILD);
const removed = await change(() => Deno.remove(`${dir}/life/photo.jpg`));
ok('a deleted photo builds', removed.code === BUILD);
const empty = await change(async () => {});
ok('a commit that changes nothing builds, since nothing proves it safe', empty.code === BUILD);

// ── Who may be skipped ──────────────────────────────────────────────────────
const docsOnly = edit('docs/plan.md');
const preview = await change(docsOnly, 'deploy-preview');
ok('a deploy preview always builds (they are free, and a first one has nothing to compare with)', preview.code === BUILD, preview.log);
const branch = await change(docsOnly, 'branch-deploy');
ok('a branch deploy can be skipped like production', branch.code === SKIP);
const none = await change(docsOnly, '');
ok('a build that names no context builds', none.code === BUILD);
// Once the release publishes the pages, Netlify's production build of a merge is never needed.
await git('checkout', '--quiet', '-b', 'mode', BASE);
await write('scripts/pages-go-live.txt', 'release\n'); await write('scripts/netlify-ignore.sh', rule0);
await git('add', '-A'); await git('commit', '--quiet', '-m', 'release mode');
const MODE_BASE = await git('rev-parse', 'HEAD');
await write('index.html', 'a page change\n'); await git('add', '-A'); await git('commit', '--quiet', '-m', 'page');
const inRelease = await new Deno.Command('bash', { args: [`${dir}/scripts/netlify-ignore.sh`], cwd: dir, stdout: 'piped', stderr: 'null', clearEnv: true,
  env: { PATH: Deno.env.get('PATH'), HOME: dir, CONTEXT: 'production', CACHED_COMMIT_REF: MODE_BASE, COMMIT_REF: await git('rev-parse', 'HEAD') } }).output();
ok('the switch says "release": a production build of a merge is skipped, even a page change', inRelease.code === SKIP && new TextDecoder().decode(inRelease.stdout).includes('go live with the release'));
const previewInRelease = await new Deno.Command('bash', { args: [`${dir}/scripts/netlify-ignore.sh`], cwd: dir, stdout: 'piped', stderr: 'null', clearEnv: true,
  env: { PATH: Deno.env.get('PATH'), HOME: dir, CONTEXT: 'deploy-preview', CACHED_COMMIT_REF: MODE_BASE, COMMIT_REF: await git('rev-parse', 'HEAD') } }).output();
ok('…and a deploy preview still builds', previewInRelease.code === BUILD);
// The release's own question (scripts/pages-live.sh): did a published file change between two
// commits, whoever publishes them? With "release" every Netlify build is skipped, so without
// PAGES_CHANGES_ONLY any older live commit would look like this commit's pages.
const askChanges = async (cached) => new Deno.Command('bash', { args: [`${dir}/scripts/netlify-ignore.sh`], cwd: dir, stdout: 'piped', stderr: 'null', clearEnv: true,
  env: { PATH: Deno.env.get('PATH'), HOME: dir, CONTEXT: 'production', PAGES_CHANGES_ONLY: '1', CACHED_COMMIT_REF: cached, COMMIT_REF: await git('rev-parse', 'HEAD') } }).output();
const pageChanged = await askChanges(MODE_BASE);
ok('asked only whether a published file changed, the rule answers that while the switch says "release": a page change counts', pageChanged.code === BUILD, new TextDecoder().decode(pageChanged.stdout).trim());
const pageHead = await git('rev-parse', 'HEAD');
await write('docs/plan.md', 'release-mode notes\n'); await git('add', '-A'); await git('commit', '--quiet', '-m', 'docs in release mode');
const docsChanged = await askChanges(pageHead);
ok('…and a change to docs alone counts as nothing published', docsChanged.code === SKIP, new TextDecoder().decode(docsChanged.stdout).trim());
ok('the release\'s wait asks the rule that way', /PAGES_CHANGES_ONLY=1 CONTEXT=production CACHED_COMMIT_REF="\$live" COMMIT_REF="\$SHA" bash "\$here\/netlify-ignore\.sh"/.test(read('scripts/pages-live.sh')));
const head = await git('rev-parse', 'HEAD');
const same = await decide({ CONTEXT: 'production', CACHED_COMMIT_REF: head, COMMIT_REF: head });
ok('the commit Netlify built last builds again (a retry, or a first build)', same.code === BUILD, same.log);
const noCache = await decide({ CONTEXT: 'production', CACHED_COMMIT_REF: '', COMMIT_REF: head });
ok('no record of the last build: builds', noCache.code === BUILD);
const gone = await decide({ CONTEXT: 'production', CACHED_COMMIT_REF: 'f'.repeat(40), COMMIT_REF: head });
ok('a last build this clone doesn\'t have: builds', gone.code === BUILD);
// Two commits apart, docs then a page: the rule compares with the last build, not the last commit.
await git('checkout', '--quiet', '-b', 'two', BASE);
await write('docs/plan.md', 'two\n'); await git('add', '-A'); await git('commit', '--quiet', '-m', 'docs');
await write('index.html', 'two\n'); await git('add', '-A'); await git('commit', '--quiet', '-m', 'page');
await write('docs/plan.md', 'three\n'); await git('add', '-A'); await git('commit', '--quiet', '-m', 'docs again');
const two = await decide({ CONTEXT: 'production', CACHED_COMMIT_REF: BASE, COMMIT_REF: await git('rev-parse', 'HEAD') });
ok('a page changed two commits back still builds', two.code === BUILD);
await Deno.remove(dir, { recursive: true });
await Deno.remove(RULE_DIR, { recursive: true });

// ── The skip list against what build-public.sh copies ───────────────────────
// build-public.sh copies files at the top of the repository and five asset folders, and
// nothing else; the packing step then works on that copy. Every copy it makes must come
// from a place the rule builds for, or a change to that file could be skipped. (The build
// itself needs the npm packages, which this check's machine doesn't install; the browser
// suite runs the real build, tests/e2e/marketing.spec.ts and packed-site.spec.ts.)
const SKIPPED_FOLDERS = ['docs', 'supabase', 'runbooks', 'sql', 'templates', 'tests', '.github'];
const rule = Deno.readTextFileSync(SCRIPT);
ok('the rule skips exactly these folders', /^ {4}docs\/\*\|supabase\/\*\|runbooks\/\*\|sql\/\*\|templates\/\*\|tests\/\*\|\.github\/\*\) ;;$/m.test(rule));
const build = read('scripts/build-public.sh').replace(/^\s*#.*$/gm, '');
const copies = [...build.matchAll(/\bcp (?:-r )?(.+?) "\$OUT"\//g)].map((m) => m[1].trim());
const folders = [...build.matchAll(/^for d in ([\w -]+); do$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
const named = [...build.matchAll(/^for f in ([\w .-]+); do\n\s*\[ -f "\$f" \] && cp "\$f"/gm)].flatMap((m) => m[1].trim().split(/\s+/));
ok('build-public.sh copies five asset folders, none of them skipped', folders.length === 5 && folders.every((d) => !SKIPPED_FOLDERS.includes(d)), folders.join(', '));
ok('…named platform files, all at the top', named.length >= 8 && named.every((f) => !f.includes('/')), named.join(' '));
const loose = copies.filter((c) => c !== '"$d"' && c !== '"$f"' && !c.split(/\s+/).every((g) => /^\.\/\*\.[a-z0-9]+$/.test(g)));
ok('…and otherwise only files at the top (./*.ext), so nothing from a skipped folder', copies.length >= 5 && !loose.length, loose.join(' | '));
ok('no .md or .sql reaches the site: the build refuses one (the rule skips them at the top)', /find "\$OUT" -name "\*\.ts" -o -name "\*\.sql" -o -name "\*\.md"/.test(build));
ok('the build says which commit it is, for the release to read', /printf '\{"commit":"%s"\}\\n' "\$commit" > "\$OUT\/version\.json"/.test(build) && /commit="\$\{COMMIT_REF:-/.test(build));
const HEADERS = read('_headers');
ok('…and nothing keeps that file', /^\/version\.json\n {2}Cache-Control: no-store$/m.test(HEADERS));

// ── Are the live pages this commit's? (scripts/pages-live.sh) ────────────────
// The real script, in a real repository, with a stand-in curl that answers the way the
// live site's /version.json does. No network.
const PAGES = decodeURIComponent(new URL('scripts/pages-live.sh', ROOT).pathname);
const pdir = await Deno.makeTempDir({ prefix: 'pages-live-test-' });
const pgit = (...args) => sh(pdir, 'git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args);
await pgit('init', '--quiet', '-b', 'main');
async function commit(path, body) {
  await Deno.mkdir(`${pdir}/${path}`.replace(/\/[^/]*$/, ''), { recursive: true });
  await Deno.writeTextFile(`${pdir}/${path}`, body);
  await pgit('add', '-A'); await pgit('commit', '--quiet', '-m', path);
  return pgit('rev-parse', 'HEAD');
}
const P1 = await commit('index.html', 'one\n');          // the pages live now
const P2 = await commit('docs/notes.md', 'two\n');       // a release that changes no published file
const P3 = await commit('index.html', 'three\n');        // a release that changes a page
const P4 = await commit('about.html', 'four\n');         // a newer main
const bin = await Deno.makeTempDir({ prefix: 'pages-live-bin-' });
await Deno.writeTextFile(`${bin}/curl`, `#!/bin/bash
out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && { out="$2"; shift; }; shift; done
n=$(( $(cat "${bin}/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${bin}/n"
line=$(sed -n "\${n}p" "${bin}/answers"); [ -z "$line" ] && line=$(tail -n 1 "${bin}/answers")
code=\${line%% *}; body=\${line#* }
printf '%s' "$body" > "$out"
printf '%s' "$code"
`);
await Deno.chmod(`${bin}/curl`, 0o755);
async function pagesLive(sha, mode, answers) {
  await Deno.writeTextFile(`${bin}/answers`, answers.join('\n') + '\n');
  await Deno.remove(`${bin}/n`).catch(() => {});
  const { code, stdout } = await new Deno.Command('bash', {
    args: [PAGES, sha, mode], cwd: pdir, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${bin}:${Deno.env.get('PATH')}`, HOME: pdir, PAGES_POLL_SECONDS: '0', PAGES_WAIT_MINUTES: '0' },
  }).output();
  const asked = Number(await Deno.readTextFile(`${bin}/n`).catch(() => '0'));
  return { code, log: new TextDecoder().decode(stdout), asked };
}
const v = (sha) => `200 {"commit":"${sha}"}`;
let pl = await pagesLive(P3, 'release', [v(P3)]);
ok('the live pages name this commit: done at once', pl.code === 0 && pl.log.includes('are this commit\'s') && pl.asked === 1, pl.log.trim());
pl = await pagesLive(P2, 'release', [v(P1)]);
ok('the live pages are older, and nothing published changed since (Netlify skipped the build): done', pl.code === 0 && pl.log.includes('nothing published changed since'), pl.log.trim());
pl = await pagesLive(P3, 'release', [v(P1)]);
ok('the live pages are older and a page changed since: the release fails after its wait, saying what to look at', pl.code === 1 && pl.log.includes('::error title=Pages::The server is live at') && pl.log.includes('deploy list at Netlify'), pl.log.trim());
const waits = await new Deno.Command('bash', { args: ['-c', `cd "${pdir}" && PATH="${bin}:$PATH" PAGES_POLL_SECONDS=0 PAGES_WAIT_MINUTES=1 bash "${PAGES}" ${P3} release`], stdout: 'piped', stderr: 'null' });
await Deno.writeTextFile(`${bin}/answers`, [v(P1), v(P1), v(P3)].join('\n') + '\n');
await Deno.remove(`${bin}/n`).catch(() => {});
const waited = await waits.output();
ok('…unless they go live while it waits (here on the third look)', waited.code === 0 && Number(await Deno.readTextFile(`${bin}/n`)) === 3, new TextDecoder().decode(waited.stdout).trim());
pl = await pagesLive(P2, 'release', [v(P4)]);
ok('the live pages are newer than the release (Netlify still publishes main on every merge): done, and it says so', pl.code === 0 && pl.log.includes('newer than this release'), pl.log.trim());
pl = await pagesLive(P2, 'rollback', [v(P4)]);
ok('a rollback whose pages are still newer only warns, since until Netlify\'s setting changes they can\'t go back from here', pl.code === 0 && pl.log.includes('::warning title=Pages::The functions went back to'), pl.log.trim());
pl = await pagesLive(P3, 'release', ['404 Not Found']);
ok('no version file on the live site: the release fails and says the pages don\'t name their commit', pl.code === 1 && pl.log.includes('don\'t say their commit (HTTP 404)'), pl.log.trim());
pl = await pagesLive(P3, 'release', ['200 {"commit":"not-a-commit"}']);
ok('a version file that names no real commit counts as not saying', pl.code === 1);
pl = await pagesLive(P3, 'release', [`200 {"commit":"${'a'.repeat(40)}"}`]);
ok('a commit this clone doesn\'t have is never taken as a match', pl.code === 1);
await Deno.remove(pdir, { recursive: true });
await Deno.remove(bin, { recursive: true });

// ── The release's own upload (scripts/publish-pages.sh) ──────────────────────
// A stand-in curl plays Netlify's API; a stand-in build writes a dist/ the way
// build-public.sh does; zip and jq are real. Each case is a fresh copy of the scripts
// with the switch set as the case needs.
const PUBLISH = decodeURIComponent(new URL('scripts/publish-pages.sh', ROOT).pathname);
const pub = await Deno.makeTempDir({ prefix: 'publish-pages-test-' });
await Deno.writeTextFile(`${pub}/curl`, `#!/bin/bash
echo "$*" >> "${pub}/calls"
out=""; data=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; --data-binary) data="$2"; shift ;; esac; shift; done
[ -n "$data" ] && cp "\${data#@}" "${pub}/uploaded.zip"
n=$(( $(cat "${pub}/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${pub}/n"
line=$(sed -n "\${n}p" "${pub}/answers"); [ -z "$line" ] && line=$(tail -n 1 "${pub}/answers")
code=\${line%% *}; body=\${line#* }
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; printf '%s' "$code"; else printf '%s' "$body"; fi
`);
await Deno.chmod(`${pub}/curl`, 0o755);
const SHA = 'c'.repeat(40);
async function publish(mode, answers, env = {}) {
  const repo = await Deno.makeTempDir({ dir: pub });
  await Deno.mkdir(`${repo}/scripts`, { recursive: true });
  await Deno.mkdir(`${repo}/node_modules`, { recursive: true });
  await Deno.copyFile(PUBLISH, `${repo}/scripts/publish-pages.sh`);
  await Deno.writeTextFile(`${repo}/scripts/pages-go-live.txt`, `${mode}\n`);
  // the stand-in build: what build-public.sh leaves in BUILD_OUT
  await Deno.writeTextFile(`${repo}/fake-build.sh`, 'mkdir -p "$BUILD_OUT" && echo "<h1>hi</h1>" > "$BUILD_OUT/index.html" && printf \'{"commit":"%s"}\\n\' "$COMMIT_REF" > "$BUILD_OUT/version.json"\n');
  await Deno.writeTextFile(`${pub}/answers`, answers.join('\n') + '\n');
  for (const f of ['n', 'calls', 'uploaded.zip']) await Deno.remove(`${pub}/${f}`).catch(() => {});
  const { code, stdout } = await new Deno.Command('bash', {
    args: [`${repo}/scripts/publish-pages.sh`, SHA], cwd: repo, stdout: 'piped', stderr: 'null', clearEnv: true,
    env: { PATH: `${pub}:${Deno.env.get('PATH')}`, HOME: repo, TMPDIR: pub, PAGES_BUILD_CMD: `bash ${repo}/fake-build.sh`, PAGES_POLL_SECONDS: '0', PAGES_DEPLOY_WAIT_SECONDS: '5',
      NETLIFY_AUTH_TOKEN: 'nfp_fake', NETLIFY_SITE_ID: 'site-123', ...env },
  }).output();
  const calls = (await Deno.readTextFile(`${pub}/calls`).catch(() => '')).trim().split('\n').filter(Boolean);
  let zipped = [];
  try { zipped = new TextDecoder().decode((await new Deno.Command('unzip', { args: ['-Z1', `${pub}/uploaded.zip`], stdout: 'piped' }).output()).stdout).trim().split('\n'); } catch { /* none */ }
  return { code, log: new TextDecoder().decode(stdout), calls, zipped };
}
let pp = await publish('merge', ['200 {}']);
ok('switch says "merge": the release publishes nothing and asks Netlify nothing', pp.code === 0 && pp.calls.length === 0 && pp.log.includes('publishes nothing'), pp.log.trim());
pp = await publish('release', ['201 {"id":"dep1","state":"uploaded"}', '200 {"state":"processing"}', '200 {"state":"ready"}']);
ok('switch says "release": this commit\'s pages are built, uploaded as one deploy, and waited on until Netlify says ready', pp.code === 0 && pp.log.includes('uploaded 2 files') && pp.log.includes('deploy dep1 is live'), pp.log.trim());
ok('…the upload goes to the app\'s site with the token, as a zip of what the build made', pp.calls[0]?.includes('https://api.netlify.com/api/v1/sites/site-123/deploys') && pp.calls[0].includes('Authorization: Bearer nfp_fake') && pp.zipped.sort().join() === 'index.html,version.json', `${pp.calls[0]} | ${pp.zipped.join()}`);
ok('…and the state is read from that deploy', pp.calls.slice(1).every((c) => c.includes('/deploys/dep1')));
pp = await publish('release', ['201 {"id":"dep2"}', '200 {"state":"error"}']);
ok('a deploy Netlify ends in error fails the release, saying the server is live and the pages are the previous ones', pp.code === 1 && pp.log.includes('::error title=Pages::Netlify ended deploy dep2 as "error". The server is live; the pages are still the previous ones.'), pp.log.trim());
pp = await publish('release', ['422 {"message":"bad"}']);
ok('a refused upload fails, with Netlify\'s code', pp.code === 1 && pp.log.includes('Netlify refused the upload (HTTP 422)'));
pp = await publish('release', ['404 {"code":404,"message":"Not Found"}']);
ok('a token whose Netlify login can\'t see the site (Netlify answers 404): it says to make the token from the login that owns the site', pp.code === 1 && pp.log.includes('Netlify refused the upload (HTTP 404)') && pp.log.includes('login that owns the app\'s site'), pp.log.trim());
pp = await publish('release', ['200 {}'], { NETLIFY_AUTH_TOKEN: '' });
ok('switch says "release" but no token: fails before building, naming the secret', pp.code === 1 && pp.calls.length === 0 && pp.log.includes('NETLIFY_AUTH_TOKEN isn\'t set'));
pp = await publish('release', ['200 {}'], { NETLIFY_SITE_ID: '' });
ok('…or no site id: fails, naming the variable', pp.code === 1 && pp.log.includes('NETLIFY_SITE_ID isn\'t set'));
pp = await publish('release', ['200 {}'], { PAGES_BUILD_CMD: 'false' });
ok('a build that fails uploads nothing', pp.code === 1 && pp.calls.length === 0 && pp.log.includes('Building the pages of'));
pp = await publish('release', ['201 {"id":"dep3"}', '200 {"state":"processing"}'], { PAGES_DEPLOY_WAIT_SECONDS: '0' });
ok('a deploy that never finishes fails in the end', pp.code === 1 && pp.log.includes('hadn\'t finished deploy dep3'));
await Deno.remove(pub, { recursive: true });

// ── The release and the rollback wear it ─────────────────────────────────────
const DEPLOY = read('.github/workflows/deploy.yml'), ROLLBACK = read('.github/workflows/rollback.yml');
const order = (wf, names) => names.map((n) => wf.indexOf(n)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1]));
ok('the release publishes the pages after every function deploy and its smoke tests, then waits for them, then checks the free tools\' pages', order(DEPLOY, ['Deploy ai-visibility (PRODUCTION)', 'Smoke test — Free Tools functions answer and gate', 'Publish the pages with this release', 'Wait for the pages to go live', 'Smoke test — Free Tools pages on the static host']));
ok('…with the Netlify token and site id, and nothing else new', DEPLOY.includes('NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}') && DEPLOY.includes('NETLIFY_SITE_ID: ${{ vars.NETLIFY_SITE_ID }}') && DEPLOY.includes('run: bash scripts/pages-live.sh "$SHA" release'));
ok('the rollback puts the pages back after the functions, with main\'s scripts and the older commit\'s files', order(ROLLBACK, ['Smoke test — Free Tools functions answer and gate', 'path: main-tools', 'Put the pages back too']) && ROLLBACK.includes('bash main-tools/scripts/publish-pages.sh "$sha" "$PWD"') && ROLLBACK.includes('bash scripts/pages-live.sh "$sha" rollback'));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ PAGES (400): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
