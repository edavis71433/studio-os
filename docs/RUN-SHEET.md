# Studio OS run sheet

The one page for running Studio OS: how a release goes out, how to undo one, how a database change goes in, what to do when something is down, and how to change a secret. Written Nov 22 2026 (builder items 416, 417, 420 and 422). If another page disagrees with this one, this one is right; the older pages move to `docs/archive/` with builder item 422.

## Where things are

- **Pages** (the app, the client portal, the free tools): Netlify, site `studio-os-dds`, at app.davisdigitalstudio.com and tools.davisdigitalstudio.com. Built from this repository by `scripts/build-public.sh`.
- **The server**: the Supabase function `presence` (plus `clever-api`, `stripe-webhook` and the five Free Tools functions) on the production project `davis-digital-studio` (qksstlqzbhesadrrofgn, Oregon).
- **The database and the uploaded files**: the same production project.
- **Published client sites**: Netlify, one site each. They don't read the database when a visitor comes, so they stay up when Supabase is down; their forms and bookings don't.
- **The staging project** `studio-os-staging` (wjlpursnwbmlcdwbeowv, Ohio): runs only the 5-minute watchdog. Nothing deploys to it.

## Release

1. Merge the pull requests for the batch. Every merge runs the fast checks and the browser check on main (about 15 minutes since builder item 419).
2. Apply any database changes the batch carries, **before** releasing (next section). The release checks.
3. Start the release: Actions, "Deploy Edge Functions", Run workflow, type `deploy-production`. Or: `gh workflow run deploy.yml --repo edavis71433/studio-os --ref main -f confirm=deploy-production`.
4. The release runs the fast checks again, the walls between studios on a scratch database, waits for main's browser check, and asks production whether it has the newest database change in the code. Any one of them red: nothing is deployed, and the run says why.
5. It deploys every function, then smoke-tests them and the free tools' pages.

Releases wait their turn: a second one waits for the first. A waiting run that GitHub cancels was replaced by a newer one carrying the same code: don't rerun it.

## Undo a release

Actions, "Rollback Functions", Run workflow: the commit to go back to, and type `rollback-production`. It redeploys every function at that commit and smoke-tests them.

- It doesn't undo database changes. Changes only add (new tables, columns, functions), so an older server runs on a newer database. To take a change back, run the `-- rollback:` line at the top of its migration by hand, and only when that change is the problem.
- Find the commit that was live before: the head commit of the previous green "Deploy Edge Functions" run.

## Apply a database change

Every change is a file in `supabase/migrations` and an apply pack, `docs/presence/APPLY-NNNN-prod.sql`, that is safe to run twice.

1. Open the SQL editor for **production**: https://supabase.com/dashboard/project/qksstlqzbhesadrrofgn/sql/new. Check the top bar says `davis-digital-studio`. (On Nov 9 a pack ran in the wrong project.)
2. Run the packs in number order, one at a time. Read each one's answer: the verify lines at its end say what to expect. "Success. No rows returned" can be an empty tab; read the verify answer.
3. From 0260 on, each pack ends by writing its number into the change ledger. The Health page shows the newest number ("Database changes"), and the release refuses to go out while the code's newest change isn't there.

To see what production has: `select number, name, how, last_at from public.presence_change_ledger order by number desc limit 10;` (`how` is `pack` for a change that wrote itself down, `backfill` for one that was there before the ledger).

Every pull request rehearses its changes for free: "Database changes rehearsal" builds a scratch database from every migration in order, runs each pack from 0260 on twice, and checks the ledger. A red rehearsal means the change won't apply cleanly on production.

Writing a new change: take the next free number, end both the migration and its pack with `select public.presence_ledger_note(NNNN, 'short_name');`, and raise `CODE_NEWEST_CHANGE` in `supabase/functions/presence/lib/schema_ledger.ts` to the same number. `tests/presence/change_ledger_420_test.mjs` fails until all three agree. The changes that ran before the ledger existed (through 0247, 0249 to 0255, and 0265 to 0267) are written down once by APPLY-0260's backfill and don't write themselves.

## When something is down

Two alarms watch production, by two routes that don't depend on each other:

- **The watchdog** on the staging project asks production's full health answer every 5 minutes and emails "[Studio OS ops] Production health check is failing" through Resend, at most every 6 hours, with a "Why:" line.
- **The outside check** (`.github/workflows/uptime.yml`, builder item 417) asks from GitHub every 15 minutes: the app's pages, the free tools, the server, its public status read, and that the health answer is still locked. A failed run is the alarm: GitHub emails it, and the run's page says what was down. It doesn't go through Supabase or Resend.

Production's health turns red when: the database doesn't answer; no 15-minute run has finished in 45 minutes; 10 or more scheduled runs failed in a day, or one is stuck for two hours; a setting the server can't run without is missing; or more than 5 requests crashed in an hour (builder item 416). The Health page (`admin-health.html`, operators only) shows each area and the newest ten crashes.

First steps:
1. Read the reason: the email's "Why:" line, or the failed run's summary.
2. Check the supplier's status page below. If it's theirs, wait; nothing here fixes it.
3. If it's ours: the Health page says which area. A crash spike names the route; a release that just went out is the first suspect, and the rollback above is the way back.

| Supplier | Status page | What stops working when it's down |
|---|---|---|
| Supabase | https://status.supabase.com | Everything signed in: the app, the portal, the editor, sign-in, uploads, the scheduler, client sites' forms and bookings. Published client sites stay up. Releases can't deploy. |
| Netlify | https://www.netlifystatus.com | The app's pages, the free tools, and every published client site. Publishing. |
| Stripe | https://status.stripe.com | Paying an invoice online, retainer cards, the daily check against Stripe. Everything else works. |
| Resend | https://resend-status.com | Every email: notices, receipts, invitations, the watchdog's alarm. The outside check still emails through GitHub. |
| GitHub | https://www.githubstatus.com | Releases, rollbacks, the outside check, the browser check. The product keeps working. |
| Cloudflare (Turnstile) | https://www.cloudflarestatus.com | The free tools' forms (site review, AI visibility) refuse to start. |
| Anthropic | https://status.claude.com | Writing help, the help box, photo descriptions, the monthly AI checks. |

GitHub switches a public repository's schedules off after 60 days with no commits; if the outside check stops running, that's why (Actions, "Uptime (from outside)", Enable workflow).

## Change a secret

- **The server's secrets** (Supabase, Edge Functions, Secrets, production): the list of every name it reads, and what each turns on, is on `/system/health` and in `docs/presence/ENV-AND-SECRETS.md`. A new value takes effect on the next request; no release needed.
- **`SCHEDULER_SECRET`**: the 15-minute job and the watchdog both send it. After changing it, update the copy in production's Vault (`presence_scheduler_secret`) and in staging's Vault (`watchdog_target_secret`), vault to vault, never pasted into SQL text.
- **GitHub's** (Settings, Secrets and variables, Actions): `SUPABASE_ACCESS_TOKEN` (releases and rollbacks deploy with it; the release's database check reads with it), `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_URL` (the schema copy).
- Never put a secret in a job's text or an address: they land in logs.

## Backups and restore

Supabase backs up production's database every day and keeps 7 days (Pro plan). Those backups don't include the uploaded files. Builder item 415 adds a weekly encrypted copy of the files and a restore drill; until then, see `docs/presence/DISASTER-RECOVERY.md`.
