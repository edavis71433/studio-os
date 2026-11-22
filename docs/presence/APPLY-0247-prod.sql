-- ===========================================================================
--  APPLY PACK - migration 0247  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 403. IDEMPOTENT ("create or
--  replace"), read-only (the function only counts), safe to re-run.
--
--  Why: builder list item 403. The 5-minute alarm check (/system/health, called by
--  the staging watchdog from Ohio) made 16 or 17 reads, 6 or 7 one after another and
--  three twice, at about 200 ms each across the country: 2.8 s a check, 288 times a
--  day. This function answers every count the check and the Admin Health Center need
--  in ONE trip. If the deploy goes first, nothing breaks: the check reads the same
--  counts as one wave of reads until the function exists.
--
--  The other half, on STAGING (wjlpursnwbmlcdwbeowv): re-run the whole of
--  supabase/ops/watchdog-cron.sql in its SQL Editor (it is idempotent). The probe it
--  sends now carries the x-region: us-west-2 header, so the check runs beside the
--  database instead of in Ohio. Nothing else in that file changed.
--
--  Rollback (only if ever needed):
--    drop function if exists public.presence_health_counts();
--
--  Covers: supabase/migrations/0247_health_counts.sql
-- ===========================================================================

create or replace function public.presence_health_counts()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'active_sites', (select count(*) from public.presence_entitlements where product = 'presence' and status = 'active'),
    'ent_paused',   (select count(*) from public.presence_entitlements where product = 'presence' and status = 'paused'),
    'ent_lapsed',   (select count(*) from public.presence_entitlements where product = 'presence' and status = 'lapsed'),
    'last_cycle',   (select to_jsonb(r) from (
                       select status, started_at, finished_at, site_id from public.presence_scheduled_runs
                        where run_type in ('tick', 'cycle') and status = 'done' and finished_at is not null
                        order by created_at desc limit 1) r),
    'failures_24h', (select count(*) from public.presence_scheduled_runs where status = 'failed' and created_at >= now() - interval '24 hours'),
    'last_failure', (select to_jsonb(r) from (
                       select run_type, left(coalesce(last_error, ''), 300) as last_error, created_at from public.presence_scheduled_runs
                        where status = 'failed' and created_at >= now() - interval '24 hours'
                        order by created_at desc limit 1) r),
    'stuck_runs',   (select count(*) from public.presence_scheduled_runs where status = 'running' and started_at < now() - interval '2 hours'),
    'live_sites',   (select count(*) from public.presence_sites where edition = 'presence' and offline_at is null and (status = 'live' or last_published_at is not null)),
    'domains_watched', (select count(*) from public.presence_sites where custom_domain is not null),
    'domains_soon', (select count(*) from public.presence_sites where custom_domain is not null and domain_expires_at >= now() and domain_expires_at <= now() + interval '30 days'),
    'notices',      (select count(*) from public.presence_plan_notices where status = 'active'),
    'failed_publishes', (select count(*) from public.presence_publishes where status = 'failed' and created_at >= now() - interval '7 days'),
    'ai_ops',       (select coalesce(sum(coalesce(generative_ops, 0) + coalesce(assistive_ops, 0)), 0) from public.presence_ai_usage where period = to_char(now() at time zone 'UTC', 'YYYY-MM')),
    'paid_publishes_30d', (select count(*) from public.presence_publishes where netlify_deploy_id is not null and created_at >= now() - interval '30 days')
  );
$$;

revoke all on function public.presence_health_counts() from public, anon, authenticated;
grant execute on function public.presence_health_counts() to service_role;

comment on function public.presence_health_counts() is
  'Builder list item 403: every count /system/health and the Admin Health Center need, in one trip. Read-only; service role only.';


-- Verify right away (expect: one row naming the function; then one jsonb with 14 keys,
-- active_sites matching what Admin shows, last_cycle a recent finished run):
-- select proname from pg_proc where proname = 'presence_health_counts';
-- select public.presence_health_counts();
--
-- Then, after the deploy and a day of the watchdog (staging's SQL Editor):
-- select last_checked_at, last_ok_at, last_reason from public.watchdog_state;
-- and in production's function logs, /system/health should answer in well under a
-- second from a warm worker (it was 2.8 s at the middle).
