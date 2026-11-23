-- ===========================================================================
--  APPLY PACK - migration 0255  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 334. IDEMPOTENT ("if not
--  exists"), safe to re-run. Adds one column with a default; no row is rewritten
--  in a way anyone sees.
--
--  Why: builder list item 334. A business with no shopfront (a plumber, a mobile
--  groomer, a cleaner) could publish only by typing a street address, which then
--  showed in its footer with "Get directions". The new switch in Business details,
--  "We go to our customers", shows the areas it serves instead and lifts the
--  street address from the publish check.
--
--  If the deploy goes first, nothing breaks: Business details reads and saves as
--  before and the switch stays hidden until this column exists.
--
--  Rollback (only if ever needed):
--    alter table public.presence_locations drop column if exists goes_to_customers;
--
--  Covers: supabase/migrations/0255_goes_to_customers.sql
-- ===========================================================================

alter table public.presence_locations
  add column if not exists goes_to_customers boolean not null default false;

comment on column public.presence_locations.goes_to_customers is
  'Builder list item 334: the business goes to its customers. The site shows identity.service_area in place of the address and offers no directions; publishing asks for the service area instead of a street address.';

-- check: the column is there, and no existing site has it on
select count(*) filter (where goes_to_customers) as switched_on, count(*) as locations
  from public.presence_locations;
