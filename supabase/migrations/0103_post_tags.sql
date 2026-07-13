-- ── 0102 · Post tags (Phase SEARCH) ─────────────────────────────────────────
-- Flat, owner-typed tags on updates (posts). A text[] column keeps the model
-- simple and reuses the existing presence_posts row — no join table, no second
-- content system. Normalization is enforced at the API (lib/search_index.ts
-- normalizeTags: lowercased · de-duped · charset-limited · ≤12 tags · ≤30 chars),
-- so the column only ever holds clean values; the DB default is an empty array.
--
-- Deploy-order tolerant: the serializer reads `tags` through normalizeTags(),
-- which yields [] when the column is absent, so shipping the function before this
-- migration is applied simply renders no tags (nothing breaks). RLS is unchanged
-- (inherited from the table's existing client policy).
alter table public.presence_posts
  add column if not exists tags text[] not null default '{}';

comment on column public.presence_posts.tags is
  'Phase SEARCH: flat update tags (normalized at API via normalizeTags). Feeds tag chips, the on-site search index, and RSS <category>.';
