# Version 1 — Customer Workflow Integrity Audit

*Experience audit, not code review. Walked the product as a brand-new customer. Reports only workflow gaps that prevent Version 1 from being truly usable — not polish, not marketing, not launch, not legal.*

---

## Executive Summary

Walking the product as a new customer, the picture is encouraging and the gap is narrow. **Inside the app (`portal.html`), the core workflows are present and completable:** editing content, the creative studio (Writer/Editor/Reviewer/Brand Guardian), the daily "Review and decide / updates" intelligence surface (which *is* the Business Moments experience), the Growth Coach, the Concierge, uploading photos (media), and publishing. A customer who reaches the app can do the day-to-day work without help.

**One customer workflow is genuinely blocked: connecting a service (the Connected Platform).** There is no customer screen to connect Google Business Profile, reviews, analytics, etc. The read/write backend and the OAuth *return* page exist, but the page a customer would use to *start* a connection does not — so a customer cannot connect anything themselves. (Additionally, live connections require the owner to register provider OAuth apps first — activation, not a workflow the customer performs.)

Two clarifications that look like gaps but aren't:
- **"AI Visual Studio" does not exist — by design.** Studio OS never generates images; photographs are the customer's own (a Product Law). The real visual workflow is **media upload + descriptions**, which the app has. There is no missing image-generation workflow; there is a *naming* expectation to correct, not a capability to build.
- **Marketplace / Enterprise / Agency have no customer UI** — deliberately deferred (Track 1/V1 audit). A normal Version 1 customer never needs them, so they are not core-customer workflow gaps.

**Verdict: NO — a paying customer could not use *every* Version 1 capability unassisted, because they cannot connect a service.** That single workflow — the Connected Platform connect screen — is the one thing that must still be built for the core customer experience. It matches exactly the one item the V1 Feature Completion Audit already identified.

---

## Complete Customer Journey (walked as a new customer)

| Step | Can they discover it? | Can they start it? | Can they complete it? |
|---|---|---|---|
| Land on the website | Yes | — | — |
| **Discover the product / start buying** | **Weak** — the public site routes to "Book a call" and "Client login," not a purchase path *(positioning — owned by Track 2.5, not a build gap here)* | via direct URL only | Yes (signup → checkout → welcome exists) |
| Signup + billing | If reached | Yes | Yes (L1 commerce) |
| First login → the app | Yes | Yes | Yes |
| Edit content (CMS) | Yes (in app) | Yes | Yes |
| Creative Studio (write/edit/review) | Yes | Yes | Yes (draft → approve, manual parity) |
| Daily intelligence ("Review and decide" / updates = Business Moments) | Yes (in app) | Yes | Yes (review → decide) |
| Growth Coach | Yes | Yes | Yes (opportunities → prepare/approve) |
| Concierge (ask a question) | Yes | Yes | Yes (grounded answers) |
| Photos / media | Yes | Yes | Yes (upload + descriptions) |
| Publish | Yes | Yes | Yes (draft → approve → live, versioned) |
| **Connect a service (Connected Platform)** | **No** | **No** | **No** — no customer screen exists |

## Workflow Map (core product)

```
Buy → Sign in → App
                 ├─ Edit content ─────────── ✅ complete
                 ├─ Creative Studio ───────── ✅ complete (Writer/Editor/Reviewer/Guardian)
                 ├─ Review & decide (Moments) ✅ complete (the daily intelligence surface)
                 ├─ Growth Coach ──────────── ✅ complete
                 ├─ Concierge ─────────────── ✅ complete
                 ├─ Photos / media ────────── ✅ complete (upload — no AI generation, by design)
                 ├─ Publish ───────────────── ✅ complete
                 └─ Connect a service ─────── ⛔ BLOCKED (no connect screen)
```

## Blocked Workflows

**1. Connect a service (Connected Platform).** A customer cannot connect Google Business Profile, reviews, analytics, etc. — there is no screen to list connectable services, start a connection, view health, or disconnect. The backend (read L4.1, intelligence L4.2, write L4.3, hardening L4.4) and the OAuth *return* page (`connections-callback.html`) exist; the *entry* screen (`connections.html`) does not. This is the one workflow a customer cannot start or complete unassisted.
*(Secondary, non-build: even once the screen exists, live connections require the owner to register provider OAuth apps — an activation step, not a customer workflow.)*

## Dead Ends

- **`today.html` (the Business Moments "Today" hero, built in Track 2) is not linked from the app** — a customer would never reach it. It is not a *blocking* dead-end because the app already surfaces the daily intelligence under "Review and decide / updates"; it is an *orphaned duplicate surface*. Either wire it into the nav or treat the in-app review surface as the canonical one. (Not a build gap — a wiring choice.)
- No other customer-facing dead-ends were found in the core workflows.

## Backend Without Customer Surface

| Capability | Backend | Customer surface | Core-V1 impact |
|---|---|---|---|
| **Connected Platform (connect)** | Complete | **Missing** | **Blocks a core workflow** |
| Marketplace | Complete | Deferred (operator) | None — customer never needs it |
| Enterprise (org/locations) | Complete | Deferred (operator/agency) | None for a single-business customer |
| Agency orchestration | Complete | Deferred | None for a customer |
| Additional industry packs | Foundation + 4 packs | Auto-surfaced when present | None — additive |

## Customer Surface Without Backend

- **"AI Visual Studio" / AI image generation** — no backend exists, **by design** (photographs are customer-supplied; generation is forbidden by Product Law). The app's photo/media surface is *upload*, and it has a backend. There is no surface promising generation to a customer inside the product; the only risk is *marketing* naming ("AI Visual Studio"), which is out of scope here. **No build required** — the visual workflow (upload + descriptions) is complete.
- No other customer surface was found pointing at a missing backend.

## Version 1 Customer Readiness

- **Core self-serve product (edit, create, review/decide, grow, ask, publish, media):** **usable end-to-end today.**
- **Connect a service:** **not usable** — the one blocking customer workflow.
- **Advanced tiers (marketplace/enterprise/agency):** not customer workflows in V1 (deferred).
- **Visual generation:** not a capability (by design) — the media-upload workflow is complete.

The product is **one workflow away** from a customer being able to use every core Version 1 capability unassisted.

---

## Final Question

**If a paying customer signed up today, could they successfully use every Version 1 capability without developer assistance?**

**No.** One customer workflow must still be built:

> **Connect a service (Connected Platform) — the customer connect-management screen (`connections.html`).** A customer cannot start or complete connecting Google Business Profile, reviews, analytics, or any provider, because the entry screen does not exist (the backend and the OAuth return page are complete). *Live activation additionally needs the owner to register provider OAuth apps — an activation step, not a customer workflow.*

*Everything else in the core Version 1 product — buy/sign-in, CMS, Creative Studio, the daily Business-Moments/"review and decide" surface, Growth, Concierge, media, and Publish — is discoverable, startable, and completable by a customer without assistance. The advanced-tier surfaces (Marketplace/Enterprise/Agency) are intentionally deferred and not core-customer workflows; "AI Visual Studio" is not a capability (photos are customer-supplied by design) and requires no build.*

This is consistent with the V1 Feature Completion Audit: the Connected connect-management UI is the single remaining core-customer build item.
