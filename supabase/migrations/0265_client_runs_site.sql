-- rollback:
--   alter table public.presence_agency_clients
--     drop column if exists client_runs_site,
--     drop column if exists client_runs_site_at,
--     drop column if exists client_runs_site_by;
--
-- ── What a studio's client may do on their own site (builder list item 387) ──────
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. Until the column exists the server
-- reads every studio client as switched off, which is the new default anyway.
--
-- WHY (Nov 22 2026 review, file 05 finding 9, checked in 15-verification-a)
--   A studio's client is the owner of their site record, so the server accepted their own
--   sign-in for Publish, Take offline, changing the template, the domain and inviting
--   people. The portal gives them no door to the editor and nothing turned them away if
--   they opened its address. Nobody had decided it out loud.
--
-- WHAT CHANGES
--   presence_agency_clients (the studio's link to one client's site) gets a switch,
--   client_runs_site, off by default, with when and by whom it was last changed. While it
--   is off, the server refuses those five things from anyone on the client's side; the
--   studio does them. Editing the draft is unchanged. The studio turns it on from People
--   on the Sites page. A business no studio looks after, and the studio's own workspace,
--   are unchanged.

alter table public.presence_agency_clients
  add column if not exists client_runs_site boolean not null default false,
  add column if not exists client_runs_site_at timestamptz,
  add column if not exists client_runs_site_by text not null default '';

comment on column public.presence_agency_clients.client_runs_site is
  'Builder item 387: true when the studio lets this client publish, take the site offline, change its template and domain, and invite people themselves. Off by default: the studio does those.';
