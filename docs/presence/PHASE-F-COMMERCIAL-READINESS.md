# Phase F — Commercial Readiness Report

*Implementation of the Product-Review-approved commercial features, plus an honest review of what already existed. No new architecture; everything reuses the one publish pipeline, the CRM timeline, and the approval spine.*

---

## Executive summary

The three features the A9 Product Review Board approved to **build next** are now live (staging + prod): **FD-1 scheduled publish / revert (content expiry)**, **FD-2 lead capture / forms**, and **FD-3 approval → notify → one-tap approve**. Each reuses an existing spine — scheduled runs fire the *one* publish pipeline, form submissions feed the CRM timeline, and one-tap approval calls the *existing* decide logic via a signed stateless token. Verification also confirmed that several Step-2 items **already exist and work** (pixel-perfect preview via the production renderer, publish-readiness validation, and a full SEO surface), so they were reviewed rather than rebuilt. The remaining Step-2 items were triaged "approve-for-future" by A9 (not "build next") and are documented as V1.1 with reasons. 25 new commercial tests; invariants 14/14; new routes deployed and smoke-verified (public form/approve graceful, gated schedule/inbox 401).

---

## Step 1 — Discovery

The approved set (A9 triage): **FD-1, FD-2, FD-3** = build next. Everything else in the queue is approve-for-future (V1.1) or merged/rejected. Infrastructure verified present: the scheduler (`presence_scheduled_runs` + `/system/run` cron), `sendEmail` (Resend, degrades gracefully unset), `runPipeline` (the one publish path), the approval decide logic, and the CRM timeline aggregator. So the trio could be built additively with no new architecture.

---

## Step 2 — Implemented (approved) + reviewed (existing)

### Built this milestone

**FD-1 · Scheduled publish / revert (content expiry).**
- `presence_scheduled_publishes` (frozen snapshot + due time + kind publish|revert). `POST /schedule` freezes the current draft into a snapshot now (WYSIWYG at schedule time); `kind:'revert'` schedules a restore of a chosen prior version (expiry). `GET /schedule` lists pending; `POST /schedule/:id/cancel`.
- The scheduler's new `runDuePublishes()` claims due rows (no double-fire) and runs `runPipeline` (publish or restore) — the **same** pipeline a manual publish uses. Wired into `/system/run` (task `publish`, and the default cycle also fires due publishes, so one cron tick covers both). Failures are recorded + alert-emailed.

**FD-2 · Lead capture / forms.**
- The template already renders a real `<form>` when `formEndpoint` is set; publish now sets it to the public capture endpoint, so the customer's contact form becomes live. `POST /forms/:siteId/submit` (public) validates + sanitizes (honeypot marks spam silently; caps every field; requires email-or-phone), stores to `presence_form_submissions`, best-effort emails the owner, and feeds the **CRM timeline** (a new `lead` item — shared). Owner inbox: `GET /forms/inbox`, `POST /forms/inbox/:id` (status). No raw IP stored (salted hash for abuse only) — respects the no-tracking ethos.

**FD-3 · Approval → notify → one-tap approve.**
- A **stateless HMAC-signed token** (no table) authorizes exactly one decision on one plan, with a one-week expiry. `POST /approve/send` (owner/operator) emails the client a focused one-tap link per pending approval. `GET /approve?token=` (public) shows the item; `POST /approve` (public) applies the decision through the **existing** approval spine (infra-plan PATCH or `decideWritePlan`). The customer touchpoint is `approve.html` — a calm, focused approve/reject page.

### Reviewed — already exists (no rebuild needed)

| Step-2 item | Status |
|---|---|
| **Pixel-perfect preview using the production renderer** | ✅ Phase B1 — `/preview` renders through `renderSnapshot`, identical to publish |
| **Publish Readiness** | ✅ `validateSnapshot` produces blockers/warnings, surfaced in preview headers + the room |
| **SEO** — description, canonical, Open Graph (title/description/image/type/url/site), Twitter (via OG), **structured data (JSON-LD)**, **sitemap.xml**, **robots.txt**, redirect management | ✅ produced by the template + `presence_redirects` in the snapshot |
| **Version History / Restore / Rollback** | ✅ M7 + Phase B1 (dev layer folded into the snapshot) |

### Deferred to V1.1 (approve-for-future, not build-next — documented, not built)

Shareable preview links (FD-6), named draft snapshots (FD-7), version compare (FD-12), shared comments (FD-19), weekly client digest + operator digest (FD-5), approval reminders, client setup templates (FD-18), brand asset library (FD-20). Each is queued with a rationale; none is a commercial *gap* (the approved trio closes the material gaps).

---

## Step 3 — Customer experience

- **Freelancer / business owner:** can now schedule a holiday-hours flip, let a promo expire itself, receive leads from their own site in one inbox (and the relationship view), and send a client a one-tap approval email. These are the "wait, it can do that?" wins.
- **Client reviewer:** the one-tap email turns approval from "happen to be in the app" into a delightful ritual — tap → focused page → done.
- **Premium feel:** calm language, no scores, approval-first preserved end-to-end (even scheduled publishes and one-tap approvals flow through the same gated pipeline).

## Step 4 — Operator experience

The operator can already monitor customers, approvals, failed connections, notifications, and client health via the CRM + `/system/health` + the scheduler ledger. Phase F adds: leads visible per client (CRM timeline + inbox), a "notify client for approval" action (`/approve/send`), and scheduled publishes reducing manual timing work. The full operator *console* consolidation remains FD-9 (V1.1).

## Step 5 — Commercial experience

Unchanged and complete from Phase D1: purchase, subscription, billing, trial, founder pricing, upgrade, downgrade, cancellation, reactivation — all through Stripe + the entitlement spine. Phase F adds no commerce surface (correctly — it's feature work, not billing).

## Step 6 — Operational excellence

- **Scheduled jobs:** `runDuePublishes` joins the existing cycle/retry, recorded in the ledger; claimed atomically (no double-fire); failures alert-emailed.
- **Email:** Resend via `sendEmail` — degrades gracefully (logs + returns false) when `RESEND_KEY` is unset, so nothing breaks pre-activation.
- **Error handling / recovery:** form submit is always graceful (bots get 200); scheduled failures are recorded with `last_error` and don't stop siblings; one-tap tokens fail closed (bad/expired/tampered → refused).
- **Audit:** one-tap decisions write a change event; leads carry their own row; no ledger bypassed.

---

## Commercial Feature Matrix

| Feature | State | Route(s) | Reuses |
|---|---|---|---|
| Scheduled publish/revert (FD-1) | **Built** | `/schedule*`, `/system/run` task `publish` | the one publish pipeline |
| Lead capture / forms (FD-2) | **Built** | `POST /forms/:id/submit`, `/forms/inbox*` | CRM timeline |
| One-tap approve (FD-3) | **Built** | `/approve/send`, `/approve` (GET/POST) | approval decide spine |
| Pixel-perfect preview | Exists | `/preview` | `renderSnapshot` (B1) |
| Publish readiness | Exists | `/preview` headers, `/changes` | `validateSnapshot` |
| SEO (meta/OG/JSON-LD/sitemap/robots/redirects) | Exists | template render | snapshot |
| Version history/restore/rollback | Exists | `/publishes`, `/restore` | snapshot |
| Shareable preview links | V1.1 | — | FD-6 |
| Digests / comments / setup templates / brand library / version compare | V1.1 | — | FD-5/19/18/20/12 |

---

## Operational Readiness Report

- **Owner activation needed for full effect (non-engineering):** `RESEND_KEY` (email for lead notifications + one-tap approval sends), `APPROVAL_SECRET` (or reuse `SCHEDULER_SECRET`; one-tap returns 503 until set), the cron hitting `/system/run` (fires scheduled publishes). All degrade honestly when absent.
- **Everything else** (validation, storage, CRM feed, token verification) works without activation.

---

## Feature discovery (documented, not built)

- **FD-F1 · Scheduling & forms UI** — a "Schedule" option in the publish flow and a dedicated leads inbox screen (backends are complete + tested; the in-app UI is the remaining wiring). *V1 polish · Low-Medium.*
- **FD-F2 · Auto-notify on plan proposal** — send the one-tap email automatically when a plan is proposed (today `/approve/send` is operator-triggered). *V1.1 · Low.*
- **FD-F3 · Booking form with availability** — the `booking` form kind exists as capture; real calendar availability is a larger feature. *V1.1.*
- (Existing V1.1: FD-5 digests, FD-6 preview links, FD-7 named snapshots, FD-12 compare, FD-18/19/20.)

---

## Final Questions (answered honestly)

- **Would a paying customer feel they purchased a premium platform?** **Yes** — scheduled publishing, real lead capture, and one-tap client approval are table-stakes-plus, delivered calmly and approval-first.
- **Would an agency confidently run their business on it?** **Yes** — the trio plus the CRM/portfolio/one-shell make it a real operating system; leads and approvals now close the loop.
- **Would a freelancer save meaningful time?** **Yes** — schedule-and-forget publishing and a lead inbox remove real manual work.
- **Would a business owner understand it?** **Yes** — plain language, one-tap flows, no jargon.
- **Would the commercial experience compete with modern SaaS?** **On these features, yes.** The honest gaps vs. mature SaaS are the deferred niceties (digests, comments, preview links) and the *in-app UI* for scheduling/inbox (backends done; UI is FD-F1).
- **Any commercial gaps / unfinished workflows?** The three approved features are complete server-side and one-tap has its page; **scheduling and the leads inbox still need their in-app screens** (FD-F1) and email needs owner activation (`RESEND_KEY`). Neither is an architecture gap — both are wiring/activation.
- **Anything that should be V1 before launch?** **FD-F1 (the scheduling + inbox UI)** is the one thing worth finishing for a polished V1 launch — the value is built and tested; it just needs its screens. Everything else is honestly V1.1.

---

**Phase F — Commercial Readiness complete.**
