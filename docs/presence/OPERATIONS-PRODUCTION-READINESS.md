# Version 1 — Operations & Production Readiness Review

*Independent SRE/DevOps/Platform review. Verification + documentation only — nothing was changed or fixed. Every statement is grounded in the codebase and infrastructure config. Findings are documented, not remediated (per milestone scope).*

---

## 1. Executive Summary

Studio OS Presence is **operable in production today**, with strong correctness-and-safety fundamentals but **thin day-2 observability**. The core is well-built: idempotent provisioning, an atomic single-winner execution claim, approval-gated external changes, a signature-verified idempotent Stripe webhook, timeouts on every external call, failure-isolated engines, versioned publishing with restore, a complete export backstop, and honest degradation (fail-closed crypto, required-vs-optional secret validation). Deployment is repeatable and documented, with a confirmation-gated production step and a post-deploy smoke test.

The gaps are **operational maturity, not correctness**: there is **no active uptime/health monitoring or error-spike alerting** (the only alert path is an email when the scheduled cycle has failures); the **`presence` function is deployed manually and is not covered by the CI pipeline** (which still deploys the legacy `clever-api`), so there is **no automated pre-deploy test gate**; the **pg_cron unattended cycle's installation in production is unconfirmed** (and it is the *only* thing that would surface failures by email); there is **no application-level rate limiting** and **no request correlation IDs**; and **backups are Supabase-managed with no failure alert and no recorded recovery drill**.

**Verdict:** safe for a **supervised** launch by someone who knows the runbooks. For unsupervised, enterprise-grade operation, close the monitoring/alerting and CI-test-gate gaps in the Infrastructure Risk Register below. None is a code defect; all are documented for the operations backlog.

---

## 2. Production Architecture Review

- **Runtime:** one Supabase Edge Function `presence` (Deno/TS) over Postgres (RLS) + Storage; a second function `stripe-webhook` for billing. Static frontend on Netlify.
- **Environments:** production `qksstlqzbhesadrrofgn`, staging `wjlpursnwbmlcdwbeowv` — **config-only** variance, verified (same code, different secrets). Good separation.
- **Production isolation:** separate Supabase projects; separate Stripe keys (TEST on staging); deny-all RLS per workspace. Strong.
- **Service dependencies:** Supabase (DB/storage/functions), Netlify (site hosting), Stripe (payments), Resend (email), and activation-gated Anthropic (AI), image model (Visual), Google/providers (Connected). Each external call is timeout-bounded and failure-isolated.
- **Statelessness:** the function is stateless; state lives in Postgres/Storage — so scaling and rollback are straightforward (redeploy).

## 3. Deployment Review

- **CI/CD (`.github/workflows/deploy.yml`):** deploys **`clever-api` + `stripe-webhook`** — staging auto on push to `staging`; production via manual `workflow_dispatch` with a **confirmation phrase** (`deploy-production`) and a **from-`main` guard**; each ends in a **version-handshake smoke test**. `schema-dump.yml` snapshots the schema.
- **⚠️ The `presence` function is NOT in CI.** It is deployed **manually** via `scripts/deploy-presence.ps1` / `supabase-go.exe` (the standard CLI segfaults on it), which **verifies the "Deployed" confirmation** and smoke-tests the catalog. This is documented and repeatable but **human-run and outside CI**, with **no automated test gate** (the 44 suites are run by hand).
- **Migrations:** applied via the **hold-back technique** (remote history tracks a subset; `0003–0005` fenced) — manual, documented, done for staging + prod. Each migration has a `-- rollback:` inverse.
- **Rollback:** function = redeploy the prior commit (stateless); migration = apply the inverse; publish = versioned restore; external change = reviewed rollback plan.
- **Zero-downtime:** function deploys are atomic swaps at the edge; published sites are static (unaffected by function deploys).
- **Reproducibility:** config-only variance + pinned commands; the manual presence step is the one non-reproducible link (mitigated by the verify-confirmation script).

Detail: [DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md).

## 4. Monitoring Review

**What exists:** `GET /system/health` (secret-gated) reports secret validation (`validateSecrets`: required = `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `SCHEDULER_SECRET`), DB reachability, active-site count, last cycle, and recent failures. The scheduled cycle ledgers every run in `presence_scheduled_runs`.

**What is NOT monitored (documented gaps):** there is **no external poller** of `/system/health`, so **server/function/DB/storage outages are not actively detected**. The following are **logged but not alerted**: publishing failures, commerce/Stripe-webhook failures, OAuth/Connected failures, AI/Visual failures, authentication/permission failures, enterprise/marketplace/agency failures, cron non-execution, queue backlog, rate-limit events, and unexpected exception spikes. **Certificate expiry** relies on Netlify/Supabase auto-renewal (not monitored by us).

**Net:** monitoring today is **pull-based and manual**. Effective active monitoring requires an external uptime check on `/system/health` and a log-based error-alert (see Risk Register HIGH-1/HIGH-2).

## 5. Logging Review

- **What is logged:** structured `console` lines with tags (`[metering]`, `[stripe-webhook]`, etc.); every scheduled run and webhook event is a **durable row**; every data mutation is an **append-only change event**.
- **PII/secrets exposure:** the audit ledger records **field names, never values**; no secrets are logged. **One exception:** `commerce/account.ts` logs a recipient email on the "RESEND_KEY unset" warning path (privacy audit R2) — low severity, misconfiguration-only.
- **Not present:** **correlation/request IDs** — logs are tagged but not per-request-correlated, making single-request tracing harder.
- **Retention:** Supabase function logs retain per the platform's window; durable ledgers (`presence_scheduled_runs`, `presence_change_events`, `presence_connection_events`, `stripe_webhook_events`) persist in the DB.

## 6. Alerting Review

- **The only alert path:** `runOperationsCycle` / `retryFailedRuns` email `OPS_ALERT_EMAIL` (default `eric@davisdigitalstudio.com`) when a scheduled cycle has failures — best-effort, with the failure always in the ledger regardless.
- **Consequently, operations are NOT notified when:** production is down, publishing fails, payments fail, OAuth breaks, AI/Visual providers fail, the DB/storage is unavailable, a **cron job stops running** (silent — no cycle means no alert), backups fail, an env var is missing (only surfaced on a health check), a cert is near expiry, rate limits are hit, or errors spike.
- **No escalation / on-call rotation:** a single email address, no paging, no acknowledgement flow.

This is the **single biggest operational gap** (HIGH-1/HIGH-2). It is a wiring/config task, not a code change.

## 7. Backup & Recovery Review

- **Database + storage:** Supabase-managed **point-in-time recovery (PITR)** — a **project setting**, not code. No automated backup-**failure** alert; no code-side backup job.
- **Configuration:** secrets live in dashboards (recoverable there); the schema is in `migrations/` (versioned) and snapshotted by `schema-dump.yml`.
- **Media:** in Supabase Storage (covered by the platform backup); the customer **export** is an independent backstop.
- **Version recovery:** every publish is retained → self-serve restore.
- **Recovery testing:** **not yet performed/recorded** — the runbook prescribes a quarterly recovery drill; no drill date is on record.

## 8. Disaster Recovery Plan

| Scenario | Survivability | Procedure |
|---|---|---|
| Bad function deploy | High | Redeploy prior commit's function (stateless) |
| Bad migration | High | Apply the migration's `-- rollback:` inverse via hold-back |
| Bad publish | High | Versioned restore (live site unchanged on failure) |
| DB outage | Depends on Supabase | Wait out / restore from PITR to a new ref, re-point config, re-run suites |
| Storage outage | Medium | Supabase-managed; published sites (static, on Netlify) stay up |
| Cloud (Supabase) outage | Low control | Published customer sites remain up (Netlify); app degrades; escalate to Supabase |
| AI / image-model outage | Graceful | Features go honestly unavailable; manual paths work |
| OAuth / Connected outage | Graceful | Reads fail isolated; "needs reconnect"; nothing else affected |
| Stripe outage | Medium | Checkout/webhook retry (idempotent); existing entitlements unaffected |
| Lost secrets | Medium | Rotate/re-issue in dashboards; fail-closed until restored |
| Developer mistake / bad deploy | High | Redeploy; the confirmation-gated prod step reduces blast radius |
| Traffic spike | Untested | Edge + static hosting scale; app has **no rate limiting** (MED-1) |

**RPO/RTO:** not formally defined — **[[recommend the owner set targets]]**; PITR + versioned publishing suggest a low RPO for content, but this is unmeasured.

## 9. Reliability Review

**Strong (verified):**
- **Idempotency:** provisioning is rerunnable (one site per client); the Stripe webhook is idempotent (`stripe_webhook_events`).
- **Atomic execution / no double-writes:** the shared Approved-Plan **atomic claim** (CAS + staleness window) — one winner executes; concurrent/duplicate calls refused.
- **Approval enforcement:** DB CHECK + executor re-check on all five plan tables.
- **Timeouts:** every external fetch is `AbortSignal.timeout`-bounded (reads ~8s, writer ~25s, visual ~60s).
- **Graceful degradation / fallback:** failure-isolated evidence providers; connected providers back off (stale-but-honest); missing keys → honest "not available."
- **Retry:** the scheduled cycle has a retry queue (failed runs re-run under a max-attempt ceiling).

**Absent / limited:**
- **No circuit breakers** (timeouts + isolation substitute partially).
- **No application-level rate limiting** on the presence API (MED-1) — relies on Supabase platform limits + auth.
- **Race conditions:** the sensitive ones (execute) are covered by the atomic claim; no other unguarded shared-state mutation was found.

## 10. Security Operations Review

- **Secrets/keys:** dashboard-managed; rotation cadence documented ([ENV-AND-SECRETS](ENV-AND-SECRETS.md)); connected tokens AES-256-GCM out-of-row, fail-closed.
- **Least privilege:** `svc` (service role) vs `asUser` (RLS-scoped); operator gates (`staff||system`); service-role ≠ operator.
- **Administrative/production access:** via staff login + the Supabase dashboard (owner-held). **No formal emergency-access / break-glass procedure** is documented.
- **Auditability:** append-only change/connection/webhook ledgers.
- **`/system/*`** endpoints are `SCHEDULER_SECRET`-gated; the Stripe webhook is signature-verified.
- Full model: [SECURITY](SECURITY.md).

## 11. Operations Manual (index)

- **Deploy / migrate / rollback / monitor / backup / DR / prod checklist:** [DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md).
- **Operator procedures** (new customer → live, domains, DNS, promotion, byte-check, stale-cache): [RUNBOOKS](RUNBOOKS.md) + [runbooks/](../runbooks/).
- **The unattended cycle** (metering, retries, coach) + capacity model: [OPERATIONS](OPERATIONS.md).
- **Scheduling SQL:** `supabase/ops/schedule-presence-cron.sql` — run once per project with the ref + `SCHEDULER_SECRET`. **Verify it is installed in production** (CRIT-1).

## 12. Production Runbook (day-to-day)

1. **Deploy:** `scripts/deploy-presence.ps1 -Env staging` → verify → `-Env prod`; confirm "Deployed"; smoke-test `/commerce/plans` 200 + `/visual/kinds` 401.
2. **Apply a migration:** hold-back technique, staging then prod, restore held files, verify count.
3. **Health check:** `GET /system/health?secret=…` — confirm secrets valid, DB reachable, last cycle recent, failures 0.
4. **If the cycle didn't run:** confirm pg_cron is installed and `SCHEDULER_SECRET` matches; run `POST /system/run {secret, task:'cycle'}` manually.
5. **Rollback:** redeploy prior commit / apply migration inverse / restore a publish.

## 13. Incident Response Guide

- **Detection:** today, largely **manual** (customer report, health check, ledger inspection) plus the cycle-failure email. *(Add external monitoring to make this proactive — HIGH-1.)*
- **Triage:** check `/system/health`; inspect `presence_scheduled_runs` (last runs/errors), `stripe_webhook_events`, and function logs (by tag).
- **Contain/recover:** use the DR table (§8).
- **Communicate:** notify affected customers per the DPA breach terms where relevant.
- **Post-incident:** record cause + fix; add a test where possible.
- **Escalation:** **not formally defined** — single alert email, owner-held dashboards. **[[recommend an on-call + escalation path]]**.

## 14. Infrastructure Risk Register

| # | Risk | Severity | Finding (verified) | Recommendation (document-only) |
|---|---|---|---|---|
| CRIT-1 | Unattended cycle may not be installed in prod | **Critical** | `schedule-presence-cron.sql` must be run per project; installation unconfirmed. If absent: no metering/retry/coach **and** no failure alerts ever fire | Verify/install pg_cron in prod; confirm `SCHEDULER_SECRET` parity; add a "cycle ran in last N hours" check |
| HIGH-1 | No active uptime/health monitoring | **High** | `/system/health` is pull-based + secret-gated; nothing polls it; outages not detected | Add an external monitor hitting `/system/health` on a schedule with paging |
| HIGH-2 | No error-spike / failure alerting | **High** | Failures (publish/commerce/OAuth/AI/visual/auth) are logged, not alerted; only the scheduled cycle emails | Add log-based alerts (error rate, webhook failures, exception spikes) |
| HIGH-3 | `presence` not in CI; no automated test gate | **High** | CI deploys clever-api/stripe-webhook only; presence deploy is manual, tests run by hand | Add presence to CI (or a CI job running the 44 suites) as a pre-deploy gate |
| MED-1 | No application rate limiting | Medium | No per-caller throttle on the presence API | Add rate limiting (edge or app) before public launch |
| MED-2 | No request correlation IDs | Medium | Logs tagged but not per-request correlated | Add a request id propagated into logs |
| MED-3 | Backups unverified; no drill | Medium | PITR is a Supabase setting; no failure alert; no recorded recovery drill | Verify PITR; run + record a quarterly recovery drill; set RPO/RTO |
| MED-4 | No cert/OAuth/webhook-failure monitoring | Medium | Relies on provider auto-renew + logs | Monitor cert expiry + webhook/OAuth error rates |
| LOW-1 | Recipient email in a warn log | Low | `commerce/account.ts` (misconfig path) | Redact in a future change |
| LOW-2 | Single-address alerting, no on-call | Low | `OPS_ALERT_EMAIL` one recipient, no escalation | Route to a shared inbox/pager + escalation policy |

## 15. Production Readiness Checklist

- [ ] Function deployed + "Deployed" confirmed on staging **and** prod; smoke test green.
- [ ] Target migration applied to both; dir restored; count verified.
- [ ] Required secrets set both envs; activation keys set for enabled features.
- [ ] **pg_cron installed in prod** and the cycle has run (CRIT-1).
- [ ] `platform_invariants_test` 14/14 + full suite green (run manually — HIGH-3).
- [ ] PITR verified; a recovery drill recorded (MED-3).
- [ ] External `/system/health` monitor + error alerting configured (HIGH-1/2).
- [ ] Go-live gate consciously cleared (prices, Stripe events, nav) before pushing the frontend.

## 16. Owner Activation Checklist (ops-specific)

Set required + activation secrets ([ENV-AND-SECRETS](ENV-AND-SECRETS.md)); install `schedule-presence-cron.sql` in prod; register the Stripe webhook + `BILLING_SYNC_SECRET`; verify `/system/health`; smoke-test each activated feature. Full list: [RELEASE-NOTES § Activation](RELEASE-NOTES.md#owner-activation-checklist).

## 17. Launch Operations Checklist

Confirm §15 + §16; enable external monitoring/alerting (HIGH-1/2); establish the on-call/escalation contact; record RPO/RTO and the first recovery drill; run the full test suite as the release gate; then clear the frontend go-live gate.

## 18. Version 1 Operations Report — Final Questions

- **Would you personally deploy this platform?** Yes — **supervised**, following the documented deploy + smoke test. I would not run it unsupervised until HIGH-1/2 (monitoring/alerting) and CRIT-1 (cron) are closed.
- **Could another engineer operate it?** Yes — the runbooks and this report are sufficient for a competent operator.
- **Could another engineer recover production?** Yes — the DR table + rollback procedures are concrete (function redeploy, migration inverse, publish restore, PITR).
- **Could another engineer deploy without you?** Yes — the manual presence deploy is documented and verify-gated; CI covers the other functions.
- **Would an enterprise customer trust this operational maturity?** **Partially.** The correctness/safety/security fundamentals are enterprise-grade; the **observability and CI-gating gaps** would draw findings in an enterprise ops review. Closing HIGH-1/2/3 + CRIT-1 gets it there.
- **Can production be monitored effectively?** **Not yet actively** — the health endpoint exists but nothing polls it and only cycle failures alert. This is the top gap.
- **Can failures be detected quickly?** For scheduled-cycle failures, yes (email). For live request/outage failures, **no** — currently reactive (customer report / manual check).
- **Can failures be recovered safely?** Yes — idempotency, atomic claims, versioned publishing, migration inverses, and PITR make recovery safe; the missing piece is fast *detection*, not safe recovery.
- **Is anything operationally missing before QA?** Yes — the Risk Register items (CRIT-1, HIGH-1/2/3 chiefly). **Documented, not fixed**, per scope.

---

## Declaration line

Operationally, Version 1 is **safe to launch supervised** and **needs monitoring/alerting + CI-test-gating + confirmed cron** for unsupervised, enterprise-grade operation. All findings are documented in the Risk Register; none is a code defect, and nothing was changed in this milestone.
