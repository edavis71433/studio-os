# Phase A6 — Workspace Architecture, Visibility & Experience

*Architecture, product-experience, and permissions **review + design** (no build). Answers: "Does every person using Studio OS see exactly what they should — and nothing they shouldn't?" Grounded in the code. The detailed audience/surface/client-portal visibility matrices live in the companion [Client Portal Visibility & Permission Model](CLIENT-PORTAL-VISIBILITY-MODEL.md); this document is the whole-platform workspace/cohesion/navigation/developer/UX review that incorporates it.*

---

## Executive Summary

Studio OS is architecturally **one platform, not many products** — and it already enforces the hard separations safely. There are, in reality, **three signed-in surfaces**, not twelve: the **Admin tool** (`dds-studio-manage`, staff), the **client workspace** (`portal.html` + `presence.html` + `today`/`connections`/`visual-studio`), and the **auth/onboarding** pages. The 12 "workspaces" the milestone lists **collapse into these by principal and scope** — Platform-Owner/Sysadmin/Operator/Support are all `staff`; Agency-Owner/Staff/Freelancer/Enterprise/Org/Location-Admin are the `agency` principal with role × scope; Business-Owner and Client share the client workspace. That collapse is a *strength* for cohesion.

Three honest gaps surface for the full agency→end-client experience:
1. **Client Portal ≠ Business-Owner workspace** — today they are the **same surface**; there is no intentionally-simpler client portal, and no per-item agency-controlled exposure of Presence items (designed in the companion doc).
2. **No dedicated Agency UI** — agencies operate through the Admin tool + the `/agency` API; the polished agency workspace is deferred (V1.1).
3. **Cohesion residuals** — palette is now unified (purple `#5b3fa0`), but **brand naming is inconsistent** ("Davis Digital Studio" vs "Presence" vs "Studio OS" across titles) and one surface set uses a different serif.

**Verdict:** the platform feels like one product at the isolation/security level and increasingly at the visual level; the remaining work is *experience differentiation* (a simpler client portal, an agency UI, consistent naming) and the *granular visibility model* — all additive, none a redesign. Developer Mode should slot in as a **mode inside the client workspace**, never a new product.

---

## Workspace Architecture Review

| "Workspace" (as named) | Real surface | Principal | Purpose | Arrive / Leave |
|---|---|---|---|---|
| Platform Admin | `dds-studio-manage` | staff | Operate the studio + platform | staff login / sign out |
| Operator / Support | `dds-studio-manage` | staff | Same surface, support tasks | same |
| Agency Workspace | `/agency/*` API (+ admin tool) | agency | Portfolio, queues, approvals | **no dedicated UI** |
| Freelancer Workspace | same as agency (solo) | agency/staff | Same as agency | same |
| Business Owner Workspace | `portal.html` + `presence.html` (+ today/connections/visual) | client | Run your presence | client login → today/portal |
| Client Portal | **same as Business Owner** | client | (not differentiated today) | same |
| CMS | inside `presence.html`/portal | client | Structured content | via workspace nav |
| Business OS | the platform itself | all | the integrated product | — |
| Developer Mode | **planned** (not built) | client + dev capability | pro/custom build | future mode-toggle |
| Enterprise | `/enterprise/*` API (operator) | agency scoped | org→region→location | admin tool / API |
| Marketplace | `/marketplace/*` API (operator) | staff/system | pack lifecycle | admin tool / API |
| Connected Platform | `connections.html` (customer) + API | client | connect services | workspace nav |
| Creative Studio | inside presence/portal | client | Writer/Editor/Reviewer/Guardian/Visual | workspace |

**Overlap / duplication findings:** (a) *Business-Owner workspace and Client Portal are the same surface* — should be **differentiated**, not merged. (b) *`today.html` overlaps `presence.html`* as a daily hub (already flagged; V1.1 consolidation). (c) *Agency & Enterprise & Marketplace have no dedicated UI* — API + admin tool today (V1.1 UIs). No harmful duplication; the collapses are correct for a single platform.

## Workspace Matrix (who / purpose / navigation)

See the table above. Net: **3 signed-in surfaces** (Admin, Client workspace, auth) serve **all** audiences via principal + role × scope — the definition of one cohesive platform rather than separate products.

## Role Matrix (summary — full detail in the companion doc)

| Role | Signed-in surface | Can edit | Publish | Approve | Connect | Configure | Delete | Export |
|---|---|---|---|---|---|---|---|---|
| Platform Owner / Sysadmin / Operator / Support | Admin (`staff`) | ✅ (operate) | ✅ (staff) | ✅ | ✅ | ✅ | ✅ (guarded) | ✅ |
| Agency Owner / Admin | Agency API | ✅ scoped | ✅ (approve_plans) | ✅ | ✅ | ✅ (branding/members) | scoped | ✅ |
| Agency Staff (7 roles) | Agency API | by capability | by capability | by capability | by capability | limited | limited | by capability |
| Enterprise / Org / Location Admin | Agency scoped | scoped | scoped | scoped | scoped | scoped | scoped | scoped |
| Business Owner | Client workspace | ✅ own | ✅ own | ✅ own | ✅ own | ✅ own | ✅ own | ✅ own |
| Business Staff | — | ❌ **no sub-role** (gap) | — | — | — | — | — | — |
| Client (of agency) | Client workspace | ⚠️ same as owner (gap) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| Read-only Stakeholder | — | ❌ **no role** (gap) | ❌ | 👁 | ❌ | ❌ | ❌ | ? |
| Developer | — | ❌ **future** | — | — | — | — | — | — |

**Role gaps:** Business Staff (a second seat under a business owner), Read-only Stakeholder, and Developer are **not distinct roles today**; Platform-Owner/Sysadmin/Operator/Support collapse to one `staff`.

## Visibility Matrix

Full audience × surface visibility and the client-portal exposure model are in the [Client Portal Visibility & Permission Model](CLIENT-PORTAL-VISIBILITY-MODEL.md). Headline: **isolation and CRM-level `client_visible` hold; per-item Presence exposure and internal-notes-in-Presence do not exist yet.**

## Navigation Review

- **Within the client workspace:** a consistent shared nav now ties Today · Your Presence · Connections · Visual Studio (browser milestone), and portal ↔ presence link both ways. Good.
- **Between surfaces:** admin/agency/client are separate login-gated surfaces — you don't accidentally cross between them (correct isolation), but there is **no role indicator** ("you are acting as agency X for client Y") and no unified switcher. For an agency operating many clients, a **"you are here / acting as" breadcrumb + client switcher** is the main navigation gap.
- **Terminology:** mostly consistent within Presence (calm merchant words); **cross-surface naming is inconsistent** (Davis Digital Studio vs Presence vs Studio OS) — a real "where am I / whose product is this" confusion (ties to the positioning track).

## Admin Tool Review

`dds-studio-manage-9k2p.html` (staff, `noindex`) is cleanly separated from client surfaces and already exposes operator concerns (tenants, roles, `client_visible` controls, commerce, support). **Cohesive and correctly walled off.** What it does *not* yet surface as first-class operator UI: provider **activation**, AI configuration, feature flags, monitoring, Marketplace/Enterprise/Agency management (these are API/config today) — candidates for an operator-console consolidation (V1.1), not a V1 blocker. No customer-facing clutter leaks in.

## Agency / Freelancer Review

An agency can manage multiple customers, sites, CMS instances, approvals, and publishing **through the `/agency` API + admin tool** (portfolio, queues, role × scope, bulk observe/publish, unified approval queue). Billing and client communication exist at the baseline-CRM layer. **Missing for comfort:** a dedicated agency **UI** (today it's API/admin-tool), a **client switcher / acting-as** indicator, and the **granular client-exposure** controls for Presence items. The engine is complete; the agency *experience* is the gap.

## Business Owner Review

The client workspace presents Business Moments, Creative Studio, Growth, Connected Platform, CMS, Publishing, Reports, Settings — the right set, in calm language, scoped to the owner's own site. **Nothing unnecessary appears** for a business owner (advanced tiers are hidden). The CRM is the light built-in CRM (by constitution). Good.

## Client Portal Review

Today the **client portal is not distinct** from the business-owner workspace — a client of an agency sees the full workspace. To be "intentionally simpler," the client portal should become a **filtered, review-oriented view** (review · approve · comment · download · view progress · communicate) built on the visibility model + a **read-only stakeholder** role — **without exposing internal agency operations**. This is the central experience gap for the agency scenario.

## Developer Mode Integration Review

Developer Mode (planned) should be a **mode inside the client workspace**, not a separate product:
- **Who enables it:** the site owner (or agency with a `developer` capability) toggles it per site; off by default.
- **Where it appears:** as an advanced view within the existing CMS/workspace (file/template/code editing), alongside — never replacing — the no-code structured-content experience.
- **Permissions:** gated by a developer capability; a business owner is never forced into it (manual/no-code parity — a Product Law).
- **Coexistence:** no-code (structured content) stays the source of truth; developer edits live at the **template layer** (the constitution's design-freedom boundary), never as runtime foreign code (security). It must not bypass Product Laws, approval, or isolation.

## Permission Gap Analysis

Strong: tenant isolation, agency RBAC (role × scope, deny-by-default), CRM `client_visible`, approval enforcement. **Gaps (design, do not build):** per-item Presence client-visibility; read-only stakeholder role; business-staff sub-seat; Presence-scoped internal notes; unified "share to client" control; (optional) finer operator split; developer capability. All additive.

## Security Review (verified)

- No customer sees another customer — deny-all RLS + `resolveSite(jwt)`. ✅
- No client sees agency internals — agency surfaces require agency/staff auth; CRM internal items `client_visible=false`. ✅
- No agency sees platform administration beyond its caps — `/agency` fences to the portfolio; staff-only admin. ✅
- No business owner accesses system administration — `staff`-only; service-role ≠ operator. ✅
- No developer tools bypass Product Laws — Developer Mode (when built) is template-layer, capability-gated, no runtime foreign code. ✅ (by design)
- No workspace bypasses approvals — `requires_approval` DB CHECK + atomic claim across all plan tables. ✅
- No workspace bypasses audit logging — append-only change/connection/webhook ledgers. ✅

## Cohesion Review

- **Design language:** palette **unified** (purple `#5b3fa0`) across admin, portal, presence, and the Presence pages. ✅
- **Typography:** mostly Fraunces; `today`/`connections`/`visual-studio` use a system serif (one residual; a font-CDN choice — V1.1). ⚠️
- **Navigation:** consistent within the client workspace; **no cross-surface role indicator / client switcher**. ⚠️
- **Terminology / naming:** **inconsistent product name** across titles (Davis Digital Studio / Presence / Studio OS) — the biggest "feels like different apps" signal. ⚠️ (positioning track)
- **Net:** structurally and visually converging on one platform; the remaining unification is **naming + a client switcher + the client-portal differentiation**.

## Recommended Implementation Plan (design only — do NOT build)

1. **Presence client-visibility flags** (per companion doc Phase 1–2) — additive `client_visible`/`shared_at` + "share with client" control.
2. **Read-only stakeholder role** + **business-staff seat** — view-only and second-seat client roles.
3. **Client Portal differentiation** — a simpler, review-oriented client view built on 1–2 (review/approve/comment/download/progress/communicate).
4. **Agency UI + client switcher / "acting-as" indicator** — the dedicated agency experience (also serves Enterprise/Marketplace consoles).
5. **Presence-scoped internal notes** (never client-visible unless shared).
6. **Developer Mode** as a capability-gated mode inside the workspace (future phase).
7. **Naming unification** — resolve Presence (product) / Davis Digital Studio (studio) / Studio OS (internal) consistently across titles (positioning track).

## Recommended UX Improvements

- One consistent product **wordmark** per surface (stop mixing three names).
- A persistent **role/context indicator** ("Agency · acting for [Client]") + a **client switcher** for agencies.
- A **simpler client portal** skin (fewer controls, review-first) distinct from the full business-owner workspace.
- Finish the **typeface alignment** (self-host the serif or accept the system serif consistently).
- Surface **"internal / shared"** state visibly on any item an agency can expose, so nothing is shared by accident.

---

## Final Questions (answered honestly)

- **Does Studio OS feel like one cohesive platform?** **Increasingly yes** — one integrated backend, unified palette, consistent in-workspace nav; the remaining seams are **naming inconsistency** and the **client-portal-vs-business-owner** sameness.
- **Can a freelancer safely manage customers?** **Yes** — isolation, agency RBAC, and admin/client separation hold.
- **Can customers only see what is intentionally exposed?** **At the CRM layer yes; at the Presence layer not granularly yet** (designed, not built).
- **Can agencies operate efficiently?** **Functionally yes** (portfolio, queues, approvals, roles × scope); the **experience** wants a dedicated agency UI + client switcher.
- **Is the Admin Tool cohesive?** **Yes** — cleanly separated, operator-focused; a fuller operator console (activation/flags/monitoring) is a V1.1 nicety.
- **Is the Client Portal appropriately simple?** **Not yet** — it is currently the full business-owner workspace; differentiation is the key gap.
- **Will Developer Mode integrate naturally?** **Yes, if built as a capability-gated mode inside the workspace at the template layer** — never a separate product, always with no-code parity.
- **What should be improved before implementation?** Naming unification; the client-portal differentiation + read-only stakeholder; the Presence client-visibility flags; a client switcher / role indicator; and the agency UI. All additive; approval/isolation/audit contracts unchanged.

## Declaration

**Phase A6 — Workspace Architecture, Visibility & Experience complete.**

*Reviewed and designed only — nothing built, no redesign, no Product-Law/Constitution/approval change. The hard separations, isolation, RBAC, approval, and audit are verified safe; the experience gaps (client-portal differentiation, granular Presence exposure, read-only stakeholder, agency UI, naming unification, Developer-Mode integration) are designed and gap-analyzed for future build phases.*
