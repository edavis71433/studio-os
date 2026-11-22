-- ===========================================================================
--  APPLY PACK - the keep-awake job  (owner-apply, prod; builder item 404)
-- ===========================================================================
--  Run this ONCE in Supabase -> SQL Editor, the PRODUCTION project
--  (qksstlqzbhesadrrofgn; the top bar says davis-digital-studio), AFTER the
--  deploy.yml run that ships builder item 404 (the 'ping' task; before it the job
--  gets a harmless "run_failed" answer every 4 minutes). Safe to re-run:
--  cron.schedule replaces a job of the same name. Nothing in this file, and nothing
--  it prints, contains a secret value: the job reads the Vault entry
--  presence_scheduler_secret when it runs, like the other jobs.
--
--  What it does: adds presence-keep-awake, every 4 minutes, a POST to
--  /system/run with task 'ping' that reads and writes nothing, asking (x-region)
--  for the worker beside the database. The Oregon worker started cold 123 times a
--  day (750 ms at the middle, 1.66 s for one in ten); the first click after a pause
--  paid that. Cost: about 10,800 calls a month against the 2,000,000 the Pro plan
--  includes, so nothing. It keeps one worker warm; two people arriving in the same
--  second can still meet a cold one. Read the function logs for a day, then decide
--  whether to keep it (Nov 22 review, file 14, finding 6: medium confidence).
--
--  The same job is in supabase/ops/schedule-presence-cron.sql, so a re-run of that
--  file keeps it.
--
--  Rollback:  select cron.unschedule('presence-keep-awake');
-- ===========================================================================

do $pack$
begin
  if current_database() is null or not exists (select 1 from vault.secrets where name = 'presence_scheduler_secret') then
    raise exception 'no Vault entry presence_scheduler_secret here: is this the production project? nothing changed';
  end if;
  if not exists (select 1 from cron.job where jobname = 'presence-cycle' and command like '%qksstlqzbhesadrrofgn%') then
    raise exception 'presence-cycle does not point at production here: is this the production project? nothing changed';
  end if;

  perform cron.schedule('presence-keep-awake', '*/4 * * * *', $job$
    select net.http_post(
      url     := 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json","x-region":"us-west-2"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'ping'))
  $job$);
end
$pack$;

-- Verify (expect one row: */4 * * * *, active true, reads_vault true, nothing_in_address true):
select j.jobname, j.schedule, j.active,
       position('vault.decrypted_secrets where name = ''presence_scheduler_secret''' in j.command) > 0 as reads_vault,
       position('secret=' in j.command) = 0 as nothing_in_address
  from cron.job j
 where j.jobname = 'presence-keep-awake';
-- ...and after ten minutes, the last answers (expect status 200 and {"data":{"ok":true,"awake":true}}):
-- select r.status_code, left(r.content::text, 60), r.created
--   from net._http_response r order by r.id desc limit 3;
