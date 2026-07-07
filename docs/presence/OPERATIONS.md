# L2 — Platform Operations & Commercial Readiness

Makes the architecturally-complete platform **operationally sustainable**: AI cost is protected, the plan ladder is enforced, upgrades provision themselves, and the platform keeps observing with no operator present. Additive only — the Intelligence architecture, the personas, and the pipeline are untouched; L2 wraps them.

---

## 1. Commercial AI strategy

The policy the L1.5 audit called for, now implemented, faithful to constitution Part 5: **the customer never sees a credit, a token, or a cost.** Two orthogonal ideas, both driven by the entitlement — never by hiding UI:

- **Eligibility** — does this plan include this capability at all? *Drafting* (Writer, Editor) belongs to Presence-and-up. Monitor is observational: it watches an existing site and guides, but Studio OS does not draft or publish for it. Enforced at the route with a friendly upgrade 403 (`plan_upgrade_required`).
- **Capacity** — has this customer used more *generative* AI than their plan's generous monthly envelope? A **soft** limit: it never blocks work and never shows a number. It only raises one calm notice.

Assistive AI (rework in voice, polish, alt-text) stays broadly available; analysis (Reviewer, Guardian) and observational guidance (Coach) are available on every plan, Monitor included.

## 2. Capacity model (`commerce/capacity.ts`)

Per-plan generative envelope (operations/month) and drafting eligibility — the one place to tune, deliberately generous:

| Plan | Generative/mo | Can draft? |
|---|---|---|
| Presence Monitor | 15 | no (observational) |
| Presence | 60 | yes |
| Presence Managed | unlimited | yes |
| Agency / Enterprise | pooled (unlimited) | yes |

Operation classes: **generative** (Writer draft, Coach ideas — capacity-bearing), **assistive** (Editor, Concierge — unlimited), **analysis** (Reviewer, Guardian — unlimited). These numbers are proposed defaults; set them from real telemetry.

## 3. Metering (`commerce/metering.ts`, migration 0037)

Every metered AI operation records to an internal rollup + event log, attributed to the customer/workspace — fire-and-forget, so metering never slows or breaks a customer's AI.

- `presence_ai_usage` — the monthly rollup per client (`generative_ops`, `assistive_ops`, token sums). Upserted **atomically** via the `presence_ai_meter()` SECURITY DEFINER function (race-free, unlike read-modify-write over REST).
- `presence_ai_usage_events` — append-only per-call detail (agent, kind, model, tokens) — the substrate for **future reporting, billing, and analytics**.
- The model caller (`writer/model.ts`) now returns token usage (additive, backward-compatible); `meterModel()` wraps the injected ModelFn for Writer/Editor so real tokens are captured. Coach is metered by operation at its route.
- All service-role only. A customer can never read usage.

## 4. The capacity notice — a calm commercial Moment (`presence_plan_notices`)

When a customer consistently reaches their plan's generative envelope, `raiseCapacityNoticeIfNeeded()` upserts **one** notice for the month (unique per client/kind/period). The customer sees a single card in their room — number-free, with exactly three actions: **See plans / Learn more / Dismiss**. It never interrupts work, never appears mid-task, never shows a count.

Architecturally it is **deliberately separate** from `presence_moments`: the intelligence Moments are evidence-grounded (evidence → recommendation → moment, a frozen chain). A capacity notice is *usage*-grounded, so it lives on its own surface and never pollutes the pipeline — honoring "do not modify the Intelligence architecture." Routes: `GET /commerce/notices`, `POST /commerce/notices/dismiss`; rendered by `renderPlanNotice()` in the room.

## 5. Upgrade & downgrade provisioning (`billing-sync` → `provisionForSignup`)

The L1.5 gap is closed. On a subscription lifecycle event that changes the plan such that the **edition** changes, `billing-sync` re-runs the idempotent provisioner:

- **Monitor → Presence (upgrade):** provisions hosting, flips the site to `presence` edition, seeds anything missing — no operator work. Drafting becomes available immediately.
- **Presence → Monitor (downgrade):** flips the edition back but **preserves all data** — nothing is torn down. The Netlify site, content, history, and rollup stay; publishing/drafting capability is removed by the edition + plan gates. Re-upgrading restores capability with the same hosting (idempotent).

Verified live: edition flips both ways, the drafting gate follows, and the site/client rows survive a downgrade.

## 6. Scheduled operations — unattended (`ops/scheduler.ts`, `routes/system.ts`)

The platform keeps observing with no operator present.

- **`POST /system/run`** (secret-gated by `SCHEDULER_SECRET`, no session — handled before principal resolution): runs a **cycle** over active sites (status `ready`/`live` backed by an active entitlement), each site through the same frozen pipeline the operator runs by hand — `runEvidence(site,'schedule')` → judgment → recommendation → moments (+ coach on the weekly sweep). One site's failure never stops another.
- **Retry & recovery:** every unit of work is a `presence_scheduled_runs` row (queued → running → done/failed) with `attempts`/`max_attempts`. `task:'retry'` drains failed runs still under their ceiling and re-runs them — automatic recovery.
- **Bounded per invocation** (least-recently-updated first); *cadence is the scaling knob*.
- **Scheduling** (`supabase/ops/schedule-presence-cron.sql`): pg_cron + pg_net — cycle every 6h, retry hourly, coach weekly. Run once per project with the ref + secret filled in.

## 7. Operational reliability

- **Failure alerts** — a cycle with failures emails the operator (`OPS_ALERT_EMAIL`), best-effort; the failure is always in the ledger regardless.
- **Health monitoring** — `GET /system/health` (secret-gated): secret validation, DB reachability, active-site count, last cycle, failures in the last 24h.
- **Secret validation** — `validateSecrets()` separates required (`SUPABASE_URL`, `SERVICE_ROLE_KEY`, `SCHEDULER_SECRET`) from optional (AI/billing/hosting/email); the platform runs degraded-but-honest without the optional ones.
- **Deploy automation** — `scripts/deploy-presence.ps1 -Env staging|prod` deploys both functions with `supabase-go.exe --no-verify-jwt` and **verifies the "Deployed" confirmation** (a silent half-deploy is the designed-against failure mode), then smoke-tests the catalog.
- **Operational logging** — every scheduled unit and every webhook event is a durable row; structured `console` lines carry `[metering]`, `[stripe-webhook]`, etc.

### Applying a migration (the technique)
Remote migration history only tracks through **0019**; everything 0020+ was applied out-of-band and **0003–0005 are fenced (never apply)**. So `db push` can't be run plainly. To apply one migration: hold every non-target migration out of `supabase/migrations/` into a scratch dir, `db push --yes` (applies only the target), then restore with **absolute paths**. Verify the file count afterward. (0037 was applied to staging + prod this way.)

### Backup & recovery verification (runbook — Supabase-managed)
Point-in-time recovery is a Supabase project setting, not code. **Verify quarterly:** Dashboard → Database → Backups shows PITR enabled and a recent restore point; confirm the retention window meets the ownership promise. **Recovery drill:** clone the project to a scratch instance from a backup and run the test suites against it; confirm `presence_*` tables and the entitlement/usage rows restore intact. Record the date in this file. *(Not automatable from the app; the export right — every customer can download everything they own — is the customer-facing backstop regardless of platform backups.)*

## 8. Extension points

- **New plan capacity** — add a row to `CAPACITY` in `capacity.ts`.
- **New metered agent** — add to `AGENT_CLASS`; wrap its model with `meterModel()` or call `recordUsage()` at its route.
- **New scheduled work** — add a `run_type` and a branch in `runOperationsCycle`/`system.ts`; add a cron line.
- **Billing/reporting on usage** — read `presence_ai_usage` (rollup) or `presence_ai_usage_events` (detail); both are attributed and ready.
- **Notice kinds** — extend the `presence_plan_notices.kind` CHECK (currently just `capacity`).

## 9. Tests

`tests/presence/operations_test.mjs` — 7 pure (capacity policy) + 16 staging-integration: drafting enforcement (Monitor 403 on Writer + Editor), metering rollup + events + token sums, the capacity-notice surface (read + dismiss, number-free), upgrade (edition flip + gate lifted) and downgrade (edition flip back, data preserved), the unattended per-site cycle, the retry-queue predicate, and the `/system` secret gate. Regression: L1 commerce 36+14, room 38/38 — green.
