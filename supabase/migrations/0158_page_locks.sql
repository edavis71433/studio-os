-- ── Page passwords (builder list items 48 and 120, Nov 2026) ─────────────────
-- rollback: drop table if exists public.presence_page_locks;
--
-- A page that needs a password goes live sealed: its file holds the page encrypted with a
-- key made from the password (PBKDF2, supabase/functions/presence/lib/page_access.ts), and
-- the visitor's browser makes the same key from what they type. This table keeps the key and
-- its salt, one row per password set, so every publish can seal the page again. The password
-- itself is never stored. A page names its row by id (presence_settings.pages[].lock).
--
-- Deploy order: either way. Before this runs, setting a password answers 503 with a plain
-- "needs a one-time database update" sentence, and a publish keeps any password page off
-- the live site, since it can't be sealed.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it.

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
