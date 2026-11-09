-- rollback: see the end of this file (drop the two tables and the two invoice columns, restore the 0144 and 0135 kind checks).
-- ── Estimates and recurring invoices (sales review item 47, Nov 2026) ───────
-- Two documents beside proposals and agreements, as Eric chose them on Nov 8:
--
--   • an ESTIMATE is a price before anything is agreed. It is emailed with one
--     button to a page where the client presses Approve or Not now (with an
--     optional note). Good for 30 days, one reminder after 3 days, printable.
--     Approving never moves the deal; the studio turns it into a proposal or
--     bills it as an invoice, and nothing goes out until they press Send.
--   • a RECURRING INVOICE sends a fresh invoice (its own pay link) on a
--     schedule — every month, 3 months or year, on the day picked, around 9 am
--     in the studio's time zone, due 14 days later. The client pays each one
--     themselves. (A retainer, 0096, charges a card automatically; both stay.)
--
-- APPLY THIS BEFORE DEPLOYING THE FUNCTION. The function is deploy-order
-- tolerant: before this runs, the deal page reads no estimates and no recurring
-- invoices (the reads fall back to empty), and making either one answers "needs
-- a one-time database update" — nothing is half-written. But dealEvent() is
-- best-effort, so a history line written in between would be dropped silently.
--
-- What it adds:
--   1. presence_estimates — the proposal's shape (line items + the reserved
--      discount/tax element), its own statuses, and links to what it became.
--   2. presence_recurring_invoices — one row per schedule.
--   3. presence_invoices.recurring_id + recurring_on — which schedule and which
--      date an invoice was sent for. The unique index is the send-once guard:
--      two sweeps racing the same date can never bill it twice.
--   4. Four deal-history kinds: estimate_sent, estimate_decided,
--      estimate_deleted, recurring_invoice. The FULL 0144 list is carried forward.
--   5. One notice kind: invoice_upcoming (the heads-up three days before a
--      recurring invoice goes out — news, under Updates). The FULL 0135 list is
--      carried forward.
--
-- Properties:
--   • ADDITIVE — new tables, nullable columns, kind lists that only grow.
--   • IDEMPOTENT — create/add if not exists, drop-if-exists-then-add.
--   • DATA-SAFE — no existing row is read, written or moved.

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.presence_estimates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',
  line_items jsonb not null default '[]',             -- the proposal shape: [{label, qty, unit_cents}] + the reserved __meta__ element (discount, tax)
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  currency text not null default 'usd',
  terms text not null default '',
  status text not null default 'draft'
    check (status in ('draft','sent','approved','declined')),   -- declined = the client's "Not now"
  sent_at timestamptz,
  expires_at timestamptz,                             -- 30 days after sending; an expired estimate can't be approved
  first_viewed_at timestamptz,                        -- the client first opened its page
  decided_at timestamptz,
  decided_note text not null default '',              -- the note the client added to Approve or Not now
  proposal_id uuid,                                   -- the proposal it was turned into
  invoice_id uuid,                                    -- the invoice it was billed as
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_estimates_deal_idx on public.presence_estimates (deal_id, created_at desc) where deleted_at is null;
create index if not exists presence_estimates_sent_idx on public.presence_estimates (status, sent_at) where deleted_at is null;
alter table public.presence_estimates enable row level security;   -- no policies: deny-all, function-mediated
revoke all on public.presence_estimates from anon, authenticated;
grant all on public.presence_estimates to service_role;
comment on table public.presence_estimates is
  'Sales review item 47 (Nov 2026): a price before anything is agreed. Approve or Not now on its own page (routes/estimates.ts); turned into a proposal or billed as an invoice only when the studio presses the button.';

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.presence_recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  deal_id uuid not null references public.presence_deals(id) on delete cascade,
  title text not null default '',                     -- what it's for, e.g. "Website care"; each invoice adds the month
  amount_cents integer not null check (amount_cents >= 50 and amount_cents <= 100000000),
  currency text not null default 'usd',
  every text not null default 'month' check (every in ('month','quarter','year')),
  anchor_day smallint not null check (anchor_day between 1 and 31),   -- the day of the month it goes out (the 31st → the last day of shorter months)
  next_on date,                                       -- the next send date; null once stopped or finished
  due_days smallint not null default 14 check (due_days between 0 and 90),
  times integer check (times is null or times between 1 and 120),     -- how many in all; null = until stopped
  sent_count integer not null default 0 check (sent_count >= 0),
  status text not null default 'active' check (status in ('active','paused','stopped','finished')),
  paused_reason text not null default '',             -- '' | manual | unpaid | no_email | no_stripe
  resumed_at timestamptz,                             -- invoices sent before this don't count toward "two in a row unpaid"
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists presence_recurring_invoices_due_idx on public.presence_recurring_invoices (next_on) where status = 'active' and deleted_at is null;
create index if not exists presence_recurring_invoices_deal_idx on public.presence_recurring_invoices (deal_id) where deleted_at is null;
alter table public.presence_recurring_invoices enable row level security;   -- no policies: deny-all, function-mediated
revoke all on public.presence_recurring_invoices from anon, authenticated;
grant all on public.presence_recurring_invoices to service_role;
comment on table public.presence_recurring_invoices is
  'Sales review item 47 (Nov 2026): a fresh invoice on a schedule that the client pays themselves (distinct from the 0096 retainer, which charges a card). Swept by routes/recurring_invoices.ts runRecurringInvoices.';

-- the same touch trigger every sales table has (0074); each on its own so a re-run skips cleanly
do $$ begin
  create trigger presence_estimates_touch before update on public.presence_estimates for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;
do $$ begin
  create trigger presence_recurring_invoices_touch before update on public.presence_recurring_invoices for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table public.presence_invoices add column if not exists recurring_id uuid;
alter table public.presence_invoices add column if not exists recurring_on date;
create unique index if not exists presence_invoices_recurring_once
  on public.presence_invoices (recurring_id, recurring_on) where recurring_id is not null;

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table public.presence_deal_events
  drop constraint if exists presence_deal_events_kind_check;
alter table public.presence_deal_events
  add constraint presence_deal_events_kind_check
  check (kind in (
    'created','stage_change','note','proposal_sent','proposal_decided',
    'contract_sent','contract_signed','converted',
    -- added by 0088:
    'invoice_sent','invoice_paid',
    -- added by 0117:
    'proposal_deleted','contract_deleted',
    -- added by 0118:
    'invoice_voided',
    -- added by 0144:
    'doc_opened',
    -- added by 0145:
    'estimate_sent','estimate_decided','estimate_deleted','recurring_invoice'
  ));

-- 5 ─────────────────────────────────────────────────────────────────────────
alter table public.presence_plan_notices
  drop constraint if exists presence_plan_notices_kind_check;
alter table public.presence_plan_notices
  add constraint presence_plan_notices_kind_check
  check (kind in (
    'capacity','trial_ending','trial_ended','payment_trouble','account_lapsed',
    'search_setup','winddown_reminder','win_back','welcome_back',
    'deletion_requested','domain_expiry','lead_followup','renewal_reminder',
    'deal_signed','deal_followup','publish_failed','invoice_paid',
    'connection_expired','website_enquiry','approval_decided','new_booking',
    'site_down','support_aging','agreement_renewal',
    'booking_reminder','booking_followup',
    'new_review',
    -- added by 0102:
    'email_auth','apex_drift',
    -- added by 0116 (the client portal's four operator-notifying actions):
    'client_message','client_upload','client_request','client_approval',
    -- added by 0119:
    'invoice_void_paid',
    -- added by 0127 (the never-silent pass):
    'retainer_status','deal_task_due',
    -- added by 0133 (speak as the studio when acting for a client):
    'studio_published',
    -- added by 0135 (approval per deliverable, with reminders):
    'approval_overdue',
    -- added by 0145 (a recurring invoice goes out in three days):
    'invoice_upcoming'
  ));

comment on constraint presence_plan_notices_kind_check on public.presence_plan_notices is
  'Notice kinds the code raises. 0145 added invoice_upcoming (a recurring invoice goes out in three days — routes/recurring_invoices.ts raises one news row per send date, period recurnext:<deal>:<schedule>:<date>). Full 0135 superset carried forward — no kind dropped.';

-- rollback (delete the new kinds' rows first; the tables go with their rows):
--   delete from public.presence_plan_notices where kind = 'invoice_upcoming';
--   delete from public.presence_deal_events where kind in ('estimate_sent','estimate_decided','estimate_deleted','recurring_invoice');
--   restore the 0135 notice check and the 0144 deal-event check (copy them from those files);
--   drop index if exists public.presence_invoices_recurring_once;
--   alter table public.presence_invoices drop column if exists recurring_on;
--   alter table public.presence_invoices drop column if exists recurring_id;
--   drop table if exists public.presence_recurring_invoices;
--   drop table if exists public.presence_estimates;
