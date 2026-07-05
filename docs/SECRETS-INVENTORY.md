# Secrets and configuration inventory — per environment

Source of truth for WHICH secrets exist: the `Deno.env.get` calls in the
deployed functions (build 2026-07-04.11), enumerated below. Values live only
in the Supabase / GitHub / Netlify dashboards — never in this repo.

Rule (Build Brief §2.8): deployment variance is config-only. Staging and
production run identical code with different values for the rows below.

## clever-api function secrets (Supabase → Edge Functions → Secrets)

| Secret | Used for | Required | Rotation cadence | Notes |
|---|---|---|---|---|
| `SUPABASE_URL` | PostgREST/auth base URL | yes | n/a (per project) | Code falls back to the prod URL — staging MUST set it explicitly |
| `SERVICE_ROLE_KEY` | privileged DB/auth calls | yes | 90 days | Alias accepted: `SUPABASE_SERVICE_ROLE_KEY` |
| `SUPABASE_ANON_KEY` | RLS-scoped caller reads | yes | 90 days | Alias accepted: `ANON_KEY` |
| `RESEND_KEY` | all outbound email | yes | 90 days | Rotated 2026-07-02 (old key dead) |
| `ANTHROPIC_KEY` | all 21 AI call sites | yes | 90 days | |
| `PSI_KEY` | PageSpeed Insights | yes | 180 days | Also fallback for `PLACES_KEY` |
| `SCHEDULER_SECRET` | gates `run_scheduled_jobs` / `gsc_ingest` | yes | 180 days | Also embedded in the pg_cron job body — rotate both together |
| `STATE_SIGNING_SECRET` | OAuth state HMAC | recommended | 180 days | Falls back to `SCHEDULER_SECRET` if unset |
| `STRIPE_SECRET` | checkout links, subscriptions | yes | on incident | Use the TEST key on staging, always |
| `SITE_URL` | Stripe success/cancel URLs | yes | n/a | Staging: the Netlify preview/staging URL |
| `GOOGLE_CLIENT_ID` | GA4/GSC/GBP OAuth | if integrations on | n/a | |
| `GOOGLE_CLIENT_SECRET` | GA4/GSC/GBP OAuth | if integrations on | 180 days | |
| `GOOGLE_REFRESH_TOKEN` | `gsc_ingest` service account flow | if GSC ingest on | on revocation | |
| `GOOGLE_REVIEW_LINK` | review-ask emails | optional | n/a | Plain URL, not a secret |
| `PLACES_KEY` | prospect discovery | optional | 180 days | Falls back to `PSI_KEY` |
| `CALENDLY_TOKEN` | today's bookings | optional | 180 days | Personal access token |

## stripe-webhook function secrets

| Secret | Used for | Required | Notes |
|---|---|---|---|
| `SB_URL` (or `SUPABASE_URL`) | DB writes | yes | |
| `SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | DB writes | yes | |
| `STRIPE_WEBHOOK_SECRET` | signature verification (`whsec_...`) | yes | One per environment — the staging Stripe webhook endpoint has its own |

## GitHub Actions secrets (repo → Settings → Secrets)

| Secret | Used by | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `.github/workflows/deploy.yml` | Personal access token from supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF_STAGING` | deploy.yml | Set after the staging project exists |
| `SUPABASE_PROJECT_REF_PROD` | deploy.yml | `qksstlqzbhesadrrofgn` |
| `SUPABASE_DB_URL` | `schema-dump.yml` (baseline capture) | Production Postgres connection string, schema dump only |
| `SUPABASE_DB_URL_STAGING` | migration runner | Set after the staging project exists |

## Netlify

| Setting | Value |
|---|---|
| Frontend embedded keys | Supabase anon key ONLY (Build Brief §12). Verified 2026-07-05: no Resend key or `api.resend.com` call in any live page. |
| Deploy contexts | production = main branch; staging/previews = branch deploys (Build step 1) |

## Known config debt

- `clever-api` hardcodes the production `SUPABASE_URL` as a fallback and the
  `ALLOWED_ORIGINS` CORS list as a constant. Until both are env-driven,
  staging must set `SUPABASE_URL` explicitly and CORS for the staging origin
  requires a one-line code change (violates §2.8 — scheduled for step 2, the
  pipeline/config pass).
- `02-schedule-cron.sql` embeds `SCHEDULER_SECRET` in the cron job body;
  rotating that secret requires re-running the cron SQL.
