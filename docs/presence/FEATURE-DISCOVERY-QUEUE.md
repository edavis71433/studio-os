# Feature Discovery & Product Review Queue

*A standing queue. When a milestone surfaces a capability that would materially improve the platform, it is logged here with a justification — **not built, not silently added to scope.** This is the input to the A9 Product Review Board, which decides accept / defer / reject. Each item: what · why it matters · where it came from · rough value/effort · disposition.*

> **Rule:** nothing here is committed work. Adding an item ≠ approving it. The Product Review Board (A9) triages.

> **A9 triage (complete):** the Product Review Board reviewed every item — decisions (Approve-future / Merge / Defer / Reject) are in [PRODUCT-REVIEW-BOARD-A9.md](PRODUCT-REVIEW-BOARD-A9.md). **Top-3 to build next:** FD-1 (scheduled publish), FD-2 (lead capture), FD-3 (notify-to-approve) — plus the non-feature launch prerequisites (front door / positioning, guided onboarding). Rejected: Task surface (FD-14), Workspace Personalization, Business-Reports-as-dashboards (Law 13). Merged into "global chrome": FD-8 + FD-13 + Universal Search + Command Palette + notifications. Merged into "operator console": FD-9 + Internal Support Console + Audit Center.

### FD-M1 · Auto-draft the starter site at first-run — ✅ IMPLEMENTED (Phase I)
**Built:** `get-started.html` guided first-run — a 2-question intake (industry + smart-default services + one line) → the EXISTING `starter_site` writer (`/writer/generate`) → auto-apply the single option to the DRAFT (never published) → review/preview/publish through the existing approval-first flow; graceful "set it up together" fallback when AI is off. Wired from signup + welcome. Pure core `lib/onboarding.ts` (onboarding_test 18/18). See [PHASE-I-GUIDED-ONBOARDING](PHASE-I-GUIDED-ONBOARDING.md). **Disposition:** Done (needs `ANTHROPIC_KEY` active + browser QA).

### FD-M2 · Rate limiting on public endpoints (forms submit + signup)
**What:** `POST /forms/:id/submit` and `POST /commerce/signup` are public and have **no rate limiting** (no rate-limit helper in code, though a table exists). Add a lightweight per-IP/site throttle. **Why:** abuse/spam protection for the new public surface the forms feature created. **Source:** Phase-M deep-dive (verified). **Value:** High (security) · **Effort:** Low-Medium. **Disposition:** V1 (fold into roadmap Phase S).

### FD-M3 · Legal pages on published customer sites (privacy + cookie)
**What:** the rendered customer site has **no privacy policy / cookie notice** — yet forms now collect PII (name/email). Generate a privacy/cookie page from the business facts. **Why:** compliance gap the forms feature created (GDPR/CCPA); a lead-collecting site needs a privacy policy. **Source:** Phase-M deep-dive (verified: 0 legal markup in the template). **Value:** High (compliance/trust) · **Effort:** Medium. **Disposition:** V1 candidate.

### FD-M4 · Self-serve account deletion / right-to-erasure
**What:** no self-serve account/data deletion (export exists; delete does not). **Why:** GDPR right-to-erasure + trust; flagged in the earlier data-governance audit (R1), still unresolved. **Source:** Phase-M deep-dive (verified). **Value:** Medium-High (compliance) · **Effort:** Medium. **Disposition:** V1.1 (V1 if EU customers).

### Member-experience audit (two deep file surveys) — implemented + tracked
**✅ Implemented now (safe UI wins, parse-checked):**
- **leads.html** — prefilled reply email (subject + greeting + quoted message), `tel:` links + a "Call" action for phone-only leads, auto-mark-read when you reply, and a "Try again" retry.
- **schedule.html** — a "preview your draft" link (no more scheduling blind), a local-timezone hint on the time field, a `min` that blocks past times in the picker, and a retry.
- **today.html / crm.html** — "Try again" buttons replacing manual-refresh dead ends.

**➕ Tracked (bigger, by value):**
- **FD-M5 · Guided first-run on the self-serve side** — `welcome.html` dumps a new member into the workspace on faith; port `portal.html`'s working "3 steps to go live" checklist model. *High · V1.*
- **FD-M6 · Auto-populate the project brief from `discovery_intake`** — `start.html` and `portal.html`'s 11-field brief re-ask the same questions; carry them over by email. *High · V1.1.*
- **FD-M7 · Magic-link invited-member activation** — `set-password.html` fights autofill on a hand-typed OTP; a pre-authenticated link removes the most error-prone step. Also add a "Set up my password" link on `portal.html`'s login card. *High · V1.1.*
- **FD-M8 · Proactive "connect your Google listing" first-card** on connections.html (flat equal-weight list today; one-click OAuth already exists). *Medium · V1.1.*
- **FD-M9 · AI-suggested alt text + inline field** (replace `visual-studio.html`'s native `prompt()`); multi-photo upload; PDF/text parse for knowledge import. *Medium · V1.1.*
- **FD-M10 · Surface Coach/Review suggestions on Today** (they're proposal-only already; hidden behind a manual desk-open in presence.html). *Medium · V1.1.*
- **FD-M11 · Light auto-refresh/polling + standardized optimistic-UI** across the member pages (nothing polls today; only sharing.html has optimistic rollback). *Medium · V1.1.*
- **FD-M12 · Smart new-business defaults** — ✅ typical-hours one-click IMPLEMENTED (Phase T2, shows when all days are closed); remaining: the self-serve shared nav shell. *V1.1.*

### FD-N1 · ✅ IMPLEMENTED (Phase V) — published contact form fixed (GM-2 closed)
**What (found by the No-Code Gap Audit, verified):** the template renders a plain HTML form POST (`application/x-www-form-urlencoded`, fields `name`/`contact`/`message`) but `POST /forms/:id/submit` parses **JSON** and expects **separate `email`/`phone`** — so a real visitor's submission returns 400; the form also has **no `_hp` honeypot** and **no success handling** (even a successful post would land the visitor on raw JSON). The flagship FD-2 lead capture silently fails end-to-end on a published site. **Fix spec:** endpoint accepts form-encoded + maps `contact`→email-or-phone; add the hidden `_hp` field to the template form; redirect to a rendered thank-you page (deterministic, no-JS). **Source:** [NO-CODE-GAP-AUDIT](NO-CODE-GAP-AUDIT.md). **Value:** Critical · **Effort:** Low. **Disposition:** **V1 BLOCKER — fix before launch.**

### FD-N2 · ✅ IMPLEMENTED (Phase V) — logo: one-tap in the photo library → header + favicon + OG fallback
**What:** no logo field exists anywhere (verified: identity/brand/serializer/template 0 hits; favicon = generated letter). Add `logo_media_id` to identity → render in the header, real favicon, OG fallback. The single most basic owner expectation. **Value:** High · **Effort:** Low-Medium. **Disposition:** Should be no-code **V1**.

### FD-N3 · ✅ IMPLEMENTED (Phase V) — share-image picker (one-tap on any photo)
**What:** the OG image is auto-picked (first offering photo / post hero, `render.ts:406`) with no choice. One picker field. **Value:** Medium-High · **Effort:** Low. **Disposition:** Should be no-code **V1**.

### FD-N4 · ✅ IMPLEMENTED (Phase V) — announcement bar (Business view card; deterministic expiry)
**What:** the #1 everyday block ("holiday hours notice") is in the component catalog but unrealized. Realize it first: text + optional link + expiry (pairs with the built scheduled revert). **Value:** High · **Effort:** Low-Medium. **Disposition:** Should be no-code **V1**.

### FD-N5 · ✅ ALREADY EXISTED (audit corrected) — the preview stage has a desktop/phone toggle (#devSeg)
**What:** preview has no width switcher (verified). A trivial iframe-width toggle. **Value:** Medium · **Effort:** Trivial. **Disposition:** Should be no-code **V1**.

### FD-N6 · Form controls: curated extra-field picker + custom success message + auto-reply
**What:** the endpoint already accepts bounded `fields{}`; the rendered form is fixed at 3 fields with no success/auto-reply config. **Disposition:** V1.1.

### FD-N7 · Redirects manager UI
**What:** `presence_redirects` exists and ships in the snapshot, but there is no customer-facing editor. **Disposition:** V1.1.

### FD-N8 · Per-page SEO overrides + per-page noindex
**What:** per-page meta is auto-derived (right default); allow overrides + noindex for the few who need it. **Disposition:** V1.1.

### FD-N9 · Review embed from connected GBP data
**What:** Connected Platform already reads reviews; realize the catalog's `reviews` block from that data (approval-safe display). **Disposition:** V1.1.

### FD-T1 · Author the neutral `business-classic` template + wire default-by-industry 🔴 (the decisive template item)
**What:** author `business-classic/1.0.0` — the shared render engine emitting `vocabFor(industry)` (correct `LocalBusiness`-family schema + "Services" vocabulary), register it, and point provisioning at `templateSlugForIndustry`. **Why:** Phase T built + tested the primitives (`lib/industry_vocab.ts`, `lib/site_components.ts`, `templateSlugForIndustry`), but until this ONE template is authored, a non-restaurant customer still publishes the restaurant template with wrong `@type: Restaurant/Menu` markup. **Source:** Phase T. **Value:** Very High · **Effort:** Medium (authoring against ready primitives). **Disposition:** **V1 blocker if launching broad; V1.1 if restaurant-first** — gated on the owner's market-scope decision (see ROADMAP-MASTER 🔴).

### FD-T6 · Customer-facing Design Studio (fonts · colors · sizes — curated, not CSS)
**What (owner request):** a Design surface for the *business owner* (no developer role needed) to set their site's look: pick from **curated palettes**, **font pairings**, and a **type-scale/size** control — plus their logo/brand colors from the brand asset library ([[FD-20]]). **Not** raw CSS/hex-anything: designed choices → theme tokens → deterministic render → approval-first publish. **Why it's a gap:** today NO customer can change fonts/colors at all — the theme-token machinery exists (Phase B/B1: tokens ride in the snapshot and render deterministically) but is gated behind Developer Mode; and the product's "Visual Studio" is AI *images*, not design. This is the missing customer half of the Phase T theme system (pairs with FD-T3 theme variants + FD-B4 self-hosted fonts). **Value:** High (every competitor lets customers pick fonts/colors; ours can do it *safely*) · **Effort:** Medium (a curated-picker UI over the existing token layer). **Disposition:** V1.1 — strong candidate right after FD-T1 (the neutral template), since themes make every template's look customer-tunable.

### FD-T7 · Launches — a parallel future version, promoted without downtime 🔴 (owner request)
**What:** an AEM-style **Launch**: while the live site keeps running (and stays hotfixable), prepare a **second, named version** — a template switch, a seasonal redesign, a rebrand — edit it in parallel, preview it as-if-live, then **promote it at a moment** (one click or scheduled) through the same approval-first publish. Live page never goes down. **Industry names for the same concept:** AEM Launches, Contentful Launch, Sanity Releases, Shopify unpublished-theme preview. **Why it's a real gap (verified):** we have exactly ONE draft per site; scheduled publish freezes a snapshot at schedule time, so you can't keep working on the future version, and a template switch today would hijack the only draft. **Constitution reconciliation:** general A/B branching + staging environments stay excluded (locked); a Launch is the *bounded* version — **one live lane + one launch lane**, same snapshot/render/approval machinery (a launch = a second draft workspace whose promote = the existing publish). Calm, deterministic, no branching trees. **Value:** Very High (the flagship "change templates without taking the page down") · **Effort:** Medium-High (a second draft scope + promote path). **Disposition:** V1.1 — pairs with FD-T1/T3 (you'll want it the day the second template exists).

### FD-T8 · Template switch with staged preview (folds into FD-T7)
**What:** Shopify-style: preview your **content in a different template** before committing the switch (render the current snapshot with a candidate template slug — the pure engine already supports rendering any snapshot with any compatible template). The commit path is a Launch (FD-T7); the *preview* half is cheap and could land alone. **Value:** High · **Effort:** Low-Medium (a `?template=` preview parameter + a chooser). **Disposition:** V1.1, first slice of FD-T7.

### FD-T9 · Brand kit auto-extraction (logo → palette)
**What:** upload your logo → propose a matching palette + font pairing (into the FD-T6 Design Studio as *suggested* choices, member approves). Squarespace/Canva-style brand-kit start. **Value:** Medium-High (creatives + the auto-onboarding story) · **Effort:** Medium. **Disposition:** V1.1 (after FD-T6).

### FD-T10 · Stock photography integration
**What:** search/import license-safe stock (Unsplash/Pexels API) directly into the media library (copied in — published sites stay self-contained, no hotlinking). Every competitor has this; empty photo slots are a real first-run wall. **Value:** Medium-High · **Effort:** Medium. **Disposition:** V1.1.

### FD-T11 · Image editing basics (crop · focal point)
**What:** crop + focal-point control in the media library so variants frame correctly (verified: none exists today — variants are automatic). **Value:** Medium · **Effort:** Medium. **Disposition:** V1.1.

### FD-T12 · Section ordering as structured data
**What:** let the member reorder a page's *sections* (an ordered list of structured blocks — `category_order` already proves the pattern). NOT free-form layout; order is data, render stays deterministic. **Value:** Medium (the safe half of "layout control") · **Effort:** Low-Medium. **Disposition:** V1.1 (with FD-T5 component realization).

### FD-T14 · Differentiator components (innovate, not imitate)
**What (Phase T2):** Studio-OS-native structured blocks competitors can’t match because they’re FACTS-driven: **Trust & guarantees** (licenses/insured/guarantee — pairs with certifications), **Availability/emergency banner** (driven by live hours/holiday state), **Business timeline** (“since 1998” — pairs with the story field), **Review highlights** (connected GBP data — FD-N9’s display half). All deterministic, catalog-pattern. **Value:** Medium-High (differentiation) · **Effort:** Medium. **Disposition:** V1.1 (with FD-T5 realization).

### FD-T2 · Lazy/indexed template registry
**What:** replace static-import-per-version with a lazy/indexed registry once template count grows. **Source:** Phase T scalability review. **Value:** Medium (future) · **Effort:** Medium. **Disposition:** V1.1.

### FD-T3 · Theme-variant system (multiple looks per template via token sets)
**What:** the same template realization in multiple visual themes — "3 restaurant templates" = 1 realization × 3 themes. **Source:** Phase T. **Value:** High (catalog breadth cheap) · **Effort:** Medium. **Disposition:** V1.1.

### FD-T4 · Vertical templates (home services, salon, professional, retail …)
**What:** industry-specific realizations authored via the SDK on the Phase-T primitives. **Source:** Phase T industry strategy. **Value:** High · **Effort:** Medium per vertical. **Disposition:** V1.1 (after FD-T1).

### FD-T5 · Realize the component catalog in the render engine
**What:** wire each `site_components.ts` block's deterministic render so templates compose from the catalog (the structured site builder made real). **Source:** Phase T. **Value:** High · **Effort:** Medium-High. **Disposition:** V1.1 (incremental — blocks land one at a time).

### FD-J1 · Operator activation badge (surface health.capabilities in the admin UI)
**What:** show the `/system/health` capability map (purchase/email/publishing/… green-red) in the admin tool so the operator sees activation status without curling. **Source:** Phase J. **Value:** Medium · **Effort:** Low. **Disposition:** Queued (V1.1).

### FD-J2 · Cold-start secret self-check log
**What:** on function cold start, log which optional capabilities are off (activation-debugging aid). **Source:** Phase J. **Value:** Low · **Effort:** trivial. **Disposition:** Queued (V1.1).

### FD-D1 · Commercial rungs for CMS-Only & Business-OS-Only — ✅ IMPLEMENTED (Phase D1)
**What:** `cms_only` + `business_os_only` added to `commerce/catalog.ts` PLANS (self-serve, founder-priced $24/mo, trialable), the `presence_entitlements.plan` CHECK widened (migration 0049), no Stripe-dashboard config needed (dynamic `price_data`). Both live on staging+prod — `/commerce/plans` lists 7. **Delivered in Phase D1.** See [PHASE-D1-COMMERCIAL-ACTIVATION](PHASE-D1-COMMERCIAL-ACTIVATION.md). **Disposition:** Done.

### FD-E2 · Automated nav/dead-link integrity check — ✅ IMPLEMENTED (Phase L)
**Built:** `tests/presence/nav_integrity_test.mjs` asserts every `buildNav` href + landing (514 checks across all editions×roles) and the shell's fixed targets resolve to a real page. Catches the exact defect class Phase E found by hand (missing `/help.html`). Pure, cheap, no runtime cost. See [PHASE-L-MARKET-VALIDATION](PHASE-L-MARKET-VALIDATION.md). **Disposition:** Done.

### FD-E1 · Serialized / ephemeral integration test harness
**What:** run integration suites with per-run scratch data or serialized execution so concurrent staging state can't cause false failures. **Why:** Phase E's full batch showed `connected_writes`/`pipeline` flaking under contention though both pass in isolation. **Source:** Phase E. **Value:** Medium (test infra) · **Effort:** Medium. **Disposition:** Queued (V1.1).

### FD-D4 · Coupons / promotional codes
**What:** wire Stripe promotion codes into Checkout for future promos. **Why:** promotional pricing without touching the catalog. **Source:** Phase D1. **Value:** Medium · **Effort:** Low-Medium. **Disposition:** Queued (V1.1).

### FD-D2 · Self-serve upgrade/downgrade UI
**What:** a plan-change screen driven by `featureDelta` — preview gained/lost before confirming; data-preserved messaging. **Why:** makes the upgrade path a delightful moment; the math already exists. **Source:** Phase D. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued (V1.1).

### FD-D3 · Per-feature add-ons
**What:** license a single feature onto a lower edition (e.g. Developer Mode on CMS-Only). **Why:** flexible packaging. **Source:** Phase D. **Value:** Medium · **Effort:** Medium. **Watch:** avoid nickel-and-diming the calm. **Disposition:** Queued (V1.1).

### FD-C1 · AI-enhanced relationship summary
**What:** optionally let Concierge draft the CRM relationship summary / a next-best-step, on the AI spine, approval-safe. **Why:** the Phase C summary is deterministic (always-on, calm, no cost); AI could add nuance when keys are configured. **Source:** Phase C. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued.

### FD-C2 · Structured relationship fields (not custom fields)
**What:** a *small, typed* set of relationship fields (e.g. renewal date, primary contact) only if a real need appears — never free-form custom fields. **Why:** custom fields are generic-CRM mimicry that conflicts with structured content; typed fields could serve a genuine gap. **Source:** Phase C (reviewed + rejected as custom fields). **Value:** Low · **Effort:** Low. **Disposition:** Watch — resist generic-CRM drift.

### FD-C3 · Shared relationship files
**What:** attach a contract/brief to the relationship (studio↔client). **Why:** a small real gap; pairs with [[FD-20]] brand assets. **Source:** Phase C. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued.

### FD-C4 · Formal CRM navigation entry — ✅ IMPLEMENTED (Phase C1)
**What:** "Relationship" is now in `buildNav` (Today section), surfaced by the unified shell — no longer doorway-only. **Delivered in Phase C1.** **Disposition:** Done.

### FD-C1-shell · Persisted notifications
**What:** persist "needs a look" as dismissible, per-user notifications (the Phase C1 bell recomputes from `/portal/feed`). **Why:** a real notification state (read/unread) completes the global chrome. **Source:** Phase C1. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued (V1.1).

### FD-C1-org · Explicit organization/enterprise switcher
**What:** a true org selector in the shell when enterprise orgs exist (today the profile menu links portfolio/admin). **Why:** enterprise context switching without leaving the frame. **Source:** Phase C1. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued (V1.1).

### FD-C5 · Agency-wide relationship roll-up
**What:** a portfolio health board reusing the agency portfolio + CRM health. **Why:** one glance across all clients' relationship health. **Source:** Phase C. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued.

### FD-B1 · Publish-time render injection for Developer Mode (determinism-preserving) — ✅ IMPLEMENTED (Phase B1)
**What:** fold a site's Developer-Mode customization into the **snapshot** (`presence_snapshots.dev_customization`, a sibling of content) and apply it in the ONE render entry (`renderSnapshot` → `injectDevLayer`), so publish/preview/restore all render it identically. **Delivered in Phase B1** — migration 0047, `injectDevLayer`/`devLayerFragments` in `lib/render.ts`, `buildDevLayer` in the serializer, threaded through publish/restore/preview/admin-restore/restore-to-draft. *Same snapshot → same render → same bytes → same rollback/restore/preview.* No parallel renderer, no second publish path. See [PHASE-B1-DEVELOPER-MODE-COMPLETION](PHASE-B1-DEVELOPER-MODE-COMPLETION.md). **Disposition:** Done.

### FD-B2 · Hardened allow-list HTML sanitizer (+ published-site CSP)
**What:** replace Phase B's aggressive denylist regex sanitizer with an allow-list parser and add a published-site Content-Security-Policy as the second layer. **Why:** raises the security floor before custom-HTML authoring opens beyond trusted developers. **Source:** Phase B security review. **Value:** Medium (security strengthening) · **Effort:** Medium. **Disposition:** Queued.

### FD-B3 · Syntax highlighting in the Developer Mode editors
**What:** a self-hosted, lightweight highlighter for the CSS/HTML editors (no CDN dependency — preserve page resilience). **Why:** developer-experience polish. **Source:** Phase B. **Value:** Low-Medium · **Effort:** Low-Medium. **Disposition:** Queued.

### FD-B4 · Custom fonts (self-hosted, approved)
**What:** let a developer add a self-hosted webfont via the brand-asset library ([[FD-20]]). **Why:** completes theme control without external font CDNs. **Source:** Phase B. **Value:** Medium · **Effort:** Medium. **Disposition:** Queued.

### FD-B5 · Per-template customization presets
**What:** save/reuse a theme+CSS set across a portfolio (pairs with [[FD-18]] client setup templates). **Why:** agency speed as the portfolio grows. **Source:** Phase B. **Value:** Medium (agency) · **Effort:** Medium. **Disposition:** Queued.

### FD-18 · Client Setup Templates (clone a client setup)
**What:** an agency clones a proven client configuration to stand up a new client fast (HighLevel-style "snapshots"). **Why:** compounds agency onboarding speed as the portfolio grows. **Source:** A9 competitive review (HighLevel/Duda). **Value:** Medium-High (agency) · **Effort:** Medium. **A9 decision:** Approve for future. **T2 elevation:** moved to the TOP of the V1.1 lane — verified zero reuse machinery exists; this is the agency-scaling multiplier (with [[FD-B5]]).

### FD-19 · Shared Comments on shared items
**What:** a lightweight comment thread on a shared draft/asset so client feedback stays in one place (not scattered to email/text). **Why:** completes the client-review loop with the A7.2 portal. **Source:** A9 (Notion/HighLevel). **Value:** Medium · **Effort:** Medium. **A9 decision:** Approve for future.

### FD-20 · Brand Asset Library
**What:** a home for logo/colors/fonts/approved images the studio and Visual Studio draw from. **Why:** natural extension of the brand profile + media + Visual Studio; keeps brand consistent. **Source:** A9. **Value:** Medium · **Effort:** Medium. **A9 decision:** Approve for future.

---

## High value

### FD-1 · Scheduled publish / unpublish (+ content expiry) — ✅ IMPLEMENTED (Phase F)
**Built:** `presence_scheduled_publishes` + `runDuePublishes` in the scheduler fires due rows through the ONE publish pipeline (publish a frozen draft, or revert to a prior version = expiry). Routes `/schedule*`; `/system/run` task `publish`. In-app scheduling UI = FD-F1. See [PHASE-F-COMMERCIAL-READINESS](PHASE-F-COMMERCIAL-READINESS.md). **Disposition:** Done (backend); UI FD-F1.

### FD-F1 · Scheduling & leads inbox UI — ✅ IMPLEMENTED (Phase M) — closes launch gate GM-1
**Built (Phase M):** `leads.html` (inbox over `/forms/inbox`: filter/reply/read/archive) and `schedule.html` (schedule the current draft / list / cancel over `/schedule*`), both surfaced in the one nav (`buildNav`: "Leads" in Today for website editions, "Scheduled" in Website where publishing is available) + verified by the nav dead-link guard. Plus a CRM "email the client to approve" action over `/approve/send`. Screens over existing endpoints — no new architecture. **Closes GM-1.** See [PHASE-M-SITE-OPERATIONS](PHASE-M-SITE-OPERATIONS.md). Remaining: authed browser QA of the two screens. **Disposition:** Done.

### FD-F2 · Auto-notify on plan proposal
**What:** send the one-tap approval email automatically when a plan is proposed (today `/approve/send` is operator-triggered). **Source:** Phase F. **Value:** Medium · **Effort:** Low. **Disposition:** Queued (V1.1).

### FD-2 · Form / lead capture — ✅ IMPLEMENTED (Phase F)
**Built (Phase F):** public capture `POST /forms/:id/submit` (honeypot spam, no raw IP) → `presence_form_submissions` inbox + CRM timeline `lead` items; template renders a real form via `formEndpoint` on publish; owner emailed best-effort. Inbox UI = FD-F1.

_orig:_ **What:** contact/booking form submissions from a customer's published site land in an inbox they can see (and optionally email/notify). **Why:** small businesses live on inbound leads; a static site's contact form currently has no submission home in the platform. Likely the biggest "wait, it can't do that?" gap. **Source:** competitor/operational review (verified: no submissions table/route). **Value:** High · **Effort:** Medium (needs a capture endpoint + inbox; respects the no-tracking ethos). **Disposition:** Queued — verify template form behavior first.

### FD-3 · Approval → notify → one-tap approve loop — ✅ IMPLEMENTED (Phase F)
**Built (Phase F):** stateless HMAC token → `/approve/send` emails the client one-tap links; `approve.html` + `/approve` (GET/POST) apply the decision through the existing approval spine. Auto-notify-on-propose = FD-F2.

_orig:_ **What:** when the operator prepares a publish/connected-write/AI draft, the client gets a plain email → one tap into a focused approve/reject view → it proceeds. **Why:** the whole platform is approval-gated (the moat), but the *handoff* isn't a loop — the client must happen to be in the app. Turns great architecture into a delightful ritual; pairs with the A7.2 client portal. **Source:** operator-experience recommendation. **Value:** High · **Effort:** Medium. **Disposition:** Queued — highest relationship value.

### FD-4 · Operator/system monitoring + alerting + backup drill
**What:** external uptime check on `/system/health` with paging; log-based error/failure alerting; a recorded PITR recovery drill. **Why:** today an operator won't *know* if a publish breaks, a connection drops, or the system is down (Ops audit CRIT-1/HIGH-1/2). Managed competitors do this for you. **Source:** Operations & Production Readiness audit. **Value:** High (operational) · **Effort:** Medium (mostly infra/config). **Disposition:** Queued — already tracked as Owner Activation; surfaced here for the Board.

## Medium value

### FD-5 · Weekly client digest email
**What:** email the Business-Moments "worth a look" summary weekly (or on-demand). **Why:** clients don't live in the app; a calm digest brings them back and builds trust. Reuses the Moments engine. **Source:** operator-experience recommendation. **Value:** Med-High · **Effort:** Low-Medium.

### FD-6 · Shareable preview link for client review
**What:** a signed, time-boxed preview URL of the draft the client can open (no login) to review before publish. **Why:** closes the approval loop with the new client portal — send link → client approves → publish. **Source:** competitor review + A7.2. **Value:** Medium · **Effort:** Medium.

### FD-7 · Save-a-named-version on demand
**What:** let a user snapshot a good state without publishing ("Save version → 'before redesign'"). **Why:** AEM/WordPress allow named versions any time; Studio OS versions only on publish. Cheap — the snapshot machinery already exists. **Source:** competitor review. **Value:** Medium · **Effort:** Low.

### FD-8 · Global top-bar (search + notifications + profile + help)
**What:** a consistent top bar across signed-in surfaces with global search, a notifications bell, profile, and help. **Why:** the one genuine IA enhancement from A7.5 — currently there's no global search/notifications/quick-actions. **Source:** A7.5 IA review. **Value:** Medium · **Effort:** Medium.

### FD-9 · Operator console consolidation
**What:** surface provider **activation**, AI configuration, **feature flags**, **monitoring/reporting**, and Marketplace/Enterprise/Agency management as first-class admin-UI screens (they're API/config today). **Why:** makes the Admin Tool a complete operator console. **Source:** A7.5 Admin Tool review. **Value:** Medium · **Effort:** Medium-High.

### FD-10 · Uptime / broken-link watch on the published site
**What:** extend the Presence Monitor engine to watch the customer's *published* site for downtime/broken links. **Why:** proactive trust ("your site went down / a link broke"). **Source:** competitor review. **Value:** Medium · **Effort:** Medium.

### FD-11 · Agency-managed per-client sharing
**What:** let an agency member set a client's visibility/shares from the agency surface (today sharing is owner-managed on the client's own site). **Why:** the agency scenario wants to control exposure without logging in as each client. **Source:** A7.2/A7.5. **Value:** Medium · **Effort:** Medium (needs agency→client-site scoped write).

## Lower value / watch

### FD-12 · Version diff / compare view
"What changed between v3 and v5." Change-events exist (field names); a visual diff is a nicety. **Value:** Low-Med · **Effort:** Medium.

### FD-13 · Explicit workspace/role switcher
For a person who is both a business owner and an agency member — one switcher. **Value:** Low · **Effort:** Low.

### FD-15 · Design-token consolidation (one shared stylesheet)
**What:** extract the canonical design tokens (palette, type scale, spacing, radii) into ONE shared stylesheet that every surface consumes, or codify them in `styleguide.html` as the enforced source. **Why:** today the portal family uses `dds-foundation.css` (`--p:#5b3fa0`, "one value everywhere") while the newer Presence pages (`today/connections/visual-studio/client/agency/sharing`) each **inline-duplicate** the same tokens. Values are now consistent (A8 aligned the last outlier), but they're physically duplicated — a maintainability gap for future browser/desktop/mobile/website work. **Source:** A8 design-system audit. **Value:** Medium (future-platform foundation) · **Effort:** Medium. **Trade-off:** the Presence pages were made self-contained on purpose (no CDN dependency) — consolidation must preserve that resilience (e.g., a build-time inline of shared tokens). **Disposition:** Queued.

### FD-16 · Typeface unification
**What:** one serif strategy across all surfaces. **Why:** the portal family uses Fraunces (Google Fonts CDN); the Presence pages use a system serif — a subtle "different app" signal. **Source:** A6 (B-8) + A8. **Value:** Low-Medium · **Effort:** Low-Medium (self-host the serif, or standardize on the system stack). **Disposition:** Queued.

### FD-17 · Minor naming: portal.html "Client Portal" → product wordmark
**What:** `portal.html` titles as "Client Portal | Davis Digital Studio" while the product wordmark elsewhere is "Presence." **Why:** small residual naming inconsistency. **Source:** A8 naming review. **Value:** Low · **Effort:** Low. **Disposition:** Queued (defensible as-is — portal is the studio's broader client home).

### FD-14 · Task / reminder surface in Business OS
A light task/reminder list (the Growth Coach is adjacent). **Value:** Low · **Effort:** Medium. **Watch:** risks scope creep vs the calm ethos.

---

## Deliberately NOT queued (out of ethos / constitution)

- Page-builder/component versioning · A/B branching (multi-branch trees) · per-customer staging environments · runtime third-party plugins · AI-generated customer photos · auto-publish/auto-social without approval. *(Owner-requested reconciliation: the BOUNDED single-lane **Launch** — FD-T7 — is queued; unbounded branching/staging stays excluded.)* These conflict with the structured-content / determinism / approval / Product-Law stances and are intentionally excluded (see [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md) and the [Roadmap locked exclusions](ROADMAP-LOCK.md)).

---

*Triage owner: the A9 Product Review Board. Nothing here is scheduled or approved until the Board accepts it.*
