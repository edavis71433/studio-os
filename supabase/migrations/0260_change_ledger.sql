-- rollback: drop function if exists public.presence_ledger_note(int, text); drop table if exists public.presence_change_ledger;
--
-- ── Which database changes production has: a ledger (builder list item 420) ─────
-- APPLY THIS FIRST, BEFORE 0261 AND BEFORE THE RELEASE THAT CARRIES IT. From this
-- change on, the release refuses to go out while the code's newest change isn't
-- written here (deploy.yml, "Database changes are in place").
--
-- WHY (Nov 22 2026 review, file 07, finding 14)
--   Database changes reach production by hand: someone pastes an apply pack into the
--   SQL editor. Nothing recorded which ones ran. Supabase's own list stops at change 72
--   of 245, the notes record one pack run in the wrong project (Nov 9) and one
--   "success" that was an empty tab (Oct 20), and the server copes by asking "does
--   this column exist yet?" in many places.
--
-- WHAT CHANGES
--   presence_change_ledger: one row per change, by its number. Every migration and every
--   apply pack from 0260 on ends with `select public.presence_ledger_note(<number>,
--   '<name>');`, so running one writes its number down (a second run counts the run and
--   changes nothing else). Packs before 0260 are written down once, as "backfill", by
--   this change's apply pack, from the list of what production already had.
--   The health answer and the Health page show the newest number (migration 0261), and
--   the release compares it with the newest file in supabase/migrations.
--   Only the service role (the server, the SQL editor) reads or writes it.

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

-- Writes a change's number down. A second run of the same change counts the run and moves last_at.
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

select public.presence_ledger_note(260, 'change_ledger');
