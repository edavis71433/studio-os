-- ===========================================================================
--  APPLY PACK - migration 0250  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships sales items 167, 168, 172 and 176 (the
--  "On every invoice" Settings card, late fees, "Paid another way? Tell us",
--  costs paid for a customer). ADDITIVE and IDEMPOTENT: columns with defaults,
--  one new table with row security on and no policies, the invoice-number
--  trigger re-created to respect a chosen starting number, and the notice kind
--  list widened by one kind (every kind already there is kept).
--
--  If the deploy goes first, nothing breaks: the Settings card says it isn't
--  switched on yet, the invoice page's "Tell us" answers "not ready", costs
--  say the same, and no late fee is added.
--
--  Rollback (only if ever needed): see the rollback note at the end of
--  supabase/migrations/0250_invoice_settings_costs.sql.
--
--  Covers: supabase/migrations/0250_invoice_settings_costs.sql
-- ===========================================================================
alter table public.presence_settings
  add column if not exists invoice_pay_other text not null default '',
  add column if not exists invoice_tax_id text not null default '',
  add column if not exists invoice_number_start integer,
  add column if not exists late_fee_mode text not null default 'off',
  add column if not exists late_fee_value integer not null default 0,
  add column if not exists late_fee_days integer not null default 7;
alter table public.presence_settings drop constraint if exists presence_settings_invoice_pay_other_len;
alter table public.presence_settings add constraint presence_settings_invoice_pay_other_len check (char_length(invoice_pay_other) <= 600);
alter table public.presence_settings drop constraint if exists presence_settings_invoice_tax_id_len;
alter table public.presence_settings add constraint presence_settings_invoice_tax_id_len check (char_length(invoice_tax_id) <= 80);
alter table public.presence_settings drop constraint if exists presence_settings_invoice_number_start_check;
alter table public.presence_settings add constraint presence_settings_invoice_number_start_check check (invoice_number_start is null or (invoice_number_start >= 1 and invoice_number_start <= 999999));
alter table public.presence_settings drop constraint if exists presence_settings_late_fee_mode_check;
alter table public.presence_settings add constraint presence_settings_late_fee_mode_check check (late_fee_mode in ('off', 'flat', 'percent'));
alter table public.presence_settings drop constraint if exists presence_settings_late_fee_value_check;
alter table public.presence_settings add constraint presence_settings_late_fee_value_check check (late_fee_value >= 0 and late_fee_value <= 1000000);
alter table public.presence_settings drop constraint if exists presence_settings_late_fee_days_check;
alter table public.presence_settings add constraint presence_settings_late_fee_days_check check (late_fee_days >= 1 and late_fee_days <= 90);

alter table public.presence_invoices
  add column if not exists client_says_paid jsonb,
  add column if not exists late_fee_cents integer not null default 0;
alter table public.presence_invoices drop constraint if exists presence_invoices_late_fee_cents_check;
alter table public.presence_invoices add constraint presence_invoices_late_fee_cents_check check (late_fee_cents >= 0 and late_fee_cents <= 100000000);

-- the next invoice takes the next number on its site, or the studio's chosen start when that is higher
create or replace function public.presence_invoice_number() returns trigger
language plpgsql set search_path = public as $$
declare start_at integer;
begin
  if new.number is null and new.payment_for is null then
    perform pg_advisory_xact_lock(hashtextextended('presence_invoice_number:' || new.site_id::text, 0));
    select invoice_number_start into start_at from public.presence_settings where site_id = new.site_id;
    select greatest(coalesce(max(number), 0) + 1, coalesce(start_at, 1)) into new.number from public.presence_invoices where site_id = new.site_id;
  end if;
  return new;
end $$;

create table if not exists public.presence_customer_costs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid references public.presence_deals(id) on delete set null,
  customer_client_id uuid,
  label text not null check (char_length(label) between 1 and 200),
  amount_cents integer not null check (amount_cents >= 1 and amount_cents <= 100000000),
  spent_on date not null,
  receipt_media_id uuid references public.presence_media(id) on delete set null,
  bill boolean not null default true,
  invoice_id uuid references public.presence_invoices(id) on delete set null,
  note text not null default '' check (char_length(note) <= 300),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_customer_costs_site_idx on public.presence_customer_costs (site_id, spent_on) where deleted_at is null;
create index if not exists presence_customer_costs_deal_idx on public.presence_customer_costs (deal_id) where deal_id is not null and deleted_at is null;
alter table public.presence_customer_costs enable row level security;
revoke all on public.presence_customer_costs from anon, authenticated;

alter table public.presence_plan_notices drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices add constraint presence_plan_notices_kind_check
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
    'invoice_upcoming',
    -- added by builder item 47 (the studio bell's site notices):
    'site_published','traffic_spike',
    -- added by 0250:
    'client_said_paid'
  ));

comment on column public.presence_settings.invoice_pay_other is 'Sales item 168: how else to pay (check, Zelle), printed on every invoice, its PDF and its email.';
comment on column public.presence_settings.invoice_tax_id is 'Sales item 168: the studio''s tax or licence number, under its name on documents.';
comment on column public.presence_settings.invoice_number_start is 'Sales item 168: the number the next invoice takes when higher than the running count (presence_invoice_number reads it).';
comment on column public.presence_settings.late_fee_mode is 'Sales item 167: off, flat (late_fee_value is cents) or percent (late_fee_value is a whole percent). Added once, late_fee_days after the due date.';
comment on column public.presence_invoices.client_says_paid is 'Sales item 172: the client said they paid another way: { method, on, at }. Reminders pause while set; recording the payment or Not received clears it.';
comment on column public.presence_invoices.late_fee_cents is 'Sales item 167: the late fee added to this invoice, once (0 = none).';
comment on table public.presence_customer_costs is 'Sales item 176: costs the studio paid for a customer, each with its receipt from Files, added to the next invoice when bill is true, and listed in the bookkeeper file.';


-- check: six settings columns, two invoice columns, the costs table, and the kind list naming client_said_paid
select 'settings columns' as what, count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'presence_settings' and column_name in ('invoice_pay_other','invoice_tax_id','invoice_number_start','late_fee_mode','late_fee_value','late_fee_days')
union all select 'invoice columns', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'presence_invoices' and column_name in ('client_says_paid','late_fee_cents')
union all select 'costs table', count(*) from information_schema.tables where table_schema = 'public' and table_name = 'presence_customer_costs'
union all select 'notice kinds', count(*) from pg_constraint where conname = 'presence_plan_notices_kind_check' and pg_get_constraintdef(oid) like '%client_said_paid%';
