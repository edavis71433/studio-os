-- rollback:
--   alter table public.presence_identity drop constraint if exists presence_identity_short_description_len;
--   alter table public.presence_identity drop column if exists short_description;
--   alter table public.presence_locations drop column if exists second_location;
--
-- ── Business details: a short description and a second location (builder list item 127) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands Business details
-- reads and saves everything as before, and the two new fields say they aren't ready.
--
-- WHAT CHANGES
--   presence_identity.short_description: one sentence, 150 characters at most, the line
--     Google, AI assistants and directories quote ('' = none; the description stands in).
--   presence_locations.second_location: a second place, {label, address_line1,
--     address_line2, city, region, postal_code, phone, same_hours, hours}, made safe by
--     the function (lib/second_location.ts); null = none.
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
