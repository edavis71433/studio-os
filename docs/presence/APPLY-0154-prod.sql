-- APPLY 0154 (production) — A trash for sites, and deleted pages kept for 30 days (builder list item 154).
-- Safe to run more than once. Adds three columns and a third state to presence_agency_clients, one table
-- (presence_deleted_pages) and one trigger on presence_settings that can never block a save. No rows change.
-- Paste into Supabase → SQL Editor → Run, BEFORE the backend deploy. Until it runs, Move to trash says it needs
-- one database step and does nothing, and Versions shows no deleted pages.
-- ── 1. the trash ──
alter table public.presence_agency_clients
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by text,
  add column if not exists trashed_was_live boolean not null default false;
alter table public.presence_agency_clients drop constraint if exists presence_agency_clients_status_check;
alter table public.presence_agency_clients
  add constraint presence_agency_clients_status_check check (status in ('active','archived','trashed'));
create index if not exists presence_agency_clients_trash_idx
  on public.presence_agency_clients (trashed_at) where status = 'trashed';

-- ── 2. deleted pages, kept 30 days ──
create table if not exists public.presence_deleted_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  slug text not null,
  title text not null default '',
  page jsonb not null,
  deleted_at timestamptz not null default now()
);
create index if not exists presence_deleted_pages_site_idx on public.presence_deleted_pages (site_id, deleted_at desc);
alter table public.presence_deleted_pages enable row level security;
-- deny-all: no policies, so only the service role (routes/deleted_pages.ts) reads or writes it.

create or replace function public.presence_keep_deleted_pages() returns trigger
    language plpgsql security definer set search_path = public
    as $$
declare
  gone jsonb;
begin
  begin
    if jsonb_typeof(OLD.pages) = 'array' then
      for gone in select p from jsonb_array_elements(OLD.pages) as p loop
        continue when jsonb_typeof(gone) <> 'object' or coalesce(gone->>'slug', '') = '';
        -- still there
        continue when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(NEW.pages) = 'array' then NEW.pages else '[]'::jsonb end) n where n->>'slug' = gone->>'slug');
        -- renamed: the same sections under another address
        continue when jsonb_typeof(gone->'blocks') = 'array' and jsonb_array_length(gone->'blocks') > 0
          and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(NEW.pages) = 'array' then NEW.pages else '[]'::jsonb end) n where n->'blocks' = gone->'blocks');
        insert into public.presence_deleted_pages (site_id, slug, title, page)
          values (NEW.site_id, left(gone->>'slug', 80), left(coalesce(gone->>'title', ''), 120), gone);
      end loop;
    end if;
    -- a page that came back as it was (Undo) leaves the list
    delete from public.presence_deleted_pages d
      using jsonb_array_elements(case when jsonb_typeof(NEW.pages) = 'array' then NEW.pages else '[]'::jsonb end) n
      where d.site_id = NEW.site_id and d.slug = n->>'slug' and d.page->'blocks' is not distinct from n->'blocks';
    -- kept 30 days
    delete from public.presence_deleted_pages where site_id = NEW.site_id and deleted_at < now() - interval '30 days';
  exception when others then
    null;   -- never in the way of a save
  end;
  return null;
end $$;
revoke all on function public.presence_keep_deleted_pages() from public;

drop trigger if exists presence_settings_keep_deleted_pages on public.presence_settings;
create trigger presence_settings_keep_deleted_pages
  after update of pages on public.presence_settings
  for each row when (OLD.pages is distinct from NEW.pages)
  execute function public.presence_keep_deleted_pages();
-- check: select column_name from information_schema.columns where table_schema = 'public' and table_name = 'presence_agency_clients'
--        and column_name in ('trashed_at','trashed_by','trashed_was_live');   -- 3 rows
-- check: select pg_get_constraintdef(oid) from pg_constraint where conname = 'presence_agency_clients_status_check';   -- CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'trashed'::text])))
-- check: select tgname from pg_trigger where tgname = 'presence_settings_keep_deleted_pages';   -- 1 row
