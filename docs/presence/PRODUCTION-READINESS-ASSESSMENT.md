# Presence CMS — Production Readiness Assessment (Phase 1 · M10)

**Date:** 2026-07-09 · **Scope:** the hardened Presence CMS engine (M1–M10) · **Method:** code-grounded review + the operational validation run (`scripts/validate-phase1.mjs`) + DR verification (`scripts/dr-verify.mjs`).

## Overall rating: **PRODUCTION-READY (engineering) — conditional on documented owner activation**

The engine is architecturally sound, secure, reliable, observable, and recoverable at the engineering level. Every remaining item is **owner activation or human verification**, not code. No engineering work blocks launch.

| Dimension | Rating | Basis |
|---|---|---|
| Architecture | **Strong** | One renderer · one publish pipeline · one serializer · one diff engine · one client helper. 14 frozen invariants. Zero second-systems introduced across 10 milestones; one migration total (M4). |
| Security | **Strong** | Tenant/site scoping enforced across the suite; deny-all RLS; signed OAuth state; signed, fail-closed preview links; magic-byte upload validation; optimistic locking prevents silent overwrites. |
| Reliability | **Strong** | Idempotent + cooldown-guarded publishing; one-in-flight-per-site index; deploy poll timeout + reconcile of stuck/interrupted publishes (never re-deploys); fail-open deploy ceiling. |
| Observability | **Good** | Publish state machine + per-stage telemetry; cron returns reconcile/media_gc/snapshot_gc tallies; `/system/health` + Health Center. *Limitation:* no trend aggregation/alerting for the new signals (Phase 2). |
| Recoverability | **Strong (engineering) / Pending (live drill)** | 74 gap-free migrations; git-deployable functions; live sites self-contained on Netlify. Live restore drill + PITR are owner prerequisites. |
| Operational readiness | **Good** | 10/10 subsystems validated; load-test framework built + proven. *Pending:* live concurrency tuning + CI-as-required-gate activation (owner). |

---

## Dimension detail

**Architecture — Strong.** The CMS is a module on a frozen spine. M1–M10 added hardening *around* the deterministic core without touching it: golden render tests lock XSS-safe deterministic output across three templates; the single publish pipeline (`runPipeline`) is the only path to live; the single serializer (`serializeDraft`) is the one content model, reused by the draft hash, the diff engine, and the preview. No milestone forked a renderer, content model, queue, or auth model.

**Security — Strong.** Verified by `tenant_isolation`, `scoped_access_audit`, `scope`, `operator_auth`, `feature_boundary`, and the 14 `platform_invariants`. M2 hardened tenant scoping; M6 rejects polyglot/malformed uploads by binary signature; M8 preview links are HMAC-signed, time-limited, site-scoped, and fail closed; M9 prevents concurrent editors from silently overwriting each other. No new required secret was introduced (M8 reuses the existing signing config).

**Reliability — Strong.** M4 makes publishing idempotent (per-site key) and cooldown-guarded; M5 makes the deploy path resilient — a slow/flaky Netlify never strands a publish (reconcile finalizes it) or overwhelms the API (fail-open ceiling sheds with a retryable 503). Media and snapshot growth are bounded by deterministic, reference-safe GC (M6/M7).

**Observability — Good.** Any single failure is diagnosable today (see `MONITORING-VERIFICATION.md`). The one honest limitation: the new cron-task tallies and M8/M9 signals are point-in-time, not trended, and alerting fires only on scheduled-run failures. Closing that (Health-Center aggregation + thresholds) is a Phase 2 item; it is not launch-blocking because each failure is individually visible.

**Recoverability — Strong / live-drill pending.** `scripts/dr-verify.mjs` confirms 74 ordered, gap-free migrations with M4's 0073 present; functions redeploy from git with no build step; **published customer sites are baked into Netlify and survive a database incident**. The full runbook, procedures, and verification tooling are complete (`DISASTER-RECOVERY.md`). The live restore drill + PITR are owner prerequisites.

**Operational readiness — Good.** 10/10 subsystems validated (19 suites pass, 1 live-only skip, 0 fail); the load-test framework is built and unit-proven. Pending owner items: the live concurrency sweep (tunes the M5 ceiling; default 8 is a safe fail-open placeholder) and activating CI as a required branch-protection gate.

---

## Remaining owner actions before launch (engineering-complete)
1. **Enable PITR on prod** + confirm backups (DR prerequisite).
2. **Run the live restore drill on staging** (proves the DR runbook end-to-end).
3. **Run the load-test sweep on staging** → set `MAX_CONCURRENT_DEPLOYS` from real numbers (or keep the safe default of 8).
4. **Activate CI as a required gate** (push + branch protection) — the regression suite protects the hardening only once it gates merges.
5. **Push the local commit backlog** at fence-lift to sync GitHub ↔ prod.
6. **Human passes:** live browser/mobile/assistive-tech QA (normal pre-launch, not engineering).
7. Standing pre-launch checklist items (Stripe webhook test-event, publish the fenced audit pages, legal/consent) — tracked separately.

## Remaining launch risks (real, not speculative)
- **Concurrency ceiling is a conservative default, not a measured value.** Mitigated: fail-open (a wrong value never blocks publishing) + the framework is ready to tune it. Low risk.
- **No trend alerting for the new signals** (observability limitation above). Mitigated: each failure is individually diagnosable; scheduled-run failures already alert. Low–medium risk; Phase 2 closes it.
- **Optimistic locking adds a draft serialize per opted-in save.** Mitigated: opt-in, user-paced; the load test will quantify it. Low risk; a cheap version token is the fallback optimization.
- **Live-only integration suites unproven in this environment.** Mitigated: they skip cleanly and should run green on staging during the owner's pre-launch pass. Low risk.

No high-severity engineering risk is open.
