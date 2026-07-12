-- ── Presence scheduled operations — pg_cron wiring (L2) ─────────────────────
-- Manual/ops SQL (like 01-add-scheduler-columns.sql / 02-schedule-cron.sql), NOT
-- a numbered migration. Run once per project in the Supabase SQL Editor. This is
-- the REPRODUCIBLE source for the live schedule (Phase J r2 activated it with the
-- secret in Vault; this file matches that live shape, so a fresh project can be
-- rebuilt from the repo alone).
--
-- Prereq (once per project): store the scheduler secret in Vault —
--   select vault.create_secret('<SCHEDULER_SECRET>', 'scheduler_secret');
-- Replace before running:
--   <PROJECT_REF>  staging: wjlpursnwbmlcdwbeowv   prod: qksstlqzbhesadrrofgn
--
-- LIVE CADENCE (activated Jul 2026):
--   • default tick — every 15 minutes (observation cycle + scheduled publishes +
--     reconcile + billing reconcile + lifecycle + deletion + digest + domains +
--     lead/deal/renewal/invoice/doc reminders + retention + media/snapshot GC —
--     one ledgered chain; see routes/system.ts)
--   • failure retry — hourly (drains presence_scheduled_runs failures under max_attempts)
--   • coach sweep — weekly (Mondays 15:00 UTC)
--   • GSC sync — daily 07:00 UTC (owner-gated on Google OAuth secrets)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- idempotent re-provisioning: drop prior schedules of the same names
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname in ('presence_ops_cycle','presence_ops_retry','presence_ops_coach','presence_gsc_sync') loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

-- the default tick — every 15 minutes
select cron.schedule('presence_ops_cycle', '*/15 * * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret'), 'task', 'cycle')
  );
$$);

-- failure retry — hourly
select cron.schedule('presence_ops_retry', '30 * * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret'), 'task', 'retry')
  );
$$);

-- coach sweep — weekly, Mondays 15:00 UTC
select cron.schedule('presence_ops_coach', '0 15 * * 1', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret'), 'task', 'coach')
  );
$$);

-- AN-3.1: Search Console sync — daily 07:00 UTC (GSC data is ~1–2 days behind + a
-- generous daily quota; monthly totals don't need more than a daily refresh)
select cron.schedule('presence_gsc_sync', '0 7 * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret'), 'task', 'gsc_sync')
  );
$$);
-- OWNER-GATED: this job does nothing until the Google OAuth app + CONNECTED_GOOGLE_
-- SEARCH_CONSOLE_CLIENT_ID/_SECRET + CONNECTION_ENC_KEY are set and at least one
-- customer has connected Search Console (each unconnected site is skipped).

-- to inspect:   select jobname, schedule, active from cron.job where jobname like 'presence_%';
-- to remove:    select cron.unschedule('presence_ops_cycle'); (etc.)
