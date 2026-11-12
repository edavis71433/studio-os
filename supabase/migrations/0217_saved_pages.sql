-- rollback: drop table if exists public.presence_saved_pages;
--
-- ── Pages saved to the studio (builder list item 216) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, "Save to your studio"
-- says saved pages aren't switched on yet and Add a page shows no Saved group; nothing else
-- changes.
--
-- WHY
--   Squarespace keeps a page saved to the account, ready to add to any site (Nov 12 review,
--   file 01, finding 2). A studio builds the same kind of page for similar businesses (a
--   salon's services, a restaurant's menu), so one saved here drops into any client's site
--   from Add a page.
--
-- WHAT CHANGES
--   presence_saved_pages: one row per page a studio saved. Its sections, the saved sections
--   they link to, and copies of its photos kept in the studio's own folder
--   (templates/<agency id>/ in presence-media), so a saved page outlives the site it came
--   from. Never business details, hours, reviews or contact details: the payload holds only
--   what the page's sections hold. `purpose` is the Add a page group it shows in.
--   RLS on, nothing granted to anon or signed-in users; the function's own key reads and
--   writes it, fenced to the studio in agency/saved_pages.ts (the presence_starter_kits
--   pattern, 0056).
create table if not exists public.presence_saved_pages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  purpose text not null check (purpose in ('introduce', 'sell', 'show', 'home')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_from_site uuid references public.presence_sites(id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_saved_pages_agency_idx on public.presence_saved_pages (agency_id, created_at desc);

alter table public.presence_saved_pages enable row level security;
revoke all on public.presence_saved_pages from anon, authenticated;

comment on table public.presence_saved_pages is
  'List item 216: pages a studio saved to add to any client''s site. payload = { v, title, from_name, blocks, library, media (copies in templates/<agency id>/), outline, summary }. Business details never travel. Written by agency/saved_pages.ts (service role) only.';
