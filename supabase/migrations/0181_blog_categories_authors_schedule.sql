-- rollback:
--   alter table public.presence_posts drop constraint if exists presence_posts_status_check;
--   update public.presence_posts set status = 'draft' where status = 'scheduled';
--   alter table public.presence_posts add constraint presence_posts_status_check check (status in ('draft','published'));
--   drop index if exists public.presence_posts_due_idx;
--   alter table public.presence_posts drop column if exists category, drop column if exists author;
--   alter table public.presence_settings drop column if exists post_categories, drop column if exists post_authors;
--
-- ── A deeper blog (builder list item 40) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands a post can't be
-- scheduled (the status check refuses it), and categories and authors don't save;
-- everything else about posts works as before.
--
-- WHAT CHANGES
--   presence_posts.status: may also be 'scheduled', a post waiting for its time
--     (published_at). The 15-minute tick puts it on the live site when that time comes.
--   presence_posts.category: the id of one of the site's categories ('' = none).
--   presence_posts.author: the id of one of the site's authors ('' = none).
--   presence_settings.post_categories: the site's categories, [{id, name}].
--   presence_settings.post_authors: the site's authors, [{id, name, bio, photo_media_id}].
--   An index finds the posts that are due without reading the rest.
alter table public.presence_posts drop constraint if exists presence_posts_status_check;
alter table public.presence_posts
  add constraint presence_posts_status_check check (status in ('draft','scheduled','published'));

alter table public.presence_posts
  add column if not exists category text not null default '',
  add column if not exists author text not null default '';
alter table public.presence_posts drop constraint if exists presence_posts_category_len;
alter table public.presence_posts add constraint presence_posts_category_len check (char_length(category) <= 40);
alter table public.presence_posts drop constraint if exists presence_posts_author_len;
alter table public.presence_posts add constraint presence_posts_author_len check (char_length(author) <= 40);

create index if not exists presence_posts_due_idx
  on public.presence_posts (published_at) where status = 'scheduled' and deleted_at is null;

alter table public.presence_settings
  add column if not exists post_categories jsonb not null default '[]'::jsonb,
  add column if not exists post_authors jsonb not null default '[]'::jsonb;

comment on column public.presence_posts.category is
  'Builder list item 40: the id of one of presence_settings.post_categories, or empty for none.';
comment on column public.presence_posts.author is
  'Builder list item 40: the id of one of presence_settings.post_authors, or empty for none.';
comment on column public.presence_settings.post_categories is
  'Builder list item 40: the blog''s categories, [{id, name}], made safe by the function (lib/blog.ts).';
comment on column public.presence_settings.post_authors is
  'Builder list item 40: the blog''s authors, [{id, name, bio, photo_media_id}], made safe by the function (lib/blog.ts).';
