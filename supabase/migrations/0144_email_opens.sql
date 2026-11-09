-- ── "Did they open it?" (sales review item 69, Nov 2026) ─────────────────────
-- Two halves, both counted by Studio OS itself (no mail-provider tracking):
--
--   • updates: each emailed update carries a 1×1 image naming its send row
--     (lib/email_engagement.ts); the first time it loads, the row gets opened_at
--     and the sent update reads "Opened by 3 of 10".
--   • documents: the first time the client opens a proposal's, agreement's or
--     invoice's page, first_viewed_at is stamped (proposals have had it since
--     0107; agreements and invoices get it here) and the deal gets one
--     'doc_opened' line — "They opened your proposal".
--
-- APPLY THIS BEFORE DEPLOYING THE FUNCTION. The function is deploy-order
-- tolerant (the stamps and the new line fail quietly, the reads fall back to the
-- old columns), but dealEvent() is best-effort: a proposal opened in between is
-- stamped while its 'doc_opened' line is dropped silently by the old check, and
-- it is never counted again.
--
-- Properties:
--   • ADDITIVE — three nullable columns; the FULL 0118 kind list is carried
--     forward unchanged and one kind is added (no existing row can fail it).
--   • IDEMPOTENT — add-if-not-exists and drop-if-exists-then-add.
--   • DATA-SAFE — no row is read, written or moved.

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
    -- added by 0088:
    'invoice_sent','invoice_paid',
    -- added by 0117:
    'proposal_deleted','contract_deleted',
    -- added by 0118:
    'invoice_voided',
    -- added by 0144:
    'doc_opened'
  ));

-- rollback: restore the 0118 check (delete the new kind's rows first) and drop the columns.
--   delete from public.presence_deal_events where kind = 'doc_opened';
--   alter table public.presence_deal_events drop constraint if exists presence_deal_events_kind_check;
--   alter table public.presence_deal_events add constraint presence_deal_events_kind_check
--     check (kind in ('created','stage_change','note','proposal_sent','proposal_decided',
--       'contract_sent','contract_signed','converted','invoice_sent','invoice_paid',
--       'proposal_deleted','contract_deleted','invoice_voided'));
--   alter table public.presence_invoices drop column if exists first_viewed_at;
--   alter table public.presence_contracts drop column if exists first_viewed_at;
--   alter table public.presence_broadcast_sends drop column if exists opened_at;
