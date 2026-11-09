-- APPLY 0143 (production) — "How did they find you?" on contacts and deals.
-- Safe to run more than once. Two new columns, both default '' (not recorded);
-- nothing existing changes. Paste into Supabase → SQL Editor → Run.
alter table public.presence_contacts add column if not exists found_via text not null default '';
alter table public.presence_deals add column if not exists found_via text not null default '';

-- Check: two rows, one per table.
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and column_name = 'found_via'
  and table_name in ('presence_contacts', 'presence_deals')
order by table_name;
