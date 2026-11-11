-- ===========================================================================
--  APPLY PACK - migration 0156  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships button presses and time on page. ADDITIVE and IDEMPOTENT ("add
--  column if not exists"; the kind check is dropped and made again with two
--  more kinds), so it is safe to re-run. Nothing existing changes: every row
--  already stored stays as it is.
--
--  Why: list item 157. Each published site's visit counter now notes the words
--  of the button a visitor pressed and how long a page stayed open, so
--  Analytics can say which buttons work.
--
--  If the deploy goes first, nothing breaks: taps are kept as before (without
--  the button's words), and Analytics says nothing about buttons yet.
--
--  Rollback (only if ever needed):
--    alter table public.presence_visits drop column if exists label;
--    alter table public.presence_visits drop column if exists ms;
--    alter table public.presence_visits drop constraint if exists presence_visits_kind_check;
--    alter table public.presence_visits add constraint presence_visits_kind_check
--      check (kind in ('pageview','phone','email','cta','download','outbound'));
--
--  Covers: supabase/migrations/0156_button_presses_time_on_page.sql
-- ===========================================================================

alter table public.presence_visits
  add column if not exists label text not null default '';

alter table public.presence_visits
  add column if not exists ms integer;

alter table public.presence_visits
  drop constraint if exists presence_visits_kind_check;

alter table public.presence_visits
  add constraint presence_visits_kind_check
  check (kind in ('pageview','phone','email','cta','download','outbound','button','leave'));

comment on column public.presence_visits.label is
  'List item 157: the words of the button, phone or email link pressed (one line, 60 characters). Empty for everything else.';

comment on column public.presence_visits.ms is
  'List item 157: on a leave row, how long the page stayed open and in view, in milliseconds (1 s to 30 min).';

-- Verify (expect the two columns, and a check naming button and leave):
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'presence_visits' and column_name in ('label', 'ms');
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'presence_visits_kind_check';
