-- ── Presence scheduled operations — pg_cron wiring (L2) ─────────────────────
-- Manual/ops SQL (like 01-add-scheduler-columns.sql / 02-schedule-cron.sql), NOT
-- a numbered migration. Run once per project in the Supabase SQL Editor, after
-- replacing the two placeholders below. It makes the platform keep observing,
-- and recover from failures, with no operator present.
--
-- Replace before running:
--   <PROJECT_REF>      staging: wjlpursnwbmlcdwbeowv   prod: qksstlqzbhesadrrofgn
--   <SCHEDULER_SECRET> the SCHEDULER_SECRET edge-function secret for that project
--
-- Cadence (tune freely — cadence is the scaling knob; each run processes a
-- bounded batch of least-recently-updated sites):
--   • observation cycle  — every 6 hours (evidence→judgment→recommendation→moments)
--   • failure retry       — hourly (drains presence_scheduled_runs failures under max_attempts)
--   • coach sweep         — weekly (Mondays 15:00 UTC)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- idempotent re-provisioning: drop prior schedules of the same names
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname in ('presence_ops_cycle','presence_ops_retry','presence_ops_coach') loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

-- observation cycle — every 6 hours
select cron.schedule('presence_ops_cycle', '0 */6 * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := '{"secret":"<SCHEDULER_SECRET>","task":"cycle"}'::jsonb
  );
$$);

-- failure retry — hourly
select cron.schedule('presence_ops_retry', '30 * * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := '{"secret":"<SCHEDULER_SECRET>","task":"retry"}'::jsonb
  );
$$);

-- coach sweep — weekly, Mondays 15:00 UTC
select cron.schedule('presence_ops_coach', '0 15 * * 1', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/presence/system/run',
    headers:= '{"Content-Type":"application/json"}'::jsonb,
    body   := '{"secret":"<SCHEDULER_SECRET>","task":"coach"}'::jsonb
  );
$$);

-- to inspect:   select jobname, schedule, active from cron.job where jobname like 'presence_ops_%';
-- to remove:    select cron.unschedule('presence_ops_cycle'); (etc.)
