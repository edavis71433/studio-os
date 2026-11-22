# Studio OS run sheet

The one page for running Studio OS: how a release goes out, how to undo one, how a database change goes in, how the pages go live, what to do when something is down, how to change a secret, and how the data is backed up and brought back. Written Nov 22 2026 (builder items 400, 415 to 420 and 422). If another page disagrees with this one, this one is right. The older pages it replaces are in `docs/archive/`: `DISASTER-RECOVERY.md`, `INCIDENT-RUNBOOK.md`, `DEPLOYMENT-AND-OPERATIONS.md`, `SECRETS-INVENTORY.md` and `ENVIRONMENTS.md`.

## Where things are

- **Pages** (the app, the client portal, the free tools): Netlify, site `studio-os-dds`, at app.davisdigitalstudio.com and tools.davisdigitalstudio.com. Built from this repository by `scripts/build-public.sh`; every build writes the commit it came from into `/version.json`.
- **The server**: the Supabase function `presence` (plus `clever-api`, `stripe-webhook` and the five Free Tools functions) on the production project `davis-digital-studio` (qksstlqzbhesadrrofgn, Oregon).
- **The database and the uploaded files**: the same production project.
- **Published client sites**: Netlify, one site each. They don't read the database when a visitor comes, so they stay up when Supabase is down; their forms and bookings don't.
- **Scheduled jobs** on production (Integrations, Cron; `supabase/ops/schedule-presence-cron.sql` is their source): `presence-cycle` every 15 minutes (the 15-minute job), `presence-keep-awake` every minute (builder item 404: a ping that touches nothing, so the next person meets a warm worker; the same worker answers 3 to 5 pings running; about 43,000 calls a month against the 2,000,000 the plan includes), and the daily Search Console and GA4 syncs.
- **The staging project** `studio-os-staging` (wjlpursnwbmlcdwbeowv, Ohio): runs only the 5-minute watchdog. Nothing deploys to it.

## Release

Release in batches, a few times a day (morning, early afternoon, evening Pacific are good times), not after every merge. Each release carries everything merged before it, and its summary lists those commits.

1. Merge the pull requests for the batch. Each merge runs the fast checks and the browser check on main: about 25 minutes since builder item 419 (it was 52 to 75).
2. Apply any database changes the batch carries, **before** releasing (next section but one). The release checks, and stops if one is missing.
3. Start it: Actions, "Deploy Edge Functions", Run workflow, type `deploy-production`. Or: `gh workflow run deploy.yml --repo edavis71433/studio-os --ref main -f confirm=deploy-production`.
4. The release runs the fast checks again, the walls between studios on a scratch database, waits for main's browser check, and asks production whether it has the newest database change in the code. Any one red: nothing is deployed, and the run says why.
5. It deploys every function, smoke-tests them, publishes the pages (see "Pages"), waits until the live site says it carries this commit, and checks the free tools' pages.

**An urgent fix** (a live fault, and the browser check is slow or jammed): tick "Urgent fix" when starting the release, or add `-f urgent=true`. It doesn't wait for the browser check; the fast checks, the walls test and the database check still have to pass. Watch main's browser check finish afterwards, and use the undo below if it fails.

Releases wait their turn: a second one waits for the first. A waiting run that GitHub cancels was replaced by a newer one carrying the same code: don't rerun it.

## Undo a release

Actions, "Rollback Functions", Run workflow: the commit to go back to, and type `rollback-production`. Or: `gh workflow run rollback.yml --repo edavis71433/studio-os -f ref=<commit> -f confirm=rollback-production`.

- `ref` may be `live`: it puts back the commit the last green release shipped. Running that once on a quiet day proves the undo works while nothing changes for anyone (builder item 418). It refuses `live` when a rollback went out after the last release; give the commit then.
- It redeploys every function at that commit and smoke-tests them, then puts the pages back too, once the release publishes them (see "Pages"; until then it says how to do it at Netlify).
- It doesn't undo database changes. Changes only add (new tables, columns, functions), so an older server runs on a newer database. To take a change back, run the `-- rollback:` line at the top of its migration by hand, and only when that change is the problem.

## Apply a database change

Every change is a file in `supabase/migrations` and an apply pack, `docs/presence/APPLY-NNNN-prod.sql`, that is safe to run twice.

1. Open the SQL editor for **production**: https://supabase.com/dashboard/project/qksstlqzbhesadrrofgn/sql/new. Check the top bar says `davis-digital-studio`. (On Nov 9 a pack ran in the wrong project.)
2. Run the packs in number order, one at a time. Read each one's answer: the verify lines at its end say what to expect. "Success. No rows returned" can be an empty tab; read the verify answer.
3. From 0260 on, each pack ends by writing its number into the change ledger. The Health page shows the newest number ("Database changes"), and the release refuses to go out while the code's newest change isn't there.

To see what production has: `select number, name, how, last_at from public.presence_change_ledger order by number desc limit 10;` (`how` is `pack` for a change that wrote itself down, `backfill` for one that was there before the ledger).

Every pull request rehearses its changes for free: "Database changes rehearsal" builds a scratch database from every migration in order, runs each pack from 0260 on twice, and checks the ledger. A red rehearsal means the change won't apply cleanly on production.

Writing a new change: take the next free number, end both the migration and its pack with `select public.presence_ledger_note(NNNN, 'short_name');`, and raise `CODE_NEWEST_CHANGE` in `supabase/functions/presence/lib/schema_ledger.ts` to the same number. `tests/presence/change_ledger_420_test.mjs` fails until all three agree. The changes that ran before the ledger existed (through 0247, 0249 to 0255, and 0265 to 0267) are written down once by APPLY-0260's backfill and don't write themselves.

## Pages

Builder item 400. A merge that changes no published file (server code, tests, docs, database changes: 22% of November's) builds nothing at Netlify (`netlify.toml`'s ignore rule, `scripts/netlify-ignore.sh`). Every production deploy costs 15 credits; the plan includes 3,000 a month, and running out pauses every site on the team, client sites included.

Who publishes the pages is one word in `scripts/pages-go-live.txt`:

- `merge` (today): Netlify builds main on every merge, as before. Pages go live at merge; the server goes live at release.
- `release`: the release builds this commit's pages on GitHub's machine and uploads them to Netlify as one deploy, right after the functions (`scripts/publish-pages.sh`), and Netlify's own builds of merges are skipped. Pages and server go live together, once per release, and the host's cache is emptied once per release instead of every merge.

Switching to `release` (Eric, about 5 minutes, then one small pull request):
1. Netlify, User settings, Applications, Personal access tokens, New access token (name it "Studio OS releases"). Copy it.
2. GitHub, the repository's Settings, Secrets and variables, Actions: add the secret `NETLIFY_AUTH_TOKEN` (the token) and the variable `NETLIFY_SITE_ID` (Netlify, site `studio-os-dds`, Site configuration, General, Site ID).
3. A pull request that changes `scripts/pages-go-live.txt` to `release`. The next release publishes the pages; check `https://app.davisdigitalstudio.com/version.json` names its commit.

Deploy previews of pull requests don't change: they always build, and cost nothing.

## When something is down

Two alarms watch production, by two routes that don't depend on each other:

- **The watchdog** on the staging project asks production's full health answer every 5 minutes and emails "[Studio OS ops] Production health check is failing" through Resend, at most every 6 hours, with a "Why:" line.
- **The outside check** (`.github/workflows/uptime.yml`, builder item 417) asks from GitHub every 15 minutes: the app's pages, the free tools, the server, its public status read, and that the health answer is still locked. A failed run is the alarm: GitHub emails it, and the run's page says what was down. It doesn't go through Supabase or Resend.

Production's health turns red when: the database doesn't answer; no 15-minute run has finished in 45 minutes; 10 or more scheduled runs failed in a day, or one is stuck for two hours; a setting the server can't run without is missing; or more than 5 requests crashed in an hour (builder item 416). The Health page (`admin-health.html`, operators only) shows each area and the newest ten crashes.

First steps:
1. Read the reason: the email's "Why:" line, or the failed run's summary.
2. Check the supplier's status page below. If it's theirs, wait; nothing here fixes it.
3. If it's ours: the Health page says which area. A crash spike names the route; a release that just went out is the first suspect, and the undo above is the way back.

| Supplier | Status page | What stops working when it's down |
|---|---|---|
| Supabase | https://status.supabase.com | Everything signed in: the app, the portal, the editor, sign-in, uploads, the scheduler, client sites' forms and bookings. Published client sites stay up. Releases can't deploy. |
| Netlify | https://www.netlifystatus.com | The app's pages, the free tools, and every published client site. Publishing. |
| Stripe | https://status.stripe.com | Paying an invoice online, retainer cards, the daily check against Stripe. Everything else works. |
| Resend | https://resend-status.com | Every email: notices, receipts, invitations, the watchdog's alarm. The outside check still emails through GitHub. |
| GitHub | https://www.githubstatus.com | Releases, rollbacks, backups, the outside check, the browser check. The product keeps working. |
| Cloudflare (Turnstile) | https://www.cloudflarestatus.com | The free tools' forms (site review, AI visibility) refuse to start. |
| Anthropic | https://status.claude.com | Writing help, the help box, photo descriptions, the monthly AI checks. |

GitHub switches a public repository's schedules off after 60 days with no commits; if the outside check or the backups stop running, that's why (Actions, the workflow, Enable workflow). GitHub emails a failed scheduled run to whoever last changed its schedule: check GitHub, Settings, Notifications, Actions, "Failed workflows only", is on for email.

## Change a secret

- **The server's secrets** (Supabase, Edge Functions, Secrets, production): every name it reads, and what each turns on, is on `/system/health` and in `docs/presence/ENV-AND-SECRETS.md`. A new value takes effect on the next request; no release needed.
- **`SCHEDULER_SECRET`**: the 15-minute job and the watchdog both send it. After changing it, update the copy in production's Vault (`presence_scheduler_secret`) and in staging's Vault (`watchdog_target_secret`), vault to vault, never pasted into SQL text.
- **GitHub's** (Settings, Secrets and variables, Actions): `SUPABASE_ACCESS_TOKEN` (releases and rollbacks deploy with it; the release's database check and the weekly file copy read with it), `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_URL` (the schema copy and the restore drill read production's database with it), `BACKUP_PASSPHRASE` (opens both weekly copies), `NETLIFY_AUTH_TOKEN` and the variable `NETLIFY_SITE_ID` (once the release publishes the pages), and `DRILL_DB_URL` only while a restore drill runs.
- Never put a secret in a job's text or an address: they land in logs.

## Backups

- **The database**: Supabase backs up production every day and keeps 7 days (Pro plan). Check the plan, that daily backups are on, and whether point-in-time recovery is on, in Supabase, the project, Database, Backups.
- **The uploaded files** (photos, PDFs, deliverables, form uploads): Supabase's backups don't include them. Every Sunday, "Copy of uploaded files (weekly, encrypted)" copies every file in every bucket into one encrypted archive and keeps it 35 days on the run's page: five weekly copies at any time (`scripts/storage-copy.sh`, builder item 415).
- **The database's shape**: "Schema copy (weekly, encrypted)" saves the structure (no rows) every Sunday, kept 35 days.

Both copies are encrypted, because anyone signed in to GitHub can download a public repository's artifacts. They need the repository secret `BACKUP_PASSPHRASE`, 32 characters or more; without it both refuse before reading anything. Setting it once, on a Mac, keeping a copy in the Keychain:

    P=$(openssl rand -hex 32) && security add-generic-password -U -a studio-os -s backup-passphrase -w "$P" && printf '%s' "$P" | gh secret set BACKUP_PASSPHRASE --repo edavis71433/studio-os; unset P

Lose the passphrase and the copies can't be opened: keep the Keychain entry (or a password manager copy). Opening a copy (download it from the run's page first):

    BACKUP_PASSPHRASE="$(security find-generic-password -a studio-os -s backup-passphrase -w)" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE -in uploaded-files-YYYY-MM-DD.tar.gz.enc | tar -xzf -

The files come out under `files/<bucket>/`, with `manifest.tsv` listing each one's size and fingerprint. The schema copy opens the same way to `00-schema-foundation.sql`.

## Restore

Nobody had brought the data back before builder item 415. The drill proves it, into a throwaway project, never production. It costs money while the project exists (Supabase's smallest size is about 1.4 cents an hour; a drill takes about an hour), so it runs only with Eric's yes.

1. Supabase, New project, in the same organization: name it `restore-drill-<date>`, the smallest size, any region. Wait until it's ready.
2. Its database address: the new project, Connect, the session pooler address with its password. Add it to GitHub as the repository secret `DRILL_DB_URL`.
3. Actions, "Restore drill (into a throwaway project)", Run workflow: the new project's ref (Project Settings, General), leave the copy blank for the newest, type `restore-drill`.
4. The drill (`scripts/restore-drill.sh`) refuses production and any project that isn't empty, then: copies production's database into the new project, opens the newest weekly copy of the files and puts every file back in its bucket, reads each one back and checks its fingerprint, and opens the newest live client site there (its rows match production, every file its pages show opens). The run's summary says what came back, in counts.
5. Delete the new project (its Settings, General, Delete project) and the `DRILL_DB_URL` secret. Write down the date and the summary's lines here.

If production itself is lost: make a new project the same way and load production's last good database into it (Supabase's daily backups restore from production's Database, Backups page, into the same project or, where Supabase offers it, a new one; or copy it the way the drill does), put the files back from the newest weekly copy, set the server's secrets again (`docs/presence/ENV-AND-SECRETS.md`), point the release at the new project (the repository secret `SUPABASE_PROJECT_REF_PROD`), release, and check `/system/health`. Published client sites keep running on Netlify meanwhile.
