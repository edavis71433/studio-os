-- rollback: drop index if exists public.presence_sites_portal_slug_uq;
--           alter table public.presence_sites drop column if exists portal_slug;
--   (with the column gone, Settings can't save a short name and every portal address is
--    the long one again; a short link already shared stops working)
--
-- ── A short name in the portal's address (builder list item 350) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Settings answers
-- that the short name isn't switched on yet, and every address stays the long one.
--
-- WHY
--   The portal's address ended in a 36-character code, which can't be read out on a call
--   or printed on an invoice. A studio picks a short name (lib/portal_slug.ts cleans it:
--   letters, digits and hyphens, 3 to 40 long), unique across the platform whatever the
--   case, and app.example/portal/<name> opens its sign-in page. Old links keep working.
--
-- WHAT CHANGES
--   One nullable column on presence_sites and a unique index on its lower-case form.
alter table public.presence_sites add column if not exists portal_slug text;
create unique index if not exists presence_sites_portal_slug_uq on public.presence_sites (lower(portal_slug)) where portal_slug is not null;
