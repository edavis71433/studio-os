# Deep Audit — P2-C + P2-D (gaps, cohesion, correctness, performance)

**Date:** 2026-07-10. **Method:** four parallel adversarial code reviews (security/tenant-isolation · cross-workflow cohesion · performance · correctness/gaps) over the P2-C sales + P2-D service-delivery code, each returning file:line-grounded findings; the load-bearing ones verified by hand. **Scope note:** P2-D's engineering gates are green and **site-level tenant isolation is solid** (the security pass found zero missing-`site_id`/IDOR issues; every request-supplied id is re-validated in-site). The findings below are about *what to build/decide next*, not a broken gate.

---

## A. Architectural decision required (the one real "stop and decide") — the post-sale journey doesn't connect

Two independent audits converged on the same root issue. **Verified in code:**
- **Convert gives the customer their OWN new site.** `handleSalesConvert` → `provisionForSignup` inserts a `presence_sites` row for the new `clientId` and returns it as `converted_site_id`; the customer becomes owner of *that* workspace.
- **The project is created on the STUDIO's site.** `POST /projects` uses `site.id` (the site where the deal lives), with `client_id` pointing at the customer.
- **Nothing bridges the two.** The deal→project handoff (`POST /projects {deal_id}`, with all its idempotent `created_project_id` machinery) **has no UI caller** (grep: no `.html` sends `deal_id`), and convert never adds the customer as a member of the studio site. So: the customer logs into an empty workspace; the project sits on a site they can't reach; and no surface ever turns a won deal into a project.
- **Latent multi-client isolation gap (same root):** the client side is gated only by a site-wide `client_visible` boolean, never by *which* client a reviewer represents (site membership has no `client_id`). If a studio ever hosts several external clients as `client_reviewer`s on one site, reviewer A can read — and, via the whitelisted write routes, **mutate** (post messages, decide approvals on) — client B's delivery. Support was correctly scoped per-requester; projects/messages/deliverables/approvals/surveys were not.

**The decision:** which site owns delivery, and how is a customer bound to it?
- **Option A — deliver on the studio's site; customer joins as a scoped `client_reviewer`.** Add `client_id` to site membership, add `&client_id=eq.<reviewer's client>` to every client-side query, and have convert `addSiteMember(studioSite, email, 'client_reviewer')`. Supports "one agency workspace, many client portals." More work; fixes the multi-client gap.
- **Option B — deliver on the customer's own `converted_site_id`.** The handoff creates the project on the customer's site; the studio operates via agency scope-switching (already built). Each customer is naturally site-isolated (no multi-client gap). Simpler; the customer's own workspace becomes their delivery home.

This is a genuine architecture fork with roadmap impact — it needs your call before the client-facing surface is built. **Everything in §C below (the orphaned client UI) is blocked on it.**

---

## B. Genuine bugs — small, safe fixes (no architecture needed)

| # | Bug | File | Fix |
|---|---|---|---|
| B1 | Flipping a task to `client_action_required` via PATCH emits **no event** → the client is never notified an action is needed (the `client_action` event kind is defined but never emitted anywhere). | `routes/projects.ts` task field-patch | emit `projectEvent(...,'client_action',...,true,...)` on false→true. |
| B2 | Deliverable `draft`→`shared` via PATCH emits no event → client never gets "a file was shared" for a file shared after upload. | `routes/project_delivery.ts` deliverable PATCH | emit `deliverable_added` (visible) on the transition to shared. |
| B3 | A support request with **no `project_id`** (the common case) emits no events → studio isn't notified of new tickets and the client isn't notified of replies/resolution (notifications derive only from `presence_project_events`). | `routes/service_intake.ts` + `handleNotifications` | give support its own site-scoped notification source (or require/attach a project). |
| B4 | An approval created `client_visible:false` is **un-decidable by anyone** (decide 404s on non-visible; no studio path). | `routes/project_delivery.ts` `handleApprovalDecide` | allow studio to decide regardless of visibility. |
| B5 | Support triage PATCH lacks the optimistic `&status=eq.<prior>` guard that every other status change uses → two concurrent triages can clobber each other. | `routes/service_intake.ts` | pin prior status in the WHERE, 409 on 0 rows. |
| B6 | Deliverable download checks the deliverable's visibility but not the **parent project's** — a shared file on an internal project is downloadable with the two ids. | `routes/project_delivery.ts` `handleDeliverableDownload` | require `studio || project.client_visible`. |

---

## C. Cohesion / journey gaps (mostly the Phase-6 client surface; blocked on §A)

- **The entire client-facing delivery surface is orphaned** — `client.html` consumes only `/portal/context` + `/portal/feed`; it never calls `/projects`, `/report`, `/messages`, `/notifications`, `/surveys`, or `/support`, though all are whitelisted for reviewers. (Known: client-app surface was deferred to Phase 6 — but §A must be decided first.)
- **`/support` and `/surveys` have no UI at all** (studio or client) — API-only today. Studio support belongs in Inbox + a `support.html`; surveys inside the project detail.
- **Two notification systems the user never sees converge.** The shell bell + Inbox read `/portal/feed` (`presence_plan_notices`, infra/connection plans); P2-D's `/notifications` (over `presence_project_events`) is orphaned. Project messages/approvals/deliverables/surveys never light the bell or reach Inbox. **Recommend:** fold `/notifications` into Inbox + `attention_count` so there's one "needs you" surface.
- **Two approval pipelines.** `portal/feed.pending_approvals` (infra/connection/file) vs `presence_approvals` (project) — same "needs your OK," disjoint. Fold client-visible project approvals into `/portal/feed`.
- **"Messages" is split across ≥3 stores under one word** — `leads.html` (titled "Messages") = form submissions; `crm.html` notes = relationship notes; `projects.html` = project messages; support messages (no UI). Recommend disambiguating labels now (leads → "Website enquiries"), unifying the thread component later.
- **Nav keyspace mismatch** — Pipeline (by deal), Customers/CRM (by site+notes), Projects (by project, `client_id` nullable) are three lists with no join; no "open a customer → their deals → their project" path. CRM's "open in context" links to Today/Website/etc. but not Pipeline or Projects.

---

## D. Performance — two quick wins, the rest well-bounded

- **D1 (fix now): `resolveSiteRole` runs twice per client request.** The reviewer-boundary gate resolves it, then every handler's `isStudioSide()` resolves it *again* — on the client portal path this duplicates a slow external `/auth/v1/user` round-trip (up to 3 wasted calls/request, client-side only). **Fix:** resolve once in the gate, thread the role/`isStudio` into handlers.
- **D2 (fix now): unbounded `sort_order` prefetch on task/milestone create** — fetches *every* row in the project to compute max+1. **Fix:** `&order=sort_order.desc&limit=1` (index already exists; `nextSortOrder` tolerates a 1-element array).
- **D3 (add index): support list orders by `updated_at` with no matching index** (siblings all have `(site_id, updated_at desc)`; support doesn't). Add `presence_support_site_recent_idx`.
- **D4 (correctness bound): `/report` reads up to 1000 task rows to produce counts** — beyond 1000 tasks/project the counts silently undercount. Fine for V1; use `Prefer: count=exact` if tightened.
- **Watch (not now):** project bundle over-fetches internal rows for the client side (push `client_visible=is.true` down); notifications client path prefetches ≤500 unordered project ids (drop the prefetch and filter events by `site_id+client_visible` directly, or order the prefetch); leading-wildcard `ilike` searches (fine under site scoping until tens of thousands of rows → `pg_trgm`).
- **Verified good:** no N+1; list endpoints select narrow columns with no per-row lookups; all lists `clampLimit`≤100; index coverage otherwise complete.

---

## E. Refinements (low, evidence-driven)

- **R1:** auto-advanced deal stages (proposal-send/accept, contract-sign) emit no `stage_change` event → the pipeline appears to jump `lead→contract` with no history. (Logged earlier as P2-C2 Obs-2.)
- **R2:** convert's "Sign the agreement before converting" message overstates the gate (an *accepted proposal* reaches `contract` stage without a signed contract). Soften the copy or require a signed contract. (P2-C2 Obs-1.)
- **R3:** `signed_evidence.ip_hash` is reserved in the schema but never populated; `clientIp(req)` is available — a cheap legal-evidence win. (P2-C2 Obs-3.)
- **R4/R5:** event-log fidelity — a later visibility flip leaves the original `*_created` event hidden; no events on project field edits, milestone reopen, deliverable soft-delete, support reopen. Add targeted events where client-relevant.
- **R6:** `expected_value_cents` is unbounded (line-item `unit_cents` is capped) — add a matching ceiling.
- **R7:** deal→project handoff orphan-cleanup can fall through to a spurious 201 in a rare lost-claim + deleted-deal race — 409 instead.

---

## Recommended priority
1. **Decide §A** (delivery-site model + convert→project bridge) — unblocks the whole client experience; pick Option A or B.
2. **Fix §B bugs + §D1/D2/D3** — small, safe, high-value hardening (I can do these in one pass on approval).
3. **§C consolidation** — one "needs you" surface (fold `/notifications` + project approvals into Inbox/feed) and the client delivery UI — sequence into Phase 6 once §A is decided.
4. **§E refinements** — as capacity allows.

None of this reopens the P2-D gate (site-level isolation + the 16-step lifecycle stand). These are the next-lap items.
