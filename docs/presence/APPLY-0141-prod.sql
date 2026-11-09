-- ===========================================================================
--  APPLY PACK - migration 0141  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), BEFORE or WITH the deploy.yml run
--  that ships the timed-section sweep change. ADDITIVE and IDEMPOTENT ("if not
--  exists"), so it is safe to re-run. Nothing existing changes: one new column
--  on presence_sites, empty to start, and one index over live sites.
--
--  Why: list item 90. Every 15 minutes the sweep that brings timed sections up
--  and down read every live site's latest publish and its whole saved snapshot.
--  With this column it reads only the sites whose next show-from or show-until
--  time has come, or isn't known yet. On the first ticks it works out each live
--  site's time once.
--
--  If the deploy goes first, nothing breaks: the sweep reads every live site as
--  it does today until this column exists.
--
--  Rollback (only if ever needed):
--    drop index if exists public.presence_sites_window_due_idx;
--    alter table public.presence_sites drop column if exists next_window_at;
--
--  Covers: supabase/migrations/0141_next_window_at.sql
-- ===========================================================================

alter table public.presence_sites
  add column if not exists next_window_at timestamptz;

comment on column public.presence_sites.next_window_at is
  'List item 90: the next instant a timed section on the live site appears or comes down; infinity when none will; null until the sweep works it out (every live publish resets it).';

create index if not exists presence_sites_window_due_idx
  on public.presence_sites (next_window_at nulls first)
  where status = 'live';

-- Verify (expect 1 row: next_window_at, timestamp with time zone):
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_sites' and column_name = 'next_window_at';
