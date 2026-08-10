-- ── 0128 — GA4: per-connection provider settings (property selection) ────────
-- Additive + idempotent. A Google account usually holds SEVERAL GA4 properties;
-- reporting is always against exactly one (POST /v1beta/properties/{id}:runReport,
-- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport).
-- The chosen property is a fact about the CONNECTION, not a secret and not read
-- data, so it lives on presence_connections itself — a small config jsonb, e.g.
--   { "property_id": "313646501", "property_name": "Bacchus Kitchen", "auto_selected": true }
-- Never tokens (those stay sealed in presence_connection_secrets), never raw API
-- payloads (those stay in presence_connected_data). Same deny-all RLS as the rest
-- of the row: read through the presence function only.

alter table public.presence_connections
  add column if not exists config jsonb not null default '{}'::jsonb;

comment on column public.presence_connections.config is
  '0128. Per-provider connection settings — e.g. the selected GA4 property_id. Non-secret facts about HOW to read, never tokens and never provider payloads.';

-- ROLLBACK (reference):
--   alter table public.presence_connections drop column if exists config;
