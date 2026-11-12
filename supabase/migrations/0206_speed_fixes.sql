-- 0206 — Smaller speed fixes (builder list item 209, Nov 12 2026 review, file 06
-- findings 63, 82, 85, 86 and 88).
--
-- 1. Two reads get a matching index. The review named the judgments and the
--    recommendations read by batch; item 206 (PR 362) made both name the site, and
--    production finds them in 0.2 ms now. Production's own statistics (Nov 12) name the
--    two reads that still have none:
--      presence_moments, a site's newest first: the moments engine's memory of what it
--      said before, the record page's notes and the timeline. 45,635 calls at 27 ms, each
--      reading and sorting every row of the site (35,205 rows for the busiest one).
--      presence_moments_site_time_idx serves all of them.
--      presence_evidence by kind and time, across every site: the email-protection nudge.
--      11,661 calls at 264 ms before item 206 cleared the table, each reading every recent
--      row. presence_evidence_type_time_idx serves it.
-- 2. presence_sites.last_change_at, the time of the site's own latest change. Home worked
--    it out from the newest 1,000 changes across every client, so while one site was busy
--    a quieter one dropped out and stopped showing that changes were waiting. Kept by the
--    trigger below. A publish, a restore or a version's new name isn't a change to the
--    draft: a publish's own history row used to make the site look unpublished again.
--    Filled in below from the history.
-- 3. presence_sites.unfinished_sections, how many sections need something before the site
--    can publish. The bell, the Inbox and Today rebuilt the whole draft on every open to
--    count them. Empty means not counted since the last change: the same trigger empties
--    it, and the next read that needs it works it out and keeps it (lib/unfinished.ts).
-- 4. rate_hit_both: the visit counter's two limits, the visitor's and the site's, in one
--    call. The second is counted only when the first allows the hit, as two calls did.

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

-- rollback:
--   drop function if exists public.rate_hit_both(text, integer, text, integer, timestamptz);
--   drop trigger if exists presence_change_events_site on public.presence_change_events;
--   drop function if exists public.presence_note_site_change();
--   alter table public.presence_sites drop column if exists last_change_at, drop column if exists unfinished_sections;
--   drop index if exists public.presence_moments_site_time_idx;
--   drop index if exists public.presence_evidence_type_time_idx;
