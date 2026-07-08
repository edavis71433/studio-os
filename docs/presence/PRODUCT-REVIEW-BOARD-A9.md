# Phase A9 — Product Review Board & Version 1 Feature Validation

*Independent product/business review — brutally honest, no implementation (nothing is functionally broken). Decides whether Version 1 is ready to become the permanent baseline, and triages the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md). No changes to Product Laws, Constitution, architecture, permissions, visibility, or the A7.5 IA.*

---

## Executive Summary

**The verdict splits cleanly: the *architecture* is ready to be the permanent baseline; the *product* is feature-complete at the engine level but has real market-readiness gaps that are product features, not architectural flaws.**

What's genuinely strong — and rare — is the combination no competitor has: **structured content + a calm daily-intelligence surface + read-only, approval-gated connected data + a real studio behind the software + true ownership (no lock-in, no metered fees)**. Versioning/restore is competitive with AEM; the permission/visibility/agency model is sound; privacy and approval posture are excellent.

What's brutally honest: **a cold small-business customer cannot currently discover, understand, or buy the product** (the public site sells the *studio*, not Presence), **there is no guided onboarding**, and two table-stakes SMB capabilities are missing — **scheduled publish** and **lead-capture/forms**. None of these is an architecture problem; all are queued. Enterprise buyers would additionally hesitate without SSO/SOC 2/formal SLA. And nothing is live yet (activation-gated + the go-live gate) — so "would you buy it tomorrow" is partly unanswerable until the owner turns it on.

**Recommendation: ratify Version 1 as the permanent architectural baseline. Prioritize, as the first post-baseline product work: the front door (positioning), guided onboarding, scheduled publish, and lead capture — all already on the roadmap or the discovery queue.**

---

## Customer Review (would they understand product / value / next step?)

| Customer | Understand product? | Understand value? | Know next step? | Honest read |
|---|---|---|---|---|
| **Freelancer** | ✅ (if shown) | ✅ strong | ⚠️ | Compelling — multi-client + client portal + white-label + approval loop. Thin onboarding + basic agency UI. |
| **Agency** | ✅ | ✅ strong | ⚠️ | Best-fit buyer. Wants a richer agency console + faster client setup. |
| **Small business owner** | ❌ **can't find it** | ✅ (the calm daily aha) | ❌ | The value is real *if they get in* — but no front door, no guided onboarding, no lead capture. |
| **Growing business** | ⚠️ | ✅ | ⚠️ | Gaps show: scheduled publish, forms, deeper reports. |
| **Enterprise buyer** | ⚠️ | ⚠️ | ❌ | Backend supports multi-location, but **no SSO/SAML, no SOC 2, no self-serve enterprise console, no formal SLA** → would hesitate. |
| **CMS-only customer** | ❌ | — | ❌ | **That edition doesn't exist yet** (Packaging E1). Can't buy just-CMS. |
| **Business-OS-only customer** | ❌ | — | ❌ | Same — not a purchasable edition yet. |
| **Studio OS / Managed customer** | ✅ | ✅ | ✅ | The done-for-you path is the clearest story; the studio operates it. |
| **Developer** | ❌ | ⚠️ | ❌ | Developer Mode doesn't exist; only build-time templates + the SDK. A dev wanting in-app code can't yet. |

**Bottom line:** the product is *clear and valuable to the studio/agency buyer*, and *valuable-but-undiscoverable* to the end small business. Enterprise and developer audiences are early.

## Feature Review

Every shipped feature solves a real problem and — critically — **nothing feels bloated at the engine level**. The intelligence pipeline, creative studio, publishing, connected platform, and visual studio each earn their place. Discoverability is the recurring weakness (calm/hidden by design, but a cold user misses capability) — which is exactly why onboarding matters. **No feature duplicates another** except the `today.html`/`presence.html` daily-view overlap (merge candidate). **Nothing should be removed** — the engine is lean.

## Workflow Review

Website creation ✅ · business setup ✅ (no *guided* setup ⚠️) · publishing ✅ (versioned/restore; no *scheduled* publish ⚠️) · connected ✅ · AI ✅ (approval-gated) · CRM ✅ (light, by design) · media ✅ · knowledge ✅ · reports ✅ (calm; no dashboard by design) · approvals ✅ (the moat; but the *notify* handoff isn't a loop ⚠️) · developer ❌ (future) · agency ✅ (basic UI) · enterprise ⚠️ (API/operator, no buyer console) · support ⚠️ (no help center) · billing/upgrade/downgrade ✅ · export ✅ · deletion ✅ self-serve per-item, ⚠️ account erasure operator-assisted · recovery ✅ (versioned + PITR). **Complete workflows exist; the friction points are onboarding, scheduled publish, the approval-notify loop, and lead capture.**

## Business Review

- **Pricing/packaging:** a clear ladder (watch → run-it → we-run-it) is the right model, and the founder rate-lock + "no metered fees, ever" + ownership are strong trust signals. But **CMS-Only/Business-OS-Only aren't purchasable yet**, and the public site doesn't route to pricing. **Does the product justify its price?** For the studio/managed customer: **yes** (a studio-run presence for a monthly fee is compelling). For a DIY solo SMB comparing to Wix/Squarespace: **only if they value "a studio has my back"** over "I'll do it myself cheaper."
- **Trust/privacy/security/legal:** genuinely strong — ownership, approval, no lock-in, the privacy audit, the legal draft set. The gaps are enterprise-grade proof (SOC 2, SSO, SLA) and the *published* legal docs (drafts await owner fill + counsel).
- **Onboarding/support/docs:** engineering docs are excellent; **customer onboarding and a help center are the gaps.**

## Competitive Operational Review (what a switcher would expect)

Not "copy features" — "what would a migrant *expect operationally* that's missing?"

| Coming from | Would expect (and may not find) → queued |
|---|---|
| **AEM** | Scheduled publish/activation (FD-1); version compare (FD-12) — *(has version/restore ✅)* |
| **Webflow** | Scheduled publish (FD-1); forms/lead capture (FD-2); a global editor search (FD-8) |
| **WordPress** | Forms/plugins ecosystem (forms → FD-2; plugins = deliberately excluded); scheduled posts (FD-1) |
| **Shopify** | Lead/order capture + notifications (FD-2/FD-3) — *(commerce is Stripe-billing, not e-commerce; note the scope difference)* |
| **HubSpot** | CRM depth + forms + sequences (forms FD-2; CRM depth = roadmap D1); reporting (calm-report tension) |
| **HighLevel** | Client-facing dashboards + notifications + snapshots/templates (client setup templates FD-18; digest FD-5) |
| **Wix Studio / Duda** | Client hand-off + white-label + scheduled publish (white-label ✅; FD-1) |
| **Notion** | Universal search + command palette + comments (search/palette FD-8; comments FD-19) |

Everything a switcher would reasonably expect is now captured in the queue — none built.

## Feature Discovery Decisions (triage: Approve-future / Merge / Defer / Reject)

| # | Candidate | Decision | Why |
|---|---|---|---|
| FD-1 | Scheduled publish / unpublish | **Approve (high)** | Table-stakes everywhere; real SMB value; fits the snapshot model |
| FD-2 | Lead capture / forms | **Approve (high)** | The biggest "it can't do that?" gap for the target customer |
| FD-3 | Approval → notify → approve loop | **Approve (high)** | Turns the moat into a delight; highest relationship value |
| FD-4 | Monitoring / alerting (+ **Operator Digest**) | **Approve (high)** | Operational necessity; merge Operator Digest here |
| FD-5 | Weekly Client Digest | **Approve** | Cheap, high trust; part of a **notifications** system with FD-3 |
| FD-6 | Shareable preview links | **Approve** | Closes the client-review loop |
| FD-7 | Named draft snapshots | **Approve** | Cheap; snapshot machinery exists |
| FD-8 | Global top-bar (**+ Universal Search, Command Palette, workspace/role switcher FD-13, notifications**) | **Approve (merge)** | One "global chrome" initiative, not five features |
| FD-9 | Operator console (**+ Internal Support Console, Audit Center**) | **Defer (merge)** | Valuable but not blocking; one console initiative |
| FD-10 | Uptime / broken-link watch | **Defer** | Extends Monitor; nice-to-have |
| FD-11 | Agency-managed per-client sharing | **Approve** | Real agency need |
| FD-12 | Version compare / diff | **Defer** | Nicety; data exists |
| FD-14 | Task / reminder surface | **Reject (watch)** | Scope creep vs the calm ethos; the Coach is adjacent |
| FD-15 | Design-token consolidation | **Approve** | Foundation for desktop/mobile/website work |
| FD-16 | Typeface unification | **Defer** | Low; cosmetic |
| FD-17 | Portal naming | **Defer** | Trivial; defensible as-is |
| **FD-18** | **Client Setup Templates** (clone a client setup) | **Approve** | Compounds agency onboarding speed (HighLevel "snapshots") |
| **FD-19** | **Shared Comments** on shared items | **Approve** | Keeps client feedback in one place; pairs with the portal |
| **FD-20** | **Brand Asset Library** | **Approve (future)** | Natural extension of brand profile + media + Visual Studio |
| — | Business Reports (dashboards) | **Reject/Defer** | Tension with Law 13 (no dashboards/scores) — only as calm, sentence-based reports |
| — | Activity Timeline | **Defer (merge)** | The change/audit ledger exists; surfacing it is low-priority |
| — | Workspace Personalization | **Reject** | Complexity vs calm; not needed |
| — | Customer Success Center | **Defer (merge into Help/KB)** | Belongs with the help center |

**The "if we build three things next" set:** FD-1 (scheduled publish), FD-2 (lead capture), FD-3 (notify-to-approve). Plus the non-feature launch prerequisites: the **front door** (positioning) and **guided onboarding**.

## Product Simplicity Review

Does every feature earn its place? **At the engine level, yes — it's lean and calm.** The only "is this too much?" question is the advanced tiers (Marketplace/Enterprise/Agency) relative to the SMB core — but they're additive, dormant for customers who don't need them, and serve real agency/enterprise buyers, so they earn their place *for those audiences* without cluttering the SMB experience (hidden by entitlement). **The product still feels calm and premium.** One merge: `today.html`/`presence.html`. Nothing to remove.

## Risk Register (commercial)

| # | Risk | Severity | Note |
|---|---|---|---|
| C-1 | Customer never meets the product (no front door) | **High** | Positioning track; the #1 commercial risk |
| C-2 | No guided onboarding | High | First impression; roadmap F2 |
| C-3 | No scheduled publish / no lead capture | High | Table-stakes; FD-1/FD-2 |
| C-4 | Enterprise: no SSO/SOC 2/SLA | Medium | Blocks enterprise buyers; fine for SMB/agency V1 |
| C-5 | Nothing live yet (activation + go-live gate) | Medium | Owner activation, by design |
| C-6 | Legal drafts unpublished (owner fill + counsel) | Medium | Documented |
| C-7 | Agency UI + onboarding are basic | Medium | FD-8/FD-18 |

None is an architectural flaw. All are product/market or activation items.

## Recommendations

1. **Ratify V1 as the permanent architectural baseline** — the two spines, frozen contracts, invariants, and the permission/visibility/IA are sound and extensible.
2. **Sequence the market-readiness work** (post-baseline, owner-directed): front door → guided onboarding → scheduled publish (FD-1) → lead capture (FD-2) → notify-to-approve (FD-3).
3. **Hold the line on calm/ownership** — reject dashboards/personalization/plugins that erode the differentiator.
4. **Enterprise later** — SSO/SOC 2/SLA when an enterprise deal is real, not speculatively.

---

## Final Questions (answered brutally honestly)

- **If V1 launched tomorrow, would you buy it?** As a **studio/agency**: yes — it's a genuine operating system for running client presences. As a **cold solo SMB**: you couldn't (no front door, not activated) — and even if you could, you'd want onboarding + lead capture first.
- **Would you recommend it?** For the **studio/agency/managed** use case, yes, confidently. For **DIY self-serve SMB**, not until the front door + onboarding + forms land.
- **Would you trust it with your business?** **Yes** on the fundamentals — ownership, approval-gating, no lock-in, versioned recovery, privacy. That trust posture is the strongest part of the product.
- **Would you choose it over competitors for its intended audience?** For **"a small business served by a studio," yes** — nothing else combines calm intelligence + a real studio + no lock-in. For **DIY vs Wix/Squarespace**, it wins on care, loses on "I'll just do it myself cheaper" — which is why the studio-led positioning is the right wedge.
- **Anything you'd regret not building?** **Scheduled publish and lead capture** (table-stakes), and the **front door + guided onboarding** (or no one buys). Those are the regrets.
- **Anything you'd remove?** No. Consolidate `today`/`presence`; otherwise the engine is lean.
- **Is V1 feature-complete?** **At the engine/core-product level, yes.** For *market* completeness, the front door + onboarding + FD-1/FD-2 are the honest gaps — features, not architecture.
- **Is V1 ready to become the permanent architectural baseline?** **Yes.** The architecture is proven, extensible, contract-frozen, and invariant-guarded; every gap identified is a product/market feature or activation item that builds *on* the baseline, not a change *to* it.

## Declaration

**Phase A9 — Product Review Board complete.**

*Verdict: ratify Version 1 as the permanent architectural baseline. The engine is lean, calm, premium, and trustworthy; the real gaps (front door, onboarding, scheduled publish, lead capture, enterprise proof) are product/market features, all triaged into the Feature Discovery Queue — none built, none silently added. No critical functional flaw found; no changes to laws, constitution, architecture, permissions, visibility, or the A7.5 IA. Committed, not pushed.*
