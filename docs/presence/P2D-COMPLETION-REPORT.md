# P2-D — Projects, Communication & Service Delivery: Completion Report

**Status: ✅ COMPLETE (engineering). Jul 10 2026.** The full post-sale service-delivery workflow is built multi-tenant on the `presence` product, validated end-to-end on live staging (the 16-step lifecycle gate passes with two tenants), and deployed to staging + prod. Human browser/mobile/keyboard/screen-reader certification of the surfaces is consolidated at **Phase 6 — Gold Master** (not claimed here). Prod migrations `0075`–`0078` remain an owner launch-time apply (prod `/projects/*`, `/support`, etc. are dormant until then).

Built as one continuous milestone across six increments (P2-D-1…6), each validated before the next. Matrix + frozen architecture: `P2D-CAPABILITY-MATRIX.md`.

## Final workflow architecture (as built)
```
Customer (clients.id + presence_sites.id, from P2-C convert; idempotent handoff → presence_deals.created_project_id)
  └─ presence_projects            authoritative delivery container (status ladder, client_visible)
       ├─ presence_milestones     delivery outcomes
       ├─ presence_tasks          work items (client_visible + client_action_required explicit; internal by default)
       ├─ presence_project_events THE activity log (every meaningful change; feeds notifications)
       ├─ presence_deliverables   client-facing OVERLAY on presence_media (signed download, delete-protected)
       ├─ presence_approvals      generic decision bound to the exact item + content_hash (version integrity)
       ├─ presence_project_messages  one thread; audience internal|client (internal never shown to client)
       ├─ presence_surveys / _responses  small fixed survey, one idempotent submission per respondent
       └─ presence_support_requests / _messages  submit→triage→resolve→reopen
  Notifications  ← VIEW over presence_project_events + presence_activity_reads (per-reader last-seen). No second log.
  Reporting      ← composed READ over authoritative rows (reportSummary). No report store.
  Surfaces       ← the ONE shared shell: projects.html (Studio) on buildNav "Projects"; client sees only client-visible.
```

## Capabilities — adopted / hardened / rebuilt / removed / deferred
- **Rebuilt (net-new multi-tenant):** projects, milestones, tasks, project activity log, deliverable overlay, generic approvals, project messaging, notification read-state, surveys, support. (The legacy equivalents were single-tenant `clever-api` only.)
- **Adopted (reused, no rebuild):** the `presence_media` store + signed access + GC + reference-protection; `presence_relationship_notes` grammar; `/portal/feed` + `presence_plan_notices` model; the Approved-Plan spine + contract `content_hash` idiom; analytics; the shared shell + roles + `presence_item_shares` visibility.
- **Hardened:** the `presence-media` bucket now accepts `application/pdf` (0065 doc support + deliverables were failing at the storage layer); a relationship-gated deliverable upload path so Business-OS customers (no website) can share files; `deleteMedia` now refuses to remove a file a deliverable references.
- **Removed:** nothing (legacy retirement is P2-G, after a proven parity + data-disposal window — see the map below).
- **Deferred:** Growth Partnership (Phase 8); per-project message unread badges, project-less support notifications, and merging the concierge/commercial notice rails (evidence-driven, logged in the audit).

## Files changed / added
- **Migrations:** `0075` (projects/milestones/tasks/events + convert handoff), `0076` (deliverables/approvals + bucket PDF fix), `0077` (messages/activity-reads), `0078` (surveys/support).
- **Pure libs:** `lib/service_delivery.ts`, `lib/approvals.ts`, `lib/notifications.ts`, `lib/intake.ts`.
- **Routes:** `routes/projects.ts`, `routes/project_delivery.ts`, `routes/project_comms.ts`, `routes/service_intake.ts`; wiring + feature-gate (`projects`→relationship) + reviewer allowlist in `index.ts` / `middleware/feature.ts` / `routes/workspace.ts`; `lib/media.ts` delete-protection; `lib/navigation.ts` Projects nav.
- **UI:** `projects.html` (Studio App surface on the shared shell).
- **Tests:** 4 pure + 5 structural + 7 live e2e (incl. the 16-step lifecycle); `scripts/validate-p2d.mjs`.

## Validation evidence (live staging + offline)
- **Full 16-step service lifecycle: 16/16** (two tenants) — the milestone's exact gate.
- Pure **75** (service_delivery 38 · approvals 7 · notifications 14 · intake 16). Structural **116** (projects 38 · delivery 22 · comms 21 · intake 22 · UI 13). Live e2e: foundation 21 + isolation 9 · delivery 19 · comms 12 · intake 18 · report 8 · lifecycle 16.
- **Full pure sweep: 118 passed / 0 failed / 4 skipped.** Typecheck clean. Gate runner `scripts/validate-p2d.mjs` → ✅ green.

## Defects found & fixed
1. **Media bucket rejected PDFs** (pre-existing) — `allowed_mime_types` lacked `application/pdf`, breaking 0065 document support + deliverable PDFs at the storage layer. Widened idempotently in `0076`.
2. **Business-OS file sharing gap** — media upload was website-gated, so no-website customers couldn't share deliverables. Added a relationship-gated deliverable upload reusing the ONE store.
3. **File delete-protection gap** — `deleteMedia` didn't count deliverable references. Now it does.
(No tenant-isolation or data-integrity defects. All fixes validated.)

## Security findings
Every table is `site_id`-scoped with deny-all RLS (function-mediated). Writes are studio-side; the client reviews (reviewer allowlist grants only read + reply + decide + download + submit). Internal notes/tasks are never sent to the client filter. Approvals bind to the exact version (`content_hash` in the WHERE) and cannot decide a superseded one. Signed file access only; attachments validated in-site. The 16-step gate's step 16 proves a second tenant cannot read or mutate any record in the workflow.

## Performance findings
All list queries are bounded (`clampLimit`/`clampOffset`, default 25, max 100) with supporting indexes (site+status, project+sort, project+created). The report + bundle use a fixed set of parallel bounded reads. Notifications derive from a single indexed `presence_project_events` scan (limit-bounded) + one read-marker lookup — no N+1. Derived-not-stored notifications avoid a write on every activity. No unbounded scans introduced. (Load characterization at scale is the Phase-1 load-test framework's job; nothing here changes its envelope.)

## Deployment status
Function deployed to **staging + prod**. Migrations `0075`–`0078` applied to **staging**; **prod apply is the owner's launch step** (routes 502 until then — dormant, safe). App HTML (`projects.html`) is committed-local (unpushed) per the fence.

## Rollback procedure
- **Function:** redeploy the prior `presence` build (`supabase-go functions deploy presence --project-ref …`); routes vanish.
- **Schema (staging):** each migration ends with an explicit `-- rollback:` block (drop the new tables + the `created_project_id` column; the event-kind CHECK reverts). Deny-all RLS means no client ever saw the tables directly.
- **Data is disposable** — no migration to unwind.

## Legacy parity / deprecation map
Parity is proven at the **capability** level (every legacy service-delivery capability now exists multi-tenant in `presence`). Per the legacy policy, **nothing is deleted until parity + a data-disposal window is confirmed in P2-G.**

| Legacy (clever-api / `0000_baseline`) | Superseded by (presence) | Deprecation eligibility |
|---|---|---|
| `projects`, `studio_tasks`, `timeline` | `presence_projects` / `presence_tasks` / `presence_milestones` / `presence_project_events` | **After P2-G** (data disposable) |
| `project_surveys` | `presence_surveys` / `presence_survey_responses` | After P2-G; `project-survey.html` (anon PostgREST write) → retire |
| `approvals` (0000) + `0014` respond cols | `presence_approvals` (version-integrity) | After P2-G |
| `client_requests` | `presence_support_requests` / `presence_support_messages` | After P2-G |
| `messages`, `growth_messages` | `presence_project_messages` (Growth → Phase 8) | Messaging: after P2-G; Growth: Phase 8 |
| `notifications` (0000) | `/notifications` (derived) + `presence_activity_reads` | After P2-G |
| `files` (0000) | `presence_deliverables` (overlay on `presence_media`) | After P2-G |
| `portal.html` service-delivery sections (project/progress/approvals/files/messages) | `projects.html` (Studio) + the client project view | **After the client-app surface parity** (P2-D-5 built the Studio surface; the reviewer/client rendering rides the same API — full client UI is a Phase-6 surface task). Keep `portal.html` until then; its Growth tab stays for Phase 8. |
| `admin-growth.html`, clever-api Growth engine | — | **Keep (Phase 8 / DDS-internal)** |
| DDS admin console (`dds-studio-manage-9k2p.html`), Calendly, revenue/practice BI | — | **Keep (DDS-internal, isolated)** — never in presence |

**Do not remove unrelated DDS-internal capabilities.** Legacy retirement is a dedicated, dependency-verified P2-G pass.

## Remaining before P2-E
None are P2-D engineering blockers:
1. **Owner applies migrations `0075`–`0078` to prod** at launch (incl. the bucket PDF fix). Then `/projects/*`, `/support`, etc. go live on prod.
2. **Human product-experience QA** (browser/mobile/keyboard/screen-reader) of `projects.html` + the client project view at **Phase 6 — Gold Master** (carried via `P2C1-HUMAN-QA-PACKAGE.md` — add the service-delivery surfaces).
3. **Client-app surface build-out** (a richer `/client.html` reviewer view over the same validated API) — a Phase-6 UI task, not a backend gap.
4. Evidence-driven refinements logged in the deep audit (message unread badges, project-less support notifications, notice-rail consolidation) — only when justified.

P2-D is complete. **Do not begin P2-E** without explicit approval.
