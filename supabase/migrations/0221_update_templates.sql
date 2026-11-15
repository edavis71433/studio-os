-- rollback: drop table if exists public.presence_update_templates;
--
-- ── Updates kept as templates by the studio (builder list item 221) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until it lands, Templates on Send an
-- update says templates aren't switched on yet, and nothing is kept; sending updates and
-- the welcome email work as before.
--
-- WHY
--   Wix keeps a well-made email as a template and copies it between sites (Nov 12 review,
--   file 02, finding 6). A studio writes the same kind of update for similar clients (holiday
--   hours, a spring offer), so one kept here starts an update for any client.
--
-- WHAT CHANGES
--   presence_update_templates: one row per update a studio kept. Its subject and words, as
--   written: the fill-ins ({{first_name}}, {{business_name}}, {{booking_link}}) stay as
--   fill-ins, so they fill in for whichever client uses it. Photos are left out when it is
--   kept (a photo belongs to the client it came from). from_name is that client's business
--   name at the time, for "From Marlow's Kitchen". RLS on, nothing granted to anon or
--   signed-in users; the function's own key reads and writes it, fenced to the studio in
--   agency/update_templates.ts (the presence_saved_pages pattern, 0217).
create table if not exists public.presence_update_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  created_from_site uuid references public.presence_sites(id) on delete set null,
  from_name text not null default '' check (char_length(from_name) <= 200),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_update_templates_agency_idx on public.presence_update_templates (agency_id, created_at desc);

alter table public.presence_update_templates enable row level security;
revoke all on public.presence_update_templates from anon, authenticated;

comment on table public.presence_update_templates is
  'List item 221: updates a studio kept as templates, to start an update for any client. Subject and words with their fill-ins; never photos. Written by agency/update_templates.ts (service role) only.';
