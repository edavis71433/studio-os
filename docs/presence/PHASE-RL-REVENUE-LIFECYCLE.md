# Phase RL — Revenue Lifecycle & Customer Retention

*Closes FD-R1 🔴 — the last flagged pre-activation cluster. Every lifecycle state now acts, communicates, and behaves honestly. Reuses every existing rail: the `/system/run` cycle, `presence_plan_notices` (the workspace card + its monthly unique key as send-once dedupe), `sendEmail`, Stripe states, entitlements. Consolidates the Revenue-Lifecycle / Subscription / Communication / Retention / Cancellation / Offboarding audits.*

## Step 1 — what the audit verified (never assumed)

| State | Before this phase | Now |
|---|---|---|
| Trial (no card) | **never expired** — status stayed `active` forever past `trial_ends_at` (a real revenue bug) | the sweep lapses it (Stripe-managed trials untouched — Stripe owns those) |
| Trial ending | recorded, **nobody told the customer** | T-3-days notice + email |
| Past due / paused | workspace went read-only **silently** | "a payment didn't go through — **your site is still up**" notice + email |
| Cancelled / lapsed | workspace 403; **site live forever; no story; and `/export` was BLOCKED** (the right-to-leave broke exactly at leaving) | export **always** works (entitlement gate now passes `GET /export` even when denied); wind-down notice + email with the written policy |
| Upgrade / downgrade / plan change | Phase P (immediate/cycle-end + honest upsell) ✅ | unchanged |
| Refund / reactivation | Stripe portal + webhook → entitlement ✅ mechanics | comms = V1.1 (FD-RL1) |

## The lifecycle engine (`commerce/lifecycle.ts`)

Pure, 16/16-tested decision core: `shouldExpireTrial` (no-card + past end → lapse; **never touches Stripe-managed subscriptions**), `lifecycleEventsFor` (state → events; a healthy paying customer generates **zero noise**), and `lifecycleCopy` — one calm voice for both the workspace card and the email, with a test-enforced **honesty contract**: payment trouble must say *the site is still up*; trial end must say *nothing was deleted*; lapse must state the wind-down window and *export-forever*. The runner rides the existing daily `/system/run` cycle (one cron tick now covers operations + scheduled publishes + revenue lifecycle) and dedupes sends through the notices table's `unique(client, kind, period)` — an email goes out only when its notice row is newly inserted. Graceful without `RESEND_KEY` (notices still appear in the workspace). Migration 0055 widens the notice-kind check; the workspace card already renders the new kinds (one-line filter change).

## The written wind-down policy (Step 4 — now a promise, not an accident)

When a subscription ends: **(1)** the workspace pauses (read-only story in the notice), **(2)** the published website **stays live for 60 days** (`WIND_DOWN_DAYS`, stated in the customer's email), **(3)** everything they own is **downloadable at any time — including after lapse** (the export door is now gate-exempt), **(4)** nothing else is deleted; reactivating restores everything as-was, **(5)** parking the site after the window is an operator action with the export reminder already sent — never a silent disappearance. Automated parking + a day-45 reminder = **FD-RL1 (V1.1)**; win-back sequences = **FD-RL2 (V1.1)**.

## Trust review (Step 5) — the direct answers

No surprise billing (Stripe + notices before consequences) ✓ · no hidden deletion (nothing is deleted; the policy says what/when in writing) ✓ · no confusing suspension (paused = read-only *with a reason on screen and in email*) ✓ · no silent expiration (the bug that trials never expired is fixed *and* announced kindly) ✓.

## Testing

lifecycle **16/16** (expiry logic incl. the Stripe-exemption, per-state events, zero-noise-for-healthy, the honesty contract, dedupe period) · deno check + parse clean · migration 0055 applied staging+prod · deployed both envs · live room 38/38 + pipeline 30/30 · `/system/run?task=lifecycle` secret-gate smoke (wrong secret → 403). Full pure sweep green (invariants 14/14).

## Final questions (honest)

- **Would I trust Studio OS with my own subscription?** **Yes, now.** Before this phase, honestly, no — a lapsed customer couldn't take their data and a trial never ended. Both fixed and test-locked.
- **Would customers always understand what's happening?** Yes — every state change now has a workspace card + an email in the same calm voice, each stating what happens next.
- **Silent billing behavior? Confusing lifecycle? Trust gaps?** None remaining that we know of: the three found (silent trial-forever, silent pause, blocked export) are closed; reactivation/refund *comms* are the polite V1.1 tail (mechanics work today via Stripe).
- **Before Owner Activation?** **Nothing.** This was the last engineering gate. The path is now purely: **Owner Activation → Gold Master QA (browser pass) → front door → the push.**

**Phase RL — Revenue Lifecycle & Customer Retention complete.**
