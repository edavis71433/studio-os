-- ── 0088 — widen the notice-kind check to what the code actually raises ──────
-- BUG FIX (latent since P2-C): the presence_plan_notices kind check was last
-- widened in 0062, but code added since then raises 'deal_signed' (proposal
-- accepted / contract signed → tell the studio), 'deal_followup' (proposal
-- declined), and 'publish_failed'. raiseNotice() is deliberately best-effort,
-- so every one of those inserts has been failing SILENTLY against this check —
-- the owner never saw "they accepted!" in the bell/Today. This migration adds
-- the missing kinds plus 'invoice_paid' (the new deposit/invoice paid echo
-- written by the stripe webhook) and 'connection_expired' / 'website_enquiry'
-- (documented in notice.ts's contract as intended kinds).
-- Additive only; no data change. Safe to re-run.

alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    -- added by 0088:
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry'
  ));

-- Same latent gap on the deal-event ledger: 0074's check predates invoices.
-- 'invoice_sent' (written by POST /sales/deals/:id/invoice) and 'invoice_paid'
-- (written by the stripe webhook echo) were failing the check silently.
alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    -- added by 0088:
    'invoice_sent','invoice_paid'
  ));

-- rollback: restore the 0062 notices check and the 0074 deal-events check
-- (delete any rows with the new kinds first).
