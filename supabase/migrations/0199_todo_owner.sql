-- 0199 — An owner on each to-do (sales item 37, owners and "Mine"), Nov 2026.
-- rollback: drop index if exists public.presence_deal_tasks_owner_idx; alter table public.presence_deal_tasks drop column if exists assigned_to;
--
-- Once a second person is on a studio's team, every deal, request and to-do has an owner,
-- and "Mine" shows only yours on Pipeline, Requests and To-dos. Deals and requests have
-- carried assigned_to (the person's sign-in id) since 0074 and 0078; to-dos
-- (presence_deal_tasks, 0108) get it here. Whoever adds a to-do owns it; one with no owner,
-- from before this, counts as the business owner's. Nothing existing changes.
--
-- Function-mediated, deny-all row level security like every sales table (0074). The code
-- tolerates this migration not being applied yet: a to-do saves without its owner, and Mine
-- on To-dos treats every to-do as the business owner's.

alter table public.presence_deal_tasks add column if not exists assigned_to uuid;
comment on column public.presence_deal_tasks.assigned_to is
  'Sales item 37: who owns this to-do (their sign-in id). Empty = the business owner''s (to-dos from before owners existed).';
-- To-dos' Mine reads a studio's open ones for one person
create index if not exists presence_deal_tasks_owner_idx on public.presence_deal_tasks (site_id, assigned_to) where deleted_at is null and status = 'open';
