-- ═══════════════════════════════════════════════════════════════════════════
--  APPLY PACK · migration 0110  (owner-apply, staging + prod)
-- ═══════════════════════════════════════════════════════════════════════════
--  Run this ONCE on each environment (Supabase → SQL Editor, or psql).
--  Atelier becomes the DEFAULT template for NEW sites (Eric's pick).
--  Existing sites keep their pinned template — nothing re-renders.
--  Idempotent, safe to re-run. Pair with a presence function deploy
--  (templateSlugForIndustry now returns 'atelier' for non-food industries).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.presence_sites
  alter column template_slug set default 'atelier';

commit;

-- Verify (optional):
--   select column_default from information_schema.columns
--     where table_name='presence_sites' and column_name='template_slug';  -- 'atelier'::text
