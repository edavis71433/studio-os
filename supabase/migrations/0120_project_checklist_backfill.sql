-- ── Standard delivery checklist — backfill for projects that predate it ─────
-- WHAT CHANGED IN THE CODE. ensureProjectForDeal (lib/service_bridge.ts) used to
-- create an EMPTY project, so a converted deal read "PROGRESS 0% · 0/0 tasks"
-- forever — progress is COMPUTED from tasks (lib/service_delivery.ts progressOf),
-- so with no tasks there was no number that could ever move. A new project now
-- starts as the studio's ten-step delivery checklist (lib/project_checklist.ts),
-- each step worth exactly 10%, with three of them ticking themselves from facts
-- the system already owns (the contract sign path, a paid deposit, a live site).
--
-- WHY THIS MIGRATION. That only helps projects created from now on. The projects
-- that already exist — Bacchus among them — would sit at 0/0 forever, which is
-- exactly the complaint. This gives them the same checklist, and then tells the
-- truth about the steps that are ALREADY DONE rather than starting a live
-- project at zero.
--
-- APPLY IT WHEN YOU LIKE — before or after the function deploy. It is pure data:
-- no table, column, constraint, policy, grant, or RLS setting is created,
-- altered, or dropped, and nothing is deleted. If you never apply it, new
-- projects still get their checklist from the code and old ones simply keep
-- reading 0/0, exactly as they do today.
--
-- PROPERTIES
--   • IDEMPOTENT — safe to run twice, ten times, or a year apart:
--       – STEP 1 seeds ONLY projects that have NO presence_tasks row at all
--         (soft-deleted rows count — a studio that deleted these steps meant it,
--         and a re-run must not resurrect them). After the first run every
--         touched project has ten rows, so the second run matches nothing.
--       – STEPS 2-4 only ever move a row that is not already 'done', and
--         completed_at is COALESCEd, so a re-run cannot restamp a date.
--       – STEP 5 is `create unique index if not exists`.
--   • ADDITIVE — inserts and status flips only. No UPDATE touches a task the
--     studio wrote (every one is filtered to `source like 'checklist:%'`), and
--     no row is ever deleted.
--   • TENANT-SAFE — every insert carries the project's OWN site_id, and every
--     evidence lookup is joined on both project and site.
--   • RLS UNTOUCHED — presence_tasks keeps exactly the policies it has today.
--
-- THE `source` COLUMN IS THE KEY. presence_tasks.source is free text (0075,
-- default 'manual'; the optional starter template writes 'template'). Each step
-- carries 'checklist:<key>', which is what lets the code tick ONE addressable row
-- with a single WHERE-matched PATCH — no title matching, no positional guessing.
-- The keys below MUST stay identical to DELIVERY_CHECKLIST in
-- supabase/functions/presence/lib/project_checklist.ts.
--
-- CLIENT VISIBILITY. client_visible = client_action_required, the convention
-- applyTemplate already established: a step is shared with the customer exactly
-- when it needs the customer to act. Seven of the ten are the studio's own work
-- and stay internal; the three that are genuinely the client's homework are
-- shared, and are worded as the ASK because the portal prints the raw title on
-- their to-do card.
--
-- WHO TICKS IT, THOUGH, IS A THIRD QUESTION — and it is NOT a third column.
-- Those three steps are shown to the customer and ARE their ask, but the studio
-- marks them off: only the studio can see that the questionnaire really came
-- back, and the studio's progress bar is computed from these very rows, so a
-- customer's self-tick would move the studio's number on evidence it does not
-- have. That rule is read off `source` (every checklist step carries
-- 'checklist:<key>', below) rather than off either boolean — see clientMayTick
-- in lib/project_checklist.ts, enforced in routes/client_delivery.ts. So THESE
-- INSERTS ARE UNCHANGED by that decision: both flags still ride the same
-- client_action value, exactly as they always did. Ordinary manual/template
-- tasks carry no 'checklist:' source and keep their client Mark-done button.

-- ── STEP 1 · seed the ten steps onto every task-less project ────────────────
with steps(key, title, client_action, sort_order) as (
  values
    ('agreement_signed',       'Agreement signed',                     false, 0),
    ('deposit_paid',           'Deposit paid',                         false, 10),
    ('questionnaire_returned', 'Send back your project questionnaire',  true, 20),
    ('content_received',       'Send your content and photos',          true, 30),
    ('draft_shared',           'Design draft shared',                  false, 40),
    ('client_review',          'Review the design draft',               true, 50),
    ('revisions',              'Revisions',                            false, 60),
    ('domain_connected',       'Domain connected',                     false, 70),
    ('site_live',              'Site live',                            false, 80),
    ('handover',               'Handover',                             false, 90)
),
targets as (
  select p.id as project_id, p.site_id
  from public.presence_projects p
  where p.deleted_at is null
    -- ANY task row disqualifies the project, including a soft-deleted one.
    -- This is BOTH the "don't touch a project the studio is already running"
    -- rule and the re-run guard.
    and not exists (select 1 from public.presence_tasks t where t.project_id = p.id)
)
insert into public.presence_tasks
  (site_id, project_id, title, detail, status, priority, client_visible, client_action_required, sort_order, source)
select t.site_id, t.project_id, s.title, '', 'todo', 'normal', s.client_action, s.client_action, s.sort_order, 'checklist:' || s.key
from targets t
cross join steps s;

-- ── STEP 2 · a signed agreement is step 1, already done ─────────────────────
-- Evidence, not guesswork: a contract row on the project's deal with status
-- 'signed'. The same fact reconcileChecklistFacts reads at handoff time.
update public.presence_tasks t
set status = 'done',
    completed_at = coalesce(t.completed_at, now()),
    updated_at = now()
from public.presence_projects p
where t.project_id = p.id
  and t.site_id = p.site_id
  and t.source = 'checklist:agreement_signed'
  and t.status <> 'done'
  and t.deleted_at is null
  and p.deal_id is not null
  and exists (
    select 1 from public.presence_contracts c
    where c.deal_id = p.deal_id and c.site_id = p.site_id
      and c.status = 'signed' and c.deleted_at is null
  );

-- ── STEP 3 · a paid deposit is step 2, already done ─────────────────────────
-- A deposit is NOT a separate flow — it is presence_invoices.purpose='deposit'
-- (0086), so the evidence is a paid invoice of that purpose on the same deal.
update public.presence_tasks t
set status = 'done',
    completed_at = coalesce(t.completed_at, now()),
    updated_at = now()
from public.presence_projects p
where t.project_id = p.id
  and t.site_id = p.site_id
  and t.source = 'checklist:deposit_paid'
  and t.status <> 'done'
  and t.deleted_at is null
  and p.deal_id is not null
  and exists (
    select 1 from public.presence_invoices i
    where i.deal_id = p.deal_id and i.site_id = p.site_id
      and i.purpose = 'deposit' and i.status = 'paid' and i.deleted_at is null
  );

-- ── STEP 4 · a live customer site is step 9, already done ───────────────────
-- Resolved through the ACTIVE service link only, so the evidence can never come
-- from another tenant's site.
update public.presence_tasks t
set status = 'done',
    completed_at = coalesce(t.completed_at, now()),
    updated_at = now()
from public.presence_projects p
where t.project_id = p.id
  and t.site_id = p.site_id
  and t.source = 'checklist:site_live'
  and t.status <> 'done'
  and t.deleted_at is null
  and exists (
    select 1
    from public.presence_service_links l
    join public.presence_sites s on s.id = l.customer_site_id
    where l.project_id = p.id and l.status = 'active'
      and s.status = 'live' and s.last_published_at is not null
  );

-- ── STEP 5 · make a duplicate checklist structurally impossible ─────────────
-- PARTIAL on purpose. presence_tasks.source is 'manual' for most rows and
-- 'template' for every task the starter template writes, so a plain unique index
-- on (project_id, source) would reject perfectly ordinary work. Only the
-- addressable 'checklist:%' rows — the ones the auto-tick targets by source —
-- need to be unique per project, and only while they are live.
create unique index if not exists presence_tasks_project_checklist_uq
  on public.presence_tasks (project_id, source)
  where source like 'checklist:%' and deleted_at is null;

comment on index public.presence_tasks_project_checklist_uq is
  'One row per delivery-checklist step per project. presence_tasks.source carries checklist:<key> (lib/project_checklist.ts) so the auto-tick can address a single step with one WHERE-matched PATCH; this index is what guarantees that PATCH can only ever match one row. Partial — ordinary manual/template tasks are untouched.';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Removes only what this migration added; nothing else in presence_tasks
-- carries a 'checklist:' source.
--   drop index if exists public.presence_tasks_project_checklist_uq;
--   delete from public.presence_tasks where source like 'checklist:%';
