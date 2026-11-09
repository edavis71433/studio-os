-- ===========================================================================
--  APPLY PACK - scheduled jobs read their secret from Vault  (owner-apply, staging)
-- ===========================================================================
--  Run this ONCE in Supabase -> SQL Editor, the STAGING project
--  (wjlpursnwbmlcdwbeowv). No deploy needed before or after. Safe to re-run.
--  Nothing in this file, and nothing it prints, contains a secret value.
--
--  What it fixes:
--   Staging's presence-cycle job (every 15 minutes) put its secret in the web
--   address (?secret=...). /system/* has refused that since Jul 12 2026
--   (FD-AUD16), so staging's scheduler has done nothing since. This rebuilds
--   the job like production's: it reads the Vault entry
--   presence_scheduler_secret when it runs and sends it in the request body.
--
--  It stays SWITCHED OFF, so nothing changes yet: the job did nothing before
--  and does nothing now. Staging can send email, so once it is on, notices
--  that piled up on staging's data since July may go out. To turn it on:
--  Integrations -> Cron -> presence-cycle -> Active. A re-run of this pack
--  leaves that switch as it is.
--
--  It leaves the presence-watchdog job alone; supabase/ops/watchdog-cron.sql
--  covers that one.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $pack$
declare
  was_on_vault_body boolean;
  was_active boolean;
  jid bigint;
begin
  if not exists (select 1 from vault.secrets where name = 'presence_scheduler_secret') then
    raise exception 'staging Vault has no presence_scheduler_secret; nothing changed';
  end if;
  if exists (select 1 from cron.job where jobname = 'presence-cycle' and username <> current_user) then
    raise exception 'presence-cycle belongs to another database user; nothing changed';
  end if;

  was_on_vault_body := exists (select 1 from cron.job
                                where jobname = 'presence-cycle'
                                  and command like '%jsonb_build_object(%''secret''%vault.decrypted_secrets%');
  was_active := (select active from cron.job where jobname = 'presence-cycle');

  jid := cron.schedule('presence-cycle', '*/15 * * * *', $job$
    select net.http_post(
      url     := 'https://wjlpursnwbmlcdwbeowv.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'cycle'))
  $job$);
  -- Off when converted from the address form; on a re-run the switch stays as Eric left it.
  perform cron.alter_job(job_id := jid,
    active := case when was_on_vault_body then coalesce(was_active, false) else false end);
end
$pack$;

-- Verify (expect one row, and it shows no secret values):
--   jobname        | schedule     | active | reads_vault | nothing_in_address | no_secret_in_job
--   presence-cycle | */15 * * * * | false  | true        | true               | true
select j.jobname,
       j.schedule,
       j.active,
       position('vault.decrypted_secrets where name = ''presence_scheduler_secret''' in j.command) > 0 as reads_vault,
       position('secret=' in j.command) = 0 as nothing_in_address,
       (j.command !~ '"secret"\s*:' and position(v.decrypted_secret in j.command) = 0) as no_secret_in_job
  from cron.job j
  cross join vault.decrypted_secrets v
 where v.name = 'presence_scheduler_secret'
   and j.jobname = 'presence-cycle';
