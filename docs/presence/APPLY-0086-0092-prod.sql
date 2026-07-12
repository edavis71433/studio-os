-- Combined post-launch (Jul 11-12 2026 audit campaign) migrations 0086-0092 for PROD (paste into Supabase SQL Editor, Run once).
-- All additive/idempotent: create-if-not-exists, add-column-if-not-exists, and constraint-widen (drop-if-exists + re-add).
-- The final block is sql/connect-studio-workspace.sql — a one-time owner-run seed (idempotent, safe to re-run; prod-intended, harmless on staging).

-- ═══════════════ 0086_presence_invoices.sql ═══════════════
-- ── Deposits & service invoices (multi-tenant) ──────────────────────────────
-- The agency can turn an accepted proposal (or an ad-hoc amount) into a payable
-- invoice/deposit. This is SERVICE billing (project work the agency sells) — kept
-- deliberately separate from the customer's SaaS subscription, on the SAME one
-- Stripe authority (a Stripe Payment Link per invoice; the webhook flips it paid
-- via metadata.presence_invoice_id). Amounts are in CENTS, like every other money
-- value in `presence` (proposals.subtotal_cents, etc.) — the legacy single-tenant
-- `invoices` table (clever-api, dollars) is NOT reused; this is the platform home
-- and retires cleanly with clever-api.
--
-- Deny-all RLS; every read/write is function-mediated by the service role and
-- scoped by site_id (the issuing agency) + customer_client_id (who can see/pay it).

create table if not exists public.presence_invoices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,                         -- the agency site that issued it
  deal_id uuid,                                  -- the originating pipeline deal (optional)
  customer_client_id uuid,                       -- who's billed (their clients.id) — how the client portal finds it; null = pay-by-link only
  customer_site_id uuid,                          -- the customer's workspace (optional convenience)
  title text not null default 'Invoice',
  description text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0 and amount_cents <= 100000000),
  currency text not null default 'usd',
  purpose text not null default 'service' check (purpose in ('service','deposit')),
  status text not null default 'open' check (status in ('open','paid','void')),
  stripe_url text,                                -- the hosted Stripe payment link
  stripe_payment_link_id text,
  due_date date,
  paid_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists presence_invoices_customer_idx
  on public.presence_invoices (customer_client_id) where deleted_at is null;
create index if not exists presence_invoices_site_idx
  on public.presence_invoices (site_id, created_at desc) where deleted_at is null;
create index if not exists presence_invoices_deal_idx
  on public.presence_invoices (deal_id) where deleted_at is null;

alter table public.presence_invoices enable row level security;  -- deny-all; function-mediated


-- ═══════════════ 0087_sales_templates.sql ═══════════════
-- ── Saved proposal & contract templates ─────────────────────────────────────
-- The repeat-operator time-saver every peer tool (Dubsado/HoneyBook) ships: save a
-- proposal's line items or a contract's text once, reuse it on every new deal.
-- Contract bodies may carry {{client_name}} / {{deal_title}} placeholders, filled
-- at create time from the deal. Site-scoped; deny-all RLS; function-mediated.

create table if not exists public.presence_sales_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  kind text not null check (kind in ('proposal','contract')),
  name text not null default 'Template',
  title text not null default '',
  body text not null default '',            -- contract text (may contain placeholders)
  line_items jsonb not null default '[]',   -- proposal line items
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists presence_sales_templates_site_idx
  on public.presence_sales_templates (site_id, kind) where deleted_at is null;

alter table public.presence_sales_templates enable row level security;  -- deny-all; function-mediated


-- ═══════════════ 0088_notice_kinds.sql ═══════════════
-- ── 0088 — widen the notice-kind check to what the code actually raises ──────
-- BUG FIX (latent since P2-C): the presence_plan_notices kind check was last
-- widened in 0062, but code added since then raises 'deal_signed' (proposal
-- accepted / contract signed → tell the studio), 'deal_followup' (proposal
-- declined), and 'publish_failed'. raiseNotice() is deliberately best-effort,
-- so every one of those inserts has been failing SILENTLY against this check —
-- the owner never saw "they accepted!" in the bell/Today. This migration adds
-- the missing kinds plus 'invoice_paid' (the new deposit/invoice paid echo
-- written by the stripe webhook) and 'connection_expired' / 'website_enquiry'
-- (documented in notice.ts's contract as intended kinds).
-- Additive only; no data change. Safe to re-run.

alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    -- added by 0088:
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided'
  ));

-- Same latent gap on the deal-event ledger: 0074's check predates invoices.
-- 'invoice_sent' (written by POST /sales/deals/:id/invoice) and 'invoice_paid'
-- (written by the stripe webhook echo) were failing the check silently.
alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    -- added by 0088:
    'invoice_sent','invoice_paid'
  ));

-- rollback: restore the 0062 notices check and the 0074 deal-events check
-- (delete any rows with the new kinds first).


-- ═══════════════ 0089_deal_next_step.sql ═══════════════
-- ── 0089 — "Next step + when" on deals ───────────────────────────────────────
-- The one field that keeps a solo seller's pipeline honest (the core of what
-- Pipedrive-class tools are bought for): every open deal can carry what happens
-- next and when. Surfaced in the deal Details panel; the existing stale-deal
-- sweep provides the nudge rail. Additive only; safe to re-run.

alter table public.presence_deals
  add column if not exists next_step text not null default '',
  add column if not exists next_step_at date;

comment on column public.presence_deals.next_step is
  'P3: the owner''s own words for what happens next on this deal (e.g. "Call Friday about the proposal"). Empty = none set.';
comment on column public.presence_deals.next_step_at is
  'P3: when the next step is due. Read by the deal detail UI; the stale-deal follow-up sweep remains the nudge mechanism.';

-- rollback: alter table public.presence_deals drop column next_step, drop column next_step_at;


-- ═══════════════ 0090_push_subscriptions.sql ═══════════════
-- ── 0090 — Web Push subscriptions ────────────────────────────────────────────
-- Stores the browser push endpoints an owner opted into, so the platform can
-- notify them (a lead waiting, an approval, a payment) even when the app isn't
-- open — the #1 gap vs native-app competitors. One row per (user, endpoint);
-- re-subscribing upserts. Deny-all RLS: only the edge functions (service role)
-- read/write these; a subscription is never client-readable.
create table if not exists public.presence_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                      -- auth user id (owner/team)
  email text not null default '',    -- fallback identity
  site_id uuid references public.presence_sites(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,              -- subscription public key (base64url)
  auth text not null,                -- subscription auth secret (base64url)
  user_agent text not null default '',
  failures int not null default 0,   -- consecutive send failures → prune at 5
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists presence_push_by_user on public.presence_push_subscriptions (user_id);
create index if not exists presence_push_by_site on public.presence_push_subscriptions (site_id);

alter table public.presence_push_subscriptions enable row level security;
-- no policies = deny all to anon/authenticated; edge functions use the service role.

comment on table public.presence_push_subscriptions is
  'Web Push endpoints for signed-in owners/team. Written by the presence function on opt-in; read by the push sender. Deny-all RLS — never client-readable.';

-- rollback: drop table public.presence_push_subscriptions;


-- ═══════════════ 0091_sweep_rotation_cursors.sql ═══════════════
-- ── 0091 · Sweep rotation cursors — fairness at scale ────────────────────────
-- The three recurring sweeps (observation cycle, billing reconcile, lifecycle)
-- previously ordered by updated_at and took the first N — but nothing they did
-- bumped updated_at, so the SAME rows occupied the window forever and everything
-- beyond it was silently never swept (observation ceiling ≈120 sites, billing
-- reconcile ceiling = 30 subscriptions, lifecycle ceiling = 200 entitlements).
-- Fix: a dedicated cursor column per sweep, stamped on every row CONSIDERED,
-- ordered oldest-first with nulls first — a true round-robin at any N.
--
-- Rollback: alter table ... drop column ...; drop index ...

alter table public.presence_sites
  add column if not exists last_observed_at timestamptz;
comment on column public.presence_sites.last_observed_at is
  'Rotation cursor for the scheduled observation cycle. Stamped every time the scheduler considers this site; ordered nulls-first so new sites are observed first and no site starves.';
create index if not exists presence_sites_observe_cursor_idx
  on public.presence_sites (last_observed_at asc nulls first)
  where status in ('ready','live');

alter table public.presence_entitlements
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_swept_at timestamptz;
comment on column public.presence_entitlements.last_synced_at is
  'Rotation cursor for the Stripe billing reconcile sweep (stamped when considered, drifted or not).';
comment on column public.presence_entitlements.last_swept_at is
  'Rotation cursor for the account lifecycle sweep (trial expiry / grace / wind-down).';
create index if not exists presence_entitlements_sync_cursor_idx
  on public.presence_entitlements (last_synced_at asc nulls first)
  where stripe_subscription_id is not null;
create index if not exists presence_entitlements_sweep_cursor_idx
  on public.presence_entitlements (last_swept_at asc nulls first);

-- ops_errors gained a writer (the presence global catch) — make it queryable.
create index if not exists ops_errors_created_idx on public.ops_errors (created_at desc);

-- ── Evidence retention — the one prune REST can't express ────────────────────
-- Evidence readers (judgment/coach) only ever use a site's LATEST run, but every
-- cycle appends a full run + item set forever. Delete runs older than the window
-- EXCEPT each site's latest (so a paused/lapsed site still shows its last
-- observation). presence_evidence cascades from runs. Service-role RPC only.
create or replace function public.prune_evidence_runs(keep_days int default 180)
returns int
language sql
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (site_id) id from public.presence_evidence_runs
    order by site_id, started_at desc
  ),
  gone as (
    delete from public.presence_evidence_runs r
    where r.started_at < now() - make_interval(days => keep_days)
      and r.id not in (select id from latest)
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke all on function public.prune_evidence_runs(int) from public, anon, authenticated;


-- ═══════════════ 0092_lead_nurture.sql ═══════════════
-- ── 0092 · Free-review lead nurture — the day-7 second touch ─────────────────
-- A free-score lead who left an email gets the report and then silence unless
-- they reply (the CRO audit's top remaining funnel gap). This adds the ONE
-- column the send-once dedupe needs. The sweep itself ships OFF: it is gated
-- on the NURTURE_DRIP=1 edge-function secret so the owner approves the copy
-- and flips it deliberately — automated outbound in the owner's name is never
-- turned on by a deploy. Additive; safe to re-run.

alter table public.audit_leads
  add column if not exists nurture_sent_at timestamptz;

comment on column public.audit_leads.nurture_sent_at is
  'When the day-7 follow-up email was sent (null = not yet). Send-once dedupe for runProspectNurture; the sweep is owner-gated on NURTURE_DRIP=1.';

create index if not exists audit_leads_nurture_idx
  on public.audit_leads (created_at)
  where nurture_sent_at is null and client_email is not null;

-- rollback: alter table public.audit_leads drop column nurture_sent_at;


-- ═══════════════ sql/connect-studio-workspace.sql (one-time owner-run, idempotent) ═══════════════
-- ── Connect the studio's own Studio OS workspace (one-time, owner-run) ───────
-- WHY: the unified app (Today · Website · Customers · Projects · Files · Inbox)
-- resolves through presence_sites via the ownership chain
-- (clients.email → auth user). The studio's OWN account never had that row on
-- prod, so /portal/context returned no_site and the owner saw disconnected
-- pages instead of the one app. This seeds exactly four things, all idempotent:
--   1. a clients row for the studio itself (the studio is its own customer)
--   2. an active presence entitlement for it
--   3. its presence_sites workspace row (no hosting attached — content/CRM/
--      projects work immediately; hosting can be connected later)
--   4. the agency + owner membership (unlocks the Studio portfolio + agency nav)
-- Safe to re-run. Run in the Supabase SQL editor (prod; harmless on staging).

do $$
declare
  v_email  text := 'eric@davisdigitalstudio.com';  -- the owner login
  v_client uuid;
  v_site   uuid;
  v_agency uuid;
begin
  -- 1. the studio's own client row (automation stays paused — it's us)
  select id into v_client from public.clients where lower(email) = lower(v_email) limit 1;
  if v_client is null then
    insert into public.clients (name, email, automation_paused)
    values ('Davis Digital Studio', v_email, true)
    returning id into v_client;
  end if;

  -- 2. active entitlement (unique on client_id+product → clean upsert)
  insert into public.presence_entitlements (client_id, product, status, note)
  values (v_client, 'presence', 'active', 'studio''s own workspace')
  on conflict (client_id, product) do update set status = 'active';

  -- 3. the workspace row ('ready', full edition, no hosting attached yet)
  select id into v_site from public.presence_sites where client_id = v_client limit 1;
  if v_site is null then
    insert into public.presence_sites (client_id, template_slug, template_version, status, edition)
    values (v_client, 'restaurant-classic', '1.0.0', 'ready', 'presence')
    returning id into v_site;
  end if;

  -- 4. the agency + owner seat (Studio portfolio, cross-client queues).
  --    Lookup ignores status (a paused row is reactivated, never duplicated).
  select id into v_agency from public.presence_agencies
   where lower(name) = 'davis digital studio' limit 1;
  if v_agency is null then
    insert into public.presence_agencies (name) values ('Davis Digital Studio')
    returning id into v_agency;
  else
    update public.presence_agencies set status = 'active' where id = v_agency;
  end if;

  insert into public.presence_agency_members (agency_id, email, role, status)
  values (v_agency, lower(v_email), 'owner', 'active')
  on conflict (agency_id, email) do update set role = 'owner', status = 'active';

  raise notice 'Studio workspace connected: client=% site=% agency=%', v_client, v_site, v_agency;
end $$;
