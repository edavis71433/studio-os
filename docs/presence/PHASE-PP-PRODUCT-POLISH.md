# Phase PP — Product Polish & Launch Refinements

*The consolidation phase: complete every approved recommendation that emerged across the audits, reusing existing architecture, merging where things belong together. No new systems. This closed a real bug, shipped the annual-renewal heads-up, merged three queued agency recommendations into one surface, mirrored the "needs you" pattern into the client portal, made the standalone editions speak their own language, and ran a terminology-consistency sweep.*

## Section 1 — Trust fixes

**PP-1 · The lead-followup notice now represents reality.** Verified bug (I shipped it in Phase CRM): a `lead_followup` notice never cleared when the owner acted on the lead, so Today's card, the bell, and the attention badge kept saying "a lead is waiting" after a reply. Fixed: `handleFormStatus` now dismisses the exact notice (`kind=lead_followup`, `period=lead:<id>`) when a lead is marked **read** or **archived** — and because replying auto-marks a lead read, the nudge clears the moment you act. All three surfaces read active notices, so they drop it at once. Pure helpers (`leadFollowupResolvesOn`, `leadFollowupNoticeKey`) prove: read/archive resolve it, `new` doesn't, and the lead-id-keyed period guarantees no other lead's (or kind's) notice is touched. Tested.

**PP-2 · The annual renewal heads-up (CP-3.1).** For annual terms not already set to cancel, a calm note goes out ~30 days and again ~7 days before renewal — the plan, the exact date, what the site published this year, and a link to manage the plan. Informational, never sales ("it renews automatically… you can review or change any time"). Rides the notices rail + the 15-minute sweep; send-once via `period = renewal-date:window` (one 30-day and one 7-day note per cycle). Migration 0062 adds the `renewal_reminder` kind. Pure window/copy logic tested (boundaries, cancel-excluded, monthly-excluded, no-upsell copy, UTC-stable date).

## Section 2 — Standalone product polish

**PP-5 · The CRM's Today empty-state speaks its own language.** today.html's "All clear" card no longer points a website-less Business-OS account at "Open your website / See your leads"; for editions without `website` it reads "Everything's quiet across your business" and links to the relationship view and connections.

**PP-6 · The Studio OS upgrade moment.** On first landing after an edition grows, a one-time "Welcome to {edition}" card names exactly what became available (computed from the real feature-list delta — orient, don't market), then marks itself done on dismiss. Fully client-side off `edition_features`; the first sight of any edition orients silently, so a brand-new account never sees a false "upgrade."

*(PP-3/PP-4 CMS/CRM onboarding: the runtime leaks were closed in Phase SKU and the empty states are handled here; the remaining first-run **copy** layer per edition is queued as FD-SKU2 — it's wording, not capability.)*

## Section 3 — One Agency Portfolio Status surface (merged FD-CRM2 + FD-INF4 + FD-FLOW2)
Rather than three separate builds, one at-a-glance status per client row, all from rows the fixed-cost portfolio gather already batches (no new pipeline, still O(1) queries for any client count). Each row now carries: **attention** (active notices + waiting approvals + waiting leads, the one number to scan), **leads waiting**, **domain expiration + registrar** (from the INF domain watch, shown when ≤30 days), **search issues** (from stored evidence), and **billing issues** (entitlement paused/lapsed or a payment-trouble notice). agency.html renders a calm status line under each client and the attention count as the badge. Tested against the synthetic portfolio (leads counted, attention composed, domain surfaced, billing from both signals).

## Section 4 — Client portal mirrors "needs you"
client.html already led with pending approvals; it now mirrors the owner's Today framing — an attention-aware subheading ("One thing needs your OK" / "You're all caught up — nothing needs you right now") over the same role-filtered `/portal/feed`. No second notification system.

## Section 8 — Terminology consistency (the requested sweep)
Audited user-facing labels for the same concept named differently. **Findings:** the product is already largely consistent — *Visual Studio* (never "AI Visual Studio" in UI), *Relationship* (never "CRM" to customers), *Connections*, *Foundations*, *Business Moments*, *Kind words*, *Questions* each have a single name; the "Design Studio / Connected Platform / Client Relationship Center" variants are **code comments**, not user-facing. **Fixed the real ones:**
- **Photos vs Photographs** — the shared shell nav said "Photos" while the workspace said "Photographs" for the same section. Aligned the workspace (tab, heading, sheet) to **Photos**.
- **Menu vs Services in the sections sheet** — the sheet hard-coded "Menu" and wasn't reached by `applyVocab`, so a non-restaurant owner saw "Services" in the main tab but "Menu" in the sheet. The sheet is now vocab-synced (one `querySelectorAll`), so the offering label matches everywhere.
- **Workspace prose** — standardized a stray "your full workspace" to "your workspace" (the dominant term).

**Flagged, not changed (it's IA, not terminology):** the nav points four labels — *Your Presence*, *Your website*, *Creative Studio*, *Growth* — at the same `/presence.html`. Consolidating those is a navigation-structure decision, recommended below rather than renamed blindly.

## Section 9 — Remaining pre-launch items
- **Domain/registrar portfolio row** — delivered inside Section 3 (not a separate build).
- **NAP drift-watch (CP-7)** and **Search Console (SD-5)** — still correctly sequenced **after** Playwright: both extend the connected read-scope/OAuth surface, and opening that surface right before the E2E phase would be the wrong order. Evidence: CP-7 needs the GBP adapter to carry name/phone (verified absent in Phase INF); SD-5 is a new OAuth provider. No engineering reason to pull them in now.

## Testing
`commercial` 57/57 · `agency` 28/28 (＋ orchestration 24/24) · `crm` 24/24 · `lifecycle` 22/22 · `editions` 36/36 · `nav_integrity` 3/3 · `shell` 18/18 · `workspace_roles` 38/38 · `platform_invariants` 14/14 · `render` 28/28 · `business_classic` 42/42 · `moments` 23/23. All changed backend files typecheck; all edited HTML inline scripts parse-verified. Migration 0062 applied staging + prod; function deployed both envs; forms/agency/context routes verified serving cleanly on the new prod deploy. Frontend (today/presence/client/agency html) follows the UI-staging pattern (committed, unpushed under the public-site fence).

## Final questions (answered honestly)
- **Would you launch the CMS?** Yes — complete website platform, no cross-product leaks, its Today/empty-states speak website language.
- **Would you launch the CRM?** Yes — coherent relationship product; its empty state now speaks relationship language.
- **Would you launch Studio OS?** Yes — the honest superset, and the upgrade into it now announces itself.
- **Does the product feel intentionally complete?** Yes — the seams the phase targeted (stale notices, empty-state mismatch, split agency signals, portal asymmetry, terminology drift) are closed.
- **Does every notification reflect reality?** Now yes — PP-1 was the one place it didn't, and it's fixed.
- **Does every edition feel complete?** Yes at capability + runtime; the only remainder is per-edition first-run **copy** (FD-SKU2), not capability.
- **Does every workflow feel cohesive / onboarding match the product?** Yes for the surfaces in scope.
- **Would you put paying customers on this tomorrow?** Engineering-wise yes; the gates that remain are non-engineering — Playwright E2E, owner activation (keys/monitoring), and the launch push behind the pre-launch reminder list.
- **Any remaining engineering work before Playwright?** None required. The only open items are deliberately post-Playwright (NAP, Search Console) or copy-layer (FD-SKU2) — nothing blocking, nothing structural.

## Recommendations (not built — awaiting approval)
1. **Consolidate the workspace's nav labels** — *Your Presence / Your website / Creative Studio / Growth* all land on `/presence.html`; pick the canonical entry (and give "Growth" its own `#` deep-link to the Growth Coach, like `#foundations`) so no two labels promise different destinations to the same page.
2. **FD-SKU2 per-edition first-run copy** — the onboarding wording layer, now that runtime + empty states are edition-correct.

**Phase PP — Product Polish & Launch Refinements complete.**
