-- rollback: alter table public.presence_visits drop column if exists label;
--           alter table public.presence_visits drop column if exists ms;
--           alter table public.presence_visits drop constraint if exists presence_visits_kind_check;
--           alter table public.presence_visits add constraint presence_visits_kind_check
--             check (kind in ('pageview','phone','email','cta','download','outbound'));
--
-- ── Button presses and time on a page (list item 157) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: a tap that names its button is written without the
-- name (routes/collect.ts), a button press or a page's time waits for this, and
-- Analytics' read of them fails quietly, so the page says nothing about buttons.
--
-- WHAT CHANGES
--   presence_visits.label (text, default ''): the words of the button, phone or
--     email link a visitor pressed, cleaned to one line of 60 characters.
--   presence_visits.ms (integer, null): how long a page stayed open and in view,
--     1 second to 30 minutes, on a 'leave' row sent once as the visitor leaves.
--   the kind check gains 'button' (a link drawn as a button that isn't a call,
--     an email or a download) and 'leave'.
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
