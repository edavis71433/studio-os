-- ── 0019 — M7: the Client Room's data (settings singleton + notes feed) ──────
-- Additive only. Two new tables; no changes to existing tables, policies, or
-- the frozen content contract's storage. Grants follow the 0017 principle:
-- grant exactly where a policy exists; system-managed tables get none.

-- ── 1. presence_settings — per-site presentation settings (G1 'settings') ───
-- Home of section (category) ordering for offerings and the site cover photo.
-- Client-editable like identity; projected by the serializer.
create table if not exists public.presence_settings (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  category_order jsonb not null default '[]',   -- ordered list of offering category names
  cover_media_id uuid,                          -- same-site check at API layer
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_settings is 'M7 (contract v1). Per-site presentation settings: offering section order + cover photo. Client-editable; serialized into snapshots.';

create trigger presence_settings_touch before update on public.presence_settings
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_settings enable row level security;
create policy presence_settings_client_all on public.presence_settings
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

grant select, insert, update, delete on public.presence_settings to authenticated;

-- ── 2. presence_notes — the concierge notes feed (reconciliation §4) ────────
-- The suggestion seam: rules today, AI (M9) and cross-product sources later,
-- all through one grammar. Outcomes ARE the memory substrate, so rows are
-- resolved (status flipped), never deleted. dedupe_key stops a rule from
-- re-raising a note the client already dismissed.
create table if not exists public.presence_notes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  source text not null default 'rule' check (source in
    ('rule','ai','human','crm','projects','growth','journal','messaging')),
  kind text not null default 'suggestion' check (kind in
    ('suggestion','caution','celebration')),
  title text not null,                          -- the message: a question or plain statement
  reason text not null default '',              -- one honest line; never decorative
  action jsonb not null default '{}',           -- { label, section, entity_id? } — exactly one action
  dedupe_key text not null default '',          -- rule identity; '' = never deduped
  status text not null default 'active' check (status in
    ('active','dismissed','accepted','expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
comment on table public.presence_notes is 'M7 (reconciliation §4). Concierge notes feed: max 3 active shown; one action; dismiss means gone; outcomes recorded for the memory substrate. Sources: rules now, AI/human/cross-product later.';

create index if not exists presence_notes_site_idx
  on public.presence_notes (site_id, status, created_at desc);
-- one live note per rule identity per site (deduped rules only)
create unique index if not exists presence_notes_dedupe_idx
  on public.presence_notes (site_id, dedupe_key) where dedupe_key <> '' and status in ('active','dismissed');

alter table public.presence_notes enable row level security;
create policy presence_notes_client_read on public.presence_notes
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- no client write policies: notes are created and resolved by the presence
-- function (service role) so every outcome is recorded uniformly.

grant select on public.presence_notes to authenticated;
