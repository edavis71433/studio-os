-- APPLY 0199 (production) — An owner on each to-do (sales item 37, owners and "Mine").
-- Safe to run more than once. One new empty column and one index on the to-dos table;
-- nothing existing changes. Run before the functions deploy that carries sales item 37.
begin;

alter table public.presence_deal_tasks add column if not exists assigned_to uuid;
comment on column public.presence_deal_tasks.assigned_to is
  'Sales item 37: who owns this to-do (their sign-in id). Empty = the business owner''s (to-dos from before owners existed).';
create index if not exists presence_deal_tasks_owner_idx on public.presence_deal_tasks (site_id, assigned_to) where deleted_at is null and status = 'open';

commit;

-- Check: the column is there and empty, and the index exists.
select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'presence_deal_tasks' and column_name = 'assigned_to';
select count(*) filter (where assigned_to is not null) as owned, count(*) as todos from public.presence_deal_tasks;
select indexname from pg_indexes where schemaname = 'public' and indexname = 'presence_deal_tasks_owner_idx';
