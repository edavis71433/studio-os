-- ── 0036 — L1: Self-Serve Signup & Commerce storage ─────────────────────────
-- Additive only. New columns on presence_entitlements (all with defaults, so
-- every existing row stays valid), plus two new tables. Nothing existing is
-- altered or dropped; the entitlement status CHECK (active/paused/lapsed) and
-- the boundary gate that reads it are untouched.
--
-- COMMERCIAL CONSTITUTION binds this migration (docs/presence/constitution/
-- 02-commercial-constitution.md):
--   • Bill the SITE, not the seat (§3.1). site_limit already exists.
--   • Monthly and annual terms (§3.2). No metered anything (Law 20).
--   • Founders = a permanent RATE LOCK, never a feature fork (§3.3) — one
--     boolean, no second product.
--   • The lifecycle ladder (§3.5) maps onto the EXISTING three states:
--       active           = paid, full
--       active + grace_until (future date) = past-due, still full + gentle banner
--       paused           = voluntary hold, read-only
--       lapsed           = grace exhausted, read-only + export
--     No new status value is needed; billing drives these three.
--   • Enterprise is never self-serve (§3.11); Agency is wholesale/referral
--     (§3.10). The `plan` column names all five rungs; which are self-serve is
--     a code decision (commerce/catalog.ts), not a schema one.

-- ── A. The plan dimension + billing linkage on the entitlement ──────────────
-- The entitlement IS the billing state (one per client+product). We add the
-- rung, the term, the founder rate-lock, the trial clock, and the Stripe
-- handles the webhook needs to reconcile — rather than a parallel table that
-- could disagree with the gate the whole platform already trusts.
alter table public.presence_entitlements
  add column if not exists plan text not null default 'presence'
    check (plan in ('presence_monitor','presence','presence_managed','agency','enterprise'));
comment on column public.presence_entitlements.plan is
  'L1. The commercial rung. Drives the site edition and the feature summary; billing sets it. Existing rows default to ''presence''. Agency/Enterprise are provisioned by sales, not self-serve.';

alter table public.presence_entitlements
  add column if not exists term text check (term in ('monthly','annual'));
alter table public.presence_entitlements
  add column if not exists founder boolean not null default false;
alter table public.presence_entitlements
  add column if not exists trial_ends_at timestamptz;
alter table public.presence_entitlements
  add column if not exists stripe_customer_id text;
alter table public.presence_entitlements
  add column if not exists stripe_subscription_id text;
alter table public.presence_entitlements
  add column if not exists current_period_end timestamptz;
alter table public.presence_entitlements
  add column if not exists cancel_at_period_end boolean not null default false;
alter table public.presence_entitlements
  add column if not exists canceled_at timestamptz;
comment on column public.presence_entitlements.founder is
  'L1. A permanent rate lock earned by the first cohort (§3.3) — held for the life of a continuous subscription. Never a feature fork: founders get the same product, at a locked price.';
comment on column public.presence_entitlements.trial_ends_at is
  'L1. When set, the entitlement is a trial (no card). Per §3.4 the trial converts when the customer commits (connects a custom domain / adds a card); it never card-holds upfront.';

create index if not exists presence_entitlements_stripe_sub_idx
  on public.presence_entitlements (stripe_subscription_id);
create index if not exists presence_entitlements_stripe_cust_idx
  on public.presence_entitlements (stripe_customer_id);

-- ── B. presence_signups — the self-serve funnel + provisioning idempotency ──
-- One row per signup attempt. It is the durable key that makes provisioning
-- safe to retry (webhook re-delivery, page refresh, a half-finished run): the
-- same signup resolves the same client and the same site, never a duplicate.
-- Service-role only (deny-all RLS) — it carries pre-account state and a verify
-- token that no client may read.
create table if not exists public.presence_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  plan text not null,
  term text,                                    -- monthly|annual|null (trial)
  business_name text not null default '',
  intent text not null default 'trial' check (intent in ('trial','paid')),
  auth_user_id uuid,                            -- the created auth.users id
  client_id uuid,                               -- the created/resolved clients row
  site_id uuid,                                 -- the provisioned presence_sites row
  stripe_customer_id text,
  stripe_session_id text,                       -- the Checkout session (paid intent)
  verify_token text,                            -- email-verification nonce (single use)
  verified_at timestamptz,
  status text not null default 'started'
    check (status in ('started','account_created','checkout_pending','provisioned','failed')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_signups is
  'L1. Self-serve signup funnel + provisioning idempotency key. Deny-all RLS: pre-account state and verify tokens are service-role only. Provisioning is rerunnable — a signup always resolves the same client and site.';

create index if not exists presence_signups_email_idx on public.presence_signups (lower(email));
create index if not exists presence_signups_session_idx on public.presence_signups (stripe_session_id);
create index if not exists presence_signups_verify_idx on public.presence_signups (verify_token);

-- ── C. presence_first_run — the welcome checklist state ─────────────────────
-- The checklist ITEMS are derived from live state (edition chosen, business
-- details entered, domain, published — like the agency onboarding checklist),
-- so nothing here duplicates truth. We persist only what live state can't tell
-- us: whether the customer has dismissed the welcome, and when they arrived.
create table if not exists public.presence_first_run (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  dismissed boolean not null default false,
  welcomed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_first_run is
  'L1. Per-site welcome state. Checklist items are computed from live state; this row only records dismissal + arrival. Client may read their own; writes flow through the presence function.';

alter table public.presence_first_run enable row level security;
create policy presence_first_run_client_read on public.presence_first_run
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_first_run to authenticated;

-- touch triggers (updated_at maintenance), matching the project convention
do $$ begin
  create trigger presence_signups_touch before update on public.presence_signups
    for each row execute function public.presence_touch_updated_at();
  create trigger presence_first_run_touch before update on public.presence_first_run
    for each row execute function public.presence_touch_updated_at();
exception when duplicate_object then null;
end $$;

-- ROLLBACK (for reference; forward-only in practice):
--   drop table if exists public.presence_first_run;
--   drop table if exists public.presence_signups;
--   alter table public.presence_entitlements
--     drop column if exists plan, drop column if exists term,
--     drop column if exists founder, drop column if exists trial_ends_at,
--     drop column if exists stripe_customer_id, drop column if exists stripe_subscription_id,
--     drop column if exists current_period_end, drop column if exists cancel_at_period_end,
--     drop column if exists canceled_at;
