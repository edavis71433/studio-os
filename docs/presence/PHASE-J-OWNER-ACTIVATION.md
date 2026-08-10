# Phase J — Owner Activation: Production Readiness Report

*Activates the platform's side of every production dependency and proves it degrades gracefully — then hands the owner a precise, verifiable checklist for the credential steps only they can perform. Honest boundary: I cannot create your Stripe/Resend/Google accounts or enter live keys; I made activation possible, safe, self-verifying, and documented.*

---

## Executive summary

The `presence` function is deployed to staging + prod and **every production dependency degrades gracefully or fails closed** when its secret is absent — nothing crashes, nothing fakes success. This milestone added a **live activation dashboard** (`/system/health` now reports every secret grouped by capability + a derived "what's live right now" map) so activation is verifiable in one call, locked it with a test (10/10), and produced the Owner Activation Guide + checklist + runbook. **The remaining work is genuine owner action** — set the live credentials (Stripe, Resend, Netlify, APPROVAL_SECRET, Google OAuth), schedule the cron, verify PITR, and cross the go-live push. Those are documented as blockers, not hidden. Until they're done, **a stranger cannot yet transact** — honestly stated below.

---

## Step 1 — Discovery: production dependency inventory

All secrets the `presence` function reads, grouped by what they activate (full detail in [OWNER-ACTIVATION-GUIDE](OWNER-ACTIVATION-GUIDE.md)):

| Group | Secrets | Status (as of this engineering pass) |
|---|---|---|
| **Core** (required) | `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SCHEDULER_SECRET` | **Configured** — verified: `/commerce/plans` returns 200 (core is up). |
| **Commerce** | `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `BILLING_SYNC_SECRET` | **Owner-required** — verify via `capabilities.purchase_and_billing`. |
| **Email** | `RESEND_KEY`, `EMAIL_FROM`, `OPS_ALERT_EMAIL` | **Owner-required** — verify via `capabilities.email`. |
| **Hosting** | `NETLIFY_AUTH_TOKEN` | **Owner-required** — verify via `capabilities.publishing`. |
| **Approvals** | `APPROVAL_SECRET` (→ `SCHEDULER_SECRET` fallback) | **Owner-required** — verify via `capabilities.one_tap_approvals`. |
| **Connected** | `CONNECTION_ENC_KEY`, plus a provider pair `CONNECTED_<PROVIDER_KEY>_CLIENT_ID`/`_SECRET` (today: `CONNECTED_GOOGLE_SEARCH_CONSOLE_*`), and `SITE_URL` for the redirect URI | **Owner-required** (fail-closed) — verify via `capabilities.connected_platform`. `GOOGLE_CLIENT_ID/SECRET` and `STATE_SIGNING_SECRET` were listed here in error: no connected-platform code reads them, and the health check used to report activation from them (fixed). |
| **AI** | `ANTHROPIC_KEY`, `VISUAL_MODEL_KEY/URL/NAME` | **Owner-required** — verify via `capabilities.ai` / `visual_studio`. |
| **Cron** | (a scheduler calling `/system/run`) | **Owner-required** — verify via `data.last_cycle` advancing. |
| **Backups** | Supabase PITR + restore drill | **Owner-required** (dashboard setting). |

*I cannot read the live secret values without `SCHEDULER_SECRET`, so "owner-required" means "you set it and confirm via the dashboard" — the dashboard exists precisely so this is a one-call check, not guesswork.*

---

## Step 2 — What was activated (engineering side)

- **The activation dashboard** — `validateSecrets()` rebuilt into a grouped inventory (8 capability groups, every secret with `required`/`enables`/`present`) + a **derived capability map** (`purchase_and_billing`, `email`, `publishing`, `one_tap_approvals`, `ai`, `visual_studio`, `connected_platform`, …). Surfaced by `/system/health`. This is the owner's activation source of truth.
- **Deployed** to staging + prod; health remains secret-gated (403 without the secret) — verified.
- **Locked** by `activation_test.mjs` (10/10): the dashboard reports every group, never falsely claims "activated" in a clean env, and documents the one-tap `SCHEDULER_SECRET` fallback.

*I did not — and cannot — enter live credentials; that is Step-2 owner work, now a one-sitting checklist.*

---

## Step 3 — Production validation

Each capability's readiness is **verifiable the moment the owner sets its secret** via the dashboard flag. The underlying flows are already tested + deployed (Phases A–M): publishing/preview/rollback/restore (room 38/38, pipeline 30/30 in isolation), scheduling + leads + one-tap (commercial 25/25), billing/subscriptions/licensing (commerce 38/38 + 13/13 integration), CRM (24/24), Developer Mode (41/41). Activation flips them from "tested" to "live" without code change.

---

## Step 4 — Failure testing (graceful degradation — verified in code)

| Dependency missing / failing | Behavior | Customer experience |
|---|---|---|
| **Email (RESEND_KEY)** | `sendEmail` returns false + logs; callers non-blocking | No email sent; the in-app action still succeeds. No error shown. |
| **Stripe (STRIPE_SECRET)** | checkout returns "billing unavailable" 503; account still created | Clear "checkout isn't available on this environment" — not a crash. |
| **Hosting (NETLIFY_AUTH_TOKEN)** | publish fails with a config error; live site untouched | "We hit a snag — nothing changed on your live site." |
| **One-tap (APPROVAL_SECRET)** | `/approve/send` returns 503 "not configured" | Clear message; approvals still work in-app. |
| **Connected token encryption (CONNECTION_ENC_KEY)** | **fail-closed** — token storage refused | Connection can't be saved insecurely — safe by default. |
| **OAuth state (sealed with `CONNECTION_ENC_KEY`)** | state verification fails with a clear message | "That connection couldn't be verified" — no silent bypass. |
| **AI (ANTHROPIC_KEY)** | honest `ai_unavailable` (200), never filler | "AI unavailable right now" — deterministic fallbacks where they exist. |
| **Cron stops** | scheduled publishes simply don't fire; recorded as still-pending | Nothing lost; fires when cron resumes. |
| **Provider disconnects / API limits** | connected reads return honest "unavailable"; writes stay approval-gated | Calm "couldn't refresh just now." |
| **Core secret missing** | `/system/health.ok = false`; platform refuses rather than half-run | Fails visibly to the operator, not silently to the customer. |

**No missing dependency produces a confusing customer experience** — the platform was built to degrade honestly (or fail closed for security).

---

## Step 5 — Security review

- **Environment separation:** distinct staging (`wjlpursnwbmlcdwbeowv`) and prod (`qksstlqzbhesadrrofgn`) projects; secrets set per-project; no shared runtime.
- **Least privilege:** service role used only for system-table reads (never exposed to clients); caller-JWT + RLS for tenant data; connected tokens encrypted at rest (fail-closed).
- **Secret gating:** `/system/health` + `/system/run` require `SCHEDULER_SECRET`; billing-sync requires its secret; one-tap tokens are HMAC-signed with expiry.
- **Audit trails:** append-only change/connection ledgers; publish ledger; scheduled-run ledger; every one-tap decision writes a change event.
- **Recovery:** versioned publishes + PITR + the export backstop.
- **Owner security actions (documented):** rotate the Netlify token / anything shown in chat; run the `svc()` id-scope audit (roadmap Phase S) before scaling.

---

## Documentation produced

- **[OWNER-ACTIVATION-GUIDE](OWNER-ACTIVATION-GUIDE.md)** — per-secret what/why/where-to-get/verify + the Activation Checklist + cron + the go-live push.
- **This report** — Production Readiness + discovery + failure testing + security.
- **[DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md)** — the existing Production Runbook + Disaster Recovery + migrations/rollback (referenced, not duplicated).

---

## Feature discovery

- **FD-J1 · Public activation status badge for the operator** — surface the health `capabilities` map in the admin UI so the operator sees green/red without curling. *V1.1 · Low.*
- **FD-J2 · Startup secret self-check log line** — on cold start, log which optional capabilities are off (aids activation debugging). *V1.1 · trivial.*

---

## Final Questions — answered honestly

*"Today" = as of this engineering pass, before the owner enters live credentials and pushes.*

- **Can a stranger become a customer today?** **Not yet.** The signup + account creation path is live, but purchase requires the owner's live Stripe key, and the customer-facing frontend is unpushed. Both are owner actions, both are one-sitting.
- **Can they purchase?** **Only once `STRIPE_SECRET` (live) + the webhook are set** — verifiable via `capabilities.purchase_and_billing`. The code path is tested and ready.
- **Can they receive email?** **Only once `RESEND_KEY` is set** — until then, email silently no-ops (by design).
- **Can they publish?** **Only once `NETLIFY_AUTH_TOKEN` is set.**
- **Can they schedule?** **Yes to create a scheduled publish; it only *fires* once cron calls `/system/run`.**
- **Can they restore?** **Yes** — restore/rollback need no external secret; live now.
- **Can they receive approvals?** **In-app yes; one-tap emails once `APPROVAL_SECRET` + `RESEND_KEY` are set.**
- **Can they manage billing?** **Once Stripe is live** — the billing portal is wired.
- **Can the operator support them?** **Yes** — CRM + `/system/health` (now a full dashboard) + the scheduler ledger are live.
- **Would you personally trust this production environment?** **Yes on the engineering** — it fails soft or fails closed, separates environments, encrypts secrets, and is now self-verifying. **The trust gap is operational, not architectural:** it isn't fully activated, and PITR + a restore drill + secret rotation should be confirmed before real money flows.

### Production blockers (documented — all owner-action, none engineering)

1. **Live credentials not yet entered** — Stripe, Resend, Netlify, APPROVAL_SECRET, Google OAuth. *(I cannot access your accounts.)*
2. **Cron not scheduled** — scheduled publishes won't fire until something calls `/system/run`.
3. **PITR + a recorded restore drill** — confirm before launch.
4. **The go-live push** — the frontend is unpublished behind the go-live gate.

---

## Honest declaration

The **platform side of owner activation is complete**: every dependency is inventoried, degrades gracefully or fails closed, is verifiable via a live dashboard, and is documented with a one-sitting checklist. The **owner side is not done and cannot be done by me** — the four blockers above are yours to clear, and they are documented, not hidden. I am **not** claiming a stranger can buy today; they cannot until those steps land.

With that scope stated plainly:

**Phase J — Owner Activation complete** *(engineering + tooling + documentation; owner credential/push steps remain and are documented as production blockers).*
