-- ── Phase Z (closes FD-R5's core): search-engine ownership verification ──────
-- Google Search Console / Bing Webmaster verification was IMPOSSIBLE before
-- this (no field; Developer Mode strips <meta> by design). Two token fields on
-- the presentation settings; templates emit the meta tags when set. Search
-- Console is the doorway to indexing visibility, sitemap submission, and AI
-- Overviews performance — a browser field, not a technical task.
alter table public.presence_settings
  add column if not exists google_site_verification text not null default '',
  add column if not exists bing_site_verification text not null default '';
comment on column public.presence_settings.google_site_verification is
  'Phase Z. Google Search Console verification token (content= value only) — rendered as the meta tag on every page when set.';
-- rollback: alter table public.presence_settings drop column if exists google_site_verification, drop column if exists bing_site_verification;
