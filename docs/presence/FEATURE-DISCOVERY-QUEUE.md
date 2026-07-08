# Feature Discovery & Product Review Queue

*A standing queue. When a milestone surfaces a capability that would materially improve the platform, it is logged here with a justification — **not built, not silently added to scope.** This is the input to the A9 Product Review Board, which decides accept / defer / reject. Each item: what · why it matters · where it came from · rough value/effort · disposition.*

> **Rule:** nothing here is committed work. Adding an item ≠ approving it. The Product Review Board (A9) triages.

> **A9 triage (complete):** the Product Review Board reviewed every item — decisions (Approve-future / Merge / Defer / Reject) are in [PRODUCT-REVIEW-BOARD-A9.md](PRODUCT-REVIEW-BOARD-A9.md). **Top-3 to build next:** FD-1 (scheduled publish), FD-2 (lead capture), FD-3 (notify-to-approve) — plus the non-feature launch prerequisites (front door / positioning, guided onboarding). Rejected: Task surface (FD-14), Workspace Personalization, Business-Reports-as-dashboards (Law 13). Merged into "global chrome": FD-8 + FD-13 + Universal Search + Command Palette + notifications. Merged into "operator console": FD-9 + Internal Support Console + Audit Center.

### FD-D1 · Commercial rungs for CMS-Only & Business-OS-Only
**What:** append `cms_only` + `business_os_only` to `commerce/catalog.ts` PLANS, widen the `presence_entitlements.plan` CHECK, and add the Stripe products, so the two new editions can be *purchased* (they already work end-to-end in the platform). **Why:** Phase D built the feature editions but left the frozen commercial catalog (DB check + `commerce_test` asserts 5 rungs) untouched by design. **Source:** Phase D. **Value:** High (to sell them) · **Effort:** Low-Medium (append + migration + Stripe). **Disposition:** Queued (V1 to sell).

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
**What:** an agency clones a proven client configuration to stand up a new client fast (HighLevel-style "snapshots"). **Why:** compounds agency onboarding speed as the portfolio grows. **Source:** A9 competitive review (HighLevel/Duda). **Value:** Medium-High (agency) · **Effort:** Medium. **A9 decision:** Approve for future.

### FD-19 · Shared Comments on shared items
**What:** a lightweight comment thread on a shared draft/asset so client feedback stays in one place (not scattered to email/text). **Why:** completes the client-review loop with the A7.2 portal. **Source:** A9 (Notion/HighLevel). **Value:** Medium · **Effort:** Medium. **A9 decision:** Approve for future.

### FD-20 · Brand Asset Library
**What:** a home for logo/colors/fonts/approved images the studio and Visual Studio draw from. **Why:** natural extension of the brand profile + media + Visual Studio; keeps brand consistent. **Source:** A9. **Value:** Medium · **Effort:** Medium. **A9 decision:** Approve for future.

---

## High value

### FD-1 · Scheduled publish / unpublish (+ content expiry)
**What:** publish a change at a future date/time; auto-retire content on a date (a `publish_at` / `expires_at` on a publish, driven by the existing scheduler). **Why:** every major competitor has it (AEM, Webflow, WordPress, Wix); it's genuinely useful for small businesses — holiday hours that flip automatically, a limited-time promo that retires itself, a seasonal page. Studio OS is publish-now only. Fits the snapshot/versioning model cleanly (additive). **Source:** competitor/operational review. **Value:** High · **Effort:** Medium. **Disposition:** Queued — strong candidate.

### FD-2 · Form / lead capture
**What:** contact/booking form submissions from a customer's published site land in an inbox they can see (and optionally email/notify). **Why:** small businesses live on inbound leads; a static site's contact form currently has no submission home in the platform. Likely the biggest "wait, it can't do that?" gap. **Source:** competitor/operational review (verified: no submissions table/route). **Value:** High · **Effort:** Medium (needs a capture endpoint + inbox; respects the no-tracking ethos). **Disposition:** Queued — verify template form behavior first.

### FD-3 · Approval → notify → one-tap approve loop
**What:** when the operator prepares a publish/connected-write/AI draft, the client gets a plain email → one tap into a focused approve/reject view → it proceeds. **Why:** the whole platform is approval-gated (the moat), but the *handoff* isn't a loop — the client must happen to be in the app. Turns great architecture into a delightful ritual; pairs with the A7.2 client portal. **Source:** operator-experience recommendation. **Value:** High · **Effort:** Medium. **Disposition:** Queued — highest relationship value.

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

- Page-builder/component versioning · A/B branching · per-customer staging environments · runtime third-party plugins · AI-generated customer photos · auto-publish/auto-social without approval. These conflict with the structured-content / determinism / approval / Product-Law stances and are intentionally excluded (see [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md) and the [Roadmap locked exclusions](ROADMAP-LOCK.md)).

---

*Triage owner: the A9 Product Review Board. Nothing here is scheduled or approved until the Board accepts it.*
