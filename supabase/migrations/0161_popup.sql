-- 0161 — One calm pop-up per site (builder list item 148, Nov 2026 review)
-- The pop-up's settings, kept with the site's other settings as one small JSON value:
-- whether it's on, its heading and words, the "Join our list" box or one or two buttons,
-- when it shows (after N seconds or a scroll), on which pages, how long it stays away once
-- closed, phones yes or no, and optional start and end dates. Null (the default) is off.
-- The code makes it safe at publish (lib/popup.ts normalizePopup); the editor's Settings
-- read steps down past this column until it exists (routes/content.ts), so nothing goes
-- dark ahead of the pack.
alter table public.presence_settings add column if not exists popup jsonb;
-- rollback: alter table public.presence_settings drop column if exists popup;
