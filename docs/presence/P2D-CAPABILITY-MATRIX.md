# P2-D — Projects, Communication & Service Delivery: Capability-Preservation Matrix + Architecture

**Mandatory first step (before any implementation).** Evidence-grounded inventory of every existing capability, its reuse classification, the frozen workflow architecture, and the foundation-first build sequence. Sources: a five-way code inventory of `supabase/functions/presence/`, `supabase/migrations/`, root `*.html`, and the legacy `clever-api` reference (2026-07-10).

## Headline finding
The **post-sale service-delivery layer does not exist in the multi-tenant `presence` product** — projects, tasks, milestones, delivery timeline, and support live **only** in the legacy single-tenant `clever-api` (DDS-internal; data disposable). But the **supporting primitives P2-D needs already exist and are production-grade in `presence`**: media/files store, relationship notes, the portal-feed notification model, the forms substrate, the Approved-Plan spine + contract version-integrity, analytics/reporting, and the shared shell + roles/shares visibility model. **So P2-D = build the missing service-delivery spine, reuse everything else. No parallel systems.**

---

## Capability-preservation matrix

| # | Capability | Exists in `presence`? | Evidence | Classification | Build ON / note |
|---|---|---|---|---|---|
| 1 | **Projects** | ❌ absent (legacy `projects`, `0000_baseline.sql:1516`, single-tenant `tenant_id`) | no `presence_project*` table; no `/projects` route | **Rebuild** (net-new) | new `presence_projects` mirroring the 0074 pattern (`site_id`→`presence_sites`, deny-all RLS, bounded `status` CHECK, `deleted_at`) |
| 2 | **Project status/stage** | ❌ (deal stage is pre-customer only, ends at `won`) | `0074:39-40` | **Rebuild** | bounded status ladder `active/on_hold/complete/archived` + `presence_project_events` |
| 3 | **Tasks** | ❌ (legacy `studio_tasks`, single-tenant) | `0000:1757` | **Rebuild** | new `presence_tasks` (project-scoped); legacy column shape (title/status/priority/due/source) is the reference |
| 4 | **Milestones** | ❌ (only derived UI concepts) | `lib/customer_timeline.ts:19`, `lib/onboarding.ts:56` | **Rebuild** (thin) | new `presence_milestones` grouping tasks by delivery outcome |
| 5 | **Project activity history** | ⚠️ pattern exists (`presence_deal_events`) | `0074:67-81` | **Rebuild (thin)** | `presence_project_events` = exact copy of the deal-events shape |
| 6 | **Files / uploads / media** | ✅ production-grade | `presence_media` `0015:256`, `presence-media` bucket, `lib/media.ts`, `lib/media_guard.ts`, `lib/media_gc.ts`, DAM `routes/assets.ts` | **Adopt (store) + Complete (deliverable overlay)** | reuse the store + signed access + validation + GC + reference-protection. A **client-facing deliverable** is a thin overlay linking `presence_media` to a project with explicit visibility — **do NOT auto-expose private CMS media** |
| 7 | **Client-visible vs internal separation** | ✅ (grammar exists; no per-row flag) | notes `audience` `0048:9`; shares `presence_item_shares` `0045:30`; `filterForRole`/`visibleTo` `lib/visibility.ts` | **Adopt** | reuse `audience`-style grammar per row + role/reviewer boundary; never a new visibility system |
| 8 | **Messaging (studio↔client)** | ❌ no real two-way (legacy `messages`, single-tenant) | `0000:1245`; written seam today = `relationship_notes.audience='shared'` `0048` | **Rebuild (coherent, minimal) — harden+integrate** | project-scoped thread reusing the `audience` grammar + change-event feed; NOT a per-feature message system, NOT legacy `messages` |
| 9 | **Internal notes** | ✅ | `presence_relationship_notes` `0048:9`, `/crm/notes`, `isStudioSide()` `routes/crm.ts:23` | **Adopt** | the internal note store; project notes reuse it (add optional `project_id`) |
| 10 | **Notifications** | ✅ derived feed + durable notice rail (no read-state) | `/portal/feed` `workspace.ts:137`; `presence_plan_notices` idempotent send-once `0037:54`/`0055` | **Adopt + Complete** | reuse the "derived from real activity, never a second log" feed; **add a thin per-recipient read/unread layer** (the one real gap). Never resurrect legacy `notifications` |
| 11 | **Surveys** | ⚠️ forms substrate only (legacy `project_surveys` single-tenant) | `presence_form_submissions` `0050:29`; legacy `0000:1500` | **Complete (on forms)** | build a small project-scoped survey on the forms substrate; **not** a general form builder; DDS-isolate `project_surveys` |
| 12 | **Approvals (item+version)** | ✅ spine + version-integrity idiom (no generic per-item table) | Approved-Plan spine `lib/approved_plan.ts`; contract `content_hash` WHERE-guard `sales.ts:300`; HMAC token transport `lib/commercial.ts:186` | **Adopt + Complete** | one generic `presence_approvals` riding the spine + the contract `content_hash` guard (bind decision to the exact version); add requester/reviewer/note columns. **No second signing/publish approval system** |
| 13 | **Support** | ❌ (legacy `client_requests` single-tenant; presence only has a static tier copy map) | `commerce/support.ts` (copy only); `0000` `client_requests` | **Rebuild (minimal, on forms substrate)** | smallest coherent support request (submit/triage/respond/resolve/reopen) reusing the forms + notes + notifications primitives; **not** a helpdesk |
| 14 | **Client reporting** | ✅ authoritative sources exist | `/analytics/*` `routes/analytics.ts`; `presence_visits` `0066`; `/portal/feed`; Moments `today.html` | **Adopt (compose)** | a calm client summary composed from authoritative project/task/approval/message/analytics data; **no duplicate reporting DB**; reuse P2-F analytics later |
| 15 | **Shared shell + role context** | ✅ | `shell.js` + `/portal/context` + `buildNav` `lib/navigation.ts`; reviewer boundary `reviewerAllowed` `workspace.ts:30`, `/client.html` | **Adopt** | integrate via `buildNav`/`/portal/context` only; **no duplicate portal**; internal info never in the Client App |
| 16 | **Roles / membership / shares** | ✅ | `lib/site_roles.ts`, `/portal/members`, `/portal/shares`, `workspace_roles` `0045` | **Adopt** | project membership/visibility drives off this; no new permission model |
| 17 | **Onboarding handoff** | ✅ (stops at customer+workspace) | `provisionForSignup` seeds `presence_first_run` `commerce/provision.ts:129`; `get-started.html` | **Adopt + Complete** | P2-C convert ends at client+site; **add a create-project-on-convert hook** (optional `presence_deals.created_project_id`, same idempotency pattern) |
| 18 | **Growth Partnership** | ⚠️ legacy `clever-api` + `portal.html#growth` | `admin-growth.html`→clever-api | **Defer (Phase 8) / DDS-isolate** | not required for the minimum service workflow |
| 19 | **Legacy service tables** | `projects`/`studio_tasks`/`timeline`/`project_surveys`/`client_requests`/`messages`/`approvals`/`notifications`/`files` | all `0000_baseline.sql`, single-tenant | **DDS-isolate → Remove-after-parity** | functionality reference only; disposable data; delete only after presence parity is proven |

**Nothing disappears without a replacement.** Every ✅ is preserved; every legacy item is isolated and only retired after parity.

---

## Frozen workflow architecture

```
Customer (clients.id + presence_sites.id, from P2-C convert)
  └─ presence_projects            ← the ONE authoritative service-delivery container (site_id-scoped)
       ├─ presence_milestones     ← delivery outcomes (group tasks)
       ├─ presence_tasks          ← work items (client_visible flag; milestone_id optional)
       ├─ presence_project_events ← activity history (copy of deal-events shape)
       ├─ deliverables            ← overlay linking presence_media → project (visibility explicit)  [reuse media store]
       ├─ messages                ← project-scoped thread (audience internal|client)  [reuse audience grammar]
       ├─ notes                   ← presence_relationship_notes (add project_id)       [ADOPT]
       ├─ approvals               ← presence_approvals riding the Approved-Plan spine + content_hash [ADOPT+complete]
       ├─ surveys                 ← on presence_form_submissions substrate             [ADOPT]
       └─ support requests        ← minimal, on forms + notes + notifications          [rebuild-minimal]
  Reporting  ← composed read over the above + /analytics (no new store)                [ADOPT]
  Notifications ← /portal/feed (derived) + presence_plan_notices (durable) + read-state layer [ADOPT+complete]
  Surfaces   ← ONE shared shell: Studio App (full) + Client App (reviewer boundary /client.html) [ADOPT]
```

**Invariants honored (from the prompt's frozen boundaries):**
- A customer may have many projects; a project is the authoritative delivery container; tasks + milestones belong to a project.
- Client-visible vs internal is **explicit** (`client_visible` on tasks/deliverables; `audience` on messages) and enforced by the existing role/reviewer + shares model — never a new visibility system.
- Files have ONE authoritative store (`presence_media`); deliverables are a reference overlay with delete-protection — no second bucket.
- Messages ≠ notes ≠ support (distinct rows/tables), all feeding ONE activity/notification model; notifications are derived, never the source of truth.
- Approvals bind to the **exact item + `content_hash`** and refuse a superseded version (contract idiom) — no second signature/publish approval system.
- Presence CMS publishing stays owned by Phase 1 and is integrated, not rebuilt.

---

## Foundation-first build sequence (each increment: migration+lib+routes+tests, validate, then next)
1. **P2-D-1 — Project foundation (this increment):** `presence_projects` + `presence_milestones` + `presence_tasks` + `presence_project_events`; pure `lib/service_delivery.ts` (status ladders, task state, overdue/blocked derivation, deterministic ordering, pagination); `routes/projects.ts` (projects·tasks·milestones·events, site-scoped, `client_visible`); convert→create-project hook; feature-gate `service`→relationship; nav. Pure + structural + live e2e + tenant-isolation tests.
2. **P2-D-2 — Deliverables (files overlay) + Approvals:** deliverable overlay on `presence_media` (client-visible, delete-protected) + `presence_approvals` (spine + `content_hash`).
3. **P2-D-3 — Communication:** project messages (audience grammar) + relationship-notes `project_id` + notification read-state layer over `/portal/feed`.
4. **P2-D-4 — Surveys + Support** on the forms substrate.
5. **P2-D-5 — Client reporting** composed read; **Studio App + Client App** surfaces on the shared shell.
6. **P2-D-6 — Full-lifecycle validation** (the 16-step gate) + performance + legacy parity/deprecation map + completion report.

Human browser/mobile/keyboard/screen-reader certification stays in **Phase 6 Gold Master** (not claimed here). P2-D is **not** complete until the full-lifecycle gate (step 6) passes.
