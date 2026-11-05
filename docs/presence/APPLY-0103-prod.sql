-- =================================================================
--  APPLY PACK - migration 0103  (owner-apply, prod)
-- =================================================================
--  Run this ONCE (Supabase -> SQL Editor). ADDITIVE and IDEMPOTENT (add column
--  "if not exists"), so it is safe to re-run. No deploy is needed: the code
--  already asks for this column, so updates start loading as soon as it runs.
--
--  Why: production has no presence_posts.tags. Migration 0103 was never applied
--  and had no pack. GET /posts selects the column, so PostgREST answers 42703 and
--  the route answers 502 read_failed, for owners and studios alike. POST, PUT and
--  DELETE /posts select it for their reply too. Found 2026-11-05 by the PR #90
--  production re-test.
--
--  Safe for live content: existing posts get an empty list, which the serializer
--  reads exactly as it reads the missing column today, so no site's draft hash
--  moves and nothing shows as an unpublished change.
--
--  Covers: supabase/migrations/0103_post_tags.sql
-- =================================================================

alter table public.presence_posts
  add column if not exists tags text[] not null default '{}';

comment on column public.presence_posts.tags is
  'Phase SEARCH: flat update tags (normalized at API via normalizeTags). Feeds tag chips, the on-site search index, and RSS <category>.';

-- Verify. The 0103 row must say true.
--
-- The other rows are a READ-ONLY report and change nothing. They cover the other
-- migrations that have no pack, because 0103 shows a migration can be missed. A
-- false there means that migration needs its own pack. 0120 is not listed: it only
-- backfills data, so the schema can't show whether it ran.
with
  cols as (
    select table_name || '.' || column_name as name
    from information_schema.columns where table_schema = 'public'
  ),
  idx as (select indexname as name from pg_indexes where schemaname = 'public'),
  chk as (
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname in ('presence_plan_notices_kind_check', 'presence_deal_events_kind_check')
  ),
  notice as (select def from chk where conname = 'presence_plan_notices_kind_check'),
  deal as (select def from chk where conname = 'presence_deal_events_kind_check'),
  rel as (
    select c.relname, c.relrowsecurity, c.reloptions::text as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  )
select * from (values
  ('0102', 'notice kinds email_auth, apex_drift',
    coalesce((select def like '%email_auth%' and def like '%apex_drift%' from notice), false)),
  ('0103', 'presence_posts.tags (THIS PACK)',
    exists (select 1 from cols where name = 'presence_posts.tags')),
  ('0104', 'presence_settings.pages',
    exists (select 1 from cols where name = 'presence_settings.pages')),
  ('0105', 'presence_settings.nav',
    exists (select 1 from cols where name = 'presence_settings.nav')),
  ('0106', 'RLS on signups, ai_usage, ai_usage_events, scheduled_runs',
    (select count(*) = 4 from rel where relrowsecurity and relname in
      ('presence_signups', 'presence_ai_usage', 'presence_ai_usage_events', 'presence_scheduled_runs'))),
  ('0106', 'v_partnership_overview is security_invoker',
    coalesce((select opts ~ 'security_invoker=(on|true)' from rel where relname = 'v_partnership_overview'), false)),
  ('0115', 'support_requests.client_id, project_messages.external_id',
    (select count(*) = 2 from cols where name in
      ('presence_support_requests.client_id', 'presence_project_messages.external_id'))),
  ('0115', 'its two indexes',
    (select count(*) = 2 from idx where name in
      ('presence_support_client_idx', 'presence_project_messages_extid_uq'))),
  ('0116', 'notice kinds client_message, client_upload, client_request, client_approval',
    coalesce((select def like '%client_message%' and def like '%client_upload%'
      and def like '%client_request%' and def like '%client_approval%' from notice), false)),
  ('0117', 'deal event kinds proposal_deleted, contract_deleted',
    coalesce((select def like '%proposal_deleted%' and def like '%contract_deleted%' from deal), false)),
  ('0118', 'deal event kind invoice_voided',
    coalesce((select def like '%invoice_voided%' from deal), false)),
  ('0119', 'notice kind invoice_void_paid',
    coalesce((select def like '%invoice_void_paid%' from notice), false)),
  ('0123', 'index presence_tasks_project_checklist_uq',
    exists (select 1 from idx where name = 'presence_tasks_project_checklist_uq')),
  ('0127', 'notice kinds retainer_status, deal_task_due',
    coalesce((select def like '%retainer_status%' and def like '%deal_task_due%' from notice), false)),
  ('0128', 'presence_connections.config',
    exists (select 1 from cols where name = 'presence_connections.config'))
) as report(migration, what, on_production)
order by migration, what;
