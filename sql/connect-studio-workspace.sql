-- ── Connect the studio's own Studio OS workspace (one-time, owner-run) ───────
-- WHY: the unified app (Today · Website · Customers · Projects · Files · Inbox)
-- resolves through presence_sites via the ownership chain
-- (clients.email → auth user). The studio's OWN account never had that row on
-- prod, so /portal/context returned no_site and the owner saw disconnected
-- pages instead of the one app. This seeds exactly four things, all idempotent:
--   1. a clients row for the studio itself (the studio is its own customer)
--   2. an active presence entitlement for it
--   3. its presence_sites workspace row (no hosting attached — content/CRM/
--      projects work immediately; hosting can be connected later)
--   4. the agency + owner membership (unlocks the Studio portfolio + agency nav)
-- Safe to re-run. Run in the Supabase SQL editor (prod; harmless on staging).

do $$
declare
  v_email  text := 'eric@davisdigitalstudio.com';  -- the owner login
  v_client uuid;
  v_site   uuid;
  v_agency uuid;
begin
  -- 1. the studio's own client row (automation stays paused — it's us)
  select id into v_client from public.clients where lower(email) = lower(v_email) limit 1;
  if v_client is null then
    insert into public.clients (name, email, automation_paused)
    values ('Davis Digital Studio', v_email, true)
    returning id into v_client;
  end if;

  -- 2. active entitlement (unique on client_id+product → clean upsert)
  insert into public.presence_entitlements (client_id, product, status, note)
  values (v_client, 'presence', 'active', 'studio''s own workspace')
  on conflict (client_id, product) do update set status = 'active';

  -- 3. the workspace row ('ready', full edition, no hosting attached yet)
  select id into v_site from public.presence_sites where client_id = v_client limit 1;
  if v_site is null then
    insert into public.presence_sites (client_id, template_slug, template_version, status, edition)
    values (v_client, 'restaurant-classic', '1.0.0', 'ready', 'presence')
    returning id into v_site;
  end if;

  -- 4. the agency + owner seat (Studio portfolio, cross-client queues).
  --    Lookup ignores status (a paused row is reactivated, never duplicated).
  select id into v_agency from public.presence_agencies
   where lower(name) = 'davis digital studio' limit 1;
  if v_agency is null then
    insert into public.presence_agencies (name) values ('Davis Digital Studio')
    returning id into v_agency;
  else
    update public.presence_agencies set status = 'active' where id = v_agency;
  end if;

  insert into public.presence_agency_members (agency_id, email, role, status)
  values (v_agency, lower(v_email), 'owner', 'active')
  on conflict (agency_id, email) do update set role = 'owner', status = 'active';

  raise notice 'Studio workspace connected: client=% site=% agency=%', v_client, v_site, v_agency;
end $$;
