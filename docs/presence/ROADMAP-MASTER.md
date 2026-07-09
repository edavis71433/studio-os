# Studio OS — Master Roadmap (Reconciled)

*Reconciles the attached **Studio OS Master Roadmap (Current)** with the actual completion state and the suggestions from the operational review. Additions are marked **➕ ADDED**, overlaps with already-completed work **⚠️ REDUNDANT**, and items needing scoping **🔍 EXPAND**. The intent is one honest source that doesn't imply re-doing finished work.*

> **Reality check up front:** engineering is effectively complete and green, but **nothing is live to a customer yet** — the edge function is deployed to staging + prod, but every frontend page is **committed-not-pushed** behind the go-live gate, and owner activation (keys/cron) isn't done. So "98% of the V1 roadmap" is true for *engineering*; the remaining ~2% (activation, human QA, front door, the push itself) is what stands between "built" and "a customer can pay for and use it." Treat that last mile as the real work, not a rounding error.

> **✅ Phase FE-1 (done, live both envs):** feature/edition boundaries are now **enforced server-side** — `middleware/feature.ts` (`requireFeature`/`featureForRoute`) gates every capability area at the request boundary, mirroring `buildNav`; the previously-dead `editionIncludes()` is now the control. Product model ratified as **two apps** (Freelancer/Studio + Client), not three. CMS-only, Business OS, and Studio OS are each independently sellable **safely** (a `cms_only` browser can no longer reach `/crm`, etc.). Matrix 189/189, regression green, no schema change. See [PHASE-FE-1-FEATURE-ENFORCEMENT-AND-TWO-APP-MODEL](PHASE-FE-1-FEATURE-ENFORCEMENT-AND-TWO-APP-MODEL.md). Follow-up (not blocking): a `files` EditionFeature when DAM is sold standalone.

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
- **A few vertical templates** (home services, salon/beauty, professional services, retail) via the existing SDK. — ✅ **REALIZED as vertical *presets* (Phase T-BLOCKS-3, FD-T4):** per constitution Part 4 ("as few templates as honesty allows… template count is a maintenance liability"; "verticals differ by vocabulary + emphasis, not bespoke render code"), each vertical is realized as (one engine × industry vocab × theme × **recommended blocks**) rather than a bespoke template codebase. `lib/vertical_presets.ts` recommends the blocks that make each industry feel intentionally designed (trades → before/after + service areas + process; beauty → team + gallery + pricing; professional → team + process + certifications; …), surfaced one-tap in the editor via `GET /blocks/suggested`. 14/14. ⚠️ *If the owner wants literal bespoke per-vertical template code instead, that tensions with the frozen Part 4 and needs an explicit constitutional decision — flagged, not assumed.*
- ✅ **REALIZED (Phase T-BLOCKS):** ➕ **An out-of-the-box COMPONENT / block library** (owner request) — a set of ready-made, *configurable* content blocks customers can turn on and fill: hero, gallery, testimonials, FAQ, hours, map/location, services/menu grid, team, pricing/packages, CTA banner, contact/lead form, announcement bar, before/after, reviews. **Constitution-safe:** these are *structured blocks you choose and fill* (fields → deterministic render), NOT a free-form drag-drop page builder — so it stays within the structured-content + determinism + approval-first laws. Each block declares its fields + schema; templates realize them; the SDK is the authoring surface. This is the "easy to build a real site" layer that makes the template library reusable across industries. **Shipped:** the catalog (`site_components.ts`) is now realized end-to-end — `lib/site_blocks.ts` validates + renders 8 structured blocks (features · stats · team · process · pricing · certifications · service_areas · cta) with correct schema.org + a11y, stored on `presence_settings.blocks` (migration 0068), rendered by `business-classic`, publishing through the one pipeline. 24/24 + 69/69 regression; deployed staging+prod. See [PHASE-T-BLOCKS-COMPONENT-LIBRARY](PHASE-T-BLOCKS-COMPONENT-LIBRARY.md). Remaining surfaces appended below (FD-T15/16/17).
- 📋 **T2 audit (authoring capability):** verdict = optimize/realize, don’t build more — the only V1 build is FD-T1; FD-18/FD-B5 (freelancer reuse — verified absent) elevated to top of V1.1; FD-T14 differentiator blocks added; typical-hours one-click implemented. See [PHASE-T2-AUTHORING-AUDIT](PHASE-T2-AUTHORING-AUDIT.md).
- 🔍 **EXPAND / decide:** V1 blocker vs V1.1 depends entirely on the target-market answer (restaurant-first vs small-business-broad). This is the most important product-scope decision left. The component library is what makes non-restaurant sites genuinely good, not just correct.
- ➕ **Launches (FD-T7, owner request):** change the template / stage a redesign in a parallel named version while the live site keeps running + stays hotfixable, then promote at a moment — AEM-Launches/Contentful-Launch/Sanity-Releases class. Bounded one-live-lane + one-launch-lane (general branching stays excluded). First slice: FD-T8 template-switch staged preview. Creatives additions: FD-T9 logo→brand-kit extraction, FD-T10 stock photos, FD-T11 crop/focal, FD-T12 section ordering as data.
  - **Status (Phase T-BLOCKS-3):** ✅ **FD-T8 DONE** — `/preview?template=` renders any registered look with the real draft content, **nothing persisted**, contract-checked (`preview.ts`); the look chooser uses it. ✅ **FD-T11 (crop/focal) DONE** (DS-5, mig 0057). ✅ **FD-T12 (section ordering as data) DONE** (DS-2). ✅ **FD-T7 full Launches lane DONE (T-BLOCKS-4)** — a *named staged snapshot* alongside the live/working draft, previewable/approvable/schedulable, promoted as one atomic publish and rolled back through the SAME pipeline (no second renderer/scheduler/pipeline). ✅ **FD-T9 logo→brand-kit DONE (T-BLOCKS-4)** — deterministic derivation into the existing token layer. ✅ **FD-T10 stock photos DONE (T-BLOCKS-4)** — imported into the customer's own Files so the published site self-hosts them (zero external origins, Part 4); Pexels default, provider-swappable; owner-gated on `PEXELS_API_KEY`.
- ➕ **Customer-facing Design Studio (FD-T6, owner request):** fonts · colors · sizes for the *business owner* — curated palettes + font pairings + type scale over the EXISTING Phase-B1 theme-token layer (no developer role, no raw CSS; approval-first). Today no customer can change design at all — the tokens are developer-gated, and "Visual Studio" is AI images, not design. Pairs with FD-T3 themes + FD-20 brand assets + FD-B4 fonts.
- ✅ **FD-T15 · Block-authoring UI in the editor — IMPLEMENTED (Phase T-BLOCKS-2).** `presence.html` Design view now has a “Content blocks” editor: add / fill / reorder / remove blocks (working copy → explicit Save → the existing `/settings` endpoint). Text blocks use simple line editors; media blocks use the existing photo picker. Syntax-verified; needs a human browser pass (normal QA, not a gate). See [PHASE-T-BLOCKS-2-UI-AND-MEDIA](PHASE-T-BLOCKS-2-UI-AND-MEDIA.md).
- ✅ **FD-T16 · Blocks realized across every template — IMPLEMENTED (Phase T-BLOCKS-2).** The shared `renderSiteBlocks` is now wired into `editorial` and `restaurant-classic` as well as `business-classic` — full block parity across all three families. render 28/28 (golden regenerated), editorial 18/18, business-classic 42/42.
- ✅ **FD-T17 · Media-bearing blocks — IMPLEMENTED (Phase T-BLOCKS-2).** Gallery, before/after, video (poster + link-out, **never** an external iframe — Part 4 zero-external-origins), and team photos, all resolving media IDs → `MediaRef` through the serializer's existing `ref()` (one media pipeline). site_blocks 38/38. UI shipped for gallery / video / before-after; team-member photos are engine-complete (render if set) with a small picker follow-up (FD-T18).
- ✅ **FD-T18 · Team-member photo picker — IMPLEMENTED (Phase T-BLOCKS-3).** The team block editor is now structured (name/role/bio + an optional photo per person via the existing `openPicker`), replacing the text control; the engine already resolved member `media_id`→`MediaRef`. Syntax-verified; browser QA is the normal pass.
- ➕ **FD-T19 · Stock Library activation + provider licensing** (discovered Phase T-BLOCKS-4) — the Stock Library ships behind a swappable provider; **Pexels** is the recommended long-term default (Pexels License: free commercial use, modification, and **self-hosting**, no required attribution — the right fit since each image is imported into the customer's own storage so the published site has zero external origins). *Owner action:* set `PEXELS_API_KEY` (and optional `STOCK_PROVIDER`) to turn it on; until then `/stock/*` answers 503 honestly. Imported images carry `source`/`license`/`license_url` provenance metadata. *Why it belongs:* completes FD-T10's activation + records the licensing decision. *Recommended priority:* owner-activation (not an engineering blocker).
- ✅ **FD-T20 · Dedicated Preview Environment — DONE (Phase T-PREVIEW).** Every site has **Draft → Preview → Live**. `presence_site_preview` (mig 0071) pins a staged snapshot + a share token + optional password hash. **Publish to Preview** reuses `captureDraftSnapshot` (`lib/staging.ts`); the preview is served through the ONE render engine at the public **`/p/:token`** (pre-auth, token+password gated, `noindex`, honest preview badge — no second deploy); **Promote to Live** reuses `runPipeline('publish')`. Compare via `/preview?version=preview|live`. preview_env 12/12. No duplicate infra/pipeline.
- ✅ **FD-T21 · Preview Management — DONE (Phase T-PREVIEW).** A Draft·Preview·Live panel in the Website module (History) — update preview, open/copy/reset the link, set/clear password, compare with Live, promote to Live — above the Launches list (staged releases) and the version journal (Last Published / Launch History / Rollback History), all reusing `presence_publishes` + `presence_launches` + `/preview`.
- ✅ **FD-T22 · Environment Architecture Documentation — DONE (Phase T-PREVIEW).** Permanent doc: Studio App = Development/Staging/Production; Customer Websites = Draft/Preview/Live (no customer Development env). See [ENVIRONMENT-ARCHITECTURE](ENVIRONMENT-ARCHITECTURE.md).

#### Phase T — completion status (honest, Phase T-BLOCKS-3)
| Item | Status |
|---|---|
| FD-T1 business-classic (industry realization) | ✅ done (T3) |
| Default-template-by-industry | ✅ done (T3, mig 0052) |
| Component/block library (catalog + realized) | ✅ done (T-BLOCKS) |
| FD-T15 block authoring UI | ✅ done (T-BLOCKS-2) |
| FD-T16 blocks in every template | ✅ done (T-BLOCKS-2) |
| FD-T17 media blocks (gallery/before-after/video/team) | ✅ done (T-BLOCKS-2) |
| FD-T18 team photo picker | ✅ done (T-BLOCKS-3) |
| FD-T4 vertical realization | ✅ done as **presets** (T-BLOCKS-3) — bespoke per-vertical templates deliberately not built (Part 4); owner-decision if wanted |
| FD-T3 theme system | ✅ done — palettes (12, WCAG-checked) + type presets + size/corners/bg/density + per-industry suggestion + **one-tap complete Looks** (T-BLOCKS-3), all on the one token layer |
| FD-T8 template-switch staged preview | ✅ done (CP-1, `preview.ts`) |
| FD-T11 crop/focal · FD-T12 section-order-as-data | ✅ done (DS-5 / DS-2) |
| **FD-T7 full Launches lane** (named parallel draft + atomic promote) | ✅ **done (T-BLOCKS-4)** — `presence_launches` (mig 0070) + `routes/launches.ts`: create/recapture → decide(approve) → schedule OR promote → rollback → cancel, **reusing** `runPipeline` (atomic publish/restore), `presence_scheduled_publishes` + the cron (scheduling), the `approve` capability + audit, and `/preview?launch_id=`. UI in History. Launches 11/11. No second pipeline/scheduler. |
| **FD-T9 logo→brand-kit** (one source of truth) | ✅ **done (T-BLOCKS-4)** — `lib/brand_kit.ts` deterministically derives the **existing** Design-Studio tokens (contrast-safe: a light brand still yields readable buttons) from a logo + colour + type + corner; stored on settings (mig 0069); `PUT /dev/brand-kit` applies via the one token layer; UI in Design. 15/15. No second theme engine. |
| **FD-T10 stock photos** | ✅ **done (T-BLOCKS-4)** — a **Stock Library** collection inside Files: `GET /stock/search` + `POST /stock/import` (imports into `presence_media` via `importImage` → the one media pipeline; the site self-hosts it, **zero external origins**). Provider swappable behind `lib/stock/registry.ts`; **Pexels** is the recommended default (free commercial + self-host + no required attribution). 9/9. ⚙️ Owner activation: `PEXELS_API_KEY` (and optional `STOCK_PROVIDER`). |
| **FD-T2 lazy/indexed registry** | ⏳ the registry is already **indexed** (`getTemplate`/`listTemplates`/`latestTemplateVersion`); lazy **dynamic-import** is deferred until version count warrants it — premature at 3 templates (Part 4 values a boring, in-head registry). No customer impact. |
| **FD-T6 Design Studio — dark mode** | ⏳ remaining — **owner decision** (public small-business sites are light by design; not a clear win) |
| **FD-T6 Design Studio — custom uploaded fonts** | 🚫 **constitution-blocked**: external webfonts violate Part 4 "zero external origins"; the local/system **type presets** are the conforming realization |
| **FD-T18 team photo picker** | ✅ done (T-BLOCKS-3) |


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
- **Two-App Law (permanent — constitution amendment 6):** Studio OS is exactly **two** user-facing apps — the **Studio App** (Freelancer/Agency; modules by edition: Website/CMS, Customers/CRM, Files/DAM, Analytics, Inbox, Studio Mgmt, AI, Publishing, Billing, Settings) and the **Client App** (one role-appropriate experience). CMS/CRM/DAM/Analytics/etc. are **modules, not applications**; never a third customer-facing app without an explicit amendment. Enforced server-side (`middleware/feature.ts`). Current Admin Tool + Client Portal are transitional (retired on release, migrated in; services unchanged).

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

### Phase PT — Premium Template System & Design Excellence (design core ✅; PT-4–PT-9 continuing)
DELIVERED + TESTED: PT-1 Editorial second template family (18/18, distinct design language, same engine, auto-surfaced in the Design Studio chooser, deployed both envs); PT-2 six premium palettes (12 total, WCAG-validated, 64/64); PT-3 ~18 more industries (~53 total). Closes the certification's #1 gap (two templates). REMAINING (scoped, not stubbed): PT-4 visual polish, PT-5 contextual onboarding, PT-6 plain-English Health Coach (largely exists via Growth Coach+Moments), PT-7 Customer Timeline, PT-8 Admin Health Center (extend /system/health), PT-9 AI memory.

### Phase PT-2B — Premium Experience Completion ✅ (PT-4–PT-9)
All remaining Premium Experience items, reuse-first: PT-6 Business Health Coach (/coach/health, no scores), PT-7 Customer Timeline (/coach/journey), PT-8 Admin Health Center (in /system/health, one read, no duplicate monitoring), PT-9 AI Business Memory (/coach/memory + concierge grounding, one loader, existing data), PT-5 contextual onboarding (declarative shell hints, show-once), PT-4 skeleton/micro-interaction polish. premium_experience 21/21 + regression green; deployed both envs. Phase PT (design core) + PT-2B together complete the Premium Experience roadmap.

### Phase PT-2C — Premium Experience Surface Completion ✅
Surfaced the PT-2B capabilities (reuse-only, no duplicate systems): Health Coach UI on Today (one health experience, replaced search-only line), Customer Journey card, Admin Health Center (admin-health.html + operator-authed /admin/health-center), Concierge actively using AI memory (stage/season-aware), template preview gallery (fallback for future families), contextual hints across Design/Foundations/Search/Publish/Photos/CRM. concierge 30/30, premium_experience 21/21, regression green; deployed both envs; Playwright specs added.

### Phase DAM — Studio Asset Library ✅
Lens + lifecycle over presence_media (no duplicate store/pipeline). Mig 0063 (tags/collection/metadata/content_hash/brand/asset_status). Pure cores (dam.ts, 32/32): policy-based approval (solo/agency/enterprise), lifecycle transitions, duplicate detection, usage, safe delete, health, collections/tags, on-demand search. /assets/* API + Photos-view health line. Deployed both envs. Follow-up: fuller in-grid library UI (collections/tags/search chips + per-asset lifecycle).

### Phase AN-1 — Analytics Excellence ✅
First-class **Analytics** outcome, honesty-first: plain-English understanding composed from data the platform ALREADY stores — inquiries (form_submissions), publishing, Customer Journey, Health Coach, Business Moments — with agency scope reusing gather+buildPortfolio (no duplicate aggregation). NEW: analytics/compose.ts (pure sentence composition), routes/analytics.ts (/analytics + /customers + /search + /portfolio), rebuilt analytics.html (sentences-first, print-friendly, portfolio lens when agency-unscoped). AN-9 verified: ZERO new AI (route+compose import no model — guard-tested). AN-4 honesty: website visitors/GA + search/GSC are dormant `planned` providers → shown as "not measured yet", NEVER faked; no source for conversions/response-time/repeat-customers → not invented. analytics_test 26/26 + analytics_integration 8/8 (real staging inquiry composition) + analytics.spec (no <canvas>, honest cards, scope-forwarded). Deployed both envs. V1.1: first-party visitor tracking (pixel + visits table + /collect), GA/GSC ingestion into presence (real today only in clever-api), PDF reports (print-HTML today), page-level content analytics, response-time/conversion (need schema).

### Phase AN-2 — Analytics Foundation (privacy-first visitor intelligence) ✅
The collection layer that makes Analytics/Health/Journey/Moments/Agency real instead of assumed. ONE tracker (injected at the single lib/render.ts pass, ~750B, sendBeacon, DNT-honoring, no cookies), ONE public endpoint (POST /px/:siteId, pre-auth, rate-limited, always 204), ONE table (presence_visits, mig 0066, deny-all). Privacy-first: no raw IP (daily-rotating anonymous visitor_hash → no cross-day identity), bots dropped, referrer host-only, coarse geo. Composes (never re-collects): reuses form_submissions + publishes; surfaces real visitors/sources/pages/contact-taps as sentences in the Analytics home (traffic "not measured" card retired), a new /analytics/website view, the real "First visitor" Journey milestone, a meaningful-change traffic Moment (no spam), and agency "traffic but no inquiries". ZERO AI (guard-tested). visits_test 34/34 + analytics 26/26 + premium 22/22 + visits_integration 10/10 (live deployed collector; caught+fixed a clock-skew window bug). Deployed both envs. V1.1: daily rollup + 180d retention, GSC/GA ingestion into presence, geo enrichment.

### Phase AN-3 — Search Performance & Google Search Console ✅ (honest, ready, dormant-until-data)
Composes GSC metrics into Analytics by REUSING the shared `public.signals` table (same DB as presence, keyed by client_id) — no new store/collector/OAuth/AI. NEW: analytics/search_perf.ts (pure: plain-English + jargon translation — impressions→"seen on Google", clicks→"clicked through", CTR→"1 in N", position→"first page"; meaningful-change notices; genuine milestones; agency state). routes/analytics.ts readGsc() + wired into the search view (performance + milestones + honest "connect" card), the home (search cards + Search moment), the Health Coach (searchIssues from falling/absent visibility → shows on Today), and the agency portfolio (growing/falling/not-connected). AUTO-ACTIVATES from real signals rows. ⚠ STRUCTURAL FINDING: no GSC data exists anywhere today (staging empty; prod has only ga4) — the clever-api gsc_ingest is manual/agency-only/impressions+clicks-only, and queries/pages/indexing are stored nowhere. Did NOT fabricate. search_perf_test 24/24 + search_perf_integration 8/8 (live, real signals table, isolated). Deployed both envs, no migration. Follow-up AN-3.1 (owner-gated): presence-native GSC OAuth ingest + cron + query/page/indexing dimensions.

### Phase DAM-2 — Files Approval & Publishing Workflow ✅
Approval-before-publish for any in-use file, REUSING the existing asset_status lifecycle + the ONE approval feed + writeChangeEvent audit + agency portfolio + publish pipeline (no second system). "Staged replace" model: under required/optional policy a replace of an in-use file stays PENDING (old stays live, references NOT repointed) → surfaces in Inbox/Today/reviewer/agency via pending_approvals (kind:'file') → APPROVE repoints live + retires old + stamps approved_by/at → REJECT discards, old stays live. Serializer/publish untouched (unapproved files are never referenced). Don't-over-approve: only in-use files under required(enterprise)/optional(agency, on submit); solo owner=immediate. Files UI: Pending badge + state badge + who/when + Approve/Ask-for-changes. Reviewer restricted to approve/reject. Agency portfolio: files_pending folded into attention. files_test 30/30 + dam2_integration 10/10 (live real DB: pending→approve repoint→reject discard). Deployed both envs, no migration.

### Architecture v1.0 — Final Migration Compliance ✅
Closing compliance sweep (terminology/nav only, no features). Migrated the last visible legacy vocabulary: Media→Files (developer view + /presence.html#media→/files.html), Relationship view→Customers (crm/leads), Leads→Messages (leads/today copy), and legacy brand "Presence"→"Studio OS" across page footers + help/connections/visual-studio/today copy + the presence.html wordmark. Kept: generic "web presence", Presence SDK (internal), the `presence` edition key/routes, engineering names in comments. Verified: zero visible forbidden terms across all 16 app pages + shell + route messages + rendered templates; all 3 templates flow through the one renderSnapshot (shared dev-layer + analytics injection). Single-ownership confirmed (Website/Customers/Files/Analytics/Inbox/Studio each own their domain, no duplicates). Regression green. Deferred to Design-System QA / Integration Audit: layout/token cohesion, orphaned analytics deep-views. See PHASE-IA-FINAL-COMPLIANCE.md. Migration frozen.

### Phase DS-1 — Design System & Premium Experience ✅ (consistency, no redesign)
Audited every signed-in surface for design-system consistency. Canonical tokens = shell.css (bg #faf8f5, ink #1b1525, accent #5b3fa0, cool palette, dark-mode aware). Found + fixed the one competing palette: today/connections/visual-studio used a warm set (#f6f4ef/#221f1a) that mismatched the cool shell frame — converged their :root values (light+dark+data-theme) + shadow tint to canonical (values only, no layout/component change; grep-verified clean). Now every page except the Website editor shares one token system with the shell. Documented + DEFERRED (redesign/visual-QA, out of DS-1 scope): presence.html's bespoke editorial design language (--paper/--hair, no purple, no dark mode) = the #1 design-direction decision; :focus vs :focus-visible nit; crm/connections container widths; visual/responsive/AT verification (a Gold Master QA step — can't run a browser here). See DESIGN-SYSTEM.md. Regression + typecheck green.

### Phase AI-1 — AI Cost & Value Optimization ✅ (audit + defer, no new AI)
Audited every AI surface. Finding: 10 of 14 surfaces are ALREADY deterministic (zero tokens) — Health Coach, Journey, Memory, Moments, SEO, Search, Analytics, Inbox, Studio/Agency, Design. Real spend = Writer + Editor (on-demand, metered, KEEP), Visual (owner-key-gated, KEEP), and the OPTIONAL model tiers of Coach/Reviewer/Guardian (deterministic tier always runs regardless). Concierge answer is deterministic; its cosmetic polish is off by default. CHANGES (reuse-only): (1) deferred the Growth Coach model tier to explicit /coach/run — it was firing EAGERLY on the cron cycle + agency bulk runner portfolio-wide with no user asking; now scheduler+bulk = deterministic-only, model ideas on demand. (2) metered the previously-unmetered Reviewer/Guardian/Coach model calls via the existing meterModel (real tokens, capacity-governed). Saving shape: eager Coach spend O(sites×cycles) → O(user clicks); unattended paths no longer block on model calls. No REMOVE/REPLACE (every reducible surface already deterministic). Recommend (governance, non-blocking): add a per-model token→cost table for $ reporting. coach 46/46 + guardian 30/30 + reviewer 22/22 + writer 30/30 + invariants 14/14; deployed both envs. See PHASE-AI1-COST-VALUE.md.

### Phase EC-1 — Experience Cohesion & Operating System Integration ✅
Audited the whole signed-in experience as one continuous flow (building on INT-1's connection-verification + DS-1's token unification). "If I do X, what's next?" — every workflow carries the logical next step (upload→Files+where-used, publish→Analytics/Today reflect it, lead→Inbox/Customers, approve→repoint+publish+clear, Analytics issue→fix-it links). ONE gap found + fixed: Files→Website was one-directional — the "where used" panel named pages but didn't link; now each entry clicks through to the Website editor (scope-aware), closing the Files↔Website loop. Audited entry points: leads-in-3-places (Inbox aggregator / Customers record / Messages detail) = intentional, not duplicate; two Files touchpoints = library + in-editor picker (deep-linked); one nav (shell; .appnav is dead CSS). WEBSITE EDITOR DECISION: keep as a distinctive creative mode (its light bg #faf7f0 ≈ canonical #faf8f5 so no jarring seam; warm-ink/editorial character is deliberate, Notion/Framer-style). Only gap = no dark mode → V1.1 polish with visual QA (a blind redesign doesn't clearly improve cohesion). files 30/30 + invariants 14/14 + roles 42/42; files.html-only change. See PHASE-EC1-EXPERIENCE-COHESION.md.

### Phase AN-3.1 — Google Search Console Integration ✅ (code complete; Google app owner-gated)
Makes Search real, reuse-first. REUSED: connected-platform OAuth + encrypted token storage (presence_connection_secrets), the shared `signals` time-series (AN-3 reads it), the ops cron. NEW: ops/gsc_sync.ts (real searchAnalytics/query call — the PROVEN clever-api shape — site totals + query/page breakdowns, 401→refresh→retry, Domain/URL-prefix discovery); lib/gsc.ts (pure parsing); presence_search_terms store (mig 0067) for query/page detail (signals has no dimension column); gsc_sync scheduled task + daily cron. Fixed 2 latent bugs that would break a live connection: short scope string → full URL; connectionState read `provider` not `provider_key`. Surfacing: search_perf searchDetailInsights (top search + best page in sentences, no jargon) + analytics readSearchTerms → Search view returns detail + detail_available. Collected: impressions/clicks/position (→signals) + top queries/pages (→search_terms). Deferred (no code to reuse / low value): countries/devices, coverage/index/sitemap (URL Inspection + Sitemaps APIs) → V1.1. OWNER-GATED: Google Cloud OAuth app + webmasters.readonly consent verification + CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID/SECRET + CONNECTION_ENC_KEY + STATE_SIGNING_SECRET + SITE_URL — until set, connect returns 503 not_available honestly. gsc 17/17 + gsc_integration 7/7 (live, real stores) + full analytics suite green; mig 0067 both envs; deployed. See PHASE-AN3.1-SEARCH-CONSOLE.md.
