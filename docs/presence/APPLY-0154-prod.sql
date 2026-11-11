-- APPLY 0154 (production) — "Join our list" (builder list item 146).
-- Safe to run more than once. Two new columns on contacts (when someone joined the
-- site's email list, and what they agreed to) and one small index; nothing existing
-- changes. Paste into Supabase → SQL Editor → Run.
alter table public.presence_contacts add column if not exists subscribed_at timestamptz;
alter table public.presence_contacts add column if not exists subscribed_note text not null default '';
create index if not exists presence_contacts_subscribed_idx
  on public.presence_contacts (site_id) where subscribed_at is not null and deleted_at is null;

-- Check: two rows (subscribed_at, subscribed_note) and the index.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'presence_contacts' and column_name in ('subscribed_at', 'subscribed_note')
order by column_name;
select indexname from pg_indexes where schemaname = 'public' and indexname = 'presence_contacts_subscribed_idx';
