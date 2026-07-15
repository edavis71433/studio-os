-- ── Proposal viewed-tracking + expiry (#205) ────────────────────────────────
-- first_viewed_at: stamped the first time a prospect opens the proposal's public
--   link, so the operator knows it landed (a Salesforce open-tracking parity).
-- expires_at: an optional expiry; acceptance is blocked once past (default 30 days
--   set on send). Both are nullable + additive; the code is deploy-order-tolerant
--   (reads fall back to the pre-migration select if these columns don't exist yet).
alter table public.presence_proposals add column if not exists first_viewed_at timestamptz;
alter table public.presence_proposals add column if not exists expires_at timestamptz;
