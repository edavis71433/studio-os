-- APPLY 0175 (production) — Follow-ups and recipes (sales item 87).
-- Safe to run more than once. New site settings start with the enquiry auto-reply on;
-- every existing site keeps its own setting. Eight new settings, every switch off.
-- Nothing here sends an email. Paste into Supabase → SQL Editor → Run.
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

-- Check: nine rows. auto_ack_enquiries shows default true; the eight new columns are listed.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'presence_settings'
  and column_name in ('auto_ack_enquiries','auto_ack_message','enquiry_followups','enquiry_followup_1_days','enquiry_followup_2_days','enquiry_followup_1_message','enquiry_followup_2_message','invoice_overdue_repeat','quote_expiry_reminders')
order by column_name;
