-- ── Multi-page authoring: owner-created pages ────────────────────────────────
-- `pages` holds a validated array of custom pages, each { slug, title, blocks },
-- where blocks is the SAME structured/validated block model as the home page's
-- `blocks` column. The authoritative validation (safe unique slugs that can't
-- collide with a template's built-in pages, per-page validateBlocks, cap 20) lives
-- in lib/serializer.ts at serialize time; this column is just structured storage on
-- the existing settings row (no new table, no new pipeline). Empty = single-page,
-- byte-identical to before.
alter table public.presence_settings
  add column if not exists pages jsonb not null default '[]';
comment on column public.presence_settings.pages is 'Multi-page: owner-created pages [{slug,title,blocks}]. blocks reuses the site_blocks model; validated + slug-guarded at serialize time (lib/serializer.ts). Empty = single-page.';
-- rollback: alter table public.presence_settings drop column if exists pages;
