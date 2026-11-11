-- rollback: drop table if exists public.presence_ai_checks;
--
-- ── AI answers over time (builder list item 182) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands the monthly AI
-- check doesn't run (it has nowhere to keep its answers) and the Search tab's AI card
-- shows the latest free-tool result as it does today.
--
-- WHAT CHANGES
--   presence_ai_checks: one row per client site per month, for clients the studio
--     switched the monthly AI check on for: when it ran, which assistants answered,
--     how many of the client's questions there were and how many named the business,
--     each question's answers (yes or no, a short piece of what was said, who was named
--     instead), the full report's id and what the check cost. RLS on, nothing granted
--     to anon or signed-in users; the function's own key reads and writes it.
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
