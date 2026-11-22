-- ===========================================================================
--  APPLY PACK - migration 0248  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the short portal address. ADDITIVE and
--  IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing existing
--  changes: one nullable column on presence_sites and one unique index.
--
--  Why: builder list item 350. A studio picks a short name for its client
--  portal's address (app.example/portal/<name>) in Settings; the long address
--  with the site id keeps working.
--
--  If the deploy goes first, nothing breaks: Settings says the short name isn't
--  switched on yet, and every address stays the long one.
--
--  Rollback (only if ever needed):
--    drop index if exists public.presence_sites_portal_slug_uq;
--    alter table public.presence_sites drop column if exists portal_slug;
--
--  Covers: supabase/migrations/0248_portal_slug.sql
-- ===========================================================================

alter table public.presence_sites add column if not exists portal_slug text;
create unique index if not exists presence_sites_portal_slug_uq on public.presence_sites (lower(portal_slug)) where portal_slug is not null;
