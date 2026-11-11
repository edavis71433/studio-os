-- APPLY 0166 (production) — a contact holds a job title, a second phone, an address and tags.
-- Safe to run more than once. Four new columns on presence_contacts, all empty by
-- default, and one index for filtering by a tag; nothing existing changes.
-- Paste into Supabase → SQL Editor → Run.
alter table public.presence_contacts add column if not exists job_title text not null default '';
alter table public.presence_contacts add column if not exists phone2 text not null default '';
alter table public.presence_contacts add column if not exists address jsonb not null default '{}';
alter table public.presence_contacts add column if not exists tags text[] not null default '{}';
create index if not exists presence_contacts_tags_idx
  on public.presence_contacts using gin (tags) where deleted_at is null;

-- Check: four rows (job_title, phone2, address, tags) and then one row for the index.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'presence_contacts'
  and column_name in ('job_title', 'phone2', 'address', 'tags')
order by column_name;
select indexname from pg_indexes where schemaname = 'public' and indexname = 'presence_contacts_tags_idx';
