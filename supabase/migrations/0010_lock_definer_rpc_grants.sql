-- 0010_lock_definer_rpc_grants.sql
-- rollback: re-grant execute to anon/authenticated (see block below) — but do
--           NOT, that would reopen the hole. Rollback exists only for symmetry.
--
-- WHAT / WHY  (security fix found in the 0009 review, 2026-07-05)
--   audit_write() and rate_hit() are SECURITY DEFINER functions. `revoke all ...
--   from public` in 0008/0009 did NOT stop Supabase's `anon` and `authenticated`
--   roles from EXECUTE — those roles receive execute via Supabase defaults, not
--   only through PUBLIC. Result: any anonymous caller could invoke audit_write()
--   directly and forge audit rows (audit-log poisoning), or call rate_hit() to
--   manipulate limiter counters. Verified: anon POST /rpc/audit_write -> 200,
--   forged rows landed.
--
--   Fix: explicitly REVOKE EXECUTE from anon, authenticated, and public on both
--   functions. Only service_role may execute them — which is exactly how the
--   edge function calls them (service-role key). The edge function keeps working;
--   direct callers are denied.
-- ============================================================================

revoke execute on function "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function "public"."rate_hit"(text, timestamptz, integer) from public, anon, authenticated;

-- re-affirm the only intended grantee (idempotent; already granted in 0008/0009)
grant execute on function "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb) to "service_role";
grant execute on function "public"."rate_hit"(text, timestamptz, integer) to "service_role";

-- ============================================================================
-- ROLLBACK (do NOT run unless intentionally reopening — reintroduces the hole):
--   grant execute on function "public"."audit_write"(text,text,uuid,uuid,text,text,text,jsonb) to anon, authenticated;
--   grant execute on function "public"."rate_hit"(text, timestamptz, integer) to anon, authenticated;
-- ============================================================================
