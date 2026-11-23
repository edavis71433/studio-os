-- 0273 — Correcting a logged call, email, meeting or note (sales item 186), Nov 22 2026 review.
--
-- A call, email, meeting or note logged by hand can now be corrected or removed by the person
-- who logged it (PATCH /sales/logs/:id). A deal's own logs keep the marks in their deal event's
-- detail (edited_at, edited_by; a removed one keeps its words under detail.removed), so they need
-- nothing here. The logs of a person or a customer with no deal (presence_person_events, 0173)
-- get two columns, so the line can say it was edited, and by whom. A removed one uses the
-- deleted_at it always had, and Recently deleted lists it for 30 days.
--
-- Additive and idempotent. The code tolerates it not being applied yet: a correction still
-- saves, without the "edited" mark, and the reads leave the column out.
--
-- rollback (only once nothing reads the marks):
--   alter table public.presence_person_events drop column if exists edited_by, drop column if exists edited_at;

alter table public.presence_person_events
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text not null default '';

comment on column public.presence_person_events.edited_at is
  'Sales item 186: when this line was last corrected by the person who logged it (null = never).';
comment on column public.presence_person_events.edited_by is
  'Sales item 186: who corrected it (their sign-in email), empty when never corrected.';

select public.presence_ledger_note(273, 'log_corrections');
