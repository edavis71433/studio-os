-- rollback: delete from public.presence_search_terms where dimension = 'query_page';
--           alter table public.presence_search_terms drop constraint if exists presence_search_terms_dimension_check;
--           alter table public.presence_search_terms add constraint presence_search_terms_dimension_check
--             check (dimension in ('query', 'page', 'country', 'device'));
--
-- ── Each search with the page Google showed for it (builder list item 219) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the daily Search
-- Console sync's extra write is refused and left alone, and the Search tab's "Almost on
-- page one" card waits for the pairs; nothing else changes.
--
-- WHY
--   The Search tab lists searches where Google shows a client's site at places 8 to 20,
--   each with the page to improve. Search Console names that page only when asked for the
--   search and the page together, and presence_search_terms (0067) keeps one dimension
--   per row: query, page, country or device.
--
-- WHAT CHANGES
--   presence_search_terms.dimension accepts 'query_page': the key is the search, a tab,
--   then the page's address. The sync keeps the month's pairs Google placed within 30,
--   at most 250 a month a client, and the 13-month clear-out (ops/retention.ts) already
--   covers them.
alter table public.presence_search_terms
  drop constraint if exists presence_search_terms_dimension_check;

alter table public.presence_search_terms
  add constraint presence_search_terms_dimension_check
  check (dimension in ('query', 'page', 'country', 'device', 'query_page'));

comment on column public.presence_search_terms.dimension is
  'query, page, country or device: one Search Console breakdown a row. query_page (0220, item 219): the key is the search, a tab, then the page Google showed for it.';
