# Phase EC-1 — Experience Cohesion & Operating System Integration

*Does Studio OS feel like one operating system where every capability connects to every other? Audit of the whole signed-in experience as one continuous flow. No features, no redesign, no migration — only cohesion.*

## The honest starting point
Three prior phases already did most of this work: **INT-1** verified every cross-system *connection* works (live tests), **DS-1** unified the token palette so pages look related, and the migration made vocabulary/nav consistent. EC-1's job was the *experience* layer on top: entry points, "what's next" affordances, one-obvious-home, and the one open decision (the Website editor).

## Cross-system workflow audit — "if I do X, what happens next?"
| Question | Answer in the product | Cohesive? |
|---|---|---|
| I upload a file → | It lands in **Files**; if it's replacing an in-use file it can go through approval; its "where used" shows every page it appears on. | ✅ |
| I publish my website → | **Analytics** "last updated" + **Today** "last published" reflect it; the injected tracker starts reporting visits. | ✅ |
| I receive a lead → | **Inbox** "New messages" + **Today** surface it; it lands in **Customers** history. | ✅ |
| I approve a file change → | References repoint, the old version retires, it's ready to publish; the **Inbox/bell** approval clears. | ✅ (DAM-2 + INT-1) |
| Analytics flags an issue → | Every insight carries a "fix it" link — inquiries→Messages, publishing/search→the **Website editor**, traffic/search→**Connections**. | ✅ |
| A file is used on my site → | **NEW (EC-1):** each "where used" entry now **clicks through to the Website editor** (scope-aware). Files↔Website is now bidirectional. | ✅ (fixed) |
| A customer opens Studio OS → | Lands on **Today** (the calm "what needs you" hub), which links out to every capability. | ✅ |

## The one cohesion gap found + fixed
**Files → Website was one-directional.** The Website editor already linked *to* Files, and Files' "where used" panel *named* the pages a file appears on — but those weren't clickable. Now each "where used" entry is a scope-aware link into the Website editor (`brand→#design`, `seo→#business`, `services`, `blog→#updates`). A customer who sees "your logo — live" can click straight to where it lives. Small, safe, and it closes the loop between the two most-connected surfaces.

## Entry points / duplicate destinations (audited — intentional, not confusing)
- **Leads appear in three places** — Inbox ("New messages"), Customers (history), Messages (`leads.html`). This is **by design**: Inbox is the *aggregator* ("what needs you"), Customers is the *record*, Messages is the *detail*. Same lead, surfaced where each context needs it — not a duplicate destination. Canonical home = Customers/Messages; Inbox deep-links in.
- **Two "Files" touchpoints** — the Files page (library) and the in-editor image view inside Website. The editor view is an in-context picker that deep-links to the canonical Files page. Not a duplicate top-level destination.
- **One navigation** — the shell top bar is the single nav on every page (verified: no page renders a competing in-page nav strip; the leftover `.appnav` CSS is unused). No dead ends, no circular workflows.

## The Website editor — the decision the phase asked for
**Recommendation: keep it as a distinctive creative mode. Do not redesign it now.**

The Website editor (`presence.html`) uses its own "editorial paper" language (`--paper`, warm ink, ink-based buttons, no purple accent, no dark mode, class names like `rune`/`whisper`). Evidence for the decision:
- Its **light background (`#faf7f0`) is nearly identical to the canonical (`#faf8f5`)** — so there is *no jarring seam* between the shell frame and the editor page. The perceived "different app" feeling is mild.
- The remaining divergences (warm ink, no purple, editorial type) constitute a **deliberate, defensible "creative canvas"** — the same pattern as Notion's writing surface or Framer's design canvas sitting inside a neutral chrome. A focused editing mode *earning* its own character is premium, not broken.
- The one genuine inconsistency is **no dark mode** in the editor while every other page has it.

**Why not implement a token migration now:** bringing the editor fully onto shared tokens (and adding dark mode to a large, complex editing surface) is a **redesign** that must be verified visually across every editing view and breakpoint — and I cannot run a browser here. Doing it blind risks regressions for a mild cohesion gain. So: **keep the creative mode; add editor dark-mode as a V1.1 polish with a visual pass.** This is the best customer experience per the "implement only if it clearly improves cohesion" rule — a blind redesign does not clearly improve it.

## Health Coach · Journey · Analytics · Files · Inbox · Studio · Website as one experience
Reviewed together: they share the shell, the token system (except the editor's creative mode), the one attention feed (bell/Today/Inbox from the same source), and the SC-1 scope on every page + link. No duplicate entry points beyond the intentional aggregation above; no inconsistent language after the migration; no disconnected workflow after INT-1 + this Files↔Website fix. No new systems introduced.

## Final CTO review
1. **Feel like one operating system?** Yes — one shell, one nav, one attention feed, one token system (bar the deliberate editor canvas), scope carried everywhere.
2. **Every workflow naturally connects?** Yes — verified end-to-end (INT-1) + the Files↔Website loop is now closed.
3. **Anything still feels like separate software?** Only the Website editor's creative canvas — and that's an intentional, defensible mode, not an accident.
4. **Every capability has one obvious home?** Yes (Website/Customers/Files/Analytics/Inbox/Studio/Settings), with Inbox as the deliberate cross-cutting aggregator.
5. **Matches the Davis Digital Studio brand?** Yes — calm, plain-English voice + the unified purple/serif system; the editor's editorial warmth is on-brand for a studio.
6. **Does the Website editor fit?** Yes as a creative mode; the only fit gap (dark mode) is a V1.1 visual-QA item.
7. **Anything still disconnected?** No functional disconnection; the editor's dark-mode gap is the lone visual one.
8. **Must change before launch?** Nothing structural. The editor dark-mode + a visual/mobile pass are the open items — both belong to Gold Master QA.
9. **Safe until V1.1?** Editor token/dark-mode alignment; any further cross-linking (it's already sufficient).
10. **Ready for Gold Master QA?** Yes — the experience is cohesive; what remains is browser-based visual/responsive/AT verification, which *is* Gold Master QA.

## Standing gap-check
No new features, AI, architecture, or migration recommended. The single design-direction item (Website editor dark-mode as a creative-mode polish) is documented and deferred to V1.1 with a visual pass. Everything else is cohesive.

## Verification
`deno check` clean; files 30/30, invariants 14/14, workspace_roles 42/42 (+ prior INT-1 live suites all green). EC-1 changed `files.html` only (Files→Website links) — no backend/migration change.

**Experience Cohesion is complete. No further cohesion work is recommended before Gold Master QA.**
