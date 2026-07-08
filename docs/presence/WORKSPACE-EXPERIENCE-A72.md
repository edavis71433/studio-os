# Phase A7.2 — Workspace Experience

*Builds the experience layer on the A7.1 foundation (site roles + Presence visibility + `/portal/*` API). The **client portal is a real security boundary**, not a facade: a `client_reviewer` is restricted server-side. Consumes the existing APIs; no redesign; approval, tenant isolation, and audit unchanged.*

---

## Executive Summary

The workspaces now have a **cohesive experience** on one platform. The security-critical piece is done and tested: a **`client_reviewer` is a genuinely restricted principal** — the client gate refuses everything except the shared feed and the approvals put to them (`reviewerAllowed`, enforced in `index.ts`). On that boundary sit three new purple-identity pages that consume the deployed APIs: **`client.html`** (the deliberately simple client portal — review + approve), **`agency.html`** (portfolio dashboard + client switcher + "Acting for" banner), and **`sharing.html`** (the owner invites a reviewer + toggles what's shared, with a locked **Developer Mode entry point**). The business-owner workspace (`presence.html`) gains links to Sharing and a **"Preview client view."**

Verified: **29/29** workspace tests (incl. the reviewer route-gate), **invariants 14/14**, room 38/38 + pipeline 30/30 **live on staging** (the gate is transparent for owners — zero regression), all pages parse clean, function deployed staging + prod. **Honest caveat:** live multi-role browser sessions (sign in as an actual reviewer, an agency member, an owner) can't run in this environment — the logic and boundaries are verified by tests + the server gate; the click-through is the human QA step.

---

## Workspace Experience Report

| Built | What it is | Consumes |
|---|---|---|
| **Reviewer boundary** (`index.ts` + `reviewerAllowed`) | A `client_reviewer` may reach only `/portal/context`, `/portal/feed`, and the two approval `…/decide` routes — everything else 403 | server-side gate |
| **`client.html`** | The simplified client portal: publish status, "waiting for your OK" (approve/decline), recent shared updates | `/portal/context`, `/portal/feed`, `…/decide` |
| **`agency.html`** | Agency dashboard: portfolio list, search, **client switcher**, **"Acting for [client]"** banner | `/agency/me`, `/agency/portfolio` |
| **`sharing.html`** | Owner invites a client reviewer + toggles shared surfaces; **Developer Mode entry (locked)** | `/portal/context`, `/portal/members`, `/portal/shares` |
| **`presence.html`** hooks | Links to Sharing & access + Preview client view | — |
| **`/portal/feed`** | Server-computed, visibility-correct reviewer feed (shared moments + publish status + pending approvals) | the visibility model |

## Edition Verification

- The workspace remains **one application**; capabilities are gated by **entitlement**, not separate builds. The five real editions (Presence Monitor → Presence → Managed → Agency → Enterprise) are respected by the backend: Monitor is observational (drafting/publishing return the friendly upgrade 403 via the capacity/monitor boundary); agency/enterprise unlock the portfolio surfaces. The new pages are edition-agnostic (they render role + shared content) so they never misrepresent a capability.
- **CMS-Only and Business-OS-Only are not yet editions** — they belong to Product Packaging (roadmap E1), so there is nothing to adapt to yet. When they ship, the same entitlement gate drives them — no new product. **Verified: no edition creates a separate application.**

## Role Verification (tested, 29/29)

- **business_owner / business_staff / developer** → `sees_full_workspace` (the rich workspace); **client_reviewer** → the client portal only.
- **Reviewer boundary:** may read context/feed + approve infra/connected plans; **may not** edit, publish, connect, generate (AI/Visual), read the raw moments feed, or manage members/shares (all 403). Verified by unit tests + the live gate.
- **Managing exposure** (members/shares) requires owner/operator; a reviewer is denied.
- Isolation, approval (DB CHECK + atomic claim), and audit are untouched — no changes to `resolveSite`, the plan tables, or the ledgers.

## Navigation Report

- **Client** → `client.html` (one calm surface). **Owner** → `presence.html` workspace with links to Connections, Visual Studio, **Sharing & access**, and **Preview client view**. **Agency** → `agency.html` (portfolio + switcher + Acting-for banner). Each surface carries a **role indicator** (a badge). Consistent purple identity + calm language throughout.
- The service worker now excludes `client`/`agency`/`sharing` (never served stale), matching the other app surfaces.

## Agency Report

`agency.html` gives an agency member their **portfolio in one place** (name, edition, status, "N waiting"), a **search + client switcher**, and an **"Acting for [client]"** focus with a per-client summary. It reuses `/agency/me` + `/agency/portfolio` (role × scope enforced server-side) and **never impersonates** a client's own login — focusing a client scopes the *view*, not the identity (isolation preserved). Deeper per-client actions remain in the studio tools with agency permissions (unchanged).

## Client Portal Report

`client.html` is **intentionally simple**: publish status ("your site is live — updated …"), a "Waiting for your OK" section (approve / not-yet, wired to the real approval routes), and recent **shared** updates. No edit, publish, connect, or generate controls exist — and even if a reviewer crafted such a request, the **server gate refuses it**. Internal notes never appear. This is the review-first experience the scenario needs.

## Business Owner Report

The business owner keeps the full `presence.html` workspace (edit/approve/publish/connect/configure/delete/invite) — **unchanged and clearly more powerful** than the client portal. New: they can open **Sharing & access** to invite a client and choose what's shared, and **Preview client view** to see exactly what their client sees. The owner-vs-client difference is now both a role fact and a visible experience.

## Developer Mode Readiness

The **entry point exists** (a locked "Developer Mode — coming soon" row in Sharing) and the **capability hook** (`use_developer_mode`, exclusive to the `developer` role) is in the model. Developer Mode will light up **inside** this workspace as a capability at the template layer — never a separate product, always with no-code parity. The platform is ready for A7.5 (Information Architecture) and then Developer Mode.

---

## Final Questions (answered honestly)

- **Does Studio OS now feel like one cohesive platform?** Yes — one identity, one permission/visibility model, three role-appropriate surfaces that share a design language and consume the same APIs.
- **Does every edition feel intentional?** Yes — one app gated by entitlement; the five real editions are respected; CMS-Only/Business-OS-Only remain a future packaging concern, not a separate build.
- **Can freelancers safely expose only what they choose?** **Yes — now enforced**: the reviewer boundary + the shares model mean a client sees only shared items; internal notes are private by default. Verified server-side + by tests.
- **Can agencies efficiently manage multiple clients?** Yes — the portfolio dashboard + switcher + acting-for banner give a single calm place; deeper actions via the existing agency permissions.
- **Is the Client Portal now appropriately simple?** Yes — a review-first single surface, backed by a real server boundary.
- **Is the Business Owner workspace clearly more powerful?** Yes — the full workspace vs the reviewer's read/approve view; the difference is visible and role-enforced.
- **Is the platform ready for A7.5 then Developer Mode?** Yes — the role/visibility foundation, the workspace surfaces, and the Developer-Mode hook are all in place.
- **What remains?** Live multi-role browser QA (sign in as a real reviewer/agency/owner); optional per-surface share toggles at item granularity (the surface-level toggles ship now); and the agency-managed per-client sharing (owner-managed sharing ships now). All additive; contracts unchanged.

## Declaration

**Phase A7.2 — Workspace Experience complete.**

*The client portal, agency workspace, sharing controls, role indicators, and Developer-Mode entry point are built on the A7.1 foundation and consume the deployed APIs; the reviewer is a real server-enforced boundary. Tested (29/29 + invariants 14/14 + live room/pipeline), deployed staging + prod, zero regression. Live multi-role browser QA is the human step. Committed, not pushed.*
