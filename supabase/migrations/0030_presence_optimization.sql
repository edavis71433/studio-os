-- ── 0030 — M10: Presence Optimization Engine storage ────────────────────────
-- Additive only, per the frozen evidence additivity rules ("new evidence
-- types = new catalog entries; new fields = new columns/keys").
--
-- 1. The evidence category CHECK gains four new categories. Existing values,
--    columns, and meanings are untouched — the constraint's value set grows.
alter table public.presence_evidence
  drop constraint if exists presence_evidence_category_check;
alter table public.presence_evidence
  add constraint presence_evidence_category_check check (category in (
    'website','seo','accessibility','performance','structured_data','metadata',
    'freshness','business_info','media','links','local_presence','reviews',
    'trust','content','conversion',
    -- M10 Optimization Engine:
    'infrastructure','aeo','analytics','knowledge'));

-- 2. Business Knowledge Import — the renamed Document Intelligence concept.
--    Customers hand over what they already have (menus, flyers, price
--    sheets); deterministic extraction stores STRUCTURED FACTS; the
--    knowledge provider turns disagreements into evidence. No AI, no
--    summaries, no customer-facing output — knowledge in, evidence out.
create table if not exists public.presence_knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  filename text not null,
  content_text text not null,                 -- what the customer provided (≤50k chars, capped at the route)
  extracted jsonb not null default '{}',      -- deterministic extraction: items, phones, emails, urls, hours lines
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.presence_knowledge_docs is
  'M10. Business Knowledge Import: customer-provided documents parsed deterministically into structured business facts. Facts feed the knowledge evidence provider; nothing here is generated, reviewed, or summarized.';

create index if not exists presence_knowledge_site_idx
  on public.presence_knowledge_docs (site_id, created_at desc);

alter table public.presence_knowledge_docs enable row level security;
create policy presence_knowledge_client_read on public.presence_knowledge_docs
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
grant select on public.presence_knowledge_docs to authenticated;
