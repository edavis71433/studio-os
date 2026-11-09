-- ===========================================================================
--  APPLY PACK - scheduled jobs read their secret from Vault  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE in Supabase -> SQL Editor, the PRODUCTION project
--  (qksstlqzbhesadrrofgn). No deploy needed before or after. Safe to re-run.
--  Nothing in this file, and nothing it prints, contains a secret value.
--
--  What it does, as one step (if any check fails, nothing changes):
--   1. Copies the secret that the working 15-minute job sends today into the
--      Vault entry presence_scheduler_secret, inside the database, so nobody
--      has to copy it. That entry was made on Jul 8 2026 and the secret
--      changed on Jul 13.
--   2. Rebuilds the jobs so each one reads that Vault entry when it runs and
--      sends it in the request body, never in the web address:
--        presence-cycle      every 15 minutes   same timing as before
--        presence_gsc_sync   daily 07:00 UTC    NEW: Search Console numbers
--        presence_ga4_sync   daily 07:30 UTC    it asked Vault for a name that
--                                               does not exist, so it was
--                                               refused every day
--        nightly-data-sync   daily 08:00 UTC    SWITCHED OFF, see below
--   3. Removes dds_product_intelligence, an unfilled template that failed
--      every day and never ran (and the old repo names presence_ops_cycle,
--      presence_ops_retry and presence_ops_coach, if any exist).
--   4. Deletes the old run-history rows (cron.job_run_details) whose stored
--      command still holds a secret. All other history stays.
--
--  nightly-data-sync is clever-api's nightly run (post-launch survey and
--  review asks, content-due nudges, old-style invoice reminders, payment
--  thank-yous, anniversary heads-ups). It sent an old secret and has been
--  refused every night since mid-July, so it stays off. Turning it on
--  (Integrations -> Cron -> nightly-data-sync -> Active) makes it run that
--  night, and client emails that piled up since July may go out. A re-run of
--  this pack leaves that switch as it is.
--
--  The Supabase editor may ask you to confirm because of the delete in step
--  4. That is expected: confirm and run.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $pack$
declare
  live text;            -- the secret production accepts: what presence-cycle sends today
  old_nightly text;     -- the old secret nightly-data-sync sends
  nightly_was_on_vault boolean;
  nightly_was_active boolean;
  vault_id uuid;
  vault_val text;
  jid bigint;
  j record;
begin
  if exists (select 1 from cron.job
              where jobname in ('presence-cycle', 'presence_gsc_sync', 'presence_ga4_sync', 'nightly-data-sync',
                                'dds_product_intelligence', 'presence_ops_cycle', 'presence_ops_retry', 'presence_ops_coach')
                and username <> current_user) then
    raise exception 'one of these jobs belongs to another database user; nothing changed';
  end if;

  -- 1. The live secret, taken from the job that works today. On a re-run that
  --    job already reads Vault, and Vault already holds the live secret.
  live := substring((select command from cron.job where jobname = 'presence-cycle')
                    from '"secret"\s*:\s*"([^"]+)"');
  select id, decrypted_secret into vault_id, vault_val
    from vault.decrypted_secrets where name = 'presence_scheduler_secret';
  if live is not null then
    if length(live) < 16 or live like '<%' then
      raise exception 'presence-cycle does not carry a real secret; nothing changed';
    end if;
    if vault_id is null then
      perform vault.create_secret(live, 'presence_scheduler_secret',
        'SCHEDULER_SECRET, read by the scheduled jobs when they run');
    elsif vault_val is distinct from live then
      perform vault.update_secret(vault_id, live);
    end if;
  elsif vault_id is null then
    raise exception 'neither presence-cycle nor Vault holds the scheduler secret; nothing changed';
  else
    live := vault_val;
  end if;

  old_nightly := substring((select command from cron.job where jobname = 'nightly-data-sync')
                           from '"secret"\s*:\s*"([^"]+)"');
  nightly_was_on_vault := exists (select 1 from cron.job
                                   where jobname = 'nightly-data-sync'
                                     and command like '%vault.decrypted_secrets%');
  nightly_was_active := (select active from cron.job where jobname = 'nightly-data-sync');

  -- 2. The jobs. cron.schedule replaces a job of the same name in place.
  perform cron.schedule('presence-cycle', '*/15 * * * *', $job$
    select net.http_post(
      url     := 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'cycle'))
  $job$);

  perform cron.schedule('presence_gsc_sync', '0 7 * * *', $job$
    select net.http_post(
      url     := 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'gsc_sync'))
  $job$);

  perform cron.schedule('presence_ga4_sync', '30 7 * * *', $job$
    select net.http_post(
      url     := 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'ga4_sync'))
  $job$);

  jid := cron.schedule('nightly-data-sync', '0 8 * * *', $job$
    select net.http_post(
      url     := 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/clever-api',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'type', 'run_scheduled_jobs',
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret')))
  $job$);
  -- Off when it still had the old secret (its first night back would send what
  -- piled up). On a re-run its switch stays as Eric left it.
  perform cron.alter_job(job_id := jid,
    active := case when nightly_was_on_vault then coalesce(nightly_was_active, false) else false end);

  -- 3. Jobs that should not exist.
  for j in select jobname from cron.job
            where jobname in ('dds_product_intelligence', 'presence_ops_cycle', 'presence_ops_retry', 'presence_ops_coach') loop
    perform cron.unschedule(j.jobname);
  end loop;

  -- 4. Old run history that still holds a secret in its stored command.
  delete from cron.job_run_details where position(live in command) > 0;
  if length(old_nightly) >= 16 then
    delete from cron.job_run_details where position(old_nightly in command) > 0;
  end if;
end
$pack$;

-- Verify (expect exactly these four rows, and it shows no secret values):
--   jobname           | schedule     | active | reads_vault | nothing_in_address | no_secret_in_job | old_runs_with_secret
--   nightly-data-sync | 0 8 * * *    | false  | true        | true               | true             | 0
--   presence-cycle    | */15 * * * * | true   | true        | true               | true             | 0
--   presence_ga4_sync | 30 7 * * *   | true   | true        | true               | true             | 0
--   presence_gsc_sync | 0 7 * * *    | true   | true        | true               | true             | 0
select j.jobname,
       j.schedule,
       j.active,
       position('vault.decrypted_secrets where name = ''presence_scheduler_secret''' in j.command) > 0 as reads_vault,
       position('secret=' in j.command) = 0 as nothing_in_address,
       (j.command !~ '"secret"\s*:' and position(v.decrypted_secret in j.command) = 0) as no_secret_in_job,
       (select count(*) from cron.job_run_details d where position(v.decrypted_secret in d.command) > 0) as old_runs_with_secret
  from cron.job j
  cross join vault.decrypted_secrets v
 where v.name = 'presence_scheduler_secret'
 order by j.jobname;
