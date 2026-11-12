-- ===========================================================================
--  APPLY PACK - migration 0217  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships saved pages. ADDITIVE and IDEMPOTENT
--  ("if not exists"), so it is safe to re-run. Nothing existing changes: one new
--  table and its index.
--
--  Why: builder list item 216. A studio saves a page (a salon's services, a
--  restaurant's menu) and adds it to any client's site from Add a page.
--
--  If the deploy goes first, nothing breaks: "Save to your studio" says saved
--  pages aren't switched on yet, and Add a page shows no Saved group.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_saved_pages;
--
--  Covers: supabase/migrations/0217_saved_pages.sql
-- ===========================================================================

create table if not exists public.presence_saved_pages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  purpose text not null check (purpose in ('introduce', 'sell', 'show', 'home')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_from_site uuid references public.presence_sites(id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_saved_pages_agency_idx on public.presence_saved_pages (agency_id, created_at desc);

alter table public.presence_saved_pages enable row level security;
revoke all on public.presence_saved_pages from anon, authenticated;

comment on table public.presence_saved_pages is
  'List item 216: pages a studio saved to add to any client''s site. payload = { v, title, from_name, blocks, library, media (copies in templates/<agency id>/), outline, summary }. Business details never travel. Written by agency/saved_pages.ts (service role) only.';


-- Verify (expect: true, the table with RLS on, and 0 rows):
-- select relrowsecurity from pg_class where relname = 'presence_saved_pages';
-- select count(*) from public.presence_saved_pages;
