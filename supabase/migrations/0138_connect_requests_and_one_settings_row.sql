-- rollback:
--   drop index if exists public.presence_sales_templates_reserved_uq;
--   drop table if exists public.presence_connect_requests;
--   (the duplicate settings rows step 2 retired keep deleted_at set; clear it by id if ever needed)
--
-- ── Final pass on the sales side (Nov 8 2026), security batch A ──────────────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands:
--   * a studio asking to connect an account that already exists gets a plain
--     "couldn't send your request just now" (the request has nowhere to live),
--     and an owner sees no requests — nothing is ever linked without one;
--   * every other path keeps working.
--
-- WHAT CHANGES
--   1. presence_connect_requests — a studio's request to the person at an email
--      whose Studio OS account already exists. Connecting such an account used to
--      happen the moment the studio typed the email (and could move a site another
--      studio managed). Now the owner sees the request in their workspace and the
--      studio is connected only when they press Accept. Deny-all like the other
--      presence tables: the function reads and writes it with the service role.
--   2. presence_sales_templates — the reserved settings rows (__saved_views__,
--      __broadcast_lists__, __stage_names__, __calendar_feed__, __services_catalog__,
--      __crm_contact_fields__) become one row per site and name. Two saves at once
--      could make two rows (then reads picked one at random, and a calendar link
--      turned off could keep working in the other), and a template could be named
--      like one of them. Any existing duplicate is retired first, keeping the most
--      recently saved one.

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.presence_connect_requests (
  id uuid primary key default gen_random_uuid(),
  studio_site_id uuid not null references public.presence_sites(id) on delete cascade,
  agency_id uuid references public.presence_agencies(id) on delete set null,
  email text not null,
  name text not null default '',
  requested_by text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_site_id, email)
);
alter table public.presence_connect_requests enable row level security;   -- no policies: deny-all, function-mediated
create index if not exists presence_connect_requests_pending_email_idx
  on public.presence_connect_requests (email) where status = 'pending';
comment on table public.presence_connect_requests is
  'Final pass S1 (Nov 2026): a studio''s request to connect the Studio OS account at this email. Linked only when the account owner accepts (routes/connect_requests.ts).';

-- 2 ─────────────────────────────────────────────────────────────────────────
with ranked as (
  select id, row_number() over (partition by site_id, kind, name order by updated_at desc nulls last, created_at desc, id) as rn
  from public.presence_sales_templates
  where deleted_at is null and name like '\_\_%\_\_'
)
update public.presence_sales_templates t
   set deleted_at = now()
  from ranked r
 where t.id = r.id and r.rn > 1;

create unique index if not exists presence_sales_templates_reserved_uq
  on public.presence_sales_templates (site_id, kind, name)
  where deleted_at is null and name like '\_\_%\_\_';
