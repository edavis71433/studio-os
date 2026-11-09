// ── Scheduled database jobs: the secret comes from Vault, in the body ────────
// Production's and staging's pg_cron jobs call /system/run (and clever-api) with
// SCHEDULER_SECRET. On Nov 8 2026 the live jobs had drifted from the repo: some
// carried a secret in their own text (pg_cron copies a job's text into
// cron.job_run_details on every run), one asked Vault for a name that does not
// exist, staging's put it in the web address (refused since FD-AUD16, Jul 12),
// and one was an unfilled template that failed daily. The two apply packs bring
// both projects to supabase/ops/schedule-presence-cron.sql. The SQL can't run
// here (no pg_cron, pg_net or vault), so this pins what keeps it safe to paste
// and what made the live jobs wrong.
//   deno run --allow-read tests/presence/cron_jobs_sql_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const PROD = 'qksstlqzbhesadrrofgn';
const STAGING = 'wjlpursnwbmlcdwbeowv';
const VAULT_READ = "(select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret')";

const files = {
  prod: 'docs/presence/APPLY-cron-vault-prod.sql',
  staging: 'docs/presence/APPLY-cron-vault-staging.sql',
  ops: 'supabase/ops/schedule-presence-cron.sql',
  legacy: '02-schedule-cron.sql',
};
const sql = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, read(p)]));
const code = Object.fromEntries(Object.entries(sql).map(([k, s]) => [k, s.replace(/--[^\n]*/g, '')]));

// cron.schedule('name', 'schedule', $tag$ command $tag$) in any of its spellings
const jobsIn = (c) => [...c.matchAll(/cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*\$(\w*)\$([\s\S]*?)\$\3\$\s*\)/g)]
  .map((m) => ({ name: m[1], schedule: m[2], cmd: m[4] }));
const jobs = Object.fromEntries(Object.entries(code).map(([k, c]) => [k, jobsIn(c)]));
const byName = (k) => Object.fromEntries(jobs[k].map((j) => [j.name, j]));
const urlsIn = (c) => [...c.matchAll(/url\s*:=\s*'([^']*)'/g)].map((m) => m[1]);
// everything after the change block: the read-only verify
const verifyOf = (c, tag) => c.slice(c.lastIndexOf(`${tag};`) + tag.length + 1);

// ═══ 1. no secret travels in a job's text or in an address ═══
for (const [k, s] of Object.entries(sql)) {
  const long = (s.match(/[A-Za-z0-9_+=-]{26,}/g) || []).filter((t) => /[A-Za-z0-9]/.test(t));   // ==== rules aren't secrets
  ok(`${files[k]}: no secret-looking literal`, long.length === 0, long.map((t) => `${t.length} chars`).join(', '));
  ok(`${files[k]}: no "secret":"..." literal`, !/"secret"\s*:\s*"/.test(code[k]));
  ok(`${files[k]}: no address carries a query or a secret`, urlsIn(code[k]).length > 0 && urlsIn(code[k]).every((u) => !u.includes('?') && !/secret/i.test(u)));
  ok(`${files[k]}: every job sends the Vault entry in the body`, jobs[k].length > 0 && jobs[k].every((j) =>
    j.cmd.includes(`'secret', ${VAULT_READ}`) && /body\s*:=\s*jsonb_build_object\(/.test(j.cmd) && !/secret=/i.test(j.cmd)));
  ok(`${files[k]}: the only 'secret' keys are Vault reads`, (code[k].match(/'secret',/g) || []).length === (code[k].split(`'secret', ${VAULT_READ}`).length - 1));
  ok(`${files[k]}: ASCII only (pastes cleanly)`, [...s].every((c) => c.codePointAt(0) < 128));
}

// ═══ 2. production: the jobs Eric chose on Nov 8 2026 ═══
const prod = byName('prod');
ok('prod: exactly presence-cycle, presence_gsc_sync, presence_ga4_sync, nightly-data-sync',
  JSON.stringify(Object.keys(prod).sort()) === JSON.stringify(['nightly-data-sync', 'presence-cycle', 'presence_ga4_sync', 'presence_gsc_sync']));
ok('prod: the 15-minute tick keeps its name and timing', prod['presence-cycle']?.schedule === '*/15 * * * *' && /'task', 'cycle'/.test(prod['presence-cycle'].cmd));
ok('prod: Search Console daily 07:00 UTC (new)', prod['presence_gsc_sync']?.schedule === '0 7 * * *' && /'task', 'gsc_sync'/.test(prod['presence_gsc_sync'].cmd));
ok('prod: GA4 daily 07:30 UTC, now reading a Vault name that exists', prod['presence_ga4_sync']?.schedule === '30 7 * * *' && /'task', 'ga4_sync'/.test(prod['presence_ga4_sync'].cmd) && !/name = 'scheduler_secret'/.test(code.prod));
ok('prod: nightly-data-sync keeps its time and clever-api call', prod['nightly-data-sync']?.schedule === '0 8 * * *' && /\/functions\/v1\/clever-api'/.test(prod['nightly-data-sync'].cmd) && /'type', 'run_scheduled_jobs'/.test(prod['nightly-data-sync'].cmd));
// The switch is set explicitly: cron.schedule keeps it today, but a pg_cron
// that reset it would turn client email back on with a re-run.
ok('prod: nightly-data-sync is switched off when converted (its first night back would send what piled up)',
  /jid := cron\.schedule\('nightly-data-sync'/.test(code.prod) &&
  /perform cron\.alter_job\(job_id := jid,\s+active := case when nightly_was_on_vault then coalesce\(nightly_was_active, false\) else false end\);/.test(code.prod));
ok('prod: ...and a re-run leaves that switch as it was', /nightly_was_on_vault := exists \(select 1 from cron\.job\s+where jobname = 'nightly-data-sync'\s+and command like '%vault\.decrypted_secrets%'\);\s+nightly_was_active := \(select active from cron\.job where jobname = 'nightly-data-sync'\);/.test(code.prod)
  && code.prod.indexOf('nightly_was_active :=') < code.prod.indexOf("cron.schedule('nightly-data-sync'"));
ok('prod: the unfilled template job and the old repo names are removed', /jobname in \('dds_product_intelligence', 'presence_ops_cycle', 'presence_ops_retry', 'presence_ops_coach'\) loop\s+perform cron\.unschedule\(j\.jobname\);/.test(code.prod));
ok('prod: no retry or coach job (Eric, Nov 8 2026)', !/'task', '(retry|coach)'/.test(code.prod));
ok('prod: every address is production\'s', urlsIn(code.prod).every((u) => u.startsWith(`https://${PROD}.supabase.co/functions/v1/`)) && !code.prod.includes(STAGING));

// ═══ 3. production: Vault gets the LIVE secret, from the job that works ═══
// The Vault entry dated from Jul 8; SCHEDULER_SECRET changed on Jul 13. Pointing
// the jobs at a stale entry would stop the 15-minute tick, so the pack copies
// the value presence-cycle sends today, inside the database.
ok('prod: the live secret is read from presence-cycle\'s own command', /live := substring\(\(select command from cron\.job where jobname = 'presence-cycle'\)\s+from '"secret"\\s\*:\\s\*"\(\[\^"\]\+\)"'\);/.test(code.prod));
ok('prod: ...and stored in presence_scheduler_secret (created, or updated only when different)',
  /perform vault\.create_secret\(live, 'presence_scheduler_secret',/.test(code.prod) && /elsif vault_val is distinct from live then\s+perform vault\.update_secret\(vault_id, live\);/.test(code.prod));
ok('prod: a placeholder or short value is refused, not stored', /if length\(live\) < 16 or live like '<%' then\s+raise exception/.test(code.prod));
ok('prod: a re-run (job already on Vault) takes the value from Vault', /else\s+live := vault_val;/.test(code.prod));
const prodBlock = /do \$pack\$([\s\S]*?)\$pack\$;/.exec(code.prod)?.[1] ?? '';
ok('prod: every change is inside ONE do block, so a failed check changes nothing',
  prodBlock.length > 1000 && ['cron.schedule(', 'cron.unschedule(', 'vault.create_secret(', 'vault.update_secret(', 'delete from', 'cron.alter_job('].every((s) =>
    (code.prod.split(s).length - 1) === (prodBlock.split(s).length - 1) && prodBlock.includes(s)));
ok('prod: the checks come before the first change', prodBlock.indexOf('does not carry a real secret') < prodBlock.indexOf('cron.schedule(') && prodBlock.indexOf('belongs to another database user') < prodBlock.indexOf('vault.create_secret('));
ok('prod: old run history holding a secret is deleted, nothing else', /delete from cron\.job_run_details where position\(live in command\) > 0;/.test(prodBlock) && /if length\(old_nightly\) >= 16 then\s+delete from cron\.job_run_details where position\(old_nightly in command\) > 0;/.test(prodBlock) && (prodBlock.match(/delete from/g) || []).length === 2);

// ═══ 4. staging: the address bug, and nothing switched on by surprise ═══
const staging = byName('staging');
ok('staging: only presence-cycle, every 15 minutes, task cycle', JSON.stringify(Object.keys(staging)) === '["presence-cycle"]' && staging['presence-cycle'].schedule === '*/15 * * * *' && /'task', 'cycle'/.test(staging['presence-cycle'].cmd));
ok('staging: every address is staging\'s', urlsIn(code.staging).every((u) => u.startsWith(`https://${STAGING}.supabase.co/functions/v1/`)) && !code.staging.includes(PROD));
ok('staging: switched off when converted, a re-run leaves the switch as it was',
  /perform cron\.alter_job\(job_id := jid,\s+active := case when was_on_vault_body then coalesce\(was_active, false\) else false end\);/.test(code.staging)
  && /was_on_vault_body := exists/.test(code.staging) && code.staging.indexOf('was_active :=') < code.staging.indexOf("cron.schedule('presence-cycle'"));
ok('staging: stops if its Vault entry is missing', /if not exists \(select 1 from vault\.secrets where name = 'presence_scheduler_secret'\) then\s+raise exception/.test(code.staging));
ok('staging: leaves the watchdog to watchdog-cron.sql', !/presence[-_]watchdog/.test(code.staging) && !/vault\.(create|update)_secret/.test(code.staging) && !/delete from/.test(code.staging));

// ═══ 5. the read-only verify shows no secret values ═══
for (const [k, tag] of [['prod', '$pack$'], ['staging', '$pack$'], ['ops', '$setup$']]) {
  const v = verifyOf(code[k], tag);
  const cols = /select([\s\S]*?)\bfrom cron\.job j/.exec(v)?.[1] ?? '';
  const outside = cols.replace(/position\([^()]*\)/g, '');
  ok(`${files[k]}: the verify reads booleans and names, never a value`, cols.length > 0 && /as reads_vault/.test(cols) && /as nothing_in_address/.test(cols) && /as no_secret_in_job/.test(cols) && !/decrypted_secret(?!s)/.test(outside));
}
ok('prod: the verify also counts run history still holding the secret (expect 0)', /as old_runs_with_secret/.test(verifyOf(code.prod, '$pack$')));

// ═══ 6. the repo's schedule matches the live names ═══
const ops = byName('ops');
ok('ops: the live job names, not presence_ops_*', JSON.stringify(Object.keys(ops).sort()) === JSON.stringify(['presence-cycle', 'presence_ga4_sync', 'presence_gsc_sync']));
ok('ops: same timing as production', ['presence-cycle', 'presence_gsc_sync', 'presence_ga4_sync'].every((n) => ops[n]?.schedule === prod[n]?.schedule));
ok('ops: same command as production, apart from the project ref', ['presence-cycle', 'presence_gsc_sync', 'presence_ga4_sync'].every((n) => ops[n]?.cmd.replaceAll('<PROJECT_REF>', PROD) === prod[n]?.cmd));
ok('ops: stops if <PROJECT_REF> was not replaced (the template trap behind dds_product_intelligence)', /if position\('<' in 'https:\/\/<PROJECT_REF>\.supabase\.co'\) > 0 then\s+raise exception/.test(code.ops));
ok('ops: stops if the Vault entry is missing', /if not exists \(select 1 from vault\.secrets where name = 'presence_scheduler_secret'\) then\s+raise exception/.test(code.ops));
ok('ops: removes the old presence_ops_* names so a second tick can\'t run', /jobname in \('presence_ops_cycle', 'presence_ops_retry', 'presence_ops_coach'\) loop\s+perform cron\.unschedule\(j\.jobname\);/.test(code.ops));
ok('ops: one Vault name everywhere (the live projects have presence_scheduler_secret, not scheduler_secret)', Object.values(code).every((c) => !/name = 'scheduler_secret'/.test(c)));

// ═══ 7. the legacy clever-api job ═══
const legacy = byName('legacy');
ok('02: the live name and time (nightly-data-sync, 08:00 UTC), old name removed', JSON.stringify(Object.keys(legacy)) === '["nightly-data-sync"]' && legacy['nightly-data-sync'].schedule === '0 8 * * *' && /cron\.unschedule\('dds_scheduled_jobs'\)/.test(code.legacy));
ok('02: no placeholder to paste a secret into', !/YOUR_SCHEDULER_SECRET/.test(sql.legacy));
ok('02: says running it switches the job on and what that sends', /RUNNING THIS FILE SWITCHES THE JOB ON/.test(sql.legacy) && /piled up/.test(sql.legacy));

// ═══ 8. the channels used are the ones the server reads ═══
const system = read('supabase/functions/presence/routes/system.ts');
const clever = read('supabase/functions/clever-api/index.ts');
ok('/system/run reads the body secret (or the x-system-secret header), never the address', /typeof body\.secret === 'string' \? body\.secret : ''/.test(system) && /req\.headers\.get\('x-system-secret'\)/.test(system) && !/searchParams/.test(system));
ok('/system/run knows the tasks the jobs send', ['gsc_sync', 'ga4_sync'].every((t) => system.includes(`task === '${t}'`)) && /String\(body\?\.task \|\| 'cycle'\)/.test(system));
ok('clever-api run_scheduled_jobs reads the body secret', /if \(type === 'run_scheduled_jobs'\) \{\s+if \(!SCHEDULER_SECRET \|\| body\.secret !== SCHEDULER_SECRET\)/.test(clever));

// ═══ 9. the docs say where the jobs get the secret ═══
for (const p of ['docs/presence/ENV-AND-SECRETS.md', 'docs/SECRETS-INVENTORY.md']) {
  const d = read(p);
  ok(`${p}: names the Vault entry, no longer "embedded in the pg_cron job body"`, d.includes('presence_scheduler_secret') && !/embedded in the pg_cron job body/.test(d));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ CRON JOBS SQL: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
