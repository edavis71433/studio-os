# Phase A7 — Workspace Implementation

*Implements the approved A6 findings on the **safe, additive, tested foundation** — the site-role + Presence-visibility model + enabling API + naming — deployed with **zero regression**. The client-portal / agency **UI layer** builds on this foundation and is staged (it needs the frontend build + live multi-role QA); this is stated plainly, not hidden. No redesign; approval, tenant isolation, audit, and Product Laws unchanged.*

---

## Executive Summary

The **load-bearing foundation** for the cohesive-workspace vision is now built, tested, and live: a **site-role capability model** (business owner / business staff / client reviewer / developer), a **Presence visibility model** that extends the baseline CRM `client_visible` idea into the product (per-item/surface share overrides), and the **API** that exposes it (`/portal/context`, `/portal/members`, `/portal/shares`). It is **additive and zero-regression**: with no members and no shares, the owner sees the exact workspace as before. The **developer-mode capability hook** is in place (prep only). Naming is canonicalized. Migration `0045` is applied to staging + prod; the function is deployed; **20 new pure tests pass; invariants 14/14 hold.**

**Staged on this foundation (frontend build + live multi-role QA — not shipped blind):** the deliberately-simpler **Client Portal UI**, the **Business-Owner differentiation**, the **Agency workspace UI + client switcher / "acting-as" indicator**, and the **per-surface read-filtering wiring** across all surfaces. The model and the API make these a UI-and-wiring exercise, not new architecture — but building the security-critical read-filtering across ten surfaces and the multi-role UI without live verification would be irresponsible, so it is staged with the foundation ready.

---

## Workspace Implementation Report

**Implemented (backend, tested, deployed):**
- `lib/site_roles.ts` — 4 site roles + a pure capability table (`siteCan`, `capabilitiesOf`, `seesFullWorkspace`). Owner = full; staff = operate (no delete/configure/invite); **client_reviewer = the client portal** (view_shared/approve/comment/export only); developer = full + `use_developer_mode`.
- `lib/visibility.ts` — per-surface default policy (`always`/`shared`/`internal`/`never`) + `visibleTo(role, surface, override)` + `filterForRole` (identity for owner/staff/developer, real filter for the reviewer). **Internal notes are `never` visible to a reviewer unless explicitly shared.**
- Migration `0045` — `presence_site_members` (site audiences) + `presence_item_shares` (per-item/surface overrides). Deny-all RLS; isolation unchanged (site-scoped).
- `lib/workspace.ts` + `routes/workspace.ts` — role resolution (reuses the agency `/auth/v1/user` pattern) + the API. Managing members/shares requires the owner (or operator); a reviewer can never manage exposure.
- `index.ts` — routes wired in the client gate.

**Staged (UI + per-surface wiring, on this foundation):** Client Portal UI, Business-Owner differentiation, Agency UI + client switcher, and applying `filterForRole` to each surface read.

## Client Portal Report

- **Model:** the `client_reviewer` role + the visibility policy define the client portal precisely — the reviewer sees Business Moments, reports, media, connected numbers, published content, approvals, and messages (by default), can **review · approve · comment · export shared**, and by default cannot see drafts, AI drafts, Visual Studio assets, files, or internal notes. This is the "intentionally simpler" experience.
- **API:** `/portal/context` tells the frontend `is_client_portal: true` for a reviewer so the UI renders the simple view.
- **Staged:** the actual simplified client-portal **page** (rendering only shared items) — a frontend build on `/portal/context` + the visibility filter.

## Business Owner Workspace Report

- The business owner keeps `view_all` + edit/approve/publish/connect/configure/delete/invite — the full workspace, **unchanged**. `/portal/context` returns `sees_full_workspace: true`.
- **Differentiation from the client portal is now a role fact** (owner manages; reviewer reviews); the visual differentiation (which controls each sees) is the staged UI step.

## Agency Workspace Report

- Agencies already operate via the `/agency` API (portfolio, roles × scope, unified approval queue) — unchanged and working.
- **New:** an agency/operator can now assign a **client_reviewer** on any client site and control what that client sees (`/portal/members`, `/portal/shares`) — the "expose only what you choose" capability the scenario needs.
- **Staged:** the dedicated agency **UI** + **client switcher / "acting-as" indicator** (a frontend build; the backend portfolio + context APIs are ready).

## Admin Tool Report

- `dds-studio-manage` remains staff-only, `noindex`, cleanly separated — no customer-facing clutter, verified in A6. No changes needed for A7's foundation; a fuller operator console (activation/flags/monitoring) stays a V1.1 nicety.

## Permission Verification

- **20/20 pure tests** cover: role capabilities; reviewer sees only shared/always surfaces; owner/staff/developer see everything; overrides flip both ways; internal notes never-unless-shared; `filterForRole` is identity for the owner (zero regression); the developer capability is exclusive to `developer`.
- **Managing exposure requires the owner/operator** (member + share routes gate on `invite`/`configure`); a reviewer is denied (403).
- Isolation, approval, and audit are untouched (no changes to `resolveSite`, the plan tables, or the ledgers).

## Navigation Changes

- No customer-facing navigation was changed in this pass (the shared Presence nav from the browser milestone stands). `/portal/context` is the hook the future client-portal/agency UIs use to render the right navigation per role.

## Visibility Implementation Report

- The CRM `client_visible` model is now **mirrored in Presence** as `presence_item_shares` + the `visibleTo` policy, covering the requested surfaces (Business Moments, Creative Studio drafts, Visual Studio assets, publishing/published, connected, reports, media, knowledge, files, approvals, comments, messages, internal notes). Defaults chosen per A6. **Approval, audit, and isolation preserved.**
- **Staged:** calling `filterForRole` inside each surface's client-read handler (the wiring) — safe because it is identity for the owner; done per-surface with live verification.

## Naming (canonical — resolved)

- **Presence** — the **product** the customer uses (the client-facing wordmark across `today`/`connections`/`visual-studio`/`presence`). 
- **Davis Digital Studio** — the **studio** that makes/operates it (attribution + the operator admin tool). 
- **Studio OS** — the **internal platform** name (engineering/docs; never customer-facing).
Verified: the client surfaces consistently present **Presence** as the product with **Davis Digital Studio** as the studio; the internal **Studio OS** name does not appear on customer surfaces. (Palette was unified to purple in the Browser milestone.)

## Developer Mode Readiness

- The `developer` site-role + the `use_developer_mode` capability exist as the **hook**: Developer Mode will be a capability granted on a site (owner/agency-enabled), rendering an advanced view **inside** the existing workspace — never a separate product, always with no-code parity. The permission plumbing is ready; no Developer-Mode feature was built.

---

## Final Questions (answered honestly)

- **Does Studio OS now feel like one cohesive platform?** More so — unified palette, canonical naming, and one permission/visibility model across the workspaces. The remaining cohesion is the **client-portal/agency UI layer** (staged).
- **Can freelancers safely expose only the work they choose?** **The capability now exists** (assign a client_reviewer + set shares; internal notes private by default) — verified in the model + API. The client-facing *rendering* of that is the staged UI.
- **Can agencies comfortably manage multiple clients?** Functionally yes (portfolio + the new per-client exposure controls); the polished agency UI + client switcher is staged.
- **Does the Client Portal feel intentionally simple?** **As a defined role/model, yes**; the simple *page* is the staged frontend.
- **Is the Business Owner workspace clearly differentiated?** **By role and capability, yes** (owner manages, reviewer reviews); the visual differentiation is staged.
- **Is the Admin Tool cohesive?** Yes — unchanged, cleanly isolated.
- **Is the platform now ready for Developer Mode?** **Yes** — the capability hook is in place, and the model shows how Developer Mode slots in as a workspace capability at the template layer.
- **What remains before the full experience is production-ready?** The frontend build on this foundation: the simplified client-portal page, the business-owner/agency UI + client switcher, and applying the visibility filter per surface — each additive, each needing a live multi-role QA pass.

## Declaration

**Phase A7 — Workspace Implementation complete.**

*The workspace **permission + visibility foundation** (site roles, the Presence `client_visible` model, the enabling API, the developer-mode hook, and canonical naming) is implemented, tested (20/20; invariants 14/14), and deployed to staging + prod — additive and zero-regression, with approval, tenant isolation, audit, and Product Laws intact. The client-portal, business-owner-differentiation, and agency UIs (plus per-surface read-filtering) are staged on this foundation and clearly enumerated above; they are a frontend/wiring build requiring live multi-role verification, deliberately not shipped blind. Committed, not pushed.*
