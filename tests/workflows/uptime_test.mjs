// ── uptime.yml: the second alarm, from outside (builder item 417) ─────────────────────
//   deno run --allow-read --allow-write --allow-run --allow-env --allow-net tests/workflows/uptime_test.mjs
// Runs the real scripts/uptime-check.sh against a stand-in Studio OS on this machine (a
// local server playing the app's pages, the free tools and the server), so no network.
// The check's whole job is to fail loudly when something is down and stay quiet when it
// isn't, so both are pinned: every way down fails the run with its reason, a single slow
// answer doesn't, and the status read not being live yet is a note, not a failure.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };

// ── The workflow's shape ─────────────────────────────────────────────────────
const WF = read('.github/workflows/uptime.yml');
ok('runs every 15 minutes', /^ {2}schedule:\n {4}- cron: "\*\/15 \* \* \* \*"$/m.test(WF));
ok('…and by hand', /^ {2}workflow_dispatch:$/m.test(WF));
ok('reads no repository secret: nothing here needs more than a visitor has', !/secrets\./.test(WF));
ok('may read the repository and nothing else', /^permissions:\n {2}contents: read\n(?! {2})/m.test(WF));
ok('runs the check script, and nothing can pass on its own failure', /run: bash scripts\/uptime-check\.sh$/m.test(WF) && !WF.includes('continue-on-error'));
ok('a pull request runs it only when the check itself changes', /^ {2}pull_request:\n {4}paths:\n {6}- \.github\/workflows\/uptime\.yml\n {6}- scripts\/uptime-check\.sh$/m.test(WF));
ok('no job is called browser or test (GitHub matches required checks by name)', !/^ {2}(browser|test):$/m.test(WF));

// ── A stand-in Studio OS ─────────────────────────────────────────────────────
const healthy = () => ({
  pages: { status: 200, body: '<html><script src="/vendor/supabase-js-2.45.4.js"></script></html>' },
  tools: { status: 200, body: '<form id="srForm"></form>' },
  plans: { status: 200, body: '{"data":{"plans":[{"id":"presence"}]}}' },
  status: { status: 200, body: JSON.stringify({ data: { ok: true, server: true, database: true, schedule: true, failures: true, crashes: true, settings: true, checked_at: 'x' } }) },
  gate: { status: 403, body: '{"error":"forbidden"}' },
});
let site = healthy(), flaky = new Map(), asked = [];
const ac = new AbortController();
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen() {} }, (req) => {
  const path = new URL(req.url).pathname;
  const part = { '/app/today.html': 'pages', '/tools/site-review': 'tools', '/api/commerce/plans': 'plans', '/api/status': 'status', '/api/system/health': 'gate' }[path];
  asked.push(`${part || path} ${req.headers.get('x-region') || ''}`.trim());
  if (!part) return new Response('not found', { status: 404 });
  const left = flaky.get(part) || 0;
  if (left > 0) { flaky.set(part, left - 1); return new Response('busy', { status: 503 }); }
  return new Response(site[part].body, { status: site[part].status });
});
const base = `http://127.0.0.1:${server.addr.port}`;

const dir = await Deno.makeTempDir({ prefix: 'uptime-test-' });
// The check's clock, in seconds (UPTIME_NOW): pinned, so the "not live yet" window means the same on every day.
const BEFORE = Date.parse('2026-11-22T18:00:00Z') / 1000, AFTER = Date.parse('2026-12-06T00:00:00Z') / 1000;
let clock = BEFORE;
async function check() {
  const summary = `${dir}/summary.md`;
  await Deno.writeTextFile(summary, '');
  asked = [];
  const { code, stdout } = await new Deno.Command('bash', {
    args: [new URL('scripts/uptime-check.sh', ROOT).pathname.replace(/%20/g, ' ')], stdout: 'piped', stderr: 'piped', clearEnv: true,
    env: { PATH: Deno.env.get('PATH'), HOME: dir, TMPDIR: dir, GITHUB_STEP_SUMMARY: summary,
      UPTIME_APP_URL: `${base}/app`, UPTIME_TOOLS_URL: `${base}/tools`, UPTIME_API_URL: `${base}/api`, UPTIME_RETRY_SECONDS: '0', UPTIME_NOW: String(clock) },
  }).output();
  return { code, log: new TextDecoder().decode(stdout), summary: await Deno.readTextFile(summary), asked: [...asked] };
}
const down = (part, status, body = '') => { site = healthy(); site[part] = { status, body: body || site[part].body }; };
const errors = (log) => log.split('\n').filter((l) => l.startsWith('::error'));

// ── Well ─────────────────────────────────────────────────────────────────────
site = healthy();
let r = await check();
ok('everything answering: the run passes', r.code === 0 && r.log.includes('Everything answered.') && !errors(r.log).length, r.log.trim().split('\n').pop());
ok('…asking each of the five once', r.asked.length === 5, r.asked.join(' | '));
ok('…the server\'s three asking to run beside the database', r.asked.filter((a) => a.endsWith('us-west-2')).length === 3);
ok('…and the summary says so', r.summary.includes('Everything answered.'));

// ── Down, each way, fails the run and says why ───────────────────────────────
const cases = [
  ['pages', 502, '', 'App pages: the app\'s page answered HTTP 502'],
  ['pages', 200, '<html>maintenance</html>', 'App pages: the app\'s page answered without its sign-in script'],
  ['tools', 404, '', 'Free tools: the free tools\' page answered HTTP 404'],
  ['tools', 200, '<html></html>', 'Free tools: the free tools\' page answered without its form'],
  ['plans', 500, '', 'Server: the server\'s price list answered HTTP 500'],
  ['status', 500, '', 'Server status: the status read answered HTTP 500'],
  ['status', 200, 'not json', 'Server status: the status read\'s answer couldn\'t be read'],
  ['gate', 200, '{"data":{}}', 'Health answer locked: the health answer should refuse a caller without the secret (403) and answered HTTP 200'],
];
for (const [part, status, body, why] of cases) {
  down(part, status, body);
  r = await check();
  ok(`down: ${why}`, r.code === 1 && errors(r.log).some((l) => l.includes(why)) && r.summary.includes(why) && r.summary.includes('docs/RUN-SHEET.md'), errors(r.log).join(' / '));
}
// The server's own verdict, part by part, in words.
const unwell = { database: 'the database isn\'t answering', schedule: 'the 15-minute job hasn\'t finished in 45 minutes', failures: 'scheduled work keeps failing', crashes: 'the server crashed more than 5 times in the last hour', settings: 'a setting the server can\'t run without is missing' };
for (const [partName, words] of Object.entries(unwell)) {
  const body = JSON.parse(healthy().status.body); body.data.ok = false; body.data[partName] = false;
  down('status', 200, JSON.stringify(body));
  r = await check();
  ok(`unwell: ${partName} false says "${words}"`, r.code === 1 && errors(r.log).some((l) => l.includes('the server says it isn\'t well') && l.includes(words)), errors(r.log).join(' / '));
}
// Two things down at once: both named.
site = healthy(); site.tools = { status: 500, body: '' }; site.plans = { status: 500, body: '' };
r = await check();
ok('two things down: both named, one failed run', r.code === 1 && errors(r.log).length === 2);

// ── Not an outage ────────────────────────────────────────────────────────────
site = healthy(); flaky = new Map([['pages', 1], ['plans', 1]]);
r = await check();
ok('a single slow answer is tried again and passes', r.code === 0 && r.log.includes('on the second try'), r.log.split('\n').filter((l) => l.includes('second')).join(' / '));
flaky = new Map([['pages', 2]]);
r = await check();
ok('…but down twice in a row is down', r.code === 1 && errors(r.log).some((l) => l.includes('App pages')));
flaky = new Map();
for (const code of [404, 401]) {
  down('status', code, code === 401 ? '{"error":"unauthorized","message":"Please sign in."}' : 'not found');
  clock = BEFORE;
  r = await check();
  ok(`the status read not live yet (HTTP ${code}, before item 417's release): a note, and the run passes`, r.code === 0 && r.log.includes('::notice title=Uptime::') && r.summary.includes('isn\'t live yet'));
  clock = AFTER;
  r = await check();
  ok(`…and from Dec 6 on, a missing status read (HTTP ${code}) is an outage`, r.code === 1 && errors(r.log).some((l) => l.includes(`the status read is missing (HTTP ${code})`)), errors(r.log).join(' / '));
}
clock = BEFORE;

ac.abort();
await server.finished;
await Deno.remove(dir, { recursive: true });
const passed = results.filter((x) => x.p).length;
console.log(`\n════ UPTIME: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
