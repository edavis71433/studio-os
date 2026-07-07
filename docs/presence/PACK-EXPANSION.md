# L5.3 — Industry Pack Expansion

Two packs, two scaling patterns, one architecture — no engine change. **Coffee Shop** proves child-pack inheritance (`extends`); **Home Services** proves reusable base packs (a parent six future trades will share). Both validated on the live pipeline; invariants still 14/14 held.

**Result:** 27 expansion checks + full regression green. Coffee Shop is ~79% inherited from Restaurant (11/14 CMS pages) and adds one judgment rule of its own. Home Services carries the entire trade foundation; a demo plumber inherits all of it for free.

---

## 1. Coffee Shop Pack Guide

`industry/packs/coffee_shop.ts`, `extends: 'restaurant'`. It duplicates nothing — it declares only the **differences**, and `composePack` folds Restaurant underneath it:

| Inherited from Restaurant (unchanged) | Coffee Shop adds / overrides |
|---|---|
| CMS: menu, reservations, gallery, contact, location, gift_cards, careers, faqs | pages: seasonal_drinks, loyalty, events |
| Vocabulary: offerings→menu | offering→drink, signature→signature drink |
| Growth calendar (coach restaurant pack) | coachAreas +loyalty |
| Creative: restaurant writer + food photography | latte/cup/seating photography |
| Profile: cuisine, dining fields | wifi, seating, roaster, loyalty, mobile_ordering; booking reservation→**order** |
| Connected: GBP, Search, Analytics, Yelp | ordering default = mobile |
| Evidence: menu absent / prices / food photos (fires via IS-A) | **workspace unlisted** (Wi-Fi/seating for the laptop crowd) |

The one new judgment (`coffee_shop_workspace`) becomes a calm "let the laptop crowd know they're welcome" moment. Everything else is Restaurant, inherited.

## 2. Home Services Architecture

`industry/packs/home_services.ts` is a **base pack** — no trade of its own, the shared spine every trade extends:

- **Profile:** service area, emergency service, licensing, insurance, warranty, financing, technicians, vehicles; **quote-first** booking.
- **Vocabulary:** offerings→services, book→"request a quote", gallery→before & after.
- **Evidence (trust foundation):** `business_info.home_services_service_area_missing`, `trust.home_services_license_unlisted` — the two things a local caller checks. One judgment (`home_services_trust`) → a gentle "show where you work and that you're licensed."
- **CMS:** Services, Service Areas, Financing, Emergency Service, About, Reviews, FAQs; **per-service pages** (`servicePages: true`); quote-form + phone-CTA + before/after-gallery components.
- **Creative:** before/after photography, branded vehicle, technicians at work; trustworthy/prompt/local voice.
- **Connected:** GBP, Calendar (scheduling), Analytics, Yelp, HubSpot (CRM); emphasise reviews/booking/listings.
- **Compliance:** state license display, proof of insurance/bonding.

## 3. Inheritance Guide

Two mechanisms make `extends` real (both fixed in L5.3):

1. **Layer inheritance (`composePack`).** Folds parent→child; a child that omits a layer keeps the parent's. Every layer inherits: profile (fields merge, booking overrides), vocabulary/CMS/connected/intelligence (concat + child-wins), growth/creative (`pack`/`writer` inherited if the child is null; guidance concatenated), compliance (requirements concat).
2. **Evidence inheritance (`industryIsA` + inheritance-aware `packProvider`).** A provider fires when the site's industry **is-a** the provider's industry. `coffee_shop` IS-A `restaurant`, so the restaurant evidence provider fires for a coffee shop automatically — the child inherits the parent's observations **without a single duplicated rule**. Rules key off evidence types, so the parent's judgments/recommendations/moments apply to the child for free.

To build a child: `makePack({ key, extends: '<parent>', ...only the differences })`, register it, add its (small) contributions to `compose.ts`.

## 4. Industry Reuse Report

- **Coffee Shop:** ~79% of its CMS pages are inherited (11 of 14); it declares 3 pages, ~6 profile fields, 1 vocabulary override, 1 evidence type, 1 judgment/rec/moment. **All** restaurant intelligence applies via IS-A evidence. A new eatery variant (bakery, juice bar) is a similarly tiny pack.
- **Home Services:** a trade pack inherits **100%** of the foundation (CMS, quote posture, licensing compliance, trust evidence, before/after media, connected guidance) and declares only its services, its trade-specific evidence, its calendar, and its voice. Measured live: the demo plumber inherited every home-services layer and added only its vocabulary.
- **Six future trades** (plumber, electrician, HVAC, roofer, landscaper, contractor) reuse this one foundation — each an estimated small pack, not a rebuild.

## 5. Pack Comparison

| | Restaurant | Coffee Shop | Home Services |
|---|---|---|---|
| Role | flagship vertical | **child** (extends restaurant) | **base** (parent for trades) |
| extends | — | restaurant | — (extends generic) |
| Own evidence types | 3 | 1 | 2 |
| Own judgment rules | 2 | 1 | 1 |
| Inherits | — | all of restaurant | — |
| Booking posture | reservation | order | quote |
| servicePages | false | false | **true** |
| Maturity (breadth) | Complete | Complete (inherited) | Advanced/Complete |

## 6. Future Trade Roadmap

Build order once Home Services exists (each `extends: 'home_services'`, declaring only differences):

1. **Plumber** — validates the first trade end-to-end (emergency/leak vocabulary; coach seasonal already partial).
2. **HVAC** — the coach already ships an HVAC calendar (tune-up/breakdown seasons) → richest growth reuse.
3. **Electrician** — safety/licensing emphasis; minimal new evidence.
4. **Landscaper** — coach ships its calendar; strong seasonal story.
5. **Roofer** — storm/insurance angle; before/after media shines.
6. **Contractor** — broadest; benefits from the others' patterns.

Each is a data module + one compose line; none touches an engine.

## 7. Validation Report

`tests/presence/pack_expansion_test.mjs` — 27 checks: coffee-shop layer inheritance (CMS/vocab/growth/creative/profile/connected), IS-A evidence inheritance (the restaurant provider fires for a coffee shop), the live coffee-shop pipeline (restaurant + coffee judgments, ≤3 calm moments), the home-services base (CMS/quote/licensing/trust evidence), a demo trade inheriting all of it, **no cross-contamination** (restaurant/coffee/home/generic never bleed into each other), no duplicated rules, measured reuse (~79%), and performance (20k composes across 4 packs in 211 ms). Full regression green; **invariants 14/14 held**; provider registry 30→32; deployed staging + prod.

---

## Final review

- **Did Coffee Shop prove pack inheritance?** Yes — it inherits Restaurant's CMS, vocabulary, growth calendar, creative voice, profile, connected guidance, and evidence (via IS-A), duplicating nothing; only its differences live in the pack (~79% inherited).
- **Did Home Services prove reusable foundations?** Yes — the full trade foundation lives once; a demo plumber inherited every layer and declared only its own, confirming six trades will reuse it.
- **Can future industries be built faster?** Yes — a child/trade pack is a small data module (declare the delta) + one compose line; no engine change.
- **Did code duplication decrease?** Yes — inheritance replaced copy-paste: coffee shop restates none of restaurant; trades will restate none of home services.
- **Would another engineer immediately understand how to build the next pack?** Yes — the two worked examples (a child via `extends`, a base for a family) plus the Inheritance Guide make the next pack a fill-in-the-delta exercise.
