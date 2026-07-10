# Studio OS — Phase 2: Capability Rebuild, Optimization & Legacy Retirement (Execution Plan)

**Status:** approved direction · P2-A complete (classification frozen) · P2-B+ not started. **Date:** 2026-07-09.
**Predecessor:** Phase 1 complete ([PHASE-1-COMPLETION-REPORT.md]).

## Approved direction
Rebuild the capabilities that belong in Studio OS **using the correct multi-tenant architecture, optimizing them as they are rebuilt**, validate feature parity, then retire the obsolete `clever-api` implementation and its disposable data. **This is not a data migration and not a code transplant** — the legacy system is a *functional reference*, not the target. Legacy `clever-api` records are fake/test/demo and **disposable** (no migration, export, or preservation). `clever-api` is removed only after its retained capabilities reach **verified parity**. **Optimization is part of Definition of Done for every capability** — not a later cleanup pass.

The final signed-in product resolves to exactly two apps: **Studio App** (business/agency owner, operator, team) and **Client App** (the customer's workspace: projects, communication, approvals, billing, files, website, ongoing service). **No duplicate portals or duplicate workflows.**

---

## Evidence base (why the classification below is what it is)

- **Two different products today.** `presence` = the multi-tenant SaaS (RLS + edition gating). `clever-api` = Davis Digital Studio's **single-tenant** internal console (`TENANT_ID`/`ERIC` hardcoded, `_shared/auth.ts:19`, index.ts:14), ~185 `body.type` routes across ~20 feature areas in one 12,029-line file, on its own `dds-admin-auth` realm. **The only shared code is `_shared/auth.ts`** — no `presence` route replaces any `clever-api` internal-ops responsibility. So worthy capabilities are **rebuilt multi-tenant**, not migrated.
- **The two-app frame largely exists.** `shell.js` ("Unified Workspace Shell") already drives **18 signed-in pages on one auth realm** (`dds-portal-auth`) with a server-side `buildNav` that gates Studio vs Client by role/edition. Consolidation is *folding outliers in + retiring duplicates*, not building two apps from zero.
- **Two parallel lifecycles.** The product path (`signup → provision → Client App → CMS → publish → live → forms → product CRM`) is automated and Phase-1-hardened. The studio path (clever-api `leads → convert → invoices`) is a separate, single-tenant reference for what the multi-tenant Studio App should offer.

---

## Part 1 (P2-A) — Capability Classification (FROZEN)

Each capability is classified **A** (already in Presence — adopt), **B** (rebuild multi-tenant), **C** (private DDS ops — isolate, temporary), **D** (remove after parity), or **E** (future phase). Fake data is disposable and is not preserved in any classification.

| Capability | Class | Evidence / rationale | Where it lands |
|---|---|---|---|
| Website management / CMS / Publish | **A** | Presence CMS, Phase-1 hardened (one renderer, one pipeline) | P2-F (integrate) |
| Forms — visitor capture | **A** | `presence` `/forms/:siteId/submit` + `/forms/inbox` (index.ts:114) → `presence_form_submissions` | P2-C (feeds leads) |
| Analytics (per-site) | **A** | `presence` `/analytics/*` + `/px/:siteId` → `presence_visits` | P2-F |
| Connections / integrations (Google/GA/GSC) | **A** | `presence` `/connections/*` + `/monitor/*` (multi-tenant, encrypted tokens) | P2-F |
| Concierge / AI content drafting / coach / review / brand | **A** | `presence` `/concierge`,`/writer`,`/editor`,`/coach`,`/brand` | P2-F |
| Audits (monitoring engine) | **A** | `presence` `/monitor` observation engine | P2-F |
| Team permissions / roles (RBAC) | **A** | `presence` multi-tenant workspace roles (`workspace_roles`) | P2-B |
| Account settings / identity | **A** | `presence` identity/settings | P2-B |
| Notifications (foundation) | **A / B** | `presence` moments + notify exist; extend for Studio/Client events | P2-D |
| Product CRM lens (read-only) | **A → B** | `presence` `/crm/*` aggregates a customer's signals (`crm/store.ts`); extend into a real pipeline | P2-C |
| **Leads — management/pipeline** | **B** | capture exists (A); managing/assigning/status/convert does not. Rebuild on `presence_form_submissions` | **P2-C** |
| **CRM — contacts + relationship** | **B** | extend the lens into managed contacts + interaction history, multi-tenant | **P2-C** |
| **Sales pipeline / lightweight opportunities** | **B** | a simple stage board per tenant (not clever-api's signals-driven auto-sync engine) | **P2-C** |
| **Proposals / quotes** | **B** | agency sends a priced proposal to a prospect; rebuild simply, multi-tenant | **P2-C** |
| **Contracts (per-deal + acceptance)** | **B** | clever-api's is a single global template stub — rebuild as a per-deal record with an acceptance state | **P2-C** |
| **Convert-to-customer + onboarding** | **B** | bridge sales → a provisioned Client App workspace (today `lead_convert` and `provisionForSignup` are disconnected) | **P2-C** |
| **Projects / tasks / milestones** | **B** | client-service delivery surface for both apps | **P2-D** |
| **Files (project/deliverable)** | **A → B** | `presence` DAM + `files.html` exist; extend to project-scoped files | **P2-D** |
| **Messaging (Studio ↔ Client)** | **B** | rebuild threaded messaging multi-tenant | **P2-D** |
| **Approvals** | **A → B** | `presence` change-approval exists; extend to service/deliverable approvals | **P2-D** |
| **Surveys / discovery intake** | **B** | onboarding + discovery, multi-tenant | **P2-D** |
| **Support** | **B** | lightweight request/ticket tied to a workspace | **P2-D** |
| **Reporting (client-facing)** | **B** | periodic client report from existing signals | **P2-D** |
| **Invoices / payments / subscriptions / entitlements** | **A → B** | `presence` `/commerce/*` + `stripe-webhook` provision subscriptions today; extend to agency-bills-its-client invoices (reuse Stripe — no 2nd billing system) | **P2-E** |
| **Dunning / cancellation / refunds / account deletion / billing notices / Terms** | **B** | the account-lifecycle gaps (were Phase 4) — fold into the billing workflow | **P2-E** |
| Client archive / record lifecycle | **B** | part of account lifecycle | P2-E |
| Growth Partnership program (~1,200 lines) | **C → E** | DDS's specific client-growth program; keep internal now, productize later if demanded | isolate (C); future (E) |
| Prospecting / cold outreach (discover/insights) | **E** | speculative for launch; not a complete customer workflow yet | future |
| Signals / intelligence / reasoning BI | **C → E** | DDS-internal book-of-business BI; not a customer surface | isolate; future |
| Opportunity auto-sync engine (signals-driven) | **E** | heavy; the simple pipeline (B) covers launch | future |
| Visibility / rank-tracking | **D** | duplicates `presence` monitor/analytics | remove after parity |
| Admin DB console (`admin_db`/`admin_write`) | **C → D** | raw allow-listed table console; keep internal only while DDS needs raw access, then remove | isolate → remove |
| Calendly integration | **C** | DDS's own calendar; internal | isolate |
| Revenue vitals / practice pulse | **C → E** | DDS-internal BI | isolate; future |
| Duplicate client portals (`portal.html`, `portal-workspace.html`) | **D** | superseded by the Client App (`today.html`/`presence.html`) | remove after redirect |
| The 185-route `body.type` RPC shape | **D** | replaced by coherent REST resources; do not reproduce | remove with the function |
| Dead probes / `version` / experimental AI helpers | **D** | obsolete | remove |
| Auth (`_shared/auth.ts`) | **A** | already shared | keep |

### Frozen rebuild list (category B — the Phase 2 build scope, grouped by milestone)
- **P2-C — Sales & Customer Lifecycle:** leads management · CRM (contacts + pipeline) · lightweight opportunities · proposals/quotes · contracts (per-deal + acceptance) · convert-to-customer · onboarding.
- **P2-D — Projects, Communication & Service Delivery:** projects · tasks · milestones · project files · messaging · notifications · surveys/intake · approvals · support · client reporting.
- **P2-E — Billing, Entitlements & Account Lifecycle:** invoices · payments · subscriptions · entitlements · dunning · cancellation · refunds · account deletion · billing notices · Terms alignment.
- **P2-B / P2-F** are mostly A (adopt/integrate) + shell/nav/design-system consolidation.

**No previously approved capability is dropped:** everything is Kept (A), Rebuilt (B), Isolated (C), Removed-after-parity (D), or explicitly Deferred (E) with a home.

---

## Part 2 — Consolidated milestones (fewest sensible end-to-end workflows)

| # | Milestone | Delivers (a complete, testable workflow) | Absorbs (former roadmap items) |
|---|---|---|---|
| **P2-A** | **Product Boundary & Legacy Freeze** *(this document — COMPLETE)* | The frozen A/B/C/D/E classification + rebuild list + retirement toggles/rollback rules + disposable-data confirmation. | WS1 scoping |
| **P2-B** | **App Shells, Navigation & Shared Foundations** | Studio App + Client App shells on one realm; server `buildNav`; design-system adoption; retire the duplicate shells (`portal.html`/`portal-workspace.html` → redirect). Auth + workspace-context continuity. | WS1, WS4 (nav/discoverability) |
| **P2-C** | **Sales & Customer Lifecycle** | Visitor → lead → CRM/pipeline → proposal/quote → contract → **convert → provisioned Client App** → onboarding, end-to-end, multi-tenant. | WS2 (cohesion), the lead→customer bridge |
| **P2-D** | **Projects, Communication & Service Delivery** | Projects/tasks/milestones · messaging · notifications · files · surveys · approvals · support · reporting — the ongoing service loop across both apps. | WS2, WS3 (trust), WS4 (client experience) |
| **P2-E** | **Billing, Entitlements & Account Lifecycle** | Invoices/payments/subscriptions/entitlements + dunning/cancellation/refunds/account-deletion/Terms — on the existing Stripe infra (no 2nd billing system). | **former Phase 4 billing-lifecycle items** |
| **P2-F** | **Website, CMS, Analytics & AI Integration** | Integrate the Phase-1 CMS + analytics + audits + AI + connections into the two-app experience; cross-surface deep links; Client↔Studio handoffs. **Do not rebuild Phase 1.** | WS3, Website Navigator deps |
| **P2-G** | **Legacy Retirement & Capability-Parity Verification** | Verified parity → remove disposable data, obsolete pages/routes/tables (dependency-checked, staged), unused secrets/jobs; redirect old URLs; final legacy-retirement report. | WS1 (clever-api sunset) |

*(Former Phase 2 WS1–WS4 and the Phase-4 billing-lifecycle bullets are re-expressed here with nothing lost — see "Absorbs".)*

---

## Part 3 — Definition of Done (every milestone)
1. Functional implementation · 2. Architecture review · 3. Security review · 4. **Tenant-isolation tests** · 5. Type checking · 6. Unit + integration tests · 7. Full regression (the 94-suite sweep stays green) · 8. Performance **measurement or measurement tooling** · 9. Accessibility (WCAG 2.2 AA) + mobile verification · 10. Structured logging + actionable errors · 11. Docs · 12. Roadmap update · 13. Legacy-replacement mapping · 14. Remove superseded duplicate code where safe · 15. Commit + deploy · 16. Stop for review.

**Optimization is part of DoD, not deferred.** Each rebuilt capability passes an optimization pass across: **Architecture** (reuse shared modules; one source of truth; small composable modules over big route files; pure rules separated from I/O; preserve the one-renderer/one-pipeline rules), **Database** (authoritative tenant/workspace ownership on every row; tenant-scope every request id; no unbounded queries; indexes only for real query patterns; FKs to prevent orphans), **API** (coherent resources not the 185-route shape; return only what the screen needs; idempotent writes; stable error contracts; no chatty patterns), **Front-end** (consolidate into the two shells; shared components/tokens; empty/loading/saving/success/error/**conflict** states; WCAG 2.2 AA; keyboard + AT; mobile-first), **Performance** (budgets + measured, not claimed), **AI** (cheapest sufficient model; minimal context; deterministic-first; token/cost recording; tenant ceilings; review before consequential actions; injection + cross-tenant safe), **Security** (authz + tenant isolation + service-role special review), **Operational** (extend the Phase-1 foundation; no second monitoring system). Optimization must be **evidence-based, not speculative** — do not overengineer for imagined scale.

---

## Part 4 — Legacy data & retirement policy
Legacy `clever-api` data is **disposable**: no migration scripts, no preserving fake records, no compatibility around test IDs, no blocking retirement on lost demo state. **Before any destructive removal, verify only:** no real production customer data exists; no record is required for legal/tax/billing/audit; no active Stripe payment/invoice/webhook/entitlement depends on it; no retained page or job still references the table/route. Then deletion is approved. **Retirement is staged** (deprecate → verify zero traffic → remove → redeploy) — never a blind delete of the whole function before dependency verification. Every page retirement is a **redirect toggle**; every route removal is preceded by a **deprecated shim** — both instant to reverse.

---

## Dependencies · Risk · Rollback · Testing

**Dependencies:** P2-A (this) gates the phase. P2-B (shells) precedes the workflow rebuilds. P2-C→D→E build on shared shells/roles. Stripe's project-wide secret couples `presence` + `stripe-webhook`; billing work must preserve the webhook's `invoice_id`/`order_id`/`mode=subscription` branching. The go-live fence keeps all of Phase 2 (signed-in app UI) committed-local until fence-lift. CI-as-required-gate (Phase-1 owner item) should be active before the large front-end refactors.

**Risk (top):**
1. **Scope explosion** — rebuilding sales/CRM/projects/billing multi-tenant is a large surface; the decision filter + "fewest end-to-end milestones" + deferring C/E items are the guard.
2. **Front-end refactor regressions** — migrating `presence.html`'s bespoke `api()` (which carries the M9 optimistic-lock logic) to shared components could break the save/lock path; the M9 tests are the guard and `If-Match` handling must be preserved.
3. **Premature legacy removal** — removing a `clever-api` route still referenced by a retained page/job. Guard: the staged deprecate→zero-traffic→remove gate + a "no retained page references clever-api" grep.
4. **Billing correctness** — a second billing path or a broken webhook branch could drop charges. Guard: reuse the one Stripe infra; parity + idempotency tests.

**Rollback:** redirect toggles (pages), deprecated shims (routes), page-by-page front-end ships (one page per PR), no destructive DB work until P2-G's dependency-verified staged removal.

**Testing:** the 94-suite pure sweep green after every milestone; new tenant-isolation + parity tests per capability; structural gates ("no customer page references clever-api", "product pages on `dds-portal-auth`", "one nav system"); staging integration for each end-to-end workflow; continuous accessibility/mobile checks (not deferred to P2-G).

---

## Safest first coding milestone
**P2-B — App Shells, Navigation & Shared Foundations.** It is **backend-stable** (adopts existing `presence` + `shell.js` + `components.css`, builds no new data model), it establishes the ONE frame every later rebuild plugs into, and its riskiest edit — moving `presence.html` onto the shared shell/components — is guarded by the existing M9 optimistic-lock tests (the shared `api()` must keep `If-Match`). Retiring the duplicate portals is a redirect toggle (instant rollback). It delivers visible consolidation value with the least architectural risk, and unblocks P2-C/D/E by giving them a shell to build into.

## Highest-risk part of Phase 2 (updated for the rebuild direction)
**Scope discipline across the P2-C→P2-E rebuild** — because the approved direction legitimately expands Studio OS from "a hardened CMS" into "an agency operations + client-service platform," and the reference system (`clever-api`) is ~20 feature areas / 12k lines. The danger is no longer *breaking DDS's live business* (the data is disposable, so that risk is gone) — it is **the rebuild never converging**: each capability (CRM, pipeline, projects, billing) can absorb unbounded effort, and "optimize as you go" can drift into speculative infrastructure. Evidence: the sheer breadth of Part 2's capability list and the 1,200-line growth-partnership area alone. The mitigation is structural and already applied here: the **decision filter** (build only launch/near-term customer/operator workflows), **C/E deferral** of the heaviest DDS-specific surfaces, **fewest end-to-end milestones** (a milestone must deliver a *complete workflow*, not a feature fragment), and the **evidence-based, non-speculative** optimization rule.
