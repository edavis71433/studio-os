-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0112  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  G11 per-section annotations & review comments:
--    • presence_section_comments — comment threads on the DRAFT, keyed by
--      page slug + stable section (block) id; block_id null/'' = whole page.
--      author_kind 'operator' (signed-in, /comments) or 'client' (via the
--      signed, expiring /p/s/:token share link — no account needed).
--    • RLS enabled with NO policies — service-role mediated only (the edge
--      function is the sole reader/writer, like presence_deal_tasks in 0108).
--  Additive, idempotent, safe to re-run. Pair with a presence function deploy
--  (routes: GET/POST /comments · POST /comments/:id/resolve|delete ·
--   GET /p/s/:token/sections · POST /p/s/:token/comments).
--  Until this is applied, those routes return calm empty lists / write_failed
--  and everything that exists today keeps working unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.presence_section_comments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  page_slug text not null default '',            -- '' = the home page
  block_id text,                                 -- stable section id; null/'' = whole page
  author_kind text not null check (author_kind in ('operator','client')),
  author_key text,                               -- operator: user id/email; client: not stored (no PII)
  body text not null,                            -- ≤2000 chars, enforced in code
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  deleted_at timestamptz
);

create index if not exists idx_section_comments_site_status
  on public.presence_section_comments (site_id, status) where deleted_at is null;

alter table public.presence_section_comments enable row level security;

commit;

-- Verify (optional):
--   select relrowsecurity from pg_class where relname='presence_section_comments';  -- t
--   select count(*) from pg_policies where tablename='presence_section_comments';   -- 0 (deny-all; service role only)
--   select indexname from pg_indexes where tablename='presence_section_comments';   -- idx_section_comments_site_status
