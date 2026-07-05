# Davis Digital Studio — Scheduler Setup

This turns on the "automate later" layer: automated post-launch survey + Google review
requests, and gentle content-collection nudges. It runs on a daily timer in Supabase.

Everything is idempotent: the job stamps a column when it sends something, so a client
never gets the same email twice, even if the job runs many times.

---

## What it does

1. **Delayed survey + review** — a few days after you mark a project launched, the
   client automatically gets the "how did it go" survey email, with your Google review
   link if you've set one. Sent once, ever.

2. **Content nudges** — for a client with a content due date set and content not yet
   received, the job sends a friendly reminder as the date approaches and (gently) if
   it passes, spaced a few days apart. Stops the moment you mark content received or
   the project launches.

You control both from the client hub: a "Content due" date picker and a "Mark content
received" button now sit in each client's status panel.

---

## One-time setup (in order)

### Step 1 — Add the tracking columns
Supabase → SQL Editor → paste and run `01-add-scheduler-columns.sql`. Safe to re-run.

### Step 2 — Deploy the updated Edge Function
Deploy `clever-api-COMPLETE.ts` (it now has the `run_scheduled_jobs` route). Same deploy
process as always.

### Step 3 — Set the secrets
Supabase → Edge Functions → clever-api → Secrets:
- `SCHEDULER_SECRET` — any long random string. The cron job sends this so the public
  can't trigger the scheduler. Without it, the route refuses to run (fail closed).
- `GOOGLE_REVIEW_LINK` — optional. Your Google review short link (from your Google
  Business Profile, "Ask for reviews"). If unset, surveys still send, just without the
  review button.

### Step 4 — Schedule the cron
Supabase → SQL Editor → open `02-schedule-cron.sql`, replace the two placeholders
(`<YOUR_PROJECT_REF>` = qksstlqzbhesadrrofgn, and `<YOUR_SCHEDULER_SECRET>` = the secret
from Step 3), then run it.

### Step 5 — Test it once now
At the bottom of `02-schedule-cron.sql` there's a one-line `net.http_post` you can run
immediately instead of waiting for the daily run. Run it, then check:
- Supabase → Edge Functions → clever-api → Logs (you'll see the run)
- The response shows counts: surveys_sent, nudges_sent, errors

To safely test without emailing a real client: set a test client's `launched_at` to 5+
days ago and `survey_sent_at` to null, then trigger. Confirm the email arrives, then
confirm a second trigger does NOT re-send (because survey_sent_at is now stamped).

---

## How you'll use it day to day

- At kickoff, set the client's **Content due** date in their hub. The nudges handle
  themselves from there.
- When their content arrives, click **Mark content received**. Nudges stop.
- When you launch, click **Mark as launched** (you already do this). The survey goes
  out automatically a few days later. You don't have to remember it.
- If you'd rather send the survey manually (the old "mark complete" button), that still
  works and now also stamps the flag, so the scheduler won't double-send.

## Tuning

In the Edge Function, near the top, these control timing:
- `SURVEY_DELAY_DAYS` (default 4) — days after launch before the survey sends
- `CONTENT_NUDGE_EVERY_DAYS` (default 3) — minimum days between nudges
- `CONTENT_NUDGE_LEAD_DAYS` (default 2) — start nudging this many days before due

## Safety notes

- The job only ever emails the client's contact email, never anyone else.
- `automation_paused` on a client row (true) silences all automated emails to them.
- Every send is wrapped so one bad client can't stop the others; errors are returned
  in the response and logged, not thrown.
