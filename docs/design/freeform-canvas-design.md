# Freeform canvas section — design doc (G25 reversal, Eric 2026-07-15)

Status: PROPOSED — design only, nothing built. Companion doc: `per-element-overrides-design.md` (G27).

## 0. The decision and its boundary

Eric decided to **build** a drag-anywhere layout mode, overriding the founding
"structured list by index, never x/y" law (recorded in
`docs/presence/OPEN-PUNCHLIST.md` §"ADOBE PARITY DECISIONS" item 2; the law it
overrides is stated in `docs/presence/ADOBE-PARITY-ATLAS.md` row G25 and in code:
`presence.html:7234` "No x/y, no overlap ever",
`supabase/functions/presence/lib/site_blocks.ts:8-9` "never free-form layout or
runtime code", `lib/render_types.ts:78-81` "Never free-form HTML").

**Product framing Eric confirmed:** the freeform canvas is a **new SECTION TYPE
inside the structured page flow**. Templates, columns, and all 37 existing block
types stay exactly as they are. A page remains an ordered block list
(`BLOCKS_WORK` in `presence.html:5068`, persisted via `PUT /settings` →
`validateBlocks()` at `lib/serializer.ts:151-179,231-234`); a `freeform` block is
one entry in that list — reorderable, removable, repeatable like `columns`. It is
**not** a whole-page free canvas, and the hero/nav/footer/template machinery is
untouched.

This means the founding law is *narrowed*, not repealed: x/y exists only **inside
the fenced canvas of one section**, validated and clamped by the same single
boundary (`validateBlocks`) as everything else. The moat comments at
`presence.html:7234`, `site_blocks.ts:8-9`, and `render_types.ts:80` must be
amended to reference this decision when the code lands (constitution
`docs/presence/PRODUCT-CONSTITUTION.md` amendment process applies — record the
exception, don't silently contradict the comment).

## 1. Grounding: the machinery this rides on (all verified in code)

- **One validate/render boundary.** `lib/site_blocks.ts` is "the single place
  that (a) validates a stored block list into safe, capped, typed instances and
  (b) renders each block to deterministic HTML" (lines 1-12). Every template
  calls the same `renderSiteBlocks()` (e.g.
  `templates/business-classic/1.0.0/render.ts:488,522`), so a new block type
  ships to all 8 families at once (`lib/render.ts:35-44` LOADERS).
- **The G4 variant pattern** (`site_blocks.ts:100-120`): enumerated-only values,
  unknown dropped at validation, absent key ⇒ byte-identical storage and render.
- **The G18 `zoom` field pattern** (`site_blocks.ts:126-129,257-259`): a strict
  `=== true` boolean field, "same allowlist posture as `variant`".
- **Clamped-number precedent**: `clampSpan` (1-12 grid units, `site_blocks.ts:50-52`),
  `clampPct` (0-100 integers, lines 53-56), and the focal-point render at lines
  647-650 — clamped finite numbers emitted into a `style` attribute through
  `attr()` (escapers from `lib/markdown.ts`, imported by every template,
  `business-classic/1.0.0/render.ts:9`). This is the sanctioned way to put
  owner-chosen numbers into CSS.
- **Zero-JS sections**: blocks emit no scripts (platform law restated at
  `site_blocks.ts:1606-1607`); the two exceptions (form/booking enhancers,
  lines 799-831) are deliberate, first-party, and not a precedent we need here.
- **Caps everywhere**: `MAX_BLOCKS = 32`, per-type `CAP` map (lines 46-47);
  strings bounded by `s()`/`ml()` (lines 71-76); media by `uid()` (78-79).
- **Responsive conventions**: the block layer's phone boundary is 620px
  (`@media(max-width:620px)` hide-on-mobile, `min-width:621px` hide-on-desktop,
  `site_blocks.ts:1543-1544`; columns/image_text stack below 620px, lines
  1413, 1437).
- **Goldens**: per-family sha256 manifests in `tests/presence/golden/*.json`
  (8 files); `tests/presence/render_test.mjs` — determinism (render twice,
  byte-identical), hostile fixtures, `--update-golden` as the approval ritual.
  Block-level tests in `tests/presence/site_blocks_test.mjs` (e.g. line 466:
  "no variant → no v- class anywhere (default look byte-identical)").
- **Content contract**: `CONTENT_CONTRACT_VERSION = 1`
  (`lib/serializer.ts:19,294`); `renderSnapshot` throws on mismatch
  (`lib/render.ts:161-168`). Every prior block-type addition (G4, G18, r2-r5
  staples) was additive at v1.

## 2. Data model (stored shape)

A new MULTI block type `freeform` (joins `form/columns/cards` in the `MULTI` set,
`site_blocks.ts:61`, so several can exist, each with a stable `slugId` id and
render key `block_freeform_<id>`). Added to `NOT_IN_CELL`
(`site_blocks.ts:69`) — a freeform section can never nest inside a columns cell,
and no other block can nest inside it (elements are the four curated kinds only;
no container recursion).

```jsonc
{
  "type": "freeform",
  "id": "hero_promo",           // slugId, de-collided like columns/cards
  "title": "…",                 // optional; renders as the section h2 (anchor/TOC contract)
  "aspect": "standard",         // enumerated canvas shape: 'banner' (3:1) | 'standard' (2:1) | 'tall' (4:3)
  "elements": [
    {
      "id": "e1",               // slugId, unique within the section
      "kind": "text",           // 'text' | 'image' | 'button' | 'shape'
      "x": 12.5, "y": 30,       // % of canvas, clamped 0..100, quantized to 0.5
      "w": 40, "h": 22,         // % of canvas; w clamped 4..100, h clamped 4..100
      "z": 2,                   // normalized 1..N at validation
      "hide_on_phone": true,    // strict === true only (the G18 zoom posture)

      // exactly one per-kind payload, reusing existing primitives:
      "text":   { "body": "…",            // ml(), cap 800 — short display copy, not prose
                  "size": "l",            // '' | 's' | 'l' | 'xl' (enumerated steps)
                  "align": "center" },    // '' | 'center' | 'right'
      "image":  { "image_id": "<uuid>",   // uid(); resolved via resolveBlockMedia ref()
                  "alt": "…", "decorative": true },
      "button": { "label": "…", "url": "…", "style": "primary" },  // safeHref at render, like buttons block (site_blocks.ts:400-407)
      "shape":  { "shape": "rect",        // 'rect' | 'ellipse' | 'line'
                  "fill": "accent" }      // enumerated token fills: 'accent' | 'tint' | 'ink' | 'paper' | 'none'
    }
  ]
}
```

Decisions and rationale:

- **Section-relative %, not px.** x/y/w/h are percentages of the canvas box, so
  the design scales purely with viewport width — the responsive story (§4) falls
  out of CSS, no JS, no per-breakpoint data.
- **Canvas height via enumerated `aspect`.** A % y-coordinate needs a defined
  height; `aspect-ratio` on the canvas gives one deterministically. Three curated
  presets (v1) keep validation enumerated, exactly the `parseLook` posture
  (`site_blocks.ts:88-98`). A clamped numeric ratio can be a later additive field.
- **Quantization.** All coordinates round to 0.5% at validation (deterministic
  `Math.round(v * 2) / 2`, finite-checked like `clampSpan`). This makes drag
  output stable across pointer jitter, keeps stored JSON small, and makes the
  editor's snap grid (§3) the same arithmetic as the server's.
- **Caps.** `CAP.freeformElements = 12` per section; `CAP.freeformSections = 4`
  per page (enforced in `validateBlocks` alongside the existing per-type caps at
  `site_blocks.ts:47`; freeform sections also count inside `MAX_BLOCKS = 32`).
  Text body capped at 800 chars (display copy; the `richtext` block at 4000
  remains the prose tool). Rationale: constitution Section 1 #13 — bounded
  choices; and 12 absolutely-positioned elements is already past the point where
  a structured section serves the owner better.
- **No arbitrary styling on elements.** Colors come only from tokens
  (`shape.fill` enumerated; text inherits `--ink`; buttons reuse the template
  `.btn`). Per-element color/typography overrides are the *other* doc's `style`
  object and can be attached to freeform elements in a later slice — one
  override system, not two (constitution Section 7).

Validation algorithm (in `validateBlocks`, new `case 'freeform'`):

1. Enumerate `aspect`; unknown → `'standard'`.
2. Per element: unknown `kind` → drop. Empty payload (no text body / unresolvable
   image_id shape / no button label+url) → drop, mirroring how every existing
   case drops empty items (e.g. `features` at lines 196-199).
3. Clamp: `x,y ∈ [0,100]`, `w,h ∈ [4,100]`, then **containment clamp**
   `w = min(w, 100 - x)`, `h = min(h, 100 - y)` — an element can never overflow
   its section. Non-finite → element dropped (stricter than focal's
   omit-the-style, because position is the element's substance).
4. Slice to `CAP.freeformElements`.
5. **z normalization**: stable-sort by stored `z` (ties keep input order),
   reassign `1..N`. Stored z is therefore always dense and bounded.
6. **Reading order**: elements are stored (and rendered) sorted by `(y, x)`
   ascending — DOM order = visual reading order (§5). z-index alone carries
   stacking, so sort order and stack order are independent.
7. Strings through `s()`/`ml()`; `image_id` through `uid()`; media resolved in
   `resolveBlockMedia` through the same `ref()` as every media block
   (`site_blocks.ts:524-625`) so variants/manifest registration are automatic;
   an element whose image can't resolve is dropped (the `image` block posture,
   line 584-586).

## 3. Editor (presence.html Design view)

Placement: `BLOCK_DEFS` entry (`presence.html:4969-5023`) under the
"Text & layout" `SECTION_GROUPS` group (line 5035), alias in `SECTION_ALIAS`
("poster / drag anywhere"). It arrives via the existing tray click/drag paths
(`renderBlockTray`/`addBlockAt`, `presence.html:7193-7245`) and saves through the
existing `saveBlocks()` → `PUT /settings` path (lines 5583-5620), inheriting
optimistic-lock stale handling (lines 5607-5618), undo/redo history
(`dcHistoryRecord`), and the "Save sections → publish to apply" ritual. No new
save path, no new API.

The block editor panel hosts a **proportional mini-canvas** (same `aspect` as the
render, width-bounded to the panel):

- **Drag to place**: pointer-capture drag (the tray already has a pointer-drag
  engine, `pdStart` at `presence.html:7289`, invoked from tray items at :7225
  and canvas grips at :7749; reuse its idioms, not its instance).
  Position updates snap to a **5% grid** while dragging (visible dotted grid),
  with the stored value quantized to 0.5% so fine nudges are possible via
  keyboard arrows (0.5% per press, Shift = 5%).
- **Resize**: corner + edge handles on the selected element, same snap. Minimum
  4% enforced live (mirrors the server clamp).
- **Smart guides** (slice 2): alignment lines when a dragged edge/center comes
  within 1% of another element's edge/center or the canvas center; snapping to
  the guide while shown. Pure client arithmetic on the working copy.
- **Containment**: drag/resize is clamped to the canvas live; there is no way to
  place an element outside (server clamp is the backstop, never the UX).
- **Z-order**: "Bring forward / send back" buttons on the selected element
  (swap adjacent z, renormalize) — no free z numbers in the UI.
- **Per-element sub-editors**: reuse existing idioms — `openPicker` for images
  (the pattern at `presence.html:4757`), label+URL fields for buttons,
  `pillRow` (lines 4717-4733) for text size/align and shape fill.
- **Phone preview**: a fixed, always-visible strip in the editor: "**Phones see
  this stacked**" with a live-ordered mini-list of the elements in reading order,
  plus a per-element "Hide on phones" checkbox (writes `hide_on_phone`). The
  canvas-level device toggle (`presence.html:547,6942`) already shows the real
  stacked render in the preview iframe at phone width — the strip explains *why*
  it looks different.
- The existing per-section controls compose unchanged: `blockLookRow`
  (lines 5673-5705 — background/width/spacing still meaningful for the section
  shell), `blockWindowRow` (show from/until), move/remove/duplicate.

Honest editor-complexity note: this is the largest single piece of new editor
code since the tray drag-and-drop — pointer math, touch (`MI-7` is already a
known partial in the atlas §D3), selection state, keyboard a11y for the handles.
Budget it as such; the render/validation side is small by comparison.

## 4. Responsive strategy

One stored layout, two deterministic renders from it — no per-breakpoint data
(G24 stays curated-toggles; this feature must not smuggle in a layout-mode).

- **Above 620px** (the existing block-layer boundary, `site_blocks.ts:1543`):
  the canvas is `position:relative; aspect-ratio:<preset>`, each element
  `position:absolute; left/top/width/height` in %. The whole composition scales
  linearly with viewport width. Text uses `clamp()`-based steps so it scales
  with a floor (§6).
- **At/below 620px**: a single static CSS rule flips the canvas to flow:
  `.ff-canvas{aspect-ratio:auto} .ff-el{position:static;width:auto;height:auto;margin:12px 0}`.
  Elements stack **in DOM order = reading order** (the `(y,x)` sort from §2.6).
  Shapes collapse (`display:none` for pure-decoration shapes on phones — they
  carry no content). `hide_on_phone` elements get `display:none` under the same
  media query, the exact `block--hide-mobile` pattern (`site_blocks.ts:1543`).
- Why stack instead of scale-down: a 2:1 canvas at 375px makes 16px text render
  at ~7px — unreadable. Adobe's own answer is per-breakpoint hand layout
  (atlas ST-3/DR-10), which Eric already declined in favor of curated toggles
  (decision 1). Auto-stack + owner-visible preview + hide-on-phone is the
  guardrailed middle.

## 5. Rendering (pure, deterministic, zero JS)

New `case 'freeform'` in `renderSiteBlocks` (`site_blocks.ts:840+`):

```html
<section class="block wrap block-freeform">            <!-- + look classes via applyLook, :793-797 -->
  <h2>…</h2>                                           <!-- only when title set (title-optional contract, :750-765) -->
  <div class="ff-canvas ff-aspect-standard">
    <div class="ff-el ff-text ff-size-l ff-align-center ff-hide-phone"
         style="left:12.5%;top:30%;width:40%;height:22%;z-index:2">…escaped text…</div>
    <div class="ff-el ff-image" style="…"><picture>…</picture></div>   <!-- blockImg(), :636-658 -->
    <a class="ff-el btn" href="…" style="…">…</a>                       <!-- safeHref, rel="noopener" -->
    <div class="ff-el ff-shape ff-shape-rect ff-fill-accent" style="…" aria-hidden="true"></div>
  </div>
</section>
```

- **All variable data is numbers-only inside `style`** (clamped at validation,
  formatted with a fixed one-decimal printer so 12.5 always prints "12.5" —
  determinism), emitted through `attr()` exactly like the focal-point precedent
  (`site_blocks.ts:647-650`). Everything else is enumerated classes
  (`ff-size-*`, `ff-align-*`, `ff-fill-*`, `ff-aspect-*`) — the `lookClasses`
  pattern (lines 776-790). Text through `esc()`; URLs through `safeHref`.
- **Static CSS** appended to `BLOCK_CSS` (`site_blocks.ts:1329`), token-driven
  (`--accent/--ink/--paper/--wash`), including the phone-stack flip and the
  hide rules. One CSS addition, shipped to all 8 templates via the existing
  `${BLOCK_CSS}` interpolation (`business-classic/1.0.0/render.ts:158`).
- **Zero JS emitted.** No schema.org node in v1 (a freeform composition has no
  honest structured-data shape; a `title` still yields the standard section
  anchor for the TOC machinery, lines 747-769).
- **Images** go through `blockImg()` — AVIF/WebP `<picture>`, lazy, focal-aware
  (lines 636-658). `sizes` derives from the element's `w` (e.g. `w=40` →
  `sizes="(max-width:620px) 100vw, 40vw"`) — deterministic string from clamped
  input.

## 6. Accessibility

- **DOM order = reading order** (the `(y,x)` sort is a validation invariant, so
  screen readers and the phone stack read the composition top-left to
  bottom-right regardless of z-order or authoring order).
- **Text-size floors**: `ff-size-*` map to `clamp()` with hard floors —
  s: `clamp(.95rem, 1.6vw, 1.05rem)`, default: `clamp(1rem, 2vw, 1.2rem)`,
  l: `clamp(1.2rem, 3vw, 1.7rem)`, xl: `clamp(1.5rem, 4.2vw, 2.4rem)`. Nothing
  the owner does can render body copy below ~15px.
- **Shapes are `aria-hidden="true"`** (decorative by definition — they carry no
  payload). Decorative images use the existing `alt="" role="presentation"`
  path (`site_blocks.ts:651-653`).
- **Contrast is preserved by construction** in v1 because colors are all
  token-derived (shape fills from the palette machinery whose tint is
  contrast-checked — `lib/palettes.ts:43-54`). Overlap of text over an image is
  the one new risk: the editor warns when a text element's box intersects an
  image element's box ("text over photos can be hard to read — consider a shape
  behind it"), advisory only, consistent with Eric's warn-don't-block stance.
- Buttons/links keep template focus styles (`.btn`, `:focus-visible` rules
  already in template CSS/`BLOCK_CSS`).

## 7. Explicit non-goals

- **Never page-level.** The page stays a structured block list; freeform is one
  section type within it. No template becomes a canvas; hero/nav/footer/core
  pages untouched.
- **No arbitrary CSS, no raw HTML, no runtime code.** Elements are four curated
  kinds; styling is enumerated/tokens (per-element color overrides arrive only
  via the G27 `style` object, doc 2, if extended in a later slice). The
  Developer-Mode CSS channel (`lib/devmode.ts`, `lib/custom_css.ts:3`) remains
  the pro escape hatch.
- **No per-breakpoint layouts.** One layout; phones stack (G24's curated-toggle
  decision stands).
- **No nesting** either direction (`NOT_IN_CELL` + no block-in-canvas).
- **No rotation/skew/animation** in v1 (each would be an enumerated additive
  field later if wanted).
- **No external origins** — unchanged platform law (`site_blocks.ts:273,332`).

## 8. Content contract & versioning

- **Additive at `CONTENT_CONTRACT_VERSION = 1`** (`lib/serializer.ts:19`), the
  same posture as every block-type addition to date: old snapshots contain no
  `freeform` blocks → render byte-identically; the shared block engine means no
  template-version bump and no manifest change (`render.ts:161-168` contract
  check untouched).
- **Rollback semantics**: if the function is ever rolled back to a pre-freeform
  build, `validateBlocks` in that build drops the unknown type silently
  (`site_blocks.ts:192`) — the page publishes *without* the section rather than
  breaking. Safe degradation, worth stating in the release notes.
- **Timewarp/restore**: snapshots store raw settings; re-rendering an old
  snapshot with the new lib re-validates and renders identically (validation is
  deterministic and pure — `site_blocks.ts:10`).

## 9. Testing strategy

Extend the two existing suites; no new harness.

- **`tests/presence/site_blocks_test.mjs`**:
  - Validation table: junk coordinates (negative, >100, NaN, `"1e9"`, strings),
    non-finite → dropped element; containment clamp (`x=90,w=40` → `w=10`);
    quantization (12.34 → 12.5); z normalization (gaps/dupes → dense 1..N);
    caps (13th element dropped, 5th section dropped); unknown kind/aspect
    handling; `hide_on_phone: "yes"` dropped (strict true).
  - Hostile: `<script>` in text/alt/label escaped; `javascript:` button URL
    dropped by `safeHref`; hostile numbers can't break out of the `style` attr
    (numbers-only printer).
  - Determinism: render twice → identical (the line-66 pattern); reading-order
    invariant (shuffled input → same DOM order).
  - Byte-stability: a block list without freeform renders byte-identically
    (the line-466 "no v- class anywhere" pattern).
- **`tests/presence/render_test.mjs` + goldens**: add a freeform block to one
  family's fixture; regenerate all 8 goldens in `tests/presence/golden/` —
  **BLOCK_CSS growth churns every golden hash regardless** (same as G4/G18);
  the `--update-golden` commit is the approval, per the file header (lines 2-9).
- **A11y assertions**: DOM order sorted; `aria-hidden` on shapes; size-floor
  CSS present; phone-stack rule present; `hide_on_phone` class only under the
  620px query.

## 10. Phased build plan

- **S — Slice 1 (first shippable, small):** `validateBlocks` case + render +
  `BLOCK_CSS` (text/image/button kinds only, no shapes; 3 aspect presets) +
  tests/goldens + editor v1: mini-canvas with drag + 5% snap grid + corner
  resize + containment + z buttons + hide-on-phone + the "phones see this
  stacked" strip. Ships behind the tray like any block; no flag needed (absent
  type = zero effect).
- **M — Slice 2:** shapes kind; smart guides + keyboard nudge/resize a11y;
  text-over-image overlap warning; duplicate-element; touch polish.
- **L — Slice 3 (optional, judged after usage):** direct manipulation on the
  real preview iframe via the G13 postMessage bridge
  (`presence.html:3634-3796` alignment machinery); clamped numeric aspect;
  per-element `style` overrides shared with doc 2.

Risks, honestly: all-8-family golden churn on every CSS touch (mitigate by
batching slices); editor pointer/touch complexity is the real cost center;
owners can still compose ugly/cluttered sections within the caps — the caps,
snap grid, and stacked preview are the guardrails, not taste enforcement; the
phone stack will sometimes surprise owners whose design depends on overlap
(the preview strip + device toggle are the mitigation).

## Open questions for Eric (max 3)

1. **Aspect control**: are the three enumerated canvas shapes (banner 3:1,
   standard 2:1, tall 4:3) enough for v1, or do you want a clamped numeric
   height ratio from day one?
2. **Caps**: proposal is 12 elements per canvas, 4 freeform sections per page.
   Right sizes, or tighter/looser?
3. **Phone behavior**: stack-only in v1 (proposed), or should an owner be able
   to opt a section into "shrink the whole composition instead of stacking"
   (readable only for image/shape-dominant art, hence not the default)?
