# Environment & Secrets — Studio OS Presence (current)

The source of truth for **which** configuration exists is the `Deno.env.get(...)` calls in the deployed function; this doc enumerates them for V1. **Values live only in the Supabase / Netlify / Stripe dashboards — never in this repo.** Staging and production run **identical code**; only these values differ.

Supersedes `docs/SECRETS-INVENTORY.md` (which predates the Connected Platform and Visual Studio).

## Presence function secrets (Supabase → Edge Functions → Secrets)

| Variable | Purpose | Required? | Notes |
|---|---|---|---|
| `SUPABASE_URL` | PostgREST/auth base | **yes** | Code falls back to the prod URL — **staging MUST set it explicitly** |
| `SERVICE_ROLE_KEY` | privileged DB/auth (svc) | **yes** | Alias accepted: `SUPABASE_SERVICE_ROLE_KEY`. Rotate ~90d |
| `ANON_KEY` | RLS-scoped caller reads | **yes** | Alias: `SUPABASE_ANON_KEY` |
| `SCHEDULER_SECRET` | gates `/system/*` cron endpoints | **yes** (for the unattended cycle) | Also embedded in the pg_cron job body — rotate both together |
| `RESEND_KEY` | outbound email | yes (email on) | via `EMAIL_FROM` sender |
| `EMAIL_FROM` | sender identity | yes (email on) | |
| `OPS_ALERT_EMAIL` | failure alerts | recommended | a cycle with failures emails here |
| `ANTHROPIC_KEY` | **all AI drafting** (Writer/Editor/Coach/Concierge polish) | **activation** | absent → AI features honestly unavailable; manual parity means the app still works |
| `CONCIERGE_POLISH` | optional concierge polish toggle | optional | |
| `CONNECTION_ENC_KEY` | AES-256-GCM key for provider tokens | **activation** (Connected) | 44-char base64. Absent → connections fail closed (never plaintext) |
| `STATE_SIGNING_SECRET` | legacy HMAC secret — `clever-api` OAuth state, and a **fallback** in the preview-link / approval-link signing chains | optional | **NOT used by the Connected Platform**: `connected/auth.ts` seals OAuth state with `CONNECTION_ENC_KEY`. Falls back to `SCHEDULER_SECRET` where it is used |
| `VISUAL_MODEL_KEY` | **AI Visual Studio** image model | **activation** (Visual) | absent → generation honestly "not switched on"; upload still works |
| `VISUAL_MODEL_URL` | image endpoint override | optional | default OpenAI images |
| `VISUAL_MODEL_NAME` | image model name override | optional | default `gpt-image-1` |
| `STRIPE_SECRET` | checkout + subscriptions | **activation** (billing) | **TEST key on staging, always** |
| `SITE_URL` | Stripe success/cancel + connect redirect base | yes | staging: the staging/preview URL |
| `BILLING_SYNC_SECRET` | gates the Stripe webhook sync tier | recommended | |
| `NETLIFY_AUTH_TOKEN` | site publish/deploy | yes (publish) | rotation runbook exists |
| Per-provider OAuth: `CONNECTED_<PROVIDER_KEY>_CLIENT_ID` / `_SECRET` (e.g. `CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID`), `CONNECTED_<KEY>_WRITE=1` | per connected provider | **activation** (per provider) | These are the ONLY names `connected/auth.ts` reads (`creds()`). `GOOGLE_CLIENT_ID`/`_SECRET` are **not** read by the Connected Platform — setting them activates nothing. Absent → that provider honestly reports what is missing |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | **Web Push** (device notifications) | **activation** (push) | base64url raw P-256 point / scalar. Absent → push cleanly off (`/push/key` reports disabled) |
| `VAPID_SUBJECT` | push contact (`mailto:`/`https:`) | optional | defaults to support@davisdigitalstudio.com |
| `RESEND_WEBHOOK_SECRET` | Resend bounce/complaint webhook (`/email/events`, svix) | recommended (email on) | absent → the endpoint 404s (surface doesn't exist); bounces then don't auto-suppress |

## Required vs Activation

- **Required to run at all:** `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `ANON_KEY`, `SCHEDULER_SECRET`. The platform runs **degraded-but-honest** without the optional ones (`validateSecrets()` separates them).
- **Activation (turns a complete feature live):** `ANTHROPIC_KEY` (AI), `CONNECTION_ENC_KEY` + provider OAuth apps (Connected), `VISUAL_MODEL_KEY` (Visual), `STRIPE_SECRET` + Stripe config (billing), `NETLIFY_AUTH_TOKEN` (publish). Each is dark-but-honest until set. See [Owner Activation Checklist](RELEASE-NOTES.md#owner-activation-checklist).

## Environments

| | Staging | Production |
|---|---|---|
| Project ref | `wjlpursnwbmlcdwbeowv` | `qksstlqzbhesadrrofgn` |
| Stripe | TEST keys | LIVE keys |
| Purpose | verification, integration tests | live customers |

Fetch keys for an environment: `supabase-go.exe projects api-keys --project-ref <ref>`.

## Rules

- Deployment variance is **config-only** — never fork code per environment.
- Never commit a secret. Rotate on the cadence above or on any incident. A leaked temp password/key is treated as burned.
- After setting an activation key, run the smoke test for that feature (see [Production Activation Checklist](RELEASE-NOTES.md#production-activation-checklist)).
