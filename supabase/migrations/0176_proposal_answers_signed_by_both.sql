-- 0176 — A proposal can be answered, and the agreement is signed by both sides
-- (sales item 88, Nov 2026 review: file 07 findings 8 and 9).
--
-- presence_proposals.decided_reason   why a client declined, as their page offers it:
--                                     price · timing · scope · elsewhere (or '' for none).
--                                     Their own words stay in decided_note, as before.
-- presence_contracts.countersigned_*  the studio's signature, added in the same write as
--                                     the client's and with the same moment
--                                     (routes/sales.ts handleSalesContractSign).
-- presence_settings.signs_as_*        who signs agreements for the studio, and their title
--                                     (Settings → Studio profile). Blank = the account's own
--                                     name, else the business's name.
-- presence_deal_events.kind           adds 'client_question': a question asked on the
--                                     proposal or agreement page (routes/proposal_answers.ts),
--                                     which also lands in the Inbox as a support request.
--                                     Carries 0167's whole list forward; the next migration
--                                     that widens the list must carry this one.
-- The code reads every new column with a step-down, so nothing goes dark ahead of the pack,
-- and a signature never fails for want of the countersignature columns.
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

comment on column public.presence_proposals.decided_reason is 'Sales item 88: why the client declined (price, timing, scope, elsewhere), chosen on their page. Their words are in decided_note.';
comment on column public.presence_contracts.countersigned_name is 'Sales item 88: the studio''s countersignature, stamped in the same write as the client''s signature, at the same moment (countersigned_at).';
comment on column public.presence_settings.signs_as_name is 'Sales item 88: who signs agreements for the studio. Blank = the account''s own name, else the business name.';

-- rollback:
--   (the deal-event kind list: re-add 0167's list, without 'client_question', after deleting those rows)
--   alter table public.presence_settings drop constraint if exists presence_settings_signs_as_len,
--     drop column if exists signs_as_title, drop column if exists signs_as_name;
--   alter table public.presence_contracts drop column if exists countersigned_at,
--     drop column if exists countersigned_title, drop column if exists countersigned_name;
--   alter table public.presence_proposals drop constraint if exists presence_proposals_decided_reason_check,
--     drop column if exists decided_reason;
