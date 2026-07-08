-- ── Phase AA (FD-7): named versions ──────────────────────────────────────────
-- AEM-inspired, constitution-shaped: any kept version can carry a human name
-- ("Spring menu", "Before the rebrand") so the journal reads like a story and
-- the right version is findable at a glance. Additive; empty = unnamed.
alter table public.presence_publishes
  add column if not exists version_label text not null default '';
comment on column public.presence_publishes.version_label is
  'Phase AA FD-7. Optional human name for this kept version, set/renamed by the owner from History. Max 60 chars (route-enforced).';
-- rollback: alter table public.presence_publishes drop column if exists version_label;
