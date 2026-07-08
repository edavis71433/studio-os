-- ── Phase INF (CP-8/FD-INF3): domain intelligence ───────────────────────────
-- The platform learns each custom domain's registrar + expiry via RDAP (daily,
-- keyless) and warns the OWNER before a lapse kills their site — the failure
-- registrars profit from and hosts ignore. Registrar powers per-registrar
-- guidance in the Foundations Desk; stored fields make agency roll-ups cheap.
alter table public.presence_sites
  add column if not exists domain_registrar text not null default '',
  add column if not exists domain_expires_at timestamptz,
  add column if not exists domain_checked_at timestamptz;
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in ('capacity','trial_ending','trial_ended','payment_trouble','account_lapsed','search_setup','winddown_reminder','win_back','welcome_back','deletion_requested','domain_expiry'));
-- rollback: drop the three columns; restore prior kind check.
