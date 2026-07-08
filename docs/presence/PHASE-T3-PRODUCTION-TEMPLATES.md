# Phase T3 — Production Template Library & Template Realization

*Authors and ships `business-classic/1.0.0` — the neutral, vocabulary-driven **production default** — closing FD-T1, the deepest competitive gap. One render, every industry: correct schema.org type + vocabulary per business, deterministic, zero JavaScript, approval-first. Consolidates the Production Template / Business Classic / Industry Template / Quality Review / Component Realization / AI Template guides + the V1 Template Matrix.*

---

## Executive summary

**Studio OS can now publish a correct website for any business.** The new `business-classic` template reads the snapshot's `settings.industry` and adapts everything through `vocabFor()`: a plumber's site says "Services" at `/services/` and emits `@type: Plumber` + an `ItemList` of `Service`; a salon gets `HairSalon`; retail gets `Store` + `/products/`; a restaurant on the same render still gets `Menu` + `@type: Restaurant`. It ships the full production contract (home/offerings/about/FAQ/contact/thanks/updates/posts/404/favicon/sitemap/robots/redirects), all Phase-V essentials (logo, share image, announcement bar, working form with honeypot + thanks), a modern industry-neutral look distinct from the restaurant template, **zero emitted JavaScript**, and template-guaranteed accessibility. It is now the **default for every new site** (migration 0052), the industry is captured at onboarding and rides in the snapshot (deterministic + restore-safe), and it's proven by a 21/21 multi-industry suite + the full regression + live staging room/pipeline. **The V1 template strategy is realized: two templates (business-classic default + restaurant-classic for food), looks multiplied later by themes — quality over quantity, exactly as Phase T designed.**

## The build (verified)

- **Industry-in-snapshot:** `presence_settings.industry_key` (migration 0052) → `/settings` field rule → serializer → `SnapshotContent.settings.industry` → the template. Onboarding (`get-started.html`) persists the intake's industry on both paths ('other' → safe `generic`). Deterministic: the industry is part of the snapshot, so restore/rollback reproduce the exact vocabulary.
- **`business-classic/1.0.0`:** ~370-line pure render; nav/paths/CTAs/headings from vocab (`primaryAction` drives the hero CTA — "Get a quote" for trades, "Book an appointment" for medical); offerings render as service cards (or dotted menu list semantics for food via the Menu schema); JSON-LD = LocalBusiness-subtype + ItemList/Menu + FAQPage + BreadcrumbList + WebSite; hours table with holiday exceptions; markdown posts; redirect stubs. Distinct design: deep-teal accent, warm paper, confident sans — visibly not the restaurant template.
- **Default:** `presence_sites.template_slug` default → `business-classic`. Existing sites keep their pinned template (immutability preserved — no row was touched).
- **Quality gates (test-enforced):** single h1 + skip link + landmarks + `lang` + `aria-current` per page; title/description/canonical/OG per page; sitemap excludes `/thanks/`, robots disallows it; zero `<script>` (static, fast); determinism (same snapshot → same bytes); Developer-Mode layer applies via the shared `renderSnapshot` (Phase B1 — template-agnostic, verified by design).

## V1 Template Matrix

| Industry family | Template | Schema realized | Status |
|---|---|---|---|
| Every non-food business (trades, beauty, professional, medical, fitness, retail, community, generic) | **business-classic** (default) | LocalBusiness subtype per industry + ItemList/Service/Product | ✅ shipped |
| Food (restaurant, café, bar, truck) | restaurant-classic (+ business-classic also handles food correctly) | Restaurant/Menu | ✅ shipped |
| Dedicated verticals (distinct *looks* per industry) | theme variants (FD-T3) + vertical realizations (FD-T4) | inherits | V1.1 |

**Should more industries get dedicated templates for V1? No** — business-classic covers them *correctly*; dedicated looks are V1.1 themes, not blockers. **Component realization:** business-classic ships hero, services/offerings grid, testimonials, FAQ, hours, location/contact, lead form, announcement, blog, stats-adjacent strip — the catalog's required tier; the remaining catalog blocks land with FD-T5.

## AI quality

The starter-site flow now completes the loop: intake industry → **persisted** → the template's vocabulary matches the writer's industry-flavored draft (the writer already carries the industry in its instructions). AI doesn't "choose a template" per se — the default-by-industry is deterministic data (`templateSlugForIndustry`), which is better than a model choice: predictable, explainable, correct. Generic-website risk is answered by vocabulary (right words), the fact-guard (no invented claims), and per-industry pack intelligence — not by prompt roulette.

## Final questions (honest)

- **Proud to launch / premium?** business-classic is clean, fast (zero JS, one CSS file), correct, and accessible — a strong professional baseline. *Premium variety* (multiple looks) is FD-T3; I'd call the default proud-worthy and the catalog thin — by design for V1.
- **Does business-classic cover most businesses well?** Yes — correctly and completely for every non-food industry; food keeps its dedicated template.
- **Additional dedicated templates before V1?** No — themes are the multiplier.
- **Does AI generate intentionally-designed sites?** More than before: industry-true vocabulary + persisted industry + fact-guarded drafting. The visual intent deepens with themes.
- **Freelancer/agency confidence?** Yes on correctness + speed-to-first-site; the reuse gap (FD-18) remains their scaling limiter.
- **Missing before V1?** Nothing new from this phase. The launch gate remains: owner activation, browser QA (now including a business-classic render), the push — and the front-door milestone.

**Phase T3 — Production Template Library complete.**
