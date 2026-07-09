# Presence CMS — Phase 1 Execution Plan (Harden + Productionize)

**Status:** Execution plan for approval. **No code written.** Pairs with `PRESENCE-CMS-PHASE-1-ARCHITECTURE.md` §12.
**Scope:** harden/consolidate/test the *existing* deterministic pipeline. No second renderer, no drag-and-drop, no queue unless required, no editor redesign, no rewrites, no new product features.

**Legend per milestone:** 🎯 goal · 📦 items covered · 📁 likely-touched files/tables/functions · 🧪 tests · ⚠️ risk/fence/owner.

Each milestone is independently shippable, gated by the full pure regression + golden render, and deployed to staging→prod the same way the rest of the platform is. Public-page-touching work (preview watermark, portal UX) is committed **local only** behind the go-live fence.

---

## Execution order (dependency-sorted)

```
M1  CI + golden safety net            (no runtime change — SAFEST FIRST)
M2  Security audits (read-only)       (highest security value, no behavior change)
M3  Draft-version hash                (foundational: unlocks M4/M8/M9)
M4  Publish idempotency + cooldown    (publish safety)
M5  Deploy robustness                 (poll timeout · reconcile cron · ceiling · telemetry)
M6  Media hardening                   (magic-byte · EXIF-at-upload · quota · GC)
M7  Snapshot retention GC             (data hygiene)
M8  Preview hardening                 (cache · signed links · watermark)
M9  Client UX safety                  (optimistic lock · shared state · what-will-change)
M10 Ops: load test + DR drill         (tunes M5 ceiling; owner-involved)
```

**Why this order:** safety net before any change (M1); read-only security truth early (M2); the draft-version hash (M3) is a dependency for optimistic locking, preview cache, and the "what will change" diff, so it comes before them; publish/deploy safety (M4–M5) before the subsystems that lean on a healthy pipeline; media/snapshot hygiene (M6–M7); UX-facing work last among code (M8–M9) since it touches fenced public pages; ops/load/DR (M10) last because it tunes M5's ceiling constant and needs owner involvement.

---

## M1 — CI + golden safety net  ·  SAFEST FIRST

🎯 Make every subsequent change automatically gated. Zero production runtime change.
📦 CI runner · hostile-string golden render test · verify one-in-flight partial index.
📁
- **New:** CI workflow (`.github/workflows/ci.yml` or chosen runner) that installs Deno, sets `$TMPDIR`, runs the pure sweep + typecheck of all three functions.
- **New test:** `tests/presence/render_golden_test.mjs` (or extend the existing render test) — a fixed content fixture per `template@version` → byte-identical HTML/CSS, **plus** a hostile-string case (script/`<>`/quotes in every block field) asserting escaped output.
- **Verify/DDL:** confirm the partial unique index on `presence_publishes(site_id) WHERE status IN ('pending','deploying')` exists; if migration history is ambiguous, a new migration `00xx_publish_inflight_index.sql` adds it `IF NOT EXISTS`.
🧪 The CI run itself (green on `main`); the new golden + hostile-string suite passes; index-existence query returns the expected predicate.
⚠️ **Owner action:** choose the CI platform + grant repo/runner access (GitHub Actions is the low-friction default). No fence impact (tests/CI only). Migration uses the hold-back apply ritual.

---

## M2 — Security audits (read-only findings)

🎯 Establish security truth before touching data paths. Read-only; any fix that falls out is minimal + tested in place.
📦 `svc()` id-scope audit · global-sentinel cross-tenant check.
📁
- **Audit (no edit):** every `svc()` call in `supabase/functions/presence/**` and `clever-api/index.ts` that interpolates a request-supplied id → confirm an explicit `tenant_id`/`site_id` filter. Output: a findings table in `docs/presence/PHASE1-SECURITY-AUDIT.md`.
- **Global-sentinel check:** trace the all-zero `site_id` convention used by marketplace/org global ops → prove it cannot return another tenant's rows.
- **Targeted fixes only if a real gap:** the specific `svc()` query + a regression test; no broad refactor.
🧪 New `tests/presence/tenant_isolation_test.mjs` — a cross-tenant read attempt returns empty/403; the global sentinel scoped correctly.
⚠️ Read-only first; fixes (if any) are surgical. No fence impact unless a fix touches a public page (unlikely). High value, low risk.

---

## M3 — Draft-version hash (foundational)

🎯 A cheap, deterministic content hash of the draft — the key for optimistic locking (M9), preview cache (M8), and the publish diff (M9).
📦 Draft-version hash.
📁
- **New pure module:** `lib/draft_hash.ts` — `computeDraftHash(settings, contentTables): string` (stable stringify → SHA-256; pure, no clock).
- **Schema:** add `draft_hash text` to `presence_settings` (denormalized cache) **or** compute-on-read; recommend a stored column updated on every draft write for cheap `If-Match`. Migration `00xx_draft_hash.sql`.
- **Wire:** the block/settings-save handlers recompute + store the hash; `/site` (`routes/site.ts handleGetSite`) returns it.
🧪 `tests/presence/draft_hash_test.mjs` — determinism (same draft → same hash), sensitivity (any block change → new hash), stability (key order independent).
⚠️ Additive column; no behavior change until M8/M9 consume it. Migration ritual. No fence impact (API only).

---

## M4 — Publish idempotency + cooldown

🎯 Make publish safe under double-clicks, retries, and rapid re-publishing — without a queue.
📦 Publish idempotency key · 60-second cooldown.
📁
- **`routes/publish.ts`** (`handlePublish`, `runPipeline`): accept `Idempotency-Key` header; if a `presence_publishes` row with that key exists for the site, return its status instead of a new deploy. Read `presence_sites.last_published_at`; reject within 60s → `429 cooldown` + `retry_after`.
- **Extract pure helpers** (unit-testable, no I/O): `cooldownRemaining(lastPublishedAt, now, 60)` and the idempotency-match decision.
- **Schema:** `presence_publishes.idempotency_key text` + partial unique index `(site_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Migration `00xx_publish_idempotency.sql`.
🧪 Pure: cooldown + idempotency decision. Integration (staging): same key twice → one deploy; rapid publish → 429; concurrent publish → one 409 (the existing in-flight gate).
⚠️ Touches the live publish path — highest-care milestone. The in-flight gate (M1) and idempotency together make concurrency race-free with **no queue** (meets the "no queue unless required" bar). Migration ritual.

---

## M5 — Deploy robustness

🎯 A slow or flaky Netlify never blocks a request, strands a publish, or overwhelms the API.
📦 Deploy-poll timeout · reconcile cron for stuck deploys · global concurrent-deploy ceiling · per-stage telemetry.
📁
- **`lib/netlify.ts`** (`deployFileMap`): bounded poll; on timeout leave status `deploying` and return "pending-reconcile" rather than blocking.
- **`routes/system.ts`** (cron task registry hit by `/system/run` via `pg_cron`): new **reconcile task** scanning `presence_publishes WHERE status='deploying'` older than N seconds → poll Netlify deploy state → resolve `live`/`failed`. New **ceiling check**: a count of in-flight deploys; over the ceiling → the publish waits/participates in cooldown rather than firing (bounded, observable).
- **`routes/publish.ts`**: write per-stage timings (snapshot/render/images/deploy ms) onto the publish row.
- **Schema:** telemetry columns on `presence_publishes` (`stage_timings jsonb` or discrete ms columns); optional tiny `deploy_concurrency` counter or a count query. Migration `00xx_publish_telemetry.sql`.
🧪 Pure: reconcile-selection + ceiling decision. Integration (staging): a forced-slow deploy resolves via reconcile; telemetry populated; ceiling queues the (N+1)th publish.
⚠️ The ceiling's **constant is provisional** here (a conservative default) and is tuned by M10's load test. Deploy I/O is the one place outside the sync-render rule (correctly, since it's inherently I/O). pg_cron already live — this registers a new task. Migration ritual.

---

## M6 — Media hardening

🎯 Close upload risks and bound storage cost at thousands of sites.
📦 Magic-byte upload sniffing · EXIF stripping at upload · per-site media quota · media GC.
📁
- **`lib/media.ts`** (`createUpload` + first server touch / variant path): sniff magic bytes vs. declared MIME (reject polyglots); strip EXIF/GPS at upload (defense-in-depth alongside the existing publish-time strip); enforce a per-site quota (count + total bytes) with a clear cap error.
- **`routes/system.ts`** cron: media-GC task reaping `presence_media WHERE deleted_at IS NOT NULL` (objects + rows) and orphaned uploads (row created, object never uploaded, >24h).
- **Schema:** optional `presence_media` index for the GC scan; quota config on `presence_sites` or a constant. Migration `00xx_media_gc.sql` if needed.
🧪 `tests/presence/media_test.mjs` (extend): disguised-file rejection (magic-byte), quota enforcement at cap, GC selects only soft-deleted/orphaned (never live-referenced).
⚠️ EXIF-at-upload must not change published bytes (publish-time strip already deterministic). No fence impact (API/storage). Migration ritual if schema touched.

---

## M7 — Snapshot retention GC

🎯 Bound `presence_snapshots` jsonb growth without ever losing a restorable or referenced snapshot.
📦 Snapshot retention garbage collection.
📁
- **New pure module:** `lib/snapshot_gc.ts` — `deletableSnapshots(all, {liveId, keepN:20, referencedIds})` returns only snapshots safe to delete (never the live one, never the last 20, never one referenced by a launch/schedule).
- **`routes/system.ts`** cron: weekly task using the pure selector, deletes via `svc()`.
- **Reads:** `presence_launches`, `presence_scheduled_publishes` for referenced ids; `presence_publishes` for the live snapshot.
🧪 `tests/presence/snapshot_gc_test.mjs` — never deletes live/referenced/last-20; deletes the tail; deterministic selection.
⚠️ Purely additive cron + pure selector. FK (`presence_publishes.snapshot_id`) protects against deleting a referenced snapshot even if the selector erred (belt-and-suspenders). Low risk.

---

## M8 — Preview hardening

🎯 Faster, safely shareable previews that can never be mistaken for live.
📦 Preview cache by draft hash · optional signed/expiring preview share links · draft watermark.
📁
- **`lib/preview_env.ts` / `lib/staging.ts` / preview handlers** (`handlePreview`): cache the rendered preview keyed by the M3 draft hash (recompute only when the draft changes).
- **Signed links:** reuse the existing signed-state pattern (HMAC over `site_id + draft_hash + exp`, `STATE_SIGNING_SECRET` in `_shared/auth.ts`); a read-only render route that verifies the token. Off by default, opt-in per site.
- **Watermark:** a "DRAFT — not published" chrome band in the preview view (portal-side, `presence.html`/client preview).
🧪 Pure: signed-link verify + expiry. Integration: same draft hash → cache hit; watermark present; expired token → 403.
⚠️ **Fence:** the watermark/preview UI touches portal pages → committed local, not pushed. Reuses `renderSnapshot` (no second renderer). Signed link is opt-in (no new default attack surface).

---

## M9 — Client UX safety

🎯 Prevent silent overwrites and make a live change legible before it ships.
📦 Optimistic locking on save · adopt shared state components · "what will change" publish summary.
📁
- **Settings/block-save handlers:** accept `If-Match: <draft_hash>` (M3); mismatch → `409 stale` with a "refresh — this changed" payload.
- **New pure helper:** `lib/block_diff.ts` — `diffBlocks(liveSnapshotBlocks, draftBlocks)` → a plain-language change list for the publish confirm.
- **Portal UI** (`portal.html`/`client.html`/`presence.html`): adopt `ddsEmpty`/`ddsError`/`ddsToast`/`.dds-skeleton` (already in `shell.css`/`shell.js`) for the CMS module's empty/loading/error/success states; render the diff summary on publish.
🧪 Pure: `block_diff` cases. Integration: stale save → 409; concurrent editors don't clobber.
⚠️ **Fence:** portal pages → local commit only. No new UI framework (reuses shell components). No editor redesign (behavior-only additions).

---

## M10 — Ops: load test + DR drill  ·  owner-involved

🎯 Set the M5 ceiling from real numbers; prove the platform is recoverable.
📦 Load test for concurrency ceiling · disaster recovery restore drill.
📁
- **Load test (staging):** drive concurrent render+publish+deploy against representative data; measure p95 render, publish, and Netlify deploy latency; pick the safe global-deploy ceiling → update M5's constant (a one-line change + re-test).
- **DR drill:** documented + executed restore — PITR restore of the DB, then re-deploy a site's **live snapshot** from `presence_snapshots` (proves every live site is reproducible from the DB alone). Runbook in `docs/presence/PHASE1-DR-RUNBOOK.md`.
🧪 The load-test report (numbers + chosen ceiling); the DR drill checklist executed with evidence.
⚠️ **Owner actions:** enable **PITR** on prod (dated decision, ~$100/mo, at first paying customers); provide/approve a staging load environment. Depends on M5 shipping first.

---

## Hard blockers & owner actions (consolidated)

1. **CI platform choice + access** (M1) — pick GitHub Actions (or alternative) and grant runner access. Blocks the safety net.
2. **PITR enablement** (M10) — owner decision + cost; needed for the DR drill. Already on the pre-launch parked list.
3. **Staging load environment** (M10) — representative data + permission to drive load; feeds M5's ceiling constant.
4. **Migration apply ritual** — M1/M3/M4/M5/M6 add migrations; each uses the documented hold-back technique (this is known friction, not a blocker). Reconciling migration history is a worthwhile parallel cleanup.
5. **Go-live fence** — M8 (watermark) and M9 (portal UX) touch public/portal pages → **committed local, never pushed** until you declare go. All API/cron/test/security work is unaffected by the fence.
6. **No external dependencies** — none of these require a new third-party service (no queue, no CDN, no image service). Netlify + Supabase + pg_cron already in place.

## The safest first coding milestone

**M1 — CI + golden safety net.** It changes **no production runtime behavior**: it stands up the automated test gate, adds a hostile-string golden render test (locks in XSS-safe deterministic output), and verifies the one-in-flight publish index. Everything after it is protected by an automated regression gate, which is exactly the property you want before touching the live publish path in M4/M5. It needs only one owner action (CI platform access) and carries the least risk of any item on the list.

## Decision-filter check

Every milestone was tested against: increases trust · improves safety · reduces maintenance · improves scale-readiness · protects deterministic publishing. Nothing here adds a product feature, a second renderer, a builder, a queue (the DB in-flight gate + idempotency + cooldown meet concurrency without one), or a rewrite. Items that failed the filter were already rejected in the architecture doc §13 and do not appear here.
