-- == Cross-region watchdog: STAGING (Ohio) watches PRODUCTION (Oregon) ========
-- Manual/ops SQL, NOT a numbered migration. Run it in the STAGING project's SQL
-- Editor (wjlpursnwbmlcdwbeowv). It is the reproducible source for the live
-- watchdog and is safe to re-run.
--
-- What it does, every 5 minutes (pg_cron job "presence-watchdog"):
--   1. Reads the answer to the PREVIOUS probe. pg_net sends a request only after
--      the transaction commits, so an answer can only be read on a later tick.
--   2. Healthy = HTTP 200 and the TOP-LEVEL data.ok of /system/health is true.
--      Anything else is a failure with a plain reason: no answer, refused
--      (403), another status, or the flags production itself reports.
--   3. On a failure, or when nothing healthy has come back for 30 minutes,
--      emails eric@davisdigitalstudio.com through Resend, at most every 6
--      hours, WITH the reason. The last reason is kept in watchdog_state.
--   4. Sends this tick's probe: GET production's /system/health with the
--      scheduler secret in the x-system-secret header, never in the address.
--
-- History. The watchdog was built by hand on Jul 8 2026 and existed only in the
-- staging database; the version of this file before Nov 8 2026 described a
-- different design that never ran. The live one put the secret in the web
-- address (?secret=...). On Jul 12 2026 /system/* stopped accepting the secret
-- that way (FD-AUD16: addresses land in access logs), so every probe got 403
-- and it emailed "Production health check is failing" every 6 hours from then
-- on, without saying why. It also called a 200 healthy when the body contained
-- "ok":true anywhere, and secrets.ok is true even when the top-level ok is
-- false, so it could not have seen a real failure either. One real failure was
-- there the whole time: see supabase/migrations/0141_prune_evidence_runs_grant.sql.
--
-- Vault entries it reads (staging project; the values never appear here):
--   watchdog_health_url     https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/health
--   watchdog_target_secret  production's SCHEDULER_SECRET
--   watchdog_resend_key     a Resend API key that can send from davisdigitalstudio.com
-- The live setup kept the secret inside watchdog_health_url. The block in step 2
-- below moves it into watchdog_target_secret inside the database, so nobody has
-- to copy it. On a fresh project, create all three by hand first:
--   select vault.create_secret('<URL above>', 'watchdog_health_url');
--   select vault.create_secret('<prod SCHEDULER_SECRET>', 'watchdog_target_secret');
--   select vault.create_secret('<Resend API key>', 'watchdog_resend_key');
-- After a rotation of production's SCHEDULER_SECRET, update the copy here:
--   select vault.update_secret((select id from vault.secrets where name = 'watchdog_target_secret'), '<new secret>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. State: one row. last_reason/last_checked_at let the dashboard's Table
--    Editor show what the watchdog saw last, without running any SQL.
create table if not exists public.watchdog_state (
  id int primary key,
  last_request_id bigint,
  last_alert_at timestamptz,
  last_ok_at timestamptz
);
alter table public.watchdog_state add column if not exists last_checked_at timestamptz;
alter table public.watchdog_state add column if not exists last_reason text;
alter table public.watchdog_state enable row level security;   -- deny-all; only the cron job (postgres) touches it
insert into public.watchdog_state (id) values (1) on conflict (id) do nothing;
-- The probe already in flight was sent the old way; judge only probes sent by
-- the function below.
update public.watchdog_state set last_request_id = null where id = 1;

-- 2. One-time move of the secret out of the address (no-op once done).
do $$
declare
  url_id uuid;
  url_val text;
begin
  if exists (select 1 from vault.secrets where name = 'watchdog_target_secret') then
    return;
  end if;
  select id, decrypted_secret into url_id, url_val
    from vault.decrypted_secrets where name = 'watchdog_health_url';
  if url_id is null then
    raise exception 'vault has no watchdog_health_url: create the three entries named at the top of this file first';
  end if;
  if position('secret=' in url_val) = 0 then
    raise exception 'watchdog_health_url holds no secret to move: create watchdog_target_secret by hand (see the top of this file)';
  end if;
  perform vault.create_secret(
    split_part(split_part(url_val, 'secret=', 2), '&', 1),
    'watchdog_target_secret',
    'production SCHEDULER_SECRET, sent by the watchdog as the x-system-secret header');
  perform vault.update_secret(url_id, split_part(url_val, '?', 1));
end $$;

-- 3. The check itself.
create or replace function public.presence_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  st public.watchdog_state;
  resp record;
  report jsonb;
  healthy boolean := null;
  reason text := null;
  parts text[] := '{}';
  safe text;
  req bigint;
begin
  select * into st from public.watchdog_state where id = 1;

  -- judge the PREVIOUS tick's probe
  if st.last_request_id is not null then
    select status_code, content, timed_out, error_msg into resp
      from net._http_response where id = st.last_request_id;
    if found then
      healthy := false;
      if resp.status_code is null then
        reason := 'production did not answer the health check ('
          || coalesce(nullif(resp.error_msg, ''), case when resp.timed_out then 'timed out' else 'no response' end) || ')';
      elsif resp.status_code = 403 then
        reason := 'production refused the health check (HTTP 403): the watchdog_target_secret copy of production''s SCHEDULER_SECRET is wrong';
      elsif resp.status_code <> 200 then
        reason := 'production answered the health check with HTTP ' || resp.status_code;
      else
        begin
          report := resp.content::jsonb -> 'data';
        exception when others then
          report := null;
        end;
        if report is null or jsonb_typeof(report) <> 'object' then
          reason := 'production answered, but not with a health report';
        elsif (report -> 'ok') = 'true'::jsonb then   -- the TOP-LEVEL ok only; secrets.ok is a different thing
          healthy := true;
        else
          if report -> 'db_ok' = 'false'::jsonb then
            parts := parts || 'its database did not answer'::text;
          end if;
          if report -> 'cron_stale' = 'true'::jsonb then
            parts := parts || 'no 15-minute run has finished in the last 45 minutes'::text;
          end if;
          if report -> 'failure_alarm' = 'true'::jsonb then
            parts := parts || format('%s runs failed in the last 24 hours, %s stuck',
              coalesce(report ->> 'failures_last_24h', '?'), coalesce(report ->> 'stuck_runs', '0'));
          end if;
          if jsonb_typeof(report -> 'secrets' -> 'missing_required') = 'array'
             and jsonb_array_length(report -> 'secrets' -> 'missing_required') > 0 then
            parts := parts || ('required secrets are missing: ' || (report -> 'secrets' -> 'missing_required')::text);
          end if;
          if jsonb_typeof(report -> 'last_failure') = 'object' then
            parts := parts || format('latest failure (%s at %s): %s',
              report -> 'last_failure' ->> 'run_type', report -> 'last_failure' ->> 'at', report -> 'last_failure' ->> 'last_error');
          end if;
          reason := 'production says it is not healthy: '
            || coalesce(nullif(array_to_string(parts, '; '), ''), 'it reported ok=false');
        end if;
      end if;
    end if;

    if healthy is true then
      update public.watchdog_state
        set last_ok_at = now(), last_checked_at = now(), last_reason = null where id = 1;
    elsif healthy is false or (st.last_ok_at is not null and st.last_ok_at < now() - interval '30 minutes') then
      reason := coalesce(reason, 'no answer to the last health probe, and no healthy answer for over 30 minutes');
      update public.watchdog_state
        set last_checked_at = now(), last_reason = left(reason, 1000) where id = 1;
      if st.last_alert_at is null or st.last_alert_at < now() - interval '6 hours' then
        safe := replace(replace(replace(reason, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_resend_key'),
            'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'Studio OS Watchdog <hello@davisdigitalstudio.com>',
            'to', jsonb_build_array('eric@davisdigitalstudio.com'),
            'subject', '[Studio OS ops] Production health check is failing',
            'html', '<p>The staging watchdog (Ohio) could not confirm production (Oregon) is healthy.</p>'
              || '<p><strong>Why:</strong> ' || safe || '</p>'
              || '<p>What to check: docs/presence/INCIDENT-RUNBOOK.md in the studio-os repo.</p>'
              || '<p>This alert repeats at most every 6 hours while the problem lasts.</p>',
            'text', 'The staging watchdog (Ohio) could not confirm production (Oregon) is healthy.' || chr(10) || chr(10)
              || 'Why: ' || reason || chr(10) || chr(10)
              || 'What to check: docs/presence/INCIDENT-RUNBOOK.md in the studio-os repo.' || chr(10)
              || 'This alert repeats at most every 6 hours while the problem lasts.'));
        update public.watchdog_state set last_alert_at = now() where id = 1;
      end if;
    end if;
  end if;

  -- fire this tick's probe; the secret goes in a header, and anything after a
  -- "?" in the stored address is dropped so it can never travel in the address
  select net.http_get(
    url := split_part((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_health_url'), '?', 1),
    headers := jsonb_build_object('x-system-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_target_secret'), '')),
    timeout_milliseconds := 20000
  ) into req;
  update public.watchdog_state set last_request_id = req where id = 1;
end;
$fn$;

-- Only the cron job runs it. Staging's anon key is public, and a definer
-- function that sends email must not be callable through the API.
revoke all on function public.presence_watchdog() from public, anon, authenticated;

-- 4. Every 5 minutes (cron.schedule replaces a job of the same name).
select cron.schedule('presence-watchdog', '*/5 * * * *', 'select public.presence_watchdog()');

-- 5. Verify right away (expect one row: 3, true). It shows no secret values.
select (select count(*) from vault.secrets
          where name in ('watchdog_health_url', 'watchdog_target_secret', 'watchdog_resend_key')) as watchdog_secrets,
       (select position('?' in decrypted_secret) = 0 from vault.decrypted_secrets
          where name = 'watchdog_health_url') as address_holds_no_secret;
-- ...and again after 10 minutes. last_checked_at is recent. last_reason is
-- empty when production is healthy; otherwise it says why. A reason that starts
-- "production says it is not healthy" proves the probe itself got through.
--   select last_checked_at, last_ok_at, last_alert_at, last_reason from public.watchdog_state;
