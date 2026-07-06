-- ── 0018 — M6: site lifecycle states, cancelable publishes, admin provenance ──
-- Additive only: widens three CHECK constraints; no data rewrites, no new
-- tables, no RLS/grant changes. Constraint names are resolved dynamically so
-- this is safe whether the inline check kept its auto-generated name or not.

-- 1. presence_sites.status: full operational lifecycle (M6 §4)
--    draft → provisioning → ready → live ⇄ paused → archived → deleting
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.presence_sites'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.presence_sites drop constraint %I', c);
  end loop;
end $$;
alter table public.presence_sites add constraint presence_sites_status_check
  check (status in ('draft','provisioning','ready','live','paused','archived','deleting'));

-- 2. presence_publishes.status: operators may cancel a QUEUED publish (M6 §5).
--    'canceled' is terminal and does not count as in-flight (the partial unique
--    index only covers queued/deploying, so a canceled row frees the gate).
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.presence_publishes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.presence_publishes drop constraint %I', c);
  end loop;
end $$;
alter table public.presence_publishes add constraint presence_publishes_status_check
  check (status in ('queued','deploying','live','failed','canceled'));

-- 3. presence_change_events.entity_type: admin operations write provenance too
--    (site provisioning/lifecycle, domain attach/detach) — M6 §5 "every action
--    writes provenance".
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.presence_change_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%entity_type%'
  loop
    execute format('alter table public.presence_change_events drop constraint %I', c);
  end loop;
end $$;
alter table public.presence_change_events add constraint presence_change_events_entity_type_check
  check (entity_type in
    ('identity','location','offering','testimonial','faq','post','media','voice',
     'redirect','settings','publish','restore','site','domain'));
