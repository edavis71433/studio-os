-- APPLY 0146 (production) — Snooze on Home's "Needs you" (sales list item 70).
-- Safe to run more than once. One new, empty table; nothing existing changes.
-- Paste into Supabase → SQL Editor → Run.
create table if not exists public.presence_needs_snoozes (
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  row_key text not null check (char_length(row_key) between 3 and 320),
  until timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (agency_id, row_key)
);
create index if not exists presence_needs_snoozes_wake on public.presence_needs_snoozes (agency_id, until);
alter table public.presence_needs_snoozes enable row level security;
comment on table public.presence_needs_snoozes is
  'Home''s Snooze (item 70): a needs-you row key held back until a time, studio-wide. Service role only.';

-- Check: one row — the table, with row level security on and no policies.
select c.relname as table_name, c.relrowsecurity as rls_on,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'presence_needs_snoozes';
