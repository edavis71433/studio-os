-- ── Deal-event kind for withdrawing an invoice raised in error ──────────────
-- APPLY THIS BEFORE DEPLOYING THE FUNCTION. dealEvent() in routes/sales.ts is
-- best-effort (`.catch(() => {})`), so an un-widened CHECK does not fail the
-- request — it drops the audit line SILENTLY. The invoice would flip to 'void'
-- with NOTHING on the deal recording that money was withdrawn or by whom. That
-- is the exact latent gap 0088 fixed for 'invoice_sent'/'invoice_paid' and 0117
-- fixed for the draft deletes; the ordering rule is the same and it matters more
-- here, because this event is the only trace a withdrawal leaves.
--
-- POST /sales/invoices/:id/void is the first (and only) writer of
-- presence_invoices.status = 'void'. That value has been legal since 0086 and
-- pipeline.html has always rendered a "Voided" row, but nothing ever wrote it —
-- so an invoice raised in error could only be cleared by paying it, and the
-- undismissable `deal_followup`/`invremind:<id>` notice it stranded had no
-- teardown but the money landing.
--
-- This migration widens the ledger's kind CHECK by exactly one:
--
--   invoice_voided  an unpaid invoice was withdrawn (never a PAID one — the
--                   handler refuses those with 409 before any event is written)
--
-- No existing kind is honest for this. 'invoice_sent' and 'invoice_paid' both
-- assert the opposite of what happened, and reusing either would make the ledger
-- lie about money — so the constraint moves rather than the meaning.
--
-- Properties:
--   • ADDITIVE — the FULL 0117 superset (which itself carries 0088's forward
--     verbatim) is carried forward unchanged; no kind is ever dropped (an
--     existing row could not satisfy a narrowed constraint).
--   • IDEMPOTENT — drop-if-exists then add, so a re-run is a no-op.
--   • DATA-SAFE — a constraint change only; no row is read, written or moved.

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
    'invoice_voided'
  ));

-- rollback: restore the 0117 check (delete any rows with the new kind first).
--   delete from public.presence_deal_events where kind = 'invoice_voided';
--   alter table public.presence_deal_events
--     drop constraint if exists presence_deal_events_kind_check;
--   alter table public.presence_deal_events
--     add constraint presence_deal_events_kind_check
--     check (kind in (
--       'created','stage_change','note','proposal_sent','proposal_decided',
--       'contract_sent','contract_signed','converted',
--       'invoice_sent','invoice_paid',
--       'proposal_deleted','contract_deleted'
--     ));
