# Phase T2 — Authoring Capability & Template Ecosystem Audit

*Capability-parity audit (what people can **accomplish**, not feature counts) vs AEM, Webflow, Wix Studio, Squarespace, Shopify, WordPress/Gutenberg, Duda, HubSpot CMS, Contentful, Sanity, Framer, Editor X, HighLevel. Every claim verified in code. One Step-10 optimization implemented (the typical-hours one-click); everything else classified. Consolidates the Template/Component/No-Code/Freelancer/Customer/Developer reports.*

---

## Executive summary

The authoring question splits into three honest answers. **Content authoring: strong** — structured facts, AI starter-site drafting, items with show/hide/reorder, working forms/logo/share-image/announcement (Phase V), publish/preview/schedule/rollback that beat most builders. **Site-shaping: thin by design but thinner than it should be** — one template, one realized component of thirty, no customer design controls (all tracked: FD-T1, FD-T5/T12, FD-T6). **Reuse (the freelancer/agency multiplier): absent** — no site duplication, no setup templates, no shareable presets (FD-18/FD-B5, queued but now elevated). The strategic conclusion is unchanged and sharpened: **optimize and realize what exists (one neutral template + the catalog + Design Studio) rather than build more of anything**; the architecture already supports hundreds of templates as data. The single decisive pre-launch item remains **FD-T1**, gated on the owner's market-scope decision.

---

## Competitor Capability Matrix (authoring: what can be *accomplished*)

| Can a non-developer accomplish… | Builders (Webflow/Wix/Sqsp/Duda/Framer) | CMSes (AEM/Contentful/Sanity/HubSpot) | **Studio OS today** |
|---|---|---|---|
| Launch a correct site for *any* industry | ✅ (template galleries) | 🟡 (build-it-yourself) | **❌ restaurant only** (FD-T1) |
| Get a full site *drafted for them* from 2 questions | 🟡 (Wix ADI/AI partial) | ❌ | **✅ better** (Phase I starter-site, approval-first) |
| Keep facts/SEO/schema correct without thinking | ❌ (user's job) | 🟡 | **✅ better** (by construction) |
| Change colors/fonts/spacing | ✅ | 🟡 | ❌ (FD-T6) |
| Add/hide/reorder page sections | ✅ | ✅ | ❌ sections (✅ items) |
| Configure forms, hours, social, logo, notices | ✅ | 🟡 | **✅** (after Phase V) |
| Publish safely: preview, versions, rollback, schedule | 🟡 (varies, often weak) | ✅ AEM | **✅ better** (one pipeline, approval-first) |
| Reuse a site setup across clients | ✅ (Duda/HighLevel/Webflow) | ✅ | **❌** (FD-18/FD-B5) |
| Extend safely with code | 🟡 (Webflow embeds = foot-guns) | ✅ SDK-ish | **✅** (Developer Mode, fail-safe) |

**Reading:** parity-or-better on *operating* a site; behind on *shaping* and *reusing* — both already architected, not built.

---

## Template Audit / Industry Coverage / Optimization Report

- **Enough industries?** Vocabulary layer: yes (25+, correct schema each). **Rendered reality: no** — one template, restaurant-shaped. `templateSlugForIndustry` already routes non-food → `business-classic`, which **does not exist yet**. FD-T1 is the whole game.
- **Templates per industry?** V1 answer stands: **one strong realization per industry family + the neutral fallback**, with *looks* multiplied by theme variants (FD-T3), not code. Food shares restaurant-classic (coffee/bar/food-truck later inherit); home-trades share one; beauty/professional/retail each one. Don't hand-author 40.
- **Premium? Variation?** The one template is solid but single-look. Variation = themes (FD-T3) + section variants (FD-T5), not more templates.
- **Should templates include starter content/SEO/schema/Moments/CRM defaults?** **They already do, verified**: Phase I drafts identity/FAQs/offerings/a post; SEO+schema are emitted by construction; industry packs contribute Moments/coach rules automatically; CRM aggregates from day one. This is a genuine competitive strength — say it on the front door.
- **Should AI recommend templates?** Yes — trivially, via the existing intake industry → `templateSlugForIndustry`. Moot until >1 template; fold into FD-T1 wiring.

## Component Audit / Gap Report / Custom Recommendations

- Catalog: **30 blocks defined, 1 realized** (announcement, Phase V). The gap isn't catalog breadth — it's realization (FD-T5) + section visibility/order (FD-T12).
- **Missing vs competitors:** nothing material at catalog level (audit re-checked against the milestone's list — hero…before/after all present).
- **Innovate, don't imitate — recommended Studio-OS-native blocks (new, queued FD-T14):** *Trust & guarantees* (licenses/insured/guarantee — pairs with the certifications data), *Availability/emergency banner* (an announcement variant driven by hours/holiday state — "Open now / Emergency service"), *Business timeline* ("family-owned since 1998" — pairs with the story field), *Review highlights* (from connected GBP — FD-N9's display half). Each is structured, deterministic, and plays to the facts-first architecture competitors can't match.
- Classification: hero/services/hours/location/lead-form = **required**; proof blocks = **optional**; menu/service-areas/products = **industry-specific**; all = reusable + AI-flagged where safe; developer-extensible via the SDK. Already encoded in the catalog data.

## No-Code Capability Report

Post-Phase-V state against the milestone's checklist: hours/holidays ✅ (+ **typical-hours one-click implemented this phase**), social ✅, maps ✅, lead forms ✅ (fixed), FAQs/menus/pricing/testimonials ✅ (items), announcement ✅, logo/OG ✅, booking (link) ✅. Still code-or-nothing: section order/visibility (FD-T12), layout variants (FD-T5), crop/focal/overlays/backgrounds (FD-T11), button styles/spacing/palettes/typography (FD-T6), icons/animations (theme-level, FD-T3/T6), reviews display (FD-N9/T14). **None requires HTML/CSS/JS knowledge conceptually — all are structured controls waiting on their V1.1 build.** Coding is *not* actually necessary for any everyday task; it's only necessary today because the controls aren't built.

## Freelancer / Customer / Developer Workflow Reports

- **Freelancer:** fast first build (starter-site + Phase V controls) but **cannot reuse anything** — no duplicate-site, no setup templates, no cross-client presets (verified: no machinery). This is the biggest authoring-speed gap vs Duda/HighLevel and the agency-scaling limiter. **Elevate FD-18 (+FD-B5) to the top of V1.1.** Own template packs/components: SDK path exists (deploy-time) — right boundary, needs the packaging docs when marketplace opens.
- **Customer:** never *forced* into code for daily work (post-Phase-V); will *want* FD-T6 for looks. Protected by design — can't break layout/SEO/a11y. Right trade, once Design Studio lands.
- **Developer:** Developer Mode remains appropriately required for: custom CSS beyond curated tokens, custom HTML blocks, and (via SDK) new templates/components/schema. **Should disappear in favor of no-code for:** basic colors/fonts (FD-T6 — today the *only* route to a brand color is dev-gated tokens), which is a misplacement, not a law.

---

## Optimization classification (Step 9)

| Recommendation | Class |
|---|---|
| Starter content/SEO/schema/Moments in templates | **Already exists** (market it) |
| Device preview, item reorder, announcement, logo/OG | **Already exists** (Phases M/V) |
| Typical-hours one-click | **Optimized this phase** ✅ (implemented — presence.html, shows only when all days are closed) |
| Neutral `business-classic` template + industry default wiring + AI recommend | **New V1 capability** — FD-T1, gated on the market-scope decision (the one decisive item) |
| Section visibility/order · component realization · Design Studio · crop/focal · theme variants | **V1.1** (FD-T12/T5/T6/T11/T3 — the "shape" tier, in that order) |
| Freelancer reuse: client-setup templates + presets | **V1.1, elevated to top** (FD-18/FD-B5 — the agency multiplier) |
| Differentiator blocks (trust/availability/timeline/review-highlights) | **V1.1** (new FD-T14) |
| More templates per industry now · drag-drop · freeform styling | **Reject** (themes multiply looks; laws hold) |

## Roadmap impact

No new phases. FD-T1 stays the decisive gate on Phase T; FD-18/FD-B5 move to the head of the V1.1 lane (agency scaling); FD-T14 joins Phase T's component tier. The build-more-vs-optimize answer: **optimize/realize — build exactly one thing (FD-T1).**

## Testing

Implemented change (typical-hours button): presence.html parse-clean; hours flow reuses the existing `PUT /location` path (no backend change, no redeploy). Full pure sweep unchanged from Phase V (all green, invariants 14/14).

---

## Final Questions (answered honestly)

- **Can Studio OS compete with modern builders for everyday website creation?** For *operating* a site — yes, and often better (drafted-for-you start, correctness by construction, safest publishing). For *shaping* a site — not yet (design controls + sections are V1.1); for *any-industry* creation — not until FD-T1.
- **Can a customer realistically build & maintain without code?** Maintain: **yes, fully** (post-Phase-V). Build: yes *if* their industry fits the template — the FD-T1 caveat again.
- **Can a freelancer build faster than on competitors?** First site: arguably yes (starter draft). Fifth site: **no — zero reuse.** FD-18 is the fix.
- **Can an agency scale on the current ecosystem?** Operationally yes (portfolio/CRM/approvals); authoring-wise not until reuse + more-than-one-template.
- **Enough templates? Components?** Templates: **no — but the answer is one neutral template + themes, not many templates.** Components: catalog yes, realization no (1/30).
- **Build more or optimize?** **Optimize/realize existing.** The only *build* is FD-T1.
- **More structured controls instead of code?** Yes — the V1.1 tier above; nothing everyday should need code, and after FD-T6/T12 nothing will.
- **Where should Developer Mode remain / disappear?** Remain: custom CSS/HTML + SDK structure. Disappear: basic brand colors/fonts → FD-T6.
- **What must be completed before V1 launches?** Unchanged and now crisp: **the FD-T1 decision + build (if going broad)**, owner activation, browser QA, the push. Everything else in this audit is V1.1 by choice, not by neglect.

---

**Phase T2 — Authoring Capability & Template Ecosystem Optimization complete.**
