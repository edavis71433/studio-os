-- ===========================================================================
--  APPLY PACK - migration 0201  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships sales item 94. ADDITIVE and IDEMPOTENT
--  ("if not exists"), so it is safe to re-run. Nothing existing changes: one new
--  table that only the function can read or write. Takes under a second.
--
--  Why: sales item 94, AI help on the sales side ("Draft a reply" and "Where
--  things stand"). Each press is a row: the day's count keeps the limit of 50 a
--  day per studio, the month's cost shows in Settings, and a summary is kept so
--  the record shows it again without paying again. A draft's words are never kept.
--
--  If the deploy goes first, nothing breaks: AI help is off for every studio until
--  its owner switches it on, and until this lands a press answers "AI help isn't
--  ready yet" instead of calling Claude.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_sales_ai;
--
--  Covers: supabase/migrations/0201_sales_ai.sql
-- ===========================================================================

create table if not exists public.presence_sales_ai (
  id          uuid          primary key default gen_random_uuid(),
  site_id     uuid          not null references public.presence_sites (id) on delete cascade,
  kind        text          not null check (kind in ('draft', 'summary')),
  subject     text,
  body        text,
  cost_cents  numeric(8,3)  not null default 0,
  made_by     text,
  created_at  timestamptz   not null default now()
);
create index if not exists presence_sales_ai_site_idx on public.presence_sales_ai (site_id, created_at desc);
create index if not exists presence_sales_ai_summary_idx on public.presence_sales_ai (site_id, subject, created_at desc) where kind = 'summary';

alter table public.presence_sales_ai enable row level security;
revoke all on public.presence_sales_ai from anon, authenticated;
grant all on public.presence_sales_ai to service_role;

comment on table public.presence_sales_ai is
  'Sales item 94 (0201): one row per AI help press on the sales side (Draft a reply, Sum them up). Summaries keep their words; drafts never do. cost_cents from the tokens used. Service role only.';


-- Verify (expect rls = true, anon_select = false, service_select = true, kinds = 1):
-- select c.relrowsecurity as rls,
--        has_table_privilege('anon', 'public.presence_sales_ai', 'select') as anon_select,
--        has_table_privilege('service_role', 'public.presence_sales_ai', 'select') as service_select,
--        (select count(*) from pg_constraint where conrelid = 'public.presence_sales_ai'::regclass and contype = 'c') as kinds
--   from pg_class c where c.oid = 'public.presence_sales_ai'::regclass;
