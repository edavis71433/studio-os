-- rollback: alter table public.presence_settings
--   drop column if exists auto_ack_enquiries, drop column if exists invoice_reminders,
--   drop column if exists invoice_remind_after_days, drop column if exists deal_nudges,
--   drop column if exists deal_nudge_days, drop column if exists stage_stale_days;
--
-- ── Three switches, not a workflow builder (benchmark 2026-10, item 6) ────────
-- ── + pipeline hygiene: stale after N days per stage (item 13) ───────────────
-- Settings gains the three automations an owner can see and switch, each OFF by
-- default, each previewable on settings.html:
--   auto_ack_enquiries        a visitor who writes in gets ONE acknowledgement
--                             email right away (routes/commercial.ts
--                             acknowledgeEnquiry; the sentence is
--                             lib/commercial.ts ENQUIRY_ACK_SENTENCE)
--   invoice_reminders         the client is reminded −7 days, on the due date,
--   invoice_remind_after_days and +N days after it (commerce/lifecycle.ts
--                             runInvoiceReminders; one leg per day at most)
--   deal_nudges               the OWNER is nudged when an open deal has had no
--   deal_nudge_days           next step for N days (runDealFollowups)
--   stage_stale_days          {"lead":14,"qualified":14,"proposal":14,"contract":14}
--                             — the board's "Stalled" badge threshold per stage
--                             (pipeline.html / lib/sales_lifecycle.ts
--                             dealStaleAfter; absent = 14)
-- ADDITIVE and IDEMPOTENT (add column if not exists). The function degrades
-- honestly before this lands: the settings read retries without the columns,
-- and every automation reads as OFF — which is the default anyway.
alter table public.presence_settings
  add column if not exists auto_ack_enquiries boolean not null default false,
  add column if not exists invoice_reminders boolean not null default false,
  add column if not exists invoice_remind_after_days integer not null default 2,
  add column if not exists deal_nudges boolean not null default false,
  add column if not exists deal_nudge_days integer not null default 3,
  add column if not exists stage_stale_days jsonb not null default '{}'::jsonb;

comment on column public.presence_settings.auto_ack_enquiries is
  'Benchmark 2026-10 item 6, switch 1: acknowledge a new website enquiry by email right away (off by default). Sentence: lib/commercial.ts ENQUIRY_ACK_SENTENCE.';
comment on column public.presence_settings.invoice_reminders is
  'Switch 2: remind the client about an unpaid invoice 7 days before, on, and invoice_remind_after_days after its due date — one leg per day at most (off by default).';
comment on column public.presence_settings.invoice_remind_after_days is
  'Days after the due date for the third (last) invoice reminder. 1–90, default 2.';
comment on column public.presence_settings.deal_nudges is
  'Switch 3: nudge the owner when an open deal has had no next step for deal_nudge_days (off by default).';
comment on column public.presence_settings.deal_nudge_days is
  'Quiet days before a deal nudge. 1–90, default 3.';
comment on column public.presence_settings.stage_stale_days is
  'Benchmark item 13: per-stage "stale after N days" for the pipeline board badge, e.g. {"proposal": 7}. A stage not listed uses 14.';
