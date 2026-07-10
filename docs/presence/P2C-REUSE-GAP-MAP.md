# P2-C — Sales & Customer Lifecycle: Reuse & Gap Map (mandatory first step)

**Rule:** no code until this map is complete. Legacy `clever-api` is a functional reference only; its data is disposable. **Scope primitive:** every new table is `site_id`-scoped (`references public.presence_sites(id) on delete cascade`, RLS via `my_presence_site_ids()`), mirroring every `presence_*` content table — the studio owner's workspace (their `presence_sites` row) owns the pipeline.

**Verdicts:** REUSE (built) · PARTIAL (extend) · MISSING (build minimal) · DEFER · N/A.

| Lifecycle step | Verdict | What exists (evidence) | P2-C action |
|---|---|---|---|
| **Lead capture** | **REUSE** | `handleFormSubmit` + `/forms/:siteId/submit` (public, rate-limited) → `presence_form_submissions` (0050); `/forms/inbox`. | Reuse as-is. A deal may be *sourced from* a submission (`source_submission_id`). **No second capture system.** |
| **Lead records** (status/owner/notes/pipeline) | **MISSING** | `presence_form_submissions.status` is only `new/read/archived`; no assignment, notes, or stage. | A lead is an early-stage **deal** (below) — one record, not a separate lead table. |
| **Contact / person record** | **MISSING** | CRM's unit is the site/client; **no contact entity** (`crm.ts:1-8`). | New `presence_contacts` — the ONE authoritative person/company record. |
| **CRM lens** | **REUSE** | `routes/crm.ts` + `crm/store.ts loadTimeline` aggregate 8 sources; `presence_relationship_notes` (0048). | Reuse the lens; the pipeline is the new managed layer beside it. Surface deals on `crm.html`. |
| **Opportunity / deal + pipeline** | **MISSING** | No deal/opportunity/stage entity anywhere in presence. | New `presence_deals` — ONE authoritative deal with a **bounded stage ladder** (lead→qualified→proposal→contract→won/lost) + `presence_deal_events` (stage history/activity/audit). |
| **Proposal / quote** | **MISSING** (token PARTIAL) | No quote entity. Signed-accept token `signApprovalToken`/`verifyApprovalToken` (`lib/commercial.ts`) exists but `kind` is fixed to infra/connected. Pricing = `commerce/editions.ts`/`catalog.ts`. | New `presence_proposals` (line items, total, terms, draft/sent/accepted/declined, share token). **Reuse** the HMAC signed-link idiom for the accept link (new `kind:'proposal'`). No document-design engine. |
| **Contract** | **MISSING** | clever-api's is a single global template stub; presence has none. | New `presence_contracts` (body + `content_hash` for version integrity, draft/sent/signed, signed evidence). **Reuse** the signed-link idiom for the sign link. No second contracts system. |
| **Convert to customer** | **PARTIAL — both halves exist, disconnected** | `createContactAndClient` (`commerce/account.ts:62`) makes the `clients` row; `provisionForSignup` (`commerce/provision.ts:55`) is **idempotent** and makes entitlement + `presence_sites` + Netlify + seeds + `presence_first_run`. They are not bridged (`PHASE-2-EXECUTION-PLAN.md:42`). | New **idempotent** `/sales/deals/:id/convert` that bridges them: create/locate the client → `provisionForSignup` → record `converted_client_id`/`converted_site_id` on the deal (retry = no-op). **No legacy migration.** |
| **Workspace / site provisioning** | **REUSE** | `provisionForSignup` (idempotent; entitlement+site+Netlify+seeds). | Called by convert. Unchanged. |
| **Membership / access** | **REUSE** | Access via `contacts.auth_user_id`/email linkage (`my_client_ids`); extra people via `presence_site_members` (0045). | Convert seeds the client's identity; access follows the existing email linkage. Optionally add a `presence_site_members` owner row. |
| **Onboarding / welcome** | **REUSE** | `presence_first_run` (0036) + `handleFirstRun` derived checklist; `lib/onboarding.ts` intake→writer; `get-started.html`/`welcome.html` ("new customers land in guided first-run"). | Convert leaves the new site in the **existing** first-run onboarding. **Do not rebuild** — integrate (the new customer lands in `get-started.html`). |
| **Notifications / status continuity** | **REUSE** | `sendEmail` (`account.ts:88`), `notifyOwnerOfLead`, and the send-once `presence_plan_notices` insert-then-email pattern (`lifecycle.ts`). | Reuse for proposal-sent / accepted / contract-signed / converted, and surface on `inbox.html`/bell. |
| **Studio App host surfaces** | **REUSE** | `crm.html` (Customers), `leads.html` (Messages), `inbox.html` — all on the shell. | Add the pipeline UI here (deep-linkable), on the shell + shared states. **No one-page-per-action.** |
| Forecasting / scoring / automation / document design | **N/A (out of scope)** | — | Explicitly excluded per the prompt (avoid enterprise-CRM complexity). |

## The connected chain (tenant-scoped, auditable, no duplicate truth)
`form_submission?` → **`presence_deals`** (→ `presence_contacts`) → **`presence_proposals`** → **`presence_contracts`** → convert → **`clients.id`** (`converted_client_id`) → **`presence_sites.id`** (`converted_site_id`) → access. Each link is an FK column on the row; every row carries `site_id`; convert is idempotent via `converted_client_id`.

## What is built vs reused
- **Built (minimal, multi-tenant):** `presence_contacts`, `presence_deals`, `presence_deal_events`, `presence_proposals`, `presence_contracts` + coherent `/sales/*` routes + pure logic (`lib/sales_lifecycle.ts`) + the idempotent convert bridge + a pipeline surface on `crm.html`.
- **Reused (unchanged):** form capture, `provisionForSignup`, first-run onboarding, `sendEmail`/notices, the HMAC signed-link idiom, the shell + shared states, the CRM lens.

## Legacy eligible for deprecation *after verified parity* (not now)
Once this workflow is live + verified, the customer-facing legacy that becomes redundant: clever-api `lead_intake`/`lead_convert`, `quote_*`, `contract_*`, `opportunity_*` (the sales surface) — flagged for P2-G, **not** retired here. DDS-private ops untouched.
