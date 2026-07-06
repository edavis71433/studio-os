-- rollback: revoke the grants below (see ROLLBACK block). No schema/policy/table/column/trigger is touched.
--
-- 0017: Presence table grants — the corrective migration authorized after the
--   M2 production deploy revealed that presence_* tables had no table-level
--   GRANT to the authenticated role on production (staging auto-granted via
--   ALTER DEFAULT PRIVILEGES; production did not). PostgreSQL checks table
--   grants BEFORE RLS, so authenticated clients hit 42501 on every presence
--   table and the RLS policies 0015 wrote were unreachable. This makes them
--   reachable — nothing else.
--
-- PRINCIPLE: grant exactly where an RLS policy for that role already exists;
--   least privilege, matching the 0015 policy map. RLS still gates every row.
--
-- STRICT: no schema change, no policy change, no anon grant, and NO grant to
--   snapshots/publishes/entitlements (those stay default-deny by design —
--   service role only).

-- ── content tables: full CRUD for authenticated (RLS FOR ALL scopes rows) ──
grant select, insert, update, delete on public.presence_identity     to authenticated;
grant select, insert, update, delete on public.presence_locations    to authenticated;
grant select, insert, update, delete on public.presence_offerings    to authenticated;
grant select, insert, update, delete on public.presence_testimonials to authenticated;
grant select, insert, update, delete on public.presence_faqs         to authenticated;
grant select, insert, update, delete on public.presence_posts        to authenticated;
grant select, insert, update, delete on public.presence_media        to authenticated;
grant select, insert, update, delete on public.presence_voice        to authenticated;

-- ── read-only-for-authenticated tables (RLS has only a SELECT policy) ──
grant select on public.presence_sites         to authenticated;
grant select on public.presence_redirects     to authenticated;
grant select on public.presence_change_events to authenticated;

-- Deliberately NOT granted (default-deny preserved; service role only):
--   presence_snapshots, presence_publishes, presence_entitlements
-- Deliberately NO grants to anon on any presence table.

-- ROLLBACK
-- revoke select, insert, update, delete on public.presence_identity     from authenticated;
-- revoke select, insert, update, delete on public.presence_locations    from authenticated;
-- revoke select, insert, update, delete on public.presence_offerings    from authenticated;
-- revoke select, insert, update, delete on public.presence_testimonials from authenticated;
-- revoke select, insert, update, delete on public.presence_faqs         from authenticated;
-- revoke select, insert, update, delete on public.presence_posts        from authenticated;
-- revoke select, insert, update, delete on public.presence_media        from authenticated;
-- revoke select, insert, update, delete on public.presence_voice        from authenticated;
-- revoke select on public.presence_sites         from authenticated;
-- revoke select on public.presence_redirects     from authenticated;
-- revoke select on public.presence_change_events from authenticated;
