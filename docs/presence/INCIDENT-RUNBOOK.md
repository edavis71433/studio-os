# Incident Runbook — one page, worst day

> When something is wrong in production and you're the only person on call.
> Every check below is copy-paste ready. Prod ref: `qksstlqzbhesadrrofgn` · Staging: `wjlpursnwbmlcdwbeowv`.

## 0. How you find out

| Signal | Source | Meaning |
|---|---|---|
| Watchdog email "Production health check FAILED" | staging pg_cron → Resend (hourly-deduped) | prod `/system/health` unreachable, or `ok:false` (DB down, cron dead >45min, ≥10 failed runs/24h) |
| Failure email "N/M scheduled runs failed" | the tick itself | per-site cycle failures — auto-retried hourly, read the ledger before acting |
| A customer emails | support@ | check §2 triage first, then their site |

## 1. First 5 minutes — triage

1. **Is the health endpoint alive?**
   `GET https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/health` with header `x-system-secret: <SCHEDULER_SECRET>` → look at `ok`, `db_ok`, `cron_stale`, `failure_alarm`, `secrets.missing_required`.
2. **What broke recently?** Supabase Dashboard → Edge Functions → presence → Logs (last hour). Request-path exceptions are ALSO durable: SQL editor → `select * from ops_errors order by created_at desc limit 20;`
3. **What did the scheduler do?** `select run_type, status, started_at, last_error, result->'progress' from presence_scheduled_runs order by created_at desc limit 10;` — a `running` tick row with partial `progress` shows exactly which sweep died.
4. **Is it just email?** Alerts flow through Resend. Check https://resend.com status + dashboard. Resend down = alerts dark but the platform may be fine.

## 2. Common incidents → exact response

**Customer sites are down / publish fails**
Published sites are static on Netlify — they survive a DB outage. If a *publish* fails: it's recorded in `presence_publishes` (status `failed`) and raises a `publish_failed` notice; the reconcile sweep finalizes stuck ones every tick. Check Netlify status page before touching anything.

**Payments not provisioning**
Stripe Dashboard → Webhooks → the endpoint → recent deliveries. Non-200s: check `stripe-webhook` function logs. The webhook is idempotent (claim-first) — Stripe retries safely; billing reconcile also self-corrects drift every tick (`reconcile_billing`). Do NOT hand-edit entitlements unless Stripe and the DB disagree after a full reconcile.

**Cron dead (`cron_stale:true`)**
`select jobname, schedule, active from cron.job;` — if jobs are gone, re-run `supabase/ops/schedule-presence-cron.sql` (secret comes from Vault). One manual tick to catch up:
`POST .../presence/system/run` body `{"secret":"<SCHEDULER_SECRET>","task":"cycle"}`.

**Database down / Supabase incident**
https://status.supabase.com. Nothing to do but wait — published sites stay up; the app shows its own errors. When it returns, the next tick self-heals (retries, reconcile, rotation cursors).

**A bad deploy (function broken after a change)**
GitHub → Actions → `rollback.yml` → run with the last known-good ref (functions are stateless; rollback is a redeploy). Locally: `git log --oneline` to pick the ref.

**Secret leaked / suspected compromise**
Rotate in Supabase → Edge Functions → Secrets (and its consumer: pg_cron Vault entry for SCHEDULER_SECRET, Stripe dashboard for webhook secret, Resend for API key). Service-role key rotation: Supabase Dashboard → Settings → API. Then redeploy nothing — functions read env at invocation.

**Runaway email (wrong sends going out)**
Fastest kill: delete `RESEND_KEY` from the presence AND clever-api function secrets — every send becomes a logged no-op instantly. Restore when fixed. (Marketing sends also die per-recipient via `suppressed_emails`.)

## 3. Escalation / restore

- **Data restore**: `docs/presence/DISASTER-RECOVERY.md` (RPO/RTO + step-by-step). Verify migrations with `scripts/dr-verify.mjs` after any restore.
- **Supabase support**: dashboard → Support (paid plan SLA).
- **Never**: reset the yahoo login (edavis7143@yahoo.com — no admin role by design), hand-run DELETEs on presence tables during an incident, or push code as a "fix" without the CI gates.

## 4. After the incident

1. `ops_errors` + `presence_scheduled_runs` keep the forensic trail 90 days — read it before writing the note.
2. One paragraph in `docs/presence/RELEASE-NOTES.md`: what broke, what fixed it, what prevents recurrence.
3. If a check in this runbook was wrong or missing, fix the runbook in the same commit.
