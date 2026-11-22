-- ===========================================================================
--  APPLY PACK - migration 0261  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0260
--  (this reads its ledger) and BEFORE OR WITH the deploy.yml run that ships builder items
--  416, 417 and 420. IDEMPOTENT ("create or replace"), read-only (the function only
--  counts), safe to re-run. If the release goes first nothing breaks: the health check
--  reads the crash counts and the ledger with three small reads of its own until this lands.
--
--  Why: builder list item 416 (and the newest-number half of 420). A request that crashes
--  writes one row to ops_errors, and nothing read that table: no page showed it, Health
--  didn't count it and the watchdog didn't see it. presence_health_counts() now also
--  counts crashes in the last hour and day, and reads the ledger's newest number, still in
--  one trip. The health answer turns not-ok above 5 crashes in an hour.
--
--  The other half, on STAGING (wjlpursnwbmlcdwbeowv), after the release: re-run the whole
--  of supabase/ops/watchdog-cron.sql in its SQL Editor (idempotent). Its email now names
--  the hour's crashes when that is the reason, and points at docs/RUN-SHEET.md.
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed): re-run docs/presence/APPLY-0247-prod.sql.
--
--  Covers: supabase/migrations/0261_crash_counts.sql
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
    'paid_publishes_30d', (select count(*) from public.presence_publishes where netlify_deploy_id is not null and created_at >= now() - interval '30 days'),
    -- builder list item 416: server crashes (the presence function's catch writes one row each)
    'crashes_1h',   (select count(*) from public.ops_errors where created_at >= now() - interval '1 hour'),
    'crashes_24h',  (select count(*) from public.ops_errors where created_at >= now() - interval '24 hours'),
    -- builder list item 420: the newest database change this database has (0260's ledger)
    'ledger_newest', (select max(number) from public.presence_change_ledger),
    'ledger_rows',  (select count(*) from public.presence_change_ledger)
  );
$$;

revoke all on function public.presence_health_counts() from public, anon, authenticated;
grant execute on function public.presence_health_counts() to service_role;

comment on function public.presence_health_counts() is
  'Builder list items 403, 416, 420: every count /system/health and the Admin Health Center need, in one trip, with crashes in the last hour and day and the newest database change. Read-only; service role only.';

select public.presence_ledger_note(261, 'crash_counts');


-- Verify right away (expect: 18 keys, crashes_1h and crashes_24h numbers, ledger_newest 261):
-- select (select count(*) from jsonb_object_keys(public.presence_health_counts())) as keys,
--        public.presence_health_counts() -> 'crashes_1h' as crashes_1h,
--        public.presence_health_counts() -> 'crashes_24h' as crashes_24h,
--        public.presence_health_counts() -> 'ledger_newest' as ledger_newest;
