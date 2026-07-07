-- ── L4.2 Connected Intelligence ─────────────────────────────────────────────
-- Connected data should make the platform SMARTER, not noisier. To detect
-- MEANINGFUL CHANGE (more visitors, a lifted rating, new reviews) the read cache
-- needs to remember its previous observation, so the Evidence Engine can compare
-- the freshest snapshot against the one before it. Additive, read-only, and
-- deny-all like the row it extends — no new surface, no new capability.
alter table public.presence_connected_data
  add column if not exists prev jsonb,                      -- the normalized snapshot before this one (null on first read)
  add column if not exists prev_fetched_at timestamptz;     -- the honest as-of time of that prior snapshot

comment on column public.presence_connected_data.prev is
  'L4.2. The immediately-preceding normalized snapshot. saveConnectedData rolls the current data here before overwriting, so the Evidence Engine can observe change (traffic up, rating up, new reviews) deterministically. Never customer-visible; feeds the pipeline as ordinary evidence.';

-- rollback:
--   alter table public.presence_connected_data drop column if exists prev, drop column if exists prev_fetched_at;
