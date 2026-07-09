# Phase T (continued) — Structured Component/Block Library, Realized

*Continues Phase T in its existing order. The catalog (`lib/site_components.ts`) was already data; this milestone **realizes** the configurable block library end-to-end — customers can turn structured blocks on, fill typed fields, and publish them — reusing the one render/publish/approval pipeline. No duplicate storage, render, or workflow. Deployed staging + prod.*

---

## What was actually built

A customer can now enable and fill **8 structured content blocks** that render as home-page sections with correct schema.org + accessibility, on top of the existing deterministic pipeline:

**features · stats · team · process · pricing · certifications · service_areas · cta**

These are the high-value blocks a professional / trade / services site needs that were **not** already backed by an existing content table (offerings, testimonials, FAQs, posts, hours, gallery, announcement already exist). Each is a *chosen-and-filled structured block* — typed fields → deterministic render — never free-form layout or runtime code.

### The pieces (all additive, reuse-first)
1. **`lib/site_blocks.ts` (new)** — the single place blocks are validated and rendered.
   - `validateBlocks(raw)` — the authoritative boundary: coerces/trims/caps every field, enforces per-block item caps + a 12-block total, keeps one instance per type, preserves owner order, drops anything malformed. Deterministic.
   - `renderSiteBlocks(blocks, ctx)` — one renderer, called by the template (no second block-render path). Emits each block's HTML + correct JSON-LD (team → `Person`/`ItemList`, process → `HowTo`, pricing → `Offer` with numeric price parsed) + its a11y contract (ordered/unordered lists, headings, text-first, escaped, zero JavaScript). CTA URLs pass through `safeHref` (a `javascript:` URL is refused).
   - `BLOCK_CSS` — appended once to the template stylesheet; reuses existing tokens, no external assets.
2. **`render_types.ts`** — added the `SiteBlock` union (data-only) + `settings.blocks`.
3. **`serializer.ts`** — reads `presence_settings.blocks`, runs `validateBlocks` (so the snapshot only ever carries safe, capped blocks), includes them in `content.settings.blocks`.
4. **`business-classic/1.0.0/render.ts`** — the production default (serves every non-food industry) renders enabled blocks as home sections that **participate in the existing section order/visibility machinery** (`sections.order`/`hidden` via `block_<type>` keys) and injects their JSON-LD. With no blocks, output is byte-stable (unchanged).
5. **`routes/content.ts`** — the existing `/settings` PUT accepts `blocks` (stored as validated JSON, like `sections_hidden`/`page_seo`); no new endpoint, no new approval path — blocks publish through the same preview → approve → publish ritual as all content.
6. **Migration `0068_site_blocks.sql`** — one additive column `presence_settings.blocks jsonb default '[]'`. No new table.

### Constitution compliance
- **Structured content** — typed, validated fields; not a page builder, not raw HTML.
- **Determinism** — pure render, no clock/network/randomness; identical input → identical bytes (tested).
- **Approval-first** — blocks ride the one snapshot/publish/approval pipeline; nothing new to approve through.
- **No duplication** — one storage column, one validator, one renderer, one publish path. No AI added (blocks are owner-filled).

---

## Testing

**`tests/presence/site_blocks_test.mjs` — 24/24.** Validation (caps, coercion, dedupe, junk rejected, order preserved), render (schema per block, a11y list/heading semantics, JS-free, deterministic, **XSS-escaped**, unsafe-URL refused), **catalog agreement** (the engine only realizes block types the `site_components` catalog declares), and **template integration** (business-classic surfaces blocks + their JSON-LD, and stays byte-stable with none).

**Regression:** full pure sweep **69/69** suites green — render 28/28, business-classic 42/42, template-ecosystem 24/24, editorial 18/18, devmode 41/41, invariants 14/14, feature-boundary 189/189, editions 36/36, and the rest. `deno check` clean. (The 4 non-pure suites need live env and skip locally — not regressions.)

**Deploy:** migration 0068 applied to staging + prod via the hold-back technique (the fenced 0003–0005 + un-ledgered 0020–0035 files held out, 0068 pushed alone, all files restored — 69/69 intact). Function deployed to both, "Deployed Functions" confirmed; smoke `/connections`=401, `/commerce/plans`=200 both envs.

---

## What still remains in Phase T (appended to the roadmap, not reordered)

- **FD-T15 · Block-authoring UI in the editor** — the storage, validation, render, schema, and `/settings` endpoint are shipped, so blocks are fully functional via the API and render correctly. The **owner-facing control** in `presence.html` to add/fill/reorder blocks visually is the remaining surface. Not built here because it needs a browser to verify (this environment can't run one); it's a UI wiring over a proven endpoint. *Priority: V1 if launching small-business-broad (makes blocks usable without the API); V1.1 if restaurant-first.*
- **FD-T16 · Realize blocks in the `editorial` + `restaurant-classic` templates** — the shared `renderSiteBlocks` is template-agnostic; business-classic (the default, where these blocks matter most) is wired. Wiring the other two families is a small, mechanical adoption. *Priority: V1.1.*
- **FD-T17 · Media-bearing blocks** — v1 blocks are text-only (deterministic, no media-manifest plumbing). Gallery/team-photos/before-after/video blocks want a media reference through the serializer's `ref()`. *Priority: V1.1.*
- **Pre-existing Phase-T items unchanged:** vertical templates beyond business-classic + editorial (FD-T4, V1.1 — business-classic already publishes every industry *correctly* via `vocabFor`), FD-T7 Launches, full FD-T6 Design Studio — all already tracked.

*These are appended to Phase T on the master roadmap with rationale + recommended priority. No existing item was removed, reordered, merged, renamed, or skipped.*
