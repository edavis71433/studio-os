-- ===========================================================================
--  APPLY PACK - migration 0206  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships item 209. IDEMPOTENT ("if not exists",
--  "create or replace", "drop trigger if exists"), so it is safe to re-run.
--
--  What it does, and how long it takes at production's sizes (Nov 12):
--   1. Two indexes. presence_moments has 136,901 rows (90 MB): its index took
--      about 7 seconds in a slow test copy of Postgres on Eric's Mac, and should
--      take a second or two here. While it builds, new moments wait (the health
--      check writes them, once a day per site); reads go on. presence_evidence
--      has about 9,000 rows (5 MB): under a second.
--   2. Two new, empty columns on presence_sites (8 rows): no time.
--   3. A trigger on presence_change_events keeps the site's latest change and
--      empties the unfinished count; the fill-in from the history (72 rows) is
--      instant.
--   4. A function for the visit counter's two limits.
--
--  Why: builder list item 209 (review file 06, findings 63, 82, 85, 86, 88).
--
--  Either order with the deploy is safe. If the deploy goes first, Home reads
--  each site's latest change the old way, the bell counts unfinished sections
--  on every open, and the visit counter makes its two calls, until this lands.
--
--  Rollback (only if ever needed):
--    drop function if exists public.rate_hit_both(text, integer, text, integer, timestamptz);
--    drop trigger if exists presence_change_events_site on public.presence_change_events;
--    drop function if exists public.presence_note_site_change();
--    alter table public.presence_sites drop column if exists last_change_at, drop column if exists unfinished_sections;
--    drop index if exists public.presence_moments_site_time_idx;
--    drop index if exists public.presence_evidence_type_time_idx;
--
--  Covers: supabase/migrations/0206_speed_fixes.sql
-- ===========================================================================

create index if not exists presence_moments_site_time_idx
  on public.presence_moments (site_id, created_at desc);
create index if not exists presence_evidence_type_time_idx
  on public.presence_evidence (type, observed_at desc);

alter table public.presence_sites
  add column if not exists last_change_at timestamptz,
  add column if not exists unfinished_sections integer;

comment on column public.presence_sites.last_change_at is
  'Item 209: the time of the site''s latest change to its draft (trigger presence_change_events_site). A publish, a restore or a version''s name doesn''t count.';
comment on column public.presence_sites.unfinished_sections is
  'Item 209: how many sections need something before the site can publish. Empty = not counted since the latest change (the trigger empties it).';

create or replace function public.presence_note_site_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type in ('publish', 'restore') then return new; end if;
  update public.presence_sites
     set last_change_at = greatest(coalesce(last_change_at, new.created_at), new.created_at),
         unfinished_sections = null
   where id = new.site_id;
  return new;
end $$;
drop trigger if exists presence_change_events_site on public.presence_change_events;
create trigger presence_change_events_site after insert on public.presence_change_events
  for each row execute function public.presence_note_site_change();
revoke all on function public.presence_note_site_change() from public, anon, authenticated;   -- a trigger's own; nobody calls it

-- the history so far
update public.presence_sites s
   set last_change_at = e.at
  from (select site_id, max(created_at) as at
          from public.presence_change_events
         where entity_type not in ('publish', 'restore')
         group by site_id) e
 where e.site_id = s.id and s.last_change_at is distinct from e.at;

create or replace function public.rate_hit_both(p_first text, p_first_max integer, p_second text, p_second_max integer, p_window timestamptz)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.rate_hit(p_first, p_window, p_first_max) then return false; end if;
  return public.rate_hit(p_second, p_window, p_second_max);
end $$;
comment on function public.rate_hit_both(text, integer, text, integer, timestamptz) is
  'Item 209: two fixed-window limits in one call; the second is counted only when the first allows the hit (service role).';
-- 0141's lesson: production's default privileges give new functions to postgres only.
revoke all on function public.rate_hit_both(text, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.rate_hit_both(text, integer, text, integer, timestamptz) to service_role;


-- Verify (expect: both indexes; the two columns; the trigger; service = true, anon = false;
-- and every site with history has its latest change filled in):
-- select indexname from pg_indexes where schemaname = 'public' and indexname in ('presence_moments_site_time_idx', 'presence_evidence_type_time_idx');
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'presence_sites' and column_name in ('last_change_at', 'unfinished_sections');
-- select tgname from pg_trigger where tgname = 'presence_change_events_site';
-- select has_function_privilege('service_role', 'public.rate_hit_both(text, integer, text, integer, timestamptz)', 'execute') as service,
--        has_function_privilege('anon', 'public.rate_hit_both(text, integer, text, integer, timestamptz)', 'execute') as anon;
-- select count(*) filter (where last_change_at is null) as missing, count(*) as with_history
--   from public.presence_sites s where exists (select 1 from public.presence_change_events e where e.site_id = s.id and e.entity_type not in ('publish', 'restore'));
