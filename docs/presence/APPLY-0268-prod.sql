-- ===========================================================================
--  APPLY PACK - migration 0268  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE the
--  deploy.yml run that ships builder item 393 (the release refuses to go out until the
--  change ledger has 0268). IDEMPOTENT ("if not exists", "create or replace"), safe to
--  re-run. Creates one empty table and widens the read-only health counts.
--
--  Why: builder list item 393 (Nov 22 2026 review, file 07 finding 17). An email the
--  sending service refused or didn't answer was dropped: in a bad hour invoices,
--  receipts, signed agreements and sign-in links were lost. email_outbox keeps each
--  money, sign-in and agreement email from before its send until the sending service
--  takes it, and the 15-minute run tries a failed one again for a day, with the same
--  Idempotency-Key each time so it can never arrive twice. Sent or given up on, the
--  message itself is cleared from the row; rows go after 30 days. Server key only.
--  presence_health_counts() also counts the emails waiting and those given up on in the
--  last 7 days, still in one trip; the Health page's "Email delivery" line shows them.
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed):
--    drop table if exists public.email_outbox;
--    then re-run docs/presence/APPLY-0261-prod.sql (the health counts without the outbox).
--
--  Covers: supabase/migrations/0268_email_outbox.sql
-- ===========================================================================

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('money', 'sign_in', 'agreement')),
  to_email text not null,
  subject text not null default '',
  site_id uuid,
  -- the exact message the sending service is asked to take; null once sent or given up on
  payload jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  tries int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  done_at timestamptz
);

create index if not exists email_outbox_waiting_idx on public.email_outbox (next_try_at) where status = 'queued';
create index if not exists email_outbox_created_idx on public.email_outbox (created_at);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon, authenticated, public;

comment on table public.email_outbox is
  'Builder item 393: money, sign-in and agreement emails, written before the send and tried again every 15 minutes for a day (presence/lib/email_outbox.ts). Server key only.';

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
    'ledger_rows',  (select count(*) from public.presence_change_ledger),
    -- builder list item 393: important emails waiting to be tried again, and those given up on this week
    'outbox_waiting',   (select count(*) from public.email_outbox where status = 'queued'),
    'outbox_failed_7d', (select count(*) from public.email_outbox where status = 'failed' and created_at >= now() - interval '7 days')
  );
$$;

revoke all on function public.presence_health_counts() from public, anon, authenticated;
grant execute on function public.presence_health_counts() to service_role;

comment on function public.presence_health_counts() is
  'Builder list items 403, 416, 420, 393: every count /system/health and the Admin Health Center need, in one trip, with crashes, the newest database change and the email outbox. Read-only; service role only.';

select public.presence_ledger_note(268, 'email_outbox');

-- Verify right away (expect: the table with row security on, no grants to the public roles,
-- 20 keys in the health counts, outbox_waiting 0, ledger_newest 268 or later):
-- select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'email_outbox';
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'email_outbox' and grantee in ('anon', 'authenticated', 'PUBLIC');
-- select (select count(*) from jsonb_object_keys(public.presence_health_counts())) as keys,
--        public.presence_health_counts() -> 'outbox_waiting' as outbox_waiting,
--        public.presence_health_counts() -> 'ledger_newest' as ledger_newest;
