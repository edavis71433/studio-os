# Phase A6 — Client Portal Visibility & Permission Model

*Architecture + permissions review and **design** (no build). Verifies who can see what across the admin, agency, operator, and client surfaces, and designs the freelancer/agency → end-client visibility model. Grounded in the code.*

---

## Executive Summary

Studio OS already enforces the **hard separations** safely: three distinct principals (**staff/operator**, **agency** with 9 roles × scope, **client/business customer**) on separate surfaces, with deny-all RLS + JWT-scoped tenant isolation. A client sees only their own site; they cannot reach the admin tool, the agency portfolio, or another client. The **baseline Studio OS CRM** even ships a real client-visibility model — `client_visible` flags + RLS (`content_client_read`, `events_client_read`) + `client_facing_label`, controlled from the admin tool — so an operator already chooses which **CRM** items (projects, events, content calendar, messages) a client sees, with internal notes defaulting to private.

**The gap is granularity inside the Presence product.** The Presence surfaces (Business Moments, drafts, AI drafts, Visual Studio assets, CMS pages, connected data, reports, approvals) have **no per-item "expose to client" control** — the business owner sees their whole workspace. That is correct when the client *is* the primary user, but it does not yet support the milestone's scenario of a freelancer/agency doing work and **selectively exposing Presence items** to an end client, with a **read-only stakeholder** view and **Presence-scoped internal notes**.

**Verdict:** a freelancer/agency can use Studio OS with a customer **safely today** (isolation, admin/client separation, and CRM-level client-visibility all hold); the **agency-controlled granular exposure of Presence items** is the piece to build. Designed below; not built.

---

## Audience Matrix (audience → how it maps to the code today)

| Audience | Maps to (today) | Reality |
|---|---|---|
| Platform owner | `staff` principal | ✅ exists; **not distinguished** from sysadmin/operator in code (all `staff`) |
| System admin | `staff` | ✅ exists; same collapse |
| Operator | `staff` (admin tool `dds-studio-manage`) | ✅ exists |
| Freelancer | `agency` (owner role) or solo `staff` | ✅ exists |
| Agency owner | `agency` role `owner` | ✅ full caps |
| Agency staff | `agency` roles (`admin`/`account_manager`/`content_strategist`/`designer`/`developer`/`support`/`readonly`) | ✅ role×scope |
| Business customer | `client` principal (portal.html / presence.html, own site) | ✅ tenant-isolated |
| Client of freelancer | `client` (a site in the agency portfolio) | ✅ isolated; ⚠️ no granular exposure control (Presence) |
| Read-only stakeholder | — | ❌ **no view-only client role** (gap) |
| Developer | — | ❌ **no developer principal** (Developer Mode is future) |
| Enterprise admin | `agency` role scoped to an org | ✅ via `scopeOrg` |
| Organization admin | `agency` scoped to an org tree | ✅ via `scopeOrg` |
| Location admin | `agency` scoped to a site | ✅ via `scopeSite` |

## Surface Visibility Matrix (surface × audience — current)

Legend: ✅ full · 👁 read · ⚙ operate (scoped) · ❌ none · ⚠️ present-but-ungranular

| Surface | Operator/Staff | Agency (by role×scope) | Business customer | Client of freelancer | Read-only stakeholder |
|---|---|---|---|---|---|
| Admin portal (`dds-studio-manage`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agency portal (`/agency/*`) | ✅ (staff) | ⚙ (portfolio scope) | ❌ | ❌ | ❌ |
| Customer/Client portal (`portal.html`) | 👁 (support) | ⚙ | ✅ own site | ✅ own site | ❌ (no role) |
| Presence workspace (`presence/today/connections/visual-studio`) | ⚙ | ⚙ (bulk_observe/publish) | ✅ own | ⚠️ all-or-nothing | ❌ |
| CMS / Business OS | ⚙ | ⚙ | ✅ own | ⚠️ | ❌ |
| Connected Platform | ⚙ | ⚙ (manage_connected) | ✅ own (approve) | ⚠️ | ❌ |
| Business Moments | 👁 | 👁 | ✅ own | ⚠️ | ❌ |
| Concierge | — | — | ✅ own | ⚠️ | ❌ |
| AI Writer / Visual Studio | ⚙ | ⚙ | ✅ own (approve) | ⚠️ | ❌ |
| Publishing / Approvals | ⚙ (staff bypass entitlement) | ⚙ (approve_plans) | ✅ own (approve) | ⚠️ | ❌ |
| Billing / Invoices | ✅ | 👁 | ✅ own | ✅ own | ❌ |
| Files / Media | ⚙ | ⚙ | ✅ own | ⚠️ | ❌ |
| Comments / Messages | ✅ | ✅ | ✅ (client_visible, CRM) | ✅ (client_visible) | ❌ |
| **Internal notes** | ✅ | ✅ | ❌ (CRM `client_visible=false`) | ❌ | ❌ |
| Audit logs | ✅ | 👁 (scoped) | ❌ | ❌ | ❌ |
| Notifications | ✅ | ✅ | ✅ own | ✅ own | ❌ |

**The ⚠️ column is the design target:** Presence items are all-or-nothing for the end client today.

## Client Portal Visibility Model (design — not built)

Extend the **existing** baseline pattern (`client_visible` + RLS + an operator toggle) to the Presence surfaces, so a freelancer/agency chooses, per item or per surface, what the end client sees:

| Item the agency can expose | Recommended default | Control |
|---|---|---|
| Business Moments | **Shared** | per-site toggle |
| Drafts (content/AI) | **Internal until shared** | per-draft toggle ("share with client") |
| Creative work / AI drafts | Internal until shared | per-item |
| Visual Studio assets | Internal until approved/shared | per-asset (approved → shareable) |
| CMS pages | Shared (published) / Internal (draft) | by publish state |
| Media | Shared | per-item optional |
| Connected data | Shared (read numbers) | per-connection toggle |
| Reports | Shared | per-report |
| Approvals | **Shared** (the client approves) | always visible to the approver |
| Publishing status | Shared | always |
| Invoices | Shared (own) | always |
| Messages | `client_visible` (exists in CRM) | per-message |
| Files | Per-file toggle | per-file |
| Support requests | Shared | always |
| Final deliverables | **Shared** (explicitly) | per-deliverable "deliver to client" |
| **Internal notes** | **Never** (unless intentionally shared) | explicit share action, off by default |

**Mechanism (proposed, consistent with the frozen architecture — additive, no redesign):** a `client_visible boolean` (or a `shared_at timestamptz`) column on the relevant Presence tables, defaulted per the table above; the client's Presence workspace filters on it (handler/RLS), and the operator/agency surface gains a "share with client / keep internal" toggle. This mirrors the baseline CRM exactly — no new architecture.

## Permission Gap Analysis

| Capability needed | Exists? | Gap |
|---|---|---|
| Tenant isolation (client ↔ client) | ✅ RLS + `resolveSite` | none |
| Admin/agency/client surface separation | ✅ separate pages + principals | none |
| Agency RBAC (role × scope) | ✅ `agency/permissions.ts` | none |
| CRM client-visibility (`client_visible`) | ✅ baseline | none |
| Internal notes stay private | ✅ CRM `client_visible=false` | none for CRM; ⚠️ **no Presence-scoped internal notes** |
| **Per-item Presence client-visibility** | ❌ | **build** (the model above) |
| **Read-only stakeholder client role** | ❌ | **build** (a view-only `client` variant) |
| Distinct platform-owner vs sysadmin vs operator | ❌ (all `staff`) | optional finer operator RBAC (V1.1) |
| Developer principal | ❌ | future (Developer Mode) |
| Unified "share to client" control across surfaces | ❌ | build (UI + the flag above) |

## Admin Portal Review

`dds-studio-manage-9k2p.html` is the operator/agency admin tool (staff-authenticated, `noindex`), fully separate from the client portal. It already exposes `client_visible` controls for CRM items and role-based access. **Clean separation confirmed** — no client can reach it (staff auth + different surface).

## Client Portal Review

`portal.html` ("Client Portal") + the Presence workspace (`presence/today/connections/visual-studio`) are the client-facing surfaces, tenant-scoped to the caller's own site. States, ownership, and calm language are in place. **The one weakness for the agency scenario:** the client sees their entire Presence workspace — there is no agency-controlled "this is internal / this is shared" layer yet.

## Agency / Freelancer Scenario Review

- **Freelancer/agency operates** via the admin tool + `/agency/*` (portfolio, roles×scope) — cannot be seen by clients.
- **Each client business** is a tenant-isolated site; the client sees only their own portal/workspace.
- **Selective exposure:** works today at the **CRM** layer (`client_visible` deliverables, internal notes private); does **not** yet work at the **Presence** layer (all-or-nothing). To fully deliver "the customer only sees what the freelancer exposes" for Presence-heavy work, the Client Portal Visibility Model above must be built.
- **Read-only stakeholder** (e.g., the client's manager who should view but not edit/approve) has no role today.

## Security Review (verified)

- **No client can see another client** — deny-all RLS + `resolveSite(jwt)`. ✅
- **No customer can see freelancer internal work** — CRM internal items are `client_visible=false`; the admin/agency surfaces require staff/agency auth. ✅ *(Presence has no internal-vs-shared split yet — but nothing agency-internal currently lives in the client's Presence workspace; it's the client's own content.)*
- **No customer can see admin tools** — separate surface + staff auth. ✅
- **No end client can see platform-owner tools** — same. ✅
- **No shared portal item can leak internal notes** — internal notes default private; the designed Presence model keeps internal notes "never client-visible unless intentionally shared." ✅ (by design)
- **No approval can be forged** — approvals ride the DB `requires_approval` CHECK + atomic claim; the approver is the authenticated principal. ✅
- **No publish can bypass approval** — publishing is the versioned draft→approve→publish ritual; the Approved-Plan spine gates external changes. ✅

## Recommended Implementation Plan (design only — do NOT build now)

**Phase 1 — Presence client-visibility flags (additive).** Add `client_visible`/`shared_at` to the Presence surfaces the agency should control (drafts, AI drafts, visual plans, reports, connected summaries, files), with the defaults in the model above; filter the client workspace on them. Mirror the baseline pattern; no new architecture.
**Phase 2 — "Share with client" control** in the operator/agency surface (per-item toggle) + a "delivered" state for final deliverables.
**Phase 3 — Read-only stakeholder** — a view-only `client` role (see, no edit/approve/connect/publish), invitable by the agency/business.
**Phase 4 — Presence-scoped internal notes** — an agency-internal note surface attached to a client's Presence site, `client_visible=false` by default, with an explicit "share" action.
**Phase 5 (optional) — finer operator RBAC** — split platform-owner / sysadmin / operator if governance requires it.
*(Sequencing recommendation; all additive; approval/publish/isolation contracts unchanged.)*

---

## Final Questions (answered honestly)

- **Can a freelancer use Studio OS with a customer safely today?** **Yes** — isolation, admin/agency/client separation, agency RBAC, and CRM client-visibility all hold; a client can only ever reach their own tenant-scoped portal.
- **Can the customer only see what the freelancer exposes?** **At the CRM layer, yes** (`client_visible`). **At the Presence layer, not granularly yet** — the client sees their whole Presence workspace; per-item agency-controlled exposure is the piece to build (designed above).
- **Can internal notes stay private?** **Yes** — CRM internal notes default `client_visible=false`; the designed Presence model keeps internal notes private-by-default. (No agency-internal notes live in a client's Presence workspace today.)
- **Can the admin portal and client portal remain clearly separated?** **Yes** — separate surfaces + separate principals + staff auth; verified.
- **Are permissions strong enough?** **For isolation and agency RBAC, yes.** For *granular client-facing exposure of Presence items* and a *read-only stakeholder*, **not yet** — those are the defined gaps.
- **What needs to be built before this is production-ready (for the full scenario)?** Phases 1–4 above: Presence client-visibility flags + the "share with client" control + a read-only stakeholder role + Presence-scoped internal notes. All additive, no redesign.

## Declaration

**Client Portal Visibility & Permission Model complete.**

*Reviewed and designed only — nothing built. The hard separations and isolation are verified safe today; the freelancer/agency-controlled granular exposure of Presence items (+ read-only stakeholder + Presence internal notes) is designed and gap-analyzed for a future build phase.*
