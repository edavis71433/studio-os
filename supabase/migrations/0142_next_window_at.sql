-- rollback:
--   drop index if exists public.presence_sites_window_due_idx;
--   alter table public.presence_sites drop column if exists next_window_at;
--
-- ── The timed-section sweep reads only the sites that need it (list item 90) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function works without it:
-- the sweep falls back to reading every live site, as it does today, and the
-- publish's write of this column is a separate best-effort one.
--
-- WHAT CHANGES
--   presence_sites.next_window_at (timestamptz, null until worked out): the next
--     instant a section on the live site appears or comes down (a show-from or
--     show-until time); 'infinity' when none ever will. Every live publish sets it
--     back to null, and the 15-minute sweep (ops/scheduler.ts runWindowExpiries)
--     reads only the live sites where it is null or has passed, works out the next
--     instant from the live snapshot, and stores it. Before, every tick read every
--     live site's publish and whole snapshot to find the few with a timed section.
--   presence_sites_window_due_idx: the sweep's read, over live sites only.
alter table public.presence_sites
  add column if not exists next_window_at timestamptz;

comment on column public.presence_sites.next_window_at is
  'List item 90: the next instant a timed section on the live site appears or comes down; infinity when none will; null until the sweep works it out (every live publish resets it).';

create index if not exists presence_sites_window_due_idx
  on public.presence_sites (next_window_at nulls first)
  where status = 'live';
