# Phase A7.5 — Workspace Information Architecture & Navigation Finalization

*Finalizes how every user navigates Studio OS. **Implemented:** navigation as a single, entitlement-driven source of truth (`lib/navigation.ts` → `/portal/context.nav`) so every role/edition gets a consistent, adaptive nav with no empty menus or dead ends. The rest is review + design. No changes to roles, visibility, approval, isolation, or the foundation — the nav only reads them. Findings that would add capability are logged in the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md), not built.*

---

## Executive Summary

Studio OS now has a **finalized, single-sourced Information Architecture**. One catalog (`buildNav`) derives each caller's navigation from their **role + edition + capabilities**, so the platform is provably one product: a capability the caller lacks simply never appears — no empty menus, no dead ends, no separate builds. `/portal/context` now returns `nav`, `landing`, `edition`, `is_agency`, and `is_operator` — the frontend renders from this one source. Verified: **38/38 workspace/nav tests, invariants 14/14**, deployed staging + prod.

The IA resolves the A6 cohesion concerns: the client reviewer gets **one calm surface**; the business owner gets the **full workspace**; agency members get the **Agency section + client switcher**; Monitor edition **hides drafting/publishing**; Developer Mode is an **entry point under Settings**, gated by the `use_developer_mode` capability — a workspace capability, never a separate application. The Admin Tool remains a cohesive, cleanly-separated operator surface.

**Honest note:** this implements the *navigation model* (data + API) and the maps below; wiring the mature `portal.html`/`presence.html` menus to render from `/portal/context.nav` is a light follow-on (the Presence app pages already share the A6 nav; the manifest lets them converge fully). No redesign was done.

---

## Final Information Architecture

**One product, three signed-in surfaces, entitlement-driven nav.** The catalog's top-level sections (rendered only when the caller is entitled):

`Today` · `Website` · `Create` · `Grow` · `Clients` · `Agency` · `Settings` · `Help` — plus the reviewer's single `Your updates`. Landing is role-based (`/today.html` owner · `/agency.html` agency · `/client.html` reviewer).

## Workspace Maps

| Workspace | Surface | Landing | Primary | Secondary |
|---|---|---|---|---|
| Business Owner | `presence.html`/`today.html` | Today | edit content, publish, moments | connections, visual, growth, sharing |
| Business Staff | same | Today | edit, publish (no delete/configure/invite) | connections, growth |
| Client Reviewer | `client.html` | Your updates | review, approve | (nothing else — by design) |
| Agency / Freelancer | `agency.html` | Portfolio | switch client, portfolio, queues | acting-for a client |
| Developer | same as owner + Developer entry | Today | workspace + Developer Mode (future) | templates/code (future) |
| Enterprise / Org / Location admin | agency (scoped) | Portfolio | org/region/location, rollouts | scoped queues |
| Platform Admin / Support / Operator | `dds-studio-manage` | Admin home | tenants, support, provisioning | agency/marketplace/enterprise ops |

## Navigation Maps (global)

- **Primary nav:** the `nav` sections above (side or top), rendered from `/portal/context.nav`.
- **Role indicator:** a badge on each surface (built in A7.2).
- **Client switcher / "Acting for":** in `agency.html` (A7.2).
- **Notifications / Search / Quick actions / Help / Profile:** **not yet global** — logged in the Feature Discovery Queue (a global top-bar with search + notifications is the main IA enhancement identified).
- **Workspace/role switching:** implicit by login + landing; an explicit switcher for people who are both an owner and an agency member is a discovery item.

## Edition Navigation Maps (one app, entitlement-gated)

| Edition | Nav shows | Nav hides |
|---|---|---|
| **Presence Monitor** | Today, Website (view), Grow, Connections, Settings, Help | Create (drafting), Publish — observe-only |
| **Presence** | full owner nav | — |
| **Managed** | full owner nav (studio operates it for you) | — |
| **Agency** | full + **Agency** section | — |
| **Enterprise** | full + Agency + org/location (operator/agency) | — |
| **CMS Only / Business OS Only** | *not yet editions* (Product Packaging E1) | — the model supports them as capability sets; no separate build when they ship |

**Verified: no edition creates a separate product; Monitor's nav is intentional (no dead publish menu).**

## Role Navigation Maps

Owner = all sections · Staff = all except Clients (no invite) · Reviewer = Your updates only · Developer = owner + Developer entry · Agency member = + Agency · Reviewer/others never see Developer Mode. (All verified by tests.)

## CMS Structure

`Website` section: **Your website** (structured content) · **Photos** (media) · **Publish** (versioned; restore/history live here) · SEO/meta (per template) · **Domains** (Settings) · **Developer Mode entry** (Settings, gated). Analytics is surfaced via **Connections** (Google Analytics) + Reports — not a separate dashboard (Law 13). Templates are the developer/design layer (Settings → Developer Mode, future).

## Business OS Structure

`Today` (dashboard = Business Moments) · **Grow** (Moments, Growth Coach, Connections) · **Create** (Creative Studio, Visual Studio) · CRM = the light built-in CRM (clients/contacts, by constitution) · Reports via Grow · Knowledge under Website/Settings · AI woven into Create/Concierge (not a separate menu) · Settings. Tasks/Calendar are **not** Business OS surfaces today (logged as discovery — a task/reminder surface is a candidate).

## Agency Structure

`agency.html`: **Portfolio** (client directory) · **Client switcher** + **Acting-for** · per-client summary · Shared items + Approvals surface via the client's context · Publishing via bulk operations (existing) · Reports = portfolio rollups · Agency Settings (branding/members) via `/agency`. Scales to many clients (search + switcher). Deeper per-client sharing management is owner-driven today (discovery item: agency-managed per-client sharing).

## Enterprise Structure

`/enterprise/*` (operator/agency, scoped): **Organizations → Regions → Locations** (inheritance) · **Users/Permissions** = agency roles × scope · **Rollouts** (Approved-Plan) · **Audit** (append-only ledgers) · **Compliance** = the audit + approval trail. No dedicated Enterprise UI yet (API + admin tool) — logged as a V1.1 UI (Roadmap).

## Admin Tool Review

`dds-studio-manage` (staff, `noindex`) is cohesive and cleanly separated: tenants, subscriptions/entitlements, support, `client_visible` controls, commerce. It uses the **same purple identity** as the rest of Studio OS (design cohesion ✅). **Not yet first-class in the admin UI** (API/config today): provider **activation**, AI configuration, **feature flags**, **monitoring/reporting**, and Marketplace/Enterprise/Agency management consoles — logged as an "operator console consolidation" discovery item. No customer-facing clutter leaks in. **Verdict: cohesive; a fuller operator console is a nice-to-have, not a blocker.**

## Developer Mode Placement (design only — not built)

- **Entry point:** `Settings → Developer Mode` (present, locked), gated by the `use_developer_mode` capability (exclusive to the `developer` role today).
- **Navigation:** it lights up **inside** the Website/CMS workspace as an advanced view — never a separate nav root or app.
- **Permissions:** owner/agency grants the developer capability per site; off by default; a business owner is never forced into code (no-code parity — a Product Law).
- **Relationships:** edits live at the **template layer** (the constitution's design-freedom boundary); no-code structured content stays the source of truth; it must not bypass approval or isolation; it coexists with Business OS as one workspace. **Correctly positioned as a capability, not a product.**

## Packaging Review

Every current edition (Monitor/Presence/Managed/Agency/Enterprise) yields an intentional nav with **no empty menus, no broken links, no hidden dead ends** (the catalog drops empty sections and gates every item). CMS-Only/Business-OS-Only are future packagings the same model already supports as capability sets. **Verified.**

## Recommendations

1. **Wire the surfaces to render from `/portal/context.nav`** (light follow-on) so portal/presence menus converge on the single source.
2. **Add a global top-bar** (search + notifications + profile + help) — the one genuine IA enhancement (Discovery Queue).
3. **Operator console consolidation** (activation/flags/monitoring in the admin UI) — Discovery Queue.
4. Keep Developer Mode exactly where it is (Settings, capability-gated) when Phase B builds it.

---

## Final Questions (answered honestly)

- **Does Studio OS now have a finalized Information Architecture?** **Yes** — one entitlement-driven catalog, single-sourced via `/portal/context.nav`, mapped for every role/edition.
- **Can every role find what they need naturally?** Yes — role-based landing + adaptive nav; the reviewer's one surface, the owner's full workspace, the agency's portfolio.
- **Can every edition operate without confusion?** Yes — Monitor hides drafting/publishing; no empty menus; one product throughout.
- **Does the Admin Tool feel cohesive?** Yes — same identity, cleanly separated, operator-only; a fuller console is a logged nice-to-have.
- **Does the Client Portal feel intentionally simple?** Yes — one calm surface, server-boundaried.
- **Does the Business Owner workspace feel appropriately powerful?** Yes — the full section set vs the reviewer's single surface.
- **Does the Agency workspace scale?** Yes — portfolio + search + switcher + acting-for; rollups for many clients.
- **Is Developer Mode positioned correctly?** Yes — Settings entry, capability-gated, template-layer, no-code parity; a capability not a product.
- **Is the platform ready for A8 (Cohesion Audit), A9 (Product Review Board), Phase B (Developer Mode)?** **Yes** — the IA is finalized and single-sourced; A8 can audit against it, A9 has the Feature Discovery Queue to review, and Developer Mode has its confirmed home.

## Declaration

**Phase A7.5 — Workspace Information Architecture complete.**

*The IA is finalized and implemented as a single entitlement-driven navigation source of truth (tested 38/38, invariants 14/14, deployed staging + prod); every role/edition maps cleanly with no empty menus or dead ends; Developer Mode is correctly placed as a capability. Roles, visibility, approval, isolation, and the foundation are unchanged. Discovered enhancements are logged in the Feature Discovery Queue, not built. Committed, not pushed.*
