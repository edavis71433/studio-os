# Studio OS — Frozen Architecture (authoritative)

**Frozen Jul 10 2026.** This is the authoritative ownership model. Changes require an explicit architecture decision, not a milestone.

## Agency–Client Bridge (the ownership model)
- The **agency/Studio workspace** (`presence_site`) owns its centralized internal operations (sales pipeline, delivery projects, internal notes/tasks/files/reporting).
- Each **customer** owns their **own** workspace (`presence_site`) — website, CMS, analytics, account, and (P2-E) their SaaS subscription.
- Agency ↔ customer are connected by an **explicit, tenant-safe relationship**: `presence_service_links` (per-project bridge) + `presence_customer_agency` (the customer's ONE primary agency).
- **One authoritative service-delivery model**, exposed through scoped views: the Studio App manages on the agency site (`/projects/*`); the customer sees only their linked, client-visible delivery through the bridge (`/client/*`) on their own site. Projects, tasks, milestones, deliverables, messages, surveys, approvals, support, notifications, and reports are **never duplicated** across workspaces.
- **Clients are never general members of the agency's private workspace.** Internal notes, private tasks, private files, internal reporting, and private activity are hidden from clients.
- Agencies retain **centralized oversight** of linked customers (agency scope-switching + portfolio).
- **Customer access is by explicit relationship + project scope**, never a broad site-wide client role. Every `/client/*` action resolves the caller's own `client_id` (`site.client_id`) and verifies a `service_link` before touching agency-site data.

### The invariant (enforce forever)
> No feature may let a customer read agency-internal data or another customer's data except through a verified `presence_service_links` row. Every cross-workspace capability attaches to the bridge, never ad-hoc.

## Launch constraint — one primary agency per customer
- A customer workspace links to **exactly one** primary agency/Studio workspace.
- **Enforced** by `presence_customer_agency` (PK on `customer_client_id`) + `ensureBridge()` (a customer already owned by a different agency is refused).
- **Future multi-agency** is designed for without replacing the core model: relax by dropping the PK → composite `(customer_client_id, agency_site_id)` + a `primary` flag. `presence_service_links` already supports many links. **Multi-agency is deferred; do not build it now.**

## Billing boundary (frozen for P2-E)
- The **customer workspace** is the authoritative owner of its SaaS subscription, plan, entitlements, AI usage, and platform account lifecycle.
- The **agency/Studio** may be the seller/service provider for project-based work.
- **SaaS billing and service billing stay distinguishable** — one Stripe integration, one webhook authority, explicit billing-purpose metadata, and internal record relationships. Never an ambiguous merged invoice/subscription.
- Project/service records may **reference** billing objects but must **not** be the billing source of truth.
- The bridge may **authorize agency visibility/management** without transferring customer ownership.
- **No duplicate** Stripe customer, subscription, entitlement, invoice, or usage systems.

## Where the tables live
- Bridge: `presence_service_links` (0079), `presence_customer_agency` (0080).
- Service delivery (agency site): `presence_projects`/`_milestones`/`_tasks`/`_project_events` (0075), `presence_deliverables`/`_approvals` (0076), `presence_project_messages`/`_activity_reads` (0077), `presence_surveys`/`_survey_responses`/`_support_requests`/`_support_messages` (0078).
- Sales (agency site): `presence_deals`/`_contacts`/`_proposals`/`_contracts`/`_deal_events` (0074).
- Customer workspace: `presence_sites`, `presence_entitlements`, CMS/media/analytics (pre-existing).
