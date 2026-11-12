-- ===========================================================================
--  APPLY PACK - migration 0182  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships the new Business details. ADDITIVE and
--  IDEMPOTENT ("if not exists", the check dropped and added again), so it is safe
--  to re-run. Nothing existing changes: an empty short description and no second
--  location for every business.
--
--  Why: builder list item 127. Business details get a 150-character short
--  description, the line AI tools and directories quote, and a second location.
--
--  If the deploy goes first, nothing breaks: Business details reads and saves
--  as before, and the two new fields say they aren't ready yet.
--
--  Rollback (only if ever needed):
--    alter table public.presence_identity drop constraint if exists presence_identity_short_description_len;
--    alter table public.presence_identity drop column if exists short_description;
--    alter table public.presence_locations drop column if exists second_location;
--
--  Covers: supabase/migrations/0182_short_description_second_location.sql
-- ===========================================================================

alter table public.presence_identity
  add column if not exists short_description text not null default '';
alter table public.presence_identity drop constraint if exists presence_identity_short_description_len;
alter table public.presence_identity
  add constraint presence_identity_short_description_len check (char_length(short_description) <= 150);

alter table public.presence_locations
  add column if not exists second_location jsonb;

comment on column public.presence_identity.short_description is
  'Builder list item 127: one sentence, 150 characters at most, quoted by Google, AI assistants and directories. Empty means the description stands in.';
comment on column public.presence_locations.second_location is
  'Builder list item 127: the business''s second place {label, address_line1, address_line2, city, region, postal_code, phone, same_hours, hours}, made safe by the function. Null means none.';


-- Verify (expect two rows: short_description text default '', second_location jsonb):
-- select table_name, column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and ((table_name = 'presence_identity' and column_name = 'short_description')
--     or (table_name = 'presence_locations' and column_name = 'second_location'));
