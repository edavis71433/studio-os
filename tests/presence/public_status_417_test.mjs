// ── The public status read the outside check asks (builder item 417) ────────────────
// GET /status answers the outside check (.github/workflows/uptime.yml) every 15 minutes:
// the same verdict as /system/health, from the same one database trip, as true or false
// per part and nothing else, with no secret and no session. Drives the real router
// (index.ts, std's serve() handed a fake listener) against a stand-in database.
//   deno run --allow-read --allow-env --allow-net tests/presence/public_status_417_test.mjs
import { pinClock } from './clock.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SB = 'https://example.supabase.co';
Deno.env.set('SUPABASE_URL', SB); Deno.env.set('SERVICE_ROLE_KEY', 'test-service'); Deno.env.set('SUPABASE_ANON_KEY', 'test-anon'); Deno.env.set('SCHEDULER_SECRET', 'test-scheduler-secret');
Deno.env.delete('NETLIFY_AUTH_TOKEN'); Deno.env.delete('PEXELS_API_KEY');

const restoreClock = pinClock('2026-11-22T18:00:00Z');
const now = Date.now();
const ago = (ms) => new Date(now - ms).toISOString();
const COUNTS = {
  active_sites: 9, ent_paused: 0, ent_lapsed: 0,
  last_cycle: { status: 'done', started_at: ago(300_000), finished_at: ago(240_000), site_id: null },
  failures_24h: 0, last_failure: { run_type: 'tick', last_error: 'secret words', created_at: ago(600_000) }, stuck_runs: 0,
  live_sites: 7, domains_watched: 2, domains_soon: 0, notices: 0, failed_publishes: 0, ai_ops: 12, paid_publishes_30d: 5,
  crashes_1h: 0, crashes_24h: 4, ledger_newest: 261, ledger_rows: 120,
};
let counts = { ...COUNTS }, down = false;
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String((init.method || (input instanceof Request ? input.method : 'GET'))).toUpperCase();
  seen.push(`${method} ${url}`);
  if (down) throw new Error('database down');
  if (url.startsWith(`${SB}/rest/v1/rpc/presence_health_counts`)) return new Response(JSON.stringify(counts), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith(`${SB}/rest/v1/`)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error(`unexpected call out: ${url}`);
};

// the real index.ts, with std's serve() handed a fake listener: no socket opens
const queue = []; let wake = null;
Deno.listen = () => {
  let first = true;
  return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} };
};
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const { forgetStatusMemo } = await import('../../supabase/functions/presence/routes/system.ts');
function send(request) {
  return new Promise((resolve) => {
    const ev = { request, respondWith: async (r) => { resolve(await r); } };
    if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev);
  });
}
async function status(path = '/status', init = {}) {
  const res = await send(new Request(`${SB}/functions/v1/presence${path}`, init));
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json().catch(() => null) };
}

// ═══ 1. A visitor's question gets a visitor's answer ═══
seen.length = 0;
let r = await status();
const d = r.body?.data;
ok('GET /status answers with no secret and no session', r.status === 200 && d?.ok === true, JSON.stringify(r.body));
ok('…true or false per part, and a time', d && ['ok', 'server', 'database', 'schedule', 'failures', 'crashes', 'settings'].every((k) => typeof d[k] === 'boolean') && typeof d.checked_at === 'string');
const allowed = new Set(['ok', 'server', 'database', 'schedule', 'failures', 'crashes', 'settings', 'checked_at']);
ok('…and nothing else: no counts, no names, no failure\'s words', d && Object.keys(d).every((k) => allowed.has(k)) && !JSON.stringify(r.body).includes('secret words') && !JSON.stringify(r.body).includes('SCHEDULER'), Object.keys(d || {}).join(','));
ok('…from one database trip, and no call out to the host or the photo library', seen.length === 1 && seen[0].startsWith(`POST ${SB}/rest/v1/rpc/presence_health_counts`), seen.join(' | '));
ok('…and it isn\'t kept by a browser or a cache', r.cache === 'no-store');

// ═══ 2. The same verdict as /system/health, part by part ═══
const verdict = async (c) => { counts = { ...COUNTS, ...c }; forgetStatusMemo(); return (await status()).body?.data; };
let v = await verdict({ crashes_1h: 6 });
ok('six crashes in an hour: not ok, crashes false, the rest true', v?.ok === false && v.crashes === false && v.database && v.schedule && v.failures);
v = await verdict({ last_cycle: { status: 'done', started_at: ago(3 * 3600_000), finished_at: ago(3 * 3600_000), site_id: null } });
ok('no finished 15-minute run in three hours: schedule false', v?.ok === false && v.schedule === false && v.crashes === true);
v = await verdict({ failures_24h: 12 });
ok('twelve failed runs in a day: failures false', v?.ok === false && v.failures === false);
v = await verdict({ stuck_runs: 1 });
ok('a run stuck for two hours: failures false', v?.ok === false && v.failures === false);
down = true; forgetStatusMemo();
r = await status();
ok('a database that doesn\'t answer: still a 200, ok false, database false', r.status === 200 && r.body?.data?.ok === false && r.body.data.database === false && r.body.data.server === true);
down = false;

// ═══ 3. A burst of callers costs one trip a minute ═══
counts = { ...COUNTS }; forgetStatusMemo();
seen.length = 0;
for (let i = 0; i < 5; i++) await status();
ok('five calls inside a minute: one database trip', seen.length === 1, String(seen.length));
const restore2 = pinClock(now + 61_000);
await status();
restore2();
ok('…and a fresh read once the minute is up', seen.length === 2, String(seen.length));

// ═══ 4. Only GET /status: the rest of /system still needs the secret ═══
const posted = await status('/status', { method: 'POST', body: '{}' });
ok('POST /status is not the status read', posted.body?.data?.server !== true, `${posted.status} ${JSON.stringify(posted.body).slice(0, 80)}`);
const locked = await status('/system/health');
ok('/system/health without the secret is still refused (403)', locked.status === 403);

restoreClock();
const passed = results.filter((x) => x.p).length;
console.log(`\n════ PUBLIC STATUS (417): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
