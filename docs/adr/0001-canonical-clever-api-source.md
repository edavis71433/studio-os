# ADR 0001 — Canonical source of the `clever-api` Edge Function

Date: 2026-07-05
Status: Accepted (audit approved by Eric, 2026-07-05)

## Decision

The one and only deployable source for the `clever-api` Supabase Edge Function
is:

    supabase/functions/clever-api/index.ts

in this repository. No other copy, anywhere, may be edited or deployed. All
other copies are quarantined in `_stale/` and exist for history only.

The same rule applies to `stripe-webhook`:

    supabase/functions/stripe-webhook/index.ts

## Context

The 2026-07-05 repo audit found four divergent copies of the clever-api
function body (8,702 / 8,049 / 889 / 226 lines) plus a stale June 24 deploy
manifest still naming the 889-line ancestor as the deploy target. A marker
diff of 34 distinctive symbols (`DDS_BUILD`, `PUBLIC_ROUTES`, `AI_MODEL`,
`pi_weekly`, `lifecycle_board`, `svcReadAll`, `ops_errors`, and 27 more)
against the deployed source (build `2026-07-04.11`, pasted from the Supabase
dashboard) scored **zero hits in every repo copy** — the deployed function had
evolved past all of them. The deployed source itself records a prior incident
in its "PORTED PRODUCTION ROUTES" banner: deploying a stale repo file once
removed live routes from production.

## Consequences / rules

1. **Deploy only from the canonical path**, via the scripted deploy
   (`.github/workflows/deploy.yml`), staging first, always.
2. **Never edit a file in `_stale/`.** If history is needed, read it there;
   changes happen only on the canonical file.
3. **Byte-fidelity rule:** the canonical file is established by a mechanical
   download from the deployed function (`supabase functions download
   clever-api`), never by copy-pasting through a chat or editor, so the bytes
   are provably identical to production. See
   `docs/runbooks/BYTE-CHECK.md` for the procedure and verification.
4. **The `DDS_BUILD` constant** inside the function is bumped on every deploy
   that renames or removes a route (existing convention; keep it).
5. Any new Edge Function gets its own `supabase/functions/<name>/index.ts`
   and is added to the deploy workflow. Functions deployed outside this repo
   are prohibited.

## Verification state at time of writing

- `portal.html` and `dds-studio-manage-9k2p.html` in this repo verified
  **SHA-256 identical** to the live site (2026-07-05).
- `contact.html` differs from live only by Netlify "Pretty URLs" link
  rewriting (build-time transform, not content drift).
- `supabase/functions/stripe-webhook/index.ts` **CONFIRMED byte-identical**
  to the deployed function via fresh CLI download (2026-07-05).
- `supabase/functions/clever-api/index.ts` **LANDED 2026-07-05** via
  mechanical CLI download: 11,322 lines, build `2026-07-04.11`, all 33
  markers present, strict superset of every quarantined copy (161 vs 127
  route types), SHA-256 prefix `7f2cac09bc1e826b7006`. The deployed
  entrypoint filename was `notify-client.ts`; renamed to `index.ts` with
  content hash unchanged.
