# Builder redesign, increment 6 — presence.html onto the workspace brand (spec)

*2026-07-16 · Design doc only — no code in this increment. Eric's decisions being executed:
(1) bring the builder from its warm-paper/espresso look onto the workspace brand system
(purple/cream tokens + Fraunces/Inter, per the increment-5 commit `fbe1358` and `shell.css:8-23`),
**including dark mode**, which the builder entirely lacks; (2) an Adobe-informed restructure per
`docs/presence/ADOBE-PARITY-ATLAS.md` rows AC-1/AC-2/AC-4/AC-5 — a three-tab side panel,
a consolidated Page Information menu, and editor modes (Edit/Preview now; Annotate + Timewarp
as candidates).*

**This deliberately overrides the EC-1 freeze** (`docs/presence/PHASE-EC1-EXPERIENCE-COHESION.md`
§"The Website editor"), which recommended keeping the editorial-paper language and deferring dark
mode to a V1.1 visual pass. EC-1's actual argument was *"don't do it blind — it needs a
design-direction decision + visual QA."* Eric has now made the design-direction decision, and the
slice plan below builds the visual QA in (screenshots before every merge). The freeze's caution is
honored by the method, not by continued deferral. `DESIGN-SYSTEM.md` already flagged this as the
#1 remaining consistency question; this increment closes it.

Ground truth used throughout (verified in code, 2026-07-16): `presence.html` is **8,586 lines**
(it has grown past the 7,800 in earlier notes — Waves 1–2 landed G5/G6/G7/G10/G11/G18/G27 inside
it). Local tokens live at `presence.html:15-21`; the rail at `:649-668`; the design view at
`:851-932`; the FL_ Files library at `:2502-3005`; the publish ritual at `:3835-4095`;
G11 comments at `:4095-4262` + `:8275-8348`; version tools/timewarp at `:4470-4487`;
`dcPageMenu` at `:5533`; the content tree at `:8240-8373`.

---

## 1. Token migration map

### 1.1 The two systems, honestly

The builder's local tokens (`:15-21`) are **already half-converged**: increment 5 (`fbe1358`)
moved it to the self-hosted brand faces, so `--serif:'Fraunces'`, `--sans:'Inter'`,
`--mono:'Geist Mono'` are already identical to `tokens.css`. **Typography does not change in this
increment.** The accent is also already the brand purple — `--plum:#5b3fa0` equals `--dds-p`, and
`--plum-soft:#efeafa` equals `--dds-p-soft`, byte for byte. What actually diverges is the **warm
(espresso/paper) neutral ramp** and the **status colors** — and the complete absence of a dark mode.

A second, undocumented fact matters a lot: the *newer* builder chrome (everything built during the
Adobe-parity waves — `dc-*`, `cm-*`, `tg-*`, `pd-*`, `pp-*`, `tray-*`) was written against
**portal-style token names that presence.html never defines**, with hardcoded fallbacks:
`var(--line,#ddd)` ×145, `var(--wash,#f4f0fb)` ×14, `var(--card,#fff)`, `var(--muted,#8a8172)`,
`var(--soft,…)`, `var(--bg,…)`. Today those all silently render their fallback literals. This is
our lever: **define those bare names once at `:root`, mapped to the shell values, and roughly half
the canvas chrome snaps onto the brand system (and into dark mode) with zero per-rule edits.**

### 1.2 The map (every local token → workspace equivalent)

Targets are the shell tokens (`shell.css:8-23`), the canonical palette per `DESIGN-SYSTEM.md`.
Strategy: keep the local *names* as **aliases** (`--paper:var(--dds-bg)` etc.) so the ~330
`var(--paper/--sheet/--ink/--hair/--plum…)` usages migrate in one root block, no sweep of 8.5k lines.

| Local token (light value) | Workspace equivalent | Light delta (espresso→brand) | Dark value |
|---|---|---|---|
| `--paper` `#faf7f0` | `--dds-bg` | `#faf8f5` — warm cream → cool cream; barely perceptible (EC-1 called them "nearly identical") | `#171320` |
| `--sheet` `#fffdf8` | `--dds-card` | `#fff` — cards lose the cream cast | `#1f1a2b` |
| `--ink` `#211d19` | `--dds-ink` | `#1b1525` — espresso → plum-black; the single biggest perceived shift (all text) | `#efeaf7` |
| `--ink-2` `#6e6659` | `--dds-soft` | `#6b6478` — warm gray → cool violet-gray | `#a79ebc` |
| `--hair` `#e9e2d4` | `--dds-line` | `#eee9e0` — hairlines lose the tan cast | `#2a2338` |
| `--hair-2` `#ddd3bf` | *new* `--dds-line-strong` | `#ddd6ea` (tokens.css `--line-strong` value) — shell.css has no strong-line token; add it in the page root (light+dark), flag for later promotion into shell.css | `#3a3150` (derived; ~one step above `--dds-line`) |
| `--plum` `#5b3fa0` | `--dds-p` | **identical in light** | `#b79ceb` — accent lightens; every plum-filled control needs dark ink text (shell a11y rule, `shell.css:182-196`) |
| `--plum-soft` `#efeafa` | `--dds-p-soft` | **identical in light** | `#241d38` |
| `--sage` `#3d7a50` / `--sage-soft` `#e9f2ec` | `--dds-good` / `--dds-good-soft` | `#33664b` / `#e7f1ea` (increment-5 canonicalized values) | `#8bbf9f` / `#1f2a24` |
| `--amber` `#b4770a` | `--dds-warn` | `#775d31` — noticeably quieter/browner | `#d3ac6e` |
| `--amber-text` `#8a5c07` | `--dds-warn` | folds away — `--dds-warn` is already AA-tuned for small text on the light bg; keep the alias pointing at `--dds-warn` | `#d3ac6e` |
| `--clay` `#a8523f` (danger) | *new* `--dds-bad` | `#9a4242` (the shell's toast-error red, `shell.css:152`) — the shell has no first-class light danger token; define it here, matching the dark backfill that already exists (`shell.css:210-213` sets `--bad/--danger:#e08b83` for forced-dark) | `#e08b83` |
| `--serif/--sans/--mono` | already identical (increment 5) | none | n/a |
| `--dur:200ms` / `--ease` | already identical to tokens.css motion | none | n/a |

Hardcoded literals that must become tokens (these are the dark-mode blockers):

- `#b3a892` (::placeholder `:29`, disabled time inputs `:182`, `.fldot` `:259`) → `--dds-faint`.
- `#3a332c` (hover of ink-filled `.pillbtn.inked`/`.pubbtn` `:72,:290`) → replace the fill idiom:
  ink-filled buttons become **`--dds-ink` background / `--dds-bg` text** with a color-mix hover, so
  in dark mode they invert correctly (light fill, dark text) instead of vanishing.
- Warm shadows `rgba(60,45,20,…)` ×10 and espresso overlays/scrims/toasts `rgba(33,29,25,…)` ×12 →
  `--dds-shadow` and an ink-derived scrim (`color-mix(in srgb, var(--dds-ink) 42%, transparent)`).
  *Exception:* the `.mcell .alt` photo-caption gradient and `.mcell .badge/.del` sit **on top of
  photographs** — they stay literal dark; photo overlays are theme-independent.
- Raw `#5b3fa0` ×117: most are inline `style.cssText` (457 call sites) and CSS fallbacks. The alias
  strategy makes the *fallbacks* correct-in-light-only; the dark pass must sweep cssText for the
  ~30 sites that hardcode plum/ink as the **primary** value (e.g. compare button `:4451`
  `#5b3fa0/#faf7ff/#3a2470`). Exit criterion mirrors DS-1: grep-verified zero warm hexes, zero
  bare `#5b3fa0` outside the iframe-injected chrome.
- The `ee-`/`dc-` chrome **injected into the preview iframe** (`eeInjectChrome:3746`,
  `dcInjectCanvas`) keeps literal `#5b3fa0`: it renders inside the *site's* document, which does not
  theme (see 1.4). Same for `LOOK_SWATCH` (`:3556`) — those are the template families' own colors.

And the bare names the wave-era chrome already references, to be **defined once** at `:root`:

```
--line:var(--dds-line); --wash:var(--dds-p-soft); --card:var(--dds-card);
--sheet:var(--dds-card); --bg:var(--dds-bg); --muted:var(--dds-faint); --soft:var(--dds-soft);
```

### 1.3 Dark-mode strategy — the contract every other page uses

Exactly the shell's double-declaration pattern (`shell.css:8-23`), which the shell.js theme toggle
(`shell.js:19-33`, stamps `data-theme` on `<html>`) depends on:

```css
:root{ /* light aliases → --dds-* */ }
@media (prefers-color-scheme:dark){ :root{ /* dark values */ } }
:root[data-theme="light"]{ /* light values — forced-light beats OS-dark */ }
:root[data-theme="dark"]{ /* dark values — forced-dark beats OS-light */ }
```

presence.html currently contains **zero** `prefers-color-scheme`/`data-theme` rules (verified).
Because the alias layer holds the values, the dark blocks are ~20 lines, not hundreds.

Builder-specific surfaces needing explicit dark variants (enumerated; each is a checklist row for
the slice-A screenshot pass):

1. **Canvas chrome** — `.dc-bar`, `.dc-actbtn` (+`.primary`, `.on`), `.dpdevseg` (its
   `--wash` pill track + white "on" chip), `.dp-title`, `.dc-fab` (plum fill → needs `#171320`
   text in dark per the shell a11y rule), `.blk-gap .blk-plus`, `.blk-insertmenu`.
2. **Pages bar + menus** — `.page-pill` (+`.on` plum fill), `.page-add`, `.pp-pop`/`.pp-pop-item`
   (+`.danger` → `--dds-bad`), the new-page wizard `.dc-modal*`.
3. **Trays / slide-overs** — `.dc-slideover`, `.dc-panel-head`, `.dc-tabs`/`.dc-tab`,
   `.tray-*` (items, search input, group headers), `.dc-scrim` (opacity-tune for dark),
   `#designHost .field` cards.
4. **Content tree** — `.dc-tree-row` (+`.pagerow`, `.child`, `.core` — `.core`'s `#eee7de` tan chip
   needs a dark partner), `.dc-tree-ico`, `.dc-tree-acts`, `.dc-tree-addpage`.
5. **Comments (G11)** — `.cm-badge` (+`.zero`), `.cm-item` (+`.resolved`), `.cm-who .cm-k.client`,
   `.cm-reply`, `.cm-send`, `.cm-resolveall`.
6. **Pills & chips** — `.pillbtn` (+`.inked` — the invert idiom above), `.chip`, `.flchip` (+`.on`),
   `.smalltag`, `.textact`/`.quietact`/`.addline`.
7. **Preview-frame boundary** — `.dp-frame` (white bg + `--hair-2` border), `.dp-stage` letterbox,
   the vertical-resize grip, `.tg-shot`/`.tg-demo` template thumbnails, `#designPreviewEmpty`.
   Treatment in 1.4.
8. **The proofing desk (`.stage`)** — already dark (`#2a2118` espresso). Retint to the brand's
   dark family (`#171320`-derived) so it matches dark mode natively; in light mode it *stays dark*
   (a photography-lightbox is dark on purpose) — only its hue changes. `.papertabs`, `.pagewords`,
   `.deskseg`, `#lookSeg` swatch cards, and the `#fffdf8` focus-outline override (`:634`) retint
   with it.
9. **Publish ritual** — `.ritualwrap` (full-page `--paper` overlay), `.pubbtn`, `.pipe` steps,
   `.receipt` (+stamp), `.blockprose`.
10. **Overlays & feedback** — `.scrim`, `.sheetcard` (letters), `.toasts/.toast` (+`.bad`),
    `askText()` dialog (inline `var(--card,#fff)` styles inherit once the bare names exist),
    `.findresults`/`.findhit`, `.dds-hint` interplay.
11. **Forms & fields** — `.field` serif underline inputs, `.hoursgrid` time inputs, `.rtbar`
    buttons, `.editor` cards, `.uploadprep`, `.flrow` inputs/selects, `::placeholder`.
12. **Files & pickers** — `.mediagrid`/`.mcell` (chrome only; photo overlays stay literal),
    `.pickerTabs/.pickerTab`, `.pickerStockBar`, `#assetHealth`.
13. **Mobile** — `.dock` (espresso pill → `--dds-card` + border in dark, ink pill in light),
    bottom-sheet variants of the slide-overs, `.dc-fab` position collisions unchanged.
14. **States** — `.estate`, `.loadline`/`.shimmer` (plum shimmer reads fine on dark), `.gate .card`,
    `.journal`, `.hentry` history rows, `monitorCard`.

**Not themed (deliberately):** everything inside `#designPreview`, `#previewFrame`, `.tg-shot`
iframes and picker/stock thumbnails — that's the customer's *site*, plus the G27 style-popover
**color wells and WCAG contrast chips**, which compute against the site's own colors (the math and
swatches must not shift with the workspace theme; only the popover's chrome themes).

### 1.4 The preview-iframe boundary (the site is light by design)

The canvas iframe renders the published-site HTML with the owner's template colors — typically
light. In dark mode a bright rectangle will dominate the viewport. Spec:

- **Never** filter, invert, or re-theme the iframe content. What Eric and owners see must be
  exactly what publishes. (This also protects the G27 contrast-checker's honesty.)
- Frame it as an object sitting *on* the workspace: `.dp-frame` gets a 1px `--dds-line` border, a
  slightly stronger `--dds-shadow`, and `border-radius:12px` as today; the `.dp-stage` letterbox
  area (visible in Tablet/Phone widths) is `--dds-bg`, so the light page reads as "a paper page on
  the desk", the same idiom the dark proofing desk already uses (white `.proof` on `#2a2118`).
- The caption above the frame ("Your home page, as it would publish") gains three words in dark
  mode only: "…as it would publish — **shown in its own colors**." One-line honesty beats a
  mystery-white box.
- Same treatment for `.tg-shot` gallery thumbs, `#pickerGrid`/stock thumbs, and the ritual's
  receipt — anything that shows site/photo content keeps its own colors inside a bordered frame.

---

## 2. Structure map — current layout → target layout

### 2.1 Current (verified)

```
.shell
├─ .rail (:649) — Today · Design · Files · Visual Studio(link) · Bookings · Reviews
│                 · Domain & email · History          ← Architecture v1.0 frozen nav
├─ .topbar (:671) — find · whisper · "See your site"(#btnPreview) · "Publish"(#btnPublish)
└─ .content > #view-design (:851)
   ├─ #pagesBar (:856) — page pills, each with ⋯ → dcPageMenu(:5533)
   └─ .designstudio (:859)
      ├─ #designCanvas
      │  ├─ .dc-bar — #dpDevSeg (Desktop/Tablet/Phone) ·
      │  │           #btnUndo #btnRedo #btnShareDraft #btnComments(G11)
      │  │           #btnContentsOpen #btnTrayOpen(＋Add section) #btnNavEdit(Menu) #btnSettingsOpen
      │  └─ #designPreviewWrap — .dp-frame > #designPreview iframe (dc-live) + #btnAddFab
      ├─ #trayPanel (left, docks ≥761px) — 2 tabs: #tabContents(#designTreeList tree)
      │                                            #tabAdd(#designTray catalog)
      ├─ #settingsPanel (right overlay) — #designGallery (template families) + #designHost
      │        (blocksCard editors incl. G27 style popover · brand kit · forms · dev CSS)
      ├─ #commentsPanel (right, G11 threads) · #dcScrim
Elsewhere: publish ritual #ritualWrap(:957, G5 publish-later lives inside loadRitual :3986);
proofing desk .stage(:1037, #verSeg draft/live · #pageWords · #lookSeg · #devSeg);
Files view #view-media (FL_ library :2502); History #view-history (offline toggle G10 :4339,
checkpoints, launches, compare + Timewarp :4470).
```

### 2.2 Target

**The left rail does not change** (frozen nav). The topbar does not change. Everything below is
inside `#view-design`, plus one consolidation that pulls scattered page actions into one menu.

#### a. Three-tab side panel (AC-1/AC-2) — `#trayPanel` grows one tab

| Tab | Adobe analog | What it is | Where it comes from |
|---|---|---|---|
| **Blocks** | Components | The searchable add-section catalog (groups, drag-to-canvas, `pd-*` ghost/dropline machinery) | Today's "＋ Add section" tab — `#designTray` + `mountBlockTray()` move unchanged; the tab is renamed |
| **Files** | Assets | **NEW**: a compact asset browser in the panel — collection chips (subset: All/Photos/Brand/Stock), search, thumbnail grid; click a block's image slot then a file, or drag a photo onto an image-bearing block; footer deep-links to the full Files view / files.html for versions/where-used/crops | Fed by the `FL_` machinery from #180 (`FL_COLS/FL_qstr/FL_load` `:2502-2600`) reused with a panel-scoped state object — **not** by repointing `FL_S`, which owns `#mediaGrid` (see `FL_takeover:2522`); thumbnails render through `renderMediaGrid(grid, false, onPick)` — the exact contract the pickers already use (`:3194`) |
| **Content tree** | Content Tree | The page tree: every page, the open page expanded to its sections, **columns containers expanded to their columns** (`dcTreeChildRow:8303` — width n/12 meta), click-to-select-on-canvas (`dcTreeSelect:8368`), ⚙ opens the block editor, G11 badges ride the rows | Today's "Contents" tab — `dcBuildTree` (`:8250`) moves unchanged, **plus one genuine addition: drag-reorder within the tree**, reusing the existing list-order drag machinery (`pd-ghost`/`pd-dropline`, which already computes single-gap indices) so tree-drag and canvas-drag share one code path. Reorder targets stay top-level list order + per-container column order — never x/y (the moat holds; freeform's *interior* is the freeform editor's job, not the tree's) |

Honest note: the atlas row AC-2 marked us ⚠️ for "no unified asset-browser tab" — the Blocks and
Content-tree tabs already exist in embryo (two tabs today); **the Files tab is the only net-new
surface**, and drag-reorder-in-tree is the only net-new behavior.

#### b. Page Information menu (AC-5) — one place for everything about *this page/site*

A new `#btnPageInfo` ("Page ▾" or ⓘ) at the left of `.dc-bar`, next to the device segment. Every
entry **exists today** and keeps its machinery; the menu is deep-links, not rebuilds:

| Menu entry | Lives today at | Moves or links? |
|---|---|---|
| Publish now… | topbar `#btnPublish` → `openRitual()` (`:3835`) | Links (opens the ritual; the topbar button stays — it's the product's one point of gravity) |
| Publish later / scheduled changes | *inside* the ritual (`loadRitual` G5 block `:3986-4076`, incl. "take offline at") | Links to the ritual scrolled to the schedule block; the ritual remains the single publish door |
| Share draft… | `.dc-bar` `#btnShareDraft` (`:873`, `shareDraftLink:4081`, G6) | **Moves** into the menu (frees dc-bar width for the modes bar, §c) |
| Take offline / bring back | History view → `renderPreviewPanel` offline row (`:4339-4356`, G10) | **Moves** in as the action; History keeps a read-only "⏸ Offline since…" status line (it's site-level state and belongs in the version journal too) |
| Page properties: Rename / address, Duplicate, Hide from menu, Move left/right, Clear, Delete | `dcPageMenu` (`:5533`) on page-pill ⋯ and tree-row ⋯ | **Shared**: the menu shows the same items for the *current* page (`DC_PAGE`); the ⋯ affordances on pills/tree rows stay (they act on *any* page, and they're muscle memory) |
| Search & share appearance (SEO title/description, og/twitter share fields, show-on-Google) | Business view → `mountSearchCard` (`:4704`): `pages_noindex` toggles `:4726`, per-page `page_seo` overrides `:4744` | **Moves** the *per-page* fields in (scoped to the current page — "How this page reads in search & when shared"); the site-wide search health + verification codes + redirects stay in Business |
| View as published (draft, chrome-free) | topbar `#btnPreview` → the stage | Links (see modes, §c) |
| Last edit / who | the 409 `stale_draft` provenance (`:1261-1270` — "changed by your studio / someone else…") | New passive line at the top of the menu — our honest answer to Adobe's Lock: the guard is `optimistic_lock`, automatic; the menu *shows* provenance instead of offering a manual lock |

#### c. Editor modes (AC-4) — Edit / Preview now; Annotate / Timewarp candidates

A segmented mode control at the left of `.dc-bar` (beside Page Information), replacing nothing —
the device segment (`#dpDevSeg`) stays exactly as-is and stays **orthogonal**: device = viewport
emulation of the frame, mode = what interaction the canvas offers. (Adobe works the same way —
emulator ≠ mode.)

- **Edit** — today's default: `dc-live` interactive iframe, injected chrome, FAB, insert gaps.
- **Preview** — the same frame with all editing chrome withheld (no injected toolbar/outlines, no
  FAB, `pointer-events` limited to scrolling) — "read your page like a visitor" without leaving the
  canvas. Semantics vs today: this is *per-page, in-canvas*; the full-site proofing desk
  (`.stage`, Draft/Live, page words, `#lookSeg`) remains "See your site" — it does site-level jobs
  (live comparison, template try-on) the canvas mode doesn't. (Open question 1 asks whether these
  eventually merge.)
- **Annotate** (candidate) — **the G11 Comments toggle re-homed.** Same machinery, new position:
  mode-on runs `cmToggle()` (`:4127`) — loads threads, shows tree badges, opens `#commentsPanel`.
  Recommendation: keep the customer-facing word **"Comments"** on the control (plain-English voice;
  "Annotate" is the Adobe-parity name in docs only). `#btnComments` id is preserved wherever the
  button lands.
- **Timewarp** (candidate) — a date-picker over the **existing** `GET /publishes/timewarp` route
  (used today from History's version tools, `:4481-4485`): pick a date → `openPublishPreview()`
  renders that version in the frame, read-only, with a banner ("Your site as it looked on …
  — Back to today"). Zero backend work; G15's *future* timewarp stays out of scope here.

Mobile (≤760px): the modes fold into the existing dock/sheet idiom; slide-overs remain bottom
sheets; no new mobile surface in this increment.

---

## 3. What does NOT change

### 3.1 e2e-pinned selectors & copy (each kept verbatim; specs run per slice)

From `tests/e2e/cms.spec.ts`:
- `#lnkConnections` / `#lnkVisual` — visibility gating by edition (`:3291-3294`). Untouched.
- `.navitem[data-view="media"]` with exact text **"Files"**; `#view-media h1.doc` exact text
  **"Files"**. The rail markup and view headings keep ids, classes, and copy.
- Hash deep-links: `#design` → `#view-design` visible; `#business` → `#view-business` visible.
- `#btnSettingsOpen` (the Design-settings launcher) — id and role kept; the gallery stays inside
  the panel it opens.
- `#designGallery .tg-card[data-look="business-classic"|"editorial"]`; gallery contains
  **"Editorial"** and **"print serif"** (the `LOOK_SWATCH` tag strings `:3556-3560`). Kept.

From `tests/e2e/shell.spec.ts`: the ⌘K palette lands on `/presence.html#design` — so the
`HASH_VIEWS` contract below is load-bearing from *outside* the page too.
(`a11y.spec`/`responsive.spec`/`visual.spec` do not visit presence.html — verified.)

### 3.2 Contracts and just-shipped functionality

- **`HASH_VIEWS` (`:1348`) and `routeHash` specials** — every key (`today business settings search
  offerings content services menu faqs testimonials updates media photos bookings appointments
  reviews reputation design history versions`) plus `#publish`/`#preview`/`#foundations|#export`.
  No key removed or remapped.
- **`go(view)` semantics** (`:1312`) — `.view.on` toggling, `#view-*` ids, `h1.sr-only` "Website",
  per-view `h1.doc`, `design-wide` content class, dock sync.
- **`renderMediaGrid(grid, manage, onPick)` (`:3005`)** — the pickers' contract: `#pickerGrid`
  passes `manage=false, onPick` (`:3194`); `FL_takeover` (`:2522`) only owns `#mediaGrid`. The new
  Files tab *consumes* this contract; it must not alter it or repoint `FL_S`.
- **`#lookSeg`** (`:1052`, `mountLookSeg:3562`) — the stage's "Try another look" family cards +
  "Use this look" flow. Retinted in slice A, functionally untouched.
- **G11** — `#btnComments` (until slice D re-homes the *button*, ids/handlers persist:
  `cmToggle/CM_ON/cmBadge/cmSectionIds`, `#commentsPanel`, orphan rows, shared-draft client loop).
- **G18** — gallery per-image captions (index-aligned `captions[]`) + tap-to-zoom field (`:6669-6710`).
- **G27** — the "Style this section" popover (`:5901-6060`): 7-key allowlisted style object,
  curated wells + Custom hex, live WCAG chips, "Darken until readable", `contrast_ack` re-arm,
  bg/look mutual eviction. The *chips'* colors are site-side and stay theme-independent (§1.3).
- **G25** — the `freeform` block type is backend-only so far (`lib/render_types.ts:212`,
  0 frontend references). The side-panel restructure must leave room for its editor to mount via
  the same `#designHost`/blocksCard path; nothing in this increment may assume top-level blocks are
  non-freeform.
- **Everything else that just landed or is daily-driven**: undo/redo history (`dcResetHistory`),
  share-draft (G6), pages bar + `dcPageMenu` operations (G7 duplicate/rename-with-redirect/
  delete-with-refs-and-undo/clear), insert gaps (`blk-gap`) + insert menu, `pd-*` drag machinery,
  `#dpDevSeg` device emulation, `#btnAddFab`, the ritual's G5 schedule block, G10 offline state,
  checkpoints/launches/compare/timewarp in History, the FL_ library + stock picker, the writing
  desk, the mobile dock/sheets.
- **Mount-point ids** the engine writes into: `#designTray`, `#designTreeList`, `#designHost`,
  `#designGallery`, `#designPreview`, `#trayPanel`, `#settingsPanel`, `#commentsPanel`,
  `#pagesBar`, `#mediaGrid`, `#pickerGrid`. All kept — the restructure moves *around* them.

---

## 4. Build slices — each independently shippable, screenshots before merge

| Slice | Size | Contents | Ships when |
|---|---|---|---|
| **A — tokens + dark mode** | S/M | The §1 alias block (local names → `--dds-*`), the bare-name definitions (`--line/--wash/--card/--muted/--soft/--bg`), the four-block theme contract, the literals sweep (placeholder/ink-fill/shadows/scrims/stage/dock), the iframe boundary treatment. **Zero structural change — not one element moves.** | Light mode is a near-noop diff (plum/plum-soft/serif/sans already identical; neutrals shift one temperature step); dark mode passes the §1.3 fourteen-surface checklist; grep gate: zero warm hexes / bare plums outside iframe-injected chrome; cms+shell specs green (the sandbox e2e suite is fully green as of 2026-07-16 — 155 passed across desktop/tablet/mobile — so ANY new failure is real); screenshots light+dark of: Today, Design canvas (all 3 devices), both tray tabs, settings panel + G27 popover, comments panel, ritual, stage, Files, History, picker, mobile dock |
| **B — Page Information menu** | M | `#btnPageInfo` + the §2.2b table: move Share draft + Take offline + per-page SEO/share fields; link Publish/Publish-later/View-as-published; provenance line. No backend change — every action calls the existing function. | Menu present on desktop+mobile; moved items work from their new home; History shows offline *status*; Business keeps site-wide search health; screenshots of the open menu + each moved flow |
| **C — side panel, three tabs** | M/L | Rename Contents→Content tree, Add→Blocks; build the Files tab on FL_/renderMediaGrid per §2.2a; drag-reorder in the tree via the `pd-*` path; G11 badges/orphans intact. | All three tabs work docked (≥761px) and as bottom sheet; picker contract untouched (pickers still pass); tree-drag reorders exactly like canvas-drag (same single-gap index); screenshots of each tab + a drag mid-flight |
| **D — modes bar** | S | Edit/Preview toggle per §2.2c; re-home `#btnComments` as the third mode (label stays "Comments"); Timewarp = date input + `GET /publishes/timewarp` + read-only banner. | Preview withholds all edit chrome; Comments behavior byte-identical (same `cmToggle`); Timewarp renders any past version in-canvas and returns cleanly; screenshots of all four modes |

Order A→B→C→D; A is the only one that touches everything, which is why it changes nothing
structural. B/C/D are independent of each other and can land in any order after A. Every slice ends
with the cms/shell spec run plus a light+dark screenshot set attached to the PR for Eric's sign-off
**before** merge.

---

## 5. Risks, honestly

1. **The 8,586-line single file.** One HTML file holds CSS, markup, and ~7k lines of JS with 457
   inline `style.cssText` sites. A token migration that only edits the `<style>` block silently
   misses inline styles. *Mitigation:* the alias strategy makes most inline `var(--x, fallback)`
   sites correct automatically; a scripted grep inventory (warm hexes, bare plums, espresso rgba)
   is the slice-A exit gate, exactly like DS-1's "zero warm hexes remain" verification. No file
   split in this increment — that's a separate refactor decision, not a redesign rider.
2. **The e2e surface is thinner than the product.** Only ~9 assertions pin presence.html; the specs
   passing does not mean the builder works. (The suite itself is no longer a caveat: as of
   2026-07-16 the sandbox runs all three projects fully green — 155 passed — so a red test during
   this increment is a real regression, not baseline noise.) *Mitigation:* treat the §3 list as the
   real contract; the screenshot ritual is the actual regression net for everything untested.
3. **Muscle-memory disruption on Eric's daily driver.** Share draft leaves the dc-bar (B), tab
   names change (C), Comments moves (D). *Mitigation:* the slices are deliberately small enough to
   revert individually; positions of Publish, the FAB, page pills, and the device segment never
   move; ⋯ menus on pills/tree rows remain; screenshots-before-merge means Eric approves each
   change visually before it lands, not after.
4. **Dark mode on a surface full of literal-color edge cases** — photo overlays, iframe-injected
   chrome, the G27 site-side color math, template swatches. Any blanket recolor corrupts one of
   these. *Mitigation:* §1.2/§1.3 explicitly fence the not-themed set; the checklist names them so
   the visual pass verifies both directions (themed things theme, fenced things don't).
5. **Collision with in-flight work.** The G25 freeform *editor* slice will land in presence.html in
   parallel with this increment. *Mitigation:* sequence slice C after the freeform editor's mount
   lands, or reserve its `#designHost` path now (§3.2); slice A is safe to land first regardless
   and immediately gives the freeform editor dark-correct chrome for free.

---

## Open questions for Eric (≤3) — ANSWERED (Eric, 2026-07-16)

**Decisions: (1) canvas surround goes DARK in dark mode** with the §1.4 framed-boundary
treatment · **(2) HARD MOVE** into Page Information (no transition aliases; History keeps the
read-only offline status line) · **(3) KEEP BOTH** preview homes — in-canvas Preview and the
proofing desk stay separate surfaces with separate jobs. The questions below are preserved
as asked, for the record.

1. **Preview mode vs "See your site":** slice D keeps both — in-canvas Preview for the current
   page, the dark proofing desk for full-site Draft/Live walks and `#lookSeg` template try-on. Is
   that the end state, or should the stage eventually fold into Preview mode (bigger, later
   increment)?
2. **Hard move or transition aliases?** When Page Information takes over Share draft, Take offline,
   and per-page SEO, do the old homes keep working entry points for a release or two (a "moved —
   find it under Page ▾" hint), or do we move hard in one release? (Recommendation: hard move, with
   History keeping the read-only offline status line — duplicates are how products rot.)
3. **Should the canvas surround go dark in dark mode?** Recommended: yes, with the framed-boundary
   treatment (§1.4). But judging a light website against a dark surround changes color perception —
   if you'd rather design against a fixed light "studio table" even when the workspace is dark, say
   so now; it's a one-rule carve-out in slice A and much cheaper to decide before screenshots than
   after.
