-- ===========================================================================
--  APPLY PACK - migration 0229  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 239. IDEMPOTENT: each check
--  is dropped and added again and the trigger function is replaced, so it is
--  safe to re-run. No row changes.
--
--  Why: builder list item 239. About 25 kinds of change were refused by the
--  change log's checks without a word: a launch being staged, approved,
--  scheduled or sent back; the preview being updated, shared or
--  password-protected; a saved section being saved, changed or removed. The
--  Changes page reads this log. Launch and preview lines are kept but don't
--  make a site look edited (the last_change_at trigger skips them).
--
--  If the deploy goes first, nothing breaks: those lines are refused as before,
--  and the function's log says so ("change_event_refused").
--
--  Rollback (only if ever needed): the narrower checks again, NOT VALID so the
--  lines kept since stay where they are:
--    alter table public.presence_change_events drop constraint if exists presence_change_events_entity_type_check;
--    alter table public.presence_change_events add constraint presence_change_events_entity_type_check
--      check (entity_type in ('identity','location','offering','testimonial','faq','post','media','voice',
--                             'redirect','settings','publish','restore','site','domain')) not valid;
--    alter table public.presence_change_events drop constraint if exists presence_change_events_action_check;
--    alter table public.presence_change_events add constraint presence_change_events_action_check
--      check (action in ('create','update','delete','hide','show','reorder','publish','restore')) not valid;
--    and 0206's presence_note_site_change() (it skipped only publish and restore).
--
--  Covers: supabase/migrations/0229_change_log_kinds.sql
-- ===========================================================================

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
revoke all on function public.presence_note_site_change() from public, anon, authenticated;

comment on constraint presence_change_events_entity_type_check on public.presence_change_events is
  'What a change line can be about. 0229 (item 239) added launch, preview and content_library (saved sections); launch and preview lines never move presence_sites.last_change_at.';


-- Verify (expect two rows: entity_type naming launch, preview and content_library;
-- action naming approve, reject and schedule; and the function skipping launch and preview):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.presence_change_events'::regclass
--    and conname in ('presence_change_events_entity_type_check', 'presence_change_events_action_check');
-- select pg_get_functiondef('public.presence_note_site_change()'::regprocedure) like '%''launch'', ''preview''%' as skips_launch_and_preview;
