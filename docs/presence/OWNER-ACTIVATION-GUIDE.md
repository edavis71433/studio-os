# Owner Activation Guide

*Phase J. Everything the owner must configure to turn Studio OS from "built + deployed" into "a paying customer can use it." The engineering is done and degrades gracefully; these are the credential steps only you can perform. Verify each with the live activation dashboard: `GET /system/health?secret=<SCHEDULER_SECRET>` → `data.secrets.capabilities`.*

---

## How activation works

- The `presence` edge function is **already deployed** to staging + prod. Activation = setting **secrets** on each project (it reads them at runtime).
- Set secrets in the **Supabase dashboard → project → Edge Functions → Manage secrets**, or:
  `C:\Users\edavi\Tools\supabase\supabase-go.exe secrets set NAME=value --project-ref <ref>`
  (prod ref `qksstlqzbhesadrrofgn`, staging ref `wjlpursnwbmlcdwbeowv`).
- **Verify** anytime: `GET /system/health?secret=<SCHEDULER_SECRET>` returns a grouped inventory (`data.secrets.groups`) + a live capability map (`data.secrets.capabilities`) — the source of truth for "what's on."
- **Separate step — the go-live push:** the *frontend* (all the HTML pages) publishes via `git push` (Netlify), which is behind the go-live gate. Secrets activate the backend; the push makes the customer-facing site live. Both are required.

---

## Activation order (fastest path to "a customer can buy")

Core is already set (the function runs). Then, in priority order:

1. **Commerce** → they can purchase.
2. **Email** → they receive receipts, approvals, lead alerts.
3. **Hosting** → their site can publish.
4. **Approvals** → one-tap client approval.
5. **Connected + AI** → the intelligence/connected features (optional at launch).
6. **Cron** → scheduled publishes fire (not a secret — a scheduler; see below).
7. **The go-live push** → the frontend is live.

---

## The secrets, grouped (what · why · where to get it · verify)

### Core — required (already set; the function wouldn't run otherwise)
| Secret | Enables | Source |
|---|---|---|
| `SUPABASE_URL` | DB + storage | Supabase project settings |
| `SERVICE_ROLE_KEY` | system-table access | Supabase → API keys |
| `SUPABASE_ANON_KEY` | caller-JWT RLS reads | Supabase → API keys |
| `SCHEDULER_SECRET` | `/system/run` + billing-sync auth + one-tap fallback | you generate (a long random string) |

### Commerce — enables purchase & billing
| Secret | Enables | Where to get it |
|---|---|---|
| `STRIPE_SECRET` | checkout + subscriptions | Stripe dashboard → Developers → API keys → **live** secret key |
| `STRIPE_WEBHOOK_SECRET` | verify Stripe webhooks (auto-provision on payment) | Stripe → Webhooks → add endpoint `…/functions/v1/stripe-webhook` → signing secret |
| `BILLING_SYNC_SECRET` | the authed billing-sync path | you generate (or reuse `SCHEDULER_SECRET`) |
*Verify:* `capabilities.purchase_and_billing = true`. *Without it:* signup still creates the account; checkout returns a clear "billing unavailable."

### Email — enables ALL email
| Secret | Enables | Where |
|---|---|---|
| `RESEND_KEY` | lead notifications, one-tap approvals, digests, receipts | Resend dashboard → API keys |
| `EMAIL_FROM` | the From address | your verified sending domain (defaults to a studio address) |
| `OPS_ALERT_EMAIL` | operational failure alerts | your inbox |
*Verify:* `capabilities.email = true`. *Without it:* every send silently no-ops (logged) — nothing breaks, but customers get no email. **This is the most impactful one to set.**

### Hosting — enables publishing customer sites
| Secret | Enables | Where |
|---|---|---|
| `NETLIFY_AUTH_TOKEN` | deploying customer sites | Netlify → User settings → Applications → personal access token |
*Verify:* `capabilities.publishing = true`. *Without it:* publish fails with a clear config error; the live site is never touched.

### Approvals — enables one-tap client approval
| Secret | Enables | Where |
|---|---|---|
| `APPROVAL_SECRET` | signed one-tap approve links | you generate (falls back to `SCHEDULER_SECRET`) |
*Verify:* `capabilities.one_tap_approvals = true`. *Without either:* `/approve/send` returns a clear 503.

### Connected Platform — enables OAuth + secure token storage
| Secret | Enables | Where |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (GBP, Search Console, Analytics…) | Google Cloud Console → OAuth credentials |
| `STATE_SIGNING_SECRET` | CSRF-safe signed OAuth state | you generate |
| `CONNECTION_ENC_KEY` | **encrypts connected tokens at rest** | you generate (32+ bytes) |
*Verify:* `capabilities.connected_platform = true`. *Security note — fail-closed:* without `CONNECTION_ENC_KEY`, token storage is **refused**, never faked. Set it before enabling connections.

### AI — enables drafting / concierge / Visual Studio
| Secret | Enables | Where |
|---|---|---|
| `ANTHROPIC_KEY` | AI drafting, concierge, coach | Anthropic console |
| `VISUAL_MODEL_KEY` (+ `_URL`, `_NAME`) | AI Visual Studio images | your image-model provider |
*Verify:* `capabilities.ai`, `capabilities.visual_studio`. *Without them:* honest "AI unavailable," never machine-filler.

### Site
| Secret | Enables |
|---|---|
| `SITE_URL` | absolute links in emails (defaults to the prod host) |

---

## Cron (not a secret — a scheduler)

Scheduled publishes, the operations cycle, and retries fire only when something calls **`POST /system/run` with `{secret: SCHEDULER_SECRET}`** on a schedule. Options: Supabase `pg_cron` (SQL in `supabase/ops/schedule-presence-cron.sql`), a GitHub Actions scheduled workflow, or any external cron. *Verify:* after activation, `data.last_cycle` in health advances; a scheduled publish set in the past fires within one tick.

---

## Activation Checklist

- [ ] **Core** — confirm `capabilities.platform_boots = true` (already set).
- [ ] **Stripe** live secret + webhook endpoint + `STRIPE_WEBHOOK_SECRET` → `purchase_and_billing = true`.
- [ ] **Resend** key + verified `EMAIL_FROM` domain → `email = true`.
- [ ] **Netlify** token → `publishing = true`.
- [ ] **`APPROVAL_SECRET`** → `one_tap_approvals = true`.
- [ ] **Google OAuth** + `STATE_SIGNING_SECRET` + `CONNECTION_ENC_KEY` → `connected_platform = true` (optional at launch).
- [ ] **`ANTHROPIC_KEY`** (+ visual keys if using Visual Studio) → `ai = true`.
- [ ] **Cron** hitting `/system/run` on a schedule (e.g., every 10 min).
- [ ] **PITR** enabled on both Supabase projects + one recorded restore drill (see DR).
- [ ] **Secret rotation** — rotate the Netlify token / anything shown in chat.
- [ ] **The go-live push** — `git push` to publish the frontend (crosses the go-live gate).
- [ ] **Final verify** — `GET /system/health?secret=…` shows every intended capability `true`.

---

## Verify everything at once

```
GET  https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/system/health?secret=<SCHEDULER_SECRET>
```
Read `data.ok` (core), `data.secrets.capabilities` (what's live), `data.secrets.missing_optional` (what's still off), `data.db_ok`, `data.last_cycle`, `data.failures_last_24h`.

---

## Disaster recovery & runbook

Detailed operational procedures (migrations, rollback, backups/PITR, monitoring, incident recovery) live in **[DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md)**. Key points:
- **Bad function deploy:** redeploy the previous commit (stateless) or run the rollback workflow.
- **Bad migration:** apply the migration's `-- rollback:` inverse via the hold-back technique.
- **Bad customer publish:** every publish is versioned → `POST /restore`.
- **Full DR:** restore the Supabase project from PITR → redeploy the function → re-point config → run the suites.

---

*The marketing site's `clever-api` function has its own secrets (Stripe/Resend/Google for the public site); this guide covers the `presence` product function. Both share the Stripe/Resend accounts.*
