-- ── Phase CP-2: Design Studio completion ─────────────────────────────────────
-- Everything here is a curated, structured choice — never raw CSS:
--   settings: hero_layout ('' = classic | 'split'), nav_style ('' | 'centered'),
--             sections_hidden/sections_order (home-page section keys),
--             footer_hours/footer_social toggles.
--   media:    focal_x/focal_y (0-100 %) — consumed wherever a template CROPS
--             (the DS-6 split hero is the first consumer; galleries later).
-- Type/density/corners/background ride the EXISTING dev-token layer (no schema).
alter table public.presence_settings
  add column if not exists hero_layout text not null default '',
  add column if not exists nav_style text not null default '',
  add column if not exists sections_hidden jsonb not null default '[]',
  add column if not exists sections_order jsonb not null default '[]',
  add column if not exists footer_hours boolean not null default true,
  add column if not exists footer_social boolean not null default true;
alter table public.presence_media
  add column if not exists focal_x integer,
  add column if not exists focal_y integer;
-- rollback: drop the eight columns above.
