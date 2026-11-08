-- ===========================================================================
--  APPLY PACK - migration 0140  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor), before or after the deploy of the
--  sales speed batch (PR "batch B"). Order doesn't matter: the function works
--  the same with or without these. ADDITIVE and IDEMPOTENT ("if not exists"),
--  safe to re-run. Adds two small indexes; changes no data.
--
--  What it does:
--   1. The "new enquiries" reads (Home's Needs you and a few others) stop
--      walking every enquiry a site ever received.
--   2. Opening a private calendar link stops scanning every studio's saved
--      templates to find it.
--
--  Rollback (only if ever needed):
--    drop index if exists public.presence_form_submissions_new_idx;
--    drop index if exists public.presence_sales_templates_calendar_feed_idx;
--
--  Covers: supabase/migrations/0140_two_read_indexes.sql
-- ===========================================================================

create index if not exists presence_form_submissions_new_idx
  on public.presence_form_submissions (site_id, created_at desc)
  where status = 'new' and spam = false;

create index if not exists presence_sales_templates_calendar_feed_idx
  on public.presence_sales_templates (kind)
  where name = '__calendar_feed__' and deleted_at is null;

-- Verify (expect 2 rows):
select indexname from pg_indexes
  where schemaname = 'public'
    and indexname in ('presence_form_submissions_new_idx', 'presence_sales_templates_calendar_feed_idx')
  order by indexname;
