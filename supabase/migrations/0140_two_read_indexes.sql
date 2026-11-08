-- rollback:
--   drop index if exists public.presence_form_submissions_new_idx;
--   drop index if exists public.presence_sales_templates_calendar_feed_idx;
--
-- -- Final pass on the sales side (Nov 8 2026), speed batch B ----------------
-- Two indexes. Nothing else changes, and the function works the same with or
-- without them: they only make two reads cheaper as the platform grows.
--
-- WHAT CHANGES
--   1. presence_form_submissions_new_idx: the "new enquiries" reads (Home's
--      Needs you, the coach, the daily lifecycle checks) ask for the enquiries
--      still marked new. The only index covered every enquiry a site ever
--      received, so each read walked the whole history. This one holds only
--      the new, non-spam ones.
--   2. presence_sales_templates_calendar_feed_idx: a private calendar link is
--      looked up by its secret across every studio's settings rows. This index
--      holds only the calendar-link rows (one per studio), so the lookup reads
--      those instead of scanning every studio's saved templates.

create index if not exists presence_form_submissions_new_idx
  on public.presence_form_submissions (site_id, created_at desc)
  where status = 'new' and spam = false;

create index if not exists presence_sales_templates_calendar_feed_idx
  on public.presence_sales_templates (kind)
  where name = '__calendar_feed__' and deleted_at is null;
