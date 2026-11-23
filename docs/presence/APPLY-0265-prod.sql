-- ===========================================================================
--  APPLY PACK - migration 0265  (owner-apply, prod)
-- ===========================================================================
--  Run this ONCE (Supabase -> SQL Editor, or the Supabase connector), BEFORE or
--  WITH the deploy.yml run that ships builder item 387. IDEMPOTENT ("if not
--  exists"), adds three columns with defaults, changes no row's meaning, safe to
--  re-run.
--
--  Why: builder list item 387. A studio's client is the owner of their own site
--  record, so the server accepted their own sign-in for Publish, Take offline,
--  changing the template, the domain and inviting people, though the portal gives
--  them no door to the editor. The studio now decides, client by client: a switch on
--  its link to the client (presence_agency_clients.client_runs_site), off by default.
--  While it is off, the server refuses those five things from anyone on the client's
--  side and the studio does them; editing the draft is as before. The studio turns
--  it on from People on the Sites page.
--
--  If the deploy goes first, nothing breaks: the server reads a missing column as
--  "off", which is the new default anyway, and the switch's Save says it couldn't.
--
--  Rollback (only if ever needed):
--    alter table public.presence_agency_clients
--      drop column if exists client_runs_site,
--      drop column if exists client_runs_site_at,
--      drop column if exists client_runs_site_by;
--
--  Covers: supabase/migrations/0265_client_runs_site.sql
-- ===========================================================================

alter table public.presence_agency_clients
  add column if not exists client_runs_site boolean not null default false,
  add column if not exists client_runs_site_at timestamptz,
  add column if not exists client_runs_site_by text not null default '';

comment on column public.presence_agency_clients.client_runs_site is
  'Builder item 387: true when the studio lets this client publish, take the site offline, change its template and domain, and invite people themselves. Off by default: the studio does those.';

-- ── check (read-only): expect three rows, and every active client switched off ──
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'presence_agency_clients'
   and column_name in ('client_runs_site', 'client_runs_site_at', 'client_runs_site_by')
 order by column_name;
select count(*) filter (where client_runs_site) as switched_on, count(*) as active_clients
  from public.presence_agency_clients where status = 'active';
