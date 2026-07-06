-- rollback: drop the presence_* tables + presence helper functions/triggers listed at the bottom ROLLBACK block (no core table is touched by this migration).
--
-- 0015: Presence Platform Phase 1 — schema + RLS + system tables (M2)
--
-- WHAT: the 14 presence_* tables defined field-by-field by the approved
--   "Presence Content Contract v1.0 — G1" (2026-07-06). Content tables carry
--   the ownership chain row -> presence_sites.client_id -> clients ->
--   my_client_ids(); system tables (snapshots, publishes, change events,
--   entitlements) are default-deny to clients except where G1 grants reads.
--
-- WHY these shapes: generated FROM the contract, not alongside it. Field
--   maxima are enforced at the presence API layer per G1 (server-side
--   validation with plain-language errors); database constraints here are the
--   structural, load-bearing subset (enums, uniqueness, formats, immutability)
--   in the repo's established style. No custom-field escape hatches, no
--   design fields, no per-tenant schema — constitutional.
--
-- CONTRACT VERSION: every snapshot stamps content_contract_version = 1
--   (code constant); table comments below record the same.
--
-- RLS DOCTRINE (ratified): RLS answers "is this yours" ONLY. Entitlement is
--   NEVER expressed here — it is middleware at the presence function boundary.
--   Client-facing writes flow through the presence API; direct PostgREST
--   access under a client JWT is scoped by these policies as defense in depth.

-- ── shared helpers ──────────────────────────────────────────────────────────

create or replace function public.presence_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── 1. presence_sites ───────────────────────────────────────────────────────

create table if not exists public.presence_sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_slug text not null default 'restaurant-classic',
  template_version text not null default '1.0.0',
  status text not null default 'draft' check (status in ('draft','live','paused')),
  custom_domain text,
  netlify_site_id text,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)                       -- v1 training wheel: one site per client
);
comment on table public.presence_sites is 'Presence Phase 1 (content_contract_version=1). One per client. Creation/mutation = admin+function only; clients read own.';

create trigger presence_sites_touch before update on public.presence_sites
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_sites enable row level security;
create policy presence_sites_client_read on public.presence_sites
  for select to authenticated
  using (client_id in (select public.my_client_ids()));
-- no client insert/update/delete policies: admin + function concerns (G1).

-- ownership predicate helper: does this site belong to one of my clients?
-- (Defined AFTER presence_sites exists — sql-language bodies are validated at
-- creation. SECURITY DEFINER so policy evaluation does not depend on the
-- caller's rights on presence_sites; STABLE for planner reuse. Mirrors
-- my_client_ids discipline: fail-empty, never fail-open.)
create or replace function public.my_presence_site_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id from public.presence_sites s
  where s.client_id in (select public.my_client_ids());
$$;
revoke all on function public.my_presence_site_ids() from public;
grant execute on function public.my_presence_site_ids() to authenticated;

-- ── 2. presence_identity (singleton per site) ──────────────────────────────

create table if not exists public.presence_identity (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  business_name text not null default '',
  description text not null default '',
  phone text not null default '',
  email text not null default '',
  tagline text not null default '',
  story text not null default '',
  service_area text not null default '',
  booking_url text not null default '',
  ordering_url text not null default '',
  social jsonb not null default '{}',      -- fixed keys validated at API layer (G1 §1)
  seo_title text not null default '',
  seo_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_identity is 'G1 §1 (contract v1). Singleton; required-field rules (name, description, phone|email) enforced at publish validation, not as DB not-nulls, so drafts can be incomplete.';

create trigger presence_identity_touch before update on public.presence_identity
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_identity enable row level security;
create policy presence_identity_client_rw on public.presence_identity
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 3. presence_locations (exactly one in v1; modeled for N) ────────────────

create table if not exists public.presence_locations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  address_line1 text not null default '',
  address_line2 text not null default '',
  city text not null default '',
  region text not null default '',
  postal_code text not null default '',
  country text not null default 'US' check (char_length(country) = 2),
  phone text not null default '',
  timezone text not null default 'America/Los_Angeles',
  hours jsonb not null default '[]',              -- G1 §3 shape; validated at API + publish
  holiday_exceptions jsonb not null default '[]', -- max 40, validated at API
  temporarily_closed boolean not null default false,
  temporarily_closed_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id)                          -- v1: single location (drop to go multi)
);
comment on table public.presence_locations is 'G1 §2-3 (contract v1). Own entity so multi-location is an extension, not a rewrite.';

create trigger presence_locations_touch before update on public.presence_locations
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_locations enable row level security;
create policy presence_locations_client_rw on public.presence_locations
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 4. presence_offerings ───────────────────────────────────────────────────

create table if not exists public.presence_offerings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  name text not null,
  category text not null,
  description text not null default '',
  price_text text not null default '' check (char_length(price_text) <= 40),
  media_id uuid,                             -- same-site check enforced at API layer
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.presence_offerings is 'G1 §4 (contract v1). price_text is deliberately free text — the POS owns arithmetic.';

create index if not exists presence_offerings_site_live_idx
  on public.presence_offerings (site_id, category, sort_order) where deleted_at is null;

create trigger presence_offerings_touch before update on public.presence_offerings
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_offerings enable row level security;
create policy presence_offerings_client_rw on public.presence_offerings
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 5. presence_testimonials ────────────────────────────────────────────────

create table if not exists public.presence_testimonials (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  quote text not null,
  author text not null,
  source text not null default '',
  quote_date date,
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.presence_testimonials is 'G1 §5 (contract v1). Real testimonials only; never AI-generated (constitution).';

create index if not exists presence_testimonials_site_live_idx
  on public.presence_testimonials (site_id, sort_order) where deleted_at is null;

create trigger presence_testimonials_touch before update on public.presence_testimonials
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_testimonials enable row level security;
create policy presence_testimonials_client_rw on public.presence_testimonials
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 6. presence_faqs ────────────────────────────────────────────────────────

create table if not exists public.presence_faqs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  question text not null,
  answer text not null,                      -- plain text by AEO law (G1 §6)
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.presence_faqs is 'G1 §6 (contract v1). Answers are plain text: quotable, sanitizer-free, AEO-first.';

create index if not exists presence_faqs_site_live_idx
  on public.presence_faqs (site_id, sort_order) where deleted_at is null;

create trigger presence_faqs_touch before update on public.presence_faqs
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_faqs enable row level security;
create policy presence_faqs_client_rw on public.presence_faqs
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 7. presence_posts ───────────────────────────────────────────────────────

create table if not exists public.presence_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  title text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  body_md text not null default '',          -- the ONLY markdown field; sanitizer per G1 §7
  excerpt text not null default '',
  hero_media_id uuid,                         -- same-site check at API layer
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (site_id, slug)
);
comment on table public.presence_posts is 'G1 §7 (contract v1). Slug immutable after first publish (API-enforced; renames auto-append a redirect).';

create index if not exists presence_posts_site_pub_idx
  on public.presence_posts (site_id, status, published_at desc) where deleted_at is null;

create trigger presence_posts_touch before update on public.presence_posts
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_posts enable row level security;
create policy presence_posts_client_rw on public.presence_posts
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 8. presence_media ───────────────────────────────────────────────────────

create table if not exists public.presence_media (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  storage_path text not null,
  alt_text text not null check (char_length(btrim(alt_text)) >= 3),  -- the contract's loudest a11y rule
  width int,
  height int,
  mime text not null default '' check (mime in ('', 'image/jpeg', 'image/png', 'image/webp')),
  bytes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (storage_path)
);
comment on table public.presence_media is 'G1 §8 (contract v1). Rows point at the private presence-media bucket; upload/delete flow is API-only (signed URLs, EXIF strip, caps) — built in M3, not here.';

create index if not exists presence_media_site_live_idx
  on public.presence_media (site_id) where deleted_at is null;

create trigger presence_media_touch before update on public.presence_media
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_media enable row level security;
create policy presence_media_client_rw on public.presence_media
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 9. presence_voice (singleton; never rendered) ───────────────────────────

create table if not exists public.presence_voice (
  site_id uuid primary key references public.presence_sites(id) on delete cascade,
  tone_notes text not null default '',
  preferred_vocabulary text not null default '',
  never_claim text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_voice is 'G1 §9 (contract v1). Never rendered; snapshot marks it private:true; consumed only as AI prompt context.';

create trigger presence_voice_touch before update on public.presence_voice
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_voice enable row level security;
create policy presence_voice_client_rw on public.presence_voice
  for all to authenticated
  using (site_id in (select public.my_presence_site_ids()))
  with check (site_id in (select public.my_presence_site_ids()));

-- ── 10. presence_redirects ──────────────────────────────────────────────────

create table if not exists public.presence_redirects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  from_path text not null check (from_path ~ '^/' and from_path !~ '://' and position('?' in from_path) = 0),
  to_path text not null check (to_path ~ '^/' or to_path ~ '^https://'),
  note text not null default '',
  source text not null default 'manual' check (source in ('manual','import','slug_change')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, from_path)
);
comment on table public.presence_redirects is 'G1 §11 (contract v1). Max 500/site + single-hop (no chains) enforced at API layer (cross-row rules). Emitted as 301s in every deploy. Managed by tenant/operator; clients read.';

create trigger presence_redirects_touch before update on public.presence_redirects
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_redirects enable row level security;
create policy presence_redirects_client_read on public.presence_redirects
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- writes: tenant/operator via the function (service role). No client write policies.

-- ── 12. presence_snapshots (immutable) ──────────────────────────────────────

create table if not exists public.presence_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  content jsonb not null,
  media_manifest jsonb not null default '[]',
  content_contract_version int not null default 1,
  template_slug text not null,
  template_version text not null,
  created_by uuid,
  created_by_kind text not null default 'client' check (created_by_kind in ('client','staff','system')),
  created_at timestamptz not null default now()
);
comment on table public.presence_snapshots is 'G1 §12 (contract v1). Write-once: UPDATE blocked by trigger; DELETE = pruning only (service role; keep-20 + never-prune-live enforced at API). Default-deny to clients — the API serves a projected, voice-free view.';

create index if not exists presence_snapshots_site_idx
  on public.presence_snapshots (site_id, created_at desc);

create or replace function public.presence_block_update()
returns trigger language plpgsql as $$
begin
  raise exception 'presence: % rows are immutable', tg_table_name;
end $$;

create trigger presence_snapshots_immutable before update on public.presence_snapshots
  for each row execute function public.presence_block_update();

alter table public.presence_snapshots enable row level security;
-- default-deny: no policies. Function (service role) writes/reads/prunes.

-- ── 13. presence_publishes ──────────────────────────────────────────────────

create table if not exists public.presence_publishes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  snapshot_id uuid not null references public.presence_snapshots(id),
  destination text not null default 'website' check (destination in ('website')),
  status text not null default 'queued' check (status in ('queued','deploying','live','failed')),
  kind text not null default 'publish' check (kind in ('publish','restore')),
  actor uuid,
  actor_kind text not null default 'client' check (actor_kind in ('client','staff','system')),
  netlify_deploy_id text,
  error_text text,
  change_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
comment on table public.presence_publishes is 'G1 §13 (contract v1). One non-terminal publish per site (partial unique below). Default-deny to clients: error_text/netlify_deploy_id are operator-only, so history reaches clients via the API''s summary projection.';

create index if not exists presence_publishes_site_idx
  on public.presence_publishes (site_id, created_at desc);
create unique index if not exists presence_publishes_one_in_flight
  on public.presence_publishes (site_id) where status in ('queued','deploying');

create trigger presence_publishes_touch before update on public.presence_publishes
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_publishes enable row level security;
-- default-deny: no policies. Function-managed.

-- ── 14. presence_change_events (append-only, function-written) ─────────────

create table if not exists public.presence_change_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  entity_type text not null check (entity_type in
    ('identity','location','offering','testimonial','faq','post','media','voice','redirect','settings','publish','restore')),
  entity_id uuid,
  action text not null check (action in
    ('create','update','delete','hide','show','reorder','publish','restore')),
  summary text not null default '',
  actor_user_id uuid,
  actor_kind text not null default 'client' check (actor_kind in ('client','staff','system')),
  provenance text not null default 'human' check (provenance in ('human','ai_approved','import')),
  detail jsonb not null default '{}',         -- changed-field NAMES only, never values (G1 §14)
  created_at timestamptz not null default now()
);
comment on table public.presence_change_events is 'G1 §14 (contract v1). Append-only provenance trail: UPDATE/DELETE blocked by trigger; writes via the presence function (service role) only; clients read own site''s events (powers draft-vs-live + publish summaries).';

create index if not exists presence_change_events_site_idx
  on public.presence_change_events (site_id, created_at desc);

create trigger presence_change_events_immutable
  before update or delete on public.presence_change_events
  for each row execute function public.presence_block_update();

alter table public.presence_change_events enable row level security;
create policy presence_change_events_client_read on public.presence_change_events
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- no insert/update/delete policies for any client: function-written (service role).

-- ── 15. presence_entitlements ───────────────────────────────────────────────

create table if not exists public.presence_entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product text not null default 'presence',
  status text not null default 'active' check (status in ('active','paused','lapsed')),
  site_limit int not null default 1 check (site_limit >= 0),
  grace_until date,
  actor uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, product)
);
comment on table public.presence_entitlements is 'G1 §15 (contract v1). Read by _shared middleware at the presence boundary — NEVER expressed in RLS (ratified doctrine). Manual admin flips in Phase 1; Stripe automation at tenant launch.';

create trigger presence_entitlements_touch before update on public.presence_entitlements
  for each row execute function public.presence_touch_updated_at();

alter table public.presence_entitlements enable row level security;
-- default-deny: no policies. Admin/function controlled; middleware reads via service role.

-- ── grants hygiene (0010 lesson: Supabase grants EXECUTE beyond PUBLIC) ─────
revoke all on function public.presence_touch_updated_at() from public, anon, authenticated;
revoke all on function public.presence_block_update() from public, anon, authenticated;
revoke execute on function public.my_presence_site_ids() from anon;

-- ROLLBACK
-- drop table if exists public.presence_change_events;
-- drop table if exists public.presence_publishes;
-- drop table if exists public.presence_snapshots;
-- drop table if exists public.presence_entitlements;
-- drop table if exists public.presence_redirects;
-- drop table if exists public.presence_voice;
-- drop table if exists public.presence_media;
-- drop table if exists public.presence_posts;
-- drop table if exists public.presence_faqs;
-- drop table if exists public.presence_testimonials;
-- drop table if exists public.presence_offerings;
-- drop table if exists public.presence_locations;
-- drop table if exists public.presence_identity;
-- drop table if exists public.presence_sites;
-- drop function if exists public.my_presence_site_ids();
-- drop function if exists public.presence_block_update();
-- drop function if exists public.presence_touch_updated_at();
