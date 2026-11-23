-- rollback:
--   alter table public.presence_locations drop column if exists goes_to_customers;
--
-- ── "We go to our customers": a business with no shopfront (builder list item 334) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Business details
-- reads and saves everything as before and simply doesn't show the new switch.
--
-- WHAT CHANGES
--   presence_locations.goes_to_customers: true when the business goes to its customers
--     (a plumber, a mobile groomer, a cleaner). Its site then shows the areas it serves
--     (presence_identity.service_area) where the street address was: in the footer, on the
--     Contact page and under the opening, with no "Get directions" anywhere. Publishing asks
--     for that service area instead of a street, city, state and ZIP. Any address already
--     typed is kept, unshown, so turning the switch off brings it straight back.
--     Default false: every site that exists today draws exactly as before.
alter table public.presence_locations
  add column if not exists goes_to_customers boolean not null default false;

comment on column public.presence_locations.goes_to_customers is
  'Builder list item 334: the business goes to its customers. The site shows identity.service_area in place of the address and offers no directions; publishing asks for the service area instead of a street address.';
