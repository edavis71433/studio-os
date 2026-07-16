# Per-element style overrides — design doc (G27 reversal, Eric 2026-07-15)

Status: PROPOSED — design only, nothing built. Companion doc: `freeform-canvas-design.md` (G25).

## 0. The decision and its boundary

Eric decided to **allow full per-element styling**, overriding
contrast-by-construction, with the explicit guardrail "ship with contrast
warnings, not blocks" (`docs/presence/OPEN-PUNCHLIST.md` §"ADOBE PARITY
DECISIONS" item 4; the rejected-by-default position was
`docs/presence/ADOBE-PARITY-ATLAS.md` row G27: "anything beyond named curated
variants … conflicts with the deny-by-default token allowlist").

Scope of "element": a **block instance** — the same unit Adobe's Style System
styles per component instance (atlas ST-1, [DR-8]) and the unit our G4 variants
already address per instance (`site_blocks.ts:100-120`,
`presence.html:5656-5668`). One override object per placed block, top-level or
nested-in-cell (nested in slice 2). Per *inner item* styling (one card in a
cards grid) and freeform-canvas per-element styling are explicitly later slices
of the SAME object — one override system, never two (constitution
`docs/presence/PRODUCT-CONSTITUTION.md` Section 7).

What this overrides in code, to be amended when it lands: the
contrast-by-construction guarantees documented at `lib/palettes.ts:9,43-54`
(palettes contrast-validated by test; `brandTint` guarantees ≥4.5:1) and
`lib/render_types.ts:220-222` remain true **for the defaults**; the new object
is the recorded, warned exception.

## 1. Grounding: the three patterns this composes (verified in code)

1. **G4 variants** — enumerated per-block values, unknown dropped, absent key ⇒
   byte-identical (`site_blocks.ts:108-120` `BLOCK_VARIANTS`/`parseVariant`;
   editor `BLOCK_VARIANT_OPTS` + `blockVariantRow`, `presence.html:5656-5668`).
2. **Theme-token validation** — a validated allowlist object with per-key value
   shapes, deny-by-default: `TOKEN_RULES` + `validateThemeTokens`
   (`lib/devmode.ts:20-48`). This doc's `style` object is that pattern moved
   onto a block.
3. **The `look` carry machinery** — `parseLook` (`site_blocks.ts:88-98`),
   `WithLook` (line 155), the `lk()` rebuild-carry in `resolveBlockMedia`
   (lines 530-535), `applyLook` class injection (lines 793-797), and the
   editor's `wLook` field-carry (`presence.html:5651`). `style` rides all four
   the same way.

Plus the WCAG math that already exists server-side, pure and deterministic:
`contrastRatio`/`luminance` (`lib/brand_kit.ts:42-47`) and
`readableOnWhiteText` (lines 50-54, the darken-until-readable fixer). The
editor gets a ~10-line client port (mirroring `normHexJs` at
`presence.html:4737`, which already ports `normHex` from `brand_kit.ts:23-28`).

## 2. Property set (exactly Eric's list, bounded)

Stored as an optional `style` object on any stored block, validated by a new
`parseStyle()` beside `parseLook`/`parseVariant`:

| key | value shape (deny-by-default rule) | renders as |
|---|---|---|
| `text_color` | `/^#[0-9a-fA-F]{6}$/` (normalized via the `normHex` idiom) | `--ov-ink` custom property |
| `bg_color` | same hex rule | `--ov-bg` custom property |
| `accent` | same hex rule — per-block accent: buttons/links/icons/stars inside this section | `--ov-accent` (+ derived `--ov-accent-dark`, computed at validation with `darken()` — deterministic, `brand_kit.ts:40`) |
| `font` | `'display' \| 'body'` — a pick between **the site's two faces only** (`font_display`/`font_body` tokens, `devmode.ts:28-29`; no third font can enter) | class `ov-font-display` / `ov-font-body` |
| `size` | `'s' \| 'l' \| 'xl'` (one step down, one/two up; default absent) | class `ov-size-*` (scales the block's text via a factor, floored like the freeform doc §6) |
| `align` | `'left' \| 'center' \| 'right'` | class `ov-align-*` (supersedes `look.align`'s single `center`; same guarded child-reset rules as `site_blocks.ts:1545-1549`) |
| `contrast_ack` | strict `=== true` only (the G18 `zoom` posture, `site_blocks.ts:257-259`) | not rendered — the stored record that a failing contrast warning was seen and overridden |

Everything else is rejected and dropped, exactly `validateThemeTokens`
(`devmode.ts:37-48`). Absent `style` ⇒ no key stored, no class, no style attr —
byte-identical, golden-provable (the `site_blocks_test.mjs:466` pattern).
Max object size is bounded by construction (7 known keys).

Not in the set, deliberately: arbitrary fonts, px sizes, spacing/margins,
borders, shadows, custom CSS — the gated Developer-Mode channel
(`lib/devmode.ts`, `lib/custom_css.ts:3`) stays the pro path; `look` keeps
owning background *bands*, width, spacing (`site_blocks.ts:92-96`).

## 3. Data model & validation

- `WithLook<T>` (`site_blocks.ts:155`) gains `style?: BlockStyle`; `parseStyle`
  runs beside `parseLook`/`parseVariant`/`parseWindow` in the attach step
  (lines 494-505); `lk()` (lines 530-535) and `wLook`
  (`presence.html:5651`) carry it across rebuilds; the linked-section save
  path (`presence.html:5590`) is untouched because `style` lives on the block
  object like `look` does.
- Server-side contrast recomputation at validation: when `text_color` and
  `bg_color` are both present and `contrastRatio(text_color, bg_color) < 4.5`
  **and** `contrast_ack !== true`, the block still validates and stores
  (never hard-block, per Eric) but the save response carries a warning the
  client surfaces; publish-time the same check feeds the existing
  non-blocking warnings channel (manifest `validation.warnings` precedent,
  `templates/business-classic/1.0.0/manifest.json`, and the site-health
  sentence rail) — so an ignored warning stays visible, not buried.
- Precedence rule (validated, not just rendered): `style.bg_color` and
  `look.background` are mutually exclusive — if both arrive, `style.bg_color`
  wins and `look.background` is dropped at validation. Rationale: the look
  bands force light text for contrast (`site_blocks.ts:1526-1534`); layering a
  custom text color over that machinery would silently defeat both systems.
  The editor enforces the same exclusivity (§6).

## 4. Rendering: hybrid — enumerated → classes, colors → scoped custom properties (decision)

Two candidates were considered:

- **(a) Generated scoped classes** (emit per-block CSS rules into the page
  stylesheet): rejected. Values are owner-chosen hex from an unbounded set, so
  classes can't be pre-enumerated; generating rules per block creates a new
  dynamic-CSS channel beside `BLOCK_CSS` (`site_blocks.ts:1329`) — a second
  styling system (constitution Section 7), a larger determinism surface, and a
  selector/ordering hazard against the `.block.alt` specificity tricks already
  documented at `site_blocks.ts:1520-1522,1569-1571`.
- **(b) Inline custom properties + static rules** (chosen): the section tag
  gets `style="--ov-ink:#332211;--ov-bg:#faf6ee;--ov-accent:#0a5a4a;--ov-accent-dark:#07443a"`
  — validated-hex-only values through `attr()`, the exact focal-point
  precedent for owner data in a style attribute (`site_blocks.ts:647-650`) —
  while **all rules are static** in `BLOCK_CSS`:
  `.block.ov-styled{background:var(--ov-bg,inherit);color:var(--ov-ink,inherit)}`,
  `.ov-styled .btn{background:var(--ov-accent,var(--accent))…}`, etc., with
  the same child-inheritance selector list the accent/dark bands already use
  (`site_blocks.ts:1530-1534`). Enumerated keys (`font/size/align`) become
  classes injected via the `applyLook` mechanism (lines 793-797).

Why (b) wins on determinism/goldens: same input → same bytes with a fixed
key-order printer; absent `style` emits nothing (default sections
byte-identical, golden-stable); the static rules land once in `BLOCK_CSS`
(one golden churn, like G4), after which **content changes never touch CSS** —
per-block styling lives entirely in the HTML like every other block field.
Zero JS, zero external origins, works identically across all 8 template
families because it rides the token vocabulary they all consume
(`--accent/--ink` etc., `lib/render.ts:110-135`).

## 5. Contrast guardrails (Eric's exact spec)

- **Live computation in the editor**: on every color change, compute
  `contrastRatio` (client port of `brand_kit.ts:42-47`) for the governing
  pairs: `text_color` × effective background (`bg_color` if set; else the
  site's `bg` token from `DESIGN_TOKENS`, else `#ffffff` — stated in the UI as
  "checked against your page background"), and white × `accent` (buttons
  render white-on-accent — the invariant `readableOnWhiteText` protects,
  `brand_kit.ts:48-53`). Show a live chip: "Contrast 7.2 — passes" /
  "Contrast 2.8 — hard to read (needs 4.5)".
- **WARN + extra confirm on failure, never hard-block**: a failing pick keeps
  working, but "Save sections" first shows one extra confirm naming the failing
  pair ("This text may be unreadable for many visitors — use it anyway?").
  Confirming sets `contrast_ack: true` on the block's `style`.
- **Record the override**: `contrast_ack` persists in the stored block (and
  therefore in every snapshot/publish — auditable in history). Any later color
  change **clears** the ack so the check re-arms. The publish-time warning
  (§3) cites it: "1 section has a contrast warning you chose to keep."
- **One-tap fix offered alongside the warning**: "Darken it until it's
  readable" runs the `readableOnWhiteText` loop client-side — the warn path
  always carries an accept-the-fix exit, so the ack is a choice, not a nag.

## 6. Editor UI (compact style popover)

Inside the existing per-block editor (where `blockVariantRow` +
`blockLookRow` already live, `presence.html:5665-5705`), one collapsed
`<details>` row — "**Style this section** · optional", mirroring
`blockLookRow`'s idiom (auto-open when customized, line 5684):

- Three `pillRow`s (`presence.html:4717-4733`): **Font** (Default / Site
  heading face / Site body face), **Text size** (Smaller / Normal / Larger /
  Extra large), **Alignment** (Left / Centered / Right).
- Three color wells (Text / Background / Accent), each the color-input+hex
  pair idiom from the Brand Kit card (`presence.html:4762-4765`), each with a
  "Default" clear chip.
- The live contrast chip + fix button (§5) directly under the wells.
- Mutual exclusion with `look`: picking a custom Background clears the
  `look.background` select and vice-versa (one background owner at a time,
  matching the validation rule §3).
- Writes into `BLOCKS_WORK[idx].style` (delete the key when everything is
  default — the `blockVariantRow` delete-when-empty pattern, line 5668);
  saved by the existing "Save sections" → `PUT /settings` →
  `validateBlocks` path (`presence.html:5583-5620`,
  `lib/serializer.ts:151-179`). No new endpoint.

## 7. Interaction with Apply-Brand (G30)

`POST /dev/brand-kit/apply` (`index.ts:798`) re-derives site tokens
(`deriveBrandTokens`, `brand_kit.ts:71+`) — but per-block `style` lives in
`settings.blocks`/`settings.pages[].blocks`, not tokens, so overrides would
survive a rebrand as stale off-brand colors. Per Eric's guardrail, Apply Brand
gains an explicit choice when any block carries a `style` with color keys:

- **"Keep my section styling"** — tokens change, `style` objects untouched.
- **"Clear it — return everything to the brand"** — request carries
  `clear_block_styles: true`; the server walks home + custom-page block lists
  removing `text_color`/`bg_color`/`accent`/`contrast_ack` (font/size/align
  are kept: they're brand-neutral by construction — the font pick can only
  name the site's two faces, which Apply Brand itself just set). The walk
  reuses the settings write path so `validateBlocks` re-proves every block.

The editor shows the count before the choice ("3 sections have their own
colors"). Default selection: **Keep** (destructive option never default).

## 8. Caps & validation summary

- 7 allowlisted keys, deny-by-default; hex normalized; enumerations exact;
  `contrast_ack` strict-true.
- No new count caps needed: `style` is one bounded object per block, blocks
  already capped at `MAX_BLOCKS = 32` (`site_blocks.ts:46`).
- v1 surface: top-level blocks only. Slice 2 extends to nested cell blocks
  (`StoredColumns.columns[].block`, `site_blocks.ts:146,431-434`) —
  validation already recurses there, so it's an editor + CSS-cascade task
  (`--ov-*` on a nested section must not leak from the outer one; custom
  properties inherit, so the nested section always sets-or-resets its own).
- Byte-stability invariant (test-enforced): no `style` key ⇒ output identical
  to today, all 8 families.

## 9. Testing

- **`tests/presence/site_blocks_test.mjs`**: allowlist table (junk keys
  dropped; `#gggggg`/`red`/`url(...)` rejected; enum typos dropped;
  `contrast_ack: "true"` dropped); precedence (`style.bg_color` +
  `look.background` ⇒ look dropped); derived `--ov-accent-dark` determinism;
  hostile hex can't escape the `style` attr (validated-shape-only printer);
  ack-clearing on color change (validator-level: changed color without ack +
  failing pair ⇒ warning emitted); render-twice determinism; absent-style
  byte-identity.
- **Goldens** (`tests/presence/render_test.mjs`, `tests/presence/golden/`):
  one churn for the `BLOCK_CSS` additions across all 8 family hashes
  (same as G4 — the `--update-golden` commit is the approval); add a styled
  block to one fixture so the feature is pinned by a golden thereafter.
- **Contrast math**: unit-test the client port against
  `brand_kit.ts` values (same pairs, same ratios) so editor and server can
  never disagree; test `readableOnWhiteText` fix convergence.
- **Warning channel**: publish with a failing un-acked pair ⇒ warning present,
  publish succeeds (never blocks); with ack ⇒ "kept" wording.

## 10. Phased plan

- **S/M — Slice 1 (shippable core):** `parseStyle` + carry + hybrid render +
  `BLOCK_CSS` rules + editor popover + live contrast warn/ack/fix + tests +
  goldens. Top-level blocks only.
- **S — Slice 2:** Apply-Brand keep/clear choice (§7) + publish-time warning
  surface + nested-cell support.
- **M — Slice 3 (judged after usage):** per-inner-item styling (a single card
  /column cell) and freeform-canvas per-element styling — the same `style`
  object attached one level deeper; and, if wanted, a curated brand-shade
  picker (accent tints/shades precomputed with `mix()`, `brand_kit.ts:36-39`)
  as the default color UI with "custom…" behind it.

Risks, honestly: this is the feature most likely to produce ugly and
inaccessible pages — that is the accepted cost of Eric's decision, and the
mitigations (two-faces-only, stepped sizes, warn+ack+recorded, health-rail
visibility, one-tap fix) keep it *visible and reversible* rather than
prevented; goldens churn once per CSS touch across all 8 families; the
look/style precedence rules add real cascade-reasoning complexity for
maintainers (kept manageable by the mutual-exclusion rule); the editor's
"effective background" contrast check is an approximation when no `bg_color`
is set (stated in the UI copy — advisory, not certification).

## Open questions for Eric (max 3)

1. **Apply-Brand "clear"**: proposal clears only the color keys and keeps
   font/size/align (they're brand-neutral by construction). OK, or should
   "clear" mean the whole `style` object?
2. **Color picker default**: free hex wells from day one (proposed), or lead
   with a curated brand-shade palette (derived tints/shades of the accent +
   neutrals) and put free hex behind "Custom…"? The second materially reduces
   ransom-note risk at the cost of one more click.
3. **Warning visibility to clients/reviewers**: should the recorded
   contrast-ack surface in the approval flow (the reviewer sees "owner kept a
   low-contrast style"), or stay owner-only in the health rail?
