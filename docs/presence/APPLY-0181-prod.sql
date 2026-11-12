-- ===========================================================================
--  APPLY PACK - migration 0181  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the deeper blog. ADDITIVE and IDEMPOTENT
--  ("if not exists", each check dropped and added again), so it is safe to re-run.
--  Nothing existing changes: a post may also be 'scheduled', posts get an empty
--  category and author, settings get two empty lists.
--
--  Why: builder list item 40. Blog posts get categories, authors and a day and
--  time to go live.
--
--  If the deploy goes first, nothing breaks: posts save and publish as before,
--  and scheduling, categories and authors say they aren't ready yet.
--
--  Rollback (only if ever needed):
--    alter table public.presence_posts drop constraint if exists presence_posts_status_check;
--    update public.presence_posts set status = 'draft' where status = 'scheduled';
--    alter table public.presence_posts add constraint presence_posts_status_check check (status in ('draft','published'));
--    drop index if exists public.presence_posts_due_idx;
--    alter table public.presence_posts drop constraint if exists presence_posts_category_len, drop constraint if exists presence_posts_author_len;
--    alter table public.presence_posts drop column if exists category, drop column if exists author;
--    alter table public.presence_settings drop column if exists post_categories, drop column if exists post_authors;
--
--  Covers: supabase/migrations/0181_blog_categories_authors_schedule.sql
-- ===========================================================================

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


-- Verify (expect: the status check naming 'scheduled'; four new columns; the index):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.presence_posts'::regclass and conname = 'presence_posts_status_check';
-- select table_name, column_name, column_default from information_schema.columns
--   where table_schema = 'public' and ((table_name = 'presence_posts' and column_name in ('category', 'author'))
--     or (table_name = 'presence_settings' and column_name in ('post_categories', 'post_authors')));
-- select indexname from pg_indexes where schemaname = 'public' and indexname = 'presence_posts_due_idx';
