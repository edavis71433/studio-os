// ── Server crashes are counted, raise the alarm, and show on Health (builder item 416) ──
// Nov 22 review, file 07, finding 3: a request that crashes writes one ops_errors row
// (index.ts), and nothing read that table, so a page that crashed for every client raised
// no alarm. Now the health answer counts crashes in the last hour and day, turns not-ok
// above 5 an hour, the Health page's areas say so, and the newest ten come with it.
// Drives the real routes/system.ts against a stand-in database, on a pinned clock.
//   deno run --allow-read --allow-env --allow-net tests/presence/crash_counts_416_test.mjs
import { pinClock } from './clock.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SECRET = 'test-scheduler-secret';
const SB = 'https://example.supabase.co';
Deno.env.set('SUPABASE_URL', SB); Deno.env.set('SERVICE_ROLE_KEY', 'test'); Deno.env.set('SUPABASE_ANON_KEY', 'test'); Deno.env.set('SCHEDULER_SECRET', SECRET);
Deno.env.delete('NETLIFY_AUTH_TOKEN'); Deno.env.delete('PEXELS_API_KEY');

const restoreClock = pinClock('2026-11-22T18:00:00Z');
const now = Date.now();
const ago = (ms) => new Date(now - ms).toISOString();

// The stand-in database. `counts` is what presence_health_counts answers (null: a 404, as
// before 0247); the crash rows and the ledger answer the small reads.
let counts = null, rpcStatus = 200;
let crashes = [];   // { kind, detail, created_at }
let ledger = null;  // null: no ledger table (404); else the numbers in it
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method || 'GET').toUpperCase();
  if (!url.startsWith(`${SB}/rest/v1/`)) throw new Error(`unexpected fetch ${url}`);
  const path = decodeURIComponent(url.slice(`${SB}/rest/v1/`.length));
  seen.push(`${method} ${path.split('&select=id')[0]}`);
  const reply = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  if (path.startsWith('rpc/presence_health_counts')) return counts ? reply(counts, rpcStatus) : reply({ message: 'not found' }, 404);
  if (path.startsWith('ops_errors?created_at=gte.')) {
    const since = Date.parse(path.match(/gte\.([^&]+)/)[1]);
    const n = crashes.filter((c) => Date.parse(c.created_at) >= since).length;
    return reply(null, 200, { 'content-range': `*/${n}` });
  }
  if (path.startsWith('ops_errors?select=kind,detail,created_at')) {
    const limit = Number(path.match(/limit=(\d+)/)[1]);
    return reply([...crashes].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
  }
  if (path.startsWith('presence_change_ledger')) return ledger === null ? reply({ code: 'PGRST205', message: 'not found' }, 404) : reply([...ledger].sort((a, b) => b - a).map((number) => ({ number })));
  if (method === 'HEAD') return reply(null, 200, { 'content-range': '*/0' });
  return reply([]);
};

const { handleSystem, readHealthCounts, computeHealthCenter, readRecentCrashes, judgeHealth, CRASH_ALARM_1H } = await import('../../supabase/functions/presence/routes/system.ts');
const { crashesArea } = await import('../../supabase/functions/presence/lib/health_center.ts');
const get = async (route, init = {}) => { const res = await handleSystem(new Request(`${SB}/functions/v1/presence${route}`, init), route, init.method || 'GET', {}); return { status: res.status, body: await res.json().catch(() => null) }; };
const health = () => get('/system/health', { headers: { 'x-system-secret': SECRET } });
const area = (hc, key) => hc?.areas?.find((a) => a.key === key);

const BASE = {
  active_sites: 9, ent_paused: 0, ent_lapsed: 0,
  last_cycle: { status: 'done', started_at: ago(300_000), finished_at: ago(240_000), site_id: null },
  failures_24h: 0, last_failure: null, stuck_runs: 0, live_sites: 7, domains_watched: 2, domains_soon: 0,
  notices: 0, failed_publishes: 0, ai_ops: 12, paid_publishes_30d: 5,
};
const crashRows = (n, msAgo, kind = 'presence:POST /site') => Array.from({ length: n }, (_, i) => ({ kind, detail: `TypeError: boom ${i}\n    at route_ (index.ts:1:1)`, created_at: ago(msAgo + i * 1000) }));

// ═══ 1. With 0261: the crashes come in the same one trip ═══
counts = { ...BASE, crashes_1h: 2, crashes_24h: 7, ledger_newest: 261, ledger_rows: 120 };
seen.length = 0;
let r = await health();
ok('with 0261 the check still makes one database trip', r.status === 200 && seen.length === 1 && seen[0].startsWith('POST rpc/presence_health_counts'), seen.join(' | '));
ok('…and reports the crashes of the last hour and day', r.body?.data?.crashes?.last_hour === 2 && r.body.data.crashes.last_day === 7 && r.body.data.crashes.alarm_above === CRASH_ALARM_1H, JSON.stringify(r.body?.data?.crashes));
ok('two crashes in an hour is under the alarm: ok', r.body?.data?.ok === true && r.body.data.crash_alarm === false);
ok('the alarm sounds above 5 an hour', CRASH_ALARM_1H === 5);
counts = { ...counts, crashes_1h: 6 };
r = await health();
ok('six crashes in an hour: not ok, and crash_alarm says why (the watchdog\'s email reads it)', r.body?.data?.ok === false && r.body.data.crash_alarm === true && r.body.data.failure_alarm === false && r.body.data.crashes.last_hour === 6);
counts = { ...counts, crashes_1h: 5 };
r = await health();
ok('exactly five is still under it', r.body?.data?.ok === true && r.body.data.crash_alarm === false);
ok('the health answer names the newest database change and the code\'s (item 420)', r.body?.data?.changes?.newest === 261 && Number.isInteger(r.body.data.changes.code_newest));

// ═══ 2. With only 0247: three small reads of their own, side by side ═══
counts = { ...BASE };
crashes = [...crashRows(3, 10 * 60_000), ...crashRows(4, 5 * 3600_000)];
ledger = [109, 110, 247, 260];
seen.length = 0;
const c = await readHealthCounts(now);
const extra = seen.filter((s) => !s.startsWith('POST rpc/'));
ok('before 0261 the counts come from the one trip plus three small reads', seen.length === 4 && extra.length === 3, seen.join(' | '));
ok('…crashes in the last hour and the last day, counted', c?.crashes_1h === 3 && c?.crashes_24h === 7, `${c?.crashes_1h} / ${c?.crashes_24h}`);
ok('…and the ledger\'s newest number and its rows', c?.ledger_newest === 260 && c?.ledger_rows === 4);
ledger = null;
const noLedger = await readHealthCounts(now);
ok('no ledger yet (before 0260): its numbers are unknown, not zero, and nothing breaks', noLedger && noLedger.ledger_newest === null && noLedger.ledger_rows === null && noLedger.crashes_1h === 3);

// ═══ 3. Before 0247: the crashes join the one wave ═══
counts = null;
ledger = [260];
seen.length = 0;
const wave = await readHealthCounts(now);
ok('before 0247 the crash and ledger reads go in the same wave', !!wave && wave.crashes_1h === 3 && wave.crashes_24h === 7 && wave.ledger_newest === 260, JSON.stringify(wave && { c1: wave.crashes_1h, c24: wave.crashes_24h, l: wave.ledger_newest }));
ok('…and none of them is made twice', new Set(seen).size === seen.length, seen.filter((s, i) => seen.indexOf(s) !== i).join(' | '));

// ═══ 4. The verdict, shared with the public status read ═══
ok('judgeHealth: crashes above the alarm make it not ok', judgeHealth({ ...BASE, crashes_1h: 9, crashes_24h: 9, ledger_newest: null, ledger_rows: null }, true, now).ok === false);
ok('judgeHealth: crashes that couldn\'t be counted don\'t sound it', judgeHealth({ ...BASE, crashes_1h: null, crashes_24h: null, ledger_newest: null, ledger_rows: null }, true, now).ok === true);
ok('judgeHealth: a database that doesn\'t answer is not ok', judgeHealth(null, true, now).ok === false && judgeHealth(null, true, now).dbOk === false);

// ═══ 5. The Health page's area, and the newest ten ═══
counts = { ...BASE, crashes_1h: 0, crashes_24h: 0, ledger_newest: 261, ledger_rows: 120 };
let hc = await computeHealthCenter();
ok('no crashes in a day: the area is calm', area(hc, 'crashes')?.state === 'ok' && area(hc, 'crashes').label === 'Server crashes' && area(hc, 'crashes').detail === 'No crashes in the last day.');
counts = { ...counts, crashes_1h: 1, crashes_24h: 3 };
hc = await computeHealthCenter();
ok('three in a day, one this hour: the area asks for a look, in words', area(hc, 'crashes')?.state === 'attention' && area(hc, 'crashes').detail === '3 crashes in the last day, 1 of them in the last hour. The newest are listed below.', area(hc, 'crashes')?.detail);
ok('…and the overall asks for a look too', hc?.overall === 'attention');
counts = { ...counts, crashes_1h: 8, crashes_24h: 8 };
hc = await computeHealthCenter();
ok('above the alarm the area says the alarm is sounding', area(hc, 'crashes')?.state === 'attention' && area(hc, 'crashes').detail.startsWith('8 crashes in the last hour: something is broken for someone'));
ok('one crash reads as one crash', crashesArea({ lastHour: 0, lastDay: 1, alarmAbove: 5 }).detail === '1 crash in the last day. The newest are listed below.');
ok('crashes that couldn\'t be counted ask for a look instead of saying none', crashesArea({ lastHour: null, lastDay: null, alarmAbove: 5 }).state === 'attention');

crashes = [...crashRows(12, 60_000), { kind: 'presence:GET /portal/context', detail: `RangeError: ${'x'.repeat(500)}\nsecond line`, created_at: ago(1000) }];
const recent = await readRecentCrashes(10);
ok('the newest ten crashes, newest first', recent?.length === 10 && recent[0].what === 'GET /portal/context' && recent[1].what === 'POST /site');
ok('…each the route and the first line of what it said, cut to 300 characters', recent?.[0].said.length === 300 && !recent[0].said.includes('second line') && recent?.[1].said === 'TypeError: boom 0');
ok('…with when', recent?.[0].at === ago(1000));
const fails = globalThis.fetch;
globalThis.fetch = async () => new Response('boom', { status: 500 });
ok('a list that can\'t be read is null, not a throw', (await readRecentCrashes()) === null);
globalThis.fetch = fails;

restoreClock();
const passed = results.filter((x) => x.p).length;
console.log(`\n════ CRASH COUNTS (416): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
