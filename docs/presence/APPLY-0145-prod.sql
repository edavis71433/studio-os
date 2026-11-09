-- APPLY 0145 (production) — estimates and recurring invoices (sales list item 47).
-- Safe to run more than once. Two new empty tables, two new empty invoice
-- columns, four new kinds of deal history line and one new kind of notice;
-- nothing existing changes. Run it before the deploy.
-- Paste into Supabase → SQL Editor → Run.

create table if not exists public.presence_estimates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',
  line_items jsonb not null default '[]',
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  currency text not null default 'usd',
  terms text not null default '',
  status text not null default 'draft' check (status in ('draft','sent','approved','declined')),
  sent_at timestamptz,
  expires_at timestamptz,
  first_viewed_at timestamptz,
  decided_at timestamptz,
  decided_note text not null default '',
  proposal_id uuid,
  invoice_id uuid,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_estimates_deal_idx on public.presence_estimates (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_estimates_sent_idx on public.presence_estimates (status, sent_at) where deleted_at is null;
alter table public.presence_estimates enable row level security;
revoke all on public.presence_estimates from anon, authenticated;
grant all on public.presence_estimates to service_role;

create table if not exists public.presence_recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',
  amount_cents integer not null check (amount_cents >= 50 and amount_cents <= 100000000),
  currency text not null default 'usd',
  every text not null default 'month' check (every in ('month','quarter','year')),
  anchor_day smallint not null check (anchor_day between 1 and 31),
  next_on date,
  due_days smallint not null default 14 check (due_days between 0 and 90),
  times integer check (times is null or times between 1 and 120),
  sent_count integer not null default 0 check (sent_count >= 0),
  status text not null default 'active' check (status in ('active','paused','stopped','finished')),
  paused_reason text not null default '',
  resumed_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_recurring_invoices_due_idx on public.presence_recurring_invoices (next_on) where status = 'active' and deleted_at is null;
create index if not exists presence_recurring_invoices_deal_idx on public.presence_recurring_invoices (deal_id) where deleted_at is null;
alter table public.presence_recurring_invoices enable row level security;
revoke all on public.presence_recurring_invoices from anon, authenticated;
grant all on public.presence_recurring_invoices to service_role;

do $$ begin
  create trigger presence_estimates_touch before update on public.presence_estimates for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;
do $$ begin
  create trigger presence_recurring_invoices_touch before update on public.presence_recurring_invoices for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

alter table public.presence_invoices add column if not exists recurring_id uuid;
alter table public.presence_invoices add column if not exists recurring_on date;
create unique index if not exists presence_invoices_recurring_once
  on public.presence_invoices (recurring_id, recurring_on) where recurring_id is not null;

alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    'invoice_sent','invoice_paid',
    'proposal_deleted','contract_deleted',
    'invoice_voided',
    'doc_opened',
    'estimate_sent','estimate_decided','estimate_deleted','recurring_invoice'
  ));

alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','new_booking',
    'site_down','support_aging','agreement_renewal',
    'booking_reminder','booking_followup',
    'new_review',
    'email_auth','apex_drift',
    'client_message','client_upload','client_request','client_approval',
    'invoice_void_paid',
    'retainer_status','deal_task_due',
    'studio_published',
    'approval_overdue',
    'invoice_upcoming'
  ));

-- Check: seven rows — the two tables, the two invoice columns, the send-once
-- index, then the two kind lists (ending in recurring_invoice and invoice_upcoming).
select 'table' as what, table_name as detail
from information_schema.tables
where table_schema = 'public' and table_name in ('presence_estimates', 'presence_recurring_invoices')
union all
select 'column', column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'presence_invoices' and column_name in ('recurring_id', 'recurring_on')
union all
select 'index', indexname
from pg_indexes
where schemaname = 'public' and indexname = 'presence_invoices_recurring_once'
union all
select 'kind check', pg_get_constraintdef(oid)
from pg_constraint
where conname in ('presence_deal_events_kind_check', 'presence_plan_notices_kind_check');
