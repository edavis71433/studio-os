# P2-D Final Hardening — Agency–Client Bridge + Audit Fixes (completed)

**Status: ✅ COMPLETE (engineering). Jul 10 2026.** Turns the P2-D deep-audit findings into one execution pass: the post-sale journey now connects end to end, client visibility is explicitly scoped by relationship, and the safe correctness + performance fixes and the Inbox/bell unification are all in. Validated live on staging (two-customer bridge isolation 13/13; full 16-step lifecycle 16/16). Deployed staging + prod. Human browser/mobile/keyboard/screen-reader certification stays in **Phase 6 — Gold Master**.

## Architecture selected — and why
**Agency–Client Bridge (linked workspaces).** One authoritative delivery project lives on the **agency/studio site**; the **customer stays in their own workspace** and reaches only their linked, client-visible delivery through an explicit, tenant-safe bridge (`presence_service_links`). Chosen because it is the only model that fits the approved Studio OS direction: multi-tenant, agencies managing many customers, future white-label/licensing, strong tenant isolation, centralized agency operations, and a customer-owned website/account — **without** the customer becoming a member of the agency's private workspace and **without** duplicating the project. (The rejected alternative — customer joins the agency site as a scoped `client_reviewer` — was the exact source of the audit's multi-client leak.)

### The bridge (exact ownership model)
`presence_service_links`: `agency_site_id` (where the project + delivery live) · `project_id` (UNIQUE → idempotent handoff) · `customer_client_id` (the customer) · `customer_site_id` (their own workspace) · `deal_id` (provenance) · `status`. Deny-all RLS, function-mediated. Every `/client/*` action resolves the caller's own `client_id` (`site.client_id`) and **verifies a `service_link` to the target before touching agency-site data** — the isolation gate.

## Conversion → project handoff (automatic, idempotent)
`handleSalesConvert` now completes the whole handoff: create/reuse customer + workspace + login (unchanged) → **create the authoritative project on the agency site + the bridge** (`ensureProjectForDeal`) → stamp `presence_deals.created_project_id` (UNIQUE, race-safe) → agency-portfolio link → onboarding email. Idempotent end to end: re-converting returns the same customer + project, never duplicates (customer, workspace, project, bridge, invite, or onboarding). The manual `POST /projects {deal_id}` routes through the same helper. `pipeline.html` confirms the handoff and links to the project ("Open their project →").

## Client visibility model
- **Studio side** (owner/operator/agency): manages via `/projects/*` on the agency site (unchanged).
- **Customer**: reaches delivery **only** via `/client/*` (bridge-scoped) — projects, tasks, milestones, files (download), approvals (decide, version-guarded), messages, surveys (fill + submit), support, report, notifications. Every read filters `client_visible=is.true`; internal notes/tasks/files/approvals never appear.
- **Leak closed:** the P2-D delivery routes were **removed from the reviewer allowlist** — the site-wide `client_visible` reviewer path that could expose one customer's records to another on a shared site is gone. Client access is exclusively the bridge.

## Correctness fixes (audit §B — all in)
B1 flipping a task to client-action emits a `client_action` event · B2 a deliverable shared after upload emits `deliverable_added` · B3 project-less support now notifies (support folded into the derived feed on both sides) · B4 internal approvals are decidable by a studio role (no dead-end) · B5 support triage pins the prior status in the WHERE (optimistic guard) · B6 deliverable download honors parent-project visibility.

## Performance fixes (audit §D — all in)
D1 `resolveSiteRole` is resolved **once per request** (a per-principal WeakMap memo) — removes a duplicate external `/auth/v1/user` round-trip on the client-portal path · D2 task/milestone create fetch **only the current max** `sort_order` (`order desc limit 1`), not the whole list · D3 added `presence_support_site_recent_idx (site_id, updated_at desc)`.

## Notifications ↔ Inbox/bell (unified)
Derived-from-activity, no second store. **Studio:** open support requests + unread project activity fold into `attention_count` (the shell bell) and `/notifications` folds into the Inbox as "Project activity" (deep-linking to `projects.html?project=…`). **Customer:** their unread bridged delivery folds into their bell; `client.html` shows their projects + a "new updates" count and marks them read. One attention surface per side; internal activity never reaches the client.

## Client & Studio App
- **Client App (`client.html`)** — now the customer's delivery home: their linked projects → a project view with report stats, their to-dos, files (download), approvals (approve/request-changes), the shared message thread, surveys (fill + submit), and support (open a request). Reuses the shell + shared styles; no second portal.
- **Studio App (`projects.html`)** — manages projects/tasks/milestones/files/approvals/messages + report (P2-D-5), reachable directly from the converted deal. Support triage + survey-response review remain a Studio-UI surface for Phase 6 (the APIs are complete + validated).

## Billing boundary for P2-E (no billing built here)
The bridge exposes the exact hooks P2-E needs, with no P2-E code added:
- **Who to bill:** `presence_service_links.customer_client_id` (the customer's `clients.id`) + `customer_site_id` (their workspace) + `deal_id` (the originating sale). The customer's entitlement already lives on their own site (`provisionForSignup`).
- **What to bill for:** the `project_id` (service engagement) and the deal's proposal/contract (agreed price/terms) are all FK-linked. A future `presence_service_plans`/invoice can attach to `customer_client_id` + `project_id` without touching this architecture.
- **Boundary:** the agency owns the delivery project + the commercial relationship; the customer owns their workspace + (future) their subscription. P2-E attaches billing to the customer via the bridge; it does not need to revisit tenancy.

## Files changed
- **Migration:** `0079` (`presence_service_links` + `presence_support_site_recent_idx`).
- **New:** `lib/service_bridge.ts`, `routes/client_delivery.ts`.
- **Changed (backend):** `routes/sales.ts` (convert handoff), `routes/projects.ts` (handoff via bridge, B1, D2, role cache), `routes/project_delivery.ts` (B2, B4, B6), `routes/service_intake.ts` (B5), `routes/project_comms.ts` (B3 studio notifications), `lib/workspace.ts` (D1 role cache + attention_count), `middleware`/`index.ts` (wiring), `routes/workspace.ts` (reviewer leak-fix).
- **Changed (UI):** `client.html` (delivery view), `projects.html`/`pipeline.html` (deep links), `inbox.html` (project activity).
- **Tests:** `bridge_e2e`, `client_delivery_routes` + updated the P2-D structural/e2e suites; `scripts/validate-p2d.mjs`.

## Security & tenant-isolation evidence
`bridge_e2e` (13/13, live, two customers): customer A sees only their linked project; **cannot** open, download from, decide on, or otherwise reach customer B's project (404); acts (approve/download/message/survey/support) only within their link; a foreign/unknown id is 404. Every `/client/*` query is scoped to the **verified** link's `agency_site_id` (+ `client_visible`); the projects list returns only the customer's linked ids; support is per-requester. Service-role queries scope every request-supplied id. Retried conversion/handoff/survey are idempotent. Approval + contract version-integrity (`content_hash` in the WHERE) intact.

## Validation results
- **Live:** bridge two-customer isolation **13/13** · full 16-step lifecycle **16/16** · foundation 21/21 + isolation 9/9 · delivery 19/19 · comms 12/12 · intake 18/18 · report 8/8 · P2-C closing regression 21/21.
- **Offline:** full pure sweep **120 passed / 0 failed / 4 skipped**; structural 26/26 client-bridge + all P2-D suites; **typecheck clean**. Gate: `scripts/validate-p2d.mjs` → ✅ green.

## Deployment status
Function deployed **staging + prod**. Migration `0079` applied to **staging**; **prod apply (0075–0079) is the owner's launch step** (routes dormant until then). App HTML committed-local per the fence.

## Rollback procedure
- Function: redeploy the prior build. Bridge routes vanish; convert still creates customer + workspace (the handoff is best-effort/idempotent and additive).
- Schema: `0079` has an explicit `-- rollback:` block (drop `presence_service_links` + the support index). Deny-all RLS means nothing was client-exposed.
- Data is disposable.

## Roadmap items closed (from `P2D-DEEP-AUDIT.md`)
✅ §A architecture disconnect (bridge + handoff + UI trigger) · ✅ multi-client visibility · ✅ §B B1–B6 · ✅ §D D1–D3 · ✅ §C orphaned client UI (client.html), notifications↔Inbox/bell unification. **Still open (lower value, queued):** §C "Messages" label disambiguation across leads/CRM/project; §E refinements R1 (auto-advance stage events), R3 (`ip_hash`), R4/R5 (event-log fidelity on later visibility flips + field edits), R6 (`expected_value_cents` cap), R7 (handoff lost-claim 409).

## Remaining before P2-E
1. **Owner applies migrations `0075`–`0079` to prod** (routes dormant until then).
2. **Phase 6 Gold Master** human QA of the surfaces (`client.html`, `projects.html`, `inbox.html`, `pipeline.html`) + the Studio support-triage / survey-review UI (APIs complete).
3. §C/§E queued refinements — as capacity allows.

Do not begin P2-E without explicit approval.
