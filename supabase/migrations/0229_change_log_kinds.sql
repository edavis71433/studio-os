-- rollback: the narrower checks again, NOT VALID so the lines kept since stay where they are:
--           alter table public.presence_change_events drop constraint if exists presence_change_events_entity_type_check;
--           alter table public.presence_change_events add constraint presence_change_events_entity_type_check
--             check (entity_type in ('identity','location','offering','testimonial','faq','post','media','voice',
--                                    'redirect','settings','publish','restore','site','domain')) not valid;
--           alter table public.presence_change_events drop constraint if exists presence_change_events_action_check;
--           alter table public.presence_change_events add constraint presence_change_events_action_check
--             check (action in ('create','update','delete','hide','show','reorder','publish','restore')) not valid;
--           and 0206's presence_note_site_change() (it skipped only publish and restore).
--
-- ── Every change the website makes reaches its change log (builder list item 239) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the lines below are
-- refused as they always were, and the function's log now says so ("change_event_refused");
-- nothing else changes.
--
-- WHY
--   presence_change_events (0015, widened by 0018) names every kind of record and every
--   action it takes. The function grew past those lists, and about 25 of its writes were
--   refused without a word: a launch being staged, approved, scheduled or sent back; the
--   preview being updated, shared or password-protected; a saved section being saved,
--   changed or removed. The Changes page (item 215) reads this log, so none of them showed.
--
-- WHAT CHANGES
--   1. entity_type accepts 'launch', 'preview' and 'content_library' (saved sections).
--   2. action accepts 'approve', 'reject' and 'schedule' (a launch's steps).
--   3. The trigger that keeps presence_sites.last_change_at (0206) skips 'launch' and
--      'preview' as it skips 'publish' and 'restore': they are kept in the log but change
--      nothing in the draft, so they mustn't make a site look edited. A saved section does
--      count: a linked section shows the library's copy, so changing it changes what
--      publishes.
--   The customer, contact and deal lines the sales routes wrote on the studio's own site
--   are not let in: none is a change to a website, and each fact already lives in its own
--   record. The function no longer writes them.
--
-- Properties: additive (every existing value stays valid; no row is written, moved or
-- deleted), idempotent (drop if exists + add; create or replace), RLS untouched.

alter table public.presence_change_events
  drop constraint if exists presence_change_events_entity_type_check;
alter table public.presence_change_events
  add constraint presence_change_events_entity_type_check
  check (entity_type in ('identity','location','offering','testimonial','faq','post','media','voice',
                         'redirect','settings','publish','restore','site','domain',
                         'launch','preview','content_library'));

alter table public.presence_change_events
  drop constraint if exists presence_change_events_action_check;
alter table public.presence_change_events
  add constraint presence_change_events_action_check
  check (action in ('create','update','delete','hide','show','reorder','publish','restore',
                    'approve','reject','schedule'));

create or replace function public.presence_note_site_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type in ('publish', 'restore', 'launch', 'preview') then return new; end if;
  update public.presence_sites
     set last_change_at = greatest(coalesce(last_change_at, new.created_at), new.created_at),
         unfinished_sections = null
   where id = new.site_id;
  return new;
end $$;
revoke all on function public.presence_note_site_change() from public, anon, authenticated;   -- a trigger's own; nobody calls it

comment on constraint presence_change_events_entity_type_check on public.presence_change_events is
  'What a change line can be about. 0229 (item 239) added launch, preview and content_library (saved sections); launch and preview lines never move presence_sites.last_change_at.';
