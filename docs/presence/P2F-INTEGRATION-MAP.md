# P2-F — Integration Map (mandatory first step)

**2026-07-10.** Code-grounded map of what already exists across the 12 areas, classified, and used directly to execute. Not an audit, not a strategy report. P2-F is an integration/adoption pass — most capabilities already exist (Phase 1 CMS, P2-D projects/messaging/notifications, P2-E billing/entitlement/AI-cost); the work is connecting the genuine seams.

Legend: ✅ integrated (verify+retain) · 🔌 exists-but-disconnected (connect) · 🧩 duplicated entry points (consolidate) · 🐞 defect (fix) · ⏭ defer · 🗑 legacy → P2-G.

| # | Area | Current implementation (file) | Class | Action in P2-F |
|---|---|---|---|---|
| 1 | CMS / website mgmt | presence.html + routes/content.ts, site.ts | ✅ | Retain. Ensure analytics/audit/health/connections surface coherently in the workspace with deep links. |
| 2 | Publishing / preview | routes/publish.ts (one pipeline), preview.ts | ✅ | Retain. Surface publish failures in oversight + Inbox. |
| 3 | Forms → Leads → CRM | commercial.ts (form_submissions) → leads.html → sales.ts (`presence_deals.source_submission_id`, `source='website_form'`) | 🔌🐞 | **Connect+fix:** the data model supports it but conversion has NO duplicate guard and doesn't mark the submission converted → a second click makes a second deal. Add dedupe + submission linkage + consistent "Website enquiry" wording + notice deep-link. |
| 4 | Analytics | routes/analytics.ts (home/website/customers/search/portfolio) — connection-state aware (`gscConnected`, `not_measured`), first-party visits real, search real when connected | ✅ | Retain. Verify status appears consistently (workspace + oversight + health). No fake data — confirmed. |
| 5 | Monitoring / audits / recommendations | routes/review.ts (reviewer engine: deterministic + optional AI, sanitized), guardian (brand), monitor.ts (connection/verify/readiness) | 🔌 | **Connect:** findings are shown but don't LINK to an action. Let a finding open the right CMS edit / create a project task / request approval (Detect→…→Resolve). Approval-gated; never auto-publish. |
| 6 | Connections / OAuth | connections.html + connected/* (customer-owned, AES-GCM tokens, signed state, revocable) | ✅ | Retain. Surface connection state in dependent features (analytics/publishing) with actionable "reconnect" states. (2 med audit items FD-AUD4/5 queued, not this milestone.) |
| 7 | AI drafting | writer/editor/coach/concierge/guardian/visual | ✅ | Retain. Ceiling now enforced on ALL paths (P2-E post-audit fix). |
| 8 | AI usage / allowance / ceiling | commerce/metering.ts | ✅ | Retain. Ensure the ceiling-reached event reaches the Inbox/notice. |
| 9 | Projects / website service work | routes/projects.ts + client_delivery.ts (Agency–Client Bridge) | ✅ | Retain. Website tasks/approvals link to authoritative P2-D project records (via §5 finding→task). |
| 10 | Notifications / Inbox | notifications.ts = VIEW over `presence_project_events` (delivery only); + `presence_plan_notices` card (lifecycle/billing/domain/search/capacity/deletion); + form email | 🧩🔌 | **Connect (no new store):** website-attention events (publish failed, website enquiry, connection expired, AI ceiling reached) are NOT in a unified inbox. Route them through the EXISTING `presence_plan_notices` card with deep-links — one model, no duplicate system. |
| 11 | Studio oversight | analytics/portfolio (agency: growing/needs-attention, leads_waiting, unpublished_changes, last_published_at, attention) + projects studio view (`customer_saas`) | 🔌 | **Connect:** extend the bridge oversight so a linked customer's website status (draft/live, last publish, publish failures, connection/domain, client-actions, SaaS blocker at coarse level) is visible without duplicating customer data. |
| 12 | Client App entry points | client.html (bridge delivery) + presence.html (customer workspace) | ✅ | Retain. Correct deep links into website/page/section/finding/connection/project/support. |

## Genuine gaps to execute (reuse-first, tested)
- **G1 · Forms→CRM continuity (§3)** — dedupe conversion + mark submission `converted` + link deal↔submission + "Website enquiry" wording + deep-link. *Satisfies validation 10/11/21.*
- **G2 · Finding→action (§5)** — a finding can create/link a project task (authoritative P2-D record) or open the right CMS edit; approval-gated; idempotent (no duplicate task on retry).
- **G3 · Unified website-attention notices (§8/§10)** — publish-failed / website-enquiry / connection-expired / ceiling-reached ride the existing notice model with correct deep-links; idempotent (no storms).
- **G4 · Studio website oversight (§2/§11)** — extend the bridge/portfolio so linked-customer website status is visible at the approved coarse level; scope-preserving deep links; no data duplication.

## Deferred / out of scope (justified)
- ⏭ CMS-UX-1 Content Tree / CMS-UX-2 Website Navigator — not moved into P2-F by the roadmap; P2-F only leaves the foundations ready (template-derived metadata, stable deep-link targets, draft/live + validation + completeness signals, publish history, health, searchable labels — all already derivable from the manifest + structured content).
- ⏭ FD-AUD2..17 (post-P2-E audit queue) — real but out of the integration scope; tracked.
- 🗑 P2-G retirement candidates: legacy clever-api commerce/forms/CRM tables; portal.html service sections (superseded by client.html bridge). Mapped, not touched.

## Owner-separate (unchanged, not closed here)
Prod migrations `0075–0084` at launch; production OAuth app + consent screens; Stripe test-mode checks; fenced public pages; push at fence-lift; Phase-6 human QA; credential-dependent provider validation.
