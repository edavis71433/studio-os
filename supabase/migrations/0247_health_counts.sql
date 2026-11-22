-- rollback: drop function if exists public.presence_health_counts();
--
-- ── The 5-minute alarm check reads once (builder list item 403) ──────────────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the health
-- check reads the same counts as one wave of reads side by side (none twice).
--
-- WHY (Nov 22 2026 review, file 14, finding 3)
--   /system/health was called 288 times a day by the staging watchdog in Ohio and took
--   2.8 s at the middle (4.2 s for one in ten, 7.6 s at worst): it made 16 or 17 reads,
--   6 or 7 of them one after another and three of them twice, and each crossed the
--   country at about 200 ms. Every check was a cold start.
--
-- WHAT CHANGES
--   presence_health_counts(): every count the check and the Admin Health Center need,
--   as one jsonb, in one trip: active, paused and lapsed subscriptions; the last finished
--   15-minute run; failed runs in 24 hours and the newest failure's words; runs stuck
--   'running' for two hours; live sites; domains watched and those expiring within 30
--   days; active notices; failed publishes in 7 days; the month's AI operations; paid
--   publishes in 30 days. Read-only. Only the service role may call it.
--   With supabase/ops/watchdog-cron.sql re-run on staging, the check also asks to run
--   beside the database (the x-region header the app's pages send), so the one trip is
--   a short one.

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
