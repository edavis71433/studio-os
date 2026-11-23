-- ===========================================================================
--  APPLY PACK - migration 0287  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0260
--  (this writes into its ledger) and BEFORE the deploy.yml run that ships sales items 192,
--  201, 211 and 212 (the release refuses to go out until production's ledger has 287).
--  IDEMPOTENT ("add column if not exists", the constraint only when missing), additive,
--  safe to re-run.
--
--  Why: sales item 211. Each person gets one note, "Good to know about them", on their
--  record. AI help reads it whenever it drafts a reply to them or sums them up, and
--  "Download my data" carries it (sales item 212). One text column on presence_contacts,
--  empty for everyone until the owner writes one.
--
--  If the release went first nothing breaks: the record shows no note box, a save says it
--  needs a quick database update, and AI help goes on without the note.
--
--  Covers: supabase/migrations/0287_good_to_know.sql
-- ===========================================================================

alter table public.presence_contacts
  add column if not exists good_to_know text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'presence_contacts_good_to_know_len') then
    alter table public.presence_contacts add constraint presence_contacts_good_to_know_len check (char_length(good_to_know) <= 4000);
  end if;
end $$;

comment on column public.presence_contacts.good_to_know is
  'Sales item 211: the owner''s "Good to know about them" note on this person, which AI help reads for drafts and summaries. Empty = none. Function-mediated (PATCH /sales/contacts/:id).';

select public.presence_ledger_note(287, 'good_to_know');

-- Verify right away (expect: one row, good_to_know text, NO, ''::text; the constraint; then 287 in the ledger):
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_contacts' and column_name = 'good_to_know';
select conname from pg_constraint where conname = 'presence_contacts_good_to_know_len';
select max(number) as ledger_newest from public.presence_change_ledger;
