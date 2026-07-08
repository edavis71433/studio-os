# Phase J (round 2) — Owner Activation Report

*Evidence-based activation: every claim below was verified against the live environments this session (secrets inventory via CLI, the platform's own `/system/health` capability map, live cycle executions, cron job rows). Nothing assumed. Consolidates the Owner-Activation / Production-Readiness / Operational-Verification / Monitoring / Backup-Recovery reports + the Launch Activation Checklist.*

## The headline finding

**Production was already far more activated than the docs believed** — the secrets inventory showed `STRIPE_SECRET` + `STRIPE_WEBHOOK_SECRET`, `RESEND_KEY`, `ANTHROPIC_KEY`, `NETLIFY_AUTH_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`, `CONNECTION_ENC_KEY` all set in prod. The platform's own health check then confirmed it: **9 of 10 capabilities TRUE in production** (platform_boots, purchase_and_billing, stripe_webhooks, email, publishing, scheduled_publishing, one_tap_approvals, ai, connected_platform; only `visual_studio` off — optional `VISUAL_MODEL_KEY`).

## Activated this phase (one at a time, each verified)

| Activation | Evidence |
|---|---|
| **`APPROVAL_SECRET`** set (both envs) — one-tap approvals get a dedicated secret instead of the SCHEDULER fallback | secrets list shows it; health `one_tap_approvals: true` |
| **`SCHEDULER_SECRET` rotated** (both envs) — required to verify the ops surface with evidence; stored in **Vault** (`presence_scheduler_secret`) in both projects | health 200 with the new secret; wrong secret → **403** (failure test) |
| **The full operational cycle executed live** on staging AND prod — observations→judgment→recommendation→moments + scheduled-publish check + the Phase-RL lifecycle sweep in one tick | staging: `{ran:1, steps all true, lifecycle:{...}}`; prod: clean run, 0 failures |
| **⏰ CRON SCHEDULED — the big one** — `presence-cycle` every 15 minutes via pg_cron + pg_net on **both projects**, secret pulled from Vault at call time (never stored in job text or the repo) | `cron.job` rows (active=true, `*/15 * * * *`) both envs; the exact cron command fired once → **HTTP 200 with a real cycle result** in `net._http_response` |

With cron live, the platform now runs itself: observation cycles, scheduled publishes (15-minute granularity), retries, and the revenue-lifecycle sweep — unattended.

## Operational verification (Step 3) — evidence per system

Billing/plans: prod `/commerce/plans` 200 with support tiers ✓ (Phase P smoke). Lifecycle: sweep ran on prod (0 due — correct; no trials exist) ✓. Scheduled publishing: engine verified live earlier (staging pipeline 30/30) + cron now fires it ✓. Rollback/restore/exports/forms/CRM/Moments: live room 38/38 + pipeline 30/30 on the deployed function ✓. Monitoring: `/system/health` is the platform's own monitor; **external alerting remains owner** (FD-S2). Email delivery: RESEND_KEY present + `email: true`; **deliverability depends on the domain verification below**.

## Failure testing (Step 4)

Wrong cron secret → 403 ✓ · limiter fail-open + 429 trip verified in Phase S ✓ · email-absent no-op + Stripe-absent honest errors are test-locked degradations (activation makes them moot) ✓ · restore = the 1-click snapshot path (live-tested all session) ✓ · **PITR restore drill: cannot be verified from here — dashboard-only, remains on your list.**

## What remains — the owner console list (exact, short)

1. ✅ **DONE (with the owner, live)** — Stripe: key verified via API (live, account fully activated: charges+payouts enabled), set in prod; webhook endpoint updated to 6/6 events incl. customer.subscription.created. ~~confirm the prod key is live-mode~~ (`sk_live_…` — the health check can't see mode) and that the Stripe dashboard has a webhook endpoint → `https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/commerce/webhook` with events `checkout.session.completed` + `customer.subscription.*`, and that its signing secret matches the `STRIPE_WEBHOOK_SECRET` already set.
2. ✅ **DONE (with the owner, live)** — Resend: domain was ALREADY VERIFIED; real test emails delivered (ids 1a00d5e7…, 838cfcb5…); EMAIL_FROM="Studio OS <hello@davisdigitalstudio.com>" + OPS_ALERT_EMAIL=eric@davisdigitalstudio.com set. ~~verify your sending domain~~ (add the SPF + DKIM records Resend shows — the Foundations plan flow can help once live). Optionally set `EMAIL_FROM` (e.g. `hello@davisdigitalstudio.com`) and `OPS_ALERT_EMAIL`. **The Phase-RL lifecycle emails ride on this.**
3. 🟢 **DECIDED (owner, Jul 8 2026)** — PITR deferred until the first paying cohort (verified evidence: daily physical backups COMPLETED 8/8 days on prod; per-publish content snapshots already give sites RPO≈0). **Trigger to enable: the week real customers start paying** (~$100/mo, prod project → Database → Backups → Point in Time). Remaining 5-min owner click: the practice restore on STAGING (pick yesterday's backup → Restore → watch it complete).
4. ✅ **DONE — cross-project watchdog built & verified**: STAGING (Ohio) checks PROD (Oregon) `/system/health` every 5 minutes via pg_cron + pg_net; on failure (or 30 min without a confirmed-healthy) it emails eric@davisdigitalstudio.com via Resend (max one alert per 6h). Region-separated, no external account. Verified live: probe fired ✓ prod-healthy recorded ✓ no false alarm ✓. An UptimeRobot-class external monitor remains an optional belt-and-suspenders (FD-S2 note).
5. ✅ **DONE (owner, Jul 8 2026)** — `https://davisdigitalstudio.com/connections-callback.html` added to the OAuth client's Authorized redirect URIs (screenshot-verified: "OAuth client saved"). Note for launch week: if the consent screen is still in "Testing", publish it before real customers connect Google Business Profiles.
6. **The go-live push** — the frontend commits (the gate you hold).

## Final questions (honest)

- **Trust this production environment with paying customers?** **Yes, operationally** — with items 1–3 above confirmed. The engine, gates, degradations, comms, and now the unattended loop are verified live.
- **Every production dependency active?** 9/10 capabilities true + cron live. Not active: `visual_studio` (optional key), external alerting, PITR confirmation, and the *deliverability* half of email — all yours, all listed.
- **Activate launch today?** **No — by design**: launch also needs the human browser pass (Phase K) and the front door (Phase H). But for the first time, **nothing on the launch path is engineering or platform-operations work.**

**Phase J — Owner Activation complete.**
