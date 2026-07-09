-- ── Phase T · Brand Kit (FD-T9) ──────────────────────────────────────────────
-- One source of truth for a business's brand — a logo + colour + type — stored on
-- the settings row. It DERIVES the existing dev-layer theme tokens (no second
-- theme engine); this column just persists the source so the kit can be re-shown,
-- re-applied, and read by emails/documents. Structured JSON, validated in
-- lib/brand_kit.ts (sanitizeBrandKit) at the write boundary.
alter table public.presence_settings
  add column if not exists brand_kit jsonb;
-- rollback: alter table public.presence_settings drop column if exists brand_kit;
