-- ===========================================================================
--  APPLY PACK - migration 0172  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships AI answers over time. ADDITIVE and
--  IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing existing
--  changes: one new table.
--
--  Why: builder list item 182. For clients the studio switches it on for, the AI
--  check runs again each month on the client's own questions, and the Search tab
--  charts it and shows what Claude said.
--
--  If the deploy goes first, nothing breaks: the monthly check waits for this
--  table, and the Search tab shows the latest free-tool result as before.
--
--  Rollback (only if ever needed):
--    drop table if exists public.presence_ai_checks;
--
--  Covers: supabase/migrations/0172_ai_checks.sql
-- ===========================================================================

create table if not exists public.presence_ai_checks (
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  checked_at timestamptz not null default now(),
  report_id uuid references public.tool_reports(id) on delete set null,
  engines text[] not null default '{}',
  asked smallint not null default 0,
  named smallint not null default 0,
  results jsonb not null default '[]'::jsonb,
  cost_usd numeric(8,4),
  primary key (site_id, month)
);

alter table public.presence_ai_checks enable row level security;
revoke all on public.presence_ai_checks from anon, authenticated;

comment on table public.presence_ai_checks is
  'List item 182: per client site per month, the monthly AI check: the questions, each assistant''s yes or no and what it said, how many named the business, the report and its cost. Written by ops/ai_checks.ts (service role) only.';


-- Verify (expect: true, the table with RLS on):
-- select relrowsecurity from pg_class where relname = 'presence_ai_checks';
