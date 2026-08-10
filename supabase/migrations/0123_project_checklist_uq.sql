-- ── One row per delivery-checklist step, per project (the guarantee alone) ───
-- WHAT CHANGED IN THE CODE. The studio's Tasks card now offers the ten standard
-- delivery steps (lib/project_checklist.ts) as a PICKER: Eric ticks the steps he
-- wants instead of retyping them, and each one is written as the seeder would
-- have written it — same title, same client flags, and the same addressable
-- `source = 'checklist:<key>'`. Adding a step is therefore a normal INSERT into
-- presence_tasks made by a human, at a time of their choosing, possibly from two
-- tabs at once.
--
-- WHY THIS MIGRATION EXISTS SEPARATELY. The invariant it protects — AT MOST ONE
-- LIVE ROW PER (project, checklist step) — is what makes the auto-tick correct:
-- tickChecklistStep (lib/service_bridge.ts) PATCHes `source=eq.checklist:<key> &
-- status=neq.done` and treats "one row matched" as the fact that the step just
-- moved. Two rows for the same step means the deposit ticks one of them, the
-- progress denominator counts both, and the bar reads 5% when it should read
-- 10%. Numbers that lie, again.
--
-- That index is already written down — but inside 0120_project_checklist_backfill,
-- whose main body is a bulk BACKFILL a studio may reasonably not have run yet.
-- The picker's route (routes/projects.ts handleProjectChecklist) reads the live
-- steps and inserts only the gap, so it never OFFERS a duplicate; this index is
-- the second half of that promise — the part that holds when two tabs, or a tab
-- and the backfill, race between that read and that write. Until it exists, the
-- race writes a duplicate silently. With it, the loser gets a 409 the route
-- answers honestly.
--
-- APPLY IT WHEN YOU LIKE, IN EITHER ORDER, AS OFTEN AS YOU LIKE.
--   • If 0120 has already run, this migration finds the index present and does
--     nothing at all (`create unique index if not exists`, same name, same
--     definition — byte-identical to 0120's STEP 5).
--   • If 0120 has NOT run, this gives the guarantee without seeding a single row
--     or touching a single task. Running 0120 afterwards is still fine.
--
-- PROPERTIES
--   • IDEMPOTENT — `if not exists` on the index; the pre-flight de-duplication
--     below only ever touches rows that are ALREADY duplicates, and after the
--     first run there are none.
--   • ADDITIVE-SAFE — no table, column, policy, grant, or RLS setting is
--     created, altered, or dropped. No row is hard-deleted.
--   • TENANT-SAFE — the de-duplication partitions by project_id, so it can only
--     ever compare a project's rows with its own.
--   • PARTIAL ON PURPOSE — presence_tasks.source is 'manual' for ordinary work
--     and 'template' for starter-template tasks, so a plain unique index on
--     (project_id, source) would reject perfectly normal tasks. Only the
--     addressable 'checklist:%' rows need to be unique, and only while live.

-- ── STEP 1 · make the index creatable ───────────────────────────────────────
-- A unique index cannot be built over existing duplicates, and a duplicate is
-- exactly what could have been written before this index existed (two tabs, or
-- a hand-inserted row). Keep ONE row per (project, step) and SOFT-delete the
-- rest — never a hard delete, because a duplicate may still carry a completed_at
-- the studio set. The keeper is chosen so nothing that was ticked is lost:
-- a 'done' row wins over an open one, then the oldest wins (it is the one the
-- auto-tick has been addressing all along).
update public.presence_tasks t
   set deleted_at = now(),
       updated_at = now()
  from (
    select id,
           row_number() over (
             partition by project_id, source
             order by (status = 'done') desc, created_at asc, id asc
           ) as rn
      from public.presence_tasks
     where source like 'checklist:%'
       and deleted_at is null
  ) d
 where t.id = d.id
   and d.rn > 1;

-- ── STEP 2 · the guarantee ──────────────────────────────────────────────────
-- Identical to 0120's STEP 5 — same name, same columns, same predicate — so
-- whichever migration runs first defines it and the other is a no-op.
create unique index if not exists presence_tasks_project_checklist_uq
  on public.presence_tasks (project_id, source)
  where source like 'checklist:%' and deleted_at is null;

comment on index public.presence_tasks_project_checklist_uq is
  'One row per delivery-checklist step per project. presence_tasks.source carries checklist:<key> (lib/project_checklist.ts) so the auto-tick can address a single step with one WHERE-matched PATCH; this index is what guarantees that PATCH can only ever match one row, and what makes the studio''s step picker safe against two tabs racing. Partial — ordinary manual/template tasks are untouched.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect one row; duplicates = 0.
--   select count(*) filter (where true) as checklist_rows,
--          count(*) - count(distinct (project_id, source)) as duplicates
--     from public.presence_tasks
--    where source like 'checklist:%' and deleted_at is null;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Drops only the guarantee. The de-duplication is deliberately NOT undone: the
-- rows it soft-deleted were duplicates, and restoring them would restore the
-- miscount. If you must, they are the checklist rows with a deleted_at.
--   drop index if exists public.presence_tasks_project_checklist_uq;
