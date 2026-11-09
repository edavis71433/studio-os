-- ── Snooze on Home's "Needs you" (bold redesign, sales list item 70, Nov 2026) ──
-- rollback: drop table if exists public.presence_needs_snoozes;
--
-- One row per snoozed item: the studio, the item's key ('<kind>:<id>', the same
-- key /agency/needs-you gives every row) and when it wakes. The list, the bell's
-- count and the roster's Next leave a row out until then; Wake deletes the row.
-- Studio-wide on purpose: one person snoozes, the whole studio's list agrees.
--
-- Deploy order: either way. Before this runs, the function reads nothing (the
-- list holds nothing back and says snooze_ready:false, so Home hides Snooze)
-- and a snooze write answers 503 with a plain sentence.
--
-- Properties:
--   • ADDITIVE — one new table; nothing existing is read, written or moved.
--   • IDEMPOTENT — create-if-not-exists throughout.
--   • PRIVATE — row level security on with no policies: only the Edge Function
--     (service role) reads or writes it.

create table if not exists public.presence_needs_snoozes (
  agency_id uuid not null references public.presence_agencies(id) on delete cascade,
  row_key text not null check (char_length(row_key) between 3 and 320),
  until timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (agency_id, row_key)
);
create index if not exists presence_needs_snoozes_wake on public.presence_needs_snoozes (agency_id, until);
alter table public.presence_needs_snoozes enable row level security;

comment on table public.presence_needs_snoozes is
  'Home''s Snooze (item 70): a needs-you row key held back until a time, studio-wide. Service role only.';
