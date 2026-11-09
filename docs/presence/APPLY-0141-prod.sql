-- ===========================================================================
--  APPLY PACK - migration 0141  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, the PRODUCTION project). No deploy
--  needed before or after. IDEMPOTENT: a grant that is already there is a
--  no-op, so re-running is safe. Changes no data and no table.
--
--  What it fixes:
--   Every 15-minute run has ended "failed" because one cleanup step was
--   refused: "permission denied for function prune_evidence_runs". This lets
--   the server's own account run that step. Within 15 minutes the runs finish
--   "done" again. Production's health report turns OK about a day later, once
--   the old failures leave its 24-hour count.
--
--  Rollback (only if ever needed; it brings the failure back):
--    revoke execute on function public.prune_evidence_runs(int) from service_role;
--
--  Covers: supabase/migrations/0141_prune_evidence_runs_grant.sql
-- ===========================================================================

grant execute on function public.prune_evidence_runs(int) to service_role;

-- Verify (expect one row: true, false, false):
select has_function_privilege('service_role', 'public.prune_evidence_runs(int)', 'execute') as server_can_prune,
       has_function_privilege('anon', 'public.prune_evidence_runs(int)', 'execute') as anon_can_prune,
       has_function_privilege('authenticated', 'public.prune_evidence_runs(int)', 'execute') as signed_in_can_prune;
