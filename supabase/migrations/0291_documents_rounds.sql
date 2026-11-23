-- 0291 — The Documents page's Remind, and revision rounds with priced extra work (sales items
-- 180 and 179, Nov 22 2026 review).
--
-- presence_proposals, presence_estimates, presence_contracts
--   reminded_at    sales item 180: when the studio pressed Remind on the Documents page. The
--                  never-twice guard rides the write (reminded_at=is.null), so the client's link
--                  is re-sent once per document, however often the button is pressed.
-- presence_deals
--   revision_rounds  sales item 179: how many rounds of changes the deal includes (the studio's
--                  own agreement says two). Null means rounds aren't counted on this deal.
-- presence_estimates
--   extra_work     sales item 179: true for an estimate made from a change request beyond the
--                  included rounds ("Extra work"). Once approved it adds a to-do on the project
--                  and a draft invoice.
--   approval_id    the change request it came from (one estimate per request: unique).
--   project_id     the project that request was on, for the to-do.
-- No status list, deal-event kind or notice kind changes: history lines ride kind='note' rows.

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

-- rollback:
--   drop index if exists public.presence_estimates_approval_uniq;
--   alter table public.presence_estimates drop column if exists extra_work, drop column if exists approval_id,
--     drop column if exists project_id, drop column if exists reminded_at;
--   alter table public.presence_deals drop constraint if exists presence_deals_revision_rounds_check;
--   alter table public.presence_deals drop column if exists revision_rounds;
--   alter table public.presence_proposals drop column if exists reminded_at;
--   alter table public.presence_contracts drop column if exists reminded_at;

select public.presence_ledger_note(291, 'documents_rounds');
