-- APPLY 0168 (production) — Undo an import, and merge two records for one person.
-- Safe to run more than once. Two new tables (empty) and two new columns on
-- presence_contacts (empty); nothing existing changes. Paste into Supabase → SQL Editor → Run.
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
alter table public.presence_contact_imports enable row level security;

create table if not exists public.presence_contact_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.presence_contact_imports(id) on delete cascade,
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  contact_id uuid not null references public.presence_contacts(id) on delete cascade,
  action text not null check (action in ('added', 'updated')),
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists presence_contact_import_rows_import_idx
  on public.presence_contact_import_rows (import_id);
-- an index for each of its other two links, as 0164 gave every link (Supabase's adviser)
create index if not exists presence_contact_import_rows_site_id_idx on public.presence_contact_import_rows (site_id);
create index if not exists presence_contact_import_rows_contact_id_idx on public.presence_contact_import_rows (contact_id);
alter table public.presence_contact_import_rows enable row level security;

alter table public.presence_contacts add column if not exists merged_into uuid;
alter table public.presence_contacts add column if not exists merge_record jsonb;

-- Check: two tables with row level security on, the import rows' four indexes, then the two new columns.
select relname, relrowsecurity from pg_class
where relname in ('presence_contact_imports', 'presence_contact_import_rows') order by relname;
select indexname from pg_indexes where schemaname = 'public' and tablename = 'presence_contact_import_rows' order by indexname;
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'presence_contacts' and column_name in ('merged_into', 'merge_record')
order by column_name;
