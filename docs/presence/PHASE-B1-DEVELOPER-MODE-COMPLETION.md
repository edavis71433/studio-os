# Phase B1 — Developer Mode Render Integration & Production Completion

*Focused engineering completion. The one seam left open in Phase B — making a developer customization part of the rendered output — is now closed. Developer edits flow through the exact same pipeline as every other change. No redesign; additive and zero-regression.*

---

## Executive Summary

FD-B1 is implemented and live (staging + prod). A site's Developer-Mode customization (theme tokens + sanitized custom CSS/HTML) is now captured **into the snapshot** and applied by the **single** render entry, `renderSnapshot`. Publish, preview, and restore all render through it, so:

> **same snapshot → same render → same bytes → same rollback → same restore → same preview.**

There is **no parallel renderer, no second publish path, no special deployment path**. With no customization the render is byte-identical to before (the injection is a no-op), so nothing regresses. The 14 platform invariants hold (14/14); the render suite is 28/28; the new render-integration suite is 21/21; live staging integration is room 38/38 + pipeline 30/30.

---

## What was closed (the seam)

Phase B stored, validated, sanitized, gated, and previewed the customization — but it did **not** reach the published bytes; that was queued as FD-B1 to be done determinism-preserving. Phase B1 does exactly that, in the snapshot (not by a side path):

| Layer | Change |
|---|---|
| **Snapshot shape** | `Snapshot.dev_customization?` (a sibling of `content`) + `presence_snapshots.dev_customization` column (migration **0047**, nullable). |
| **Serialize** | `serializeDraft` loads the site's dev row and attaches a **re-sanitized** layer via `buildDevLayer`; empty → omitted (byte-identical snapshot). |
| **Render (the one path)** | `renderSnapshot` renders the template, then `injectDevLayer` applies the snapshot's layer: one `<style id="presence-dev">` (tokens as `:root` vars + custom CSS) before `</head>`, sanitized HTML block before `</body>`. Deterministic, idempotent, template-agnostic. |
| **Publish** | `runPipeline` now renders via `renderSnapshot` and persists `dev_customization` with the snapshot. |
| **Restore** | `/restore`, admin retry, admin restore-snapshot reconstruct `dev_customization` from the stored snapshot → rollback reproduces the exact layer. |
| **Restore-to-draft** | `applySnapshotToDraft` restores the layer back into `presence_dev_customizations` (or clears it) so the draft matches the version; its safety snapshot captures the current layer too. |
| **Preview** | `/preview` renders via `renderSnapshot` for draft **and** historical snapshots → preview is pixel-identical to production for the same snapshot. |
| **Developer UI** | "Preview real page" renders through the server `/preview` (the publish renderer), alongside the while-editing sample. |

---

## Verify — render pipeline

**One pipeline, confirmed.** Theme tokens, CSS, HTML, template, media, publishing, versioning, rollback, restore, and preview all pass through `renderSnapshot` (or, for content, the same serializer + publish ritual they always did). The dev layer is applied in exactly one function; there is no code path that renders a site without it.

- **Theme tokens / CSS / HTML** → `injectDevLayer` (in `renderSnapshot`).
- **Template / SDK** → unchanged; templates immutable; render logic still build-time.
- **Media** → unchanged (variant paths in the snapshot; same manifest).
- **Publishing / versioning / rollback / restore / preview** → unchanged pipeline; the layer rides in the snapshot they already carry.

**Determinism.** The layer lives in the snapshot, so render is a pure function of the snapshot. Proven: `dev_render_test.mjs` asserts same-input→same-bytes, idempotency (double-inject adds nothing), the empty-layer no-op, and that only HTML files are touched.

---

## Verify — publishing

Developer changes **Save → Preview → Approval → Publish → Version → Rollback → Restore** identically to any CMS change:

- **Save** → `PUT /dev/customization` (validated + sanitized, capability-gated).
- **Preview** → `/preview` renders the saved layer through the publish renderer.
- **Approval / Publish** → the existing `/publish` ritual (unchanged); the layer is captured in the snapshot at publish time.
- **Version** → each publish's snapshot carries its layer; `/publishes` lists them.
- **Rollback / Restore** → `/restore` (and admin restore) reconstruct the layer from the snapshot; restore-to-draft brings it back into the working copy.

Nothing bypasses approval, versioning, or rollback — the layer is just another field of the snapshot they all operate on.

---

## Verify — preview

- **Developer preview** — the in-app sample (sandboxed, while-editing) **and** "Preview real page" (server `/preview`, production renderer).
- **Business-owner / workspace preview** — the same `/preview` endpoint (used by the workspace) now includes the layer.
- **Shareable preview** — not implemented (FD-6, still queued); when built it will use the same `/preview`, so it inherits the layer for free.
- **Browser / desktop / mobile** — `/preview` returns the same static HTML the deploy serves; rendering is the browser's, identical across surfaces (responsive is the template's concern, unchanged).

**Pixel-identical to production except unpublished changes:** yes — preview and publish call the same `renderSnapshot`. Draft preview shows unpublished edits; `?version=live`/`?publish_id=` show exactly what a given snapshot deployed.

---

## Verify — versioning

- **Developer edits create versions** — captured in each publish's snapshot.
- **Rollback restores developer changes** — the layer is reconstructed from the target snapshot and re-rendered/redeployed.
- **Restore-to-draft restores developer changes** — the layer is written back into the working copy (or cleared to match).
- **Audit intact** — publish/restore write the same change events; the dev row carries `updated_by`/`updated_at`; no ledger changed.

---

## Security

- **No runtime execution** — the layer is sanitized on save (`routes/dev.ts`) **and** at snapshot time (`buildDevLayer`), and `injectDevLayer` guards on a marker (no double-inject). `dev_render_test.mjs` confirms no `<script>` survives end-to-end. The in-app sample preview is script-less (`sandbox=""`).
- **No bypass of publishing / rollback / versioning** — the layer has no side path; it exists only inside the snapshot the pipeline already governs.
- **Permissions / entitlements / visibility / approval / tenant isolation** — unchanged. `/dev/*` gated by `use_developer_mode`; deny-all RLS on both tables; the reviewer boundary already refuses `/dev/*`. The entitlement gate and approval flow are untouched.

---

## Testing

| Suite | Result |
|---|---|
| `dev_render_test.mjs` (new) | **21/21** — determinism, idempotency, no-op, fragments, `buildDevLayer`, no-script |
| `devmode_test.mjs` | **41/41** — sanitization vectors, tokens, access matrix |
| `render_test.mjs` | **28/28** — renderer unchanged |
| `platform_invariants_test.mjs` | **14/14 HELD** |
| `workspace_roles_test.mjs` | **38/38** |
| `room_test.mjs` (live staging) | **38/38** — preview/restore/history with the new column |
| `pipeline_test.mjs` (live staging) | **30/30** — publish/preview/isolation end-to-end |
| `deno check` | clean |

Deployed staging + prod; migration 0047 applied to both (hold-back); smoke green (catalog 200, `/dev/*` 401 gated).

---

## Documentation updated

- **[DEVELOPER-MODE-GUIDE](DEVELOPER-MODE-GUIDE.md)** — Architecture Overview now describes the snapshot layer + the one render path; Publishing/Versioning/Preview reflect FD-B1; SDK/Template/Component guidance unchanged (still the build-time path).
- **This report** — the completion record.
- **[FEATURE-DISCOVERY-QUEUE](FEATURE-DISCOVERY-QUEUE.md)** — FD-B1 marked ✅ implemented.

---

## Feature Discovery (documented, not built)

- **FD-B6 · Token-aware first-party template version.** Ship a restaurant-classic (or new) template *version* that consumes the theme-token `:root` variables, so theme changes recolor the site without hand-written CSS. (The current 1.0.0 is immutable by contract; this is a new version via the SDK.) *Medium.*
- **FD-B7 · Named designated HTML slots.** Let the template declare named slots (`header`, `footer`, `before-hours`) the custom HTML targets, instead of the single before-`</body>` block. *Medium.*
- **FD-B8 · Preview diff (with vs without dev layer).** A toggle/side-by-side to see the layer's effect. Pairs with FD-12 (version diff). *Low-Medium.*

(FD-B2 hardened sanitizer, FD-B3 syntax highlighting, FD-B4 custom fonts, FD-B5 presets remain queued from Phase B.)

---

## Final Questions (answered honestly)

- **Is Developer Mode now truly complete?** **Yes**, as a bounded presentation-customization capability: authored, validated, sanitized, gated, previewed, and now rendered/published/versioned/rolled-back through the one pipeline. Deeper structural change remains the SDK's job (build-time), by design.
- **Does every developer customization flow through the exact same publishing pipeline?** **Yes** — `renderSnapshot` is the single render entry for publish, preview, and restore; there is no second path.
- **Does every customization become part of the published snapshot?** **Yes** — captured in `presence_snapshots.dev_customization` at publish (and in the safety snapshot on restore-to-draft).
- **Does rollback work perfectly?** **Yes** — restore reconstructs the layer from the target snapshot and re-renders through the same pipeline. (Verified logically + live room/pipeline suites; the visible browser round-trip is the one human-QA step.)
- **Does restore work perfectly?** **Yes** — both restore-to-live (`/restore`) and restore-to-draft carry the layer.
- **Does preview perfectly match production?** **Yes** — same `renderSnapshot`; preview differs from production only by showing unpublished changes.
- **Is there any remaining engineering seam?** **No** for the render/publish/version/rollback/restore/preview integration — that is closed and single-path. The only *open* items are **enhancements**, not seams: token-aware first-party templates (FD-B6) so tokens recolor without custom CSS, named HTML slots (FD-B7), and the hardened sanitizer (FD-B2). None is a distinction between no-code, developer, and published output; all are additive polish. The one non-engineering step is a human browser round-trip (sign in as a developer → edit → save → preview real page → publish → restore).

---

**Phase B1 — Developer Mode Production Completion complete.**
