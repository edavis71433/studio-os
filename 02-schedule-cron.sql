-- ============================================================================
--  CRON: run the scheduler once a day
--  Run in Supabase -> SQL Editor AFTER you have:
--    1. Run 01-add-scheduler-columns.sql
--    2. Deployed the Edge Function with the run_scheduled_jobs route
--    3. Set the SCHEDULER_SECRET Edge Function secret (and GOOGLE_REVIEW_LINK if you have it)
-- ============================================================================
-- WHAT THIS DOES
--   Uses Supabase's built-in pg_cron + pg_net to call your Edge Function once a day.
--   The function decides who needs a survey/review email or a content nudge, sends it,
--   and stamps the row so nothing is ever sent twice.
--
-- BEFORE RUNNING: replace the two placeholders below:
--   <YOUR_PROJECT_REF>   -> qksstlqzbhesadrrofgn  (your Supabase project ref)
--   <YOUR_SCHEDULER_SECRET> -> the same value you set as the SCHEDULER_SECRET secret
-- ============================================================================

-- Enable the extensions (safe if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of this job so re-running is safe.
select cron.unschedule('dds_scheduled_jobs') where exists (
  select 1 from cron.job where jobname = 'dds_scheduled_jobs'
);

-- Schedule: every day at 16:00 UTC (= 9am Pacific standard / 8am Pacific daylight).
-- Adjust the cron expression if you want a different time. Format: min hour * * *
select cron.schedule(
  'dds_scheduled_jobs',
  '0 16 * * *',
  $$
  select net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/clever-api',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"type": "run_scheduled_jobs", "secret": "<YOUR_SCHEDULER_SECRET>"}'::jsonb
  );
  $$
);

-- ── Useful checks ──
-- See the scheduled job:
--   select * from cron.job where jobname = 'dds_scheduled_jobs';
-- See recent runs (did it fire, did it error):
--   select * from cron.job_run_details where jobname = 'dds_scheduled_jobs' order by start_time desc limit 10;
-- Run it once right now to test (instead of waiting for 16:00 UTC):
--   select net.http_post(
--     url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/clever-api',
--     headers := '{"Content-Type":"application/json"}'::jsonb,
--     body := '{"type":"run_scheduled_jobs","secret":"<YOUR_SCHEDULER_SECRET>"}'::jsonb
--   );
