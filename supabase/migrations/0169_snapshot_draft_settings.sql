-- 0169 — A restore brings back sections, pages and the menu (builder list item 187).
-- Restoring a version or a checkpoint rewrote the business details, the lists and
-- the colours, never the website's own settings: Home's sections, the owner's pages
-- and their sections, the menu, the header and footer choices, the logo, cover and
-- share image, the announcement. The snapshot's content holds those as the renderer
-- takes them (saved sections resolved, photos as file paths, empty sections left
-- out), so each new snapshot now also keeps them exactly as the draft stored them,
-- and a restore writes them back as they were (lib/draft_settings.ts).
--
-- One additive, nullable column. NULL on every snapshot made before it: a restore of
-- one of those rebuilds the settings from its content. Until this runs, the function
-- saves snapshots without the column and restores every one from its content, so the
-- deploy and this step can land in either order.
alter table public.presence_snapshots
  add column if not exists draft_settings jsonb;
comment on column public.presence_snapshots.draft_settings is
  'Builder item 187. The website''s settings (lib/site_roles.ts SETTINGS_CONTENT_FIELDS: blocks, pages, nav, header and footer choices, logo/cover/share media ids, announcement, page search settings) exactly as the draft stored them when this snapshot was taken, for restore-to-draft and checkpoint restores. NULL = taken before 0169; a restore rebuilds them from content.';

-- rollback:
--   alter table public.presence_snapshots drop column if exists draft_settings;
