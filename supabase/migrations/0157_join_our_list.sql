-- 0157 — "Join our list" on a client's site (builder list item 146, Nov 2026 review)
-- The Newsletter section collects an email address itself (with a consent tick) instead
-- of only linking out to another company's sign-up page. Whoever joins is a contact of
-- the site with two new facts:
--   subscribed_at    when they joined the list (null: not on the list). Send an update's
--                    "People who joined your list" audience reads it.
--   subscribed_note  what they agreed to and where, in plain words, kept as the record of
--                    their consent (e.g. Joined on /about/: “Yes, send me updates by email…”).
-- Leaving the list is the unsubscribe link every update already carries (the one
-- suppression list); nothing here changes it. Nothing is backfilled.
alter table public.presence_contacts add column if not exists subscribed_at timestamptz;
alter table public.presence_contacts add column if not exists subscribed_note text not null default '';
create index if not exists presence_contacts_subscribed_idx
  on public.presence_contacts (site_id) where subscribed_at is not null and deleted_at is null;
-- rollback: drop index if exists public.presence_contacts_subscribed_idx;
--   alter table public.presence_contacts drop column if exists subscribed_note, drop column if exists subscribed_at;
