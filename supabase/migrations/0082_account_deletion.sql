-- ── P2-E W2: Account deletion lifecycle (execution, not just a request) ──────
-- The prior /commerce/delete-request wrote presence_entitlements.deletion_requested_at
-- and promised "within 30 days" — but NOTHING read it. This table is the
-- authoritative deletion state machine (operator-visible: pending/executing/
-- completed/failed/canceled) and survives anonymization so financial/audit
-- evidence + the deletion record are retained. Deny-all RLS; function-mediated.

create table if not exists public.presence_account_deletions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid,                                       -- the site at request time (may be gone after execution)
  requested_by text not null default '',
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,                 -- requested_at + cooling-off; executor acts at/after this
  status text not null default 'pending'
    check (status in ('pending','executing','completed','failed','canceled')),
  executed_at timestamptz,
  error text not null default '',
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- at most one OPEN deletion per client (idempotent request)
create unique index if not exists presence_account_deletions_open_uq
  on public.presence_account_deletions (client_id) where status in ('pending','executing');
create index if not exists presence_account_deletions_due_idx
  on public.presence_account_deletions (status, scheduled_for);
alter table public.presence_account_deletions enable row level security;  -- deny-all; function-mediated

do $$ begin
  create trigger presence_account_deletions_touch before update on public.presence_account_deletions for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- widen the entitlement status enum with a terminal 'deleted' state (the gate
-- treats anything that isn't active/paused as denied; 'deleted' is explicit).
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.presence_entitlements'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then execute 'alter table public.presence_entitlements drop constraint ' || quote_ident(c); end if;
  alter table public.presence_entitlements
    add constraint presence_entitlements_status_check check (status in ('active','paused','lapsed','deleted'));
exception when others then null;
end $$;

comment on table public.presence_account_deletions is
  'P2-E account deletion state machine. Cooling-off (cancelable) → executor revokes access, cancels Stripe, takes down the site, anonymizes PII, and RETAINS financial evidence. Deny-all RLS; function-mediated.';

-- rollback:
--   drop table if exists public.presence_account_deletions;
