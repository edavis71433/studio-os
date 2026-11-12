-- 0175 — Follow-ups that go out on their own, and the auto-reply on from the start
-- (sales item 87, Nov 2026 review: file 01 finding 6, file 07 finding 14, Wix's recipes).
--
-- presence_settings
--   auto_ack_enquiries          now ON for a new site: a visitor who writes in gets the
--                               acknowledgement from the first enquiry. Sites that already
--                               have a settings row keep what they have.
--   auto_ack_message            the owner's own words for that acknowledgement; '' keeps the
--                               standard sentence (lib/commercial.ts ENQUIRY_ACK_SENTENCE).
--   enquiry_followups           two short follow-ups to an enquiry that goes quiet, in the
--   enquiry_followup_1_days     owner's words (day 3 and day 7 by default). They stop the
--   enquiry_followup_2_days     moment the person writes again, books, or the owner marks the
--   enquiry_followup_1_message  enquiry or presses Stop follow-ups ('' = the standard words,
--   enquiry_followup_2_message  lib/follow_ups.ts FOLLOWUP_WORDS).
--   invoice_overdue_repeat      a second reminder a week after the overdue one ("two reminders
--                               a week apart for an overdue invoice").
--   quote_expiry_reminders      one note a week before a proposal or estimate runs out.
-- Every new switch is off. The code reads these columns with a step-down
-- (commerce/lifecycle.ts automationSettingsFor, routes/content.ts), so nothing goes dark
-- ahead of the pack. Nothing here sends an email by itself.
alter table public.presence_settings alter column auto_ack_enquiries set default true;
alter table public.presence_settings
  add column if not exists auto_ack_message text not null default '',
  add column if not exists enquiry_followups boolean not null default false,
  add column if not exists enquiry_followup_1_days integer not null default 3,
  add column if not exists enquiry_followup_2_days integer not null default 7,
  add column if not exists enquiry_followup_1_message text not null default '',
  add column if not exists enquiry_followup_2_message text not null default '',
  add column if not exists invoice_overdue_repeat boolean not null default false,
  add column if not exists quote_expiry_reminders boolean not null default false;
alter table public.presence_settings drop constraint if exists presence_settings_followup_words_len;
alter table public.presence_settings
  add constraint presence_settings_followup_words_len
  check (char_length(auto_ack_message) <= 1200 and char_length(enquiry_followup_1_message) <= 1200 and char_length(enquiry_followup_2_message) <= 1200);
alter table public.presence_settings drop constraint if exists presence_settings_followup_days;
alter table public.presence_settings
  add constraint presence_settings_followup_days
  check (enquiry_followup_1_days between 1 and 14 and enquiry_followup_2_days between 3 and 30);

comment on column public.presence_settings.auto_ack_message is 'Sales item 87: the owner''s own words for the enquiry acknowledgement. Empty = the standard sentence.';
comment on column public.presence_settings.enquiry_followups is 'Sales item 87: two follow-ups to a quiet enquiry (days 1 and 2 below), stopped by a reply, a booking or the owner''s mark. Off by default.';
comment on column public.presence_settings.invoice_overdue_repeat is 'Sales item 87: a second unpaid-invoice reminder a week after the overdue one. Off by default.';
comment on column public.presence_settings.quote_expiry_reminders is 'Sales item 87: one note to the client a week before a sent proposal or estimate runs out. Off by default.';

-- rollback:
--   alter table public.presence_settings alter column auto_ack_enquiries set default false;
--   alter table public.presence_settings drop constraint if exists presence_settings_followup_days,
--     drop constraint if exists presence_settings_followup_words_len,
--     drop column if exists quote_expiry_reminders, drop column if exists invoice_overdue_repeat,
--     drop column if exists enquiry_followup_2_message, drop column if exists enquiry_followup_1_message,
--     drop column if exists enquiry_followup_2_days, drop column if exists enquiry_followup_1_days,
--     drop column if exists enquiry_followups, drop column if exists auto_ack_message;
