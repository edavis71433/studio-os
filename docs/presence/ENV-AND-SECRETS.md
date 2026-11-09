# Environment & Secrets — Studio OS Presence (current)

The source of truth for **which** configuration exists is the `Deno.env.get(...)` calls in the deployed function; this doc enumerates them for V1. **Values live only in the Supabase / Netlify / Stripe dashboards — never in this repo.** Staging and production run **identical code**; only these values differ.

Supersedes `docs/SECRETS-INVENTORY.md` (which predates the Connected Platform and Visual Studio).

## Presence function secrets (Supabase → Edge Functions → Secrets)

| Variable | Purpose | Required? | Notes |
|---|---|---|---|
| `SUPABASE_URL` | PostgREST/auth base | **yes** | Code falls back to the prod URL — **staging MUST set it explicitly** |
| `SERVICE_ROLE_KEY` | privileged DB/auth (svc) | **yes** | Alias accepted: `SUPABASE_SERVICE_ROLE_KEY`. Rotate ~90d |
| `ANON_KEY` | RLS-scoped caller reads | **yes** | Alias: `SUPABASE_ANON_KEY` |
| `SCHEDULER_SECRET` | gates `/system/*` cron endpoints | **yes** (for the unattended cycle) | The pg_cron jobs read a copy from Vault (`presence_scheduler_secret`) when they run and send it in the request body. After a rotation, update that entry on the same project, and for production also staging's `watchdog_target_secret` |
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
| `REPLICATE_API_TOKEN` | the photo editor's **Cut out the subject** (Replicate, open model pinned in `lib/cutout.ts`) | optional | absent → the button doesn't show; the free plain-background tool still works. About $0.0004 a photo; Replicate deletes inputs and outputs after an hour |
| `STRIPE_SECRET` | checkout + subscriptions | **activation** (billing) | **TEST key on staging, always** |
| `SITE_URL` | Stripe success/cancel + connect redirect base | yes | staging: the staging/preview URL |
| `BILLING_SYNC_SECRET` | gates the Stripe webhook sync tier | recommended | |
| `NETLIFY_AUTH_TOKEN` | site publish/deploy | yes (publish) | rotation runbook exists |
| Per-provider OAuth: `CONNECTED_<PROVIDER_KEY>_CLIENT_ID` / `_SECRET` (e.g. `CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID`), `CONNECTED_<KEY>_WRITE=1` | per connected provider | **activation** (per provider) | These are the ONLY names `connected/auth.ts` reads (`creds()`). `GOOGLE_CLIENT_ID`/`_SECRET` are **not** read by the Connected Platform — setting them activates nothing. Absent → that provider honestly reports what is missing |
| `CONNECTED_GOOGLE_ANALYTICS_CLIENT_ID` / `_SECRET` | Google Analytics (GA4) reads | **activation** (Connected) | The **same Google Cloud app** as Search Console works — reuse its client id/secret or mint a second OAuth client on the same project. That project must additionally have the **Google Analytics Data API** and **Google Analytics Admin API** enabled, and the consent screen must carry the `https://www.googleapis.com/auth/analytics.readonly` scope. Daily sync: pg_cron `presence_ga4_sync` → `/system/run` task `ga4_sync` |
| `CONNECTED_GOOGLE_BUSINESS_PROFILE_CLIENT_ID` / `_SECRET` | Google Business Profile (listing) reads | **activation** (Connected) | The same Google Cloud app as Search Console works. Needs Google's API access approval first; quota stays at zero until then. Steps in `runbooks/google-connections.md`. |
| `APP_URL` | the app's own address: the OAuth return page and the "connect your Google" email link | optional | Defaults to `https://app.davisdigitalstudio.com`. Deliberately not `SITE_URL`: the marketing domain's redirect to the app drops the query string, so an OAuth `?code=` never arrives. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | **Web Push** (device notifications) | **activation** (push) | base64url raw P-256 point / scalar. Absent → push cleanly off (`/push/key` reports disabled) |
| `VAPID_SUBJECT` | push contact (`mailto:`/`https:`) | optional | defaults to support@davisdigitalstudio.com |
| `RESEND_WEBHOOK_SECRET` | Resend bounce/complaint webhook (`/email/events`, svix) | recommended (email on) | absent → the endpoint 404s (surface doesn't exist); bounces then don't auto-suppress |
| `RESEND_INBOUND_SECRET` | checks that an email reply coming in is really from Resend (svix) | optional (replies) | absent → the reply webhook 404s and replies never reach the Inbox |
| `RESEND_INBOUND_DOMAIN` | the reply address domain that brings customers' replies into the Inbox | optional (replies) | absent → replies go to the sender's own mailbox |
| `PLATFORM_REPLY_TO` | the reply-to address on the platform's own mail | optional | defaults to the studio's address |
| `AGENCY_SITE_ID` | the platform's own agency site, the only site whose owner alerts may fall back to `OPS_ALERT_EMAIL` | optional | absent → that fallback doesn't exist and the alert is skipped, the safe default |
| `NURTURE_DRIP` | switches on the day-7 follow-up email after a free review | optional | set to `1` to turn it on |
| `APPROVAL_SECRET` | signs one-tap client approval links and the sales pages' signed links | recommended | falls back to `SCHEDULER_SECRET` |
| `PREVIEW_LINK_SECRET` | signs shared draft links | optional | falls back to `APPROVAL_SECRET`, then `STATE_SIGNING_SECRET`, then `SCHEDULER_SECRET` |
| `OPERATOR_SECRET` | lets a program act as the operator (the `x-operator-secret` header) for marketplace and enterprise management | optional | absent → only a signed-in staff member can do those |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | managed domains: DNS run on Amazon Route 53 (`lib/route53.ts`) | optional (domains) | both needed; absent → those routes answer 503 |
| `PEXELS_API_KEY` | the stock photo search (Pexels) | optional | absent → the stock search is off |
| `HELP_POLISH` | switches on AI polish of the help answers | optional | set to `on`; off by default |
| `VISITS_SALT` | salts the visit counter's visitor fingerprints | optional | falls back to `APPROVAL_SECRET` |
| `TURNSTILE_SECRET` | the free tools' bot check (Cloudflare Turnstile) | **activation** (free tools) | absent → every free scan is refused as unverified |
| `TOOLS_HASH_SALT` | salts the free tools' visitor counters | optional | falls back to the service key |

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
