# clever-api Smoke Suite (M1a — the safety gate)

Baseline tripwire across `supabase/functions/clever-api/index.ts`'s major
behavior classes. **Run it green BEFORE and AFTER any change to the monolith**
— its first customer is the `_shared` middleware extraction, whose definition
of done is "this suite passes identically before and after."

Not coverage. A tripwire. Add a check when a behavior class changes; never
let it take longer than ~30 seconds to run.

## How to run

```bash
# Anonymous tier only (CI-safe, no secrets beyond the public anon key):
deno run --allow-net --allow-env tests/smoke/smoke_test.ts

# Full run (adds client/Growth/journal/messaging checks via the dedicated
# archived test identity; resets its password per run):
SR_KEY=<service-role-key> deno run --allow-net --allow-env tests/smoke/smoke_test.ts
```

Env overrides: `SUPABASE_URL`, `ANON_KEY`, `SITE_URL` (defaults = production).
Point them at staging (`wjlpursnwbmlcdwbeowv`) for staging runs — note the
auth tier needs the RCAT test identity seeded there first, and staging still
needs migration 0014.

Exit code 0 = green. Non-zero = failures listed at the bottom of the output.

## The checks

| # | Behavior class | Check | Expected | CI-safe |
|---|---|---|---|---|
| 1 | deploy sanity | `version` handshake | 200 + `data.build` | ✅ |
| 2 | auth gate | unknown route type | 403 `unknown_route` (fail-closed) | ✅ |
| 3 | auth gate | staff route (`admin_query`) w/o JWT | 401 | ✅ |
| 4 | auth gate | the kinds builder item 213 removed (the old client-emailing notices, `invoice_paylink`, `client_purge`, `delete_client_cascade`, `contract_get`, `_resolver_probe`) | 403 `unknown_route`, like any unknown kind | ✅ |
| 5 | CORS | allowlisted origin | ACAO echoes the origin | ✅ |
| 6 | CORS | foreign origin | ACAO falls back to canonical, never echoes | ✅ |
| 7 | Stripe HMAC | `stripe-webhook` unsigned POST | 400 `invalid signature` | ✅ |
| 8 | deploy sanity | portal + admin pages | HTTP 200 | ✅ |
| 9 | presence | `GET /site` and an unknown route w/o JWT | 401 | ✅ |
| 10 | auth | test-client login (password grant) | token minted | 🔑 auth tier |
| 11 | identity | `whoami` with the client JWT | 200 + `isTeam: false` | 🔑 |
| 12 | messaging | RLS-scoped `messages` read as client | 200 + array (own rows) | 🔑 |
| 13 | auth boundary | client JWT on staff route | 401 | 🔑 |

🔑 = requires `SR_KEY` (service role). Local/staging-runner only — never in a
CI secret for anything public-facing.

## Deliberately NOT smoked (manual / staging-only)

- **The two public forms and the help chat** (`lead_intake`, `survey_response`,
  `concierge`) — each run would write a row, email Eric or spend AI tokens.
- **The Growth page's writes and AI drafts** (`partnership_upsert`,
  `rec_generate`, `review_draft`, …) — write real rows or spend tokens;
  exercise them on a scratch database when touched (`tests/isolation/`).

## Test identity

`rcat-acceptance@example.com` — dedicated, **archived** client ("RCAT
Acceptance", invisible in admin daily views) with contact + partnership +
approvals fixtures, created 2026-07-06 for the release acceptance run. The
auth tier resets its password each run via the service role. If it's ever
deleted, recreate via `scratchpad/seed-acceptance.mjs`-style seeding (auth
user → client → contact → partnership).

## History

- 2026-07-06: first green run, 19/19 against production (build 2026-07-04.11)
  minutes after the RC release + migration 0014. This suite's ancestor (the
  live acceptance suite) caught the missing `approvals.responded_at`/
  `client_feedback` columns the same day — the class of regression this file
  exists to catch.
