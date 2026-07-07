-- ── 0032 — M11: Migration Readiness storage ─────────────────────────────────
-- Additive only: two columns on the monitor connection. The assessment is
-- computed deterministically from observed external pages + evidence and
-- quietly kept here — internal detail for operators, sentences for customers.
alter table public.presence_monitor_connections
  add column if not exists readiness jsonb not null default '{}',
  add column if not exists readiness_at timestamptz;
comment on column public.presence_monitor_connections.readiness is
  'M11. The latest Migration Readiness assessment (pages that migrate cleanly, SEO preserved, accessibility priorities, post-migration improvements). Function-written; customers see plain-language sentences only.';
