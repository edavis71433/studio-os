-- rollback: alter table public.presence_sites drop column if exists visitor_password_at;
--           alter table public.presence_settings drop column if exists ai_crawlers;
--
-- ── Site controls (list item 175): a visitor password and the AI crawler switch ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: the settings read and write step down without the new
-- column (routes/content.ts selectSteps), so every other setting keeps saving and
-- the switch reads as on; the status read leaves the password out, and setting a
-- password says it isn't available here yet.
--
-- WHAT CHANGES
--   presence_sites.visitor_password_at (timestamptz, null): when the owner put a
--     visitor password on the live site (Netlify's site-wide password, set and
--     cleared by POST /site/password). Null = anyone can visit. The password
--     itself is never stored here: Netlify keeps it.
--   presence_settings.ai_crawlers (boolean, default true): false when the owner
--     asked AI assistants not to read the site; the next publish adds a
--     "Disallow: /" group for each known AI crawler to the site's robots.txt
--     (lib/ai_crawlers.ts). Default true keeps every site as it is today.
alter table public.presence_sites
  add column if not exists visitor_password_at timestamptz;

comment on column public.presence_sites.visitor_password_at is
  'List item 175: when a visitor password was put on the live site (Netlify site-wide password). Null = public. The password is never stored here.';

alter table public.presence_settings
  add column if not exists ai_crawlers boolean not null default true;

comment on column public.presence_settings.ai_crawlers is
  'List item 175: let AI assistants read the published site (on by default). Off adds a Disallow group per known AI crawler to robots.txt at the next publish.';
