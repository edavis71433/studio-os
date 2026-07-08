-- ── Phase V: no-code essentials (from the No-Code Gap Audit) ─────────────────
-- Five additive columns on the EXISTING presentation-settings singleton — no new
-- tables, no new routes (the generic /settings field-rule updater handles them).
--   logo_media_id           FD-N2 · the business logo (header + favicon + OG fallback)
--   og_media_id             FD-N3 · the chosen social-share image
--   announcement_*          FD-N4 · the announcement bar (text + optional link/expiry)
-- All render deterministically from the snapshot; publish stays approval-first.
alter table public.presence_settings
  add column if not exists logo_media_id uuid,
  add column if not exists og_media_id uuid,
  add column if not exists announcement_text text not null default '',
  add column if not exists announcement_url text not null default '',
  add column if not exists announcement_expires_at timestamptz;
comment on column public.presence_settings.logo_media_id is 'Phase V FD-N2. The business logo (a presence_media id) — rendered in the site header, used as favicon + OG fallback.';
comment on column public.presence_settings.og_media_id is 'Phase V FD-N3. The chosen social-share (Open Graph) image (a presence_media id); falls back to logo/offering/post.';
comment on column public.presence_settings.announcement_text is 'Phase V FD-N4. Announcement bar text (empty = no bar). Expiry compares to snapshot time at render.';

-- rollback:
--   alter table public.presence_settings
--     drop column if exists logo_media_id, drop column if exists og_media_id,
--     drop column if exists announcement_text, drop column if exists announcement_url,
--     drop column if exists announcement_expires_at;
