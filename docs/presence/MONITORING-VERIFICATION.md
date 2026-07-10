# Presence CMS — Monitoring & Observability Verification (Phase 1 · M10)

**Purpose:** verify the EXISTING telemetry gives enough visibility to diagnose a failure in each hardened subsystem. This validates what is already there — it does **not** add a monitoring system.

**Verdict:** every subsystem emits a diagnosable signal. One known limitation (trend aggregation) is documented at the end as a Phase 2 opportunity, not a gap that blocks launch.

---

## Telemetry map — where each signal lives and how to read it

| Area | Signal(s) | Where to read it |
|---|---|---|
| **Publish lifecycle** | `presence_publishes` row: `status` (`queued`→`deploying`→`live`/`failed`/`canceled`), `netlify_deploy_id`, `created_at`, `completed_at`, `change_summary`, `idempotency_key`; **M5 `publish_stages`** structured log (per-stage ms: snapshot·record·render·images·deploy + total) at the terminal outcome | `GET /publishes` (client history) · the `presence_publishes` table · Supabase → Functions → `presence` logs (`evt:"publish_stages"`) |
| **Deployment** | `netlify_deploy_id` on the publish row + resolved state; **M5 `deploy_ceiling`** structured log when load is shed (503) | publish row `status` · function logs (`evt:"deploy_ceiling"`) |
| **Reconciliation (M5)** | `runReconcileStuckPublishes` tally `{scanned, live, failed, abandoned, pending}` returned every cron tick under `reconcile`; `reconcileOnePublish` finalizes each stuck row | `POST /system/run` response `data.reconcile` · function logs |
| **Media cleanup (M6)** | `reapMedia` result `{soft_scanned, soft_reaped, orphan_scanned, orphan_reaped}` every cron tick under `media_gc` | `POST /system/run` response `data.media_gc` |
| **Snapshot cleanup (M7)** | `reapSnapshots` result `{sites_scanned, considered, kept, deleted}` every cron tick under `snapshot_gc` | `POST /system/run` response `data.snapshot_gc` |
| **Preview (M8)** | `X-Presence-Preview-Cache: hit|miss` response header on `/preview`; signed-link failures return a closed 4xx (`expired`/`invalid`) | preview response headers · client network tab |
| **Editing safety (M9)** | `409 stale_draft` with `current_hash` + `ETag` on a conflicting write | client network tab · function logs |
| **System health** | `GET /system/health` → `{secrets (grouped capabilities), db_ok, active_sites, last_cycle, failures_last_24h, health_center}`; `computeHealthCenter` aggregates cron freshness, failed publishes (7d), failed runs (24h), domains, billing, AI usage, secrets | `GET /system/health` (secret-gated) · the operator Health Center |

---

## Verification checklist (all confirmed present in code)

- ✅ **Publish lifecycle visibility** — the `presence_publishes` state machine + per-stage `publish_stages` timings mean any publish can be traced from request to live/failed, with the failing stage named.
- ✅ **Deployment visibility** — deploy id + resolved state on the row; ceiling sheds are logged; a stuck deploy is finalized (and logged) by reconcile.
- ✅ **Reconciliation visibility** — every cron tick reports how many stuck publishes were scanned and how they resolved.
- ✅ **Media-cleanup visibility** — every cron tick reports soft-deleted vs. orphan reaps.
- ✅ **Snapshot-cleanup visibility** — every cron tick reports sites scanned, snapshots considered, kept, deleted.
- ✅ **Preview visibility** — cache hit/miss is on every preview response; signed-link rejection reasons are explicit.
- ✅ **Health surface** — `/system/health` + the Health Center give one operator read of secrets, DB, cron freshness, and recent failures.

**How to validate live (owner, 2 min):** call `POST /system/run` with the scheduler secret and confirm the response JSON contains `reconcile`, `media_gc`, and `snapshot_gc` blocks; call `GET /system/health` and confirm `db_ok:true` + `capabilities`.

---

## Known limitation (validated, not fixed here — Phase 2 opportunity)

The new cron-task tallies (`reconcile`/`media_gc`/`snapshot_gc`) and the M8/M9 signals are **point-in-time** — they appear in each cron response and in logs, but nothing **persists or trends** them, and `OPS_ALERT_EMAIL` currently fires only on scheduled-run failures. So a slow drift (e.g., a rising abandon count, a climbing stale-conflict rate) is visible only by reading logs. Folding these tallies into the Health Center with a threshold alert is a **Phase 2 observability item** — it was deliberately not built here because M10's scope is to *validate* the existing monitoring, not extend it. This is not launch-blocking: every failure is individually diagnosable today.
