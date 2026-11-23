-- ===========================================================================
--  APPLY PACK - migration 0273  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0260
--  (this writes into its ledger) and BEFORE the deploy.yml run that ships sales items 186,
--  188, 189, 190, 191, 200, 209 and 213 (the release refuses to go out until production's
--  ledger has 273). IDEMPOTENT ("add column if not exists"), additive, safe to re-run.
--
--  Why: sales item 186. A call, email, meeting or note logged for a person or a customer
--  with no deal (presence_person_events) can now be corrected by whoever logged it, and the
--  line says it was edited. These two columns hold that mark. A deal's own logs keep theirs
--  in the deal event's detail and need nothing here.
--
--  If the release went first nothing breaks: a correction saves without the mark, and the
--  record page reads the logs without the new column.
--
--  Covers: supabase/migrations/0273_log_corrections.sql
-- ===========================================================================

alter table public.presence_person_events
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text not null default '';

comment on column public.presence_person_events.edited_at is
  'Sales item 186: when this line was last corrected by the person who logged it (null = never).';
comment on column public.presence_person_events.edited_by is
  'Sales item 186: who corrected it (their sign-in email), empty when never corrected.';

select public.presence_ledger_note(273, 'log_corrections');

-- Verify right away (expect: two rows, edited_at timestamp with time zone and edited_by text; then 273 in the ledger):
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_person_events' and column_name in ('edited_at', 'edited_by')
 order by column_name;
select max(number) as ledger_newest from public.presence_change_ledger;
