# Presence CMS — Phase 1 Execution Plan (Harden + Productionize)

**Status:** Execution plan for approval. **No code written.** Pairs with `PRESENCE-CMS-PHASE-1-ARCHITECTURE.md` §12.
**Scope:** harden/consolidate/test the *existing* deterministic pipeline. No second renderer, no drag-and-drop, no queue unless required, no editor redesign, no rewrites, no new product features.

**Legend per milestone:** 🎯 goal · 📦 items covered · 📁 likely-touched files/tables/functions · 🧪 tests · ⚠️ risk/fence/owner.

Each milestone is independently shippable, gated by the full pure regression + golden render, and deployed to staging→prod the same way the rest of the platform is. Public-page-touching work (preview watermark, portal UX) is committed **local only** behind the go-live fence.

---

## Phase 1 progress

**7 of 10 implemented (70%).** Next active engineering milestone: **M8 — Preview hardening.**
**✅ M4 is now FULLY LIVE** — migration `0073` applied to staging + prod (Jul 9 2026; column + index + check verified in both). Idempotency and cooldown both active. **No outstanding owner activation dependency remains in Phase 1.**

| M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 |
|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏳ | ⏳ | ⏳ |

*(✅⏳ = implementation complete, one owner activation step outstanding.)*

- ✅ **M1 — CI + golden safety net** — DONE (Jul 9 2026). Committed, tested, verified; CI runner + hostile-string golden across all 3 templates; one-in-flight index verified.
- ✅ **M2 — Security audits** — DONE (Jul 9 2026). Committed, tested, verified, deployed. `svc()` tenant/site-scope audit, global-sentinel audit, request-id review, 3 defense-in-depth `site_id` hardenings, tenant-isolation regression tests (9/9), audit record ([PHASE1-SECURITY-AUDIT.md]).
- ✅ **M3 — Draft-version hash** — DONE (Jul 9 2026). Committed, tested (10/10), deployed. Pure `lib/draft_hash.ts` reuses the ONE serializer; compute-on-read, no migration, no publish change; `draft_hash` on `/site`.
- ✅ **M4 — Publish idempotency + cooldown** — **FULLY LIVE** (Jul 9 2026). Publish cooldown, publish guard, idempotency, tests (guard 21/21 + tenant-isolation 11/11), regression (88/88), documentation, deployment. Migration `0073_publish_idempotency.sql` **applied to staging + prod** (column + index + check verified in both) — idempotency and cooldown both active. No outstanding owner step.
- ✅ **M5 — Deploy robustness** — DONE (Jul 9 2026). Committed, tested (deploy_reconcile 21/21), deployed — **fully live, no owner dependency**. Deterministic configurable poll timeout (`DEPLOY_POLL_MS`); reconcile of stuck publishes (shared `lib/deploy_reconcile.ts` — reused by GET /publishes AND folded into the default cron cycle, never re-deploys, recovers interrupted-before-deploy rows); global concurrent-deploy ceiling (`MAX_CONCURRENT_DEPLOYS`, default 8, fail-open, additive to the one-in-flight index); per-stage telemetry via structured logging (no migration, no new monitoring). 89/89 pure sweep.
- ✅ **M6 — Media hardening** — DONE (Jul 9 2026). Committed, tested (media_hardening 40/40), deployed — **fully live, no owner dependency, NO migration**. Pure `lib/media_guard.ts` (magic-byte signature validation, safe segment-level JPEG EXIF/GPS strip, per-site quota math) wired into `createUpload` (quota, pre-URL) + `importImage` (magic-byte + EXIF); `lib/media_gc.ts` `reapMedia` (soft-deleted past 7-day retention + never-uploaded HEAD-404 orphans) folded into the default cron cycle + `task:'media_gc'`. Published/preview output stays EXIF-free + orientation-safe via the existing render transform (one pipeline, unchanged). 90/90 pure sweep.
- ✅ **M7 — Snapshot retention GC** — DONE (Jul 9 2026). Committed, tested (snapshot_gc 26/26), deployed — **fully live, no owner dependency, NO migration**. Canonical retention as a **pure selector** `classifySnapshots` (keeps live · last-20 per site · publish/rollback/scheduled/launch/`prev_snapshot_id`/preview references · unclassifiable→keep) + I/O `reapSnapshots` (per-site gather, site-scoped bounded DELETE, oldest-first, converges) folded into the default cron cycle + `task:'snapshot_gc'`. FKs (launch/preview RESTRICT, publishes set-null) back the selector as defense-in-depth. 91/91 pure sweep.
- ⏳ **M8–M10** — remaining, in the approved order below (M8 is next active).

## Execution order (dependency-sorted)

```
M1  ✅ CI + golden safety net          (DONE — no runtime change; SAFEST FIRST)
M2  ✅ Security audits                  (DONE — tenant-isolation audit + hardening)
M3  ✅ Draft-version hash                (DONE — compute-on-read; unlocks M4/M8/M9)
M4  ✅ Publish idempotency + cooldown    (FULLY LIVE — mig 0073 applied both envs; idempotency + cooldown active)
M5  ✅ Deploy robustness                 (DONE — poll timeout · reconcile cron · ceiling · telemetry; fully live)
M6  ✅ Media hardening                   (DONE — magic-byte · EXIF-at-upload · quota · GC; fully live, no migration)
M7  ✅ Snapshot retention GC             (DONE — pure selector + bounded cron reaper; fully live, no migration)
M8  ⏳ Preview hardening               (NEXT — cache · signed links · watermark)
M9  Client UX safety                  (optimistic lock · shared state · what-will-change)
M10 Ops: load test + DR drill         (tunes M5 ceiling; owner-involved)
```

**Why this order:** safety net before any change (M1); read-only security truth early (M2); the draft-version hash (M3) is a dependency for optimistic locking, preview cache, and the "what will change" diff, so it comes before them; publish/deploy safety (M4–M5) before the subsystems that lean on a healthy pipeline; media/snapshot hygiene (M6–M7); UX-facing work last among code (M8–M9) since it touches fenced public pages; ops/load/DR (M10) last because it tunes M5's ceiling constant and needs owner involvement.

---

## M1 — CI + golden safety net  ·  SAFEST FIRST  ·  ✅ DONE (Jul 9 2026)
> **Result:** CI runner (`.github/workflows/ci.yml` + `scripts/ci-pure-tests.sh`, Deno 2.9.1) typechecks all three functions + runs the pure sweep on push/PR. Extended `render_test.mjs` with golden + hostile-string escape across all three templates (business-classic + editorial baselines added). One-in-flight publish index verified correct (predicate `status IN ('queued','deploying')`). The new gate immediately exposed + fixed 2 masked failures. 86/86 pure suites. **Owner action to activate: push + add the `test` job as a required check.**

🎯 Make every subsequent change automatically gated. Zero production runtime change.
📦 CI runner · hostile-string golden render test · verify one-in-flight partial index.
📁
- **New:** CI workflow (`.github/workflows/ci.yml` or chosen runner) that installs Deno, sets `$TMPDIR`, runs the pure sweep + typecheck of all three functions.
- **New test:** `tests/presence/render_golden_test.mjs` (or extend the existing render test) — a fixed content fixture per `template@version` → byte-identical HTML/CSS, **plus** a hostile-string case (script/`<>`/quotes in every block field) asserting escaped output.
- **Verify/DDL:** confirm the partial unique index on `presence_publishes(site_id) WHERE status IN ('pending','deploying')` exists; if migration history is ambiguous, a new migration `00xx_publish_inflight_index.sql` adds it `IF NOT EXISTS`.
🧪 The CI run itself (green on `main`); the new golden + hostile-string suite passes; index-existence query returns the expected predicate.
⚠️ **Owner action:** choose the CI platform + grant repo/runner access (GitHub Actions is the low-friction default). No fence impact (tests/CI only). Migration uses the hold-back apply ritual.

---

## M2 — Security audits (read-only findings)  ·  ✅ DONE (Jul 9 2026)
> **Result:** no exploitable RLS-bypass found — every client route scopes request-supplied version ids to the caller's `site.id`. Applied 3 defense-in-depth `&site_id=eq.` hardenings on the request-id-driven snapshot fetches (preview / restore / restore-to-draft), matching the existing `admin.ts:326` precedent. Global sentinel confirmed operator-only. Added `tests/presence/tenant_isolation_test.mjs` (9/9, structural regression guard). presence 0 type-errors; 86/86 pure suites; deployed staging+prod. Record: [PHASE1-SECURITY-AUDIT.md].


🎯 Establish security truth before touching data paths. Read-only; any fix that falls out is minimal + tested in place.
📦 `svc()` id-scope audit · global-sentinel cross-tenant check.
📁
- **Audit (no edit):** every `svc()` call in `supabase/functions/presence/**` and `clever-api/index.ts` that interpolates a request-supplied id → confirm an explicit `tenant_id`/`site_id` filter. Output: a findings table in `docs/presence/PHASE1-SECURITY-AUDIT.md`.
- **Global-sentinel check:** trace the all-zero `site_id` convention used by marketplace/org global ops → prove it cannot return another tenant's rows.
- **Targeted fixes only if a real gap:** the specific `svc()` query + a regression test; no broad refactor.
🧪 New `tests/presence/tenant_isolation_test.mjs` — a cross-tenant read attempt returns empty/403; the global sentinel scoped correctly.
⚠️ Read-only first; fixes (if any) are surgical. No fence impact unless a fix touches a public page (unlikely). High value, low risk.

---

## M3 — Draft-version hash (foundational)  ·  ✅ DONE (Jul 9 2026)
> **Result:** `lib/draft_hash.ts` — `computeDraftHash(snapshot)` hashes the **canonical serialized draft content minus the capture timestamp** (SHA-256 over a key-sorted / array-order-preserving canonical JSON), reusing the ONE `serializeDraft` (no second content model). `draftHashForSite(site)` serializes + hashes; surfaced as `draft_hash` on `/site` GET (concurrent, **fail-soft** → null on any hiccup, never blocks the view). **Design: compute-on-read — NO migration, NO per-save wiring, publishing unchanged**; a settings-only column would be incomplete (misses content-table edits) and serialize-on-every-write would be heavier — a cached column can be added in M9 if If-Match perf needs it. Verified: same content → same hash · timestamp excluded · object-key reorder stable · array reorder (semantic) changes it · content/dev-layer/template changes move it. Tests 10/10; 87/87 pure sweep; 0 type-errors; deployed staging+prod. **No downstream feature built (M8/M9 consume this later).**


🎯 A cheap, deterministic content hash of the draft — the key for optimistic locking (M9), preview cache (M8), and the publish diff (M9).
📦 Draft-version hash.
📁
- **New pure module:** `lib/draft_hash.ts` — `computeDraftHash(settings, contentTables): string` (stable stringify → SHA-256; pure, no clock).
- **Schema:** add `draft_hash text` to `presence_settings` (denormalized cache) **or** compute-on-read; recommend a stored column updated on every draft write for cheap `If-Match`. Migration `00xx_draft_hash.sql`.
- **Wire:** the block/settings-save handlers recompute + store the hash; `/site` (`routes/site.ts handleGetSite`) returns it.
🧪 `tests/presence/draft_hash_test.mjs` — determinism (same draft → same hash), sensitivity (any block change → new hash), stability (key order independent).
⚠️ Additive column; no behavior change until M8/M9 consume it. Migration ritual. No fence impact (API only).

---

## M4 — Publish idempotency + cooldown  ·  ✅ FULLY LIVE (migration 0073 applied both envs, Jul 9 2026)
> **Design:** the client `/publish` path (only) gained, in precedence order: (a) idempotent **replay** — same `Idempotency-Key` on the same site returns the existing publish (no 2nd snapshot/deploy); (b) **in-flight** fast-path 409 (more accurate than cooldown, keeps one-in-flight semantics — the race-safe partial unique index in `runPipeline` stays the ultimate gate); (c) **60s per-site cooldown** (429 + `Retry-After`) using the authoritative persisted `last_published_at` (multi-instance safe). Pure logic in `lib/publish_guard.ts` (`parseIdempotencyKey`/`cooldownRemainingMs`/`replayData`). `runPipeline` gained an OPTIONAL key param; **all other callers (restore/launch/scheduler/preview-promote) pass none → unchanged**, and internal admin/agency publish pass `req=null` → not cooldown-gated (requirement #11). Backward-compatible: no key = works + cooldown applies; a well-formed key resolves per-site so **cross-tenant reuse is isolated** by the `(site_id, key)` index. `pipeline_test` §4 (planted in-flight → 409) is preserved *because* the in-flight check precedes cooldown. Tests: publish_guard 21/21 + tenant_isolation 11/11 (incl. M4 site-scope of the key lookups); 88/88 pure sweep; 3 functions 0 type-errors; **deployed staging+prod — cooldown live now**.
> **✅ OWNER activation DONE (Jul 9 2026):** migration `0073_publish_idempotency.sql` (adds `idempotency_key text` + a length CHECK + the partial unique index `(site_id, idempotency_key) WHERE idempotency_key IS NOT NULL`) **applied to both staging and prod via the Supabase SQL editor; column + index + check verified present in both.** Idempotency is now active alongside the already-live cooldown. No remaining owner step for M4.


🎯 Make publish safe under double-clicks, retries, and rapid re-publishing — without a queue.
📦 Publish idempotency key · 60-second cooldown.
📁
- **`routes/publish.ts`** (`handlePublish`, `runPipeline`): accept `Idempotency-Key` header; if a `presence_publishes` row with that key exists for the site, return its status instead of a new deploy. Read `presence_sites.last_published_at`; reject within 60s → `429 cooldown` + `retry_after`.
- **Extract pure helpers** (unit-testable, no I/O): `cooldownRemaining(lastPublishedAt, now, 60)` and the idempotency-match decision.
- **Schema:** `presence_publishes.idempotency_key text` + partial unique index `(site_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Migration `00xx_publish_idempotency.sql`.
🧪 Pure: cooldown + idempotency decision. Integration (staging): same key twice → one deploy; rapid publish → 429; concurrent publish → one 409 (the existing in-flight gate).
⚠️ Touches the live publish path — highest-care milestone. The in-flight gate (M1) and idempotency together make concurrency race-free with **no queue** (meets the "no queue unless required" bar). Migration ritual.

---

## M5 — Deploy robustness  ·  ✅ DONE (Jul 9 2026) — fully live, no owner dependency
> **Design:** (1) **Poll timeout** — `deployFileMap`'s bounded poll made configurable (`DEPLOY_POLL_MS`, default 30s); on timeout the record stays `deploying` (never ambiguous) and reconcile finalizes it. (2) **Reconcile** — new `lib/deploy_reconcile.ts` `reconcileOnePublish` reads Netlify's authoritative state and finalizes the record (live/failed) or fails a publish interrupted *before* it deployed (`ABANDON_MS`); it **never re-deploys** (idempotent, history-safe). `reconcileSitePublishes` is reused by GET /publishes (replacing the old inline logic — one implementation) and `runReconcileStuckPublishes` is **folded into the default `/system/run` cron cycle** so it runs every tick **with no owner cron-config change** (+ a dedicated `task:'reconcile'`). (3) **Ceiling** — `runPipeline` counts global `deploying` publishes; over `MAX_CONCURRENT_DEPLOYS` (default 8) it sheds load with a retryable **503** before creating any record — additive to (never replacing) the per-site one-in-flight index; **fail-open** (count hiccup never blocks); count is a bare number → no tenant leak. (4) **Telemetry** — per-stage timings (snapshot/record/render/images/deploy + total) emitted as one structured `publish_stages` log line at the terminal outcome (success or `failed:<stage>`) — reuses the logging floor, **no new monitoring, no migration**. All other publish callers unchanged (shared `runPipeline`). Tests: deploy_reconcile 21/21 (pure decision helpers + structural wiring); 89/89 pure sweep; 3 functions 0 type-errors; deployed staging+prod. **No migration, no owner activation.**


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

## M6 — Media hardening  ·  ✅ DONE (Jul 9 2026) — fully live, no owner dependency, NO migration
> **Design:** New pure `lib/media_guard.ts` + I/O `lib/media_gc.ts`; wired into the existing upload/cron paths — no new content model, no second store, no new client workflow.
> **(1) Magic-byte validation** — `sniffType`/`magicMatchesMime` check the binary signature (JPEG `FFD8FF`, PNG, WebP `RIFF…WEBP`, PDF `%PDF-`), rejecting malformed files and polyglots regardless of declared MIME or extension. Applied in `importImage` — the ONE path where the function holds the raw bytes (client uploads go **direct to storage** via a signed URL, so the function isn't in their byte path; those are validated at publish by the render transform, which decodes → non-images fail and any polyglot payload is dropped in the clean WebP re-encode). **(2) EXIF stripping** — `stripJpegExif` removes the JPEG APP1 segment (EXIF/GPS/XMP + camera metadata) at the **segment level — it never decodes or touches the compressed image data, so it can't corrupt the picture**; applied to the stored JPEG original in `importImage`. Published/preview output is **independently** EXIF-free via the `render/image` transform, which is also the **orientation-safe** path (it auto-orients then strips) — so client-upload originals stay untouched (orientation preserved) and their published output is always clean. **(3) Per-site quota** — `mediaQuota`/`quotaExceeded` (configurable `MAX_MEDIA_FILES` default 1000, `MAX_MEDIA_BYTES` default 1 GB) enforced in `createUpload` **before** a signed URL or row is created, over one site-scoped usage query (count = row count, usage = bytes sum); a clear `quota_exceeded` message; never touches existing media. **(4) Media GC** — `lib/media_gc.ts` `reapMedia` runs two deterministic, bounded classes: soft-deleted rows past a 7-day retention window (already reference-checked at deletion by `deleteMedia`; live sites ship **baked** variants so removing the stored original can't break a published site), and never-uploaded orphans (row present but a storage **HEAD proves the object is 404** — errs toward *keep* on any unverifiable case). Folded into the default `/system/run` cron cycle (**no owner cron change**) + a dedicated `task:'media_gc'`; per-row isolated, idempotent. Tests: `media_hardening_test` 40/40 (magic-byte accept/reject/polyglot, EXIF strip on a synthetic JPEG with data-preservation + idempotency, quota boundaries, GC eligibility, tenant-scope + wiring); 90/90 pure sweep; 0 type-errors; deployed staging+prod. **No schema change** (reuses `bytes`/`deleted_at`/`created_at`/`site_id`).

🎯 Close upload risks and bound storage cost at thousands of sites.
📦 Magic-byte upload sniffing · EXIF stripping at upload · per-site media quota · media GC.
⚠️ **Architectural note (honest):** client uploads are direct-to-storage (not redesigned per the milestone constraint), so the *stored original's* EXIF/magic-byte hardening applies to the server-side import path; every client upload's **published + preview output** is guaranteed clean + correctly-oriented by the render transform, and the private bucket is never publicly served. No fence impact (API/storage only).

---

## M7 — Snapshot retention GC  ·  ✅ DONE (Jul 9 2026) — fully live, no owner dependency, NO migration
> **Design:** New `lib/snapshot_gc.ts` with the CANONICAL retention decision as a **pure function** `classifySnapshots(snapshots, {liveIds, referencedIds, keepRecent})` → `{keep, deletable}` (no DB writes inside). A snapshot is KEPT if it is the live snapshot, among the most-recent N **per site** (recency floor, default 20 via `SNAPSHOT_KEEP_RECENT` — covers the working draft's safety snapshots + recent published versions), referenced by publish/rollback history (`presence_publishes.snapshot_id`), a scheduled publish, a launch (`snapshot_id` **and** `prev_snapshot_id` rollback target), or a preview share (`presence_site_preview.snapshot_id`), **or** its `created_at` is unparseable/absent (can't classify → keep). Everything else — an old, wholly-unreferenced safety snapshot — is deletable. The I/O `reapSnapshots` surfaces sites with the oldest snapshots, gathers all four reference classes + the live id **per site**, runs the pure selector over that site's full list, and DELETEs the deletable set **site-scoped** (tenant guard) in bounded chunks; per-site isolated, oldest-first, bounded per tick (≤25 sites), converges across cron ticks. Folded into the default `/system/run` cron cycle (**reuses the existing scheduler/logging — no new scheduler, no new cleanup system**) + a dedicated `task:'snapshot_gc'`. **Defense in depth:** the launch + preview FKs are RESTRICT (the DB refuses a referenced-snapshot delete even if the selector erred); `publishes.snapshot_id` is set-null; `scheduled_publishes.snapshot_id` has no FK and is protected solely by the selector. Tests: `snapshot_gc_test` 26/26 (recency floor, live-always-kept-even-if-oldest, each reference class kept, old-unreferenced collected, uncertainty→keep, **per-site tenant isolation**, determinism, config, wiring); 91/91 pure sweep; 0 type-errors; deployed staging+prod. **No schema change** (reuses the immutable snapshot model + existing FKs).

🎯 Bound `presence_snapshots` jsonb growth without ever losing a restorable or referenced snapshot.
📦 Snapshot retention garbage collection — the canonical pure selector + bounded cron reaper.
⚠️ Purely additive cron + pure selector; no fence impact (system/storage only). Realized the retention set is broader than first sketched — it also protects `prev_snapshot_id` (launch rollback targets) and `presence_site_preview` share snapshots, and there is **no persistent draft-snapshot row** (the draft lives in the working tables; `draft_writer` safety snapshots are the tail that actually accumulates, caught by the recency floor).

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
