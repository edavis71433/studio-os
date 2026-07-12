-- ── Cross-region watchdog — STAGING watches PROD (and vice versa) ────────────
-- Manual/ops SQL, NOT a numbered migration. Run in the WATCHING project's SQL
-- Editor (staging watches prod; optionally run the mirror in prod watching
-- staging). This codifies the watchdog activated in Phase J r2 so it is
-- reproducible from the repo — previously it existed only in the live database.
--
-- What it does, every 5 minutes:
--   1. GET the WATCHED project's /system/health (secret via header).
--   2. If unreachable, non-200, or ok=false → email the owner via Resend.
--   3. Dedupe: at most one alert email per hour (watchdog_alerts ledger).
--
-- /system/health's top-level `ok` now folds in cron staleness (>45 min without
-- a cycle) and sustained failures (≥10 in 24h) — so a dead scheduler or a
-- failing pipeline PAGES, not just a dead database.
--
-- Prereqs (once, in the WATCHING project):
--   select vault.create_secret('<WATCHED_SCHEDULER_SECRET>', 'watchdog_target_secret');
--   select vault.create_secret('<RESEND_API_KEY>',           'watchdog_resend_key');
-- Replace before running:
--   <WATCHED_REF>   the project being watched (prod: qksstlqzbhesadrrofgn)
--   <ALERT_EMAIL>   where alerts go (default eric@davisdigitalstudio.com)

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.watchdog_alerts (
  id bigint generated always as identity primary key,
  detail text not null default '',
  created_at timestamptz not null default now()
);
alter table public.watchdog_alerts enable row level security;  -- deny-all; cron/service only

create or replace function public.watchdog_check()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  resp record;
  body jsonb;
  healthy boolean := false;
  detail text := '';
  recent int;
begin
  begin
    select status, content into resp from net._http_collect_response(
      net.http_get(
        url := 'https://<WATCHED_REF>.supabase.co/functions/v1/presence/system/health',
        headers := jsonb_build_object('x-system-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_target_secret'))
      ), async := false);
    if resp.status = 200 then
      body := resp.content::jsonb;
      healthy := coalesce((body->'data'->>'ok')::boolean, false);
      if not healthy then
        detail := 'health ok=false: db_ok=' || coalesce(body->'data'->>'db_ok','?')
               || ' cron_stale=' || coalesce(body->'data'->>'cron_stale','?')
               || ' failure_alarm=' || coalesce(body->'data'->>'failure_alarm','?')
               || ' missing=' || coalesce(body->'data'->'secrets'->>'missing_required','[]');
      end if;
    else
      detail := 'health endpoint returned HTTP ' || coalesce(resp.status::text, 'null');
    end if;
  exception when others then
    detail := 'health endpoint unreachable: ' || sqlerrm;
  end;

  if healthy then return; end if;

  -- dedupe: at most one alert per hour
  select count(*) into recent from public.watchdog_alerts where created_at > now() - interval '1 hour';
  if recent > 0 then return; end if;
  insert into public.watchdog_alerts (detail) values (left(detail, 500));

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_resend_key'),
      'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Studio OS Watchdog <support@davisdigitalstudio.com>',
      'to', '<ALERT_EMAIL>',
      'subject', '[Studio OS] Production health check FAILED',
      'html', '<p>The cross-region watchdog could not verify production health.</p><p><strong>Detail:</strong> ' || coalesce(detail, 'unknown') || '</p><p>Check the Supabase dashboard and /system/health directly.</p>')
  );
end;
$fn$;

-- idempotent re-provisioning
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname = 'presence_watchdog' loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

select cron.schedule('presence_watchdog', '*/5 * * * *', $$ select public.watchdog_check(); $$);

-- retention: keep the alert ledger tiny
select cron.schedule('presence_watchdog_gc', '0 4 * * *', $$ delete from public.watchdog_alerts where created_at < now() - interval '30 days'; $$);

-- to inspect: select jobname, schedule, active from cron.job where jobname like 'presence_watchdog%';
