-- ── Phase B1: Developer-Mode layer becomes part of the snapshot ──────────────
-- ONE additive column. A snapshot already fully determines a render; this lets
-- the Developer-Mode presentation layer (theme tokens + sanitized CSS/HTML) ride
-- in the snapshot as a SIBLING of content — so a developer edit is versioned,
-- rolled back, restored and previewed through the exact same pipeline as any
-- content change. Nullable: existing snapshots (and sites with no customization)
-- keep NULL and render byte-identically to before. Values are sanitized in the
-- function before they ever reach here. Isolation/approval/audit unchanged.
alter table public.presence_snapshots
  add column if not exists dev_customization jsonb;
comment on column public.presence_snapshots.dev_customization is
  'Phase B1. Optional Developer-Mode presentation layer captured at snapshot time (theme_tokens + custom_css + custom_html, pre-sanitized). NULL = no customization = byte-identical render. Rolled back/restored/previewed with the snapshot through the one pipeline.';

-- rollback:
--   alter table public.presence_snapshots drop column if exists dev_customization;
