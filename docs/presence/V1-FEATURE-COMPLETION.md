# Version 1.0 — Feature Completion Audit

*Inventory + classification only. No architecture review, no new features, no launch/ops/legal/marketing/polish items (all explicitly out of scope). Only: what already-planned product capabilities remain unbuilt before Version 1 is feature complete?*

---

## Executive Summary

**Finding: the platform is, at the capability level, remarkably close to feature complete.** A full sweep of the codebase (23 subsystems, 44 migrations, 43 test suites) found **no half-built core capability** — there are no meaningful `TODO`/`FIXME`/"unfinished" markers, and every listed subsystem's *engine* is complete and tested. The intelligence pipeline, creative studio, publishing, connected platform, industry platform, marketplace, enterprise, and agency backends are all done.

The only remaining *planned* build work is **customer-facing surfaces for capabilities whose backends are complete**, and **additive content** (more industry packs, more connected providers). None of it is architecture; none of it is invention.

Concretely, exactly **one** planned customer surface sits between here and a clean "core product" Version 1: the **Connected Platform connect-management screen** (`connections.html`). Everything else planned is either an *advanced-tier UI* (marketplace / enterprise / agency — already recommended for V1.1) or *additive data* (industry packs, provider coverage) or *owner activation* (registering provider OAuth apps, confirming prices — setup, not build).

**Recommendation: define Version 1 as the core self-serve product** — watch and run your presence, the daily calm intelligence, the creative studio, publishing, and (optionally) customer-managed connections — and **move the advanced tiers' UIs to Version 1.1.** Under that scope, the single remaining build item is the connect-management screen. **Prefer this smaller, complete Version 1.**

---

## Complete Platform Inventory (every subsystem, one category)

| Subsystem | State | Note |
|---|---|---|
| CMS (structured content, renderer, templates) | **Complete** | M1–M7; frozen renderer |
| Creative Studio — Writer | **Complete** | fact-guarded, manual parity |
| Creative Studio — Editor | **Complete** | edit modes (Amendment 1) |
| Creative Studio — Reviewer | **Complete** | findings that earn their existence |
| Creative Studio — Brand Guardian | **Complete** | veto on unattributable claims |
| Publishing | **Complete** | draft→approve→publish, versioned, restore |
| Business Moments (engine) | **Complete** | ≤3, merged, dismissable |
| Business Moments (customer surface) | **Complete** | portal + the new `today.html` hero (Track 2) |
| Growth Coach | **Complete** | seasonal/holiday, value-filtered |
| Concierge | **Complete** | deterministic, grounded |
| Optimization Engine | **Complete** | 29 providers, calm-tuned (L3.4) |
| Evidence / Judgment / Recommendation / Moments engines | **Complete** | frozen, invariant-guarded |
| Connected Platform — read engine | **Complete** | L4.1; ~18/21 providers with real normalizers |
| Connected Platform — intelligence | **Complete** | L4.2 |
| Connected Platform — write adapters | **Complete** | L4.3; GBP/GSC workflows + 3 handoffs |
| Connected Platform — **customer connect UI** | **In Progress** | callback page built (Track 2); connect-management screen not built |
| Industry Platform — foundation + SDK | **Complete** | L5.0/L5.2/L5.4 |
| Industry Platform — shipped packs | **Complete (4)** | restaurant, coffee_shop, home_services (base), pet_grooming |
| Industry Platform — additional packs | **V1.1+** | 6 trades + other verticals (documented roadmap) |
| Marketplace — foundation (install lifecycle) | **Complete** | L5.5, on the approval spine |
| Marketplace — UI | **V1.1+** | Track 1 recommended deferral |
| Enterprise — foundation (org/region/location inheritance) | **Complete** | L5.6 |
| Enterprise — UI | **V1.1+** | Track 1 recommended deferral |
| Agency — backend (portfolio, queues, orchestration) | **Complete** | M13 + L5.7 |
| Agency — UI | **V1.1+** | Track 1 recommended deferral |
| Customer Portal | **Complete** | `portal.html` + `today.html` |
| Admin / Operator Portal | **Complete (backend)** | `/admin` routes; operator-auth path for new surfaces is V1.1 (ties to the V1.1 UIs) |
| CRM | **Complete (by design)** | clients/contacts/tenants + agency portfolio; constitution: Studio OS *is* the light CRM (no separate build) |
| Pipeline (M9 intelligence) | **Complete** | frozen, one-way |
| Billing / Commerce | **Complete (backend)** | L1 Stripe checkout, subscriptions, entitlements, portal |
| Authentication | **Complete** | staff / client / agency member; operator-auth for the deferred surfaces → V1.1 |
| Notifications | **Complete (by design)** | Business Moments + commerce emails; no separate subsystem was planned |
| Integrations | **Complete (architecture)** | Connected Platform; per-provider *activation* is owner setup, not build |
| Mobile / Desktop | **N/A** | responsive web; native apps were never planned |

## Completed Features

Everything above marked **Complete** — the entire M1–L5.7 backend and the customer-critical surfaces (portal, the Business Moments "Today" hero, publishing, growth, concierge, creative studio). This is the overwhelming majority of the platform.

## Features In Progress

**1. Connected Platform — customer connect-management UI (`connections.html`).**
- **What exists:** the full read/intelligence/write backend (L4.1–L4.4), and the OAuth callback page (`connections-callback.html`, Track 2).
- **What remains:** the screen that lists a customer's connectable services in plain words, shows connection health, starts a connect (store pending key → redirect to the provider's consent), and disconnects. Specified in the Track 2 Connected UX Guide; not yet built.
- **Not build work (owner setup):** registering the provider OAuth apps so live connections actually complete.

*(No other subsystem is partially built. This is the only in-progress customer capability.)*

## Remaining Version 1 Features

If Version 1's story includes **customer-managed connections** (the "connect your Google listing" value in the positioning):
- **Connected connect-management UI** — the one item above.

If Version 1 scopes connections to **Managed-edition / operator-assisted only**, then **nothing remains** — the core product is feature complete, and connections are operated for the customer.

## Recommended Version 1.1 Features (planned, not required for V1)

- **Marketplace UI** (backend complete).
- **Enterprise UI** — org/location/rollout screens (backend complete).
- **Agency UI** — portfolio/queues/approvals screens (backend complete).
- **Operator-auth path** for the marketplace/enterprise/agency management surfaces (moves with those UIs).
- **Additional Industry Packs** — the 6 home-services trades, then dental/medical/legal/retail/etc. (documented roadmap; additive, no engine change).
- **Broader connected coverage** — the 3 placeholder providers (Apple, Tag Manager, Meta) and write workflows beyond GBP/GSC (additive data).
- **Deeper pack intelligence** — restaurant/coffee_shop rule depth (currently intentionally shallow).
- **`connected_data` time-series** (currently one-deep) — unlocks trend features.

## Dependency Map

```
Core product (Complete) ── everything ships on the frozen engines + spine, no cross-deps
        │
        └─ Connected connect-UI ── depends on: (a) connected backend [DONE],
                                                (b) OAuth app registration [owner setup],
                                                (c) the callback page [DONE, Track 2]
V1.1:
  Marketplace UI ─┐
  Enterprise UI  ─┼─ depend on: a real operator/agency auth path (shared prerequisite)
  Agency UI      ─┘
  Additional packs ── depend on: the Industry SDK [DONE]; each is independent + additive
  Broader providers ── depend on: Connected architecture [DONE]; each independent
```

## Build Order

1. **Connected connect-management UI** — the only remaining V1 customer surface (if V1 includes self-serve connections).
2. *(V1.1)* Operator/agency auth path → then Agency UI, Enterprise UI, Marketplace UI (in that order — agency has the most complete backend + clearest customer).
3. *(V1.1)* Industry packs — coffee-shop is done; next the home-services trades on the base pack, then compliance-heavy verticals (dental/medical/legal).
4. *(V1.1)* Broader connected providers + deeper pack intelligence — additive, any order.

## Critical Path to "Version 1 Feature Complete"

- **Shortest path (core product, connections operator-assisted):** **already complete** — no build work remains.
- **With self-serve connections:** **one item** — the connect-management UI. Its only build dependency (the callback page) is done; live activation is owner setup, not build.

There is **no long pole.** Nothing V1-scoped is blocked, complex, or risky.

## Version 1 Completion Board

> **Owner correction (post-audit):** **AI Visual Studio IS in Version 1.** An earlier revision of this audit treated AI image generation as intentionally excluded ("photos are customer-supplied, generation forbidden by Product Law"). That was an over-reading — the constitution contains **no law forbidding generative graphics**; it requires manual parity (Amendment 1), approval-before-use (the ritual + Approved-Plan spine), provenance honesty (`ai_approved`, commercial constitution), and the fact law for *claims* (Law 11). AI Visual Studio is therefore in-scope V1 build work, listed below.

### 🔵 Build Next
- ~~**Connected connect-management UI** (`connections.html`)~~ — **BUILT (L5.9).** The customer can view/connect/disconnect/refresh services in plain words; consumes the existing backend; commit not pushed.
- **AI Visual Studio** (`visual/` module + customer UI) — **remaining V1 build work.** AI image generation, editing, brand-aware graphics, hero/social/Open Graph assets, variations, storage in the media library, and approval before use. Built on the existing media library (`presence_media` + private bucket), brand profile (`presence_brand_profile`), the AI-model gating pattern (`writer/model.ts`), and the Approved-Plan spine (`lib/approved_plan.ts`). Live generation gated on an owner-set image-model key (honest "not available yet" until then, same pattern as connected writes / Stripe).

### 🟡 Build Soon *(V1 only if scope demands; otherwise V1.1)*
- *(nothing else is V1-required)*

### 🟢 Build Later — **Move to Version 1.1**
- Marketplace UI · Enterprise UI · Agency UI · operator/agency auth path
- Additional Industry Packs (6 trades + verticals)
- Broader connected providers + write coverage · deeper pack intelligence · `connected_data` time-series

### ⬜ Owner Setup (not build work)
- Register provider OAuth apps (activates live connections)
- Confirm Stripe subscription events + prices (activates live billing)

---

## Final Questions (answered honestly)

- **If development stopped today, what is missing from Version 1?** For the core self-serve product: essentially nothing built-able is missing — only the customer connect-management UI (and only if V1 sells self-serve connections). Every engine and the customer-critical surfaces exist.
- **What absolutely must still be built?** At most **one** thing: the connect-management screen. If connections are Managed-only at V1, even that is optional.
- **What should wait until Version 1.1?** Marketplace UI, Enterprise UI, Agency UI (+ their operator-auth), additional industry packs, broader connected providers, deeper pack depth, time-series.
- **Is the current Version 1 scope too large?** It *would be* if V1 tried to ship customer UIs for marketplace/enterprise/agency and a full industry-pack catalog. It is **not** too large if V1 = the core self-serve product (which is what's actually finished).
- **Can anything be removed?** Yes — remove the advanced-tier UIs and the extra packs from V1 (they're V1.1). That's already the recommendation, and it makes V1 both smaller and complete.

---

## Declaration

**Version 1 requires the following remaining build work:**

> **1. Connected Platform — customer connect-management UI (`connections.html`)** — **BUILT (L5.9).** Its backend and callback page are complete; live activation is owner setup, not build.
>
> **2. AI Visual Studio (`visual/` module + customer UI)** — AI image generation, editing, brand-aware graphics, hero/social/Open Graph assets, variations, media-library storage, approval before use. In-scope V1 per owner correction. Live generation gated on an owner-set image-model key.

**Version 1 is feature complete when both are built.** Item 1 is done; item 2 is the remaining V1 build (this is the next milestone).

*All other unbuilt work is Version 1.1 (advanced-tier UIs, additional packs/providers) or owner activation (OAuth-app + image-model key + Stripe registration) — none of it architecture, none of it invention.*
