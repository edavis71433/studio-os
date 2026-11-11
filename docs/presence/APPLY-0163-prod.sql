-- APPLY 0163 (production) — Reviews that go to Google (sales review item 115).
-- Safe to run more than once. One new column; nothing existing changes.
alter table public.presence_identity add column if not exists google_place_id text;
comment on column public.presence_identity.google_place_id is
  'The business''s Google place id, pasted once by the owner, so a review request can link to the Google review box. When the Google Business Profile connection has real listing data its own review link wins and this is ignored.';

-- Check: the column exists.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'presence_identity' and column_name = 'google_place_id';
