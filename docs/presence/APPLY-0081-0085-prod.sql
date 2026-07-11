-- Combined P2-E/P2-F migrations 0081-0085 for PROD (paste into Supabase SQL Editor, Run once).
-- All additive/idempotent: create-if-not-exists, add-column-if-not-exists, and constraint-widen (drop+re-add, exception-guarded).

-- ═══════════════ 0081_ai_image_metering.sql ═══════════════
-- ── P2-E W1: AI image metering (close the cost-invisible Visual Studio path) ──
-- The usage ledger counted text ops + tokens but had NO image representation, so
-- gpt-image-1 spend (the most expensive AI op) was structurally $0 in every cost
-- report. Add an images counter to the rollup + per-event detail, and extend the
-- atomic meter RPC to increment it. Same ledger — no second AI accounting system.

alter table public.presence_ai_usage add column if not exists images int not null default 0;
alter table public.presence_ai_usage_events add column if not exists images int;

-- extend the atomic meter to carry images (drop + recreate to change the signature;
-- p_images defaults to 0 so every existing text caller is unaffected).
drop function if exists public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int);
create or replace function public.presence_ai_meter(
  p_client_id uuid,
  p_site_id uuid,
  p_period text,
  p_agent text,
  p_kind text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_images int default 0
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.presence_ai_usage
    (client_id, period, generative_ops, assistive_ops, input_tokens, output_tokens, images, last_at)
  values (
    p_client_id, p_period,
    case when p_kind = 'generative' then 1 else 0 end,
    case when p_kind = 'assistive'  then 1 else 0 end,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_images, 0), now()
  )
  on conflict (client_id, period) do update set
    generative_ops = public.presence_ai_usage.generative_ops + (case when p_kind = 'generative' then 1 else 0 end),
    assistive_ops  = public.presence_ai_usage.assistive_ops  + (case when p_kind = 'assistive'  then 1 else 0 end),
    input_tokens   = public.presence_ai_usage.input_tokens   + coalesce(p_input_tokens, 0),
    output_tokens  = public.presence_ai_usage.output_tokens  + coalesce(p_output_tokens, 0),
    images         = public.presence_ai_usage.images         + coalesce(p_images, 0),
    last_at = now(),
    updated_at = now();

  insert into public.presence_ai_usage_events
    (site_id, client_id, agent, kind, model, input_tokens, output_tokens, images)
  values (p_site_id, p_client_id, p_agent, p_kind, p_model, p_input_tokens, p_output_tokens, coalesce(p_images, 0));
end;
$$;
revoke all on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int) from public;
grant execute on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int) to service_role;

-- rollback:
--   drop function if exists public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int);
--   (recreate the 8-arg version from 0037); alter table presence_ai_usage drop column images;


-- ═══════════════ 0082_account_deletion.sql ═══════════════
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


-- ═══════════════ 0083_webhook_idempotency_claim.sql ═══════════════
-- ── P2-E W4: atomic webhook idempotency + livemode provenance ────────────────
-- The webhook used to SELECT stripe_webhook_events then, only after processing,
-- INSERT the row. Two concurrent duplicate deliveries could both pass the SELECT
-- and both process (M1). We move to a CLAIM-FIRST design: INSERT the row up front
-- (PK on event_id makes it atomic), and use a status to tell an in-flight claim
-- from a completed one so a mid-processing crash never permanently drops an event.
--
-- Additive only: new columns on an existing table, PK unchanged.

alter table public.stripe_webhook_events
  add column if not exists status text not null default 'processing',
  add column if not exists processed_at timestamptz,
  add column if not exists livemode boolean;

-- every row that already exists was written by the OLD code, which inserted only
-- AFTER successful processing — so they are, by definition, done.
update public.stripe_webhook_events set status = 'done', processed_at = coalesce(processed_at, received_at)
  where status = 'processing' and processed_at is null;

do $$ begin
  alter table public.stripe_webhook_events
    add constraint stripe_webhook_events_status_check check (status in ('processing','done','failed'));
exception when duplicate_object then null; when others then null; end $$;

comment on column public.stripe_webhook_events.status is
  'P2-E W4: processing (claimed, in-flight) | done (applied) | failed (a prior attempt errored; a Stripe retry re-runs). Claim-first idempotency.';
comment on column public.stripe_webhook_events.livemode is
  'Stripe event.livemode captured at receipt — provenance for the live/test guard.';

-- rollback:
--   alter table public.stripe_webhook_events drop column if exists status,
--     drop column if exists processed_at, drop column if exists livemode;


-- ═══════════════ 0084_terms_acceptance.sql ═══════════════
-- ── P2-E W6: durable terms-acceptance evidence (M4) ──────────────────────────
-- Signup shows clickwrap ("by creating your account you agree to the Terms…"),
-- but NOTHING recorded WHICH version was accepted, WHEN, or from where — so there
-- was no evidence to stand on later. This append-only table is that evidence:
-- one row per acceptance (a customer may re-accept a new version over time).
-- Deny-all RLS; written by the service role at signup.

create table if not exists public.presence_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  email text not null default '',
  terms_version text not null,
  privacy_version text not null default '',
  accepted_at timestamptz not null default now(),
  ip text not null default '',
  user_agent text not null default '',
  method text not null default 'clickwrap_signup',   -- how consent was captured
  context text not null default 'signup',
  created_at timestamptz not null default now()
);
create index if not exists presence_terms_acceptances_client_idx
  on public.presence_terms_acceptances (client_id, accepted_at desc);
alter table public.presence_terms_acceptances enable row level security;  -- deny-all; function-mediated

comment on table public.presence_terms_acceptances is
  'P2-E M4: append-only terms/privacy acceptance evidence (version + when + ip + ua) captured at signup. Deny-all RLS.';

-- rollback:
--   drop table if exists public.presence_terms_acceptances;


-- ═══════════════ 0085_form_submission_converted.sql ═══════════════
-- ── P2-F G1: website enquiry → CRM continuity ────────────────────────────────
-- A form submission (website enquiry) can be converted into ONE CRM deal. Add a
-- terminal 'converted' status so the leads inbox reflects it and a second
-- conversion is prevented (belt-and-suspenders with the deal-side dedupe on
-- presence_deals.source_submission_id). Additive: widen the CHECK only.

do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.presence_form_submissions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then execute 'alter table public.presence_form_submissions drop constraint ' || quote_ident(c); end if;
  alter table public.presence_form_submissions
    add constraint presence_form_submissions_status_check check (status in ('new','read','archived','converted'));
exception when others then null;
end $$;

-- helps the leads inbox + the dedupe lookup by (site, source submission)
create index if not exists presence_deals_source_submission_idx
  on public.presence_deals (site_id, source_submission_id) where source_submission_id is not null;

comment on column public.presence_form_submissions.status is
  'P2-F: new | read | archived (user-set) | converted (system-set when turned into a CRM deal).';

-- rollback:
--   drop index if exists public.presence_deals_source_submission_idx;
--   (status CHECK widening is forward-safe; no rollback needed)


