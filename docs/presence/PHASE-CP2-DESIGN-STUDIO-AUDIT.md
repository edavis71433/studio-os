# Phase CP-2 — Design Studio Completion: Audit & Recommendations (AWAITING APPROVAL)

*Audit-only; NOTHING implemented. Every claim verified against the code (token rules, both templates' CSS variables, the dev-layer injector, the settings pipeline — all mapped during Phases COMP/CP-1). Competitor judgments are workflow-level vs AEM, Webflow, Wix Studio, Squarespace, Framer, Duda, Elementor, Divi, Shopify. Consolidates the Design-Studio / Browser-Authoring / Competitor / No-Code / Developer-Boundary reports.*

## Verified current state (Step 1)

Browser-stylable today: **colors** (6 WCAG-validated palettes → accent/accent-dark/ink/soft tokens, shipped Phase COMP) · logo · share image · announcement · per-item visibility/order · template switch with preview (CP-1). Tokens that exist but have **no browser control**: `radius`, `font_scale`, `bg`, `accent_soft`. Everything else styling-shaped (fonts, spacing, sections, hero layout, backgrounds) = Developer Mode CSS or nothing. Templates consume: `--accent/--accent-dark/--ink/--soft/--line/--card/--paper|--cream/--wash` + hardcoded font stacks and spacing.

## THE RECOMMENDATIONS (Step 5 — each: evidence · competitors · benefits · effort · risk)

### 🔴 Required before launch

| # | Recommendation | Detail & evidence | Effort | Risk |
|---|---|---|---|---|
| **DS-1** | **Type presets** — 5–6 curated pairings (e.g. Classic Serif, Modern Sans, Editorial, Friendly Rounded — *system-font stacks, zero font files*) + a size dial (cozy/standard/large via the existing `font_scale` token) | The #1 remaining dev-only everyday task (every styling audit). All 9 competitors offer fonts; ours ships *curated + readable-by-construction*. New tokens `font_display`/`font_body` (stack strings, validated allow-list) + templates adopt `var(--font-display, <current>)` | **M** | Low — palette pattern proven; golden regen |
| **DS-2** | **Section visibility & order** — per-page section list (About / Offerings / Testimonials / FAQ on home), toggle + reorder, structured (`settings.sections`) | CP-2 of the approved plan; items have controls, sections don't; every competitor has this | **M** | Low — `category_order` pattern; deterministic |
| **DS-3** | **Complete the Design card with the orphan tokens**: corner style (sharp/soft/rounded → `radius`), background tone (bright/warm — `bg` token, adopted by templates as `var(--bg, <paper>)`) | Tokens already exist with no UI — pure waste; trivial to expose | **S** | Trivial |
| **DS-4** | **Density preset** — comfortable/compact/airy (one `spacing_scale` token; templates multiply block/section padding) | Squarespace's spacing sliders, made calm (3 curated stops, not a slider) | **S–M** | Low |
| **DS-5** | **Image focal point** (approved CP-13) — per-image field → `object-position` in both templates | Faces/subjects framed right; verified absent | **S–M** | Low |

### 🟠 Strongly recommended

| # | Recommendation | Why this tier |
|---|---|---|
| **DS-6** | **Hero layout presets** — centered / text-left-image-right / banner (per-template branch on a `settings.hero_layout` key) | Real variety win; slightly deeper template surgery — right after DS-1/2 land |
| **DS-7** | **Header style** — nav alignment + sticky toggle | Small but visible; pairs with DS-6 |
| **DS-8** | **AI design suggestion** — "match my business": suggests palette + type preset from industry & logo (FD-T9 folded in; suggestion-only, owner approves) | Differentiator; needs DS-1 first |

### 🟡 Nice to have: button outline-vs-solid variant · footer content toggles · per-palette dark-paper variant.
### ⚪ Future (with stated reason): gallery/team/pricing *layout* variants (blocked on CP-15 block realization) · shadow/border knobs (taste hazards; palettes+radius cover the need) · responsive per-breakpoint overrides (that's CSS with more steps — Developer Mode's job).
### ❌ Reject (with reasoning): animation controls (calm law; templates already respect reduced-motion) · arbitrary spacing sliders (foot-gun; density preset covers) · per-element style overrides (page-builder by the back door) · icon packs (template-owned, consistency) · map embeds (privacy law — links stay links).

## Competitor verdict (Step 2)
Elementor/Divi expose ~every CSS property — power that produces broken sites and consent-banner-laden pages; Wix/Squarespace curate more but still let users pick unreadable pairs. **Studio OS's lane, proven by palettes: curated choices that cannot produce a bad site.** With DS-1..5, a customer controls color, type, corners, background, density, sections, hero framing, and image focus — the complete everyday design vocabulary — with contrast and readability *guaranteed by test math*, something none of the nine can claim.

## Developer Mode boundary after DS-1..8
Remaining dev-only: arbitrary CSS, custom HTML blocks, raw token values, anything per-element. **That is exactly the right boundary** — true customization, never everyday authoring.

## Final CTO review (honest)
- **Exceptional website without HTML/CSS?** Today: excellent-and-correct with limited *shaping*; after DS-1..5: **yes without qualification** for the everyday business.
- **Freelancer fully in-browser? Agency style dozens rapidly?** Yes — kits (CP-1) carry palettes today and will carry type/density/sections after this phase: **one kit = a complete house style**.
- **Developer Mode reserved for advanced only?** Post-DS: fully.
- **CTO's ONE improvement with no deadline: the Playwright browser-E2E suite.** Every phase this session widened the UI surface (palettes, kits, look-switcher, design controls to come) — all logic-tested, none browser-verified repeatably. One suite converts Phase K from the *only* line of defense into a confirmation, and protects every future change forever. It's the highest-leverage engineering left in the project, and I'd build it immediately after the DS items — before Launches, before GM QA.

**Phase CP-2 — Design Studio Completion & Browser-First Authoring Excellence audit complete.**

**AWAITING IMPLEMENTATION APPROVAL** — reply "approve DS-1..5" (required tier), "approve DS-1..8", a custom list, or edits. Estimated build: required tier ≈ 1–2 focused days; +strongly-recommended ≈ 1 more.
