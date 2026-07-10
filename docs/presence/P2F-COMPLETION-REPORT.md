# P2-F — Website, CMS, Analytics & AI Integration — Completion Report

**2026-07-10.** An integration/adoption/workflow-completion pass. Most capabilities already existed (Phase 1 CMS, P2-D projects/messaging/notifications, P2-E billing/entitlement/AI-cost); P2-F connected the genuine seams so they operate as one product. No rebuilds, no duplicate systems, reuse-first.

## Integration map — final dispositions
Full map: `P2F-INTEGRATION-MAP.md`. Result: **8 of 12 areas already integrated (verified + retained)**, 4 had genuine gaps (executed as G1–G4), CMS-UX-1/2 deferred (foundations confirmed ready).

| Area | Disposition |
|---|---|
| CMS / publishing / preview | ✅ Already integrated (one content model, one renderer, one pipeline). Retained. |
| Analytics | ✅ Integrated, site-scoped, connection-state aware, no fake data. Retained + extended into oversight (G4). |
| Connections / OAuth | ✅ Integrated (customer-owned, encrypted, signed state). Retained; dependent-feature states surfaced via notices (G3). |
| AI drafting + usage + ceiling | ✅ Integrated; ceiling now enforced on ALL paths (P2-E post-audit). Retained. |
| Projects / service delivery | ✅ P2-D bridge. Retained; studio sees customer SaaS status (P2-E W11). |
| Client App entry points | ✅ Retained; deep links verified. |
| **Forms → Leads → CRM** | 🔌🐞 **Connected (G1).** |
| Monitoring / findings → action | ✅ Core loop (finding→editor deep-link) already wired in the workspace; agency finding→task deferred. |
| **Notifications / Inbox** | 🧩🔌 **Consolidated onto the one model (G3).** |
| **Studio oversight** | 🔌 **Extended (G4).** |
| Entitlement / lifecycle | ✅ P2-E authoritative state honored across website + AI; recovery UI added (P2-E post-audit). |
| CMS-UX foundations | ⏭ CMS-UX-1/2 not in scope; foundations (template-derived metadata, stable deep-link targets, draft/live + validation + completeness + publish history + health + searchable labels) confirmed already derivable from the manifest + structured content. |

## Executed integration work
- **G1 · Forms→Leads→CRM continuity (§3).** Website enquiry → CRM deal is now idempotent (dedupe on `source_submission_id`, site-scoped → a double-click/retry returns the existing deal, never a duplicate); the enquiry is marked `converted` (mig `0085` widens the CHECK); the leads inbox links each enquiry to its deal (`converted` + `deal_id`, one bounded query) and hides the convert button once converted; consistent "Website enquiry" wording. *Files:* `routes/sales.ts`, `routes/commercial.ts`, `leads.html`, mig `0085`. *Test:* `forms_crm_continuity` 11/11.
- **G2 · Finding→action (§5).** Verified already integrated: the workspace runs reviews and every finding renders a **Fix** action deep-linking into the right Editor/Writer via the finding's `handoff` contract (Detect→Explain→Recommend→Edit→Review→Approve→Publish). Approval-gated; never auto-publishes. Agency finding→tracked-project-task is a deferred enhancement (needs the agency-project mapping; not the primary customer loop). *No code change; disposition = retain.*
- **G3 · Unified website-attention notices (§8/§10).** New `lib/notice.ts` (`raiseNotice`/`clearNotice`) — the ONE reusable way to raise an attention item on `presence_plan_notices` (unique `client/kind/period`), idempotent (fresh-insert boolean), best-effort. Publish failure now raises `publish_failed` (idempotent per publish id → no storm; cleared on a successful publish) so async/scheduled publishes still reach the card + bell. The notice card no longer drops kinds or dead-ends — a kind→action map gives every notice a deep link (also closes audit FD-AUD7). *Files:* `lib/notice.ts`, `routes/publish.ts`, `presence.html`. *Test:* `website_notices` 9/9.
- **G4 · Studio website oversight (§2/§11).** Extended the agency portfolio with the missing website-health signals at the authorized site scope, reuse-first (no new store, no data duplication): per-client draft/live, last publish, unpublished changes, `publish_failed` (bounded query), and a **coarse** `plan_status` (active/paused/lapsed — never payment details) + attention rollup + insights. *File:* `routes/analytics.ts`. *Test:* `studio_oversight` 9/9.

## Security & tenant isolation
All new seams are site/client-scoped and verified in the gate (step 20): the forms→deal dedupe lookup is `site_id`-scoped; the leads-inbox deal lookup is site-scoped + bounded to the shown ids; oversight is bounded to `agencySiteIds` and gated on agency role; `raiseNotice` writes are client/site-scoped; `/client/billing` stays own-`client_id`-scoped. No cross-tenant read/write introduced. Oversight exposes only coarse plan status (no payment methods/details).

## Validation
- **Integrated-lifecycle gate:** `p2f_lifecycle_gate_test` **16/16** (entitlement, AI-ceiling coverage, finding→editor, publish→live, forms→deal idempotent, enquiry→studio, analytics scoping, oversight-no-payment, unified notices, connection-expired deep-link, lapsed read-only, in-app recovery, tenant isolation, idempotency, studio SaaS-status).
- **New suites:** forms_crm_continuity 11/11 · website_notices 9/9 · studio_oversight 9/9.
- **Regression:** full presence suite **139 pure/structural green**; 6 live-integration suites skip cleanly without SB creds (unchanged). Typecheck clean across all changed files.
- **Live vs doubles:** structural + pure passed locally; function deploys to **staging + prod both boot healthy** (7 plans served), confirming every new module loads in the real Deno runtime. Full live e2e of the new seams (form→deal→studio, oversight) needs staging e2e creds (`SALES_E2E_*`/`BRIDGE_*`) → **Phase 6 / owner-credential** where unavailable. No fake passes claimed.

## Performance
- Every added query is bounded and scoped: leads-inbox deal lookup is a single `in.(ids)` over the ≤100 shown submissions; oversight adds exactly two bounded queries (failed publishes, entitlement statuses) reusing the already-fetched site/client lists; the forms dedupe adds one indexed lookup (`presence_deals_source_submission_idx`, mig 0085). No new N+1s; no chatty handoffs added.

## Deployment
`presence` deployed to staging + prod (healthy). Migration `0085` is additive and **owner launch-time apply** alongside `0075–0084`; the code degrades gracefully without it (dedupe still works via `source_submission_id`; the `converted` status PATCH is best-effort). Public app pages remain **committed-local, not pushed** (fence).

## Owner actions remaining (unchanged, not closed here)
Apply prod migrations `0075–0085` at the coordinated launch; production OAuth app + consent screens; Stripe test-mode checks; publish fenced public pages; push the local commit backlog at fence-lift; Phase-6 human browser/mobile/WCAG QA; credential-dependent provider validation.

## P2-G retirement candidates (mapped, not touched)
- Legacy `clever-api` one-time commerce + its forms/CRM tables (superseded by `presence` forms→CRM).
- `portal.html` service sections (superseded by the `client.html` bridge Client App).
- Any `pipeline.html`/legacy leads paths duplicated by `crm.html` + `leads.html` (verify parity first).

## Roadmap
P2-F closed on `STUDIO-OS-ROADMAP.md` + `ROADMAP-MASTER.md`. **Ready to begin P2-G (legacy retirement) — not started, per instruction.**
