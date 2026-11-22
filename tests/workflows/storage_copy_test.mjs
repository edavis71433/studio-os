// ── storage-copy.yml: a weekly encrypted copy of every uploaded file (builder item 415) ──
//   deno run --allow-read --allow-write --allow-run --allow-env tests/workflows/storage_copy_test.mjs
// Runs the real scripts/storage-copy.sh with a stand-in curl playing Supabase's two APIs
// (the project's keys and a database read through the Management API; the files through
// Storage), and real openssl, tar and jq. No network, no secrets. The repository is public,
// so what matters most is pinned: nothing is read without a long passphrase, the upload is
// ciphertext that opens to every file, a file that can't be fetched stops the upload, and
// the log never carries a file's name or the service key.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SCRIPT = decodeURIComponent(new URL('scripts/storage-copy.sh', ROOT).pathname);
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };
const text = new TextDecoder();

// ── The workflow's shape ─────────────────────────────────────────────────────
const WF = read('.github/workflows/storage-copy.yml');
ok('runs every week, and by hand', /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* 0"/m.test(WF) && /^ {2}workflow_dispatch:$/m.test(WF));
ok('reads production with the deploy token and the passphrase, nothing more', WF.includes('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}') && WF.includes('BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}') && [...WF.matchAll(/secrets\.(\w+)/g)].every((m) => ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF_PROD', 'BACKUP_PASSPHRASE'].includes(m[1])));
ok('may read the repository and nothing else', /^permissions:\n {2}contents: read\n(?! {2})/m.test(WF));
ok('uploads only the encrypted file the script names, and a missing one fails', WF.includes('path: ${{ runner.temp }}/${{ steps.copy.outputs.file }}') && WF.includes('if-no-files-found: error'));
ok('keeps each copy 35 days: five weekly copies at any time', /retention-days: 35$/m.test(WF));
ok('nothing can pass on its own failure', !WF.includes('continue-on-error'));

// ── A stand-in Supabase ──────────────────────────────────────────────────────
const dir = await Deno.makeTempDir({ prefix: 'storage-copy-test-' });
const bin = `${dir}/bin`;
await Deno.mkdir(bin);
// The project's files, by bucket and name (names with spaces and folders, as uploads have).
const FILES = {
  'presence-media/site-1/hero photo.jpg': 'jpeg bytes 1',
  'presence-media/site-1/menus/dinner menu.pdf': 'pdf bytes 2',
  'presence-media/site-2/logo.png': 'png bytes 3',
  'client-files/c1/contract.pdf': 'pdf bytes 4',
};
const SERVICE_KEY = 'eyJservice.role.key.for.the.test';
await Deno.writeTextFile(`${dir}/files.json`, JSON.stringify(FILES));
// The stand-in curl: answers by address; `missing` names files that answer 404, `keys` and
// `list` set those answers' status. Every call's address is logged (to check the key isn't).
await Deno.writeTextFile(`${bin}/curl`, `#!/bin/bash
args="$*"; out=""; fmt=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; -w) fmt="$2"; shift ;; http*) url="$1" ;; esac; shift; done
echo "$url" >> "${dir}/calls"
cat > /dev/null 2>&1 < /dev/null
code=200; body=""
case "$url" in
  */api-keys*) code=$(cat "${dir}/keys_status"); body='[{"name":"anon","api_key":"anon-key"},{"name":"service_role","api_key":"${SERVICE_KEY}"}]' ;;
  */database/query) code=$(cat "${dir}/list_status"); body=$(cat "${dir}/list.json") ;;
  */storage/v1/object/authenticated/*)
    path=\${url#*/storage/v1/object/authenticated/}
    name=$(printf '%s' "$path" | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read()))')
    if grep -qxF "$name" "${dir}/missing" 2>/dev/null; then code=404; body='{"error":"not found"}'
    else body=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]], end="")' "${dir}/files.json" "$name"); fi
    case "$args" in *"Bearer ${SERVICE_KEY}"*) ;; *) code=401 ;; esac ;;
esac
[ -n "$out" ] && printf '%s' "$body" > "$out" || printf '%s' "$body"
[ -n "$fmt" ] && printf '%s' "$code"
case "$args" in *--fail*) [ "$code" -ge 400 ] && exit 22 ;; esac
exit 0
`);
await Deno.chmod(`${bin}/curl`, 0o755);
// GitHub's runners have sha256sum; a Mac has shasum.
const hasSha = (await new Deno.Command('bash', { args: ['-c', 'command -v sha256sum'] }).output()).code === 0;
if (!hasSha) { await Deno.writeTextFile(`${bin}/sha256sum`, '#!/bin/bash\nexec shasum -a 256 "$@"\n'); await Deno.chmod(`${bin}/sha256sum`, 0o755); }

const list = (files) => JSON.stringify(Object.entries(files).map(([path, body]) => ({ b: path.split('/')[0], n: path.split('/').slice(1).join('/'), s: body.length })));
async function run({ files = FILES, missing = [], keys = 200, listStatus = 201, pass = 'a-long-passphrase-for-the-test-0123456789' } = {}) {
  const out = await Deno.makeTempDir({ dir });
  await Deno.writeTextFile(`${dir}/list.json`, list(files));
  await Deno.writeTextFile(`${dir}/missing`, missing.join('\n') + '\n');
  await Deno.writeTextFile(`${dir}/keys_status`, String(keys));
  await Deno.writeTextFile(`${dir}/list_status`, String(listStatus));
  await Deno.remove(`${dir}/calls`).catch(() => {});
  const summary = `${dir}/summary.md`, output = `${dir}/output`;
  await Deno.writeTextFile(summary, ''); await Deno.writeTextFile(output, '');
  const { code, stdout, stderr } = await new Deno.Command('bash', {
    args: [SCRIPT], cwd: out, stdout: 'piped', stderr: 'piped', clearEnv: true,
    env: { PATH: `${bin}:${Deno.env.get('PATH')}`, HOME: dir, TMPDIR: dir, OUT_DIR: out, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output,
      SUPABASE_ACCESS_TOKEN: 'sbp_fake_token', PROJECT_REF: 'prodref', BACKUP_PASSPHRASE: pass },
  }).output();
  const made = [...Deno.readDirSync(out)].map((e) => e.name);
  return { code, out, made, log: text.decode(stdout) + text.decode(stderr), summary: await Deno.readTextFile(summary), output: await Deno.readTextFile(output),
    calls: (await Deno.readTextFile(`${dir}/calls`).catch(() => '')).trim().split('\n').filter(Boolean) };
}
async function open(file, pass) {
  const into = await Deno.makeTempDir({ dir });
  const r = await new Deno.Command('bash', { args: ['-c', `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:P -in "$1" | tar -xzf - -C "$2"`, '_', file, into], env: { P: pass }, stdout: 'null', stderr: 'null' }).output();
  return { code: r.code, into };
}

// ── A copy ───────────────────────────────────────────────────────────────────
let r = await run();
const file = r.made.find((f) => /^uploaded-files-\d{4}-\d{2}-\d{2}\.tar\.gz\.enc$/.test(f));
ok('a copy: one encrypted archive, named for the day, and nothing else left behind', r.code === 0 && !!file && r.made.length === 1, `${r.code} ${r.made.join(',')}`);
ok('…its name handed to the upload step', r.output.trim() === `file=${file}`);
ok('…the log and the summary give counts and sizes', r.log.includes('Copied 4 files from 2 bucket(s)') && r.summary.includes('Copied 4 files from 2 bucket(s)') && r.summary.includes('Kept 35 days'));
const cipher = await Deno.readFile(`${r.out}/${file}`);
ok('…the upload is ciphertext', text.decode(cipher.slice(0, 8)) === 'Salted__' && !text.decode(cipher).includes('jpeg bytes'));
const opened = await open(`${r.out}/${file}`, 'a-long-passphrase-for-the-test-0123456789');
ok('…which the run sheet\'s command opens with the passphrase', opened.code === 0);
const back = Object.fromEntries(Object.keys(FILES).map((p) => [p, (() => { try { return Deno.readTextFileSync(`${opened.into}/files/${p}`); } catch { return null; } })()]));
ok('…to every file, whole, in its bucket and folder', Object.entries(FILES).every(([p, body]) => back[p] === body), JSON.stringify(back));
const manifest = Deno.readTextFileSync(`${opened.into}/manifest.tsv`).trim().split('\n');
ok('…with a list of every file, its size and its fingerprint, for a restore to check against', manifest[0] === 'bucket\tbytes\tsha256\tname' && manifest.length === 5 && manifest.every((l, i) => i === 0 || /^[\w-]+\t\d+\t[0-9a-f]{64}\t.+$/.test(l)));
ok('a wrong passphrase doesn\'t open it', (await open(`${r.out}/${file}`, 'not-the-passphrase-at-all-0123456789')).code !== 0);
// GitHub hides an ::add-mask:: line itself and every later appearance of its value.
const unmasked = r.log.replace(/^::add-mask::.*$/gm, '');
ok('the log names no file and never the service key', !Object.keys(FILES).some((p) => unmasked.includes(p.split('/').pop())) && !unmasked.includes(SERVICE_KEY) && r.log.includes('::add-mask::'));
ok('the key is masked before anything else can print it', r.log.indexOf('::add-mask::') < r.log.indexOf('Files listed'));
ok('the files are read with the service key, from production\'s own address', r.calls.filter((c) => c.includes('/storage/v1/object/authenticated/')).length === 4 && r.calls.every((c) => !c.includes('/storage/') || c.startsWith('https://prodref.supabase.co/')));
ok('…and each folder name is escaped for the address', r.calls.some((c) => c.endsWith('/site-1/hero%20photo.jpg')));

// ── It refuses, and stops, when it should ────────────────────────────────────
r = await run({ pass: 'short' });
ok('a passphrase under 32 characters: refuses before reading anything', r.code === 1 && r.calls.length === 0 && r.log.includes('BACKUP_PASSPHRASE is missing or under 32 characters'));
r = await run({ pass: '' });
ok('no passphrase: the same', r.code === 1 && r.calls.length === 0);
r = await run({ missing: ['presence-media/site-2/logo.png'] });
ok('a file that can\'t be fetched: no archive, and it says how many, by number, not by name', r.code === 1 && !r.made.length && r.log.includes('1 of 4 files couldn\'t be fetched') && !r.log.includes('logo.png'), r.log.slice(-300));
r = await run({ keys: 401 });
ok('the keys can\'t be read: nothing is read', r.code === 1 && r.log.includes('didn\'t give the project\'s keys (HTTP 401)') && !r.calls.some((c) => c.includes('/storage/')));
r = await run({ listStatus: 400 });
ok('the list of files can\'t be read: nothing is copied', r.code === 1 && r.log.includes('The list of files couldn\'t be read (HTTP 400)'));
r = await run({ files: { 'presence-media/../../etc/passwd': 'x' } });
ok('a name that climbs out of its folder stops the copy', r.code === 1 && r.log.includes('climb out of their folder'));
r = await run({ files: {} });
ok('no files at all still makes a (small) copy and says so', r.code === 0 && r.log.includes('Copied 0 files'));

await Deno.remove(dir, { recursive: true });
const passed = results.filter((x) => x.p).length;
console.log(`\n════ STORAGE COPY (415): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
