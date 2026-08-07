-- ── Deal-event kinds for removing an unsent draft ───────────────────────────
-- Eric had two duplicate $3,200 proposal drafts on one deal and no way to take
-- either off. DELETE /sales/proposals/:id and DELETE /sales/contracts/:id now
-- soft-delete a NEVER-SENT draft (`deleted_at`; both tables have carried that
-- column since 0074, so the removal itself needs no migration).
--
-- Because the row is then hidden from every read, the deal's event ledger is the
-- ONLY place the removal shows — which is exactly why it must be recorded. The
-- ledger's `kind` carries a CHECK constraint whose current superset lives in
-- 0088_notice_kinds.sql and contains neither new kind, so the audit INSERT would
-- fail the check. dealEvent() is best-effort (`.catch(() => {})`), so that
-- failure is SILENT: the draft would vanish leaving no trace at all. This is the
-- same latent gap 0088 fixed for 'invoice_sent'/'invoice_paid'.
--
-- This migration widens it by exactly two:
--
--   proposal_deleted  an unsent proposal draft was removed from the deal
--   contract_deleted  an unsent agreement draft was removed from the deal
--
-- Properties:
--   • ADDITIVE — the FULL 0088 superset is carried forward verbatim; no kind is
--     ever dropped (an existing row could not satisfy a narrowed constraint).
--   • IDEMPOTENT — drop-if-exists then add, so a re-run is a no-op.
--   • DATA-SAFE — a constraint change only; no row is read, written or moved.
--
-- Neither kind is ever written for a SENT, decided or signed artifact: the
-- handlers refuse those with 409 before any event is recorded.

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
    'proposal_deleted','contract_deleted'
  ));

-- rollback: restore the 0088 check (delete any rows with the new kinds first).
--   delete from public.presence_deal_events
--    where kind in ('proposal_deleted','contract_deleted');
--   alter table public.presence_deal_events
--     drop constraint if exists presence_deal_events_kind_check;
--   alter table public.presence_deal_events
--     add constraint presence_deal_events_kind_check
--     check (kind in (
--       'created','stage_change','note','proposal_sent','proposal_decided',
--       'contract_sent','contract_signed','converted',
--       'invoice_sent','invoice_paid'
--     ));
