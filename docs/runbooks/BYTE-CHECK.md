# Byte-check runbook — proving repo == deployed reality

Goal: every deployable artifact in this repo is provably byte-identical to
what is running in production. Done once now, and re-done any time drift is
suspected.

## 0. One-time tool install (your machine)

The Supabase CLI is not installed on this machine yet. Either:

    npm install -g supabase
    # or, without a global install, prefix every command below with:  npx supabase

Then authenticate once:

    supabase login

Project ref (production): `qksstlqzbhesadrrofgn`

## 1. clever-api  (REQUIRED — canonical file does not exist until this runs)

    cd C:\Users\edavi\Documents\app
    supabase functions download clever-api --project-ref qksstlqzbhesadrrofgn

This writes the deployed source into `supabase/functions/clever-api/`. If the
downloaded entrypoint is not named `index.ts`, rename it to `index.ts`.

Then tell Claude "clever-api downloaded" — verification is: line count vs the
pasted dashboard source, the 34-marker sweep (`DDS_BUILD`, `PUBLIC_ROUTES`,
`AI_MODEL`, `pi_weekly`, ...), and a full diff against
`_stale/notify-client-2026-07-05.ts` confirming the known superset
relationship. Then it gets committed.

Fallback if the CLI download fails: Dashboard → Edge Functions → clever-api →
open the source → select all → paste into a new file saved as
`supabase/functions/clever-api/index.ts` with UTF-8 encoding and LF line
endings. (The CLI path is strongly preferred — a paste can silently normalize
whitespace.)

## 2. stripe-webhook  (confirm the copy already in the repo)

The repo copy came from `stripe-webhook.zip` (a dashboard download dated
2026-07-05 08:44). To confirm it still matches production:

    supabase functions download stripe-webhook --project-ref qksstlqzbhesadrrofgn
    git diff --no-index supabase/functions/stripe-webhook/index.ts <downloaded-file>

Empty diff = confirmed. Any diff = the download wins; replace the repo copy.

## 3. portal.html + admin panel + contact page  (DONE 2026-07-05 — record)

Verified by SHA-256 against the live site:

| File | Result |
|---|---|
| portal.html | MATCH (byte-identical, 334,709 B) |
| dds-studio-manage-9k2p.html | MATCH (byte-identical, 1,325,089 B) |
| contact.html | Differs ONLY by Netlify Pretty URLs link rewriting; no content drift |

Re-check command (any file):

    curl -s https://davisdigitalstudio.com/<file> | sha256sum
    sha256sum <file>          # repo copy

Note: Netlify Pretty URLs rewrites `x.html` hrefs to `/x` at serve time, so
pages with internal links may legitimately differ by exactly that transform.
`portal.html` and the admin panel do not contain such links and must match
byte-for-byte.

## 4. Function inventory check (one-time, dashboard)

Open Dashboard → Edge Functions and list what is deployed. Expected: exactly
`clever-api` and `stripe-webhook`. The zip evidence (`bright-service.zip` in
dashboard-download format) suggests a legacy function named **bright-service**
may still be deployed — it is the 226-line email stub with a dead hardcoded
key and `Access-Control-Allow-Origin: *`. If it exists, delete it in the
dashboard and note the deletion date in this file:

- bright-service checked on: ____ , result: ____
