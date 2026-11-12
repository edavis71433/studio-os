-- APPLY 0176 (production) — Proposal answers and an agreement signed by both (sales item 88).
-- Safe to run more than once. New columns only (a decline's reason, the studio's
-- countersignature, who signs for the studio) and one more deal-history kind,
-- client_question; nothing existing changes and nothing is sent.
-- Paste into Supabase → SQL Editor → Run.
alter table public.presence_proposals add column if not exists decided_reason text not null default '';
alter table public.presence_proposals drop constraint if exists presence_proposals_decided_reason_check;
alter table public.presence_proposals
  add constraint presence_proposals_decided_reason_check
  check (decided_reason in ('', 'price', 'timing', 'scope', 'elsewhere'));
alter table public.presence_contracts
  add column if not exists countersigned_name text not null default '',
  add column if not exists countersigned_title text not null default '',
  add column if not exists countersigned_at timestamptz;
alter table public.presence_settings
  add column if not exists signs_as_name text not null default '',
  add column if not exists signs_as_title text not null default '';
alter table public.presence_settings drop constraint if exists presence_settings_signs_as_len;
alter table public.presence_settings
  add constraint presence_settings_signs_as_len check (char_length(signs_as_name) <= 120 and char_length(signs_as_title) <= 80);

alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    -- added by 0088:
    'invoice_sent','invoice_paid',
    -- added by 0117:
    'proposal_deleted','contract_deleted',
    -- added by 0118:
    'invoice_voided',
    -- added by 0144:
    'doc_opened',
    -- added by 0145:
    'estimate_sent','estimate_decided','estimate_deleted','recurring_invoice',
    -- added by 0167:
    'payment_undone',
    -- added by 0176:
    'client_question'
  ));

-- Check: seven rows (the new columns), and the kind list now ending in client_question.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'presence_proposals' and column_name = 'decided_reason')
    or (table_name = 'presence_contracts' and column_name in ('countersigned_name','countersigned_title','countersigned_at'))
    or (table_name = 'presence_settings' and column_name in ('signs_as_name','signs_as_title'))
    or (table_name = 'presence_deal_events' and column_name = 'kind'))
order by table_name, column_name;
select pg_get_constraintdef(oid) like '%client_question%' as kind_list_has_client_question
from pg_constraint where conname = 'presence_deal_events_kind_check';
