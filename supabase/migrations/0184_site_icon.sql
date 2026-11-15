-- ── Builder list item 158: the site's own small icon ──────────────────────────
-- Every template draws a letter in a coloured square as the browser-tab icon; a wide logo
-- shrunk to 16 pixels is a smudge. The owner can now pick a picture of its own. One
-- optional column on the presentation-settings row, like logo_media_id (0051): a
-- presence_media id, rendered as the tab icon on every page (lib/site_icon.ts).
-- Additive. Settings reads and saves the rest without it, but a restore writes it back
-- (a version without an icon goes back to the letter, as one without a logo does), so this
-- runs BEFORE the deploy.
alter table public.presence_settings
  add column if not exists icon_media_id uuid;
comment on column public.presence_settings.icon_media_id is
  'List item 158. The site''s own browser-tab icon (a presence_media id); none = the template''s letter in the site''s colour.';

-- rollback:
--   alter table public.presence_settings drop column if exists icon_media_id;
