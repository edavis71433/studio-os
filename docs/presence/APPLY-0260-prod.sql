-- ===========================================================================
--  APPLY PACK - migration 0260  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), FIRST: before
--  APPLY-0261 and before the deploy.yml run that ships builder items 416, 417 and 420.
--  IDEMPOTENT: safe to re-run (a second run counts the run and changes nothing else).
--
--  Why: builder list item 420. Database changes reach production by hand, and nothing
--  recorded which ones ran: Supabase's own list stops at change 72, one pack once ran in
--  the wrong project, one "success" was an empty tab. From now on every change writes
--  its number into presence_change_ledger when it runs. The health answer and the
--  Health page show the newest number, and the release refuses to go out while the
--  code's newest change isn't written here.
--
--  What it does:
--    1. creates presence_change_ledger and presence_ledger_note() (service role only);
--    2. writes down, as "backfill", the changes production already had before the
--       ledger existed (the list below, as the coordinating session read it on Nov 22);
--    3. writes down 0260 itself.
--
--  Check first that the editor's top bar says davis-digital-studio (production).
--
--  Rollback (only if ever needed):
--    drop function if exists public.presence_ledger_note(int, text);
--    drop table if exists public.presence_change_ledger;
--
--  Covers: supabase/migrations/0260_change_ledger.sql
-- ===========================================================================

create table if not exists public.presence_change_ledger (
  number int primary key check (number between 1 and 9999),
  name text not null default '',
  how text not null default 'pack' check (how in ('pack', 'backfill')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  runs int not null default 1 check (runs >= 1)
);

alter table public.presence_change_ledger enable row level security;   -- deny-all; the service role passes RLS
revoke all on table public.presence_change_ledger from public, anon, authenticated;
grant select, insert, update on table public.presence_change_ledger to service_role;

comment on table public.presence_change_ledger is
  'Builder list item 420: which database changes this database has, by number. Each migration and apply pack from 0260 on writes its own row (presence_ledger_note); older ones were backfilled once.';

create or replace function public.presence_ledger_note(p_number int, p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.presence_change_ledger as l (number, name)
  values (p_number, coalesce(p_name, ''))
  on conflict (number) do update
    set last_at = now(), runs = l.runs + 1, name = coalesce(nullif(excluded.name, ''), l.name);
$$;

revoke all on function public.presence_ledger_note(int, text) from public, anon, authenticated;
grant execute on function public.presence_ledger_note(int, text) to service_role;

-- 2. What production already had before the ledger (backfill; a re-run adds nothing).
-- BACKFILL-LIST-START
-- (filled in from the coordinating session's answer before this pack is run)
-- BACKFILL-LIST-END

-- 3. This change itself.
select public.presence_ledger_note(260, 'change_ledger');


-- Verify right away (expect: the table and the function; then 0260 with how = 'pack',
-- and the backfilled numbers with how = 'backfill'):
-- select to_regclass('public.presence_change_ledger'), to_regprocedure('public.presence_ledger_note(int, text)');
-- select how, count(*), min(number), max(number) from public.presence_change_ledger group by how order by how;
-- select number, name, how, runs from public.presence_change_ledger order by number desc limit 5;
