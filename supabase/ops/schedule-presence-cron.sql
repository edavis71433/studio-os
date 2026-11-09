-- == Presence scheduled operations: pg_cron wiring (L2) ======================
-- Manual/ops SQL, NOT a numbered migration. It is the reproducible source for
-- the live schedule and is safe to re-run. To set up a project, replace every
-- <PROJECT_REF> below with its ref (the guard stops the run if one is left),
-- then run the whole file in that project's SQL Editor:
--   staging: wjlpursnwbmlcdwbeowv   production: qksstlqzbhesadrrofgn
-- The two live projects were brought to this shape in Nov 2026 by
-- docs/presence/APPLY-cron-vault-prod.sql and APPLY-cron-vault-staging.sql.
--
-- The secret. Every job reads the Vault entry presence_scheduler_secret (the
-- project's SCHEDULER_SECRET) when it runs and sends it in the request body.
-- The value is never in the job's text, so pg_cron never copies it into
-- cron.job or the run history (cron.job_run_details), and never in the web
-- address: /system/* refuses ?secret= (FD-AUD16), and addresses land in
-- access logs. Before the first run, once per project: Integrations -> Vault
-- -> Add new secret, name presence_scheduler_secret, value = the project's
-- SCHEDULER_SECRET. After a rotation of SCHEDULER_SECRET, update that entry
-- the same way (for production, also staging's watchdog_target_secret; see
-- watchdog-cron.sql).
--
-- The jobs (production, Nov 2026):
--   presence-cycle      */15 * * * *   the default tick: observation cycle +
--     scheduled publishes + reconcile + billing reconcile + lifecycle +
--     deletion + digest + domains + lead/deal/renewal/invoice/doc reminders +
--     retention + media/snapshot GC, one ledgered chain (routes/system.ts)
--   presence_gsc_sync   0 7 * * *      Search Console, daily (owner-gated on
--     the Google app; each site without a connection is skipped)
--   presence_ga4_sync   30 7 * * *     GA4, daily, offset from the Search
--     Console job; owner-gated the same way
-- Not scheduled (Eric, Nov 8 2026): the hourly failure retry (task 'retry')
-- and the weekly coach sweep (task 'coach'). /system/run still accepts both,
-- and the next 15-minute tick runs a failed site again anyway.
-- Staging runs presence-cycle only (switched off since Nov 2026), plus the
-- watchdog (watchdog-cron.sql). clever-api's legacy nightly job is
-- 02-schedule-cron.sql (nightly-data-sync, switched off on production).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $setup$
declare j record;
begin
  if position('<' in 'https://<PROJECT_REF>.supabase.co') > 0 then
    raise exception 'replace <PROJECT_REF> with this project''s ref first (it is in the editor''s web address); nothing changed';
  end if;
  if not exists (select 1 from vault.secrets where name = 'presence_scheduler_secret') then
    raise exception 'create the Vault entry presence_scheduler_secret first (see the top of this file); nothing changed';
  end if;

  -- names used by an older version of this file; a second tick job would run every sweep twice
  for j in select jobname from cron.job
            where jobname in ('presence_ops_cycle', 'presence_ops_retry', 'presence_ops_coach') loop
    perform cron.unschedule(j.jobname);
  end loop;

  -- cron.schedule replaces a job of the same name in place and keeps its on/off switch
  perform cron.schedule('presence-cycle', '*/15 * * * *', $job$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'cycle'))
  $job$);

  -- AN-3.1: GSC data is 1 to 2 days behind and the quota is generous, so daily is plenty
  perform cron.schedule('presence_gsc_sync', '0 7 * * *', $job$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'gsc_sync'))
  $job$);

  -- monthly signal totals; 30 minutes after the GSC job so the two Google reads never share an invocation window
  perform cron.schedule('presence_ga4_sync', '30 7 * * *', $job$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
                   'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'),
                   'task', 'ga4_sync'))
  $job$);
end
$setup$;

-- Verify (expect the three jobs, every check true; shows no secret values):
select j.jobname,
       j.schedule,
       j.active,
       position('vault.decrypted_secrets where name = ''presence_scheduler_secret''' in j.command) > 0 as reads_vault,
       position('secret=' in j.command) = 0 as nothing_in_address,
       (j.command !~ '"secret"\s*:' and position(v.decrypted_secret in j.command) = 0) as no_secret_in_job
  from cron.job j
  cross join vault.decrypted_secrets v
 where v.name = 'presence_scheduler_secret'
   and j.jobname in ('presence-cycle', 'presence_gsc_sync', 'presence_ga4_sync')
 order by j.jobname;

-- == SPLIT MODE (when the fleet outgrows the single tick, ~30-50 sites) ======
-- The single 15-minute tick runs observation + revenue + hygiene in ONE
-- invocation; as sites grow, the observation cycle can eat the wall clock and
-- starve the rest. Split mode gives each group its own invocation and cadence.
-- To switch: select cron.unschedule('presence-cycle'); then schedule the three
-- groups the same way as the jobs above (same url, headers and body, with
-- 'task' set to the group), and change presence-cycle in this file to them,
-- or a re-run brings the single tick back next to them:
--   presence_ops_observe   */15 * * * *    task 'observe'
--   presence_ops_revenue   7,37 * * * *    task 'revenue'
--   presence_ops_hygiene   52 * * * *      task 'hygiene'

-- to inspect:  select jobname, schedule, active from cron.job order by jobname;
-- to remove:   select cron.unschedule('presence-cycle');  (etc.)
