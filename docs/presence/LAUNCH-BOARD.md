# Studio OS — Launch Board

One prioritized plan consolidating every fix from the L5.8 Launch Readiness Review. Work top-to-bottom; don't start a lower tier until the tier above is green. Each item: **owner** (who unblocks), **why it's here**.

Legend — Owner: 🧑 = requires the human owner (Eric); 🤖 = buildable by Claude; 🔒 = external (registrar/provider/legal counsel).

> **🧭 Two-App Law (permanent — constitution amendment 6):** Studio OS ships exactly **two** user-facing apps — the **Studio App** (Freelancer/Agency; modules by edition) and the **Client App** (one role-appropriate experience). CMS/CRM/DAM/Analytics/etc. are **modules, not applications**; no third customer-facing app without an explicit amendment. The current Admin Tool + Client Portal are transitional (retired on release; functionality migrated into the two apps; services unchanged). Enforced server-side (`middleware/feature.ts`, Phase FE-1).

> **⚠️ Note (current):** the tiers below are the original L5.8 review and are partly historical — much of MUST-FIX-BEFORE-BETA has since shipped (portal/Moments front door, one shell, CI logic, etc.). The **live** launch gate is the block immediately below.

---

## 🚩 REQUIRED BEFORE GOLD MASTER QA (live gate — added Phase F)
*Engineering that must be finished before Gold Master QA, distinct from owner activation and human live passes. "The capability exists" ≠ "customers can discover and use it naturally."*

| # | Item | Owner | Why |
|---|---|---|---|
| ~~**GM-1**~~ | ✅ **CLOSED (Phase M)** — **V1 UI completion for the Phase F commercial features (FD-F1)**: the **Scheduling** screen (`schedule.html`) and the **Leads inbox** (`leads.html`), both surfaced in the one nav, + a CRM notify-to-approve action. | 🤖 | Built in Phase M as screens over the existing tested endpoints; verified by the nav dead-link guard. Remaining: authed browser QA. See [PHASE-M-SITE-OPERATIONS](PHASE-M-SITE-OPERATIONS.md). |
| ~~**GM-2**~~ | ✅ **CLOSED (Phase V)** — the capture endpoint accepts plain HTML form posts (maps `contact`→email/phone), the template form carries the `_hp` honeypot + hidden context fields, and visitors land on a rendered `/thanks/` page (303, no JS needed). Verified by 5 new pure tests + live smoke on both envs. | 🤖 | See [PHASE-V-NO-CODE-ESSENTIALS](PHASE-V-NO-CODE-ESSENTIALS.md). |

*(Owner activation — RESEND_KEY **+ verify the sending domain in Resend (SPF/DKIM) — the Phase-RL lifecycle emails depend on deliverability**, APPROVAL_SECRET, cron on `/system/run` — and human live-browser/AT passes remain separate, non-engineering gates.)*

---

## 🚦 MUST FIX BEFORE BETA
*Nothing ships to a single paying customer until every box here is checked.*

| # | Item | Owner | Why |
|---|---|---|---|
| B1 | 🟢 **Stripe half CLOSED (Jul 2026)**: live key verified via API (account activated, charges+payouts enabled), set in prod; webhook endpoint updated — **customer.subscription.created registered** (6/6 events, enabled). Remaining: confirm prices, then **the push**. | 🧑🤖 | Billing chain live end-to-end; the push stays the final gate. |
| ~~B2~~ | ✅ **CLOSED** — `today.html` is the Business-Moments front door (+ Concierge ask, dismiss, doorways); portal links to it. | 🤖 | Built in Launch Track 2 / optimized Phase M. |
| B3 | **CI**: one command runs the whole test suite; green required on every push. 🟢 *Two gates now exist:* the deno pre-deploy suite (deploy.yml) + the **Phase PW Playwright browser gate** (e2e.yml, hermetic, 3 viewports). Remaining: mark both as required status checks in branch protection. | 🤖🧑 | Automated gates now cover backend + browser |
| B4 | **Backups + a real restore test** on both Supabase projects | 🧑🔒 | You cannot sell what you can't recover |
| B5 | **Reconcile migration history** so a single migration applies without the hold-back ritual | 🤖 | The current ritual is manual and one typo from a prod mistake |
| B6 | **`svc()` id-scope security audit**: every service-role query that takes a request-supplied id must filter by tenant/site/org | 🤖 | Service role bypasses RLS; one missing filter = cross-tenant leak |
| B7 | **Secret rotation confirmed** (Netlify token, any password shown in chat); never reset `edavis7143@yahoo.com` | 🧑 | Historical exposure |
| B8 | **Basic monitoring + alerting** (function errors, failed deploys, DB health) + a one-page incident runbook. 🟢 *Partial:* cross-region watchdog (staging→prod `/system/health` every 5 min → email), weekly owner digest, the domain-expiry watch, and (Phase CRM) the **un-replied-lead follow-up nudge** all ship health/safety-net signals on the cron. Remaining: function-error/failed-deploy alerting + the runbook page. | 🧑🤖 | Operating blind is not acceptable for paid users |
| B9 | **In-product AI disclosure** at the point of generation + confirm AI-capacity metering is enforced | 🤖 | Legal + trust; manual path must stay first-class |

---

## 🟡 SHOULD FIX BEFORE PUBLIC LAUNCH
*Required before opening self-serve signup to the world / selling to enterprise.*

| # | Item | Owner | Why |
|---|---|---|---|
| P1 | 🟢 **Engineering half CLOSED** — `connections.html` + `connections-callback.html` built (L5.9). **Remaining: owner registers the provider OAuth apps** to go live. | 🧑🔒 | UI complete; credentials are the gate. |
| P2 | **Cookie Policy + consent flow** | 🤖🔒 | Public-launch legal baseline |
| P3 | **DPA + sub-processor list** (Supabase, Netlify, Stripe, connected providers) | 🧑🔒 | Hard enterprise blocker |
| P4 | **Connected-provider consent copy** in the connect flow (what's read/written, revocation) | 🤖 | Trust + legal at the moment of connection |
| ~~P5~~ | ✅ **ENGINEERING DONE (Jul 9 2026)** — dedicated `OPERATOR_SECRET` (`x-operator-secret` header) resolves to a system-kind operator principal; fail-closed, server-to-server, NOT the service-role. Marketplace/enterprise routes already accept it. operator_auth 7/7. Owner sets the secret when a programmatic operator caller is wired. | 🤖 | Now has a clean privileged caller. |
| P6 | **Fresh WCAG 2.2 AA pass** on templates + portal + any new UI (keyboard, zoom, VoiceOver/TalkBack, forms) | 🤖 | The bar moved; new surfaces unreviewed |
| P7 | **Measure real p95** of `/observe` + full pipeline on a large live site; check edge cold-start & bundle size | 🤖 | Backend is fast in the pure tests; verify under real load |
| P8 | **Consolidate redundant marketing pages**; let Industry Packs earn the industry pages | 🤖 | Overlap + maintenance drag |
| ~~P9~~ | ✅ **CLOSED (activation)** — `pg_cron` LIVE on both envs (15-min cadence hitting `/system/run`, Vault-stored secret). Scheduled ops no longer need external triggering. | 🧑🤖 | Was stale on this board; done during owner activation. |
| P10 | **Customer help / KB** + agency + enterprise onboarding guides | 🤖 | Docs serve engineers, not customers yet |
| ~~P11~~ | ✅ **DONE (Jul 9 2026)** — opt_dormant rule retired; the 5 generate-to-suppress observations no longer emitted; `analytics.not_connected` kept (real consumer) + documented. optimization 32/32 + engine 18/18 + judgment 14/14. | 🤖 | Generate-to-suppress removed. |
| P12 | **Scope decision**: keep Marketplace/Enterprise/Agency behind an operator flag until they have UI | 🧑 | Ship value, not surface |

---

> **Phase PT (design):** the certification's #1 competitive gap — a **second template family** — is now CLOSED. Editorial family shipped + tested + deployed (editorial 18/18), plus 12 premium palettes and ~53 industries. Remaining PT items (visual polish, contextual onboarding, health coach, customer timeline, admin health center, AI memory) are quality-additive, not launch-gating.

## 🟢 CAN WAIT UNTIL v1.1
*Real, but not gating a confident launch.*

| # | Item | Owner | Why |
|---|---|---|---|
| V1 | Migrate writer/coach resolution to the Industry Pack umbrella | 🤖 | Latent duplication; harmless today |
| V2 | `connected_data.prev` → real time-series (unlocks trends) | 🤖 | One-deep history is a ceiling, not a bug |
| V3 | Deprecate the deploy `WARN: sdk.ts` noise | 🤖 | Benign |
| V4 | Marketplace agreement + Agency agreement + Enterprise MSA (once those tiers sell) | 🧑🔒 | Only needed when the tier is live |
| V5 | Public API reference for the routes | 🤖 | Nice-to-have until you have API customers |
| V6 | Status page + formal on-call/release process | 🧑 | Scales with customer count |
| V7 | Shared design tokens/components for future management UIs | 🤖 | Prevents divergence as UIs get built |
| V8 | Deepen restaurant (and other packs') intelligence beyond the current shallow rule sets | 🤖 | Quality, not readiness |

---

## The one-paragraph plan

**Beta is close.** The engine is done and trustworthy; the beta work is almost entirely *plumbing to a front door and basic ops*: push what's built (B1), make the portal show Moments + Concierge (B2), stand up CI + backups + monitoring (B3, B4, B8), and close the two security items (B5, B6). **Public launch** adds the connected UI + legal + a11y + the operator-auth path. **Everything else waits for v1.1.** Do not let the breadth of the platform (marketplace, enterprise, agency) pull the beta scope wide — those are proven foundations that can ship behind a flag and get their UIs after the core product is live and monitored.

---

## Post-freeze customer-facing completions (not beta gates — quality/coverage)
- **Architecture v1.0 migration** — primary nav = outcomes only (Analytics first-class; Settings/Connections/Help → overflow); full customer terminology sweep (Files/Customers/Messages/Website; brand = Studio OS).
- **DAM-1 Files Excellence** — the DAM presented as **Files** (files.html) with where-used usage graph, safe replace/rollback/duplicate, PDF documents (mig 0065). Live-verified against staging (16/16); fixed a real storage-sign bug.
- **AN-1 Analytics Excellence** — first-class Analytics as plain-English understanding (no dashboards, **zero added AI**, **never fabricates** — traffic/search honestly "not measured yet"). Composes existing signals; agency portfolio lens reuses buildPortfolio. The remaining honest gap to make traffic/search *real* = first-party visitor tracking + GA/GSC ingestion (V1.1).
- **AN-2 Analytics Foundation** — privacy-first first-party visitor tracking (cookieless, DNT-honored, no raw IP, bots dropped). One tracker + one /px endpoint + one presence_visits table. Turns Analytics/Health/Journey/Moments/Agency from assumptions into real, plain-English understanding. Zero AI. The remaining honest analytics gap = Search performance (needs GSC ingestion into presence) — V1.1.
- **AN-3 Search Performance** — Google Search Console composed into Analytics by reusing the shared `signals` table (no new store/AI). Honest + auto-activating: renders real Google impressions/clicks/position in plain English the instant data exists, honest "connect Search Console" until then; agency sees who's growing/falling/not-connected. ⚠ Structural: no GSC data flows yet — presence-native GSC ingestion (OAuth app + cron + dimensions) is the owner-gated follow-up (AN-3.1) that turns this ready layer live.
- **DAM-2 Files Approval** — approval-before-publish for in-use files (logo/hero/PDF/menu), reusing the one approval spine (asset_status + Inbox/Today feed + audit + agency portfolio). Staged-replace keeps the live site safe: unapproved files never referenced; approve repoints live, reject discards. Reviewer approves in the same place as everything else. Completes the Files experience.
- **Architecture v1.0 Migration — COMPLETE** — final terminology sweep done (Media→Files, Relationship→Customers, Leads→Messages, Presence→Studio OS brand). Zero forbidden terms remain customer-facing; single-ownership verified; all templates architecture-compliant. Handed to the next phases: Design-System QA (layout/token cohesion) + Integration & Cohesion Audit.

## INT-1 — Integration Fix Pass (result)
Systematic verification of the cross-system flows. All green; the only fix needed was a stale test assertion (the 2 real integration bugs — approval-feed scope leak + reviewer {decision} field — were already fixed in the DAM-2 gap-check).
| Flow | Status | Evidence |
|---|---|---|
| Website → Customers | ✅ | CRM timeline reads presence_form_submissions |
| Website → Files | ✅ | files_integration 16/16; presence.html#media deep-links to /files.html |
| Website → Analytics | ✅ | visits_integration 10/10 (tracker→/px→compose). Note: sites published before AN-2 get the tracker on their next publish |
| Website → Inbox | ✅ | infra plans → pending_approvals (existing) |
| Customers → Inbox | ✅ | inbox reads /forms/inbox → "New messages" |
| Files → Website | ✅ | files_integration + dam2 (replace repoints → publish pipeline) |
| Files → Inbox approvals | ✅ (fixed earlier) | dam2_integration 10/10; feed link now scope-forwarded |
| Analytics → Website | ✅ | publishing insight → /presence.html |
| Analytics → Customers | ✅ | inquiries insight → /leads.html (Messages) |
| Studio → client scope | ✅ (fixed earlier) | scope 14/14 + scoped_access_audit 17/17; feed links scoped |
| Reviewer approvals | ✅ (fixed earlier) | reviewerAllowed + {decision} accepted + reviewer restricted to approve/reject |

Live integration suites: dam2 10/10, files 16/16, analytics 8/8, visits 10/10, search_perf 8/8. Documented-not-broken: shell bell dropdown links to landing (Inbox/Today carry the real per-item links); a new lead shows in Inbox immediately (bell badge counts it via the lead-waiting notice). No production code changes needed this pass.
- **DS-1 Design System** — unified the one competing palette (today/connections/visual-studio → canonical shell tokens); every page but the Website editor is now one continuous surface. Design-system reference written (DESIGN-SYSTEM.md). Open design-direction decision: keep the Website editor's editorial aesthetic or bring it onto shared tokens+dark mode (a scoped redesign, not DS-1). Remaining = visual/responsive/AT QA → belongs to Gold Master QA.
- **AI-1 Cost & Value** — audited all AI: 10/14 surfaces already deterministic (zero tokens). Deferred the eager Growth Coach model tier (was spending portfolio-wide on the cron with no user asking) to explicit requests; metered the previously-invisible Reviewer/Guardian/Coach spend. No new AI, no features removed. Governance follow-up (non-blocking): add a per-model token→cost price table for dollar reporting.
- **EC-1 Experience Cohesion** — audited the product as one OS. Fixed the one gap (Files "where used" now clicks through to the Website editor — Files↔Website loop closed). Decided the Website editor stays a distinctive creative mode (only gap = dark mode → V1.1 visual pass). Leads-in-3-places confirmed intentional (Inbox aggregates, Customers records, Messages details). Remaining cohesion items are visual/responsive/AT verification = Gold Master QA.
- **AN-3.1 Google Search Console** — code complete + tested (reuses OAuth/tokens/signals/cron; proven searchAnalytics call shape; new presence_search_terms store for query/page detail; fixed 2 latent connect bugs). Search shows real impressions/clicks/top-search/best-page in plain English the moment it's connected. ⚠ OWNER-GATED activation (not engineering): create + verify the Google OAuth app (sensitive webmasters.readonly scope → Google review), set CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID/SECRET + CONNECTION_ENC_KEY + STATE_SIGNING_SECRET + SITE_URL, register the callback redirect. Track alongside the other owner activation items. V1.1: countries/devices, coverage/index/sitemap (URL Inspection API).
- **Pre-launch code cleanup** — closed the two open code items: (1) data-retention sweep on the ops cron (presence_visits >180d, presence_search_terms >13mo) so the analytics detail tables stay bounded; (2) operator AI cost view — a per-model token→dollar price table + `/admin/ai-usage` (staff-only, Law 13) so AI spend is legible in dollars (prices are editable, verify vs provider). Plus container-width normalization (crm/connections → the canonical 680px). pricing 10/10; regression green; deployed. Held (need a browser or an owner key, by design): Website-editor dark mode, focus-visible/token-source refactors, GSC countries/coverage, PDF reports, demo/KB.
