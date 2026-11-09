// ── /system/health: what the watchdog can trust ──────────────────────────────
// The staging watchdog emailed "Production health check is failing" every 6
// hours from Jul 12 to Nov 8 2026 and never said why. Two things were wrong at
// once: it sent the secret in the address, which /system/* has refused since
// Jul 12 (FD-AUD16), and production really was failing every tick, on one
// refused cleanup step (0141). This pins the server's half of the fix:
//   1. the secret counts ONLY in the x-system-secret header (or a POST body),
//      never in the address, which is how the July watchdog sent it;
//   2. the verdict is the TOP-LEVEL ok, and the same body says "ok":true
//      (secrets.ok) while production is failing, so a text match can't judge it;
//   3. the report names its newest failure, so an alert can say why.
//   deno run --allow-read --allow-env --allow-net tests/presence/system_health_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const SECRET = 'test-scheduler-secret';
const SB = 'https://example.supabase.co';
Deno.env.set('SUPABASE_URL', SB);
Deno.env.set('SERVICE_ROLE_KEY', 'test');
Deno.env.set('SUPABASE_ANON_KEY', 'test');
Deno.env.set('SCHEDULER_SECRET', SECRET);

// A fake PostgREST: counts answer HEAD with content-range, reads answer rows.
let world = { failures: 0, stuck: 0, lastError: '' };
const seen = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method || 'GET').toUpperCase();
  if (!url.startsWith(`${SB}/rest/v1/`)) throw new Error(`unexpected fetch ${url}`);
  const path = decodeURIComponent(url.slice(`${SB}/rest/v1/`.length));
  seen.push(`${method} ${path}`);
  const runs = path.startsWith('presence_scheduled_runs');
  if (method === 'HEAD') {
    const n = runs && path.includes('status=eq.failed') ? world.failures
      : runs && path.includes('status=eq.running') ? world.stuck
      : path.startsWith('presence_entitlements') ? 1 : 0;
    return new Response(null, { status: 200, headers: { 'content-range': `*/${n}` } });
  }
  const now = Date.now();
  let rows = [];
  if (path.startsWith('presence_sites?select=id')) rows = [{ id: 's1' }];
  else if (runs && path.includes('status=eq.done')) rows = [{ status: 'done', started_at: new Date(now - 300_000).toISOString(), finished_at: new Date(now - 240_000).toISOString(), site_id: 's1' }];
  else if (runs && path.includes('status=eq.failed') && path.includes('order=created_at.desc')) rows = world.failures ? [{ run_type: 'tick', last_error: world.lastError, created_at: new Date(now - 600_000).toISOString() }] : [];
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { handleSystem } = await import('../../supabase/functions/presence/routes/system.ts');
const HEALTH = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/health';
const get = async (url, headers = {}) => {
  const res = await handleSystem(new Request(url, { headers }), '/system/health', 'GET', {});
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, data: body?.data };
};
const withHeader = () => get(HEALTH, { 'x-system-secret': SECRET });

// ═══ 1. where the secret may travel ═══
world = { failures: 0, stuck: 0, lastError: '' };
ok('the secret in the address is refused (how the July watchdog sent it)', (await get(`${HEALTH}?secret=${SECRET}`)).status === 403);
ok('a wrong secret in the header is refused', (await get(HEALTH, { 'x-system-secret': 'not-it' })).status === 403);
let r = await withHeader();
ok('the secret in the x-system-secret header is accepted', r.status === 200, String(r.status));
ok('a healthy production says ok:true', r.data?.ok === true && r.data?.failure_alarm === false);
ok('...with no last_failure', r.data?.last_failure === null);
ok('no failure, no extra read for one', !seen.some((s) => s.includes('select=run_type,last_error,created_at')));

// ═══ 2. July to November: every tick failed on the refused prune ═══
world = { failures: 96, stuck: 0, lastError: 'retention.evidence_runs failed' };
r = await withHeader();
ok('96 failed runs in 24 hours: top-level ok is false', r.data?.ok === false && r.data?.failure_alarm === true && r.data?.failures_last_24h === 96);
ok('...while secrets.ok is still true', r.data?.secrets?.ok === true);
ok('so the body holds "ok":true while production is NOT ok (a text match would call it healthy)', r.text.includes('"ok":true') && r.data?.ok === false);
ok('the report names the newest failure', r.data?.last_failure?.run_type === 'tick' && r.data?.last_failure?.last_error === 'retention.evidence_runs failed' && !Number.isNaN(Date.parse(r.data?.last_failure?.at)));

// ═══ 3. under the alarm, and stuck runs ═══
world = { failures: 3, stuck: 0, lastError: 'cycle: ok=false' };
r = await withHeader();
ok('3 failures (under the alarm of 10) stay ok, and still name the newest one', r.data?.ok === true && r.data?.last_failure?.last_error === 'cycle: ok=false');
world = { failures: 0, stuck: 1, lastError: '' };
r = await withHeader();
ok('a stuck run alone makes it not ok', r.data?.ok === false && r.data?.failure_alarm === true && r.data?.stuck_runs === 1);

// ═══ 4. a long error is cut ═══
world = { failures: 12, stuck: 0, lastError: 'x'.repeat(2000) };
r = await withHeader();
ok('last_error is cut to 300 characters', r.data?.last_failure?.last_error?.length === 300);

const passed = results.filter(Boolean).length;
console.log(`\n════ SYSTEM HEALTH: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
