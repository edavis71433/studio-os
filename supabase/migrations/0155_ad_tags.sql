-- rollback: alter table public.presence_settings drop column if exists google_tag_id;
--           alter table public.presence_settings drop column if exists meta_pixel_id;
--
-- ── Ad tags: the Google tag and the Meta Pixel (list item 152) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: the settings read and write step down without these
-- columns (routes/content.ts selectSteps), so every other setting keeps saving and
-- the Connections card shows no tags; saving one says it didn't save until then.
--
-- WHAT CHANGES
--   presence_settings.google_tag_id and .meta_pixel_id (text, default ''): the IDs
--     an owner pastes on Connections, held to their exact shapes at save
--     (G-/AW-/GT-/DC- plus letters and digits; digits only for a pixel). With
--     either set, the next publish adds a cookie notice to every page, loads the
--     tag only for visitors who say yes, and the privacy page describes it
--     (lib/ad_tags.ts, lib/legal_pages.ts). Empty, as every site is today, changes
--     nothing.
alter table public.presence_settings
  add column if not exists google_tag_id text not null default '';

alter table public.presence_settings
  add column if not exists meta_pixel_id text not null default '';

comment on column public.presence_settings.google_tag_id is
  'List item 152: the Google tag ID (G-, AW-, GT- or DC-) that loads behind the site''s cookie notice. Empty = none.';

comment on column public.presence_settings.meta_pixel_id is
  'List item 152: the Meta Pixel ID that loads behind the site''s cookie notice. Empty = none.';
