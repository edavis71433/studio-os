-- ===========================================================================
--  APPLY PACK - migration 0291  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), AFTER APPLY-0260
--  (this writes into its ledger) and BEFORE the deploy.yml run that ships sales items 180
--  and 179 (the release refuses to go out until production's ledger has 291).
--  IDEMPOTENT ("if not exists", "drop constraint if exists"), additive, safe to re-run.
--
--  Why: the Documents page's Remind re-sends a client's link once per document (180), and a
--  deal counts its included revision rounds, turning a change request beyond them into an
--  "Extra work" estimate (179). No existing check list is touched: the one constraint here is
--  new, on a new column.
--
--  Covers: supabase/migrations/0291_documents_rounds.sql
-- ===========================================================================

alter table public.presence_proposals add column if not exists reminded_at timestamptz;
alter table public.presence_estimates add column if not exists reminded_at timestamptz;
alter table public.presence_contracts add column if not exists reminded_at timestamptz;

alter table public.presence_deals
  add column if not exists revision_rounds smallint;
alter table public.presence_deals
  drop constraint if exists presence_deals_revision_rounds_check;
alter table public.presence_deals
  add constraint presence_deals_revision_rounds_check
  check (revision_rounds is null or revision_rounds between 0 and 20);

alter table public.presence_estimates
  add column if not exists extra_work boolean not null default false,
  add column if not exists approval_id uuid references public.presence_approvals(id) on delete set null,
  add column if not exists project_id uuid references public.presence_projects(id) on delete set null;
create unique index if not exists presence_estimates_approval_uniq
  on public.presence_estimates (approval_id) where approval_id is not null and deleted_at is null;

comment on column public.presence_deals.revision_rounds is
  'Sales item 179: rounds of changes included on this deal (null = not counted). A client''s Request changes beyond them becomes an Extra work estimate.';
comment on column public.presence_estimates.extra_work is
  'Sales item 179: made from a change request beyond the included rounds; approving it adds a project to-do and a draft invoice.';


select public.presence_ledger_note(291, 'documents_rounds');

-- Verify right away (expect: 7 columns; the deal check; the unique index; then 291 in the ledger):
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and (column_name = 'reminded_at' or (table_name = 'presence_deals' and column_name = 'revision_rounds')
   or (table_name = 'presence_estimates' and column_name in ('extra_work', 'approval_id', 'project_id'))) order by 1, 2;
select conname from pg_constraint where conname = 'presence_deals_revision_rounds_check';
select indexname from pg_indexes where indexname = 'presence_estimates_approval_uniq';
select max(number) as ledger_newest from public.presence_change_ledger;
