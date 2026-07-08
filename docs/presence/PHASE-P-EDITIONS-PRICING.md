# Phase P — Editions, Entitlements, Pricing & Upgrade Experience

*Every edition, entitlement, limit, price, and upgrade path audited (all verified against `commerce/editions.ts` / `catalog.ts` / `capacity.ts` — locked by editions 36/36 + the new pricing_experience 14/14). Implemented: the support-tier matrix (owner addendum — service tiers as data so software and service can never drift), the honest upsell in `/portal/context` + a quiet "Your plan" card, and `nextPlanUp` (with a real flaw caught & fixed by its own test). Consolidates the Edition / Entitlement / Upgrade / Pricing / Bundle / Commercial-Positioning reports.*

---

## Executive summary

The edition **machinery** was already excellent (editions-as-data, `featureDelta` never loses data, upgrades immediate / downgrades cycle-end, capacity per plan) — what was missing was the **experience**: a customer could not see what they owned, what the next rung adds, or what service comes with each package; locked features were simply *hidden* (against this milestone's own rule). This phase closed those: **(1)** `/portal/context` now returns `plan_key` + an **honest upsell** (the next self-serve rung + its *real* gains computed from `featureDelta` — it can never overpromise; owners only, never reviewers/operators, null at the top); **(2)** Today shows a quiet **"Your plan"** card — what you own, what the next rung adds, from-price, and a calm "ask about upgrading" action (no dead end); **(3)** the **support-tier matrix** (`commerce/support.ts`) defines onboarding / support response / AI usage / implementation / training / maintenance for **every plan** and ships inside `/commerce/plans` — the "buying software vs hiring the studio" difference is now explicit data, live-verified in prod. Bonus: the upsell test **caught a real flaw** — rank-based upsell would have pitched the *lateral* $29 rung to a $29 customer; fixed to require strictly-greater price. Pricing itself audited sound; the public pricing *page* remains Phase H.

## Edition & entitlement audit (verified)

| Rung | Plan (mo/founder) | Edition | Includes / excludes (verified in MATRIX; locked by editions_test 36/36) |
|---|---|---|---|
| 1 | Monitor $19/$15 | monitor | website-view + Business OS intelligence over your EXISTING site; no CMS drafting, no forms/developer |
| 2 | CMS $29/$24 | presence(cms_only) | full website+publishing+AI drafting; no Business OS intelligence |
| 3 | Business OS $29/$24 | monitor(bos) | Moments/Concierge/CRM; no hosted website |
| 4 | **Presence $49/$39** | full | everything self-serve: site+BOS+CRM+connected+AI+Visual+forms+scheduling+developer |
| 5 | Managed $149/$119 | full + service | same software; the studio drives it (the support tier IS the delta) |
| 6–7 | Agency / Enterprise (contact) | + orchestration | white-label, roles, portfolio / org→region→location inheritance |

Entitlements verified end-to-end: plan → `editionFromPlan` → nav/capabilities (`buildNav`, guard-tested); capacity (AI allowances + drafting flags) per plan; trials on ranks 1–4; founder locks live on the entitlement. **Limits review:** calm by design — capacity notices are sentences, never meters (Law 13); nothing punitive found; the AI capacity ladder is the natural upgrade pressure and it's honest.

## Locked-feature & upgrade experience (Step 2/5)

Before: locked = hidden (a CMS customer never learns Moments exist). Now: the **upsell surface** names the next rung and its true gains right on Today, and `/commerce/plans` carries the full capability + service story for every rung. Full **in-nav locked-teaser rows** (grayed items with "included in Presence →") = **FD-P2 (V1.1)** — do after the Phase-H pricing page exists as a link target. **Self-serve plan *change*** (the catalog's `planChange` policy has no route yet; founder-era changes are studio-handled — appropriate) = **FD-P1 (V1.1)**. Upgrades preserve all data by construction (`featureDelta` hides, never deletes — already tested).

## Pricing / bundles / positioning (Step 4)

The ladder reads clean: $19 watch → $29 build (site OR intelligence) → $49 both (the anchor; obviously the best value) → $149 done-for-you → contact for scale. Every rung has a distinct purpose; the two $29 rungs are deliberately lateral shapes, not steps (and the upsell logic now respects that). **Merge/split verdict: none** — keep 7. Separately-sold services (design/rebuild/setup/branding) live on the agency side; with the support matrix, the software↔service boundary is now explicit — the alignment story for the Phase-H pricing page is written for it. Annual = 2 months free (existing); founder locks honored for life of subscription. **The real commercial risk remains Phase H** (no public pricing page for 7 rungs) — unchanged, tracked.

## Final questions (honest)

- **Does every edition feel complete / purposeful?** Yes — verified per-rung; each is a whole product for its buyer (Phase D's "every edition complete" held up under audit).
- **Would customers understand the differences & naturally upgrade?** Now yes in-product (plan card + honest gains + service tiers); *pre-purchase* clarity still needs the Phase-H page — that's the gap that remains, and it's copy/design, not architecture.
- **Are any limits frustrating?** No — sentence-based capacity, generous trials, nothing punitive. The Monitor's no-drafting limit is honest and clearly explained in its support tier.
- **Merge/split packages?** No.
- **Is pricing easy to understand?** The data is; the page isn't built (Phase H). Founder pricing pressure-test before cohort lock remains flagged.

**Queue:** FD-P1 self-serve plan change (V1.1) · FD-P2 in-nav locked teasers (V1.1, after Phase H). **Tests:** pricing_experience 14/14 (incl. the lateral-rung fix) + editions 36/36 + full sweep + invariants 14/14; deployed both envs; `/commerce/plans` live-verified carrying support tiers.

**Phase P — Editions, Entitlements, Pricing & Upgrade Experience complete.**
