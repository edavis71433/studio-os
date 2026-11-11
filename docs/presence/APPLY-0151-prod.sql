-- APPLY 0151 (production) — Page passwords (builder list items 48 and 120).
-- Safe to run more than once. One new table; nothing existing changes.
-- Paste into Supabase -> SQL Editor -> Run.
create table if not exists public.presence_page_locks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  salt text not null check (char_length(salt) between 16 and 64),
  iterations int not null check (iterations between 100000 and 2000000),
  key text not null check (char_length(key) between 40 and 64),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists presence_page_locks_site on public.presence_page_locks (site_id, created_at desc);
alter table public.presence_page_locks enable row level security;
comment on table public.presence_page_locks is
  'Page passwords (builder items 48 and 120): the salt and PBKDF2 key a password page is sealed with at publish. The password is never stored. Service role only; a page names its row in settings.pages[].lock.';

-- Check: the table exists with row security on and no policies (service role only).
select c.relrowsecurity as rls_on, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'presence_page_locks') as policies
from pg_class c where c.oid = 'public.presence_page_locks'::regclass;
