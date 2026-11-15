-- ===========================================================================
--  APPLY PACK - migration 0221  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships update templates. ADDITIVE and IDEMPOTENT
--  ("if not exists"), so it is safe to re-run. Nothing existing changes: one new
--  table and its index.
--
--  Why: builder list item 221. A studio keeps a good update as a template and
--  starts an update for any client from it, on Send an update.
--
--  If the deploy goes first, nothing breaks: Templates says templates aren't
--  switched on yet and keeps nothing. The welcome email needs no database step.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_update_templates;
--
--  Covers: supabase/migrations/0221_update_templates.sql
-- ===========================================================================

create table if not exists public.presence_update_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  created_from_site uuid references public.presence_sites(id) on delete set null,
  from_name text not null default '' check (char_length(from_name) <= 200),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_update_templates_agency_idx on public.presence_update_templates (agency_id, created_at desc);

alter table public.presence_update_templates enable row level security;
revoke all on public.presence_update_templates from anon, authenticated;

comment on table public.presence_update_templates is
  'List item 221: updates a studio kept as templates, to start an update for any client. Subject and words with their fill-ins; never photos. Written by agency/update_templates.ts (service role) only.';


-- Check (expect: true, then 0 rows):
-- select relrowsecurity from pg_class where relname = 'presence_update_templates';
-- select count(*) from public.presence_update_templates;
