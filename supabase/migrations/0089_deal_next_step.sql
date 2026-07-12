-- ── 0089 — "Next step + when" on deals ───────────────────────────────────────
-- The one field that keeps a solo seller's pipeline honest (the core of what
-- Pipedrive-class tools are bought for): every open deal can carry what happens
-- next and when. Surfaced in the deal Details panel; the existing stale-deal
-- sweep provides the nudge rail. Additive only; safe to re-run.

alter table public.presence_deals
  add column if not exists next_step text not null default '',
  add column if not exists next_step_at date;

comment on column public.presence_deals.next_step is
  'P3: the owner''s own words for what happens next on this deal (e.g. "Call Friday about the proposal"). Empty = none set.';
comment on column public.presence_deals.next_step_at is
  'P3: when the next step is due. Read by the deal detail UI; the stale-deal follow-up sweep remains the nudge mechanism.';

-- rollback: alter table public.presence_deals drop column next_step, drop column next_step_at;
