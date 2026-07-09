-- ── Phase T-BLOCKS: structured content blocks ───────────────────────────────
-- The reusable component/block library, realized. `blocks` holds a validated,
-- capped array of CHOSEN-AND-FILLED structured blocks (features, stats, team,
-- process, pricing, certifications, service_areas, cta_banner) — typed fields,
-- never free-form HTML. The authoritative validation/caps live in
-- lib/site_blocks.ts (applied at serialize time); this column is just structured
-- storage on the existing settings row (no new table, no new pipeline).
alter table public.presence_settings
  add column if not exists blocks jsonb not null default '[]';
-- rollback: alter table public.presence_settings drop column if exists blocks;
