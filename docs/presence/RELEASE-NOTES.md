# Release Notes & Version History — Studio OS Presence

## Version 1.0 — Release Notes

**Status:** feature-frozen, QA-passed ([QA-RELEASE-VERIFICATION](QA-RELEASE-VERIFICATION.md)), deployed to staging + prod. Frontend committed, **not pushed** (go-live gate).

**What V1 is:** a calm SaaS that keeps a small business's presence correct, found, and growing. Customer-complete workflows: buy/sign-in, CMS/structured content, Creative Studio (Writer/Editor/Reviewer/Brand Guardian), the daily Business-Moments surface, Growth Coach, Concierge, media upload, **AI Visual Studio**, **Connected Platform (connect a service)**, and Publishing (versioned, restorable). Plus Presence Monitor (watch an existing site) and the operator/advanced tiers (Industry Packs, Marketplace, Enterprise, Agency, Platform Services).

**Headline capabilities delivered in V1:** the frozen two-spine architecture (Intelligence Pipeline + Approved-Plan Lifecycle); the four Industry Packs on one contract with zero engine forks; the Connected Platform (read + approval-gated writes); Enterprise multi-location by inheritance; Agency orchestration with composed permissions; and the AI Visual Studio — all as data/composition over the spines, with the **14 platform invariants held throughout**.

**Quality:** 44 test suites (pure + live-staging integration) green; two issues found and fixed during deep QA (a pack-provider classification bug; a flaky test). Verdict: **Passed with Minor Issues** (residual items are human-only: live-browser QA + owner activation).

---

## Version History (milestone lineage)

- **M1–M8.5** — Structured-content foundation, the deterministic renderer, publishing (versioned/restore), media, the Client Room. *(Deep narrative: `ENGINEERING-ATLAS.md`.)*
- **M9 / M9.5A–G** — Presence Intelligence: the Evidence → Judgment → Recommendation → Business Moments → Concierge pipeline; Creative Studio (Writer/Editor/Reviewer/Brand Guardian); consolidation & architecture reviews.
- **L1 / L1.5** — Commerce: signup, Stripe checkout, subscriptions, entitlements, commercial validation.
- **L2** — Operations: capacity, metering, the unattended cycle, plan enforcement.
- **L3 / L3.1–L3.4** — Optimization Engine + optimization judgment/recommendation/concierge intelligence + validation.
- **M10–M11** — Knowledge import; Presence Monitor edition (observe an existing site).
- **M12 / Platform Services** — Infrastructure Change Plans (DNS/email), the platform control plane.
- **L4.0–L4.6** — Connected Platform: registry, read engine, intelligence, write-capable adapters, validation/hardening (signed OAuth state, atomic claim), the shared Approved-Plan spine, and the **contract freeze** (14 invariants).
- **L5.0–L5.7** — Industry Platform (contract + 4 packs + SDK), Marketplace, Enterprise (multi-location), Agency orchestration.
- **L5.8 / Launch Track 1–2.5** — Launch readiness + product-surface implementation (`today.html`, the OAuth callback page) + positioning strategy.
- **L5.9** — Connected Platform **customer UI** (`connections.html`).
- **AI Visual Studio** — brand-aware image generation with approval-before-use (`visual/` + `visual-studio.html`, migration 0044).
- **Product Freeze → Deep QA → Documentation Freeze** — feature freeze, verification, and this documentation set.

---

## Technical Debt Register

Honest inventory. **None is a V1 correctness blocker.**

| Item | Impact | Disposition |
|---|---|---|
| Baseline `deno check` type errors (`rollback` on `OrgPlan`/`MarketplacePlan`; a marketplace_ops comparison) | Pre-existing, in enterprise/marketplace types; edge runtime doesn't type-check and suites are green | V1.1 cleanup (cosmetic) |
| `ENGINEERING-ATLAS.md` / `API-INVENTORY-v1-FROZEN.md` deep depth stops at M8.5/M5 | Superseded by the current [V1 System Reference](V1-SYSTEM-REFERENCE.md) / [API Reference](API-REFERENCE.md) | Historical; keep for provenance |
| `connected_data` cache is one-deep (`+prev`) | No trend/time-series features | V1.1 (unlocks trends) |
| Pack intelligence intentionally shallow (restaurant/coffee_shop) | Fewer industry-specific moments | V1.1 depth |
| 3 connected providers are label-only stubs (Apple, Tag Manager, Meta) | Those read no numbers yet | V1.1 (additive) |
| Baseline `email_templates` permissive RLS policy | Not referenced by any Presence code | V1.1 security tidy (verify/tighten) |
| Visual "edit" = instruction-guided regeneration | No pixel-level inpainting | V1.1 (needs a capable model) |
| No CI harness for the live security/accessibility/load passes | Those passes are manual/pre-launch | V1.1 tooling |

---

## Version 1.1 Backlog (intentionally deferred — not bugs)

- **Marketplace / Enterprise / Agency customer & operator UIs** (backends complete) + the operator/agency auth path.
- **Pixel-level image editing (inpainting)** in Visual Studio.
- **Additional Industry Packs** (home-services trades, then dental/medical/legal/retail) — additive via the SDK.
- **Broader connected coverage** — the 3 placeholder providers + write workflows beyond GBP/GSC.
- **Deeper pack intelligence** and the **`connected_data` time-series**.
- **Automated live security / accessibility / load** test harnesses in CI.
- **Baseline type-error and `email_templates` policy** cleanup.
- **Public-site / positioning** work (a separate track: homepage, nav, the Monitor demo, SEO-page consolidation).

---

## Owner Activation Checklist

*Config that turns complete features live — not build work.*

- [ ] **Register provider OAuth apps** (+ `CONNECTED_<KEY>_CLIENT_ID/_SECRET`, `GOOGLE_CLIENT_ID/_SECRET`) → live Connected Platform connections.
- [ ] **Set `CONNECTION_ENC_KEY`** (44-char base64) → connections can store tokens (fail-closed until set).
- [ ] **Set `ANTHROPIC_KEY`** → AI drafting in the Creative Studio (manual parity means the app works without it).
- [ ] **Set `VISUAL_MODEL_KEY`** (+ optional `VISUAL_MODEL_URL/_NAME`) → live AI Visual Studio generation.
- [ ] **Configure Stripe** (`STRIPE_SECRET` LIVE, `SITE_URL`, webhook + `BILLING_SYNC_SECRET`) and **confirm prices + subscription events** → live billing.
- [ ] **Set `NETLIFY_AUTH_TOKEN`** and **push the held commits** (the go-live gate) → the customer pages go live.

## Production Activation Checklist

*Do these in order, with a smoke test each.*

1. Confirm the [Production readiness checklist](DEPLOYMENT-AND-OPERATIONS.md#production-readiness-checklist) (deploy verified, migrations applied, invariants green, PITR verified).
2. Set required secrets on prod; verify `GET /system/health`.
3. Turn on each feature by setting its activation key, then smoke-test it:
   - Stripe → a test checkout completes and provisions a site.
   - Connected → connect one provider end-to-end (OAuth round-trip).
   - Visual → generate → approve → appears in the media library.
   - AI → a Writer draft returns options (fact-guarded).
4. **Live-browser QA** the signed-in customer pages (today / connections / visual-studio / portal) — the one step no automated suite covers.
5. Clear the go-live gate (prices, Stripe events, nav) and **push** the frontend.
6. Confirm the unattended cycle runs (cron installed with `SCHEDULER_SECRET`).

---

*Living-reference cross-links: [README index](README.md) · [V1 System Reference](V1-SYSTEM-REFERENCE.md) · [Deployment & Operations](DEPLOYMENT-AND-OPERATIONS.md) · [QA](QA-RELEASE-VERIFICATION.md).*
