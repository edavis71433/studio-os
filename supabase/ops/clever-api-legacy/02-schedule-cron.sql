-- LEGACY (clever-api daily scheduler). The LIVE scheduler is the presence
-- 15-min pg_cron tick: see supabase/ops/schedule-presence-cron.sql and
-- docs/presence/OPERATIONS.md. Kept for the clever-api surfaces it still
-- serves; retires wholesale with clever-api (P2-G).
-- ============================================================================
--  CRON: run the clever-api scheduler once a day (job "nightly-data-sync")
--  Run in Supabase -> SQL Editor AFTER you have:
--    1. Run 01-add-scheduler-columns.sql
--    2. Deployed the Edge Function with the run_scheduled_jobs route
--    3. Set the SCHEDULER_SECRET Edge Function secret (and GOOGLE_REVIEW_LINK if you have it)
--    4. Stored the same value in Vault: Integrations -> Vault -> Add new
--       secret, name presence_scheduler_secret (the presence jobs read it too)
-- ============================================================================
-- WHAT THIS DOES
--   Uses Supabase's built-in pg_cron + pg_net to call your Edge Function once a day.
--   The function decides who needs a survey/review email or a content nudge, sends it,
--   and stamps the row so nothing is ever sent twice.
--   The job reads the secret from Vault each time it runs and sends it in the
--   request body. The value never sits in the job's text.
--
-- RUNNING THIS FILE SWITCHES THE JOB ON. On production it has been switched
-- off since Nov 8 2026 (docs/presence/APPLY-cron-vault-prod.sql): it sent an
-- old secret and was refused every night from mid-July, so the first night
-- back on may send the client emails that piled up since then. Turn it on
-- only when you mean that (or with the Active switch in Integrations -> Cron).
--
-- BEFORE RUNNING: replace <YOUR_PROJECT_REF> below with the project's ref
-- (production: qksstlqzbhesadrrofgn).
-- ============================================================================

-- Enable the extensions (safe if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove the job's old name so re-running is safe.
select cron.unschedule('dds_scheduled_jobs') where exists (
  select 1 from cron.job where jobname = 'dds_scheduled_jobs'
);

-- Schedule: every day at 08:00 UTC (= midnight Pacific standard / 1am Pacific daylight).
-- Running this again replaces the job of the same name. Format: min hour * * *
select cron.schedule(
  'nightly-data-sync',
  '0 8 * * *',
  $$
  select net.http_post(
    url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/clever-api',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
                 'type', 'run_scheduled_jobs',
                 'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret'))
  );
  $$
);

-- Useful checks:
-- See the scheduled job:
--   select jobname, schedule, active from cron.job where jobname = 'nightly-data-sync';
-- See recent runs (did it fire, did it error):
--   select status, start_time, return_message from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'nightly-data-sync')
--    order by start_time desc limit 10;
-- The function's own answer (200, or 401 when the secret is wrong) is in
-- Edge Functions -> clever-api -> Logs, at 08:00 UTC.
-- Run it once right now instead of waiting (this SENDS whatever is due):
--   select net.http_post(
--     url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/clever-api',
--     headers := '{"Content-Type":"application/json"}'::jsonb,
--     body    := jsonb_build_object('type', 'run_scheduled_jobs',
--                  'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'presence_scheduler_secret')));
