-- ===========================================================================
--  APPLY PACK - migration 0249  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships sales items 162 to 166 (invoice changes,
--  Remind now, money given back by hand, the reminders question). ADDITIVE and
--  IDEMPOTENT: one boolean column with a default, and the deal-event kind list
--  widened by three kinds (every kind already there is kept).
--
--  If the deploy goes first, nothing breaks: a history line of a new kind is
--  refused by the old check and dropped (dealEvent never throws), and the
--  reminders question is simply asked again until the column exists.
--
--  Rollback (only if ever needed):
--    delete from public.presence_deal_events where kind in ('invoice_changed','invoice_reminded','money_back');
--    then re-add 0176's kind list; alter table public.presence_settings drop column if exists invoice_reminders_asked;
--
--  Covers: supabase/migrations/0246_invoice_changes_reminders.sql
-- ===========================================================================

alter table public.presence_settings
  add column if not exists invoice_reminders_asked boolean not null default false;

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
    'estimate_sent','estimate_decided','estimate_deleted','recurring_invoice',
    'payment_undone',
    'client_question',
    'invoice_changed','invoice_reminded','money_back'
  ));

-- check: both lines should come back (one column, one constraint naming money_back)
select 'column' as what, count(*) as n from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_settings' and column_name = 'invoice_reminders_asked'
union all
select 'kinds', count(*) from pg_constraint
 where conname = 'presence_deal_events_kind_check' and pg_get_constraintdef(oid) like '%money_back%';
