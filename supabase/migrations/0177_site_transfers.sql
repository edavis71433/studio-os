-- ── Handing a site to a new owner (builder list item 53, Nov 2026) ─────────────
-- rollback: drop table if exists public.presence_site_transfers;
--
-- A site belongs to its client record, and the client's owner is the person whose
-- login the record names (clients.email / contact_email / contact_id, the chain
-- my_client_ids() follows). Transfer ownership changes that person. It is a request
-- first, kept here, and nothing about the site changes until the new owner accepts:
--   • the owner starts it                    → 'asked_new'   (the new owner accepts)
--   • the studio starts it for the owner     → 'asked_owner' (the owner agrees first,
--                                                              then the new owner accepts)
-- Either side may stop it before then; a request left alone lapses after 14 days.
-- lib/site_transfer.ts holds the rules and makes the change when it is accepted.
--
-- Deploy order: either way. Before this runs, starting a handover answers 503 with a
-- plain "needs a one-time database update" sentence, and the Sites cards and People
-- sheet simply show no handover.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it.
--   • ONE AT A TIME — a partial unique index allows one open handover per site.

create table if not exists public.presence_site_transfers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  client_id uuid not null,
  from_email text not null check (char_length(from_email) between 3 and 254),
  to_email text not null check (char_length(to_email) between 3 and 254),
  keep_old boolean not null default true,
  started_by text not null default '',
  started_side text not null check (started_side in ('owner', 'studio')),
  status text not null default 'asked_owner'
    check (status in ('asked_owner', 'asked_new', 'done', 'cancelled', 'declined', 'expired')),
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists presence_site_transfers_one_open
  on public.presence_site_transfers (site_id) where status in ('asked_owner', 'asked_new');
create index if not exists presence_site_transfers_to on public.presence_site_transfers (to_email, status);
alter table public.presence_site_transfers enable row level security;

do $$ begin
  create trigger presence_site_transfers_touch before update on public.presence_site_transfers
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

comment on table public.presence_site_transfers is
  'Builder item 53: a request to hand a site to a new owner. Nothing changes until the new owner accepts (and, when the studio started it, the owner agreed first). One open request per site; lapses after 14 days. Service role only.';
