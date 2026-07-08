# Phase T — Template Ecosystem, Structured Site Builder & Industry Realization

*Designs the complete template ecosystem and builds the reusable primitives that make it scale to hundreds of templates without architectural change — while fixing the deepest gap (every site publishing as a restaurant). Consolidates the Template Ecosystem / Industry Strategy / Template Architecture / Component Library / Theme System / AI Integration / Developer SDK / Template Lifecycle / Upgrade Strategy / Future Scalability guides.*

---

## Executive summary

The architecture thesis: **a template is DATA, not code — `(one render engine) × (industry vocabulary) × (theme) × (component selection)`.** New templates and industries become data configs, so the platform scales to hundreds without touching the render pipeline, version history, or approval flow. This milestone **built and tested the two load-bearing primitives** — `lib/industry_vocab.ts` (the correct schema.org type + vocabulary per industry — the fix for "`@type: Restaurant` on a plumber") and `lib/site_components.ts` (a ~30-block structured component library as data, each with fields/validation/schema/a11y) — plus `templateSlugForIndustry` (default-template-by-industry as data). 24/24 tests. It **designed** the full ecosystem (industry strategy, lifecycle, SDK, scalability). What it deliberately did **not** do is hand-author 40 industries × N templates in one pass (that would be shallow); it built the foundation that makes authoring correct and fast, and recommends the focused V1 template set. Approval-first, determinism, structured content, and one render pipeline are all preserved — this is not a page builder.

---

## Step 1 — Discovery (what exists, what becomes reusable)

| Exists | Reuse / becomes reusable |
|---|---|
| One render engine (`render(snapshot, manifest, siteConfig) → FileMap`), pure + deterministic | The **shared engine** every template uses |
| Structured content contract (`SnapshotContent`) | Unchanged — templates never fork the content model |
| Industry packs (guidance-only) + `resolveIndustryKey(slug)` + `composePack` inheritance | The **industry layer**; now also drives vocabulary/schema |
| `starter_site` writer + fact-guard | AI drafts blocks; never invents facts; approval-first |
| Publish / preview / version / rollback (one pipeline) | Unchanged — templates plug into it |
| One template (`restaurant-classic`), restaurant-hardcoded schema/vocab | The food-family template; **no longer the only correct output** |

**Not rebuilt:** the render pipeline, content model, versioning, approvals, packs. **Made reusable:** industry vocabulary + the component catalog (this milestone).

---

## Step 2 — Industry Strategy (V1 vs V1.1)

Recommended **V1 industries** (highest real customer value + clean structured fit), each realized by the neutral engine + its vocab:

- **Food:** Restaurant, Café/Coffee Shop *(shipped template family)*.
- **Home & trade:** Home Services, Plumber, HVAC, Electrician, Contractor, Landscaping, Cleaning, Roofing.
- **Beauty & wellness:** Salon, Barber, Spa, Fitness/Gym/Yoga.
- **Professional:** Law, Accounting, Insurance, Consulting, Marketing, Real Estate, Photography.
- **Community/retail:** Nonprofit, Church, Retail *(display; e-commerce V1.1)*, **Generic Business** (the universal fallback).

**V1.1:** Medical/Dental/Veterinary (compliance/booking depth), Food Trucks/Bars (specialized), full E-commerce, Corporate/Portfolio niches. All already have vocab rows so they're a template-authoring step, not architecture.

**Templates per industry for V1:** start with **one strong template each** (a vertical realization of the engine), plus the **generic** fallback. Multiple looks-per-industry are theme variants (Step 5), not new code — so "3 templates for restaurants" = 1 realization × 3 themes.

For each industry the ecosystem defines: business structure (from the pack), required pages + components (Steps 3–4), SEO/schema (`vocabFor`), AI prompts (the writer + component `aiAssist` flags), Business Moments/CRM defaults (the pack's intelligence rules — already industry-aware), and connected-platform relevance (the pack). Approval requirements are constant: everything publishes approval-first.

---

## Step 3 — Template Architecture (templates-as-data)

```
   template = render ENGINE  ×  industry VOCAB  ×  THEME  ×  COMPONENT selection
              (one, pure)       (lib/industry_vocab)  (tokens)   (lib/site_components)
```

- **The engine** is the existing pure render (deterministic, one pipeline). New templates do **not** add render code.
- **Vocabulary** (`vocabFor(industry)`): schema.org type, offering label/path, item schema, primary action. A plumber template says "Services" and emits `@type: Plumber`; a restaurant says "Menu" and emits `Restaurant/Menu`. **This is the industry realization the packs always declared but nothing consumed.**
- **Theme**: design tokens (Step 5) — the same engine renders different looks.
- **Components**: which structured blocks a template realizes (Step 4).
- **Manifest** stays the contract (`pages`, `entities`, `image_variants`, `content_contract_version`); a template is a manifest + a vocab key + a theme + a component set.

Adding the 250th template changes **no architecture** — it's a new data row (vocab, if a new industry) + a manifest/theme/component config authored via the SDK. Version pinning, immutability, and rollback are unchanged.

---

## Step 4 — Structured Site Builder (component library, NOT drag-and-drop)

`lib/site_components.ts` is the catalog — **~30 reusable blocks as DATA**, each declaring `fields` (typed + validated + repeatable + `aiAssist`), the **schema.org** it emits, its **accessibility contract**, its **SEO role**, and the **industries** it fits. The V1 blocks: Hero, Services/Offerings, Features, Pricing, Testimonials, Reviews (AggregateRating), FAQ, Team, Gallery, Before/After, Process, CTA, Lead Form, Newsletter, Appointment, Hours, Location+Map, Service Areas, Locations, Menu, Products, Events, Announcement, Blog, Video, Stats, Awards, Certifications, Partners, Social Feed.

This is **structured, not free-form**: a customer turns a block on and fills its fields → structured content → deterministic render. No arbitrary layout, no runtime code, no drag-and-drop. Adding a block = one catalog entry + a template realizing it. Each block's a11y contract is enforced at realization (single h1, labelled inputs, alt text, no color-only meaning, keyboard-complete).

---

## Step 5 — Theme System

Themes are **design tokens** the engine consumes — the same primitives Developer Mode already uses (`--accent`, `--ink`, `--bg`, radius, type scale) extended into a full system: typography pairing, spacing scale, button/form/card styles, icon set, color system (with **dark mode** via the existing theme-aware token pattern), and motion (respecting `prefers-reduced-motion`). Every template inherits one design system, so "premium" is a platform property, not per-template work. A "restaurant, modern" vs "restaurant, classic" = same engine + vocab, different theme tokens. Accessibility (contrast, focus, reduced-motion) is a theme-level guarantee, tested once.

---

## Step 6 — AI Integration

AI reads the same data:
- **Starter/SEO/metadata prompts** come from the industry (vocab + pack) + the component `aiAssist` flags — the writer knows exactly which fields it may draft (headlines, service descriptions, FAQs, posts) and which it must not (facts, prices, hours).
- **The fact-guard** stays: AI never invents unverifiable claims; on failure it says "unavailable," never filler.
- **Business Moments / CRM defaults / connected recommendations** are the pack's existing industry-aware intelligence — the template ecosystem doesn't duplicate them; it aligns vocabulary with them.
- **Approval boundary:** AI drafts blocks and copy → a proposal → the member reviews → publish. AI never publishes or changes structure without approval. (Phase I already wired the starter draft this way.)

---

## Step 7 — Developer SDK

Developers extend by **authoring data + a manifest**, never runtime code:
- **Custom templates** = a manifest + vocab key + theme + component selection (a new versioned folder in the registry).
- **Custom themes** = token sets.
- **Custom components** = catalog entries (fields/schema/a11y) + the render realization, shipped with the platform version (deterministic, no runtime foreign code — the existing Developer Mode philosophy).
- **Industry packs** = the existing pack SDK (`industry/sdk.ts`), now also declaring vocabulary.
- **Inheritance**: packs `extends` (already built); themes and templates inherit the base design system.
- **No runtime arbitrary code** — a template/component is data + a deployed pure render, never executed-at-request customer code.

---

## Step 8 — Template Lifecycle

- **Versioning:** templates are immutable per version (a change = a new version); sites pin a version; old versions never mutate (already the rule).
- **Upgrades:** a site opts into a new template version; the snapshot's content is re-rendered by the new version. Because content is structured and separate from the template, **content is preserved** across upgrades.
- **Industry switching:** change the site's template slug → new vocab/schema/vocabulary; the same structured content re-renders correctly (offerings become "Services" instead of "Menu").
- **Developer customization preservation:** the Developer-Mode layer lives in the snapshot (Phase B1), so it survives template upgrades.
- **Rollback:** unchanged — every publish is a versioned snapshot restorable in one step.
- **Compatibility:** the manifest's `content_contract_version` gates a template against a snapshot; a mismatch is refused, never mis-rendered.

---

## Step 9 — Future Scalability Review

**Would today's architecture hold at 500 templates / 10,000 components / 250 industries / third-party + agency + developer packs / enterprise design systems?** **Yes** — because none of those are code once the primitives exist:
- Templates/industries/components/themes are **data**; the render engine, pipeline, versioning, and approvals are **constant**.
- Third-party/agency/developer packs use the existing pack + component SDK (data + deployed pure render).
- Enterprise design systems are theme-token sets inherited by their templates.
The only thing that grows is a **registry + catalog** (indexed data) and **authoring** effort — not architecture. The one scaling concern to watch (documented, not a blocker): the render REGISTRY is static-import-per-version; at hundreds of versions this wants a lazy/indexed registry (FD-T2).

---

## Implementation (this milestone) vs authoring (ongoing)

**Built + tested (V1 primitives):** `lib/industry_vocab.ts` (correct schema + vocab for 25+ industries), `lib/site_components.ts` (~30 structured blocks as data), `templateSlugForIndustry` (default-by-industry). **24/24.** Additive, pure, reuse the architecture, break nothing.

**The immediate next implementation (recommended V1, gated on the market-scope decision):** author the neutral **`business-classic/1.0.0`** template — the shared engine emitting `vocabFor(industry)` (LocalBusiness + neutral vocabulary) — register it, and point `provision`/default-template at `templateSlugForIndustry`. That is what makes a non-restaurant customer publish a *correct* site. It's authoring against the primitives now in place (a bounded, testable render + manifest), not new architecture. Flagged as **FD-T1** and as the decisive item for "restaurant-first vs small-business-broad."

---

## Feature discovery update

- **FD-T1 · Author `business-classic` (neutral) template + wire default-by-industry** — the primitives are built; this renders them. *V1 (blocker if launching broad; V1.1 if restaurant-first).*
- **FD-T2 · Lazy/indexed template registry** — for hundreds of versions (static imports don't scale forever). *V1.1.*
- **FD-T3 · Theme-variant system** (multiple looks per template via token sets) + **FD-T4 · vertical templates** (home-services, salon, professional …) authored via the SDK. *V1.1.*
- **FD-T5 · Realize the component catalog in the engine** (render each block from its data) — the catalog is defined; wiring each block's render is the build-out. *V1.1.*

---

## Testing

`template_ecosystem_test.mjs` (new) **24/24** — industry vocab emits correct schema/vocab per industry (plumber→Plumber/Services, not Restaurant/Menu; retail→Store/Products; law→Attorney; generic→LocalBusiness), default-template-by-industry, and the component catalog is well-formed (unique keys, typed fields, a11y contract, schema roles, industry fit, AI flags). Full regression green — render 28/28 (the shipped template is untouched), nav_integrity 3/3, editions 36/36, invariants **14/14**, plus the rest. Additive pure libs → no function/migration change, no redeploy. (Authoring `business-classic` will add a render test for its output; the engine + suite are ready for it.)

---

## Final Questions (answered honestly)

- **Can Studio OS support hundreds of templates without architectural change?** **Yes** — templates are data (engine × vocab × theme × components); the primitives are built and tested. The scaling limit is authoring + an indexed registry (FD-T2), not architecture.
- **Can customers build professional websites quickly?** **The foundation is there** (structured blocks + AI drafting from Phase I); the "quickly + professional for any industry" experience lands fully once `business-classic` + a couple of vertical realizations are authored (FD-T1/T4).
- **Does every industry feel intentionally designed?** **Correctly, yes** (right schema + vocabulary per industry now); **beautifully per-industry** needs the vertical templates/themes (V1.1).
- **Do templates feel premium?** The design-system + theme foundation makes premium a platform property; realized today only through the restaurant template — the neutral + verticals inherit it.
- **Do components reduce customer effort?** **Yes by design** — structured blocks with AI-assistable fields + smart defaults (Phase I intake) mean filling, not building.
- **Does AI generate better websites because of this architecture?** **Yes** — the writer now has per-industry vocabulary + per-component `aiAssist` flags, so drafts are industry-correct and scoped, still approval-first.
- **Can agencies scale with these templates?** **Yes** — templates/themes/components are shareable data (agency template libraries = FD-T3/T4 packs on this SDK).
- **Can developers extend safely?** **Yes** — data + a deployed pure render; no runtime foreign code; the existing Developer-Mode philosophy holds.
- **Anything still missing before V1?** **Yes, and it's the honest crux: the neutral `business-classic` template isn't authored yet (FD-T1).** The *architecture* to serve every industry is designed and the *primitives* are built + tested, but until that one template renders `vocabFor(industry)`, a non-restaurant customer still gets the restaurant template. Whether that's a **V1 blocker** or **V1.1** is the exact market-scope decision flagged on the roadmap: **restaurant-first → ship now, author verticals next; small-business-broad → author `business-classic` before launch.** That decision is yours; the engineering is staged and ready either way.

---

**Phase T — Template Ecosystem, Structured Site Builder & Industry Realization complete** *(architecture designed + V1 primitives built & tested; the neutral-template authoring — FD-T1 — is the staged next step, gated on the market-scope decision).*
