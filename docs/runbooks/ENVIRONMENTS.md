# Environments runbook — staging, migration runner, scripted deploys

Build Brief step 1. Nothing below touches production except where marked
**[PROD]**, and those steps run only after explicit approval.

## Current state (2026-07-05)

| Piece | State |
|---|---|
| Canonical repo | This folder; remote: https://github.com/edavis71433/studio-os (private) |
| Production Supabase | `qksstlqzbhesadrrofgn` — Edge Functions: exactly `clever-api` + `stripe-webhook` (legacy `bright-service` deleted 2026-07-05); `client-files` bucket is PRIVATE |
| Staging Supabase | `wjlpursnwbmlcdwbeowv` (created 2026-07-05) |
| Migration runner | Supabase CLI (`supabase migration`/`db push`), files in `supabase/migrations/` |
| Scripted deploy | `.github/workflows/deploy.yml` (staging on push, prod manual) |
| Schema baseline | Pending — capture via `schema-dump.yml` workflow (step C) |

## A. Create the staging Supabase project (Eric, dashboard — ~10 min)

1. supabase.com → New project. Suggested name: `studio-os-staging`. Same
   region as production. Note the new project ref: `____________`.
2. Set the Edge Function secrets from `docs/SECRETS-INVENTORY.md`, staging
   column rules: staging's own URL/keys, Stripe TEST key, staging
   `SITE_URL`. Never the production service-role key.
3. Add GitHub secrets: `SUPABASE_PROJECT_REF_STAGING`,
   `SUPABASE_DB_URL_STAGING`, and (once) `SUPABASE_ACCESS_TOKEN`.
4. Auth → URL configuration: add the staging site URL +
   `/set-password.html` redirect.

## B. Netlify staging context (Eric — ~5 min)

1. Connect this repo to the Netlify site (if not already).
2. Enable branch deploys for a `staging` branch. Production stays pinned to
   `main`, deploying only on merge.
3. Frontend API base: the HTML files currently hardcode the production
   functions URL; pointing staging pages at the staging functions is part of
   the step 2 config pass (tracked in SECRETS-INVENTORY "config debt").

## C. Capture the schema baseline (0000_baseline)

The repo already ships `.github/workflows/schema-dump.yml` (manual trigger,
schema-only, with a data-leak guard). Once the repo is pushed to GitHub and
`SUPABASE_DB_URL` is set:

1. Actions → "Schema dump" → Run workflow.
2. Download the `schema-foundation` artifact.
3. Save it as `supabase/migrations/0000_baseline.sql`, commit.
4. Rollback note (required header for every migration): baseline has none to
   roll back to; its header says "baseline — restore from backup only".

Local alternative (no GitHub needed):

    npx supabase db dump --db-url "<SUPABASE_DB_URL>" --schema public -f supabase/migrations/0000_baseline.sql

**Connection-string lesson (2026-07-05, hard-won — do not re-debug):**

- The DIRECT connection string (`db.<ref>.supabase.co:5432`) FAILS from
  IPv4-only networks — Supabase direct connections are IPv6. Symptom:
  connection timeout / unreachable.
- Use the **transaction pooler URI** instead
  (`...pooler.supabase.com:6543`, username `postgres.<project-ref>`). This is
  what the `SUPABASE_DB_URL` GitHub secret holds.
- The pooler failed AUTH until the database password was reset to **letters
  and numbers only** — special characters in the password break the URI
  (they need percent-encoding, and some tooling still mishandles them).
  Rule: DB passwords here are alphanumeric-only, or must be URL-encoded in
  every connection string.

Then apply the baseline to STAGING to prove the runner end-to-end:

    npx supabase link --project-ref <STAGING_REF>
    npx supabase db push

## D. Migration runner rules (from Build Brief §2.7, §7)

- Forward-only, numbered files in `supabase/migrations/`:
  `NNNN_short_name.sql` (0000 is the baseline).
- Every migration starts with a comment header:
  `-- rollback: <how to undo, or why it cannot be undone>`.
- Staging first, always. Production apply is a deliberate, approved step.
- No dashboard-only schema changes, ever again. (The 79-relation live schema
  accumulated entirely via dashboard — the baseline freezes that history.)

## D-bis. Production deploy ORDER for coupled frontend+backend changes

When a change gates a route that a frontend calls (e.g. the 2026-07-05
`invoice_reminder`/`approval_needed` staff-gating), deploy order matters:

- **Frontend (Netlify) FIRST, then the function.** The updated admin panel
  sends `x-dds-user-jwt`; the OLD function ignores the extra header, so the
  frontend-first window has zero regression. If the FUNCTION went first, the
  live (old) admin panel would call the now-staff-gated route without a JWT
  and its reminder emails would silently 401 until the panel caught up.
- General rule: widen what the frontend sends before the backend starts
  requiring it. Never the reverse.

## D-ter. Staging seed state (2026-07-05)

Created to test staff-gated routes end-to-end (reused by the step-3 isolation
suite):
- `tenants`: one row, id `00000000-0000-0000-0000-000000000001` ("Davis Digital
  Studio", slug `dds`) — REQUIRED: `memberships.tenant_id` FKs to `tenants`, so
  nothing membership-based works until tenant #1 exists. Production already has
  this row; staging (schema-only baseline) needed it seeded.
- One auth user `staging-staff@studio-os.test` + a `memberships` row at role
  `staff`. Test-only; password held outside the repo. Fine on staging (demo
  data only). Rotate/remove before staging is ever exposed publicly.

## E. Deploys

- Edge Functions: `.github/workflows/deploy.yml`. Push to `staging` branch →
  deploys functions to the staging project. Production deploy is
  `workflow_dispatch` only, requires typing `deploy-production`, and deploys
  from `main`. **[PROD]**
- `stripe-webhook` deploys with `--no-verify-jwt` (Stripe cannot send
  Supabase auth headers) — encoded in the workflow, not remembered by humans.
- Site: Netlify deploys from git per context (B above).

## F. Definition of done for step 1

- [x] Staging project exists (`wjlpursnwbmlcdwbeowv`, 2026-07-05); secrets
      per inventory (Eric working through the fill-in checklist)
- [x] `0000_baseline.sql` committed with rollback note (commit c000cea)
- [x] Baseline applied to staging via the runner — `supabase db push`,
      ledger `local 0000 = remote 0000`, REST-probed **78/78 relations
      present** (2026-07-05)
- [x] `clever-api` canonical file landed (BYTE-CHECK.md item 1) and deployed
      to STAGING; smoke test returned build `2026-07-04.11`; unknown route
      → 403 (deny-by-default gate alive on staging)
- [x] `stripe-webhook` byte-confirmed (BYTE-CHECK.md item 2); staging
      negative tests: unsigned POST → 400, GET → 405
- [ ] Netlify staging context live (Eric, dashboard — §B)
- [x] Nothing has touched production (all prod interactions read-only)
