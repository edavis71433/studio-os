-- ── Phase CP-3: trust & automation ───────────────────────────────────────────
-- Notice kinds: the wind-down reminder (day 45), the one win-back (day 30),
-- the welcome-back (reactivation), and the deletion-request confirmation.
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed','search_setup','winddown_reminder','win_back','welcome_back','deletion_requested'));
-- weekly owner digest state (one row)
create table if not exists public.presence_ops_state (
  id int primary key default 1,
  last_digest_at timestamptz
);
insert into public.presence_ops_state (id) values (1) on conflict do nothing;
alter table public.presence_ops_state enable row level security;
-- self-serve deletion REQUEST (execution stays a human runbook — honest GDPR)
alter table public.presence_entitlements
  add column if not exists deletion_requested_at timestamptz;
-- rollback: restore prior kind check; drop presence_ops_state; drop the column.
