-- APPLY 0144 (production) — "Did they open it?": opens on updates, proposals,
-- agreements and invoices. Safe to run more than once. Three new empty columns
-- and one new kind of deal history line ('doc_opened'); nothing existing changes.
-- Paste into Supabase → SQL Editor → Run.
alter table public.presence_broadcast_sends add column if not exists opened_at timestamptz;
alter table public.presence_contracts add column if not exists first_viewed_at timestamptz;
alter table public.presence_invoices add column if not exists first_viewed_at timestamptz;

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
    'doc_opened'
  ));

-- Check: four rows — the three new columns, then the kind list ending in doc_opened.
select table_name as what, column_name as detail
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'presence_broadcast_sends' and column_name = 'opened_at')
    or (table_name in ('presence_contracts', 'presence_invoices') and column_name = 'first_viewed_at'))
union all
select 'kind check', pg_get_constraintdef(oid)
from pg_constraint
where conname = 'presence_deal_events_kind_check';
