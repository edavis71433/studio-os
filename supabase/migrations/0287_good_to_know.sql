-- 0287 — "Good to know about them" (sales item 211), Nov 22 2026 review.
--
-- AI help (Draft a reply, Where things stand) had nowhere to keep what it should know about a
-- person: that they prefer a text, that their partner pays the invoices, that the shop is closed
-- on Mondays. One note per person, on their record, beside "Where things stand"; every draft and
-- every summary for them reads it. It lives on the person (presence_contacts), so it goes when
-- they are deleted, a customer's record finds it through their person, and "Download my data"
-- carries it in contacts.csv (sales item 212). The studio's own "How I write, and my terms" is a
-- Settings box kept with the month's goal and needs nothing here.
--
-- Additive and idempotent. The code tolerates it not being applied yet: the record shows no box,
-- a save says it needs a quick database update, and AI help goes on without the note.
--
-- rollback (only once nothing reads the note):
--   alter table public.presence_contacts drop constraint if exists presence_contacts_good_to_know_len;
--   alter table public.presence_contacts drop column if exists good_to_know;

alter table public.presence_contacts
  add column if not exists good_to_know text not null default '';

-- the code keeps it to 1,000 characters (lib/sales_ai.ts GOOD_TO_KNOW_MAX); the database refuses a runaway
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'presence_contacts_good_to_know_len') then
    alter table public.presence_contacts add constraint presence_contacts_good_to_know_len check (char_length(good_to_know) <= 4000);
  end if;
end $$;

comment on column public.presence_contacts.good_to_know is
  'Sales item 211: the owner''s "Good to know about them" note on this person, which AI help reads for drafts and summaries. Empty = none. Function-mediated (PATCH /sales/contacts/:id).';

select public.presence_ledger_note(287, 'good_to_know');
