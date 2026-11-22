-- 0249 — An invoice can be changed, reminded and given money back by hand (sales items 162,
-- 165 and 166, Nov 22 2026 review).
--
-- presence_deal_events
--   kind         adds 'invoice_changed' (the title, due date, note, amount or lines of an unpaid
--                invoice were changed; detail lists each change, old and new), 'invoice_reminded'
--                (the studio pressed Remind now) and 'money_back' (money given back by hand on an
--                invoice paid by check, cash, bank transfer or Zelle: amount, day, how, note).
--                Carries 0176's whole list forward; the next migration that widens it must carry
--                these three.
-- presence_settings
--   invoice_reminders_asked   true once the studio has answered "Remind them if it isn't paid?",
--                the first time it sends an invoice with reminders off (sales item 166). Asked
--                once, whichever way it answered.
-- No notice kind is added: Remind now writes its ledger row under the invoice's reminder prefix
-- (deal_followup, invremind:<id>:now:<day>), so paying or voiding the invoice takes it down too.
-- A refund by hand is a presence_money_returns row (0233) with kind 'refund' and a stripe_id of
-- 'hand:<row id>' (no Stripe object); its method names how the money went back.
alter table public.presence_settings
  add column if not exists invoice_reminders_asked boolean not null default false;

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
    'client_question',
    -- added by 0249:
    'invoice_changed','invoice_reminded','money_back'
  ));

comment on column public.presence_settings.invoice_reminders_asked is
  'Sales item 166: the studio has been asked once, the first time it sent an invoice with reminders off, whether to remind unpaid invoices. True whichever way it answered.';

-- rollback:
--   (the deal-event kind list: re-add 0176's list, without the three new kinds, after deleting those rows)
--   alter table public.presence_settings drop column if exists invoice_reminders_asked;
