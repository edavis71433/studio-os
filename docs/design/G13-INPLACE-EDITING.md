# G13 — In-place canvas text editing (design doc)

*2026-07-19 · Status: PROPOSED — design only, nothing built. Queue head of Adobe
Wave 2 (docs/presence/OPEN-PUNCHLIST.md :262, :272). Atlas entry:
docs/presence/ADOBE-PARITY-ATLAS.md :302 [AC-1, AC-6, AC-10, AC-11].
Prerequisite mandated by the audit: replace the three fragile client-side
mirrors with server-stamped section keys (docs/design/POST-REDESIGN-AUDIT.md
F2, :139-141).*

Note on scope vs the atlas entry: G13's second half ("block duplicate + hotkey
component ops") already shipped with the live canvas — Duplicate/Copy/Cut/
Delete on the hover toolbar (presence.html :8988-8992) and the structured
clipboard (dcPasteAt, pinned by tests/presence/design_canvas_test.mjs
:116-122). This doc covers the remaining half: double-click text on the canvas,
edit it in place — plus the stamping prerequisite.

---

## 0. Current state (verified in code)

**The canvas is same-origin and directly reachable.** #designPreview is a
`srcdoc` iframe filled from `apiHtml("/preview?version=draft…")`
(refreshDesignPreview, presence.html :8675-8703; "SAME-ORIGIN srcdoc" note
:8708). The parent reaches `frame.contentDocument` directly and injects chrome
on every load (installDesignCanvas :9251-9270 → dcInjectCanvas :8904; the stage
proof does the same via installClickToEdit :3985 → eeInjectChrome :3910). No
postMessage bridge exists or is needed — the atlas entry's "postMessage bridge"
guess is superseded by the shipped direct-reach pattern. We reuse it.

**The three fragile mirrors** the audit orders replaced:

1. **The heading/slug mirror** — EE_MANDATORY_H2 (:3833, "must match
   lib/site_blocks.ts MANDATORY_H2 exactly"), eeEffHeading (:3840), eeSlug
   (:3845), and eeBuildIdMap's greedy alignment of rendered `<section id>`s to
   BLOCKS_WORK (:3855-3867). Mirrors site_blocks.ts effHeading (:974),
   slugifyAnchor (:980), and the anchor-stamp pass (:1578-1591). Breaks
   silently whenever a fallback heading, the slug rule, or the de-dup rule
   changes server-side.
2. **eeClassify's English-heading regex** (:3894-3907) — core sections are
   recognised by `/about/`, `/contact|hours|find us|…/`, `/update|news/`
   matched against the rendered H1-H3 text. Purely content-coupled; a
   template wording change or a non-English site misroutes clicks.
3. **cmSectionIds** (:4444-4455) — client mirror of the G11 comment-id scheme
   (lib/section_comments.ts :12-20, sectionIdsFor :79-94). Latently divergent
   already: the builder computes over the raw stored list while the public
   shared-draft panel computes over the snapshot's *validated* list
   (sectionsForContent :98-105 reads snapshot content, i.e. post-
   validateBlocks), and validateBlocks drops empty/junk entries (:253-270) —
   so `type#N` counters can disagree today.

**The save model.** Canvas actions (drag, duplicate, hide, column resize)
auto-save immediately through saveBlocks() → `PUT /settings` (:6157-6193);
the settings panel accumulates field edits into BLOCKS_WORK on `change`
(:6568, :6646, …) and persists only on its "Save sections" button
(:6937-6941). Both ride the ONE api() path with `If-Match: S.draftHash` and
the 409 stale_draft provenance guard (:1409-1431); a stale save gets the
"Load the latest" toastAction (:6183-6191). Undo/redo snapshots the block
list per save (dcHistoryRecord :6129, DC_UNDO cap 60) and re-persists through
the same validating save (pinned at design_canvas_test.mjs :108-114).

**The precedent that settles the stamping question.** Templates already emit
server-stamped field-path attributes into every render — `data-pr` /
`data-pr-id` region markers (`pr('identity.tagline')`, `prE('faq', f.id)`;
business-classic/1.0.0/render.ts :20-21, :318-320, :346-354; all 8 template
families). They are part of the **frozen render contract**
(docs/presence/ENGINEERING-ATLAS.md :73) and ship in published HTML today.

---

## 1. Server-stamped keys (the prerequisite)

### 1.1 One canonical section id, computed server-side only

The comment-id scheme (`type` | `type#N` | `type:storedId`) becomes THE
section identity for the whole editor. It is **canonicalized over the
validated list** — the list renders actually use — fixing the latent
raw-vs-validated divergence above (known, negligible migration edge: an
existing comment thread pinned to `type#N` renumbers only if an earlier
same-type block was empty enough for validateBlocks to drop; emptyBlock()
seeds every panel-created block with content, :6095-6119, so this is
vanishingly rare and self-corrects at next comment).

New in lib/site_blocks.ts:

- `validateBlocksWithMap(raw)` → `{ blocks, map: Array<{ sid, key, src_index }> }`
  — a wrapper around the existing validateBlocks walk (:253) that, while
  iterating the raw list, runs the sectionIdsFor counting rules (:82-91) per
  examined entry and records for each KEPT block its `sid` (stable id), its
  render `key` (the `block_<type>[_<id>]` + `_N` de-dupe rule, today computed
  at :1603-1622 — hoisted so it is computable pre-render), and the raw-list
  index it came from. validateBlocks stays exported and byte-identical in
  output; sectionIdsFor delegates its id computation here — **one
  implementation**, zero client copies.
- Snapshot content is **unchanged** — sids/keys are recomputed wherever
  needed, never stored, so draft hashes (lib/draft_hash.ts) do not churn and
  no deploy-time 409 wave occurs.

### 1.2 The attribute contract (emitted by renderSiteBlocks — all 8 templates at once)

Stamped in renderSiteBlocks' existing per-section passes (the anchor-id pass
:1578-1591 and the key loop :1603-1622; root-tag injection uses the applyStyle
regex idiom `/<(section|nav|div) class="block /` :1059 so divider `<div>` and
toc `<nav>` are covered):

| attribute | on | value | consumer |
|---|---|---|---|
| `data-dds-sid` | every rendered block's root tag | `richtext#2`, `columns:cols_a`, … | click→panel routing, comment badges, index resolution |
| `data-dds-key` | same | the render key (`block_richtext`, `block_form_contact`) | hide/visibility (eeHideKey, sections_hidden — the existing key namespace, :3885-3891) |
| `data-dds-field` | every text-bearing element inside the block | dot-path into the stored block: `title`, `text`, `button`, `subtitle`, `eyebrow`, `body`, `items.0.title`, `tiers.1.name`, `buttons.0.label`, `steps.2.step`, … | the in-place editor (§2) |
| `data-dds-md` | the container of a field rendered through renderMarkdown | `"1"` | picks the markdown editing mode + serializer (§2.3) |

`data-dds-field` is added inside the per-type template strings of the ONE
shared block engine (`h2()` :1120 gains an optional path arg; item mappers add
it per element). The `data-dds-md` flag is stamped exactly where site_blocks
calls renderMarkdown — richtext.body :1298, image_text.body :1312, accordion
items.N.body :1324/:1327, tabs.N.body :1340, cell body :1450, spotlight.body
:1525 — so **the client never keeps its own list of which fields are
markdown**: the format flag is itself server truth.

Core sections get one attribute stamped per template (the data-pr idiom,
mechanical 8×~5 edit): `data-dds-core="hero|about|offerings|faqs|
testimonials"` on the section tag — the same key namespace sections_order/
sections_hidden already use (HOME_SECTION_DEFS, presence.html :7652).

### 1.3 Preview AND published output both carry stamps — decided

The stamps ship in the published render. Justification, in order of weight:

1. **The one-pipeline law.** Publish, preview, and restore all render through
   the single renderSnapshot (lib/render.ts :161-168; "preview is
   pixel-identical to production for the same snapshot", preview.ts :115-117).
   A preview-only variant forks the render into two output shapes, breaks the
   byte-equivalence that the preview cache and golden suite lean on, and
   threads an edit-mode flag through the frozen `render(snapshot, manifest,
   siteConfig)` contract. Stamping unconditionally keeps ONE render.
2. **Precedent.** `data-pr`/`data-pr-id` region markers already ship published
   as part of the frozen contract (§0). `data-dds-*` is the same mechanism.
3. **Cost is nil.** ~40 bytes/section + ~25 bytes/field ≈ 1-2 KB on a typical
   page; the attributes reveal only block types, instance ids, and field
   names — all already inferable from the published `class="block
   block-features"` names and anchor ids (:1589). Inert without the editor.

(The preview-only wrapper — signed URLs, link rewrite, badge; preview.ts
:128-143 — stays the home for anything that must NEVER publish. Stamps are
deliberately not in that category.)

### 1.4 The editor-facing sidecar (index resolution without any mirror)

GET and PUT `/settings` responses (handleSettings, routes/content.ts :396;
singleton SETTINGS_CFG :354) are decorated with the computed map:
`data.section_meta = { blocks: [{sid,key,src_index}…], pages: { "<slug>":
[…] } }` from validateBlocksWithMap over the just-read/just-written row. The
client stores it as `S.sectionMeta` and refreshes it on every load/save —
the exact join between a stamped `data-dds-sid` on the canvas and an index
into BLOCKS_WORK, with validateBlocks' drop rules applied by the server, not
imitated by the client.

### 1.5 What this retires (the shrink)

| dies | replaced by |
|---|---|
| EE_MANDATORY_H2 + eeEffHeading + eeSlug + eeBuildIdMap + EE_IDMAP (:3833-3867) | `el.getAttribute("data-dds-sid")` → `S.sectionMeta` lookup |
| eeClassify's structural probes + English-heading regex (:3894-3907) | read `data-dds-sid`/`data-dds-core`; unstamped → today's fallback `{kind:"core", view:"design"}` (:3906) |
| cmSectionIds (:4444-4455) | sids from stamps (canvas) + S.sectionMeta (tray badges, :4576, :9220) |
| eeBlockKey (:3848) | `key` from stamps / S.sectionMeta (strictly better: today's client copy ignores the `_N` de-dupe; the server value is exact) |

Both chrome injectors (eeInjectChrome for the stage proof, dcInjectCanvas for
the canvas) switch to attribute reads; the "must match … exactly" warning
comments disappear with the code. Net: ~60 lines deleted, ~10 added —
presence.html weight (audit F8) improves slightly before the editor slice
spends its budget.

---

## 2. The editing interaction

### 2.1 Entry — double-click, AEM-UE convention

In **Edit mode only** (DC_MODE === "edit"; Preview/Timewarp withhold all
chrome, :9262-9266; the read-only stage proof keeps its existing bar but gets
no text editing), `dblclick` on any element carrying `data-dds-field` inside a
stamped section starts an edit session on that element. Single click keeps
today's behavior (hover toolbar, section select). Double-click anywhere else —
image, gallery, structural chrome, an unstamped section, a `data-dds-core`
section — routes to the panel exactly as a single click does today
(eeEditTarget :3908): never a dead double-click.

### 2.2 The session

- The element gets `contenteditable` (`plaintext-only` for non-md fields where
  supported, with a paste-as-plain-text guard — `paste` handler does
  `preventDefault` + `insertText` — as the universal fallback), focus, and a
  visible session outline; the section hover toolbar is suppressed for the
  duration.
- A minimal floating bar is injected into the iframe document (the dds-ee-bar
  idiom, :3924-3925) **only for `data-dds-md` fields**: **B · I · Link** — the
  inline subset of the existing markdown toolbar (RT_BUTTONS :1352-1360,
  attachRich :1362), whose full set (H2/H3/lists/quote) stays a panel
  capability. Link reuses the parent's askText dialog and the same
  bare-domain→https normalization (rtLink :1337-1350). B/I wrap the selection
  (`strong`/`em`); no other formatting can be created in place.
- **Enter/Escape semantics:** plain fields — Enter commits and ends the
  session (AEM UE convention), Escape reverts the element's original DOM and
  ends without saving. Markdown fields — Enter inserts a paragraph break,
  Cmd/Ctrl+Enter commits, Escape reverts. Both — clicking/focusing away
  commits (blur = commit, matching the panel's commit-on-change idiom :6568).

### 2.3 Read-back + sanitization (strip to the field's allowed subset)

- **Plain fields** (everything without `data-dds-md`): read `textContent`,
  collapse whitespace. The server re-applies its own bounds on save —
  validateBlocks' `s()`/`ml()` caps (site_blocks.ts :93-98) — the moat is the
  server validator, the client never widens it.
- **Markdown fields**: a deterministic DOM→markdown serializer over EXACTLY
  renderMarkdown's output allowlist (p, br, strong, em, ul, ol, li, h2, h3,
  blockquote, a — lib/markdown.ts :4): `p`→paragraph+blank line, `br`→line
  break, `strong`→`**`, `em`→`*`, `a`→`[text](href)`, `h2/h3`→`##`/`###`,
  `ul/ol li`→`- `/`1. `, `blockquote`→`> ` — and **any other node collapses to
  its textContent** (pasted or hand-crafted markup is stripped of meaning,
  never of content, the renderMarkdown posture in reverse). Structures beyond
  the mini-bar's reach (an existing heading or list inside the prose) survive
  a round trip untouched. Pinned by a property test: for every fixture,
  `renderMarkdown(serialize(renderMarkdown(x))) === renderMarkdown(x)`.
- Nothing read from the DOM is ever written anywhere as HTML — commit writes a
  **string field on a structured block**, and the server's escape-first
  renderMarkdown/esc pipeline remains the only HTML producer. XSS posture
  unchanged by construction.

### 2.4 Iframe mechanics

All session machinery lives in the injected chrome (dcInjectCanvas), same
document, same direct `contentDocument` access as every existing control —
no new origin, no bridge, pointer/key events already stay frame-scoped
(:8898-8901 precedent for the one cross-frame hazard, drag, which G13 does
not touch).

---

## 3. Save model

**In-place commit = the canvas auto-save, unchanged path.** Commit writes the
field through the sid→index join into BLOCKS_WORK, then calls a debounced
saveBlocks (~1.2 s): the SAME `PUT /settings` (:6169/:6172), the same
If-Match/409 provenance guard (api() :1409-1431 — inherited automatically,
nothing new to build), the same "Sections saved — publish to apply" toast and
scheduleChangesRefresh. Rapid commits across several fields collapse into one
save = **one dcHistoryRecord undo checkpoint per editing burst** (the
existing per-save snapshot :6129 gives this for free once saves are
debounced). Undo after an in-place burst restores the pre-burst block list
through the validating save, exactly like every canvas action today.

**No mid-typing saves.** The session model is commit-based, not
keystroke-based — while typing, nothing fires, so the save→srcdoc-reload
cycle can never destroy an active contenteditable. After the burst-save
completes, the normal refreshDesignPreview repaint shows the canonical render
(markdown re-rendered, scroll preserved via dcCaptureScroll).

**Panel and canvas cannot clobber each other,** stated precisely:

- Both surfaces mutate the ONE working copy (BLOCKS_WORK) and persist through
  the ONE saveBlocks; there is no second payload that could overwrite fields
  the other surface changed — a save always persists the union.
- The one real hazard: saveBlocks' unconditional renderBlocksCard() (:6177)
  rebuilding the panel while a panel input holds focused, uncommitted text
  (panel inputs commit on `change` = blur, :6568). The debounced in-place
  save therefore **skips the panel rebuild when `document.activeElement` is
  inside #blocksCard**, deferring it to the input's own blur/commit. (This
  hazard predates G13 — any canvas move/hide today does the same rebuild —
  G13 makes it likelier, so G13 closes it.)
- Cross-tab / cross-user: the If-Match guard refuses the stale writer with
  the G7 provenance toast; in-place edits are set aside on "Load the latest"
  exactly like panel edits (:6183-6191). Not worsened; identically guarded.

The panel's separate "Save sections" button and its batch semantics are
untouched — reconciling the dual save model wholesale is audit F8
(POST-REDESIGN-AUDIT.md :151-153), explicitly not this feature. G13 adds no
third model: it joins the canvas-auto-save side that already exists.

---

## 4. Scope fences (v1)

- **Text fields only**: headings, paragraphs/prose, labels, buttons, item
  lines — every `data-dds-field` path resolves to a string. NOT images, NOT
  media pickers, NOT structure (add/move/delete already have canvas
  affordances), NOT links-as-targets (the Link button edits markdown link
  syntax inside prose; `buttons.N.url` and similar stay in the panel), NOT
  freeform sections (`freeform` element text is the freeform editor slice's
  concern — F1 — its elements get no `data-dds-field` in v1).
- **Block sections only.** Core sections (hero/about/offerings/faqs/
  testimonials) double-click to their panel tab via `data-dds-core` — their
  text lives in identity/offerings/faqs/testimonials entities with their own
  PUT routes, and the existing `data-pr` stamps already mark every one of
  those fields for a later slice (§6, decision D1).
- **No nested-cell fields in v1**: columns/cards cell content re-enters
  renderSiteBlocks recursively (:1450, the tabsSeq/zoomSeq re-entry note
  :1121-1127); stamping there needs a ctx field-path prefix — slice 3, not a
  blocker for the 90% case.
- Double-click on any non-text or unstamped target routes to the panel — the
  identical destination a single click reaches today. No dead ends, no new
  behaviors on non-text elements.

---

## 5. Risks + test plan

**Golden churn (deliberate, once).** Stamping changes rendered bytes across
all 8 template goldens (tests/presence/golden/*.json; render_test.mjs
`--update-golden` :43-49). Re-baseline in the stamping slice with the diff
reviewed to be attributes-only (assert: goldens differ ONLY by `data-dds-*`
insertions — a scripted check in the PR, not eyeballs).

**Mirror-deletion pins.** design_canvas_test.mjs extracts live functions from
presence.html (extractFn :13); pins referencing eeBuildIdMap-era behavior are
replaced, not weakened: new pins assert (a) sid→index resolution is a pure
lookup into server-provided section_meta (no heading text in the code path —
regex-assert the deleted mirrors stay deleted, the :97-106 idiom), (b) the
markdown inverse serializer round-trip property (§2.3), (c) commit writes a
STRING into a structured block, never HTML (the moat pin, :66 idiom).
site_blocks_test.mjs gains: stamp determinism, sid/key/src_index alignment
across drop cases (junk entry, empty features block, windowed-out block,
MULTI ids, `#N` counters), sectionIdsFor ≡ validateBlocksWithMap ids.

**E2E for contenteditable in the iframe** (tests/e2e/cms.spec.ts home):
Playwright `frameLocator('#designPreview')` reaches the srcdoc frame;
`dblclick('[data-dds-field="title"]')` → type → Enter; assert (1) the PUT
/settings payload carries the new string at the right path (route intercept),
(2) the canvas re-render shows it, (3) Escape reverts and fires no request,
(4) a dblclick on an image routes to the panel. One md-field case: B/I/Link
via the mini-bar, asserting stored markdown (`**`, `[](…)`) — never HTML.

**Deploy-order tolerance.** The canvas renders via /preview with the CURRENT
deployed function, so stamps appear for every site the moment the backend
deploys — no per-site republish needed for editing. Published sites pick
stamps up at their next publish (inert either way). Order: backend slice
deploys first; the editor slice ships after and **feature-detects** — a
render with no `data-dds-sid` anywhere (stale function, or a future template
that missed the contract) gets today's exact behavior: section chrome via
core fallback, all editing through the panel. No hard dependency, no broken
window.

**Interaction risks.** `document.execCommand` is deprecated — use direct
Range wrapping for B/I (20 lines, no dependency). `plaintext-only` is
non-universal — the paste-as-text guard is unconditional. Screen readers: the
editable element gets `role="textbox"` + `aria-label` from the field name
during the session; session end restores the original attributes.

---

## 6. Effort + slices

**Slice 1 — server stamping (M).** validateBlocksWithMap + sid/key hoist;
renderSiteBlocks stamps (sec/sid/field/md); `data-dds-core` in 8 templates;
/settings section_meta sidecar; golden re-baseline + unit tests. Gate:
attribute-only golden diff proven; site_blocks_test green; deploy; canvas
visibly unchanged (attributes inert).

**Slice 2 — the editor (L).** Retire the three mirrors (both injectors);
session engine (start/commit/revert, mini-bar, md serializer ~80 lines);
debounced quiet save + panel-focus guard; pins + e2e above. Gate: full e2e
suite; a screenshot pass for Eric (double-click headline → type → publish).

**Slice 3 — follow-ons, separately gated (S/M each).** Core-entity fields via
the existing data-pr stamps (identity/offerings/faqs/testimonials PUT routes);
nested cell fields via a ctx path prefix; freeform text joins when F1 lands.

**Eric decision points (2):**

- **D1 — v1 release line.** Recommended: ship slices 1+2 (block text only) as
  G13-complete, with core sections routing to their panel on double-click as
  today; core-entity in-place follows as slice 3. Alternative: hold the
  announcement until the hero headline edits in place too (slice 3 first item
  pulled in). Pure sequencing — the mechanics are identical.
- **D2 — comment-id canonicalization.** Confirming the §1.1 call: section ids
  canonicalize on the validated list (fixes the latent builder/shared-draft
  divergence), accepting the negligible renumber edge for existing G11
  threads pinned to `type#N` past an empty block. The alternative —
  canonicalizing on the raw stored list — preserves every old thread id but
  bakes the divergence in permanently. Recommended: validated list.
