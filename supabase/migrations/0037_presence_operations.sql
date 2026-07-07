-- ── 0037 — L2: Platform Operations & Commercial Readiness ───────────────────
-- Additive only. Four new tables; nothing existing changes. These carry the
-- internal machinery for AI capacity metering, the commercial capacity notice,
-- and unattended scheduled operations with a retry ledger.
--
-- COMMERCIAL LAW (constitution Part 5 + L1.5 audit): the customer never sees a
-- credit, a token, or a cost. Usage is metered INTERNALLY, per customer, and the
-- only thing that ever surfaces is one calm "you've outgrown this plan" notice.
-- All of these tables are service-role only EXCEPT presence_plan_notices, which
-- the customer reads (to see their own notice) — never the raw usage.

-- ── A. AI usage rollup — per customer, per month ────────────────────────────
-- The gate reads this (cheap): "generative operations this cycle" vs the plan's
-- generous envelope. Upserted on every metered call. NEVER exposed to clients.
create table if not exists public.presence_ai_usage (
  client_id uuid not null,
  period text not null,                       -- 'YYYY-MM' (UTC billing month)
  generative_ops int not null default 0,      -- the metered, capacity-bearing operations
  assistive_ops int not null default 0,       -- unlimited by policy; counted for analytics only
  input_tokens bigint not null default 0,     -- cost measurement (never shown to a customer)
  output_tokens bigint not null default 0,
  last_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, period)
);
comment on table public.presence_ai_usage is
  'L2. Internal AI usage rollup, per client per month. Drives the soft capacity check and cost measurement. Service-role only; a customer never sees credits/tokens (constitution Part 5).';

-- ── B. AI usage events — append-only detail (future reporting/billing) ──────
create table if not exists public.presence_ai_usage_events (
  id bigint generated always as identity primary key,
  site_id uuid,
  client_id uuid not null,
  agent text not null,                        -- 'writer' | 'editor' | 'coach' | 'reviewer' | 'guardian' | 'concierge'
  kind text not null check (kind in ('generative','assistive','analysis')),
  model text,
  input_tokens int,
  output_tokens int,
  cached boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.presence_ai_usage_events is
  'L2. Append-only per-call AI usage detail, attributed to a customer/workspace. Substrate for future reporting, billing, and analytics. Service-role only.';
create index if not exists presence_ai_usage_events_client_idx on public.presence_ai_usage_events (client_id, created_at);
create index if not exists presence_ai_usage_events_site_idx on public.presence_ai_usage_events (site_id, created_at);

-- ── C. Plan notices — the commercial capacity Moment surface ────────────────
-- Deliberately SEPARATE from presence_moments: the intelligence Moments are
-- evidence-grounded (evidence → recommendation → moment, a frozen chain). A
-- capacity notice is USAGE-grounded, so it lives on its own surface and never
-- pollutes the intelligence pipeline. The customer experiences it as one calm
-- card; architecturally it is not a Moment.
create table if not exists public.presence_plan_notices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  client_id uuid not null,
  kind text not null default 'capacity' check (kind in ('capacity')),
  period text not null,                       -- 'YYYY-MM' — one notice per customer per kind per month
  headline text not null,
  body text not null,
  status text not null default 'active' check (status in ('active','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, kind, period)
);
comment on table public.presence_plan_notices is
  'L2. The commercial capacity notice — "you''ve outgrown this plan". Usage-grounded, NOT an evidence Moment (kept off the intelligence pipeline by design). Customer-readable so the room can show it; never exposes usage numbers.';

alter table public.presence_plan_notices enable row level security;
create policy presence_plan_notices_client_read on public.presence_plan_notices
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_plan_notices to authenticated;

-- ── D. Scheduled runs — the ops run ledger + retry queue ────────────────────
-- One row per scheduled unit of work. Records outcome, attempts, and errors so
-- the platform can retry failures and an operator can see what happened while
-- no one was watching. Service-role only.
create table if not exists public.presence_scheduled_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,                     -- 'observe' | 'moments' | 'coach' | 'health' | 'platform_check' | 'cycle'
  site_id uuid,                               -- null for global/platform runs
  status text not null default 'queued' check (status in ('queued','running','done','failed','skipped')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text not null default '',
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_scheduled_runs is
  'L2. Ledger + retry queue for unattended scheduled operations. Each row is one unit of work with its outcome; failures under max_attempts are retried; every run is explainable after the fact.';
create index if not exists presence_scheduled_runs_due_idx on public.presence_scheduled_runs (status, scheduled_for);
create index if not exists presence_scheduled_runs_site_idx on public.presence_scheduled_runs (site_id, created_at);

-- ── E. Atomic usage incrementer ────────────────────────────────────────────
-- One call per metered AI operation: upsert the monthly rollup, incrementing
-- in place (race-free, unlike read-modify-write over REST). Also appends the
-- detail event. SECURITY DEFINER, service_role only — clients can never touch it.
create or replace function public.presence_ai_meter(
  p_client_id uuid,
  p_site_id uuid,
  p_period text,
  p_agent text,
  p_kind text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.presence_ai_usage
    (client_id, period, generative_ops, assistive_ops, input_tokens, output_tokens, last_at)
  values (
    p_client_id, p_period,
    case when p_kind = 'generative' then 1 else 0 end,
    case when p_kind = 'assistive'  then 1 else 0 end,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), now()
  )
  on conflict (client_id, period) do update set
    generative_ops = public.presence_ai_usage.generative_ops + (case when p_kind = 'generative' then 1 else 0 end),
    assistive_ops  = public.presence_ai_usage.assistive_ops  + (case when p_kind = 'assistive'  then 1 else 0 end),
    input_tokens   = public.presence_ai_usage.input_tokens   + coalesce(p_input_tokens, 0),
    output_tokens  = public.presence_ai_usage.output_tokens  + coalesce(p_output_tokens, 0),
    last_at = now(),
    updated_at = now();

  insert into public.presence_ai_usage_events
    (site_id, client_id, agent, kind, model, input_tokens, output_tokens)
  values (p_site_id, p_client_id, p_agent, p_kind, p_model, p_input_tokens, p_output_tokens);
end;
$$;
revoke all on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int) from public;
grant execute on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int) to service_role;

-- touch triggers (updated_at maintenance)
do $$ begin
  create trigger presence_ai_usage_touch before update on public.presence_ai_usage
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_plan_notices_touch before update on public.presence_plan_notices
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_scheduled_runs_touch before update on public.presence_scheduled_runs
    for each row execute function public.presence_touch_updated_at();
exception when duplicate_object then null;
end $$;

-- ROLLBACK (reference):
--   drop table if exists public.presence_scheduled_runs;
--   drop table if exists public.presence_plan_notices;
--   drop table if exists public.presence_ai_usage_events;
--   drop table if exists public.presence_ai_usage;
