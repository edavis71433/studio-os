-- rollback: alter table public.presence_settings drop column if exists visit_counter;
--
-- ── The visit counter gets an owner's switch (list item 61) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: the settings read and write step down without this
-- column (routes/content.ts selectSteps), so Settings and every other settings
-- save keep working, the switch reads as on, and every site keeps counting.
--
-- WHAT CHANGES
--   presence_settings.visit_counter (boolean, default true): when false, the next
--     publish leaves the first-party visit counter off every page (lib/render.ts
--     renderSnapshot) and the privacy page says the site counts nothing
--     (lib/legal_pages.ts privacyBody). When true, the privacy page describes
--     the counter as it is: no cookies, no outside company, what a page view and
--     a tap record, a daily scrambled code in place of the IP address, Do Not
--     Track honoured. Default true keeps every site as it is today.
alter table public.presence_settings
  add column if not exists visit_counter boolean not null default true;

comment on column public.presence_settings.visit_counter is
  'List item 61: count visits on the published site with the first-party counter (on by default). The privacy page reads the same switch.';
