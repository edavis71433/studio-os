-- 0168 — An import can be undone, and two records for one person can be merged
-- (sales items 86 and 105, Nov 2026)
-- An import of contacts added people one by one and skipped anyone already there, with
-- no way back. Now an import is a record of its own: each person it added or updated is
-- noted with what changed, so "Undo this import" (for a day) can take the added ones off
-- and put the updated ones back as they were. A merge folds a duplicate record into the
-- one you keep: their deals, bookings and reviews move across, and the record merged away
-- keeps what moved and what the kept one was before, so the merge can be undone.
-- Everything here is new and empty; nothing existing changes. Function-mediated, deny-all
-- RLS like every sales table (0074). The code tolerates this migration not being applied:
-- an import still runs (without Undo) and Merge says it needs a quick database update.

create table if not exists public.presence_contact_imports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  file_name text not null default '',
  started_by text not null default '',
  on_existing text not null default 'skip' check (on_existing in ('skip', 'update')),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by text not null default ''
);
create index if not exists presence_contact_imports_site_idx
  on public.presence_contact_imports (site_id, created_at desc);
alter table public.presence_contact_imports enable row level security;   -- deny-all; function-mediated

create table if not exists public.presence_contact_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.presence_contact_imports(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid not null references public.presence_contacts(id) on delete cascade,
  action text not null check (action in ('added', 'updated')),
  changes jsonb not null default '{}',   -- updated: { field: { before, after } }
  created_at timestamptz not null default now()
);
create index if not exists presence_contact_import_rows_import_idx
  on public.presence_contact_import_rows (import_id);
alter table public.presence_contact_import_rows enable row level security;   -- deny-all; function-mediated

-- the record a merge folded away: who it went into, and what it takes to undo it
alter table public.presence_contacts add column if not exists merged_into uuid;
alter table public.presence_contacts add column if not exists merge_record jsonb;
comment on column public.presence_contacts.merge_record is
  'Sales item 86/105: on a contact merged into another (merged_into), what moved (deal, booking and review ids) and the kept contact''s values before the merge, so it can be undone.';

-- rollback:
--   alter table public.presence_contacts drop column if exists merge_record, drop column if exists merged_into;
--   drop table if exists public.presence_contact_import_rows;
--   drop table if exists public.presence_contact_imports;
