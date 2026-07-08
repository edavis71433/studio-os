# Phase D1 — Commercial Packaging Activation

*Implementation. The packaging architecture (Phase D) is complete; this makes every packaged edition **sellable** through the existing commerce architecture — no duplicate commerce system, no architecture change.*

---

## Executive summary

CMS-Only and Business-OS-Only are now purchasable. They were added as two rungs to the **existing** commercial catalog (`commerce/catalog.ts` PLANS), the entitlement `plan` CHECK was widened (migration 0049), and — because checkout uses **dynamic Stripe `price_data` from our own catalog**, not pre-created Price IDs — they are immediately buyable, trialable, and founder-priced with zero Stripe-dashboard configuration. Provisioning, the webhook, subscription sync, capacity, licensing, and nav all read the catalog generically, so they picked up the new rungs automatically. `/commerce/plans` now lists **7 rungs** on staging and prod. Everything flows through one licensing architecture; navigation adapts automatically via the Phase-D `editionFromPlan` mapping.

---

## Step 1 — Discovery (verified)

| Area | Finding |
|---|---|
| Plans | `PLANS` — 5 rungs, the single commercial truth (pure, tested). |
| Founder pricing | `founderMonthly` per rung + `FOUNDERS_OPEN`; the lock lives on the entitlement row. |
| Trials | `trialEligible` per rung; `trialEntitlementPatch` (14-day, no card). |
| Billing | Stripe Checkout via **dynamic `price_data`** (amount from `priceCents`) — **no per-price Stripe config**. Billing portal for manage/cancel/change. |
| Stripe mappings | `product_data.name` = plan name; interval from term; unit_amount from catalog. Webhook → `entitlementPatchFromSubscription`. |
| Licensing/entitlements | `presence_entitlements` (client_id, product, status, **plan**, founder, trial, period…); `plan` had a DB CHECK on 5 rungs. |
| Upgrade/downgrade | `changeKind` (by rank), self-serve boundary; upgrades instant+prorated, downgrades at renewal, never data loss. |
| Edition resolution | Phase D: `/portal/context` → `editionFromPlan(plan)` → feature edition → nav. Already handled `cms_only`/`business_os_only`. |

**Conclusion:** everything needed to sell a new edition existed generically. The only gaps were: the two rungs weren't in `PLANS`, and the `plan` CHECK rejected them.

---

## Step 2–3 — Commercial plans & billing (activated)

Added to `PLANS` (existing architecture, not a new one):

| Rung | Name | Site edition | Self-serve | Trial | Monthly | Founder |
|---|---|---|:-:|:-:|---|---|
| `cms_only` (rank 2) | CMS | presence (hosts a website) | ✓ | ✓ | $29 | $24 |
| `business_os_only` (rank 3) | Business OS | monitor (no hosting) | ✓ | ✓ | $29 | $24 |

Existing rungs unchanged in content; ranks renumbered to keep them **unique, ascending, and in the same relative order** (monitor 1 · cms 2 · business_os 3 · presence/Studio 4 · managed 5 · agency 6 · enterprise 7).

**Billing verification:** founder + standard, monthly + annual (two-months-free), and trials all compute from the catalog via `priceCents`/`displayPrice`/`trialEntitlementPatch` — the new rungs inherit them for free. Discounts/promos remain a catalog/Stripe-coupon concern (unchanged).

---

## Step 4–6 — Purchase / licensing / Stripe (verified)

- **New purchase / trial / founder signup:** `POST /commerce/signup` → account → trial-provision *or* Checkout; the new rungs flow through unchanged (dynamic `price_data`).
- **Provisioning:** `editionFor('cms_only')='presence'` → hosted site; `editionFor('business_os_only')='monitor'` → no hosting (intelligence only). The entitlement stores `plan`; `/portal/context` derives the feature edition → nav adapts.
- **Upgrade / downgrade / edition change:** `changeKind` by rank; self-serve upgrades instant+prorated, downgrades at renewal; **no data loss** (Phase D `featureDelta` — capabilities move, data stays).
- **Cancellation / reactivation:** unchanged webhook status mapping (canceled→lapsed, past_due→grace, paused→readonly, reactivate→active).
- **Stripe:** products/prices are created inline per checkout from the catalog (so the two rungs need no dashboard setup); subscriptions/webhooks/portal/invoices/proration/trials all operate on the subscription generically. Live billing-sync + webhook paths verified by the commerce integration suite.

---

## Step 7 — Customer experience

- **CMS buyer:** sees "CMS — a website that stays correct," $29 (founder $24), trial available → buys → a complete website product (Phase D nav: Website/Create/Clients/Settings, no empty Business-OS menus).
- **Business-OS buyer:** sees "Business OS — know your business at a glance," $29 → buys → moments/connections/relationship, no empty website menus, no hosting to worry about.
- **Studio OS/Managed/Agency/Enterprise:** unchanged, now clearly the "both / done-for-you / many-clients / governed" steps above the two entry editions.

The buyer understands what they bought (the edition name + calm features), what they got (nav is exactly their edition), and how to move (upgrade adds; downgrade preserves). Premium, not confusing.

---

## Commercial Activation Guide (operational)

- **Add/adjust a rung:** edit `PLANS` in `commerce/catalog.ts` (the one place). Prices, trials, founder rates, self-serve, and site edition all live there; everything downstream follows. If a rung introduces a new `plan` value, widen the `presence_entitlements.plan` CHECK (as 0049 did).
- **Founder pricing:** `FOUNDERS_OPEN` gates the cohort; the locked rate is stamped on the entitlement at signup and persists if the cohort closes.
- **Subscriptions/billing:** self-serve customers manage everything (cancel, change, payment method) via `POST /commerce/portal` (Stripe billing portal). No bespoke billing UI to maintain.
- **Licensing:** the `plan` on the entitlement is the license; `editionFromPlan` turns it into features; nav/gates follow. Change the plan → nav updates on next `/portal/context`.
- **Upgrade/Downgrade:** `changeKind` + `featureDelta` — the former for allow/proration, the latter for the honest gained/lost preview (data always preserved).

---

## Testing

- `commerce_test.mjs` updated to the **7-rung ladder** (keys, ranks 1..7, self-serve/trial/price/edition for the two new rungs) — pure **38/38**; live staging **13/13** (incl. `/commerce/plans` lists 7, checkout, provisioning, webhook status mapping).
- `editions` 34/34, `shell` 18/18, `platform_invariants` **14/14**, `deno check` clean (fixed the `CAPACITY` map to cover the new rungs).
- Migration 0049 applied staging+prod (hold-back); both `/commerce/plans` now return 7 rungs including `cms_only` + `business_os_only`.
- **Unchanged & verified:** the entitlement security gate, permissions, visibility, tenant isolation, approval-first, publishing/preview/rollback/restore.

---

## Feature discovery (documented, not built)

- **FD-D2 · Self-serve upgrade/downgrade UI** — a plan-change screen driven by `featureDelta`/`changeKind` (preview gained/lost, proration). *V1.1.*
- **FD-D1b · Annual founder pricing surfacing** — ensure the pricing page shows annual founder math for the two new rungs (backend computes it; the public page renders dynamically). *V1 · verify at pricing-page QA.*
- **FD-D4 · Coupons / promotional codes** — wire Stripe promotion codes into Checkout for future promos. *V1.1.*
- **Rejected:** a second commerce system; per-edition Stripe Price-ID config (unnecessary given dynamic `price_data`).

---

## Final Questions (answered honestly)

- **Can every edition now be purchased?** **Yes for the self-serve six** — Monitor, CMS, Business OS, Studio OS, Managed via Checkout; Agency/Enterprise are intentionally "talk to us" (constitution §3.10/§3.11), which is *by design*, not a gap.
- **Can every edition be licensed?** **Yes** — the `plan` on the entitlement (CHECK now accepts all seven) → feature edition → nav/gates.
- **Can every edition be upgraded / downgraded?** **Yes** — `changeKind`/`featureDelta`; upgrades instant+prorated, downgrades at renewal, data preserved.
- **Can customers manage subscriptions?** **Yes** — the Stripe billing portal (`/commerce/portal`): cancel, change plan, update payment.
- **Does billing feel complete?** **Yes** — founder/standard, monthly/annual, trials, proration, portal — all through one architecture.
- **Anything missing?** Two honest, non-blocking notes: (1) Agency/Enterprise remain sales-assisted by design (not self-serve checkout); (2) the *public pricing page* renders from `/commerce/plans`, so it now shows seven — a human pricing-page QA pass (copy/layout for two more cards) is the one non-engineering step. Neither is an activation gap.

Every packaged edition that is meant to be self-serve is now sellable, licensable, upgradable, downgradable, and manageable through the existing commerce architecture.

---

**Phase D1 — Commercial Packaging Activation complete.**
