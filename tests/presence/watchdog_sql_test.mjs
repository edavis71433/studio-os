// ── The staging watchdog: secret in a header, verdict from the top-level ok ───
// supabase/ops/watchdog-cron.sql runs in the STAGING database and probes
// production's /system/health every 5 minutes. The hand-built July version put
// the secret in the address, which /system/* has refused since Jul 12 2026
// (FD-AUD16). Every probe got 403, and it emailed "Production health check is
// failing" every 6 hours for four months without saying why. It also called a
// 200 healthy when "ok":true appeared anywhere in the body, and secrets.ok is
// true while the top-level ok is false, so it could not have seen the real
// failure underneath (0141). The SQL can't run here (no pg_net, vault or
// pg_cron), so this pins the properties that broke, plus the ones that keep
// the paste safe. tests/presence/system_health_test.mjs pins the server side.
//   deno run --allow-read tests/presence/watchdog_sql_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const sql = read('supabase/ops/watchdog-cron.sql');
const code = sql.replace(/--[^\n]*/g, '');
const fn = /create or replace function public\.presence_watchdog\(\)[\s\S]*?as \$fn\$([\s\S]*?)\$fn\$;/.exec(code)?.[1] ?? '';
ok('the watchdog function is there', fn.length > 1000, String(fn.length));

// ═══ 1. the secret never travels in the address ═══
ok('the probe sends the secret in the x-system-secret header', /net\.http_get\([\s\S]*?headers := jsonb_build_object\('x-system-secret',\s*coalesce\(\(select decrypted_secret from vault\.decrypted_secrets where name = 'watchdog_target_secret'\)/.test(fn));
ok('the probe address is cut at "?", so a secret stored there never goes out', /url := split_part\(\(select decrypted_secret from vault\.decrypted_secrets where name = 'watchdog_health_url'\), '\?', 1\)/.test(fn));
ok('nothing in the function builds secret= into an address', !/secret=/i.test(fn));
ok('the server still refuses the secret in the address (the fix is the header, not loosening FD-AUD16)', !/searchParams/.test(read('supabase/functions/presence/routes/system.ts')));
ok('the one-time move runs only while watchdog_target_secret is missing', /if exists \(select 1 from vault\.secrets where name = 'watchdog_target_secret'\) then\s+return;/.test(code));
ok('...and leaves the stored address without its query', /vault\.update_secret\(url_id, split_part\(url_val, '\?', 1\)\)/.test(code));
ok('the probe sent the old way is not judged', /update public\.watchdog_state set last_request_id = null where id = 1;/.test(code));

// ═══ 2. the verdict ═══
ok('healthy = HTTP 200 and the TOP-LEVEL data.ok', /resp\.content::jsonb -> 'data'/.test(fn) && /elsif \(report -> 'ok'\) = 'true'::jsonb then/.test(fn) && /resp\.status_code <> 200/.test(fn));
ok('no text match on "ok":true (secrets.ok made that pass while production failed)', !/"ok":true/.test(fn) && !/\blike\b/i.test(fn));
ok('a body that is not JSON is a failure, not an error', /exception when others then\s+report := null;/.test(fn));

// ═══ 3. the email says why ═══
ok('a 403 is named as the secret being refused', /resp\.status_code = 403/.test(fn) && /HTTP 403/.test(fn));
ok('no answer is named, with pg_net\'s own error', /resp\.status_code is null/.test(fn) && /resp\.error_msg/.test(fn) && /resp\.timed_out/.test(fn));
ok('production\'s own flags are spelled out', ['db_ok', 'cron_stale', 'failure_alarm', 'failures_last_24h', 'stuck_runs', 'missing_required', 'last_failure'].every((k) => fn.includes(`'${k}'`)));
ok('the email carries the reason, HTML-escaped', /replace\(replace\(replace\(reason, '&', '&amp;'\), '<', '&lt;'\), '>', '&gt;'\)/.test(fn) && /'<p><strong>Why:<\/strong> ' \|\| safe/.test(fn) && /'Why: ' \|\| reason/.test(fn));
ok('same subject as before, so existing mail rules still match', fn.includes("'[Studio OS ops] Production health check is failing'"));
ok('at most one email every 6 hours', /st\.last_alert_at is null or st\.last_alert_at < now\(\) - interval '6 hours'/.test(fn));
ok('30 minutes without a healthy answer still alerts', /st\.last_ok_at < now\(\) - interval '30 minutes'/.test(fn));
ok('the last reason is kept where the dashboard can show it', /last_reason = left\(reason, 1000\)/.test(fn) && /add column if not exists last_reason text/.test(code));

// ═══ 4. the live setup it replaces, and a safe paste ═══
ok('keeps the live job: presence-watchdog every 5 minutes', /select cron\.schedule\('presence-watchdog', '\*\/5 \* \* \* \*', 'select public\.presence_watchdog\(\)'\);/.test(code));
ok('only the cron job may run it (staging\'s anon key is public)', /revoke all on function public\.presence_watchdog\(\) from public, anon, authenticated;/.test(code));
ok('the state table is deny-all to the API', /alter table public\.watchdog_state enable row level security;/.test(code));
ok('re-runnable', /create table if not exists public\.watchdog_state/.test(code) && /on conflict \(id\) do nothing/.test(code) && /create extension if not exists pg_net/.test(code));
const verify = code.slice(code.indexOf("select cron.schedule('presence-watchdog'"));
ok('the verify shows no secret values', /as watchdog_secrets/.test(verify) && /as address_holds_no_secret/.test(verify) && !/select\s+decrypted_secret\b/i.test(verify));
ok('no secret values in the file', !/[A-Za-z0-9_-]{32,}/.test(sql));
ok('ASCII only (pastes cleanly)', [...sql].every((c) => c.codePointAt(0) < 128));

const passed = results.filter(Boolean).length;
console.log(`\n════ WATCHDOG SQL: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
