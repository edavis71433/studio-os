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

## E. Deploys

- Edge Functions: `.github/workflows/deploy.yml`. Push to `staging` branch →
  deploys functions to the staging project. Production deploy is
  `workflow_dispatch` only, requires typing `deploy-production`, and deploys
  from `main`. **[PROD]**
- `stripe-webhook` deploys with `--no-verify-jwt` (Stripe cannot send
  Supabase auth headers) — encoded in the workflow, not remembered by humans.
- Site: Netlify deploys from git per context (B above).

## F. Definition of done for step 1

- [ ] Staging project exists; secrets set per inventory
- [ ] `0000_baseline.sql` committed with rollback note
- [ ] Baseline applied to staging via the runner (`supabase db push`)
- [ ] `clever-api` canonical file landed (BYTE-CHECK.md item 1) and deployed
      to STAGING via the workflow; smoke test: `{"type":"version"}` returns
      build `2026-07-04.11`
- [ ] `stripe-webhook` byte-confirmed (BYTE-CHECK.md item 2)
- [ ] Netlify staging context live
- [ ] Report to Eric before any production action
