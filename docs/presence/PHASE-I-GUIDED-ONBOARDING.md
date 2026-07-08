# Phase I — Guided Onboarding & First-Run Experience

*A brand-new customer never lands in an empty workspace. Instead: a short intake → Studio OS drafts their whole website (using the existing `starter_site` writer) → they review, preview, approve, publish. Built entirely on existing systems — no new architecture, no bypass of approvals. Consolidates the Guided Onboarding Guide, First-Run Experience Guide, Customer Journey Map, Automation Guide, and Role Onboarding Guide.*

---

## Executive summary

The first-run experience is now a guided flow (`get-started.html`) that every new customer lands on after signup/checkout. It asks two calm questions (industry — with smart default services pre-filled — and a one-line description), then calls the **existing** `starter_site` writer to draft the whole site (homepage copy, pages, offerings, FAQs, SEO), auto-applies the single option to the **draft** (never published), and routes the member to review → preview → publish through the **existing approval-first pipeline**. When AI isn't switched on (or drafting fails), it degrades gracefully into a "let's set it up together" 3-step path. Contextual one-line lessons teach approvals, ownership, and rollback in place. This promotes FD-M1 into onboarding. Pure core tested (onboarding 18/18); no backend change, so no redeploy; the authed browser pass is the standing human-QA step.

---

## Step 1 — Discovery (what existed)

| Piece | State | Decision |
|---|---|---|
| Signup → Stripe → provision | Complete; provision seeds identity (business_name) + starter rows + `presence_first_run` | Reuse; don't rebuild |
| `welcome.html` | Post-payment poll → "Enter your workspace" → dropped into `presence.html` (blank) | **The gap** — the blank-workspace problem |
| First-run checklist | `/commerce/first-run` derives 4 steps (details/brand/domain/publish) | Reuse as the guided/fallback path |
| **`starter_site` writer** | Exists — drafts a whole structured site from facts; a PROPOSAL, approval-first — but **manual-only** (`/writer/generate`, "only when asked") | **Promote into onboarding (FD-M1)** |
| Approval-first publish, preview, rollback, Business Moments, CRM | Complete + automatic (scheduler runs Moments/coach) | Reuse; onboarding routes into them |

Conclusion: everything needed existed; the missing piece was the *orchestration + guided surface* that turns a blank first workspace into "we drafted your site — review it."

---

## Step 2/3 — First-run + auto-starter (implemented)

**`get-started.html`** — the new first screen:
1. **Intake (guided setup, minimal):** industry chips (8 options — not restaurant-only); a few **pre-filled services** per industry the member can edit/add (never a blank field); one line "what should visitors know?". Two paths: **Build my website** or **I'll set it up myself**.
2. **Auto-draft:** builds the `starter_site` request (`buildStarterRequest`, tested) and calls **`POST /writer/generate`** — the existing writer, no new endpoint. Then fetches `/writer/drafts` and **auto-applies the single option** (`/writer/drafts/:id/accept`) to the **draft** — populated, but **not published**.
3. **Drafted:** "Your website is ready to review" + the first-success milestone path + **"Review & preview →"** into `presence.html` (the existing editor/preview/publish flow). Approval-first is intact end to end — the member reviews, previews, and only they publish.
4. **Graceful fallback:** if AI is off (`503`) or drafting fails, it becomes "let's set it up together" — a calm 3-step path into the workspace. Nothing breaks; the member is never stuck.
5. **Edition-aware:** a Business-OS-only edition (no website) is routed to its own landing (Today), not asked to draft a site.

Entry points wired: `signup.html` (trial) and `welcome.html` (post-checkout) now route to `get-started.html`.

---

## Step 4 — Guided setup: automate vs. manual

| Item | Onboarding treatment |
|---|---|
| Business name | Already captured at signup + seeded; greeted by name |
| Business type + services + description | **Collected in the 2-question intake**; services pre-filled per industry |
| Homepage copy, pages, offerings, FAQs, SEO, metadata | **Auto-drafted** by the writer from the intake (review-first) |
| Business hours, logo, images, contact details | **Kept manual** in the workspace (member-specific truth; the writer never invents facts it can't verify) |
| Connected accounts / Google Business Profile / social | **Kept manual** (OAuth consent is the member's; surfaced in the workspace) — proactive first-connect is FD-M8 (V1.1) |
| Forms / lead routing / email / notifications | Forms activate on publish; notifications via activation — no onboarding step needed |

Principle: automate the *drafting* (what the system can infer + the member reviews); keep *facts and consent* manual (what only the member can truthfully provide).

---

## Step 5 — First success (calm, not gamified)

The milestone path — **Website drafted → Previewed → Approved → Published → First Business Moment** — each with a one-line "why," shown as a quiet checklist, never points or badges. Drafting lights the first milestone immediately, so the member feels progress from minute one. Business Moments, first lead, and first CRM activity arrive naturally afterward (the scheduler already generates Moments automatically).

## Step 6 — Customer education (in place, no tutorial wall)

Three contextual one-liners on the drafted/fallback screens, reinforced by the milestone "why" text:
- **Approvals:** "Studio OS proposes; you approve. Nothing publishes without you."
- **Ownership:** "Export anytime, connect or disconnect freely, leave without penalty."
- **Rollback:** "Every publish is kept — restore an earlier version in one step."
(Version history, Moments, AI, Connected, Developer Mode are taught where they're used, not front-loaded.)

## Step 7 — Role onboarding

- **Freelancer / Business owner (self-serve):** the full guided draft-first flow above.
- **Agency member / operator:** they arrive via the agency/admin surfaces (which already have their own guided models — `portal.html`), not this consumer first-run; get-started is edition/site-scoped, so it fits the client they're setting up.
- **Client reviewer:** never sees onboarding — their world is the calm approval portal.
- **Developer:** Developer Mode is taught only when the capability is present (not in first-run).
- **Business-OS-only edition:** routed to Today (no website to draft).

No role is shown steps it doesn't need.

---

## Customer Journey Map (first five minutes)

`signup (name/email/plan)` → `Stripe (if paid)` → `welcome (payment confirmed)` → **`get-started`**: *industry + services + one line* → *drafting…* → **"your site is drafted, review it"** → `presence.html` *(review the draft)* → *preview* → *approve + publish* → *live, versioned* → *first Business Moment arrives on its own*. Blank states removed; every step has an obvious next action; approvals never bypassed.

---

## Automation Guide (what fires, safely)

- **Auto-draft** the whole site from the intake — a proposal, applied to the draft, **never published**.
- **Auto-populate** homepage/pages/SEO/metadata from the draft.
- **Business Moments / coaching** already generate automatically (scheduler) once the site is active.
- **Never automated:** publishing (approval-first), unverifiable facts (the writer's fact-guard refuses to invent), OAuth consent. Automation assists; the member always decides.

---

## Testing

`onboarding_test.mjs` (new) **18/18** — intake industries + smart defaults, the `starter_site` request built + bounded from intake (reuses the writer), the auto-draft readiness gate, and the calm milestones/lessons (no score/dashboard vocabulary — Law 13). Pages parse-clean (`get-started`, `welcome`, `signup`); regression green — nav_integrity 3/3, editions 36/36, shell 18/18, workspace 38/38, commercial 25/25, invariants **14/14**. Frontend + a tested pure spec; reuses existing `/writer` + `/portal/context` endpoints, so no function/migration change and **no redeploy**. Live browser QA of the wizard (and confirming it draws a real draft with `ANTHROPIC_KEY` set) is the standing human step.

---

## Feature discovery update

- **FD-M1 · Auto-draft starter site at first-run — ✅ IMPLEMENTED (this milestone).**
- Deferred (documented): FD-M8 proactive Google-connect first-card; FD-M5 richer guided welcome for the agency side; auto-detect business facts from the email domain/Google listing to pre-fill the intake (V1.1); a "resume onboarding" entry for members who skip. All in the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md).

---

## Final Questions (answered honestly)

- **Would a brand-new customer understand what to do?** **Yes** — two questions, then "review your drafted site." The path is obvious.
- **Would they ever feel lost / see an unnecessary blank page?** **No** — the blank workspace is replaced by a guided draft-first flow; even the AI-off case is a calm 3-step path, not a void.
- **Does Studio OS immediately provide value?** **Yes** — they get a real drafted website from a two-question intake, in seconds.
- **Does the onboarding feel premium?** **Yes** — calm, branded, no tutorial wall, smart defaults, and it *does work for them* rather than handing them a form.
- **Does the automation feel helpful, not intrusive?** **Yes** — it drafts, it never publishes; the member reviews and decides; the fact-guard means it won't invent claims.
- **Would this convince someone they bought a premium platform?** **Yes**, provided two things are true at launch: **`ANTHROPIC_KEY` is activated** (else it gracefully falls back to manual — still fine, but the "wow" needs AI on), and the **browser QA pass** confirms the wizard renders well on device. Both are tracked (Phase J activation, Phase K QA).
- **Anything still in V1 before launch?** The two dependencies above (AI activation + browser QA), and — honestly — the intake could be made even lower-effort by **auto-detecting business facts from the email domain / Google listing** (FD, V1.1) so the member confirms rather than types. Not a blocker; the current two-question intake is already a premium first-run.

---

**Phase I — Guided Onboarding & First-Run Experience complete.**
