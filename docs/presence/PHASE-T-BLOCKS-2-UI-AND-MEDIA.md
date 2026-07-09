# Phase T (continued) — Block Authoring UI, All-Template Parity & Media Blocks

*Continues Phase T in order: FD-T15 (authoring UI), FD-T16 (blocks in every template), FD-T17 (media-bearing blocks). Also locks the permanent **Two-App Law** into all four governing documents. Reuse-first throughout — one storage column, one validator, one renderer, one media pipeline, one publish/approval flow. Deployed staging + prod.*

---

## 0. Two-App Law (permanent) — added to all four documents

Per the owner's directive, the Two-App Law is now a permanent architectural law, recorded in:
- **Product Constitution** — new `constitution/10-amendment-6-two-app-law.md`.
- **Architecture v1.0** — a formal "The Two-App Law" section.
- **Launch Board** — a pinned note at the top.
- **Roadmap** — a Standing Product Rule.

The law: Studio OS is **exactly two** user-facing apps — the **Studio App** (Freelancer/Agency; modules by edition) and the **Client App** (one role-appropriate experience). CMS/CRM/DAM/Analytics/etc. are **modules, not applications**; no third customer-facing app without an explicit amendment. Enforced server-side (`middleware/feature.ts`, Phase FE-1). The current Admin Tool + Client Portal are transitional (retired on release, migrated in; services unchanged).

---

## FD-T15 — Block Authoring UI (owner-facing)

`presence.html` Design view gained a **“Content blocks”** editor that reuses the exact `/settings` endpoint the block engine already reads:
- Add any block from the catalog; fill it; reorder (↑/↓); remove.
- **Working copy → explicit “Save content blocks”** so a half-filled block isn't stripped mid-edit; on save the server validates/caps and returns the cleaned set.
- Text blocks (features, stats, team, process, pricing, certifications, service areas) use compact line editors (`Title | detail`), CTA uses labelled inputs.
- Blocks join the existing “Your home page” order/visibility machinery via their `block_<type>` keys.

No new endpoint, no new storage — it writes the same `presence_settings.blocks` the serializer validates and the templates render. The inline script is syntax-verified (`new Function`); a human browser pass is the normal QA step (not a launch gate).

## FD-T16 — Blocks realized across every template

`renderSiteBlocks` / `BLOCK_CSS` are template-agnostic; they were wired into **`editorial`** and **`restaurant-classic`** exactly as in `business-classic` — blocks join each template's home section-order machinery and inject their JSON-LD. **Full block parity across all three families.** The golden baseline (restaurant-classic) was regenerated (the only diff is the additive `BLOCK_CSS` in the stylesheet; all structural/schema/determinism assertions unchanged).

## FD-T17 — Media-bearing blocks

Four media blocks, all resolving media IDs → `MediaRef` through the serializer's existing **`ref()`** (so block photos land in the media manifest and get variants — **one media pipeline, reused**):
- **Gallery** — a responsive figure grid; alt text + figcaption per photo.
- **Before / after** — labelled Before/After pairs with an optional caption; drops a pair if either image is missing.
- **Video** — a **poster image + link-out**, never an external `<iframe>` (constitution Part 4: the published site has **zero external origins**); resolves an optional poster.
- **Team photos** — the team block renders a member photo when set.

**Two shapes, cleanly separated:** `validateBlocks` produces the *stored* shape (media as validated UUIDs); `resolveBlockMedia(stored, ref)` produces the *render* shape (media as `MediaRef`), called once in the serializer. The templates consume only resolved blocks.

**UI:** gallery, video, and before/after have structured editors that reuse the existing `openPicker` photo library. Team-member photos are **engine-complete** (render when a `media_id` is present) with the in-editor picker tracked as **FD-T18** (V1.1, browser-QA-gated).

---

## Constitution compliance

- **Part 4 (templates):** determinism (pure render, identical bytes for identical input), a11y (lists/headings/labelled before-after/alt text), and **zero external origins** (video is poster+link, never an embed).
- **Part 6 (no page-builder/widgets):** blocks are *chosen-and-filled structured content* (typed fields → deterministic render), an extension of the content contract like offerings/FAQs — **not** free-form layout or runtime code.
- **Reuse / no duplication:** one `blocks` column (migration 0068), one validator, one renderer used by all three templates, the existing media `ref()` pipeline, the existing publish/approval/preview flow, the existing `/settings` endpoint and photo picker. **No new AI.**

---

## Testing & deploy

- **`site_blocks_test.mjs` — 38/38** (validation incl. media-ID/UUID + http-only video + XSS-escaping + determinism; `resolveBlockMedia` resolution/drop behavior; render of every block incl. the no-iframe video check; catalog agreement; template integration).
- **Regression:** full pure sweep **69/69** — render 28/28 (golden regenerated), editorial 18/18, business-classic 42/42, template-ecosystem 24/24, devmode 41/41, invariants 14/14, feature-boundary 189/189, editions 36/36, and the rest.
- `deno check` clean across `site_blocks.ts`, `serializer.ts`, all three templates, and `index.ts`. `presence.html` inline script syntax-verified.
- **Deploy:** function to staging + prod, "Deployed Functions" confirmed; smoke `/connections`=401, `/commerce/plans`=200 both. **No migration** (media IDs live inside the existing `blocks` JSON).

---

## What remains in Phase T

- **FD-T18** — team-member photo picker in the editor (engine done; UI follow-up, V1.1).
- Pre-existing, unchanged: vertical templates beyond business-classic + editorial (FD-T4, V1.1 — business-classic already publishes every industry *correctly*), FD-T7 Launches, full FD-T6 Design Studio, FD-T2 lazy registry — all previously tracked as V1.1.

*No existing roadmap item was removed, reordered, merged, or renamed; FD-T15/16/17 were marked implemented and FD-T18 appended.*
