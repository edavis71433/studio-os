# Phase CP-2.5 — Workspace Information Architecture & Design Studio Experience

*No new capabilities — existing ones made findable. Frontend-only (no backend change, no deploy needed); reuses the local-nav view pattern and the one preview pipeline. Consolidates the Workspace-Architecture / Navigation / Design-Studio / IA / Browser-Experience reports.*

## Step 1 evidence (measured)
Pre-phase: `view-business` hosted **~35 field blocks** — facts, story, service area, industry, SEO, verification, booking, address, hours, announcement, the full Design Studio (7 pill rows + suggestion), and home-sections. The newest flagship capability sat at the bottom of the workspace's longest scroll; the template switcher lived in a different surface entirely (the preview stage). "Where do I change my colors?" had no obvious answer.

## Implemented

**1 · The Design workspace** — a new local-nav tab (the page's own `data-view` pattern; zero new systems) housing:
- the **Design Studio card** (colors/type/size/corners/background/spacing/layouts/suggestion),
- the **home-sections card**,
- a **"Your site's look" card** — names the current template and opens the proof's Look switcher (the previously buried template feature gets a front door),
- **the Live Style Preview**: a scaled iframe of the *draft home page* through the existing `/preview` pipeline (no second renderer — tokens/settings already land in the draft serialization, so the proof is pixel-true). It refreshes (debounced) after **every** design choice — palette, type, size, corners, background, spacing, layout, header, sections — and warms when the tab opens. Choose → see, in one glance; publish-first untouched.

**2 · Business page grouped** (Step 4, naturally-belongs): three quiet headings — *The basics · Search & discovery · Links & booking* — so the remaining long page scans in chunks instead of a wall.

## IA review verdict (Step 2)
Evaluated the candidate groupings honestly: **Design** materially improves usability (implemented). *Search* as its own tab → rejected (three fields; splitting them from Business identity would add navigation, not clarity). *Foundations/CRM/Commerce/Today* → already exist as surfaces via the shell. *Messages* → stays rejected (Phase CP). Nothing else moved — reorganization for its own sake refused.

## Competitor read (Step 5)
Webflow/Framer put design in a parallel *designer* app (powerful, intimidating); Wix/Squarespace bury style controls 3–4 levels deep in settings trees; AEM splits authoring/theming across roles and tools. **Studio OS now has the simplest honest answer in the set: one tab named Design, with your real homepage updating beside the choices.** Discoverability parity achieved without a builder.

## Final CTO review
- **One cohesive OS?** Yes — every everyday question now has a one-word answer: colors/type/layout/templates → **Design**; SEO/business info → **Business** (grouped); content → its named tabs; operations → Today/shell.
- **Reorganize anything else before GM?** No — measured restraint: the remaining Business page length is facts a business genuinely has; splitting further adds clicks.
- **The ONE naturally-revealed improvement (with evidence):** the shell's ⌘K command palette searches the *server* nav (`buildNav`) — it cannot find "Design," "Photographs," or any workspace-local tab (verified: palette entries come from `/portal/context.nav`; local `data-view` tabs aren't in it). Recommendation: **hash deep-links** (`presence.html#design` → `go('design')` on load) **+ child entries under the Website section in `buildNav`** so search/palette/nav can route straight to workspace tabs. Small (S), server+client, materially improves the shell's promise that everything is findable from anywhere. Awaiting approval — not built (it touches the one-nav source of truth, which deserves its own deliberate change).

**Phase CP-2.5 — Workspace Information Architecture & Design Studio Experience complete.**
