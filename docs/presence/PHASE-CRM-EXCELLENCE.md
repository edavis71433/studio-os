# Phase CRM — CRM Excellence & Competitive Benchmark

*Discovery re-verified the deliberate architecture: **Studio OS's CRM is an operational relationship hub, not a sales CRM.** It does not invent parallel pipeline/deal/company objects — it aggregates what the platform already records (publishes, changes, connected events, Moments, approvals, leads, notes) into ONE calm per-client timeline, plus a health word, a plain-language summary, and relationship notes. This phase found exactly one real gap in that model and closed it; everything else the review surfaced is either already built or a deliberate, defensible omission for the target market.*

## Step 1 — Discovery (verified, not assumed)
- **Leads** (`presence_form_submissions` → `leads.html`): public capture with honeypot + per-IP/per-site rate limits, owner email on arrival, reply-prefill (mailto with the customer's message quoted), new/read/archived, reply auto-marks read. Also folded into the CRM timeline (`mapLead`).
- **Relationship hub** (`/crm/*` → `crm.html`): unified timeline (audience-filtered studio vs client), calm health (`healthy|attention|quiet|new`, a word never a score), deterministic relationship summary, relationship notes (internal/shared, pin, soft-delete).
- **Approvals**: one-tap approve via HMAC-signed stateless token emailed to the owner (`/approve/*`, `approve.html`); decisions run through the existing approval spine.
- **Automation already present**: Business Moments (evidence→judgment→recommendation→moment spine), the weekly owner digest (counts new subs / payment-trouble / lapsed / **leads waiting >2 days** / failed publishes), lifecycle comms (trial, payment-trouble, wind-down, win-back, welcome-back), the domain watch, the cross-region watchdog — all riding one 15-minute cron.

## Step 2 — Competitor benchmark
- **HubSpot / Salesforce / Zoho**: full sales CRMs — pipelines, deal stages, custom objects, reporting. Powerful and *heavy*; a solo owner drowns in fields they'll never fill. Studio OS deliberately does not compete on object depth — it competes on **zero setup and zero data entry** (the timeline is aggregated, not typed in).
- **GoHighLevel**: the closest agency-CRM peer — but it's an operator cockpit that assumes a marketer runs it. Studio OS's client side is the *business owner*, not a marketer; the calm surface is the differentiator.
- **Pipedrive / Monday CRM**: pipeline-first, drag-a-card UIs. Great when you *have* a sales pipeline; overkill for a plumber who gets 3 quote requests a week and needs to not forget to reply.
- **Where Studio OS wins for its market**: nothing to configure, no fields to maintain, one calm timeline, and — now — the platform actively taps the owner when a lead goes unanswered. The competitors expose a system to *operate*; Studio OS removes the operating.

## Step 4/5 — The one gap, closed: the un-replied lead follow-up nudge (FD-CRM1)
**The gap:** a lead emailed the owner *once* on arrival; after that, if it sat unanswered, nothing tapped them until the **weekly** digest. For a quote request, a week is a lost customer.

**Shipped:** the lifecycle sweep now raises **one calm follow-up notice + email per lead** when a non-spam lead has sat `status='new'` for **1–7 days** (aged enough to matter, fresh enough that nudging isn't nagging; older-still-new leads stay with the weekly digest). It rides the exact rails every other lifecycle touch uses:
- the existing notices rail (`presence_plan_notices`, rendered by the workspace with dismiss),
- send-once via the table's `unique(client_id, kind, period)` with **`period = lead:<id>` → exactly one nudge per lead, ever**,
- the same 15-minute cron, the same `sendEmail` (graceful no-op without RESEND_KEY).

Copy is reply-first and pressure-free: *"A quote request is waiting for a reply — Sam reached out about a day ago and hasn't heard back yet. A quick reply keeps them warm."* → **Reply now →** deep-links to the leads inbox. No new table, no new surface, no duplicate system. Pure core (`leadFollowupDue` / `leadFollowupCopy`) tested; the runner mirrors the proven domain watch.

**Why a notice, not a Moment:** the Moments engine is a frozen recs-only spine (evidence→judgment→recommendation→moment) that supersedes its whole active set each run — an externally-injected lead item would be wiped. The notices rail is the correct, established home for usage/lifecycle-grounded taps, exactly as capacity, trial, wind-down, and domain-expiry already use it.

## Deliberate omissions (not gaps — design)
- **No pipeline / deal / company objects**: the target market (owner-operators, 3–20 leads/week) would leave them empty. Adding them would *create* work — the opposite of the objective. Revisit only if a sales-team edition (Enterprise+) is ever chartered.
- **AI lead drafting / summaries**: reply-prefill already removes the blank-page problem deterministically (no AI cost, always available). An AI "draft a reply" button is a plausible V1.1 nicety, not a V1 gap — recommended below, not built.

## Testing
`commercial` 40/40 (＋10 new: window boundaries, status/spam exclusions, bad-date safety, calm kind-aware copy, never-blank name, no sales language) · `crm` 24/24 · `lifecycle` 22/22 · `platform_invariants` 14/14 · `nav_integrity` 3/3. Typecheck clean. Migration 0061 applied staging + prod; function deployed both envs; CRM + notices routes verified serving on the new prod deploy.

## Final questions (answered honestly)
- **Can a business owner comfortably run their customer relationships entirely from Studio OS?** For the target owner-operator: yes — capture, reply, a per-client history, notes, and now a safety net so no lead is silently dropped. For a business that runs a multi-stage *sales pipeline* with forecasting: no, and by design — that's HubSpot's job, not this product's.
- **Can an agency manage 100 customers?** Yes for relationship operations — per-client desks, the aggregated timeline, and the automated nudges/digests mean the agency isn't manually chasing each client's inbox. A cross-client "all un-replied leads" roll-up is the natural next agency read (it's the same cheap query).
- **Can Studio OS legitimately compete with HubSpot and HighLevel for its target market?** Yes — *for its market*, by refusing their premise. It wins on zero-setup and no-data-entry for owners who would never populate a real CRM. It does not and should not try to beat them on object depth or sales automation.
- **Would I personally use this CRM to run my own business?** For a small service/local business, yes — I'd trust it to catch the lead I forgot. For a company with a dedicated salesperson and a real pipeline, I'd want more, honestly.
- **Anything else before launch?** Nothing new in CRM. The one recommendation below is a V1.1 enhancement, not a gate.

## The ONE naturally-emerged recommendation (not built — awaiting approval)
An **agency "leads needing a reply" roll-up** — the un-replied-lead query already exists per-site; surfacing it across an agency's whole client list as one list ("3 clients have a lead waiting") is a single read on data we now compute, no new pipeline. It naturally extends this phase's nudge from per-owner to per-agency. Recommend building it with the next agency-surface touch.

**Phase CRM — CRM Excellence & Competitive Benchmark complete.**
