-- ===========================================================================
--  APPLY PACK - migration 0183  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships names and pictures on draft notes.
--  ADDITIVE and IDEMPOTENT ("if not exists"), so it is safe to re-run. Nothing
--  existing changes: two new, optional columns on presence_section_comments.
--
--  Why: builder list item 159. Feedback left on a shared draft carries the name
--  the person typed, and any note can carry one picture (a screenshot).
--
--  If the deploy goes first, nothing breaks: notes save and read as before,
--  without a name or a picture, until these columns exist.
--
--  Rollback (only if ever needed):
--    alter table public.presence_section_comments drop column if exists attachment;
--    alter table public.presence_section_comments drop column if exists author_name;
--
--  Covers: supabase/migrations/0183_comment_name_picture.sql
-- ===========================================================================

alter table public.presence_section_comments
  add column if not exists author_name text,
  add column if not exists attachment jsonb;

alter table public.presence_section_comments drop constraint if exists presence_section_comments_author_name_len;
alter table public.presence_section_comments
  add constraint presence_section_comments_author_name_len check (author_name is null or char_length(author_name) <= 60);

comment on column public.presence_section_comments.author_name is
  'List item 159: the name typed with feedback on a shared draft (optional, at most 60 characters).';
comment on column public.presence_section_comments.attachment is
  'List item 159: one picture with the note, { path, type, size, w, h }, in the media bucket under comments/<site>/.';

-- Check: two rows, author_name (text) and attachment (jsonb), and the length rule.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_section_comments'
   and column_name in ('author_name', 'attachment')
 order by column_name;
select conname from pg_constraint where conname = 'presence_section_comments_author_name_len';
