// ── The 5-minute alarm check reads once, beside the database (builder items 403, 404) ──
// Nov 22 review, file 14, findings 3 and 6: /system/health made 16 or 17 reads from Ohio,
// 6 or 7 one after another and three twice, 2.8 s a check; and the Oregon worker started
// cold 123 times a day, which the first click after a pause paid for. Now:
//   · with migration 0247 the check makes ONE database trip (presence_health_counts) and
//     the Admin Health Center reuses it; the two calls out (the host's plan, the photo
//     key) go side by side;
//   · before 0247 the same counts go out as one wave, none twice (system_health_test.mjs);
//   · the watchdog's probe asks for Oregon (x-region), and a 'ping' task touches nothing,
//     for the keep-awake job every minute.
//   deno run --allow-read --allow-env --allow-net tests/presence/health_once_403_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SECRET = 'test-scheduler-secret';
const SB = 'https://example.supabase.co';
Deno.env.set('SUPABASE_URL', SB); Deno.env.set('SERVICE_ROLE_KEY', 'test'); Deno.env.set('SUPABASE_ANON_KEY', 'test'); Deno.env.set('SCHEDULER_SECRET', SECRET);
Deno.env.delete('NETLIFY_AUTH_TOKEN'); Deno.env.delete('PEXELS_API_KEY');

const now = Date.now();
let counts = null;
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method || 'GET').toUpperCase();
  if (!url.startsWith(`${SB}/rest/v1/`)) throw new Error(`unexpected fetch ${url}`);
  const path = decodeURIComponent(url.slice(`${SB}/rest/v1/`.length));
  seen.push(`${method} ${path}`);
  if (path.startsWith('rpc/presence_health_counts')) return new Response(JSON.stringify(counts), { status: 200, headers: { 'content-type': 'application/json' } });
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};
const { handleSystem, readHealthCounts, computeHealthCenter } = await import('../../supabase/functions/presence/routes/system.ts');
const get = async (route, init = {}) => { const res = await handleSystem(new Request(`${SB}/functions/v1/presence${route}`, init), route, init.method || 'GET', {}); return { status: res.status, body: await res.json().catch(() => null) }; };

// ═══ 1. with 0247: one trip ═══
counts = {
  active_sites: 9, ent_paused: 1, ent_lapsed: 0,
  last_cycle: { status: 'done', started_at: new Date(now - 300_000).toISOString(), finished_at: new Date(now - 240_000).toISOString(), site_id: null },
  failures_24h: 3, last_failure: { run_type: 'tick', last_error: 'x'.repeat(400), created_at: new Date(now - 600_000).toISOString() }, stuck_runs: 0,
  live_sites: 7, domains_watched: 2, domains_soon: 1, notices: 4, failed_publishes: 0, ai_ops: 12, paid_publishes_30d: 5,
  // builder items 416 and 420 (migration 0261): the crashes and the ledger come in the same trip.
  // With only 0247's keys they take three small reads of their own (crash_counts_416_test.mjs).
  crashes_1h: 0, crashes_24h: 0, ledger_newest: 261, ledger_rows: 120,
};
seen.length = 0;
const r = await get('/system/health', { headers: { 'x-system-secret': SECRET } });
const dbReads = seen.filter((s) => !s.startsWith('POST rpc/presence_health_counts'));
ok('the check answers from one database trip, nothing else read', r.status === 200 && seen.length === 1 && dbReads.length === 0, seen.join(' | '));
ok('…and judges from it: 3 failures under the alarm, ok', r.body?.data?.ok === true && r.body.data.failures_last_24h === 3 && r.body.data.active_sites === 9 && r.body.data.db_ok === true);
ok('…the newest failure keeps the field the watchdog\'s SQL reads (at), cut to 300', r.body?.data?.last_failure?.at === counts.last_failure.created_at && r.body.data.last_failure.last_error.length === 300 && r.body.data.last_failure.run_type === 'tick');
ok('…and the Health Center is filled from the same trip', r.body?.data?.health_center && JSON.stringify(r.body.data.health_center).includes('"'));
counts = { ...counts, stuck_runs: 1 };
const s = await get('/system/health', { headers: { 'x-system-secret': SECRET } });
ok('a stuck run from the one trip makes it not ok', s.body?.data?.ok === false && s.body.data.failure_alarm === true && s.body.data.stuck_runs === 1);
counts = { ...counts, stuck_runs: 0, last_cycle: { status: 'done', started_at: new Date(now - 3 * 3600_000).toISOString(), finished_at: new Date(now - 3 * 3600_000).toISOString(), site_id: null } };
const st = await get('/system/health', { headers: { 'x-system-secret': SECRET } });
ok('a last finished run three hours ago is a stale scheduler', st.body?.data?.cron_stale === true && st.body.data.ok === false);
// the Admin Health Center alone reads the one trip too
seen.length = 0;
const hc = await computeHealthCenter();
ok('the Admin Health Center on its own: one trip', !!hc && seen.filter((x) => x.startsWith('POST rpc/presence_health_counts')).length === 1 && seen.length === 1, seen.join(' | '));
// a database that can't answer: not ok, never a throw
counts = null;
globalThis.fetch = async () => { throw new Error('down'); };
const down = await get('/system/health', { headers: { 'x-system-secret': SECRET } });
ok('a database that doesn\'t answer: db_ok false, ok false, the check still answers', down.status === 200 && down.body?.data?.db_ok === false && down.body.data.ok === false);
ok('readHealthCounts answers null then, not a throw', (await readHealthCounts()) === null);

// ═══ 2. the ping (builder item 404) ═══
{
  seen.length = 0;
  const p = await get('/system/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET, task: 'ping' }) });
  ok('task ping: answers at once and touches nothing', p.status === 200 && p.body?.data?.awake === true && seen.length === 0, JSON.stringify(p.body));
  const no = await get('/system/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'wrong', task: 'ping' }) });
  ok('…and needs the secret like every other task', no.status === 403);
}

// ═══ 3. the migration, the packs and the cron files ═══
{
  const migration = read('supabase/migrations/0247_health_counts.sql'), pack = read('docs/presence/APPLY-0247-prod.sql');
  const fn = (s) => (s.match(/create or replace function public\.presence_health_counts\(\)[\s\S]*?\$\$;/) || [''])[0];
  ok('the pack carries the migration\'s function, word for word', fn(migration).length > 500 && fn(migration) === fn(pack));
  for (const k of ['active_sites', 'ent_paused', 'ent_lapsed', 'last_cycle', 'failures_24h', 'last_failure', 'stuck_runs', 'live_sites', 'domains_watched', 'domains_soon', 'notices', 'failed_publishes', 'ai_ops', 'paid_publishes_30d']) ok(`the function answers ${k}`, fn(migration).includes(`'${k}',`));
  ok('the function is read-only and the service role\'s alone', /\bstable\b/.test(fn(migration)) && /revoke all on function public\.presence_health_counts\(\) from public, anon, authenticated;/.test(migration) && /grant execute on function public\.presence_health_counts\(\) to service_role;/.test(migration));
  ok('the live-site rule matches lib/site_live.ts (edition presence, not offline, live or ever published)', /edition = 'presence' and offline_at is null and \(status = 'live' or last_published_at is not null\)/.test(fn(migration)));
  const watchdog = read('supabase/ops/watchdog-cron.sql');
  ok('the watchdog\'s probe asks for Oregon', /'x-region', 'us-west-2'\)/.test(watchdog) && watchdog.indexOf("'x-region'") > watchdog.indexOf("'x-system-secret'"));
  ok('…and still reads the top-level ok only, with the last failure\'s at', /\(report -> 'ok'\) = 'true'::jsonb/.test(watchdog) && /report -> 'last_failure' ->> 'at'/.test(watchdog));
  const keep = read('docs/presence/APPLY-keep-awake-prod.sql');
  ok('the keep-awake pack: every minute, task ping, asking for Oregon, the secret from Vault, production\'s address', /cron\.schedule\('presence-keep-awake', '\* \* \* \* \*'/.test(keep) && /'task', 'ping'/.test(keep) && /"x-region":"us-west-2"/.test(keep) && /vault\.decrypted_secrets where name = 'presence_scheduler_secret'/.test(keep) && /qksstlqzbhesadrrofgn\.supabase\.co\/functions\/v1\/presence\/system\/run'/.test(keep) && !/secret=/.test((keep.match(/do \$pack\$[\s\S]*?\$pack\$;/) || [''])[0]));
  ok('…inside one do block that refuses to run anywhere but production', /do \$pack\$[\s\S]*raise exception[\s\S]*\$pack\$;/.test(keep));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
