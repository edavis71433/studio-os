-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0134  (owner-apply, prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE (Supabase → SQL Editor), before or with the deploy.yml run
--  that ships the presence function. ADDITIVE and IDEMPOTENT (add column
--  "if not exists"), so it is safe to re-run. The function degrades honestly
--  until this runs: the settings read retries without the new columns, and
--  every automation reads as OFF — which is the default anyway.
--
--  Why: Benchmark (Oct 2026) item 6 — three switches, not a workflow builder —
--  and item 13 — per-stage "stale after N days". Settings gains:
--    · Acknowledge new enquiries within a minute        (auto_ack_enquiries)
--    · Remind unpaid invoices −7 / due / +N days         (invoice_reminders,
--                                                         invoice_remind_after_days)
--    · Nudge me when a deal has had no next step for N   (deal_nudges,
--                                                         deal_nudge_days)
--    · the board's Stalled threshold per stage           (stage_stale_days)
--  Every switch is OFF until the owner turns it on in Settings.
--
--  Covers: supabase/migrations/0134_automation_switches.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- Verify (expect six rows):
-- select column_name, column_default from information_schema.columns
--   where table_schema='public' and table_name='presence_settings'
--     and column_name in ('auto_ack_enquiries','invoice_reminders','invoice_remind_after_days','deal_nudges','deal_nudge_days','stage_stale_days');
