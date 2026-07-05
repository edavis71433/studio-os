-- 0012_messages_from_who_integrity.sql
-- rollback: see block below (restores the looser policy — reopens the spoof).
--
-- WHAT / WHY  (messaging audit, 2026-07-05 — SECURITY / INTEGRITY, verified exploit)
--   The portal inserts client messages DIRECTLY to /rest/v1/messages under the
--   client's JWT. The client INSERT policy only checked client_id, NOT from_who,
--   so a client could POST from_who='studio' + sender_name='Eric Davis' and
--   forge a message that renders in their portal as if it came from the studio
--   (e.g. a fabricated refund promise, for a dispute/chargeback). Verified: such
--   an insert returned HTTP 201 and landed.
--
--   Fix: tighten the client INSERT WITH CHECK to also require from_who = 'client'.
--   The portal already sends from_who='client', so legitimate sends are
--   unaffected; only forged sender values are rejected. The studio side writes
--   via the edge function using the SERVICE ROLE (RLS bypass), so Eric's
--   from_who='eric' sends are unaffected.
-- ============================================================================

drop policy if exists "client inserts own messages" on "public"."messages";
create policy "client inserts own messages" on "public"."messages"
  for insert to "authenticated"
  with check (
    ("client_id" in ( select "public"."current_client_ids"() ))
    and ("from_who" = 'client')
  );

-- ============================================================================
-- ROLLBACK (reopens the spoof — do not run unless intentional):
--   drop policy if exists "client inserts own messages" on "public"."messages";
--   create policy "client inserts own messages" on "public"."messages"
--     for insert to "authenticated"
--     with check ("client_id" in ( select "public"."current_client_ids"() ));
-- ============================================================================
