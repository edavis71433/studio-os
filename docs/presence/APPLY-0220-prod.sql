-- ===========================================================================
--  APPLY PACK - migration 0220  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the near-miss searches. IDEMPOTENT: the
--  check is dropped and added again, so it is safe to re-run. No row changes.
--
--  Why: builder list item 219. The Search tab lists searches where Google shows
--  a client's site at places 8 to 20, with the page to improve. The daily
--  Search Console sync now keeps each search with the page Google showed for
--  it, as dimension 'query_page'.
--
--  If the deploy goes first, nothing breaks: the sync's extra write is refused
--  and left alone, and "Almost on page one" waits until this has run and the
--  next sync has kept a month of pairs.
--
--  Rollback (only if ever needed):
--    delete from public.presence_search_terms where dimension = 'query_page';
--    alter table public.presence_search_terms drop constraint if exists presence_search_terms_dimension_check;
--    alter table public.presence_search_terms add constraint presence_search_terms_dimension_check
--      check (dimension in ('query', 'page', 'country', 'device'));
--
--  Covers: supabase/migrations/0220_search_page_pairs.sql
-- ===========================================================================

alter table public.presence_search_terms
  drop constraint if exists presence_search_terms_dimension_check;

alter table public.presence_search_terms
  add constraint presence_search_terms_dimension_check
  check (dimension in ('query', 'page', 'country', 'device', 'query_page'));

comment on column public.presence_search_terms.dimension is
  'query, page, country or device: one Search Console breakdown a row. query_page (0220, item 219): the key is the search, a tab, then the page Google showed for it.';


-- Verify (expect one row whose check lists query_page):
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.presence_search_terms'::regclass and conname = 'presence_search_terms_dimension_check';
