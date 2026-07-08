-- ── A7 Workspace Roles & Visibility ─────────────────────────────────────────
-- Two additive tables. Nothing existing changes; with no members and no shares,
-- the owner sees the full workspace exactly as today (zero regression). These
-- extend the baseline CRM `client_visible` idea into the Presence product:
-- site-level audiences (business owner / staff / client reviewer / developer)
-- and per-item share overrides for the client (reviewer) audience.
--
-- Preserves the frozen guarantees: tenant isolation (still scoped by site_id),
-- approval (unchanged), and audit (unchanged) are untouched. Deny-all RLS —
-- function-mediated only.

-- People granted a role on a site, in addition to the owning client. The owner
-- is implicit (business_owner) and is NOT a row here.
create table if not exists public.presence_site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  email text not null,                                     -- the member (matched to the auth user)
  user_id uuid,                                            -- resolved on first sign-in
  role text not null check (role in ('business_owner', 'business_staff', 'client_reviewer', 'developer')),
  status text not null default 'active' check (status in ('invited', 'active', 'revoked')),
  invited_by text,                                         -- who added them (operator/owner)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, email)
);
comment on table public.presence_site_members is
  'A7. Site-level audiences beyond the owning client: business_staff (operate), client_reviewer (the client portal — review/approve/comment/export shared only), developer (workspace + developer mode). Deny-all RLS; function-mediated. Isolation unchanged (scoped by site_id).';
create index if not exists presence_site_members_idx on public.presence_site_members (site_id, status, email);

-- Per-item (or whole-surface) share overrides for the CLIENT (reviewer) audience.
-- item_id null = a whole-surface default override. shared=true exposes an
-- internal item; shared=false hides a shared-by-default item. Absent = the
-- surface's default policy applies. Internal notes are never exposed unless a
-- row here says shared=true.
create table if not exists public.presence_item_shares (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  surface text not null,                                   -- e.g. 'business_moments','visual_assets','internal_notes'
  item_id text,                                            -- null = whole-surface override
  shared boolean not null,
  shared_by text,                                          -- operator/owner who set it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, surface, item_id)
);
comment on table public.presence_item_shares is
  'A7. Client-visibility overrides per item/surface (extends the CRM client_visible model into Presence). Only affects the client_reviewer audience; owner/staff/developer always see everything. Deny-all RLS.';
create index if not exists presence_item_shares_idx on public.presence_item_shares (site_id, surface);

alter table public.presence_site_members enable row level security;  -- deny-all
alter table public.presence_item_shares enable row level security;   -- deny-all

do $$ begin
  create trigger presence_site_members_touch before update on public.presence_site_members
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;
do $$ begin
  create trigger presence_item_shares_touch before update on public.presence_item_shares
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_item_shares;
--   drop table if exists public.presence_site_members;
