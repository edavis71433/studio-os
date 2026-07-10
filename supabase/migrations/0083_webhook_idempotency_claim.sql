-- ── P2-E W4: atomic webhook idempotency + livemode provenance ────────────────
-- The webhook used to SELECT stripe_webhook_events then, only after processing,
-- INSERT the row. Two concurrent duplicate deliveries could both pass the SELECT
-- and both process (M1). We move to a CLAIM-FIRST design: INSERT the row up front
-- (PK on event_id makes it atomic), and use a status to tell an in-flight claim
-- from a completed one so a mid-processing crash never permanently drops an event.
--
-- Additive only: new columns on an existing table, PK unchanged.

alter table public.stripe_webhook_events
  add column if not exists status text not null default 'processing',
  add column if not exists processed_at timestamptz,
  add column if not exists livemode boolean;

-- every row that already exists was written by the OLD code, which inserted only
-- AFTER successful processing — so they are, by definition, done.
update public.stripe_webhook_events set status = 'done', processed_at = coalesce(processed_at, received_at)
  where status = 'processing' and processed_at is null;

do $$ begin
  alter table public.stripe_webhook_events
    add constraint stripe_webhook_events_status_check check (status in ('processing','done','failed'));
exception when duplicate_object then null; when others then null; end $$;

comment on column public.stripe_webhook_events.status is
  'P2-E W4: processing (claimed, in-flight) | done (applied) | failed (a prior attempt errored; a Stripe retry re-runs). Claim-first idempotency.';
comment on column public.stripe_webhook_events.livemode is
  'Stripe event.livemode captured at receipt — provenance for the live/test guard.';

-- rollback:
--   alter table public.stripe_webhook_events drop column if exists status,
--     drop column if exists processed_at, drop column if exists livemode;
