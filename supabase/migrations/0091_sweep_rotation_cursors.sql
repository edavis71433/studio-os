-- ── 0091 · Sweep rotation cursors — fairness at scale ────────────────────────
-- The three recurring sweeps (observation cycle, billing reconcile, lifecycle)
-- previously ordered by updated_at and took the first N — but nothing they did
-- bumped updated_at, so the SAME rows occupied the window forever and everything
-- beyond it was silently never swept (observation ceiling ≈120 sites, billing
-- reconcile ceiling = 30 subscriptions, lifecycle ceiling = 200 entitlements).
-- Fix: a dedicated cursor column per sweep, stamped on every row CONSIDERED,
-- ordered oldest-first with nulls first — a true round-robin at any N.
--
-- Rollback: alter table ... drop column ...; drop index ...

alter table public.presence_sites
  add column if not exists last_observed_at timestamptz;
comment on column public.presence_sites.last_observed_at is
  'Rotation cursor for the scheduled observation cycle. Stamped every time the scheduler considers this site; ordered nulls-first so new sites are observed first and no site starves.';
create index if not exists presence_sites_observe_cursor_idx
  on public.presence_sites (last_observed_at asc nulls first)
  where status in ('ready','live');

alter table public.presence_entitlements
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_swept_at timestamptz;
comment on column public.presence_entitlements.last_synced_at is
  'Rotation cursor for the Stripe billing reconcile sweep (stamped when considered, drifted or not).';
comment on column public.presence_entitlements.last_swept_at is
  'Rotation cursor for the account lifecycle sweep (trial expiry / grace / wind-down).';
create index if not exists presence_entitlements_sync_cursor_idx
  on public.presence_entitlements (last_synced_at asc nulls first)
  where stripe_subscription_id is not null;
create index if not exists presence_entitlements_sweep_cursor_idx
  on public.presence_entitlements (last_swept_at asc nulls first);

-- ops_errors gained a writer (the presence global catch) — make it queryable.
create index if not exists ops_errors_created_idx on public.ops_errors (created_at desc);

-- ── Evidence retention — the one prune REST can't express ────────────────────
-- Evidence readers (judgment/coach) only ever use a site's LATEST run, but every
-- cycle appends a full run + item set forever. Delete runs older than the window
-- EXCEPT each site's latest (so a paused/lapsed site still shows its last
-- observation). presence_evidence cascades from runs. Service-role RPC only.
create or replace function public.prune_evidence_runs(keep_days int default 180)
returns int
language sql
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (site_id) id from public.presence_evidence_runs
    order by site_id, started_at desc
  ),
  gone as (
    delete from public.presence_evidence_runs r
    where r.started_at < now() - make_interval(days => keep_days)
      and r.id not in (select id from latest)
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke all on function public.prune_evidence_runs(int) from public, anon, authenticated;
