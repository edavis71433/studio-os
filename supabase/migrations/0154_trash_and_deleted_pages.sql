-- 0154 — A trash for sites, and deleted pages kept for 30 days (builder list item 154, Nov 2026 review)
--
-- 1. The studio's site list (presence_agency_clients) gets a third state, 'trashed',
--    beside active and archived: "Move to trash" on Sites takes a site offline and
--    out of every list; for 90 days one press restores it, then the daily job
--    deletes it for good (ops/site_trash.ts). trashed_at says when it went in,
--    trashed_by who moved it, trashed_was_live whether it had been live.
--
-- 2. presence_deleted_pages keeps every page that leaves a site's draft, exactly as
--    it was stored, for 30 days, so Versions can list them and put one back alone
--    (routes/deleted_pages.ts). Restoring a version never brought a page back: the
--    draft writer rewrites business details, hours and lists, not pages. A trigger
--    on presence_settings keeps them, whichever save removed the page; a page whose
--    sections reappear under another address was renamed, not deleted; a page that
--    comes back with the same sections (Undo) leaves the list. The trigger can never
--    stand in the way of a save: any error inside it is swallowed.
--
-- rollback: drop trigger if exists presence_settings_keep_deleted_pages on public.presence_settings;
--   drop function if exists public.presence_keep_deleted_pages(); drop table if exists public.presence_deleted_pages;
--   update public.presence_agency_clients set status = 'archived' where status = 'trashed';
--   alter table public.presence_agency_clients drop constraint if exists presence_agency_clients_status_check;
--   alter table public.presence_agency_clients add constraint presence_agency_clients_status_check check (status in ('active','archived'));
--   alter table public.presence_agency_clients drop column if exists trashed_at, drop column if exists trashed_by, drop column if exists trashed_was_live;

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
