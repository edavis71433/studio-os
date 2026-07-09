# Studio OS — Design System (v1.0 reference + DS-1 report)

*The single visual language for the signed-in experience. Source of truth = `shell.css` (the frame on every page). This is a consistency/polish reference, not a redesign.*

## Canonical tokens (from `shell.css` — every page must match these values)
| Token | Light | Dark |
|---|---|---|
| bg | `#faf8f5` | `#171320` |
| card | `#fff` | `#1f1a2b` |
| ink | `#1b1525` | `#efeaf7` |
| soft | `#6b6478` | `#a79ebc` |
| faint | `#938ba3` | `#7a7192` |
| line | `#eee9e0` | `#2a2338` |
| accent (purple) | `#5b3fa0` | `#b79ceb` |
| accent-soft | `#efeafa` | `#241d38` |
| good / good-soft | `#3f7a5a` / `#e7f1ea` | `#8bbf9f` / `#1f2a24` |
| warn / warn-soft | `#8a6d3b` / `#f3ead9` | `#d3ac6e` / `#2a2316` |
| serif (headings) | Iowan Old Style / Palatino / Georgia | — |
| sans (body) | -apple-system / Segoe UI / Roboto | — |
| shadow tint | `rgba(27,21,37,…)` | `rgba(0,0,0,…)` |

Every page defines these under its own names (`--p`/`--accent`) — the **values** are what must match. Content width is **680px** (wider only where a grid needs it, e.g. Files at 1080px). Headings use the serif; body/UI uses the sans. Radius, spacing, and component patterns (`.card`, `.btn`, pill buttons, toasts, `.spin` loader) are shared across the token pages.

## DS-1 — what changed (consistency only)
**Converged the three divergent pages (`today`, `connections`, `visual-studio`) to the canonical palette.** They used a warmer set (`#f6f4ef` bg, `#221f1a` ink, warm shadow tint) that mismatched the cool shell frame on every page. Now their `:root` values (light + dark + `[data-theme]`) and shadow tint exactly match `shell.css`, so the page and the shell frame are one continuous surface. Grep-verified: zero warm hexes remain; accent + dark-mode structure preserved. **No layout, component, or functional change** — values only.

Result: **every signed-in page except the Website editor now shares one identical token system** matching the shell.

## ⚠ Documented divergences (NOT fixed — here's why)
1. **The Website editor (`presence.html`) uses a bespoke "editorial paper" design language** — its own tokens (`--paper #faf7f0`, `--ink #211d19`, `--hair`, class names `rune`/`whisper`/`wordmark`), no purple accent, and **no dark mode**. This is the single biggest visual divergence in the product. It reads as deliberate craft, not accidental debt — but it does make the most-used editing surface feel like a different app. **Reconciling it is a redesign** (explicitly out of DS-1 scope) that needs a design-direction decision + visual QA, not a mechanical token swap. **Deferred to a design-direction call**, flagged as the #1 remaining consistency question.
2. **Focus style:** the token pages use `:focus`; the (now-aligned) `today/connections/visual-studio` use `:focus-visible`. Both are keyboard-accessible; the difference is only that `:focus` also shows a ring on mouse click. Cosmetic; standardizing on `:focus-visible` everywhere is a low-risk polish best done with a visual pass.
3. **Container width:** most pages are 680px; `crm` 760px and `connections` 700px are slightly wider. Barely perceptible and possibly content-tuned — not force-changed without a visual check.
4. **Dark-mode parity:** every token page supports dark mode; `presence.html` (light-only) is the exception, tied to divergence #1.

## What requires a human pass (I cannot run a browser here)
Visual regression, responsive/mobile layout (phones/tablets), and screen-reader/keyboard walkthroughs are inherently visual/interactive and can't be executed from code. The structural design system (tokens, dark mode, reduced-motion, focus rings, component classes) is now consistent and auditable; the *rendered* result across breakpoints is a **Gold Master QA** step.

## Final CTO review — honest
1. **Feels like one premium application?** Much closer — after the token unification, every page except the Website editor is one continuous surface with the shell.
2. **Every page visually related?** Yes, with the one flagged exception (the editor's editorial language).
3. **Components inconsistent?** The token pages share `.card/.btn/.spin/toast` patterns; the editor has its own. No *duplicate/competing* components within the standard set.
4. **Any page noticeably lower quality?** No page is low-quality; the editor is *different*, not worse (arguably the most crafted).
5. **Any layout crowded?** Not structurally; the calm 680px column + generous spacing holds. (Crowding is a per-breakpoint visual check.)
6. **Anything still looks like a prototype?** No — the token pages are cohesive; the editor is a deliberate distinct aesthetic.
7. **Ship vs Linear/Notion/Framer/Shopify/HubSpot for SMB?** For the calm, plain-English SMB audience — yes for the token surfaces; the editor's paper aesthetic is a differentiator, not a liability, provided the design-direction call blesses it.
8. **Remaining design debt?** One meaningful item: the editor's divergence (design-direction decision) + the minor focus/width nits.
9. **Wait until V1.1?** The `:focus-visible` standardization, container-width normalization, and (if the direction call goes that way) bringing the editor onto the shared tokens + dark mode.
10. **Ready for Gold Master QA?** Yes — the structural design system is consistent; what remains is visual/responsive/AT verification, which *is* Gold Master QA.

## Standing gap-check
Recommend before launch: **one design-direction decision** — keep the Website editor's editorial language as an intentional signature, or bring it onto the shared token system (a scoped redesign, not DS-1). Everything else is polish that a visual QA pass will surface. No features, no AI, no architecture changes recommended.

**Design System & Premium Experience is complete. No further design-system work is recommended before launch** — beyond the one flagged design-direction decision on the Website editor and the visual/responsive verification that belongs to Gold Master QA.
