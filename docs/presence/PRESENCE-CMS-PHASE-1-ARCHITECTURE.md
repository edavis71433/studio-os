# Presence CMS — Phase 1 Master Architecture & Build Specification

**Status:** Architecture blueprint (no implementation). Lead-architect spec for the Phase 1 build.
**Date:** 2026-07-09.
**Author:** Studio OS engineering.

---

## 0. Framing decision (read this first)

**The Presence CMS engine already exists and runs in production.** Structured content → validated → snapshotted → rendered → atomically deployed is not a design goal for Phase 1; it is the *current* behavior of the `presence` edge function. Before writing a single new line, the codebase already contains:

- **Content model:** `presence_settings.blocks` (structured `SiteBlock[]`), `presence_identity`, `presence_offerings`, `presence_faqs`, `presence_testimonials`, `presence_voice`, `presence_brand_profile`, `presence_redirects`.
- **Snapshot + publish:** `serializeDraft()` → `presence_snapshots` → `runPipeline()` → `presence_publishes` (with a partial-unique-index one-in-flight gate) → content-addressed atomic **Netlify** deploy (`lib/netlify.ts`).
- **Render:** `renderSnapshot()` — one pure, synchronous, deterministic render entry; a versioned template registry (`lib/render.ts`: `getTemplate`, `templateIndex`, `registryIntegrity`) with 8 template families (`restaurant-classic`, `business-classic`, `editorial`, `aurora`, `slate`, `meadow`, `atelier`, `harbor`) + industry vocabulary + structured block components.
- **Preview:** `/preview`, `lib/staging.ts` (`captureDraftSnapshot`), `lib/preview_env.ts`, promote/publish flow.
- **Launches:** `presence_launches` + `routes/launches.ts` (named parallel drafts, approve → schedule/promote → rollback), reusing the one publish pipeline.
- **Media:** private `presence-media` bucket, function-issued signed upload URLs, MIME allow-list, size caps, DB-enforced alt text, EXIF/GPS stripped at publish, self-hosted on the published site (zero external origins).
- **Scheduling:** `presence_scheduled_publishes` + `pg_cron`.
- **History/rollback:** `presence_publishes` history + `/restore` + `/restore-to-draft`.

**Therefore Phase 1 is a consolidation, hardening, and scale-readiness pass on one existing system — not a second CMS.** This is mandated twice over: by the project's reuse-first law (no second engine, ever) and by the explicit instruction that completed work is production-ready and must not be rewritten "unless absolutely required for the CMS."

This document does two things for each deliverable: **(A) specifies the authoritative Phase 1 architecture** (what the system is), and **(B) lists the hardening deltas** — the specific, bounded additions required to make it a confident many-thousand-site SaaS. Deltas are the actual Phase 1 build work. Everything else is "document, verify, freeze."

---

## 1. Non-negotiable invariants (the design frame)

Every decision below is constrained by these frozen contracts. They are the reason the architecture stays simple.

1. **One render pipeline.** `renderSnapshot(snapshot, siteConfig): FileMap` is pure and **synchronous** — same input, byte-identical output, no I/O, no clock, no network. Determinism is a hard invariant (golden-render tested). *Nothing in Phase 1 may make render async or impure.*
2. **One publish pipeline.** `runPipeline(site, principal, kind, snapshot, summary)` is the only path to production. Publish and restore share it. There is no second deploy path.
3. **Structured content only.** Blocks are typed, validated data (`validateBlocks` → `StoredBlock[]`), never author HTML. No page-builder, no widgets, no arbitrary markup. This is what makes render deterministic and XSS-safe by construction (Constitution Part 6).
4. **Deny-all RLS.** Every table denies by default. Server code reaches data through `svc()` (service role, server-authored queries) or `asUser()` (caller JWT, RLS-scoped). The browser never holds the service role.
5. **Two-App Law.** Exactly two user-facing apps: the Studio App (operator) and the Client App. The CMS is a **module inside the Client App / portal**, not a third application.
6. **Deliberately boring registry (Constitution Part 4).** Templates are data-driven, added as versioned entries; "as few templates as honesty allows"; **zero external origins** on published sites; determinism over flexibility.
7. **Approved-Plan spine.** Anything that mutates a live site flows through the one approval/audit spine where a review gate applies.

**Decision filter applied to invariants:** each one *increases trust* (determinism, RLS), *reduces maintenance* (one pipeline), and *preserves deterministic rendering* by definition. They are kept.

---

## 2. Database

### (A) Authoritative Phase 1 schema

All CMS state is per-site and tenant-scoped. Core tables (all exist):

| Table | Role | Key columns |
|---|---|---|
| `presence_sites` | The site aggregate root | `id`, `tenant_id`, `client_id`, `edition`, `template_slug`, `template_version`, `custom_domain`, `netlify_site_id`, `status` (`draft`/`live`/`archived`/`paused`/`deleting`), `last_published_at` |
| `presence_settings` | The **draft** working state | `site_id`, `blocks` (jsonb `SiteBlock[]`), `brand_kit` (jsonb), `dev_customization` (jsonb theme layer) |
| `presence_identity` / `_offerings` / `_faqs` / `_testimonials` / `_voice` / `_brand_profile` | Structured content domains | site-scoped rows |
| `presence_redirects` | 301/302 map | `site_id`, `from`, `to`, `code` |
| `presence_media` | Media library | `site_id`, `storage_path`, `alt_text` (NOT NULL), `mime`, `bytes`, `width`, `height`, `deleted_at` |
| `presence_snapshots` | **Immutable** point-in-time capture | `site_id`, `content` (jsonb), `media_manifest` (jsonb), `content_contract_version`, `template_slug`, `template_version`, `dev_customization`, `created_at` |
| `presence_publishes` | Publish/deploy ledger | `site_id`, `snapshot_id`, `kind`, `status` (`pending`→`deploying`→`live`/`failed`), `netlify_deploy_id`, `actor`, `actor_kind`, `change_summary`, `error_text`, timestamps |
| `presence_launches` | Named parallel drafts | `site_id`, snapshot ref, status, schedule |
| `presence_scheduled_publishes` | Deferred publishes | `site_id`, `run_at`, snapshot ref, status |
| `presence_content_library` | Reusable saved blocks | `site_id`, block jsonb |
| `presence_change_events` | Human-readable history | `site_id`, `entity_type`, `action`, `summary`, `provenance` |

**The draft/snapshot/publish separation is the spine:**
- **Draft** = `presence_settings` + content tables (mutable, what the client edits).
- **Snapshot** = `presence_snapshots` (immutable; created at publish; the exact bytes that were rendered — content contract version + template version + media manifest + dev layer all captured together so a restore is *reproducible forever*).
- **Publish** = `presence_publishes` (the ledger; one row per deploy attempt; status lifecycle; links snapshot → Netlify deploy id).

**Relationships:** `presence_sites 1—1 presence_settings`, `1—* presence_snapshots`, `1—* presence_publishes` (each → one snapshot), `1—* presence_media/_redirects/_launches`. Snapshots are never mutated or hard-deleted while a publish references them (retention below).

**Constraints (the ones that carry safety):**
- `presence_media.alt_text NOT NULL` — accessibility enforced at the database, not the UI.
- **Partial unique index on `presence_publishes(site_id) WHERE status IN ('pending','deploying')`** — this *is* the concurrency gate: only one in-flight publish per site, enforced by the DB, race-free. (Phase 1 delta: verify this index exists and is exactly this predicate — see §3.)
- `presence_snapshots.content_contract_version` — every snapshot records the contract it was authored against, so old snapshots always render.
- FK `presence_publishes.snapshot_id → presence_snapshots.id` (RESTRICT delete).

**Indexes:** `presence_publishes(site_id, created_at DESC)` (history), `presence_media(site_id) WHERE deleted_at IS NULL` (library), `presence_snapshots(site_id, created_at DESC)`, `presence_scheduled_publishes(run_at) WHERE status='scheduled'` (cron scan). `presence_sites(custom_domain)` unique.

**RLS strategy:** deny-all on every table. Reads/writes go through the edge function: `svc()` for server-authored, tenant-filtered queries; `asUser()` where the caller's JWT should scope the read. **Every `svc()` query that takes an id from the request must carry an explicit `tenant_id`/`site_id` filter** — this is the one class of bug that can bypass RLS, and it gets a dedicated audit (§9, §10). Client callers never select from these tables directly.

### (B) Phase 1 hardening deltas

1. **`presence_publishes` idempotency key** (new nullable column `idempotency_key text` + partial unique index): lets a retried publish request coalesce to one deploy (§2.API idempotency).
2. **Snapshot retention policy** (new): keep the live snapshot + the last **N=20** per site + any referenced by a launch/schedule; GC the rest on a weekly cron. Prevents unbounded jsonb growth at thousands of sites. Deterministic, bounded, cheap.
3. **Verify the one-in-flight partial index** exists with the exact predicate; add it if migration history is ambiguous.
4. **Media GC** (new): soft-deleted media (`deleted_at`) and orphaned uploads (row created, object never uploaded, >24h) reaped by the same weekly cron.

*Rejected (unnecessary complexity):* a separate `drafts` table (the settings row IS the draft), event-sourcing the content (snapshots already give point-in-time), per-block row storage (jsonb block arrays render deterministically and are simpler).

---

## 3. Publishing Engine

### (A) Authoritative pipeline — `runPipeline()`

The publish path today, in order, is the specification:

1. **Lifecycle guard.** Archived/deleting sites never publish; a paused site publishes only via an operator (staff), never the client. (409 `lifecycle_blocked`.)
2. **Snapshot persist.** On publish, `serializeDraft()` captures the full draft (content + media manifest + contract version + template + dev layer) into an **immutable** `presence_snapshots` row. Restore reuses the retained snapshot (no re-capture).
3. **Concurrency claim (atomic).** Insert `presence_publishes(status='pending')`. The **partial unique index rejects a second in-flight row** for the same site — the DB is the lock. No advisory locks, no Redis, no queue. If the insert conflicts, the caller gets `409 publish_in_flight`.
4. **Config validation.** Fail fast if `netlify_site_id` is unset or `NETLIFY_AUTH_TOKEN` is missing → `fail('config', …)`, publish row marked `failed` with a human reason.
5. **Render (pure, sync).** `getTemplate(slug, version)` → `renderSnapshot(snapshot, siteConfig)` → `FileMap` (path → HTML/CSS bytes). A render throw is caught → `fail('render', …)`. Deterministic: the same snapshot always yields the same bytes.
6. **Asset generation.** `fetchVariants(mediaManifest)` produces **EXIF/GPS-stripped WebP** variants; any failure → `fail('images', …)`. Images are baked into the file map — the published site self-hosts every asset (zero external origins).
7. **Deploy (atomic, content-addressed).** `deployFileMap(netlify_site_id, fileMap)`: SHA-1 digest every file → Netlify returns only the digests it lacks → upload only those → poll until ready. **The live site flips only when the deploy completes.** Same file map = same digests = nothing to upload (idempotent at the CDN layer). Status → `deploying` → `live`.
8. **Commit.** Mark `presence_publishes` `live` + `completed_at`; patch `presence_sites.status='live'`, `last_published_at`; `writeChangeEvent()` for history.

**Rollback** = publish the snapshot of a prior successful publish through the *same* pipeline (`kind='restore'`, no re-capture). Because snapshots are immutable and self-contained, rollback is deterministic and always available.

**Failure recovery:** every stage failure writes a terminal `failed` status + a human `error_text` and releases the in-flight gate (the row is no longer `pending`/`deploying`). No partial live state is possible — Netlify's deploy is atomic; a failed render/upload never reaches production.

### (B) Phase 1 hardening deltas

1. **Idempotency on publish.** Accept an `Idempotency-Key` header; if a `presence_publishes` row with that key exists for the site, return its current status instead of starting a new deploy. Protects against double-clicks and client retries.
2. **Cooldown.** Reject a new publish within **T=60s** of the last successful publish for the same site (`429 cooldown`, with `retry_after`). Cheap read of `last_published_at`. Protects Netlify rate limits and prevents thrash at scale. Deterministic and simple.
3. **Deploy poll timeout + async completion.** `deployFileMap` polls briefly; if Netlify is slow, the publish stays `deploying` and a **reconcile cron** (new) polls outstanding `deploying` rows to `live`/`failed`. Prevents a slow CDN from blocking the request or stranding a row. (This is the only place the deterministic-sync rule doesn't apply — deploy is inherently I/O; it lives *outside* render.)
4. **Concurrency at fleet scale.** The per-site gate already prevents same-site races. Add a **global concurrent-deploy ceiling** (e.g., ≤ K simultaneous Netlify deploys across all sites) via a lightweight counter table, so a burst of publishes queues rather than hammering the Netlify API. Bounded, observable.
5. **Structured publish telemetry** (§10): per-stage timing + outcome on every publish row, for p95 and failure-rate dashboards.

*Rejected:* a message-queue/worker system (the DB gate + cron reconcile covers Phase 1 scale at zero added infrastructure); blue/green environments (Netlify's atomic deploy already gives instant, safe cutover + instant rollback).

---

## 4. Preview System

### (A) Authoritative preview

- **Generation.** `/preview` renders the **current draft** through the *same* `renderSnapshot` used for production — preview and production are byte-identical except for asset URLs. No second renderer, so "what you preview is what you publish" is guaranteed by construction, not by discipline.
- **How it differs from production:** production bakes self-hosted, EXIF-stripped WebP variants into the file map; **preview references signed, time-limited transform URLs** for draft media that hasn't been published yet (the one preview-specific seam, already implemented in `lib/media.ts`). Preview HTML is served by the function, not deployed to Netlify.
- **Security.** Preview is authenticated (portal JWT, site-scoped) — a client previews only their own site. No preview content is publicly reachable; draft media is served via short-TTL signed URLs, never public bucket paths.
- **Performance.** Pure sync render is sub-millisecond; the cost is variant signing. Cache the rendered preview per draft-version hash so repeated previews don't re-sign.

### (B) Phase 1 hardening deltas

1. **Signed preview links (optional, bounded).** For "share a preview with a colleague," issue a **signed, expiring preview token** (HMAC over `site_id + draft_hash + exp`, same pattern as the existing signed OAuth state) that grants read-only render access without a portal login. Off by default; opt-in per site.
2. **Draft-version hash** on `presence_settings` (cheap content hash) to key the preview cache and the signed link.
3. **Explicit "preview is a draft" watermark** in the preview chrome so a client never mistakes preview for live.

*Rejected:* a separate preview deployment to Netlify (doubles deploy cost + introduces drift risk); a headless preview browser (the function renders HTML directly — no browser needed).

---

## 5. Template System

### (A) Authoritative template architecture

- **Registry.** `lib/render.ts`: `getTemplate(slug, version)` (sync, memoized), `templateIndex()` (metadata-first), `registryIntegrity()` (a mis-keyed template cannot ship). Templates are **data + a pure render function**, keyed by `slug@version`.
- **Manifest.** Each template declares its manifest (the fields/sections it accepts, defaults, and the block types it realizes). The manifest is the contract between content and render.
- **Content contract.** Every snapshot records `content_contract_version`. A template version renders any content authored against a contract version it supports. **Old sites always render** because their snapshot pins both the template version and the contract version.
- **Validation.** `validateBlocks()` enforces that stored blocks match `REALIZED_BLOCK_TYPES` and the manifest before they can be saved or rendered — invalid content cannot enter a snapshot.
- **Industry realization.** Industry vocabulary (`lib/industry_vocab.ts`) + structured components (`lib/site_components.ts`) let one engine speak correctly per industry (plumber → Plumber/Services schema, not Restaurant/Menu) **without new templates** — `templateSlugForIndustry` picks a default.

### (B) Phase 1 hardening deltas

1. **Template version lifecycle doc** (states: `draft` → `active` → `deprecated`; never delete a version a live snapshot pins). A registry-integrity test already guards keys; add the lifecycle contract in writing.
2. **Contract-version compatibility matrix** (which template versions render which contract versions) as a tested table, so an upgrade is provably backward-compatible.

**How new industries are added without touching core infrastructure:** add an industry vocabulary entry + (optionally) a component preset; the existing template renders it via the manifest. No render change, no publish change, no schema change. This is the extensibility guarantee (§11).

*Rejected:* per-industry bespoke templates (Constitution Part 4 — "as few templates as honesty allows"; presets + vocabulary cover the need); a template DSL/scripting layer (would break determinism and open an injection surface).

---

## 6. Media Library

### (A) Authoritative media architecture (`lib/media.ts`)

- **Uploads.** Two-step: the function issues a **signed upload URL** and creates the `presence_media` row in one call (`createUpload`). The browser uploads directly to storage with the signed URL; it never holds credentials.
- **Storage.** Private bucket `presence-media`, path `{siteId}/{uuid}.{ext}` — site-scoped by key prefix. No public bucket access.
- **Validation.** MIME allow-list (JPEG/PNG/WebP images, PDF documents); size caps (**10 MB** images, **25 MB** documents); **alt text required** — enforced by a DB `NOT NULL` constraint, so it cannot be bypassed.
- **Transforms + EXIF.** At **publish**, images become **EXIF/GPS-stripped WebP** variants baked into the deployed file map — the live site self-hosts every asset (zero external origins, no hotlinking, no privacy leak from camera metadata).
- **Signed URLs.** Draft/preview media served via short-TTL signed transform URLs; published media served as static self-hosted files.
- **Documents (PDF).** Stored, versioned, served as signed downloads.

### (B) Phase 1 hardening deltas

1. **Content-type verification** beyond the declared MIME: sniff magic bytes on first server touch (at variant generation) so a `.jpg` that is actually HTML is rejected before it can be served. Closes the polyglot-upload risk.
2. **Media GC** (shared cron, §2): reap soft-deleted + orphaned-upload rows/objects weekly.
3. **Per-site media quota** (count + total bytes) with a clear error at the cap — protects storage cost at thousands of sites.
4. **Strip EXIF at upload as well as publish** (defense in depth) so preview-served originals are also clean.

*Rejected:* an external image CDN/transform service (self-hosting keeps zero external origins + fixed cost); user-supplied SVG (script-bearing; not in the allow-list, kept out).

---

## 7. Client Experience (the CMS module in the portal)

### (A) What the client sees and does

The CMS is a module inside the Client App portal — one login, role-appropriate. The workflow is **edit → preview → publish**, on the existing endpoints:

- **Navigation.** A left rail of the site's pages/sections; each section edits a structured block (headline, text, image picker, list) — never raw HTML. Media picker pulls from the site's library.
- **Editing.** Field-level structured editing. Saving writes the draft (`presence_settings.blocks` via the block editor endpoints). "Insert from content library" reuses saved blocks.
- **Draft status + unsaved changes.** The portal shows a clear draft/dirty state; the draft-version hash (§4) drives "you have unpublished changes."
- **Preview.** One click → `/preview` renders the current draft identically to production, watermarked as a draft.
- **Validation errors.** `validateBlocks` returns field-level, plain-language errors *before* publish (no jargon, per the copy standard). A block that fails validation cannot be saved or published.
- **Publish.** One action → `runPipeline`. The portal shows live status (`pending`/`deploying`/`live`/`failed`) and the human error reason on failure. Cooldown/idempotency handled server-side (§3).
- **Version history + rollback.** `/publishes` lists past publishes (who, when, summary). "Restore this version" re-publishes that snapshot through `/restore`. If the site is studio-paused, the client requests rollback and an operator approves (Approved-Plan spine).

### (B) Phase 1 hardening deltas

1. **Optimistic-lock on draft save** (draft-version hash as an `If-Match`): two editors (owner + a teammate) can't silently clobber each other; the second gets a "refresh — this changed" prompt. Reuses the hash already added for preview.
2. **Adopt the shared state components** (`ddsEmpty`/`ddsError`/`ddsToast`/skeleton) for the CMS's empty/loading/error/success states — consistency with zero new UI framework.
3. **"What will change" summary** on the publish confirm (diff of blocks vs. the live snapshot) — increases trust before a live change.

*Rejected:* real-time collaborative editing (CRDTs) — enormous complexity for a single-owner-plus-occasional-teammate reality; the optimistic lock is the right-sized answer.

---

## 8. Admin Experience (Studio App)

### (A) What the operator does

- **Site creation.** Create `presence_sites` (tenant, client, edition, template) — onboarding captures industry → default template.
- **Domain assignment.** Set `custom_domain` + `netlify_site_id` (the hosting link). Config-validated by the publish pipeline (a site with no `netlify_site_id` fails publish with a clear reason).
- **Publish / rollback for the client.** Operators can publish or restore any site by id (staff principal), including studio-paused sites the client can't.
- **Diagnostics.** `/health`, `/publishes` (deploy ledger + `error_text`), `/changes` (human history), the deploy status per publish. The admin sees *why* a publish failed, in words.
- **Template management.** Register/deprecate template versions in the registry; the integrity guard prevents a mis-keyed template from shipping.
- **Deployment status.** Live view of `presence_publishes` status across the fleet.

### (B) Phase 1 hardening deltas

1. **Operator programmatic auth path** (P5, already built): the `x-operator-secret` credential gives a clean privileged caller for fleet operations — no service-role in a browser.
2. **Fleet publish dashboard** reading `presence_publishes` (in-flight, failed-last-24h, p95 deploy time) — the operational surface for many sites.
3. **Support "publish on behalf of + audit"** already flows through the change-event log; surface it in the admin timeline.

---

## 9. Security Review

**Threat model:** the adversary is (a) a malicious or compromised client trying to reach another tenant's data or inject script into a published site, and (b) an attacker abusing public endpoints (upload, checkout, preview).

| Vector | Control (mostly existing) | Phase 1 delta |
|---|---|---|
| **Cross-tenant read/write** | Deny-all RLS; every `svc()` query tenant/site-filtered; caller JWT resolves to a scoped principal | **Audit every `svc()` query that takes a request id** for a missing tenant/site filter (the one RLS-bypass class). Confirm the all-zero "global sentinel" `site_id` can't be used for cross-tenant reads. |
| **XSS on published sites** | Structured content only — no author HTML; render escapes all text; blocks are typed data | Add a golden test asserting a hostile string in every block field renders escaped. |
| **CSRF** | Token-in-header auth (not cookies) for the API; the browser can't be tricked into an authed cross-site POST | Confirm no state-changing route relies on ambient cookie auth. |
| **File-upload abuse** | MIME allow-list, size caps, private bucket, signed URLs, EXIF strip, no SVG | **Magic-byte sniff** (polyglot defense); per-site quota; strip EXIF at upload too. |
| **Privilege escalation** | RBAC + role-scoped principal; operator gate = `staff`/`system`; the new operator secret is server-only, fail-closed, not the service-role | Verify reviewer/agency roles can't reach publish for sites outside scope. |
| **Replay attacks** | Signed OAuth state has a timestamp + tolerance; Stripe webhook verifies signature + 5-min window + idempotency ledger | Add `Idempotency-Key` on publish (also a replay guard). |
| **Token leakage** | Netlify token, service role, Stripe secret live ONLY as function secrets; never in builds, clients, or other functions; no secret logging | Keep; re-verify no new log line prints a secret/body. |
| **Secrets** | All via `Deno.env`; nothing hardcoded (verified) | Register `OPERATOR_SECRET` + `STRIPE_WEBHOOK_SECRET` in the health inventory (done/pending owner). |
| **Audit logging** | `presence_change_events` (human history) + `stripe_webhook_events`/`stripe_payments` (money) + the Approved-Plan audit | Ensure every publish/restore/rollback writes an actor-attributed change event (it does). |

**Decision filter:** each control *increases trust* and is already load-bearing; the deltas are bounded audits and one magic-byte check — no new subsystems.

---

## 10. Testing Strategy

The existing suite (78+ pure suites, golden render, invariants 14/14, zero TS errors across all three functions) is the baseline. Phase 1 additions:

- **Unit.** `validateBlocks`, `brand_kit` derivation, `serializeDraft` shape, redirect resolution, media MIME/size/magic-byte checks. (Most exist.)
- **Golden render tests.** For every template@version: a fixed content fixture → byte-identical HTML/CSS. This is the determinism guarantee; extend to cover every block type + the hostile-string escape assertion (§9). **A render change that alters output must be an intentional golden update, never a silent drift.**
- **Integration.** Full draft → snapshot → publish → (mock Netlify) → live → restore, against staging. Covers the one-in-flight gate (concurrent publish → one 409), idempotency (same key → one deploy), cooldown (rapid publish → 429).
- **Security tests.** Cross-tenant access attempts return 403/empty; upload of a disguised file rejected; preview of another site denied; publish outside role scope denied.
- **Regression.** The full pure sweep runs on every change (see CI delta below).
- **Load testing.** Measure real p95 of render + publish and Netlify deploy latency on a large site; find the safe global concurrent-deploy ceiling (§3).
- **Disaster recovery.** Documented, tested drill: restore the DB from PITR; re-deploy the live snapshot for a site from `presence_snapshots` (snapshots make every live site reproducible from the DB alone).
- **Manual QA.** Authed browser pass of the CMS module (edit/preview/publish/rollback) + mobile + assistive-tech, since headless can't run a browser.

**Phase 1 delta — CI.** Today tests run only via a local Deno shim. Stand up a CI runner that executes the pure sweep + golden render on every push. This is the single highest-leverage operational addition: it turns "we ran the tests" into an automated gate.

---

## 11. Future Expansion (no Phase 1 architecture change required)

The draft → snapshot → render → deploy spine + the versioned template/contract registry + structured blocks are deliberately general. Each future capability is an **additive** entry, not a re-architecture:

| Future capability | How it lands on the existing spine |
|---|---|
| **Multiple templates** | New `slug@version` in the registry. Already true (3 today). |
| **Multiple industries** | New industry vocabulary + component preset; the same templates render them. No core change. |
| **Landing pages** | A page is a block collection; add a `page` scope to the content model (multiple block arrays per site) — snapshot/render/publish unchanged. |
| **Blogs** | `presence_posts` already exists; a post is structured content rendered by a post template version; publish pipeline unchanged. |
| **Ecommerce / Booking / Memberships** | New block types (product, booking-slot, member-gate) + new content tables; render stays pure (the block renders a form/embed that posts to a capability endpoint — Stripe/booking already exist as services). No new deploy path. |
| **AI-generated pages** | AI proposes **structured blocks** (not HTML) → `validateBlocks` → the same draft → the same publish. Determinism preserved because AI output is validated content, never markup. |
| **Mobile editing** | The CMS is already API-first + structured; the Client App renders the same editor on mobile (the mockup shows this). No backend change. |
| **White-label agencies** | The agency spine + per-agency branding already exist; a white-label published site is a brand-kit + domain difference, not an engine difference. |

**The guarantee:** because content is structured and validated, render is pure and versioned, and deploy is content-addressed and atomic, *every* expansion above is "new data + new block types," never "new pipeline." That is the entire point of the Phase 1 architecture.

---

## 12. Phase 1 build list (the actual deltas, consolidated)

Everything else in this document is *document-and-verify*. These are the bounded engineering tasks:

1. **Publish robustness:** `Idempotency-Key` on publish; 60s cooldown; deploy-poll timeout + a reconcile cron for stuck `deploying`; global concurrent-deploy ceiling; per-stage publish telemetry.
2. **Data hygiene:** verify the one-in-flight partial index; snapshot retention GC (keep 20 + referenced); media GC + per-site quota; draft-version hash column.
3. **Preview:** optional signed/expiring preview links; preview cache keyed by draft hash; draft watermark.
4. **Media:** magic-byte sniff; EXIF strip at upload; content-type verification.
5. **Client UX:** optimistic-lock on save (If-Match on draft hash); adopt shared state components; "what will change" publish summary.
6. **Security:** `svc()` id-scoped query audit; global-sentinel cross-tenant check; hostile-string golden test; role-scope publish test.
7. **Testing/ops:** CI runner (pure sweep + golden render on push); load test → set the concurrency ceiling; documented + drilled DR restore.

**None of these rewrite the engine.** Each is an additive guard on an existing, production, deterministic system.

---

## 13. Decision-filter summary

Every recommendation was tested against: *increases trust? simplifies operations? reduces maintenance? improves scalability? preserves deterministic rendering?* The rejections are as important as the inclusions — no message queue, no second renderer, no drag-and-drop builder, no per-industry templates, no CRDT collaboration, no external image CDN, no author HTML. The Phase 1 architecture is **one deterministic pipeline, hardened for scale** — which is exactly what a many-thousand-site SaaS should be, and exactly what already exists to build on.
