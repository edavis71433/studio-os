-- rollback: drop table if exists public.email_outbox; then re-run supabase/migrations/0261_crash_counts.sql (the health counts without the two outbox numbers)
--
-- ── An outbox for the emails that matter (builder list item 393) ──
-- APPLY BEFORE THE RELEASE THAT SHIPS ITEM 393 (the release refuses to go out until
-- production's change ledger has this number). Until it lands, the server sends these
-- emails the way it always did: once, and lost if the sending service fails.
--
-- WHY (Nov 22 2026 review, file 07, finding 17)
--   An email the sending service refuses or doesn't answer was logged and dropped. In a
--   bad hour, invoices, receipts, signed agreements and sign-in links were simply lost,
--   and the scheduled ones (reminders, receipts) had nobody to tell.
--
-- WHAT CHANGES
--   email_outbox: one row per money, sign-in or agreement email, written BEFORE the send
--   with the exact message, ticked when the sending service takes it. One that fails is
--   tried again by the 15-minute scheduled run for a day, each try with the same
--   Idempotency-Key, so the sending service never delivers it twice. Once sent or given
--   up on, the message itself is cleared from the row (only who, what and when stay), and
--   the row goes after 30 days. Only the server's own key reads or writes it: row
--   security on, no rules, no grants to the public roles.
--   presence_health_counts() gains two counts, still in one trip: emails waiting to be
--   tried again, and those given up on in the last 7 days (the Health page shows both).

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
