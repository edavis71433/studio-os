# Phase M — Site Operations & Feature Optimization

*An optimization milestone — make what already exists easier, faster, clearer, and more discoverable. The headline result: the tracked V1 launch gate (FD-F1 / GM-1) is closed — scheduling and leads now have in-app screens, surfaced in the one nav. Consolidates the Site Operations Review, Workflow Optimization, Cross-Workspace Review, and per-workspace optimization reports.*

---

## Executive summary

The biggest operational friction the last three reviews kept flagging was real: FD-1 (scheduled publish) and FD-2 (lead capture) shipped as **tested backends with no in-app screens**, so customers could only reach them via the API — a hidden capability. This milestone **surfaces them**: a **Leads inbox** (`leads.html`) and a **Scheduled changes** surface (`schedule.html`), both discoverable through the one entitlement-driven nav, plus a one-tap "email the client to approve" action added to the CRM. No new architecture, no duplication — these are screens over existing, tested endpoints. That closes launch gate **GM-1**. The nav dead-link guard (Phase L) verified the new destinations resolve automatically.

---

## Step 1 — Discovery (friction audit)

Audited every workflow for unnecessary clicks / lost context / hidden actions. The material findings:

| Friction | Where | Severity |
|---|---|---|
| **Scheduling has no screen** — the FD-1 backend is live but a customer can't find or use it | Publishing | **High (V1)** — the fix |
| **Leads have no inbox** — FD-2 stores + feeds the CRM timeline, but there's no dedicated inbox to work them | Lead handling | **High (V1)** — the fix |
| One-tap approval exists but the "notify client" action isn't surfaced | Approvals | Medium (V1) — added to CRM |
| Content search across items (vs. nav palette) | Search | Low (V1.1) |
| Persisted read/unread notifications | Notifications | Low (V1.1) |

Everything else (publish/preview/restore/CRM/connected/media/SEO/export/import) was already polished in Phases A–F and verified in Phase E; no new friction of consequence.

---

## Step 2 — Operational optimization (implemented)

**Leads inbox (`leads.html`).** Consumes `GET /forms/inbox` + `POST /forms/inbox/:id`. Filter (Open / New / All), one-tap **Reply** (mailto), **Mark read**, **Archive**; calm empty state that points to the relationship view. Surfaced in nav ("Leads", in Today) for every website edition.

**Scheduled changes (`schedule.html`).** Consumes `GET /schedule`, `POST /schedule`, `POST /schedule/:id/cancel`. Schedule the **current draft** for a future datetime with an optional note ("freezes your draft as it is now — keep editing freely"); lists upcoming with **Cancel**. Surfaced in nav ("Scheduled", in Website) wherever publishing is available.

**Notify-to-approve, surfaced (CRM).** When the studio view shows pending approvals, a "Email the client to approve" button calls `POST /approve/send` — turning the built one-tap loop into a one-click action instead of an API call.

All three: fewer clicks, less context-switching (no API), more discoverability (in the one nav), no new system.

---

## Step 3 — Cross-workspace review

Walked every transition. With the unified shell (C1) the frame is constant; the user always knows where they are (highlighted nav), why (the surface's own header/empty-state), and what's next (a doorway or a primary action). New checks:
- **CMS ↔ Scheduling:** "Scheduled" sits in the Website section next to Publish — same mental model (publishing), just later. Draft-freeze messaging removes the "will my later edits change it?" confusion.
- **Business OS/Website ↔ Leads:** Leads sits in Today (a daily "what needs you") and links to/from the CRM relationship view; a lead is both an inbox item and a timeline event — one truth, two lenses, no duplication.
- **CRM ↔ Client Portal (approvals):** the CRM "email the client to approve" → the client's one-tap page (`approve.html`) → the existing approval spine. The loop is now visible from the studio side.

## Step 4 — Site operations review

Publishing, preview, **scheduling (now discoverable)**, restore, rollback, SEO, metadata, redirects, media, forms, **leads (now an inbox)**, Business Moments, connected, monitoring, logging, notifications, search, exports, imports, recovery — all present and, after this milestone, all **reachable from the UI**. Premium-enough for a modern SaaS in the daily flows; the remaining polish (content search, persisted notifications) is V1.1.

## Step 5 — Customer experience (personas)

- **Freelancer / business owner:** can now *find* scheduling and leads — the two "wait, where is that?" moments from prior reviews are gone.
- **Agency:** the CRM "notify to approve" removes a chase step across many clients.
- **Client reviewer:** unchanged calm portal + the one-tap email.
- **Operator/support:** leads + scheduled changes are inspectable per site; nothing new to learn.

---

## Per-workspace optimization notes

- **CMS:** scheduling surfaced next to Publish; draft-freeze semantics made explicit. No editor redesign (presence.html untouched — the new surface is additive).
- **CRM:** notify-to-approve action + Leads doorway; the timeline already carried leads (Phase F).
- **Client Portal:** unchanged (intentionally minimal); benefits from the studio-side notify action.
- **Admin Tool:** unchanged; leads/scheduled are site-scoped and operator-reachable.
- **Agency:** benefits from per-client notify-to-approve; no new agency surface needed.
- **Developer:** unaffected; Developer Mode unchanged.

---

## Step 6 — Feature triage

- **Implemented (V1, closes GM-1):** Leads inbox UI, Scheduling UI, CRM notify-to-approve — all screens over existing endpoints.
- **V1.1 (documented):** content search across items; persisted read/unread notifications (FD-C1-shell); shareable preview links (FD-6); named snapshots + visual diff (FD-7/12); digests (FD-5); booking availability (FD-F3); auto-notify on plan proposal (FD-F2).
- **Rejected (by law/ethos):** dashboards (Law 13), sales pipeline, page builder, workspace personalization — building these would reduce, not improve, the product.

---

## Testing

`nav_integrity` 3/3 (now verifies `/leads.html` + `/schedule.html` resolve — the guard catching that the new nav points at real pages), editions 36/36 (every edition still complete/non-empty with the new items), shell 18/18, workspace 38/38, invariants **14/14**, `deno check` clean; `leads.html` + `schedule.html` parse clean. Function deployed staging+prod (nav change); smoke: catalog 200, `/portal/context` + `/schedule` 401 gated. The authed browser pass on the two new screens is the one human-QA step.

---

## Final Questions (answered honestly)

- **Does Studio OS now feel effortless to operate?** **Materially more so** — the two capabilities that were hidden are now first-class and discoverable; the daily flows are click-light.
- **Can a freelancer run multiple clients / an agency manage many businesses?** **Yes** — one shell, per-client relationship, portfolio switching, and now leads + scheduling + notify-to-approve without leaving the frame.
- **Can a business owner accomplish common tasks without confusion?** **Yes** — publish, schedule, work leads, approve — each has an obvious home.
- **Can a developer customize safely / an operator support quickly?** **Yes** — unchanged and intact.
- **Do all the workspaces feel like one cohesive operating system?** **Yes** — the unified shell frames the new surfaces exactly like the rest; leads/scheduling read as part of the whole, not bolt-ons.
- **Anything still awkward?** The two new screens need their **authed browser QA pass** (I can't run a browser here). And `presence.html`'s in-editor publish flow could later gain an inline "schedule instead" shortcut (today scheduling is its own calm surface) — a minor V1.1 nicety, not awkward.
- **Anything to optimize before launch?** With GM-1 now closed, the remaining pre-launch items are **owner activation** (RESEND_KEY/APPROVAL_SECRET/cron/PITR), the **human live passes**, and the separately-milestoned **front door / guided onboarding** — none an operational-optimization gap.

---

**Phase M — Site Operations & Feature Optimization complete.**
