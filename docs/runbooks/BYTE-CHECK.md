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

## 1. clever-api  (DONE 2026-07-05 — record)

Captured mechanically via `supabase functions download clever-api
--project-ref qksstlqzbhesadrrofgn` (CLI v2.109.0). Verification, all passed:

- 11,322 lines; `DDS_BUILD = '2026-07-04.11'` (matches the dashboard source)
- All 33 deployed-build markers present (`PUBLIC_ROUTES`, `AI_MODEL`,
  `pi_weekly`, `lifecycle_board`, ...)
- Strict superset of `_stale/notify-client-2026-07-05.ts`: 161 route-dispatch
  types vs 127, zero missing
- SHA-256 (first 20 hex): `7f2cac09bc1e826b7006`

The deployed entrypoint was named `notify-client.ts`; renamed to `index.ts`
(content hash unchanged) so CLI deploys use the default entrypoint. Note for
re-verification: a future `functions download` may again produce
`notify-client.ts` until the first deploy FROM this repo standardizes the
name — compare content hashes, not filenames.

To re-check for drift at any time:

    supabase functions download clever-api --project-ref qksstlqzbhesadrrofgn
    # then hash-compare against supabase/functions/clever-api/index.ts

## 2. stripe-webhook  (DONE 2026-07-05 — record)

Fresh `supabase functions download stripe-webhook` compared against the repo
copy (which came from `stripe-webhook.zip`): **BYTE-IDENTICAL**. The repo copy
is confirmed deployed reality.

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

- bright-service checked on: 2026-07-05, result: **existed and was DELETED
  from the dashboard by Eric the same day.** Deployed inventory is now exactly
  `clever-api` + `stripe-webhook`, both byte-verified against this repo.

## 5. Storage bucket fact (recorded 2026-07-05)

`client-files` bucket is **PRIVATE** (confirmed by Eric). Note for the Files
module (build step 7): the admin panel constructs
`/object/public/client-files/...` URLs on upload
(`dds-studio-manage-9k2p.html`, `uploadFiles`) and stores them in `files.url`
— against a private bucket those URLs are dead weight; real downloads go
through `createSignedUrl`. Clean up when the Files module is built.
