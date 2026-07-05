-- 0011_messages_index.sql
-- rollback: drop index public.messages_client_created_idx;
--
-- WHAT / WHY  (messaging audit, 2026-07-05 — PERFORMANCE)
--   Every message read is `messages?client_id=eq.<id>&order=created_at...`
--   (client_conversation limit 500, the portal's 15s poll with NO limit, the
--   admin thread limit 200, conversation_summary, client_pulse, etc.). The
--   table has indexes on tenant_id, agency_id, and deleted_at — but NONE on
--   client_id or created_at, so every thread read scans and sorts. Add the
--   composite index matching the query, partial on live rows (reads target
--   non-deleted messages).
--   (messages has no contact_id column, so no contact_id index — the routes
--   that queried by contact_id were a bug, fixed separately in the function.)
-- ============================================================================

create index if not exists "messages_client_created_idx"
  on "public"."messages" ("client_id", "created_at" desc)
  where "deleted_at" is null;

-- ============================================================================
-- ROLLBACK:
--   drop index if exists "public"."messages_client_created_idx";
-- Index only; no data affected.
-- ============================================================================
