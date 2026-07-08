# Studio OS — Master Roadmap (Reconciled)

*Reconciles the attached **Studio OS Master Roadmap (Current)** with the actual completion state and the suggestions from the operational review. Additions are marked **➕ ADDED**, overlaps with already-completed work **⚠️ REDUNDANT**, and items needing scoping **🔍 EXPAND**. The intent is one honest source that doesn't imply re-doing finished work.*

> **Reality check up front:** engineering is effectively complete and green, but **nothing is live to a customer yet** — the edge function is deployed to staging + prod, but every frontend page is **committed-not-pushed** behind the go-live gate, and owner activation (keys/cron) isn't done. So "98% of the V1 roadmap" is true for *engineering*; the remaining ~2% (activation, human QA, front door, the push itself) is what stands between "built" and "a customer can pay for and use it." Treat that last mile as the real work, not a rounding error.

---

## 🔴 Deepest gap found (challenge review) — the product can only publish a *restaurant* site

*Surfaced by going into the render/template/industry files. This is the single biggest competitive gap and it was hiding behind "templates: parity, SDK-authored."*

**The facts (verified in code):**
- **One template exists** — `restaurant-classic` 1.0.0 is the only entry in the render registry. `presence_sites.template_slug` **defaults to `'restaurant-classic'`** for every new site.
- That template **hardcodes restaurant framing**: the nav is a fixed `/menu/ "Menu"`, the offerings page is `<h1>Menu</h1>`, and the **structured data emits `@type: Restaurant / Menu / MenuSection / MenuItem` for every published site.**
- The **industry packs (4: restaurant, coffee_shop, home_services, pet_grooming) are guidance-only** — they contribute judgment/recommendation/moment/coach rules and *declare* the right navigation/pages ("Services", "Service Areas", …) that the contract says "a template can realize" — **but no template realizes any of them.** The restaurant template ignores the pack's declared nav/pages.

**The consequence:** the *intelligence* is multi-industry (a plumber gets plumber-appropriate Moments and coaching), but the **website a non-restaurant customer actually publishes is a restaurant site that says "Menu" and is marked up as a restaurant** — wrong for their brand and actively wrong for SEO (`@type: Restaurant/Menu` on a plumber's page).

**Why it matters vs competitors:** Squarespace/Wix/Webflow/Shopify each ship *hundreds* of industry templates. Studio OS ships **one**, restaurant-shaped. Every website competitor beats this on day one for any non-restaurant customer.

**The strategic question for the owner (this changes the launch definition):**
- **If V1's market is "restaurants served by a studio"** → one template is fine; multi-industry templates are V1.1. Ship as-is.
- **If V1's market is "small businesses" broadly** (which the editions, industry packs, and Business-OS framing all imply) → **the single restaurant template is a Version 1 blocker for every non-restaurant customer.** They cannot get a correct site.

**Minimum viable fix (recommended even for a restaurant-first launch):**
1. ➕ **A `generic`/`business-classic` template** that reads the industry pack's declared `navigation`/`pages` and emits neutral vocabulary + correct schema (`@type: LocalBusiness` instead of `Restaurant`, "Services"/"Offerings" instead of "Menu"). This alone lets *any* business publish a correct site.
2. ➕ **Point the site's default template at the resolved industry** (the pack already knows the vocabulary; the site just needs to pick a template that realizes it).
3. ➕ **A handful of vertical templates** (home services, salon/beauty, professional services, retail) authored via the existing SDK — the architecture is genuinely ready; it's authoring work, not new plumbing.

**Add to roadmap as → Phase T — Template Library & Industry Realization** (the highest-value pre-broad-launch build; gate its V1-vs-V1.1 status on the market-scope answer above).

---

## Completed (verified, committed — NOT yet pushed)

Foundation & Core Architecture · Security, Multi-tenancy & Permissions · CMS · Business OS · AI Platform · Connected Platform · Commerce & Billing Foundation · CRM / Relationship Center · Developer Mode (+ render integration) · Unified Workspace Shell · Client Portal · Agency & Enterprise Foundations · Packaging & Editions · Commercial Activation · Product Integrity Verification · Commercial Readiness · Site Operations & Feature Optimization · Market Validation & Operational Excellence.

*Every item above is implemented, tested (14 invariants + suites green), and deployed to staging + prod for the function — but the static frontend is behind the go-live gate (unpushed).*

---

## Remaining Roadmap (reconciled)

### Phase J — Owner Activation  ·  ✅ ROUND 2 COMPLETE — capabilities 9/10 TRUE, CRON LIVE; 6 dashboard items remain (see PHASE-J2-ACTIVATION-REPORT)
Stripe production · OAuth providers · **Resend (email)** · **Cron on `/system/run`** · Secrets (**`APPROVAL_SECRET`**) · Monitoring + alerting · **PITR backups + a real restore drill** · Production activation.
- ✅ **Engineering delivered:** every dependency degrades gracefully / fails-closed; `/system/health` is now a live **activation dashboard** (grouped secrets + a "what's live" capability map), locked by `activation_test` (10/10); the Owner Activation Guide + checklist ship. Deployed staging+prod.
- 🔴 **Owner-action blockers (I cannot do these):** enter live Stripe/Resend/Netlify/`APPROVAL_SECRET`/Google-OAuth secrets · schedule cron to hit `/system/run` · confirm PITR + a restore drill · **the go-live push** (frontend unpushed). Verify each via `GET /system/health?secret=…` → `capabilities`.
- See [OWNER-ACTIVATION-GUIDE](OWNER-ACTIVATION-GUIDE.md) + [PHASE-J-OWNER-ACTIVATION](PHASE-J-OWNER-ACTIVATION.md).

### Phase K — Gold Master QA  ·  *the biggest quality unknown right now*
Human browser testing · Cross-browser · Mobile · Accessibility · Regression · Performance · Production readiness sign-off.
- ➕ **Scope it explicitly to the pages built without a browser this session:** shell, `today`, `presence`, `crm`, `leads`, `schedule`, `developer`, `approve`, `help`, `client`, `agency`, `sharing`. All are parse-checked and their pure logic is tested, but none has been *seen rendering*, on mobile, or with a screen reader. This is where visual/interaction bugs hide.
- ➕ **Include the two new commercial screens end-to-end** (`schedule.html`, `leads.html`) — the FD-F1 backends are tested, the screens are not browser-verified.

### Phase H — Website & Public Experience (the "front door")  ·  *#1 commercial risk (A9 C-1)*
Website audit + messaging refresh · Interactive product tour · "Why Studio OS" workflow comparisons · ROI calculator · Trust Center · Edition comparison matrix · Real workflow library · Developer landing page · Accessibility Center · SEO/a11y/conversion · Public changelog (V1.1) · Public roadmap (V1.1).
- ➕ **Add the pricing-page work for the two new editions** — CMS-Only and Business-OS-Only are sellable in the API/catalog but the public pricing page hasn't been laid out for 7 rungs. Copy/design, not engineering.
- ➕ **Resolve the naming/positioning** (Studio OS vs Presence vs Davis Digital Studio) here — the A9 board called this the #1 commercial risk; the edition-comparison matrix already exists as data (`commerce/editions.ts`) and can drive the public matrix.
- 🔍 **EXPAND / commercial:** pressure-test the $24–$49 founder prices against value before the founder cohort locks rates.

### Phase I — Guided Onboarding  ·  ✅ IMPLEMENTED (get-started.html)
First-run experience · Guided setup · Product education · Customer activation journey.
- ✅ **Built:** `get-started.html` — 2-question intake → the existing `starter_site` writer auto-drafts the whole site (review-first, approval preserved) → review/preview/publish; graceful fallback when AI is off; contextual lessons. Promotes FD-M1. Needs `ANTHROPIC_KEY` (activation) + browser QA. See PHASE-I-GUIDED-ONBOARDING.md.

### Phase G — Native Apps  ·  *sequence AFTER launch, not before*
macOS · Windows · iPhone · Android · feature parity · one-codebase-where-practical.
- 🔍 **EXPAND / sequencing:** launch the web product first, learn from real usage, *then* wrap native. The unified shell already consumes `/portal/context.nav` as data, so native surfaces inherit the IA without re-authoring — but building four apps before a single paying customer is premature. Recommend moving G to *after* N (launch).

### Phase N — Product Completeness & Launch Readiness
Validate every customer journey · Pricing flows · **Demo flows** · **Booking flows** · Forms · Emails · Preview · Launch checklist.
- ➕ **Genuinely new here:** *demo flows* (a way to try without buying) and *booking flows* (FD-F3 — the `booking` form kind exists as capture; real calendar availability is unbuilt). Forms/preview/emails are ✅ done (Phase F) — validate, don't rebuild.
- ➕ **The launch checklist should include "cross the go-live gate (push)"** as an explicit, owner-owned step.

### Phase T — Template Ecosystem & Industry Realization  ·  ⚙️ ARCHITECTURE + PRIMITIVES DONE · neutral-template authoring staged (FD-T1)
*See the 🔴 finding above.* ✅ **Phase T delivered:** the templates-as-data architecture (engine × industry vocab × theme × components) + the tested primitives — `lib/industry_vocab.ts` (correct schema.org + vocabulary for 25+ industries: plumber→Plumber/Services, not Restaurant/Menu), `lib/site_components.ts` (~30 structured blocks as data with fields/schema/a11y), `templateSlugForIndustry` (default-by-industry). 24/24 tests. See [PHASE-T-TEMPLATE-ECOSYSTEM](PHASE-T-TEMPLATE-ECOSYSTEM.md). ✅ **FD-T1 CLOSED (Phase T3):** `business-classic/1.0.0` authored + registered + made the PRODUCTION DEFAULT (migration 0052); industry captured at onboarding and rides in the snapshot; 21/21 multi-industry suite (plumber→Plumber/Services, salon→HairSalon, retail→Store/Products, restaurant→Menu). Every business now publishes a CORRECT site. T4 AEM benchmark: parity-or-better on versions/preview/scheduling/approvals; deltas = Launches (FD-T7)/named versions (FD-7)/reuse (FD-18) — all V1.1. See PHASE-T3-PRODUCTION-TEMPLATES + PHASE-T4-AEM-BENCHMARK.
- **`generic`/`business-classic` template** that realizes the industry pack's declared navigation/pages + emits correct schema (`LocalBusiness`, not `Restaurant`) and neutral vocabulary. Unblocks every non-restaurant customer.
- **Default-template resolution by industry** (pick the template the pack's vocabulary fits).
- **A few vertical templates** (home services, salon/beauty, professional services, retail) via the existing SDK.
- ➕ **An out-of-the-box COMPONENT / block library** (owner request) — a set of ready-made, *configurable* content blocks customers can turn on and fill: hero, gallery, testimonials, FAQ, hours, map/location, services/menu grid, team, pricing/packages, CTA banner, contact/lead form, announcement bar, before/after, reviews. **Constitution-safe:** these are *structured blocks you choose and fill* (fields → deterministic render), NOT a free-form drag-drop page builder — so it stays within the structured-content + determinism + approval-first laws. Each block declares its fields + schema; templates realize them; the SDK is the authoring surface. This is the "easy to build a real site" layer that makes the template library reusable across industries.
- 📋 **T2 audit (authoring capability):** verdict = optimize/realize, don’t build more — the only V1 build is FD-T1; FD-18/FD-B5 (freelancer reuse — verified absent) elevated to top of V1.1; FD-T14 differentiator blocks added; typical-hours one-click implemented. See [PHASE-T2-AUTHORING-AUDIT](PHASE-T2-AUTHORING-AUDIT.md).
- 🔍 **EXPAND / decide:** V1 blocker vs V1.1 depends entirely on the target-market answer (restaurant-first vs small-business-broad). This is the most important product-scope decision left. The component library is what makes non-restaurant sites genuinely good, not just correct.
- ➕ **Launches (FD-T7, owner request):** change the template / stage a redesign in a parallel named version while the live site keeps running + stays hotfixable, then promote at a moment — AEM-Launches/Contentful-Launch/Sanity-Releases class. Bounded one-live-lane + one-launch-lane (general branching stays excluded). First slice: FD-T8 template-switch staged preview. Creatives additions: FD-T9 logo→brand-kit extraction, FD-T10 stock photos, FD-T11 crop/focal, FD-T12 section ordering as data.
- ➕ **Customer-facing Design Studio (FD-T6, owner request):** fonts · colors · sizes for the *business owner* — curated palettes + font pairings + type scale over the EXISTING Phase-B1 theme-token layer (no developer role, no raw CSS; approval-first). Today no customer can change design at all — the tokens are developer-gated, and "Visual Studio" is AI images, not design. Pairs with FD-T3 themes + FD-20 brand assets + FD-B4 fonts.

### Phase U — Customer-Site Capabilities  ·  ➕ ADDED (secondary gaps, likely V1.1)
- **Selling on the customer's own site** — today `offerings` show `price_text` but there's no cart/checkout; a retail or order-taking business can only link out (`ordering_url`/`booking_url`). Intentional "link-out" is defensible for V1; note it explicitly so it's a *decision*, not a surprise. (Shopify/Squarespace Commerce do this natively.)
- **Arbitrary pages / landing pages** — the render emits a fixed set (home/menu/about/contact + blog). No custom pages or campaign landing pages. Webflow/Wix allow any page. V1.1.
- **Real booking with availability (FD-F3)** — the `booking` form kind captures a request; there's no calendar/availability. V1.1.

### Phase V — No-Code Essentials  ·  ✅ IMPLEMENTED (V1 items; V1.1 tier queued)
*Button-level gaps a normal owner hits in their first hour — machinery mostly exists; the control surface does not. See [NO-CODE-GAP-AUDIT](NO-CODE-GAP-AUDIT.md).*
- ✅ **FD-N1 (GM-2) CLOSED** + ✅ FD-N2 logo (header/favicon/OG) + ✅ FD-N3 share-image picker + ✅ FD-N4 announcement bar (with deterministic expiry) + ✅ FD-N5 (device preview — already existed). Migration 0051 + template + endpoint + presence.html controls; deployed staging+prod; room 38/38 + pipeline 30/30 live. See [PHASE-V-NO-CODE-ESSENTIALS](PHASE-V-NO-CODE-ESSENTIALS.md).
- ~~🔴 FD-N1 (was): fix the published contact form~~ (template posts form-encoded name/contact; the capture endpoint parses JSON email/phone → real submissions 400; no honeypot in markup; no thank-you page). Small fix, launch-gating — tracked as **GM-2** on the LAUNCH-BOARD.
- **V1 (small, high-dignity):** FD-N2 **logo upload** → header + real favicon + OG fallback (no logo field exists today) · FD-N3 **OG/social-share image picker** · FD-N4 **announcement bar** realized (pairs with the built scheduled expiry) · FD-N5 **device preview toggle** (trivial).
- **V1.1:** FD-N6 form field/success/auto-reply config (endpoint already accepts fields{}) · FD-N7 redirects manager UI · FD-N8 per-page SEO overrides + noindex · FD-N9 GBP review embed (Connected already reads the data). Adapted-not-copied: per-device visibility as a structured flag; density presets instead of spacing sliders; contrast-validated palettes inside FD-T6. Rejected: freeform layout, popups, auto-publish.

### Phase U-INF — Infrastructure Experience (audited ✅ — already substantially built)
*Phase U audit verdict: the invisibility ideal is largely SHIPPED — Foundations Desk (plain-words domain/DNS/SSL/email/hosting), desired-zone DNS with versioning+rollback, changes as approval plans, Launch Assistant, auto SSL/CDN. No competitor pairs plain-language DNS with approval-gated changes. Remaining = integrations, all V1.1: FD-INF1 buy-domain · FD-INF2 registrar-aware connect · FD-INF3 expiry watching · FD-INF4 agency bulk views. No V1 implementation warranted. See [PHASE-U-INFRASTRUCTURE-AUDIT](PHASE-U-INFRASTRUCTURE-AUDIT.md).*

### Phase S — Security & Engineering Hardening  ·  ✅ IMPLEMENTED (rate limiting live; svc audit clean)  ·  ➕ ADDED (missing from the roadmap)
*The roadmap has no backend-quality/security-hardening phase. These are real pre-scale items, not features.*
- **`svc()` id-scope audit** — confirm every service-role query taking a request-supplied id filters by tenant/site/org. Service role bypasses RLS; one missing filter is a cross-tenant leak. Do this once, deliberately, before real tenants. (Was B6 on the Launch Board.)
- **Hardened HTML sanitizer for Developer Mode (FD-B2)** — the current denylist regex is fine for trusted developers; replace with an allow-list parser + a published-site CSP *before* custom-HTML authoring broadens.
- **Serialized/ephemeral integration test harness (FD-E1)** — integration suites flake under concurrent staging state (pass in isolation). Fix before relying on the suite as a CI merge gate — false green is a trust risk.
- 🔍 **EXPAND:** a lightweight dependency/secret-exposure review + confirm the `RESEND`/`STRIPE`/`NETLIFY` tokens are least-privilege.

### Phase O — Studio Workspace Experience  ·  ✅ IMPLEMENTED (browser gaps closed)
Whole-platform certification · Zero-Surprise Certification · every action has a clear outcome · unified experience review.
- ⚠️ **Phase E (Product Integrity Verification) already produced an Integrity Certification** across editions/roles/workflows/integrations, with a Risk Register. **Trim O to its one genuinely-new delta:** a *"every action has a clear, understandable outcome"* pass — i.e., an empty-state + confirmation-copy + error-message review across the surfaces (a UX-writing audit), not a re-certification. Otherwise it re-does E.

### Phase Z — Search, SEO, Local & AI Discoverability  ·  ✅ IMPLEMENTED
*Anchored in Google's CURRENT AI-search guidance (fetched): no AI-specific files needed — the fundamentals we guarantee ARE the AI-search strategy (schema structurally matches visible text; zero-JS; cookieless). Shipped the one verified gap: **Search Console/Bing verification as a browser field** (was IMPOSSIBLE — mig 0054, both templates, kind paste-the-tag extraction). llms.txt demoted per Google's own guidance. FD-Z1 cookieless analytics · FD-Z2 NAP drift-watch · FD-Z3/Z4 queued. See [PHASE-Z-SEARCH-DISCOVERABILITY](PHASE-Z-SEARCH-DISCOVERABILITY.md).*

### Phase AA — Adobe Enterprise Capability Implementation  ·  ✅ IMPLEMENTED
*Strict-filter pass over the AEM benchmark: Named Versions SHIPPED (FD-7 — mig 0053, label route, journal UI) + the customer-facing Availability Statement on help.html; service description done prior turn. Launches/diff/reuse/headless/translation stay V1.1 with reasoning — real architecture that would delay launch without changing what a V1 customer can do. See [PHASE-AA-ADOBE-CAPABILITIES](PHASE-AA-ADOBE-CAPABILITIES.md).*

### Phase Q — Legal, Privacy, Compliance & Trust Foundation  ·  ✅ IMPLEMENTED (FD-M3 closed)
*Every published site now generates a Privacy Policy + Accessibility Statement from business facts (lib/legal_pages.ts, both templates, footer links, sitemap; effective date = snapshot date — deterministic). The honest differentiator: the templates are verified cookieless/tracking-free, so NO consent banner is required and the privacy page says so truthfully. Terms deliberately not auto-generated (FD-Q1, guided V1.1). See [PHASE-Q-LEGAL-FOUNDATION](PHASE-Q-LEGAL-FOUNDATION.md).*

### Phase R/RL — Revenue Lifecycle & Retention  ·  ✅ IMPLEMENTED (Phase RL; CP-3 added the automation tails)
- ➕ **CP-3.1 · Annual Renewal Heads-Up** (owner-approved): 7–14 days before annual renewal — what's included, the value received, a manage-plan link; informational tone, never sales. Ready to build (one lifecycle event).
*✅ FD-R1 CLOSED (Phase RL): lifecycle sweep in the daily /system/run cycle — no-card trial expiry ENFORCED (was: trials never ended), T-3 trial nudge, payment-trouble + lapse comms (workspace notice + email, one calm voice, honesty contract test-locked), written 60-day wind-down policy, and the right-to-leave fixed (GET /export now survives lapse). lifecycle 16/16; mig 0055; deployed both envs. Remaining R-items: FD-R2 workspace-vocab (V1 polish) · FD-R3 per-item windows · FD-R4 multi-language · FD-R5 core done (Phase Z). New: FD-RL1 wind-down automation, FD-RL2 win-back comms (V1.1). See [PHASE-RL-REVENUE-LIFECYCLE](PHASE-RL-REVENUE-LIFECYCLE.md).*

### Phase P — Editions, Entitlements, Pricing & Upgrade Experience  ·  ✅ IMPLEMENTED
Click reduction · Navigation optimization · Workflow optimization · Search quality · Keyboard shortcuts · Operator/customer efficiency.
- ⚠️ Click/nav/workflow/operator/customer optimization was the substance of **Phase M (Site Operations)** and **Phase L (Operational Excellence)** — done. **Trim P to the two genuinely-new items:** **content search across items** (V1.1 — today's palette searches nav only) and **keyboard shortcuts** (V1.1 — beyond ⌘K). Don't re-run the optimization pass.

### Phase Q — Client Portal Optimization  ·  ⚠️ PARTIALLY REDUNDANT (CRM + Phase F/M)
Client understanding · Approvals · Notifications · Comments · History · Leads · Reports · Sharing · Trust.
- ⚠️ Approvals (one-tap), Leads (inbox), History (timeline), Sharing (A7.2), Trust (ownership/approval-first) are ✅ done. **Trim Q to its real deltas:** **per-item shared comments (FD-19)**, **persisted read/unread notifications (FD-C1-shell)**, and **client-facing reports** (a calm read, *not* dashboards — Law 13).

### Phase R — Cross-Workspace Validation  ·  ⚠️ REDUNDANT (Phase C1 + E)
One navigation · one design language · one design system · one product identity.
- ⚠️ **Phase C1 (Unified Workspace Shell)** already delivered one nav + one shell + one identity, and Phase E verified cohesion. **Trim R to the physical consolidation that's genuinely outstanding:** **design-token de-duplication (FD-15)** (pages still inline matching tokens), **typeface unification (FD-16)**, and **wordmark cleanup (FD-17)**. That's real maintainability work; the *validation* is done.

---

## ➕ V1.1 Feature Backlog (from the review — cheap, high-leverage, not blockers)

Ordered by value-per-effort:
1. **Weekly client digest (FD-5)** — reuses the Moments engine + email; highest retention-per-hour.
2. **Auto-notify on approval (FD-F2)** — send the one-tap email automatically when a plan is proposed (today it's operator-triggered). Tiny.
3. **Shareable preview link (FD-6)** — signed, no-login preview URL; closes the approval loop for clients who won't log in.
4. **Per-item shared comments (FD-19)** — the one collaboration gap a client would consciously notice vs Notion/HighLevel.
5. Named snapshots + version compare (FD-7/12) · published-site uptime watch (FD-10) · public third-party API · per-page meta override.

*(These are already in the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md); listed here so the roadmap and the queue agree.)*

---

## Redundancy Register (what to trim so the roadmap doesn't imply rework)

| Remaining phase | Overlaps completed | Keep only |
|---|---|---|
| O — Zero-Gap Certification | Phase E (Integrity + Certification) | the "clear-outcome / copy + empty-state" UX-writing pass |
| P — Platform Optimization | Phases L + M | content search + keyboard shortcuts |
| Q — Client Portal Optimization | CRM + Phase F/M | comments, persisted notifications, client reports |
| R — Cross-Workspace Validation | Phase C1 + E | token de-dup (FD-15), typeface (FD-16), wordmark (FD-17) |
| N (parts) | Phase F | demo + booking flows + launch checklist (forms/preview/emails done) |

---

## 🔍 Things to look into / expand

### Phase UX — End-to-End Journey Certification  ·  ✅ COMPLETE
*Four personas walked customer-eyes-only (code-accurate simulation; human browser pass remains the visual confirmation). Verdict: the post-signup product CERTIFIES — drafted-for-you onboarding, calm honesty, no dead ends; blockers to launch are purely operational (activation, browser pass, front door). Implemented FD-R2 (workspace vocabulary + the preview /menu/ bug fix). See [PHASE-UX-JOURNEY-CERTIFICATION](PHASE-UX-JOURNEY-CERTIFICATION.md).*

### ⏸️ Strongest V1 — remaining build plan (Phase CP, AWAITING OWNER APPROVAL)
*✅ **CP-1 SHIPPED** (kits + look-switcher + never-ask-twice). The Excellence Directive re-triage: see [PHASE-CP-UNIFIED-PORTAL-RECOMMENDATIONS](PHASE-CP-UNIFIED-PORTAL-RECOMMENDATIONS.md) — Tier 1 (14 items, required-before-launch) + Tier 2 (4, sequenced) + Future/Reject with stated reasons. Supersedes the parked-pickups list below (its items are absorbed as CP-4/5/6/7). Nothing implemented until approval.*

### 📌 Parked engineering pickups (come back after activation/QA — small, ready to build)
*Owner-parked on purpose; each is scoped, verified, and queued in detail in the Feature Discovery Queue:*
- ~~FD-T6-lite~~ ✅ SHIPPED (Phase COMP): curated color palettes as no-code. Full Design Studio (fonts/scale/density/dark) stays V1.1.
- **FD-RL1 · Wind-down automation** — day-45 export reminder + day-60 auto-park (the policy is written + communicated; this automates the tail).
- **FD-RL2 · Reactivation & win-back comms** — welcome-back email + one polite day-30 win-back.
- **FD-N7 · Redirects manager UI** · **FD-N8 · per-page SEO overrides** — the last two no-code tails.
- **FD-Z2 · NAP drift-watch** — one evidence rule comparing site facts vs the connected Google listing → a calm Moment.

- **Sequencing (post-RL reality — every engineering gate CLOSED: V/T3/S/O/P/Q/AA/Z/RL all ✅):** **J (owner activation — incl. verifying the Resend sending domain, which the RL lifecycle emails depend on) → K (Gold Master browser QA; fold in the FD-R2 workspace-vocab polish) → H (front door/pricing copy) → N (the push)** → then G (native). Native before launch is premature.
- **The go-live push is a decision, not a phase** — surface it explicitly in N's launch checklist with an owner.
- **Progress framing:** engineering ≈ 100%; *shippable-to-a-paying-customer* is lower until J + K + H + the push land. Consider tracking two numbers so "98%" doesn't read as "2 weeks from revenue."
- **Booking availability (FD-F3)** and **demo flows** are the only genuinely-unbuilt customer-facing capabilities in N — scope them before committing dates.

---

## Standing Product Rules (unchanged — preserved)

- Every proposed feature goes through Discovery → Product Review → Customer Value Assessment → Roadmap Decision → Implementation (if approved).
- Do not add features simply because competitors have them.
- Preserve the Product Constitution and Product Laws.
- Maintain one platform, one codebase, one navigation system, one publishing pipeline.

---

## Current Progress (reconciled)

- **Engineering / platform implementation:** ~100% (tested, deployed to staging+prod).
- **Live to a customer:** ~0% (frontend unpushed; activation not done).
- **Overall V1 (including activation + QA + front door + onboarding + push):** the honest number is lower than 98% — call it "engine done, last mile remaining." The remaining phases are mostly non-engineering (activation, QA, website, onboarding) plus the trimmed deltas above and the new hardening phase (S).

### Phase CRM — CRM Excellence & Competitive Benchmark ✅ (implemented)
Verified the operational-relationship-hub architecture against HubSpot/Salesforce/GHL/Zoho/Pipedrive/Monday. Closed the one real gap — **FD-CRM1 un-replied lead follow-up nudge** (per-lead once-only notice+email, 1–7d window, notices rail + cron, mig 0061, both envs). Deliberate non-gaps documented (no pipeline/deal objects for owner-operators). Open (V1.1, recommended): FD-CRM2 agency leads-needing-reply roll-up, FD-CRM3 optional AI reply draft.

### Phase FLOW — Workflow Simplification & Product Excellence ✅ (implemented)
Walked the signed-in workflows for removable clicks. Closed the one real gap: the global shell bell now surfaces the **notices rail** + an **attention badge** on every page (FD-FLOW1), each notice one tap from the page that resolves it — the last siloed "needs you" surface, gone. No new system. Open (V1.1, recommended): FD-FLOW2 agency per-client attention badge.

### Phase OS — Operating System Integration & Cohesion ✅ (implemented)
Audited every signed-in surface/transition as ONE OS. Cohesion already high (one shell/nav/session/palette/bell/approval-spine). Closed the one real seam: Today now mirrors the Phase-FLOW bell — notices + pending approvals render as the top actionable cards on today.html, each deep-linking to where it resolves; #foundations deep-link added (FD-OS1). Frontend-only. Open (V1.1, recommended): FD-OS2 client-portal home mirrors the same treatment.

### Phase SKU — Standalone Product Experience & Packaging ✅ (implemented)
Audited CMS / Business-OS / Studio-OS editions as standalone products. Model is strong (editions as data, nav derived, upgrades only add). Closed the one real leak: the CMS workspace showed Business-OS brains (Moments/Connections/Visual Studio/Growth-Coach) — presence.html now gates by edition_features; website drafting AI stays; no-op for studio_os (FD-SKU1). Open (V1.1, recommended): FD-SKU2 per-edition onboarding copy, FD-SKU3 CRM Today empty-state edition-awareness, FD-SKU4 felt upgrade moment.

### Phase PP — Product Polish & Launch Refinements ✅ (implemented)
Consolidation: PP-1 lead-notice lifecycle fix; PP-2/CP-3.1 annual renewal heads-up (mig 0062); Section 3 merged FD-CRM2/INF4/FLOW2 into one Agency Portfolio Status; Section 4 client-portal "needs you"; PP-5 CRM empty-state; PP-6 Studio-OS upgrade welcome; terminology sweep (Photos, sections-sheet vocab, workspace prose). Regression green; deployed both envs. Open: FD-PP1 consolidate workspace nav labels; FD-SKU2 per-edition first-run copy; post-Playwright CP-7 + SD-5.
