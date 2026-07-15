-- ── First-class deal tasks (#203) ───────────────────────────────────────────
-- Salesforce Activities parity: a deal (and its Client Record) had only a single
-- freeform "next step" string. This adds real to-dos — multiple, each with a due
-- date and a done-state — kept separate from PROJECT delivery tasks (presence_tasks,
-- which are post-sale). Additive; the code is deploy-order-tolerant (the tasks
-- section degrades to empty if this table doesn't exist yet).
create table if not exists public.presence_deal_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  deal_id uuid not null,
  title text not null,
  due_date date,
  status text not null default 'open',           -- open | done
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);
create index if not exists idx_deal_tasks_deal on public.presence_deal_tasks (site_id, deal_id) where deleted_at is null;
-- service-role only (the edge function bypasses RLS); no anon/authenticated policy.
alter table public.presence_deal_tasks enable row level security;
