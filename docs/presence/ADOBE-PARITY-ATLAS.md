# Adobe Parity Atlas — Design Studio (2026-07-15)

Working spec for the Adobe-parity build. Every Adobe claim cites its input; every Studio OS claim comes from the code-verified inventory. Nothing here is guessed.

**Citation key:** `[learn]` = learn-page-authoring atlas (18 pages, 89 caps) · `[cs-auth]` = AEMaaCS Sites authoring atlas (60 pages, 579 caps) · `[cs-site]` = AEMaaCS site-creation atlas (5 pages, 22 caps) · `[dmc]` = Dynamic Media Classic tutorial atlas (11 pages, 123 caps) · `[DR-n]` = deep-research verified finding #n (all high-confidence, 3-0 or 2-1 adversarially verified). Studio OS evidence = `design-studio-inventory.md` (presence.html + supabase/functions/presence/).

## A. How this was researched

Eric's four Adobe doc guides (94 pages, 813 raw capability extractions) were crawled page-by-page via the AdobeDocs GitHub mirrors — the live experienceleague.adobe.com pages 403 automated fetch, and the canonical `experience-manager-learn.en` repo is now empty, so content was recovered from `-old.en`, localized mirrors (ja-JP, pt-BR, de-DE, fr-FR), and the canonical `experience-manager-65.en` / `experience-manager-cloud-service.en` companion docs [learn][dmc]. In parallel, a deep-research pass extracted 89 claims, adversarially verified 25, confirmed 24 (killed 1), and synthesized 14 findings — all on the AEM page editor, editable templates, content policies, Style System, responsive layout, and Universal Editor basics. Honest holes: **Adobe Express / Creative Cloud tooling (brand kits, template galleries, quick actions, Firefly generate/text-to-image/generative fill, resize/reformat, scheduling/share) produced zero verified claims and is unrepresented here** — and it is the Adobe product closest to our small-business user; Firefly/GenAI detail inside AEM survived only as the "Generate Variations" console name; Content/Experience Fragment and Launches workflow detail rests on the crawl (guide-level confidence) rather than the verified pass; several learn-guide pages were pure video stubs or unrecovered (responsive-layout, launches, page-authoring-overview) and were grounded on canonical docs instead. One claim was refuted 1-2 (the exact field layout of the Style System policy dialog's Styles tab) — the Style System mechanism itself is confirmed [DR-8]. Express & Firefly detail is to be filled by a targeted follow-up research pass (Wave 3).

## B. The Adobe capability atlas

> **Filtered per Eric 2026-07-15: SMB/mid-market value only; enterprise-scale machinery listed but excluded.**

Condensed to **106 distinct capabilities** (deduplicated from 813 raw extractions): **77 SMB-relevant** (full lines below) and **29 enterprise-only** (one-line excluded sub-lists). SMB test applied: would a 1–20-person business owner, or the freelancer/agency serving them, feel its absence in a week of real use? Format: **name** — what it does — user workflow. IDs carry into sections C and D.

### B.1 Authoring canvas & editor modes (AC)

- **AC-1 Three-part page editor** — toolbar (modes + page settings) / side panel / canvas rendering the page as-published — open page → drag from panel → edit in place [DR-0]
- **AC-2 Side-panel browsers** — Components / Assets / Content Tree tabs — toggle panel → pick tab → search/filter → drag out [DR-0]
- **AC-3 Drag-and-drop component authoring** — place components/assets at any canvas position; edit in place, move, delete — drag → drop-zone highlight → drop → inline toolbar [DR-0]
- **AC-4 Eight editor modes** — Edit, Layout, Targeting, Timewarp, Live Copy Status, Developer, Preview, Annotate; availability depends on page + permissions — mode selector top-right; Ctrl-Shift-M toggles Preview [DR-1]
- **AC-5 Page Information menu** — one drop-down consolidating last-edit/publish info + Open Properties, Start Workflow, Lock, Publish/Unpublish, Edit Template, View as Published, Promote Launch — hamburger top-left → action [DR-2]
- **AC-6 Three component-edit methods** — Configure (properties dialog), inline edit, full-screen edit — select component → toolbar icon [cs-auth]
- **AC-7 Annotations** — notes + sketches (arrow/circle/oval only) pinned to components; count badge on toolbar; move/copy carries them, component delete removes them — Annotate mode → + → click component → type/sketch → click outside saves [cs-auth]
- **AC-8 Device emulator bar** — desktop/tablet/mobile viewport preview above canvas — toolbar emulator icon → pick device [learn][DR-11]
- **AC-9 View as Published** — new tab, no editor chrome (`wcmmode=disabled`) — Page Information → View as Published [learn]
- **AC-10 Universal Editor in-context editing** — hover = light-blue outline + badge, select = dark-blue; double-click/double-tap edits text in place, Enter or click-away saves [DR-12]
- **AC-11 Universal Editor component ops** — category-filterable component picker; hotkeys `a` add, `Shift+Backspace` delete; duplicate inserts below; Cmd-C/V copy/paste incl. cross-tab (paste obeys container's allowed-components) [DR-13]
- **AC-13 Accessible-authoring affordances** — alt text field + "Image is decorative" checkbox, carousel Accessibility Label, RTE heading/list structure, Table/Cell Properties (th/scope), page Language, form label rules — per-component edit dialogs [cs-auth]
- **AC-14 RTE with policy-toggled plugins** — Word paste, Find & Replace, Spell Check etc. toggled per named, reusable policy — template author toggles in policy UI [learn]

*Enterprise-only (excluded):* **AC-12** four parallel authoring methods (Universal Editor / Page Editor / document-based Word-GDocs via Edge Delivery / headless CF editor) — a multi-delivery-model architecture split, not an SMB need [cs-auth].

### B.2 Sites console & page operations (SC)

- **SC-1 Three console views + quick actions** — Card (mouseover/tap-hold quick actions on single items), List (Name/Modified/Published/Template columns), Column (Miller columns) — view switcher top-right [learn]
- **SC-2 Selection + contextual actions toolbar** — select via thumbnail/checkmark → header becomes action toolbar; bulk exposes restricted subset (Move single-page-only) [learn]
- **SC-3 Console rails** — Content Tree (keyboard-navigable page tree), Timeline (event history: comments/versions/workflows; start workflows, manage versions), References (incoming/outgoing refs), Filter — rail selector top-left [learn]
- **SC-5 Create Page wizard** — Create → Page → template selection (only templates allowed at that location) → Title (required) vs Name (URL slug, auto-derived/sanitized) → Open/Done [learn]
- **SC-6 Copy/Paste pages** — same-level paste keeps Title, auto-regenerates Name to avoid collision; cross-folder can keep name [learn]
- **SC-7 Move page wizard** — rename option → destination → review/adjust republish + referencing pages → confirm; adjusts references [learn]
- **SC-8 Delete with recovery** — confirmation warns about live references; recoverable via Restore Tree / Restore Version [learn]
- **SC-9 Lock/Unlock page** — freezes edits by others; console indicator; only lock owner or admin unlocks [learn]
- **SC-10 Page Properties dialog** — Basic (title/on-off publish times/vanity URL), Advanced (redirect), Thumbnail (generate-from-page / upload / pick from Assets), Social Media (Facebook + Pinterest only); bulk edit of common fields via multi-select [learn]
- **SC-12 OmniSearch** — `/` hotkey or magnifier → full-screen search with filter-predicate rail, works from any console [learn]
- **SC-13 Content hierarchy = URL tree** — page tree under site root defines URL paths; Title (display) vs Name (slug) split everywhere [learn]

*Enterprise-only (excluded):* **SC-4** Site rail theme-source download / theme version pinning / front-end pipeline enablement (Cloud Manager dev workflow) [cs-site]; **SC-11** page-tagging taxonomy via a dedicated Tags console (enterprise content governance) [learn].

### B.3 Templates (page + site) & policies (TP)

- **TP-1 Editable templates** — define page structure + initial content + allowed components; live `cq:template` link to every page: structure/policy changes propagate to existing pages immediately, initial-content changes only affect new pages [DR-3][DR-6]
- **TP-2 Template Editor, three modes** — Structure (locked components — un-movable/un-deletable on pages), Initial Content (unlocked = author-editable seed), Layout (per-device pre-layout); authors can add components only where the template author placed a Layout Container [DR-4]
- **TP-4 Content (design) policies** — named, reusable across templates; per-container: Allowed Components (grouped checklist), Default Components (MIME-type → component mapping so dragged assets auto-become the right component), Responsive Settings (grid columns); replaces Design mode [DR-7]
- **TP-5 Shared component policies (RTE/image)** — toggle RTE plugins, image cropping/upload options; saved as named policies — editing a shared policy affects every template using it [learn]
- **TP-6 Site templates** — packaged base site with previews; Create Site wizard: pick template → site title + name → Create → site appears with template-defined structure [cs-site]
- **TP-9 Template-author role** — power users create/configure templates with no developer once components exist; mechanism transparent to page authors [DR-3]

*Enterprise-only (excluded):* **TP-3** template fleet lifecycle/governance (Draft→Enable→Allow-per-content-tree path patterns; ≤100 / never >1000 rule) [DR-5][DR-6]; **TP-7** site-theme dev handoff (download .zip → front-end dev → repo redeploy) [cs-site]; **TP-8** front-end pipeline + custom-domain asset serving via repository config [cs-site].

### B.4 Style system & responsive layout (ST)

- **ST-1 Style System** — template author maps display names → CSS classes in the component policy; page author selects component → Styles (paintbrush) button → menu; style groups mutually exclusive or combinable; visual variation with zero back-end code [DR-8]
- **ST-2 Layout Container (responsive grid)** — grid paragraph system: horizontal snap-to-grid, per-breakpoint behavior, nestable for columns (nested column count ≤ outer) [DR-9]
- **ST-3 Layout mode interactions** — two entries with different persistence; drag blue dots to resize (mandatory snap; alignment grid shows); Float to new line; Hide component per breakpoint; Show hidden (count badge) / Restore all / Revert breakpoint layout [DR-10]
- **ST-4 Breakpoints + Emulator** — breakpoints = max device widths configured on template or page (inherited); not directly selectable — picking a device in the Emulator auto-activates its breakpoint; markers along the top; separate layout per breakpoint [DR-11]

*Enterprise-only (excluded):* none — this whole group is visible to any site owner.

### B.5 Fragments & reuse (FR)

- **FR-1 Content Fragments** — page-independent structured content edited centrally in its own editor [cs-auth]
- **FR-2 CF variations** — named variations managed centrally; Master always present [cs-auth]
- **FR-3 CF referencing with propagating edits** — three insertion routes onto pages; Edit icon opens the fragment editor and edits propagate to every referencing page [cs-auth]
- **FR-7 Experience Fragments** — reusable component groups with content AND layout; can nest other fragments [cs-auth]
- **FR-8 XF variations** — plain or live-copy variations (live-copy inherits from Master) via Variations rail [cs-auth]
- **FR-9 Building Blocks** — select components in the fragment editor → Convert to building block → reusable via a Building Blocks tab; rename/delete/go-to-master per block [cs-auth]
- **FR-11 Generate Variations console** — generative-AI content variations from Adobe-provided or user-managed prompts; the only GenAI console in global nav [cs-auth]

*Enterprise-only (excluded):* **FR-4** in-between content drop zones (absolute positioning; Adobe-documented fragility) [cs-auth]; **FR-5** associated asset-collection tabs [cs-auth]; **FR-6** CF JSON export as Adobe Target offers / headless app delivery [cs-auth]; **FR-10** XF folder governance (allowed-template regexes, ContextHub personalization, `.plain.html` third-party rendition, root-publish-unpublishes-children edge) [cs-auth].

### B.6 Launches (LA)

- **LA-1 Create launch** — copy source pages to author a future release (seasonal menu, rebrand) in parallel while production stays live; Add Pages + Include subpages → title, optional live-data inheritance, Launch Date [cs-auth]
- **LA-4 Edit launch content** — standard Page Editor with launch context bar (Leave/Navigate) [cs-auth]
- **LA-5 Launch inheritance padlocks** — closed padlock = section inherits from live source; click to break so source overwrites can't clobber launch edits; suspend/resume per page; sync one-way source → launch [cs-auth]
- **LA-6 Compare launch to source** — References rail → launch → Compare to Source → side-by-side two-pane diff [cs-auth]
- **LA-7 Edit launch scope & config** — add/remove source pages; edit Title / Launch Date / Production Ready [cs-auth]
- **LA-9 Timewarp future preview** — Timewarp mode with a date after the promotion date renders the launch's future content; closest-live-date-wins with multiple launches [cs-auth][learn]
- **LA-10 Promote launch** — wizard: scope = full / modified pages / approved pages / current page / current+subpages; delete-after-promotion option [cs-auth]
- **LA-11 Auto promote + publish** — Launch Date AND Production Ready flag together trigger promotion + auto-publish on the date; either alone does nothing [cs-auth]

*Enterprise-only (excluded):* **LA-2** launch-with-new-template (produces empty pages — content silently not copied) [cs-auth]; **LA-3** nested launch-of-a-launch, clone, cascading delete [cs-auth]; **LA-8** creating/deleting pages inside launch trees with Launch Source back-links [cs-auth]; **LA-12** MSM at scale — blueprints, live-copy rollout, language-master/locale-tree fleets [learn][DR-2].

### B.7 Workflows & approvals (WF)

- **WF-1 Inbox** — centralizes assigned items with a header count badge; List view + Calendar view (Due Soon / Past Due filters) [cs-auth]
- **WF-2 Inbox item actions** — Complete, Delegate (reassign), Open, View payload; one item at a time [cs-auth]
- **WF-5 Publish approval routing** — publishing routes through an approval workflow when the user lacks publish rights [learn]
- **WF-6 Annotation-driven review** — annotations as review markup; add/update/delete can fire notifications [cs-auth]

*Enterprise-only (excluded):* **WF-3** task→project seeding with role templates [cs-auth]; **WF-4** arbitrary custom workflow models started per page [DR-2][cs-auth]; **WF-7** Projects console for cross-team content programs [cs-auth].

### B.8 Versioning & publishing (VP)

- **VP-1 Page versions** — snapshot with optional label/comment via Timeline; preview, restore (Restore Version / Restore Tree for deleted pages) [learn]
- **VP-2 Page diff** — Compare to Current from Timeline (current left, historical right); component-level green/pink + HTML-level dark-green/red coding; also launch-vs-source context; limits: current-vs-historical only, client-side DOM diff breaks on dynamic content [learn]
- **VP-3 Timewarp** — mode selector → pick date/time → read-only render of the version active then; silent fallback to current state if none; explicitly not an audit log [learn]
- **VP-4 Publish/Unpublish from editor** — current page; publish optionally selects which references go along [learn]
- **VP-5 Quick Publish** — one click from console, shallow (no children), auto-publishes unpublished references without prompting [learn]
- **VP-6 Manage Publication wizard** — Publish/Unpublish; Now vs Later (scheduled); Include Children + per-reference customization [learn]
- **VP-7 Preview tier** — optional staging environment: publish there to review the final experience before going live [cs-auth]

*Enterprise-only (excluded):* none — version safety and scheduled publishing are exactly what a small owner feels.

### B.9 Dynamic Media / media sets (DM)

- **DM-2 Multi-resolution master** — one master per image drives every resize/zoom rendition [dmc]
- **DM-3 Controlled overwrite/replace** — replacing a same-name asset updates it everywhere (with cache-delay caveats) [dmc]
- **DM-6 Image Presets** — named rendition recipes (W/H, format+quality, sharpening); one per display size; editing a preset updates every image using it [dmc]
- **DM-7 Media sets** — Image Set (alternate views + thumbnail strip), Swatch Set (colorway view/swatch pairs), Spin Set (360°), Mixed Media Set (tabbed images+video) — built by drag, saved as virtual assets [dmc]
- **DM-9 Crop & trim** — non-destructive crop editor (save as new master or virtual additional view; Reset undoes); Trim auto-crops whitespace [dmc]
- **DM-11 Zoom viewers + Zoom Targets** — deep-zoom product viewers; authorable guided-zoom hotspots per image [dmc]
- **DM-13 Video pipeline** — preset transcoding to MP4, streaming or progressive delivery, captions (multi-language) + chapter markers [dmc]
- **DM-14 Video SEO** — auto-generated video sitemap/mRSS feeds with mapped metadata for search consoles [dmc]
- **DM-15 Smart Imaging** — automatic delivery-time WebP + per-browser quality tuning, existing URLs unchanged; typical ≥30% size cut [dmc]
- **DM-17 Trash lifecycle** — soft delete → restorable Trash → permanent purge after 7 days [dmc]

*Enterprise-only (excluded):* **DM-1** FTP bulk ingestion, recurring scheduled uploads, upload job options [dmc]; **DM-4** SKU-driven Asset-ID naming so ERP/templates construct URLs (account-wide case-sensitive IDs) [dmc]; **DM-5** raw URL-modifier delivery API + CDN TTL/invalidation knobs [dmc]; **DM-8** regex Batch Set Presets for 100k-image automation [dmc]; **DM-10** virtual zero-storage derivative bookkeeping [dmc]; **DM-12** server-side layered compositing templates ("dynamic PSD", RTF text engine, parameterized per-request rendering) [dmc]; **DM-16** bandwidth/storage-vs-contract reports [dmc].

### B.10 Misc (MI)

- **MI-2 Notifications** — header bell badged with incomplete-item count; click-through to the resource [learn][cs-auth]
- **MI-5 First-use tutorials** — modal slide tours per console + per editor, "don't show again" [cs-auth][learn]
- **MI-6 Keyboard shortcuts** — `/` search, `?` shortcut overlay, Ctrl-Shift-M preview toggle [cs-auth][DR-1]
- **MI-7 Touch-enabled UI** — full tap/tap-hold/swipe parity across authoring (owners live on phones) [cs-auth][learn]
- **MI-8 Social sharing metadata** — Page Properties Social Media tab feeding the Sharing component [learn]
- **MI-10 Authoring-side analytics** — List View columns: Page Analytics, Unique Visitors, Time on Page over 30/90/365 days, visible while managing pages [learn]
- **MI-11 Adobe Stock integration** — stock search/use from the asset workflow [cs-auth]

*Enterprise-only (excluded):* **MI-1** global-nav console shell (7 consoles, Tools panel) [cs-auth]; **MI-3** 8-field preferences dialog (annotation color, relative dates, window management) [cs-auth]; **MI-4** admin impersonation [cs-auth]; **MI-9** personalization/targeting (ContextHub brands, segments, Targeting mode) [learn][cs-auth]; **MI-12** read-only Components Console (dev catalog: policies, live usage) [cs-auth].

**Input conflicts noted:** the learn guide references six editor modes [learn §8] while the verified Cloud Service source lists exactly eight (adds Targeting, Live Copy Status) [DR-1] — treat DR-1 as authoritative. The learn page-diff video says red/green/blue; the reference doc's four-class scheme is authoritative [learn §6]. The Style System policy-dialog field layout was **refuted 1-2** — mechanism confirmed, dialog fields unverified [DR-8].

## C. Side-by-side: Adobe capability → Studio OS status (SMB-relevant only, 77 rows)

Status key: ✅ equivalent · ⚠️ partial · ❌ absent (inventory states absence, or excluded by our stated philosophy) · ❓ needs-code-check (inventory silent — do not assume absent). Evidence column uses only `design-studio-inventory.md` facts.

### C.1 Authoring canvas & editor modes

| Adobe | Ours | Evidence (inventory) |
|---|---|---|
| AC-1 three-part editor | ⚠️ | Canvas-dominant workspace: live iframe preview (#designPreview) + left tray + right Design settings — but editing is via slide-over panels, not on-canvas |
| AC-2 side-panel browsers | ⚠️ | Left "Page contents / Add section" tray (searchable); stock-photo picker tab; no unified asset-browser tab documented |
| AC-3 drag-drop placement | ⚠️ | Add via searchable tray; reorder via arrows AND drag; remove — structured list by index, never x/y freeform (stated moat) |
| AC-4 eight editor modes | ⚠️ | Device toggle (preview), Undo/Redo, timewarp at API (GET /publishes/timewarp), gated Developer-Mode CSS; no annotate/layout modes |
| AC-5 Page Information menu | ❓ | No consolidated page-action menu documented |
| AC-6 3 component-edit methods | ⚠️ | Per-block editors on a working copy with explicit "Save sections" — one method, panel-based |
| AC-7 annotations + sketches | ❓ | Not in inventory |
| AC-8 device emulator | ✅ | Device toggle Desktop/Tablet/Phone on the preview |
| AC-9 view as published | ⚠️ | Real /preview iframes exist (template gallery); dedicated chrome-free view-current-draft not documented |
| AC-10 in-context (double-click) editing | ❌ | Editing model is panel-based per-block editors; in-place canvas editing not part of the documented flow |
| AC-11 component ops (dup/hotkeys/x-tab paste) | ⚠️ | Add/remove/reorder + multi-instance stable ids (columns/cards/form); duplicate & hotkeys not documented |
| AC-13 accessible authoring | ⚠️ | site_components carry a11y metadata; AI alt/tags/caption suggest (propose-then-approve); contrast by construction in palettes |
| AC-14 policy-tiered RTE | ❓ | Rich-text capabilities per block field not documented |

### C.2 Sites console & page operations

| Adobe | Ours | Evidence |
|---|---|---|
| SC-1 console views + quick actions | ❓ | Pages bar exists; view modes/quick actions not documented |
| SC-2 selection + bulk actions | ❓ | Bulk ops documented for DAM only |
| SC-3 rails (tree/timeline/references) | ⚠️ | snapshot-history.html ≈ Timeline; usage/where-used exists for assets only; content-tree nav not documented |
| SC-5 create-page wizard | ⚠️ | Custom pages (multi-page authoring) + starter-layout seeding for new pages; no per-page template pick (template is site-wide) |
| SC-6 copy/paste page + name rules | ❓ | Page duplication not documented |
| SC-7 move page w/ reference adjust | ❓ | Page move/rename not documented (redirects manager exists as building block) |
| SC-8 delete + restore tree | ⚠️ | Site-level restore: POST /restore, checkpoints w/ restore; per-page delete/undelete not documented |
| SC-9 lock/unlock | ⚠️ | optimistic_lock concurrent-edit guard — automatic, not a visible named lock |
| SC-10 page properties (vanity/on-off/thumbnail) | ⚠️ | SEO sitemap/meta + redirects manager; scheduled publishes are site-level; per-page on/off times and thumbnails not documented |
| SC-12 OmniSearch | ❓ | Search index + /search/health are public-site search, not authoring search |
| SC-13 hierarchy/Title-vs-slug | ⚠️ | Multi-page authoring, per-page block lists, pages bar; slug management not documented |

### C.3 Templates & policies

| Adobe | Ours | Evidence |
|---|---|---|
| TP-1 editable templates w/ live link | ⚠️ | 8 versioned template families + content_contract_version manifest; template switch keeps content (template-agnostic entities — stronger than Adobe here); templates are code, not author-editable |
| TP-2 template editor (structure/initial/layout) | ❌ | Templates are registry LOADERS + versioned folders in code — no owner-facing template editor (philosophy: curated) |
| TP-4 content policies (allowed/default/responsive) | ⚠️ | Analogs: BLOCK_DEFS 37 types in 5 groups, site_components industries[] gating, columns cell validation (NOT_IN_CELL anti-recursion); no reusable named policy objects |
| TP-5 shared RTE/image policies | ❓ | media_guard exists (asset guardrail); per-component formatting policies not documented |
| TP-6 site templates + create-site wizard | ⚠️ | Template gallery w/ real /preview iframes + 13 starter layouts + industry defaults (atelier; food → restaurant-classic, 0110) |
| TP-9 template-author role | ❌ | No template-author tier; curated philosophy (Eric decides — see D) |

### C.4 Style system & responsive layout

| Adobe | Ours | Evidence |
|---|---|---|
| ST-1 style system (per-component named styles) | ⚠️ | STYLE_LOOKS coordinated global looks (:4509) + DS-1..DS-8 presets; per-block variants exist only as hero layout/header style, gated to business-classic family (:4643); radius token ignored by 4/8 templates |
| ST-2 layout container grid | ⚠️ | Columns container: 1–6 cells, per-cell 12-unit grid span, nested block per cell (validated); no per-breakpoint behavior |
| ST-3 layout mode (resize/hide/revert per breakpoint) | ❌ | Explicit philosophy: no per-breakpoint overrides, no per-element overrides, no free-form canvas |
| ST-4 breakpoints + emulator | ⚠️ | Device toggle previews viewports; breakpoints not author-configurable, no per-breakpoint editing |

### C.5 Fragments & reuse

| Adobe | Ours | Evidence |
|---|---|---|
| FR-1 content fragments (structured) | ⚠️ | Content library: save block as reusable — content+presentation blocks, not page-independent structured records |
| FR-2 CF variations | ❌ | Content library documented without variations |
| FR-3 CF referencing w/ propagating edits | ✅ | Insert as copy (clInsert) or LIVE LINK (clInsertLink — resolves at publish, edits propagate) |
| FR-7 experience fragments (content+layout reuse) | ✅ | Saved library blocks are exactly content+layout reuse; columns cells can nest a block |
| FR-8 XF variations (incl. live-copy) | ❌ | No variation mechanism on library blocks |
| FR-9 building blocks (convert selection) | ⚠️ | Save-block-as-reusable ≈ convert-to-building-block; no scoping/rename-in-place documented |
| FR-11 Generate Variations (GenAI) | ✅ | Writing desk: POST /writer/generate → presence_ai_drafts, options w/ confidence + missing_facts, accept/discard, grounded in business facts |

### C.6 Launches

| Adobe | Ours | Evidence |
|---|---|---|
| LA-1 create launch | ✅ | lib/launches.ts state machine draft→approved→scheduled→published→rolled_back\|canceled; create/recapture routes |
| LA-4 edit launch content in editor | ⚠️ | Launch flow documented as create/recapture snapshots + one publish pipeline; in-launch editing surface not documented |
| LA-5 inheritance padlocks / resync | ⚠️ | recapture ≈ whole-launch resync; no per-section inheritance control |
| LA-6 compare launch to source | ⚠️ | GET /publishes/compare exists (publish compare); launch-vs-live view not documented |
| LA-7 scope/config editing | ⚠️ | schedule + cancel routes; scope editing not documented |
| LA-9 timewarp future preview | ⚠️ | /timewarp exists (historical); future "as-of-date" preview not documented |
| LA-10 promote w/ partial scopes | ⚠️ | promote + decide (reviewer gate) + rollback; no modified-only/approved-only/single-page scopes |
| LA-11 auto promote + publish on date | ✅ | approved→scheduled→published via presence_scheduled_publishes cron |

### C.7 Workflows & approvals

| Adobe | Ours | Evidence |
|---|---|---|
| WF-1 inbox (badge, due filters) | ⚠️ | Approval Center page — approvals only; no unified assigned-items surface documented |
| WF-2 item actions (complete/delegate) | ⚠️ | decide route (approve/reject); no delegation |
| WF-5 publish approval routing | ✅ | Site-role approve capability; client_reviewer whitelist; public one-tap client approval via signed token (/approve); draft never auto-live |
| WF-6 annotation-driven review | ❓ | Annotations absent from inventory |

### C.8 Versioning & publishing

| Adobe | Ours | Evidence |
|---|---|---|
| VP-1 versions w/ labels + restore | ✅ | POST /publish, /restore; named versions (POST /publishes/:id/label); checkpoints (named working snapshots + restore) |
| VP-2 visual page diff | ⚠️ | GET /publishes/compare + snapshot-history.html; color-coded section-level visual diff not documented |
| VP-3 timewarp | ✅ | GET /publishes/timewarp + snapshot-history.html UI |
| VP-4 publish/unpublish | ⚠️ | POST /publish (one pipeline); unpublish not documented |
| VP-5 quick publish | ✅ | One publish pipeline, publish_guard; simpler than Adobe's shallow-vs-deep split by design |
| VP-6 scheduled (later) publication | ⚠️ | Scheduled publishes (cron) exist via launches; per-change "publish at" not documented as a general flow |
| VP-7 preview tier | ⚠️ | Real /preview iframes + strict draft/published separation; no shareable staging surface documented |

### C.9 Dynamic Media / media sets

| Adobe | Ours | Evidence |
|---|---|---|
| DM-2 multi-res master → renditions | ⚠️ | Responsive variants w400/w800/w1600 srcset (fixed ladder, not arbitrary-size master) |
| DM-3 controlled overwrite/replace | ✅ | Replace + rollback on versioned assets — explicit versioning beats silent overwrite |
| DM-6 named image presets | ⚠️ | Fixed 3-width srcset + social crops (GET /assets/:id/social) vs admin-editable named recipes |
| DM-7 media sets (image/swatch/spin/mixed) | ⚠️ | 6 media components in catalog (galleries); multi-view product sets / swatch pairing absent |
| DM-9 crop & trim | ⚠️ | Social crops + focal point (hero split only — inventory gap 3); full crop editor/trim not documented |
| DM-11 zoom viewers/targets | ❓ | Not documented |
| DM-13 video pipeline | ❓ | Video upload/transcode/player not in inventory |
| DM-14 video SEO feeds | ❓ | Sitemap exists for pages; video feeds not documented |
| DM-15 smart imaging (WebP auto) | ❓ | Format negotiation not documented |
| DM-17 trash + purge window | ⚠️ | Asset rollback (versioned) + replace; trash lifecycle not documented |

### C.10 Misc

| Adobe | Ours | Evidence |
|---|---|---|
| MI-2 notifications badge | ❓ | Not documented in this inventory |
| MI-5 first-use tutorials | ❓ | Not documented |
| MI-6 keyboard shortcuts | ❓ | Undo/Redo documented; hotkeys not |
| MI-7 touch UI | ❓ | Not documented |
| MI-8 social sharing metadata | ⚠️ | SEO meta + per-component JSON-LD; per-page share toggles not documented |
| MI-10 authoring-side analytics | ❓ | Not in this inventory |
| MI-11 stock integration | ✅ | Stock photos search/import + picker tab |

**Status totals (77 SMB-relevant rows): ✅ 12 · ⚠️ 40 · ❌ 6 · ❓ 19.**

Where we already exceed Adobe (recorded, no gap): template switch preserving all content (TP-1), live-link resolving at publish — no XF-style unpublish trap (FR-3), grounded AI writing with confidence + missing_facts (FR-11), deny-by-default token validation + contrast-by-construction palettes (inventory §3), one publish pipeline reused by launches (LA-11), AI Visual Studio brand-aware imagery with approval gate and cost ceiling (inventory §5), native forms/bookings/reviews (inventory §8).

## D. The gap list, prioritized (SMB-relevant only)

Ordering: (1) small-business owner value → (2) fit with our structured/curated philosophy → (3) effort (S/M/L). Every ⚠️/❌/❓ row in C maps into an item below (IDs in brackets; a few rows appear under two items). "PHILOSOPHY" = conflicts with stated philosophy (x/y freeform, per-element/per-breakpoint overrides, code-owned templates) — flagged for Eric, not silently dropped.

### Tier 1 — high owner value, S/M, philosophy-clean (→ Wave 1)

1. **G1 — Radius token everywhere** [ST-1 part]. Adobe: a policy/style change restyles every consumer [DR-7]. Us: `--radius` consumed by only 4/8 templates; aurora/slate/meadow/harbor hardcode corners → owner's Corners control silently no-ops (inventory gap 1). Build: consume `var(--radius)` in those four templates' render.ts; add a contract test asserting all 11 allowlisted tokens against all 8 families. **S**
2. **G2 — Un-gate hero layout + header style presets** [ST-1 part, AC-4 part]. Adobe: style variants available wherever the policy allows [DR-8]. Us: DS-6/DS-7 gated to business-classic family (:4643). Build: implement Classic/Photo-beside-text and Standard/Centered in the other 7 families; remove the gate. **M**
3. **G3 — Focal point beyond hero** [DM-9 part]. Adobe: per-image crop/rendition control [dmc]. Us: presence_media.focal_x/y → object-position on hero split only (inventory gap 3). Build: apply focal-point object-position in gallery/media components and the w400/800/1600 variants. **S**
4. **G4 — Per-block curated style variants (Style System, our way)** [ST-1, TP-4]. Adobe: named styles in the component policy → paintbrush menu, exclusive/combinable groups [DR-8]. Build: a `styles` map on site_components/BLOCK_DEFS entries (display name → curated class set emitted by templates), surfaced as a segmented "Style" control in each block editor; flows through the existing block save path — zero raw CSS, fully on-philosophy. The single highest-leverage Adobe idea for us. **M**
5. **G5 — Scheduled publish windows** [SC-10 part, VP-6]. Adobe: per-page on/off publish times; Manage Publication "Later" [learn]. Us: presence_scheduled_publishes cron already runs launches. Build: "publish at" (optional "unpublish at") on the ordinary publish flow reusing the same cron table + scheduled state. **S/M**
6. **G6 — Shareable view-as-published draft link** [AC-9, VP-7]. Adobe: View as Published + preview tier [learn][cs-auth]. Us: signed-token pattern exists (/approve one-tap). Build: signed read-only draft-preview URL rendered through the existing /preview machinery — lets an owner text the draft to their partner before approving. **S**
7. **G7 — Page operations suite** [SC-5, SC-6, SC-7, SC-8, SC-9, SC-13, MI-8]. Adobe: copy w/ slug regeneration, move w/ reference adjust, delete w/ warning + restore, Title-vs-slug, per-page share/thumbnail properties [learn]. Us: multi-page authoring + pages bar exist; duplicate/rename/slug/delete-restore undocumented (code-check first). Build: page duplicate (copy block list, regenerate stable ids), slug rename auto-writing to the existing redirects manager, delete w/ where-used check + restore via checkpoints, visible "someone else is editing" state on top of optimistic_lock, per-page social/share fields in SEO meta. **M**
8. **G8 — Where-used / references for library blocks** [SC-3 part, FR-9]. Adobe: References rail, live-usage counts [learn][cs-auth]. Us: usage/where-used exists for assets. Build: same where-used surface for content-library blocks (which pages live-link them), shown before editing/deleting a linked block. **S/M**
9. **G9 — Visual publish diff** [VP-2, LA-6]. Adobe: compare-to-current with component-level add/remove/change coloring; launch-vs-source diff [learn][cs-auth]. Us: GET /publishes/compare + snapshot-history.html. Build: side-by-side iframes with section-level add/remove/change coloring computed from block lists — we diff structured JSON, strictly more reliable than Adobe's client-side DOM diff with its documented corruption modes. Reuse for launch-vs-live. **M**
10. **G10 — Unpublish / take offline** [VP-4]. Adobe: unpublish from editor/wizard [learn]. Us: publish/restore exist; unpublish undocumented (code-check). Build: unpublish route in the one publish pipeline + "site offline" holding state. **S/M**

### Tier 2 — high value, M/L, philosophy-clean (→ Wave 2)

11. **G11 — Section annotations & review comments** [AC-7, WF-6, WF-1 part]. Adobe: Annotate mode, badge counts, review notifications [cs-auth]. Us: Approval Center + reviewer gates exist. Build: per-section comment threads on the draft keyed by stable block ids, surfaced in Approval Center and the reviewer's signed-token view; comment → request-changes loop on the launches decide route. Skip sketches initially. This is the #1 agency-client collaboration gap. **M**
12. **G12 — Content library variations** [FR-1, FR-2, FR-8]. Adobe: CF/XF named variations with Master [cs-auth]. Us: library has copy + live-link only. Build: variants array on library entries; clInsertLink pins entry+variant; propagation machinery unchanged. **M**
13. **G13 — In-place text editing on the canvas** [AC-1, AC-6, AC-10, AC-11]. Adobe UE: double-click text, Enter saves; duplicate + hotkey component ops [DR-12][DR-13]. Us: panel-only editing. Build: postMessage bridge from the #designPreview iframe — double-click a bound text field → edit inline → writes to the same working copy + "Save sections" path (structured fields only, never freeform). Add block duplicate + add/delete hotkeys in the tray. Highest UX payoff in the tier, real plumbing. **L**
14. **G14 — Launch upgrades** [LA-4, LA-5, LA-7, LA-10]. Adobe: editable launch branches, per-component inheritance padlocks, scope editing, partial promote [cs-auth]. Us: lib/launches.ts state machine. Build: (a) edit-within-launch by pointing the editor's working copy at the launch snapshot; (b) per-section keep-mine/take-live choice on recapture (padlock analog); (c) promote scope = changed-sections-only computed from the G9 structured diff. Skip nested launches — enterprise. **M/L**
15. **G15 — Timewarp-forward** [LA-9]. Adobe: Timewarp past a launch date previews the future; closest-launch-wins [cs-auth][learn]. Us: /timewarp is historical. Build: "as of date" resolver overlaying scheduled launches from presence_scheduled_publishes onto the timewarp render — "show me the site as it'll look July 1st." **M**
16. **G16 — Owner attention/notifications surface** [WF-1, WF-2, MI-2]. Adobe: Inbox with badge + due filters [cs-auth]. Build: attention feed from existing events (approvals pending, scheduled publishes upcoming, launch decisions, media health flags) with deep links; no delegation. **M**
17. **G17 — Named rendition presets + modern formats** [DM-2, DM-6, DM-15]. Adobe: preset recipes, edit-propagates, auto-WebP ≥30% savings [dmc]. Us: fixed w400/800/1600 srcset + social crops. Build: preset table (name/W/H/quality/format) at variant generation; WebP/AVIF negotiated at serve; regenerate-on-preset-edit job via the media_gc/media_guard patterns. Owners feel this as page speed. **M**
18. **G18 — Product media sets + zoom** [DM-7, DM-11]. Adobe: Image/Swatch Sets, deep-zoom viewers with hotspots [dmc]. Us: 6 media components. Build: product-gallery component upgrade — ordered multi-view with thumbnail strip; swatch pairing as a typed field; tap-to-zoom lightbox on gallery images (code-check DM-11 first). Defer spin sets — photography burden is un-SMB. **M**
19. **G19 — Model-backed design suggestion** [inventory gap 4]. Adobe's GenAI beachhead is Generate Variations [cs-auth]; ours for design is a deterministic industry_key rule map (SUGGEST :4523). Build: real model call proposing a coordinated STYLE_LOOKS+palette+type choice grounded in business facts, through the existing propose-then-approve + cost-ceiling patterns (AI Visual Studio precedent). **M**
20. **G20 — Video** [DM-13, DM-14]. Adobe: preset transcode, captions/chapters, video sitemaps [dmc]. Us: code-check whether any video path exists. Build if absent: upload → transcode (or embed-first v1) → poster via focal machinery → video block + captions; video entries in the sitemap. **L**
21. **G21 — RTE tiers + a11y affordances** [AC-13, AC-14, TP-5]. Adobe: per-policy plugin toggles; alt/decorative checkbox, table semantics [learn][cs-auth]. Build: per-field formatting allowlist (none/basic/rich) in site_components typed fields, enforced server-side like theme-token validation; "decorative image" toggle writing empty alt alongside the existing AI alt-suggest. **M**
22. **G22 — Authoring quick-find + shortcuts** [SC-1, SC-2, SC-3 part, SC-12, AC-2, MI-6]. Adobe: OmniSearch `/`, content-tree rail, card quick actions [learn]. Build: owner-side quick-find across pages/blocks/assets/settings (public /search pattern exists), a compact page/content tree in the left tray, `/` hotkey + `?` shortcuts overlay. Code-check what the pages bar already provides first. **M**
23. **G23 — Asset lifecycle polish** [DM-9 part, DM-17]. Adobe: non-destructive crop editor with reset; trash w/ 7-day purge [dmc]. Us: versioned assets w/ replace/rollback, health, duplicates. Build: simple crop/re-crop on top of the social-crop machinery; explicit trash state + purge window on delete. **M**

### Tier 3 — philosophy & follow-up decisions (→ Wave 3, Eric decides)

24. **G24 — PHILOSOPHY: per-breakpoint layout controls** [ST-3, ST-4, AC-4 part]. Adobe: Layout mode drag-resize, hide-per-device, revert-breakpoint, configurable breakpoints [DR-10][DR-11]. Directly conflicts with our stated "no per-breakpoint overrides." Middle path if approved: curated per-device toggles ("hide this section on phone", "stack columns earlier") as structured block fields — no freeform resize. **M as curated toggles; L as real layout mode**
25. **G25 — PHILOSOPHY: freeform canvas placement & resize** [AC-3, ST-2]. Adobe: drop at any grid position, blue-dot resize [DR-0][DR-10]. Conflicts with "structured list by index — NEVER x/y freeform (stated moat)." Recommendation: reject; the columns container (1–6 cells, 12-unit spans) is our answer. Recorded so it is declined deliberately, not forgotten. **—** → **OVERRULED (Eric, 2026-07-16): BUILD as a bounded section type** — spec in docs/design/freeform-canvas-design.md; backend slice 1 SHIPPED (validation, (y,x) reading-order storage, static render, ≤620px stacking flip, caps 12 elements/4 canvases, 3 aspect presets); editor slice pending.
26. **G26 — PHILOSOPHY: owner-editable templates / template-author tier** [TP-1, TP-2, TP-6 part, TP-9]. Adobe's core no-code power layer: structure lock/unlock, initial content editing, no developer needed [DR-3][DR-4]. Ours are code-owned versioned folders. Middle path: "save current page as a named starter layout" (seeding machinery exists) without opening template structure. **M middle path; L full parity**
27. **G27 — PHILOSOPHY: per-element style overrides** [ST-1 deep]. Adobe allows style choice per component instance everywhere [DR-8]; our G4 delivers the curated version. Anything beyond named curated variants (custom classes, raw CSS on the no-code path) conflicts with the deny-by-default token allowlist; gated Developer-Mode CSS already serves pros. Recommendation: reject beyond G4. **—** → **OVERRULED (Eric, 2026-07-16): BUILD with guardrails** — spec in docs/design/per-element-overrides-design.md; SHIPPED end-to-end (parseStyle 7-key allowlist + --ov-* vars in site_blocks.ts; "Style this section" popover with brand shades + Custom… hex, contrast warnings not blocks, Apply-Brand clears colors only).
28. **G28 — ❓ code-check batch** [AC-5, AC-7, AC-14, SC-1, SC-2, SC-6, SC-7, SC-12, TP-5, WF-6, DM-11, DM-13, DM-14, DM-15, MI-2, MI-5, MI-6, MI-7, MI-10]. The inventory covers the Design Studio surface; several ❓ items (notifications, analytics, shortcuts, onboarding tours, console views) may already exist elsewhere in Studio OS (e.g., the CMS-UX-* docs in docs/presence/ suggest content-tree/timeline/attention-center work). One Explore pass over the wider repo re-scopes Tiers 1–2 before committing. **S (research)**
29. **G29 — Express/Firefly follow-up research** [Section A hole]. Zero verified claims on Adobe Express brand kits, template galleries, quick actions, Firefly generate/fill, resize/reformat, scheduling/share — the Adobe product nearest our SMB user, and the likeliest source of missed Wave-1-grade ideas. Targeted deep-research pass (Express docs + helpx mirrors), then extend this atlas before finalizing Wave 2. **S (research)**

## D2. Express additions — G30–G35 (from the G29 research pass, 2026-07-15)

G29 is DONE (targeted WebSearch synthesis over helpx/adobe.com indexed content + third-party walkthroughs; all items below verified-multi-source unless noted; full report in the session record). New gaps:

30. **G30 — One-click "Apply brand" + on-brand recolor.** Express applies a brand to EXISTING content — all pages, colors, fonts (heading/body roles), and optional recolor of graphics to the brand palette — in one click from a Brands panel. We derive tokens at setup but have no "re-brandify this now" action and no brand-recolor of uploaded/stock/generated imagery. Build on the existing token machinery + a palette-remap pass for imagery. **S/M — Wave 1**
31. **G31 — One-design→many-formats reformatter.** Express Resize re-lays out a composed design to N platform preset sizes (multi-select) in one click. We have social *crops* only. Extend social-crop machinery to re-layout of promo/announcement compositions into platform presets. **S/M — Wave 1**
32. **G32 — Background removal quick action.** Express's most-used quick action (upload → one-click AI removal → download/continue). Slot into our media pipeline as an API-backed job beside variants/focal. **S/M — Wave 1**
33. **G33 — Generative fill (insert/remove object).** Brush-mask → prompt → N results → keep/discard, both directions. Natural extension of AI Visual Studio; pairs with the G23 crop editor. **M — Wave 2**
34. **G34 — Bulk create (CSV → design variants).** Column-per-field, row-per-variant, up to ~99 personalized outputs. Maps onto G12 library variations; philosophy-clean (typed fields). **M — Wave 2, with G12**
35. **G35 — Social scheduling surface.** Express Content Scheduler: calendar, multi-channel posts, AI captions, per-platform preview. New surface + platform APIs → **L — Wave 2/3**; minimum slice = "export + AI caption + copy-per-platform" from our social crops. (Scheduler analytics: single-source; plan limits: uncertain.)
Also folded: AI copy tone presets (Rephrase/Shorten/Lengthen + tones, 3 candidates) → strengthen existing writer actions, **S — Wave 1 polish**; style-reference-image-with-strength for image gen → attach to AI Visual Studio, **M — Wave 2**; Express "Generate template" + the Oct-2025 AI Assistant (conversational element-level editing) validate and raise G19's ceiling — generation must target structured, editable sections, propose-then-approve. NOT building: locked templates/brand controls (enterprise → G26), Firefly Custom Models/Style IDs (enterprise), text effects/animation presets, PDF suite (out of scope).

## D3. G28 resolution — the 19 ❓ rows, code-checked (2026-07-15)

G28 is DONE (full evidence table in the session record). Reclassification: **✅ 9 exist** (AC-5 page menu `presence.html:5105` · AC-14 field-tiered RTE `:1102-1177` · SC-12 authoring omnisearch `/` `:2387` · TP-5 shared media/RTE policies in code · DM-15 auto WebP+AVIF `<picture>` `lib/media.ts:150` · MI-2 bell badge `shell.js:143` · MI-5 first-run tour `shell.js:624` · MI-6 modest hotkeys · MI-10 owner analytics) · **⚠️ 6 partial** (SC-1 console views read-only · SC-2 bulk ops assets-only · SC-6 no page duplicate · SC-7 move without link rewrite · DM-14 VideoObject schema but no video sitemap · MI-7 pointer-capable but no touch layout) · **❌ 4 absent** (AC-7 annotations · WF-6 annotation review · DM-11 zoom viewers · DM-13 native video hosting).

Consequences: final Section C tallies become **✅ 21 · ⚠️ 46 · ❌ 10 · ❓ 0**. AC-7/WF-6 were philosophy-blocked — Eric's 2026-07-15 pivot unblocks them; they reinforce G11 (Wave 2). DM-11 folds into G18. SC-6/SC-7/SC-2/SC-1 partials fold into G7's page-operations scope (duplicate page, move-with-link-rewrite via the redirects manager, page multi-select). DM-13 native video stays a deliberate scope decision (embeds by design); DM-14 video sitemap is an S add-on to G7-adjacent SEO. MI-7 touch layout joins Wave 2.

## E. Recommended build waves (SMB-value balanced)

**STATUS 2026-07-15: WAVE 1 COMPLETE AND DEPLOYED** — G1-G10, G30-G32 + writer tones all live (see git log "Adobe parity Wave 1"). Wave 2 next: G11 annotations leads.

**STATUS 2026-07-16: WAVE 2 IN FLIGHT** — deploys #8–#11 shipped: **G11** section comments end-to-end (routes/comments.ts, reviewer feedback panel, Approval Center surfacing, migration 0112) · **G18** zoom lightbox + captions (zero-JS :target CSS, editor controls) · **G27** per-element overrides end-to-end (reversal — see above) · **G25** freeform canvas backend slice 1 (reversal — see above; editor slice pending). Also live from this batch: G5 publish-later UI, G6 share-draft, G7 page-ops menu, G9 block-level publish diff, G10 offline. In progress: builder redesign increment 6 (docs/design/builder-redesign-increment-6.md), then G13 in-place editing, freeform editor slice, G12+G34.

**Wave 1 — highest owner value, S/M, philosophy-clean (14 items):** G1 radius-everywhere · G2 un-gate hero/header presets · G3 focal-point-in-galleries · G4 per-block style variants · G5 scheduled publish windows · G6 shareable draft preview link · G7 page operations suite · G8 block where-used · G9 visual publish diff · G10 unpublish/offline · **G30 apply-brand one-click + recolor · G31 many-formats reformatter · G32 background removal · writer tone presets** (Express additions, per G29). Rationale: G1–G3 close the inventory's own known gaps (owner-visible controls that currently half-work); G4 imports Adobe's single best philosophy-compatible idea; G5–G10 finish publish/version UX where our pipeline is already 80% built; G30–G32 are Express's stickiest weekly-use wins on machinery we already have.

**Wave 2 — M/L, philosophy-clean (13 items):** G11 section annotations/review comments · G12 library variations · G13 in-place canvas editing · G14 launch upgrades (edit-in-launch, per-section resync, partial promote) · G15 timewarp-forward preview · G16 attention/notifications surface · G17 rendition presets + WebP/AVIF · G18 product media sets + zoom · G19 model-backed design suggestion · G20 video · G21 RTE tiers + a11y · G22 quick-find + shortcuts · G23 asset lifecycle polish. Gate G13/G14/G20 scope on G28 code-check results.

**Wave 3 — philosophy decisions + research (6 items):** G24 per-breakpoint curated toggles (decision) · G25 freeform canvas (recommend: reject, record) · G26 template-author tier (decision; middle path = save-as-starter-layout) · G27 per-element overrides (recommend: reject beyond G4) · G28 ❓ code-check batch · G29 Express/Firefly research pass.

Sequencing note: run G28 and G29 at the **start** of Wave 1, not after Wave 2 — both are S-sized research that de-risks everything downstream, and G29 may promote Express-style items (brand-kit quick actions, resize/reformat) into Wave 1.
