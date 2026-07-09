# Phase DAM-1 — Files Excellence (close-out)

*The existing DAM, evolved into the customer-facing **Files** experience. One store, one approval philosophy, one publish pipeline — nothing duplicated. Customers only ever see "Files."*

## What shipped
- **`files.html`** — a calm, mobile-first browser: collections rail (All · Favorites · Photos · Brand · Documents · Templates · Downloads · Archive), thumbnail grid, search, sort, drag-drop upload, and a detail panel (rename/caption/tags/collection/favorite, **where-used**, versions, replace/duplicate/download/archive/delete).
- **Website awareness (the value-add):** a single, authoritative usage graph mirroring the renderer exactly (`settings.logo_media_id`, `settings.og_media_id`, `offerings.media_id`, published `posts.hero_media_id`) — fixing a prior inconsistency where `/assets` read the wrong source for logo/og. Each file knows where it's used, and whether it's *live* (in the current published snapshot's manifest).
- **Replace safely + versions:** `POST /assets/:id/replace` repoints every reference old→new, carries the old file's organization forward, retains the old file as a soft-deleted prior version (version chain in `metadata`), and records one change event. `POST /assets/:id/rollback` reverses it. No new tables, no second versioning system — reuses `presence_media` + change events + the existing publish/snapshot pipeline for going live.
- **Duplicate / download** — server-side storage copy; signed original downloads.
- **Documents (PDF):** the ONE store now accepts `application/pdf` (migration 0065) — contracts/brand guides/downloads are real files, served as signed downloads (not image-transformed, not auto-published).
- **Reuse, not rebuild:** approvals ride the existing `asset_status` + edition policy (immediate/optional/required); permissions ride Edition × Role + SC-1 scope; the DAM presents as **Files** everywhere (terminology migration).

## Reused, never duplicated
One bucket (`presence-media`) · one table (`presence_media`) · one approval philosophy (`asset_status` + policy) · one publish pipeline (`runPipeline`) · one audit ledger (`writeChangeEvent`) · one permission model (Edition × Role + SC-1). No new storage, metadata store, approval engine, or publisher was created.

## Verification
- **Pure:** `files_test` 21/21 (kinds, display names, usage summary, replace carry-forward, PDF acceptance), `dam` 32/32.
- **Live integration (real staging Postgres + Storage, isolated rows):** `files_integration_test` **16/16** — replace repoints an offering + builds the version chain; rollback reverses it and restores the prior version; duplicate copies the storage object and the copy is downloadable.
- The live pass **caught a real bug**: `signThumb`/`signDownload` sent `expiresIn` in the query string, but the sign endpoint requires it in the body — downloads returned null and grid thumbnails silently failed. Fixed to the body form; re-verified 16/16.
- Backend `deno check` clean; deployed to staging + prod; migration 0065 applied to both.

## Final review — answered honestly
- **Replace Dropbox for most small businesses?** For their *website + business* files — yes: photos, brand, documents, downloads, with where-used and safe replace Dropbox doesn't have. As a general cloud drive (arbitrary file types, folders, sync client) — no, nor should it try; that's not the job.
- **Trust it with my own company?** Yes for the shipped scope — the mutation flows are now proven against a real database, and tenant isolation is intact (SC-1/SC-2).
- **Premium?** Yes — calm grid, real thumbnails (post-fix), a detail panel that explains *where a file is used* in plain language. Not enterprise clutter.
- **One operating system?** Yes — it mounts in the one shell, forwards the SC-1 scope, and speaks Files, not DAM.
- **Accidentally duplicated anything?** No new systems. One residual: the Website editor keeps an in-context image view (relabelled Files, deep-linked) — an editing convenience, not a second destination.
- **Any feature without customer value?** No. AI auto-alt-text was deliberately **not** built (no model, real cost, weak ROI) — the existing missing-alt nudge + content-hash dedupe cover the need cheaply.
- **Remove anything before launch?** No.
- **Still missing / who does Files better, specifically?** **Video** (Dropbox/Google Drive: streaming + transcoding — we defer; needs its own infra). **Bulk operations** (Google Drive: multi-select move/tag/delete). **Folder nesting** (Drive/Dropbox: we use flat collections). **In-browser PDF preview** (Drive renders inline; we download). None block launch; each is a scoped follow-up.

**Phase DAM-1 — Files Excellence complete.**
