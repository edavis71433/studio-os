# L5.7 — Agency Expansion & Enterprise Operations

The final Industry Platform milestone. Agencies can now operate the **complete** Studio OS platform — single businesses, multi-location organizations, enterprise customers, Industry Packs, Marketplace packs, Connected providers, rollouts, approvals, publishing, growth — through **one** agency experience. It is pure **orchestration**: no second agency platform, no duplicated Enterprise / Marketplace / Connected / CMS / Intelligence. The agency calls the existing stores and consumes the one pipeline; every state change is an Approved Plan.

**Result:** the composing permission model (9 roles × scope), cross-org/cross-client rollups, and a unified approval queue drawn from the Approved-Plan tables — 24 checks; the existing M13 agency suite still 24/24; full regression green; invariants 14/14 held; 100 orgs / 10,000 locations rolled up in ~10 ms.

---

## 1. Agency Architecture

The M13 agency already orchestrated the pipeline (portfolio, work queues, bulk dispatch), fenced to its own sites with a role-capability table. L5.7 extends that same layer to the newer capabilities — **not** a new module:

- **Capabilities added** (`agency/auth.ts`): `manage_enterprise`, `manage_marketplace`, `manage_connected`, `approve_plans` — mapped onto the existing roles.
- **`agency/permissions.ts`** — a composition layer over the existing `can()`: effective permission = role capability **AND** scope.
- **`agency/orchestrate.ts`** — pure read-side builders (cross-org rollup, unified approval queue, cross-client summary) over rows the platform already produced.
- **`agency/routes.ts`** — new endpoints that call `enterprise/store.ts` and read the Approved-Plan tables; no new engine, store, or table.

## 2. Client Hierarchy

```
Agency ─▶ Organization ─▶ Region (optional) ─▶ Location
```

The agency is fenced to its own portfolio (`agencySiteIds`); an organization is any org owning those sites; regions and locations resolve through the Enterprise inheritance. The agency feels like managing **businesses**, not hundreds of unrelated sites — `GET /agency/organizations` lists the businesses, `GET /agency/rollups` summarizes them.

## 3. Enterprise Operations Guide

Through the existing Enterprise foundation (no duplication):

- **Review** — `GET /agency/organizations`, `GET /agency/rollups` (per-org location rollup).
- **Roll out** — `POST /agency/organizations/:orgId/rollout/prepare {op,patch}` → an Approved Plan (`saveOrgOperation`), gated by `manage_enterprise` and fenced to the portfolio.
- **Approve** — `POST /agency/organizations/:orgId/rollout/:id/decide {approve}` (`decideOrgOperation`), gated by `approve_plans`.
- **Rollback / inheritance / health** — the Enterprise store's own operations, surfaced through the agency.

## 4. Industry Operations Guide

Through the Marketplace foundation (no duplication): recommend / install / update / roll back Industry Packs, view compatibility, review dependencies, audit versions — all via `industry/marketplace_*`, gated by `manage_marketplace` (prepare) and `approve_plans` (sign-off). A pack change is a Marketplace operation, which is an Approved Plan.

## 5. Marketplace Operations Guide

The agency drives the same Marketplace lifecycle an operator does (`prepare → decide → execute → audit → rollback`), scoped to its portfolio and permission-gated. Nothing new — the Marketplace store is the single source of pack state.

## 6. Permission Matrix

Nine named roles, composing role capabilities with scope (`permissionMatrix()`):

| Role | Reaches | Can |
|---|---|---|
| **Agency Owner / Admin** | whole portfolio | everything (view, manage clients/members, org, packs, connected, approve, publish) |
| **Manager** | whole portfolio | view, manage clients, org + pack + connected prepare **and** approve, publish |
| **Editor** | whole portfolio | view, prepare connected writes (**not** approve — separation of duties) |
| **Analyst / Read Only** | whole portfolio | view only |
| **Enterprise Admin** | whole portfolio | admin, focused on organizations |
| **Organization Admin** | **one org** | manage that org + rollouts within it; nothing outside it |
| **Location Admin** | **one location** | prepare within that site; nothing outside it |

The composition is enforced by `authorize(member, action, target)` = `can(role, cap)` **AND** target ∈ scope — deny by default, and a powerful role scoped to one org cannot act on another (tested).

## 7. Agency Rollout Guide

Every rollout is the Approved-Plan lifecycle, orchestrated: prepare (a plan citing the affected locations, `manage_enterprise`) → approve (`approve_plans`) → execute (the Enterprise store's atomic-claim execute) → audit → rollback. Inheriting locations pick up the change; overriding locations keep their own. Nothing bypasses approval.

## 8. Agency Security Review

Attacked and held:

- **Tenant / organization / location isolation** — the agency is fenced to `agencySiteIds`; an org must be in the portfolio (`403` otherwise); config is per-org with deny-all RLS.
- **Agency boundaries** — membership is fail-closed; a paused agency denies every member.
- **Approval boundaries** — every state change is an Approved Plan (`requires_approval` DB CHECK + atomic claim); `approve_plans` is a distinct capability, so preparing ≠ approving.
- **Scope escape** — a scoped admin (even with a powerful role) cannot act outside its org/location (composition denies it; tested).
- **Ownership / audit** — no agency action touches customer content outside the frozen publish pipeline; every plan is a ledger row.

## 9. Agency Performance Report

- **Rollups** — pure; 100 orgs / 10,000 locations + a 2,000-item approval queue in ~10 ms.
- **Approval queue** — a bounded read across the plan tables (indexed by status).
- **Startup / memory** — no global state; portfolio + rollups are on-demand, fixed-query builders.

---

## Final L5 Validation Report

The Industry Platform (L5.0–L5.7) is complete and coherent:

| Milestone | Delivered | Engine change |
|---|---|---|
| L5.0 Foundation | one Industry Pack contract | none |
| L5.1 Restaurant | flagship pack, live pipeline | none |
| L5.2 Validation | toolkit, collision-safety, open keys | none |
| L5.3 Expansion | Coffee Shop (`extends`) + Home Services base | none |
| L5.4 Third-party DX | the SDK + a pure-SDK sample pack | none |
| L5.5 Marketplace | install/enable/disable/update/remove on the spine | none |
| L5.6 Enterprise | org→region→location inheritance | none |
| L5.7 Agency | orchestration of all of it | none |

**Invariants held 14/14 at every step.** Two spines (Intelligence, Approved-Plan) and the frozen contracts are untouched throughout; everything L5 added is data + orchestration over them.

## Final review

- **Can an agency operate the complete Studio OS platform?** Yes — single businesses, orgs, packs, connected, rollouts, approvals, publishing, growth, all through one experience.
- **Can enterprise customers be managed without complexity?** Yes — the agency sees businesses (organizations + rollups), not hundreds of sites.
- **Did Agency remain orchestration rather than duplication?** Yes — it imports no pipeline engine, reimplements no store, adds no table; it calls Enterprise/Marketplace and reads the plan tables.
- **Does every action still use the Approved Plan spine?** Yes — rollouts/pack ops/connected writes are Approved Plans; `approve_plans` is a distinct capability; the underlying stores reuse `claimApprovedPlan`.
- **Did Enterprise, Marketplace, Industry Packs, Connected, and CMS remain one platform?** Yes — the agency is a lens over the same modules; the invariants prove nothing forked.
- **Would another team understand it?** Yes — one permission composition, pure builders, a router that calls existing stores; the same propose→approve→execute→audit lifecycle everywhere.
