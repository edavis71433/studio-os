-- ── L5.5 Industry Pack Marketplace Foundation ───────────────────────────────
-- Packs behave like installable software. Two tables: the current install STATE
-- per pack, and the Approved-Plan ledger for every state-changing operation.
-- The ledger reuses the FROZEN Approved-Plan spine (lib/approved_plan.ts) — the
-- same requires_approval CHECK, the same site_id + executed_at atomic-claim shape
-- as presence_connection_writes. No new approval system. Infrastructure, not
-- commerce: no payments, licensing, or subscriptions here.

-- current install state (one row per pack per scope; scope 'global' or a client id)
create table if not exists public.presence_pack_installs (
  pack_key text not null,
  scope text not null default 'global',
  version text not null,
  state text not null default 'installed'
    check (state in ('available','installed','enabled','disabled','update_available',
                     'deprecated','unsupported','incompatible','failed_validation','pending_approval','removing')),
  enabled boolean not null default true,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pack_key, scope)
);
comment on table public.presence_pack_installs is
  'L5.5. Current marketplace state of each Industry Pack (per scope). Managed only through Approved-Plan operations; deny-all RLS, function-mediated.';

-- the Approved-Plan ledger for marketplace operations (propose→approve→execute)
create table if not exists public.presence_pack_operations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,                 -- global ops use the all-zero sentinel; scoped ops use a client/site id (reuses the spine's claim)
  op text not null check (op in ('install','enable','disable','update','remove')),
  pack_key text not null,
  version text not null,
  title text not null,
  summary text not null,
  what_changes jsonb not null default '[]',
  what_stays jsonb not null default '[]',
  risk text not null default '',
  reversible boolean not null default true,
  rollback text not null default '',
  requires_approval boolean not null default true check (requires_approval = true),  -- the constitutional constant
  blocked jsonb not null default '[]',   -- non-empty ⇒ refused (assessment failed)
  status text not null default 'proposed'
    check (status in ('proposed','approved','abandoned','executed','failed')),
  executed_at timestamptz,               -- the atomic-claim column (lib/approved_plan.ts)
  decided_at timestamptz,
  result jsonb,                          -- outcome + verification, plain
  actor_kind text not null default 'operator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_pack_operations is
  'L5.5. Append-forward Approved-Plan ledger for marketplace operations — every install/enable/disable/update/remove is proposed, approved, atomically claimed, executed, and audited through the frozen spine. Deny-all RLS.';
create index if not exists presence_pack_operations_idx on public.presence_pack_operations (pack_key, status, created_at);

alter table public.presence_pack_installs enable row level security;     -- deny-all
alter table public.presence_pack_operations enable row level security;   -- deny-all

do $$ begin
  create trigger presence_pack_installs_touch before update on public.presence_pack_installs
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_pack_operations_touch before update on public.presence_pack_operations
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_pack_operations;
--   drop table if exists public.presence_pack_installs;
