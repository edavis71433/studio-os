# L5.1 — Restaurant Industry Pack

The first complete Industry Pack, built entirely on the L5.0 foundation. It proves the industry architecture: a restaurant business gets restaurant-aware evidence, judgment, recommendations, moments, growth, and creative guidance — and **not one line of engine logic changed**. Every restaurant-specific thing lives in the pack (`industry/packs/restaurant.ts`); it plugs in through the same spread-extension the connected catalog uses; and its provider self-gates so a non-restaurant site is provably untouched.

19 restaurant checks + full regression green (30 providers live on staging); invariants still 14/14 held.

---

## 1. Restaurant Pack Architecture

```
site (template_slug 'restaurant-*') ──resolveIndustryKey──▶ industry='restaurant' (set in the collector)
        │
        ▼  the restaurant provider SELF-GATES: emits only when industry==='restaurant'
   Evidence (content.menu_absent, content.menu_prices_missing, media.food_photos_missing)
        ▼
   Judgment (restaurant_menu, restaurant_visuals) ─▶ Recommendation (rec_restaurant_*) ─▶ Moments (calm, merged)
        ▼
   Growth (coach restaurant calendar) · Creative (writer restaurant voice) · Connected (relevant providers) · CMS (pages/nav)
```

**How it stays engine-free:** the pack exports data + one pure provider. A single neutral seam (`industry/compose.ts`) aggregates every installed pack's contributions; the five engine registries spread those aggregates in (`...PACK_CATALOG`, `...PACK_PROVIDERS`, `...PACK_JUDGMENT_RULES`, `...PACK_REC_RULES`, `...PACK_MOMENT_TEMPLATES`) exactly as L4.1 spread `...CONNECTED_CATALOG`. The engines never learn the word "restaurant" — they iterate their registries generically. Self-gating (the provider checks `input.industry`) means restaurant evidence only exists for restaurants, so its rules are inert everywhere else with no engine filter.

## 2. Restaurant Capability Matrix

| Subsystem | Restaurant contribution | Mechanism |
|---|---|---|
| Profile | cuisine, dining style, price range, reservations, takeout/delivery, outdoor seating, dietary, parking, alcohol, kids/pets, private events, accessibility | `profile` layer (data) |
| Vocabulary | offerings→menu, offering→dish, gallery→food photos, book→reserve a table | `vocabulary` layer |
| Evidence | menu absent, menu prices missing, food photos missing | pure provider, self-gated |
| Judgment | `restaurant_menu`, `restaurant_visuals` | appended rules |
| Recommendation | `rec_restaurant_menu`, `rec_restaurant_visuals` | appended rules |
| Moments | "Your menu is what diners look for first", "A few photos of the food go a long way" | appended templates (mergeable) |
| Growth | seasonal + holiday calendar (Valentine's, Mother's Day, patio season…) | reuses `coach/packs.ts` restaurant pack |
| Creative | appetite-forward voice + food-photography guidance + media suggestions | reuses `writer/pack.ts` + `creative` layer |
| Connected | GBP, Search, Analytics, Yelp, Calendar; emphasise reviews/listings/booking | `connected` layer (references existing providers) |
| CMS | Home/Menu/About/Reservations/Gallery/Contact/Location + menu/gift-card/careers/FAQ pages | `cms` layer (declarative) |
| Compliance | allergen info, alcohol-service disclaimers | `compliance` layer |

## 3. Restaurant CMS Guide

The pack **declares** (never forks) restaurant scaffolding a template can realize: navigation (`Home, Menu, About, Reservations, Gallery, Contact, Location`), page kinds (`menu, reservations, private_events, gallery, gift_cards, careers, faqs`, …), components (`menu_section, hours_block, reservation_cta, photo_gallery, map`), landing pages (`seasonal_menu, holiday_hours, private_events`), and blog categories (`seasonal, events, behind_the_scenes`). These are data the CMS/template reads; the CMS engine is untouched.

## 4. Restaurant Intelligence Guide

Restaurant intelligence is deliberately small and high-value (the goal is to validate the architecture, not to exhaust restaurant workflows):

- **The menu** is the page diners open first — `restaurant_menu` fires when there is no menu (warning) or a menu without prices (info); it becomes a calm "your menu could work harder" moment.
- **Food photography** is the strongest conversion lever — `restaurant_visuals` fires when there are no food photos; a gentle "a few photos go a long way" moment.
- Both are **mergeable**, so together they become ONE improvements bundle, never two pings — Calm Software holds. Everything traces the frozen pipeline; nothing bypasses evidence or approval.

## 5. Restaurant Growth Guide

The growth layer **is** the existing coach restaurant pack (`coach/packs.ts`) — the umbrella subsumes it rather than duplicating it. It supplies the restaurant calendar the Growth Coach already uses: the big dining holidays (Valentine's, Mother's/Father's Day, NYE), the seasonal turns (spring menu, patio season, comfort-food fall, holiday parties/gift cards), the natural review moment ("while the meal is still fresh in a happy guest's mind"), and the education angle (where ingredients come from, how the menu changes). The coach's value-filter still applies: an angle with no grounding in the customer's own site produces nothing.

## 6. Restaurant Creative Guide

The creative layer **is** the existing writer restaurant pack (voice guardrails + vocabulary) plus added guidance — all config the ONE Creative Studio reads; no new AI:

- **Voice:** warm, appetite-forward (writer pack).
- **Photography guidance:** natural light, shot close and slightly from above; the hero dish not the whole table; show freshness/steam, avoid heavy filters.
- **Media suggestions:** a signature dish, the dining room, the storefront, the team at work.
- **Brand defaults:** appetite-forward tone, appetizing warm neutrals (the customer overrides).

## 7. Restaurant Validation Report

`tests/presence/restaurant_pack_test.mjs` — 19 checks:

- **Self-gating:** a restaurant with no menu/photos emits restaurant evidence; the *same* site as `generic` (or with no industry) emits **nothing**.
- **Wiring:** the restaurant evidence types live in the one frozen catalog.
- **Live pipeline:** restaurant evidence → restaurant judgment → recommendation → a calm restaurant moment (two nudges merge into one bundle; no jargon).
- **Calm:** a complete restaurant (priced menu + photos) raises nothing; a partial gap raises exactly one gentle nudge.
- **Self-gating end to end:** a generic site with the same gaps gets no restaurant judgment or moment.
- **Conformance:** the pack resolves/composes with every layer; growth = the coach pack, creative = the writer pack (subsumed, not duplicated); CMS scaffolds restaurant pages.
- **Ten sub-types** (coffee shop, fine dining, fast casual, food truck, bakery, pizza, barbecue, sushi, family restaurant, bar): all stay calm (≤3 moments) on the one architecture; the same restaurant intelligence applies uniformly.
- **No fork:** the engines import the `PACK_*` aggregates generically (never the restaurant pack directly); the only industry logic is the provider's `input.industry` self-gate, in the pack.

Full regression: evidence 25, judgment 23, recommendation 26, moments 23, concierge 26, optimization 33, connected suites, platform spine 22, **invariants 14/14 held**, coach 46, writer 30 — all green. Live: all 30 providers execute on staging.

---

## Final review

- **Did the Industry Pack extend the platform without modifying engines?** Yes — engine *logic* is untouched; the registries spread in pack aggregates generically (the sanctioned extension), and self-gating keeps everything inert for other industries. The invariants suite still holds 14/14.
- **Does the Restaurant Pack feel like one coherent experience?** Yes — menu/photo evidence, restaurant moments in the diner's words, the restaurant calendar, appetite-forward voice, and restaurant CMS scaffolding all resolve from one pack.
- **Could another Industry Pack now be built by following the same contract?** Yes — a new pack is a `industry/packs/<x>.ts` data module + one line in `industry/compose.ts`; no engine touch. The restaurant pack is the worked example.
- **Would this architecture still work with 100 industries?** Yes — each pack self-gates and appends; a non-matching site sees none of it; resolution/composition are generic; the marketplace lifecycle versions and toggles packs. 100 packs is 100 data modules, not 100 forks.
