-- ── M4: publish idempotency key ─────────────────────────────────────────────
-- Optional + backward-compatible: existing callers send no key → NULL → no
-- deduplication (each publish independent, cooldown still applies). When a key
-- IS sent, the partial unique index makes one (site_id, key) resolve to exactly
-- one publish — a retried key returns the existing result, never a second
-- snapshot-that-deploys or a second Netlify deploy. The index is per-site, so
-- the SAME key on two different sites is two independent rows: one tenant's key
-- can never resolve another tenant's publish.
alter table public.presence_publishes
  add column if not exists idempotency_key text;

-- length guard (DB-enforced belt-and-suspenders; the route also validates)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'presence_publishes_idem_len'
  ) then
    alter table public.presence_publishes
      add constraint presence_publishes_idem_len
      check (idempotency_key is null or char_length(idempotency_key) <= 200);
  end if;
end $$;

-- one publish per (site, key); NULL keys are exempt (partial index)
create unique index if not exists presence_publishes_idem
  on public.presence_publishes (site_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.presence_publishes.idempotency_key is
  'M4: optional client Idempotency-Key. Partial-unique per (site_id, key). A retried key returns the existing publish; never a second deploy. Cross-tenant isolated by the site_id in the index.';
