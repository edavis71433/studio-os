# Phase DAM — Studio Asset Library

*Built as a lens + lifecycle over the EXISTING `presence_media` rows — no new store, no new bucket, no duplicate pipeline. Storage, multi-tenancy, RLS, the EXIF-strip/variant image pipeline, focal points, and version history (via snapshots/publishes) are all reused. Migration 0063 adds six columns to `presence_media`; a pure core + a `/assets/*` API do the rest.*

## Data model (migration 0063 — extends `presence_media`)
`tags` (jsonb) · `collection` (text) · `metadata` (jsonb) · `content_hash` (text) · `brand` (bool) · `asset_status` (draft/pending/approved/published/archived, default **approved** so nothing an owner already uses becomes unavailable). Three partial indexes for collection/status/hash lookups.

## What each DAM item reuses
| Item | Delivered by |
|---|---|
| DAM-1 Central Library · DAM-2 Universal Picker | `GET /assets` (search/filter over `presence_media`); the existing media grid + picker are the surfaces |
| DAM-3 Collections · DAM-4 Tags · DAM-5 Metadata | columns + `PATCH /assets/:id`, `GET /assets/collections`, `GET /assets/tags` |
| DAM-6 AI Asset Search (on-demand) | `searchAssets` — ranked keyword search over alt/tags/metadata/filename, computed per query (no index) |
| DAM-7 Image Transformations | the **existing** variant pipeline + focal points (`focal_x/y`) — reused, surfaced |
| DAM-8 Duplicate Detection | `detectDuplicates` — content hash when present, else a bytes×dimensions heuristic (server never sees bytes on signed-URL uploads) |
| DAM-9 Version History | the **existing** snapshot/publish history — an asset's use is versioned with the site; no parallel history |
| DAM-10 Brand Library | the `brand` flag + `?brand=true` filter |
| DAM-11 Usage Tracking | `usageMap` over the renderer's own references (offerings.media_id, posts.hero_media_id, settings logo/og) — "in use" means exactly what publishes |
| DAM-12 Safe Delete | `canDelete` + `DELETE /assets/:id` refuses an in-use asset (archive instead) |
| DAM-13 Asset Health | `assetHealth` (missing alt / unused / oversized / duplicate / used-but-unapproved) — surfaced in the Photos view; plain findings, no scores |
| DAM-14 Agency Asset Library | the existing agency portfolio + starter-kit sharing spans sites; per-site libraries roll up there |
| DAM-15 Approval Workflow | `assetApprovalPolicy` + `nextAssetStatus` + `POST /assets/:id/status`, reusing the approval philosophy |

## Policy-based lifecycle (DAM-15) — never friction where it isn't needed
- **Solo owner → immediate**: any non-archived asset is usable; the owner may approve a draft directly.
- **Agency → optional**: approval available, not forced; only `pending` is held back.
- **Enterprise/team → required**: only `approved`/`published` assets are usable on the live site.
Policy is derived from the feature edition (`editionFromPlan`), so the same asset row behaves correctly per account without a second system. Existing rows default to `approved`, so no current customer gains friction.

## API (`/assets/*`, over `presence_media`)
`GET /assets` (?collection=&tag=&status=&brand=&q=, returns `in_use` + `policy`) · `GET /assets/collections` · `GET /assets/tags` · `GET /assets/health` · `GET /assets/duplicates` · `GET /assets/usage` · `PATCH /assets/:id` (tags/collection/metadata/brand/alt) · `POST /assets/:id/status` (policy-gated transition) · `DELETE /assets/:id` (safe delete).

## UI
The Photos view now shows the library's **plain-English health** (from `/assets/health`) — "✓ Your library looks healthy" or "3 could use a description · 2 not used yet." The fuller in-grid library UI (collections/tags/search chips, per-asset lifecycle controls) is a natural follow-up: it needs the media-list projection to carry the DAM columns + variant URLs together, which is a modest surface change, not new architecture.

## Testing
`dam_test.mjs` **32/32** (policy, lifecycle transitions, duplicate detection incl. the hash-less heuristic, usage, safe delete, health findings with no-score guarantee, collections/tags rollups, on-demand ranked search). Backend typechecks; `presence.html` parse-clean; invariants 14/14, render 28/28. Migration 0063 applied staging + prod; function deployed both envs; `/assets*` verified serving. Frontend follows the UI-staging pattern.

## CTO note
The DAM is deliberately thin *architecturally* — it's organization and lifecycle over the asset rows that already exist, which is exactly right: a photo library that invented a second store, a second permission model, and a second image pipeline would be the wrong build. The one place to invest next is the **in-grid library UI** (making collections/tags/search first-class in the Photos view and the picker), since the backend now supports it fully.

**Phase DAM — Studio Asset Library complete.**
