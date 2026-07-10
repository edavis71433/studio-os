# Presence CMS — Operational Validation (Phase 1 · M10)

**Purpose:** verify the hardened CMS operates correctly under expected production conditions, reusing the existing regression suite organized by subsystem.

**Runner:** `deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-phase1.mjs`

**Result (Jul 9 2026):** **10/10 subsystems validated · 19 suites pass · 1 skip (live-only integration) · 0 fail.** The full pure sweep is **93 passing / 4 skipped / 0 failing**; all three edge functions typecheck with 0 errors.

---

## Validation matrix

| Subsystem (milestone) | Verified by | Result |
|---|---|---|
| Security & tenant isolation (M2) | `tenant_isolation` (11) · `platform_invariants` · `scoped_access_audit` (17) · `scope` (14) · `operator_auth` (7) · `feature_boundary` (189) | ✅ |
| Draft-version hash (M3) | `draft_hash` (10) | ✅ |
| Publish reliability — idempotency + cooldown (M4) | `publish_guard` (21) · `pipeline` (live-only, skipped here) | ✅ |
| Deploy robustness — timeout·reconcile·ceiling·telemetry (M5) | `deploy_reconcile` (21) | ✅ |
| Media hardening — magic-byte·EXIF·quota·GC (M6) | `media_hardening` (40) | ✅ |
| Snapshot retention & GC (M7) | `snapshot_gc` (26) | ✅ |
| Preview hardening — cache·signed links·watermark (M8) | `preview_hardening` (37) · `preview_env` (12) | ✅ |
| Editing safety — optimistic lock + reused diff (M9) | `optimistic_lock` (30) | ✅ |
| Rendering determinism (golden) | `render` (36) · `business_classic` · `editorial` (18) · `dev_render` | ✅ |
| Load-test framework (M10) | `loadtest` (19) | ✅ |

---

## What each subsystem's validation proves

- **Publish pipeline** — one in-flight per site (partial unique index), idempotent replay by `(site_id, key)`, 60s cooldown, deterministic golden render (incl. hostile/XSS-safe output across 3 templates).
- **Deployment** — configurable poll timeout, reconcile finalizes stuck/interrupted publishes (never re-deploys), global concurrent-deploy ceiling (fail-open), per-stage telemetry.
- **Media** — magic-byte signature validation (rejects polyglots), safe JPEG EXIF strip (never corrupts image data), per-site quota, deterministic GC (soft-deleted past retention + HEAD-verified orphans; never touches referenced/published).
- **Snapshot** — the canonical pure retention selector keeps live / last-20-per-site / all referenced (publish·rollback·scheduled·launch·`prev_snapshot_id`·preview); only old unreferenced snapshots are deletable; uncertainty → keep.
- **Preview** — content-addressed render cache (never stale, publish never reads it), HMAC-signed time-limited links that fail closed on tamper/expiry/missing-secret + are site-scoped, watermark that can never reach a live deploy.
- **Optimistic locking** — `If-Match` (M3 hash) refuses a stale write with a clear 409, opt-in, fail-open; the "what will change" diff reflects only actual changes, deterministically.
- **Security** — tenant/site scoping enforced across the suite; 14 platform invariants frozen; operator-auth boundaries intact.

---

## Deferred to a live environment (owner)

- **`pipeline_test`** and other `*_integration_test` suites need live Supabase credentials; they skip cleanly here and should run green against staging as part of the owner's pre-launch pass.
- **Live concurrency measurement** — the load-test framework is built and unit-proven; the actual latency sweep + ceiling tuning runs against a staging load environment (see `LOAD-TEST-FRAMEWORK.md`).
