-- ── Builder list item 159: a note on the draft can carry a name and one picture ──
-- Feedback left through a shared draft link had no name on it (when a client forwards
-- the link to a partner, the studio couldn't tell whose note was whose), and a note was
-- words only. Two columns, both optional:
--   author_name  the name someone typed when leaving feedback on a shared draft, at most
--                60 characters (a studio member's note is named by who they are, not this);
--   attachment   one picture with the note: { path, type, size, w, h }, kept in the media
--                library's private bucket under comments/<site>/, never on the website.
-- Additive; the code is deploy-order tolerant (without these columns a note is saved and
-- read as before, with no name or picture).
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
