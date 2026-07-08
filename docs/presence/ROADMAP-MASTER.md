# Studio OS — Master Roadmap (Reconciled)

*Reconciles the attached **Studio OS Master Roadmap (Current)** with the actual completion state and the suggestions from the operational review. Additions are marked **➕ ADDED**, overlaps with already-completed work **⚠️ REDUNDANT**, and items needing scoping **🔍 EXPAND**. The intent is one honest source that doesn't imply re-doing finished work.*

> **Reality check up front:** engineering is effectively complete and green, but **nothing is live to a customer yet** — the edge function is deployed to staging + prod, but every frontend page is **committed-not-pushed** behind the go-live gate, and owner activation (keys/cron) isn't done. So "98% of the V1 roadmap" is true for *engineering*; the remaining ~2% (activation, human QA, front door, the push itself) is what stands between "built" and "a customer can pay for and use it." Treat that last mile as the real work, not a rounding error.

---

## Completed (verified, committed — NOT yet pushed)

Foundation & Core Architecture · Security, Multi-tenancy & Permissions · CMS · Business OS · AI Platform · Connected Platform · Commerce & Billing Foundation · CRM / Relationship Center · Developer Mode (+ render integration) · Unified Workspace Shell · Client Portal · Agency & Enterprise Foundations · Packaging & Editions · Commercial Activation · Product Integrity Verification · Commercial Readiness · Site Operations & Feature Optimization · Market Validation & Operational Excellence.

*Every item above is implemented, tested (14 invariants + suites green), and deployed to staging + prod for the function — but the static frontend is behind the go-live gate (unpushed).*

---

## Remaining Roadmap (reconciled)

### Phase J — Owner Activation  ·  *do this first; it's a real gate*
Stripe production · OAuth providers · **Resend (email)** · **Cron on `/system/run`** · Secrets (**`APPROVAL_SECRET`**) · Monitoring + alerting · **PITR backups + a real restore drill** · Production activation.
- ➕ **These are load-bearing, not config trivia:** without Resend the lead + one-tap-approval emails silently no-op; without cron, scheduled publishes never fire; without `APPROVAL_SECRET` one-tap returns 503. Each feature degrades gracefully, so this won't crash — it will just quietly not work. Put an owner name next to each.
- ➕ **Secret rotation** (Netlify token, any secret shown in chat) before real tenants.
- 🔍 **EXPAND:** define the restore drill concretely (clone from PITR → run suites → confirm `presence_*` rows intact → record the date).

### Phase K — Gold Master QA  ·  *the biggest quality unknown right now*
Human browser testing · Cross-browser · Mobile · Accessibility · Regression · Performance · Production readiness sign-off.
- ➕ **Scope it explicitly to the pages built without a browser this session:** shell, `today`, `presence`, `crm`, `leads`, `schedule`, `developer`, `approve`, `help`, `client`, `agency`, `sharing`. All are parse-checked and their pure logic is tested, but none has been *seen rendering*, on mobile, or with a screen reader. This is where visual/interaction bugs hide.
- ➕ **Include the two new commercial screens end-to-end** (`schedule.html`, `leads.html`) — the FD-F1 backends are tested, the screens are not browser-verified.

### Phase H — Website & Public Experience (the "front door")  ·  *#1 commercial risk (A9 C-1)*
Website audit + messaging refresh · Interactive product tour · "Why Studio OS" workflow comparisons · ROI calculator · Trust Center · Edition comparison matrix · Real workflow library · Developer landing page · Accessibility Center · SEO/a11y/conversion · Public changelog (V1.1) · Public roadmap (V1.1).
- ➕ **Add the pricing-page work for the two new editions** — CMS-Only and Business-OS-Only are sellable in the API/catalog but the public pricing page hasn't been laid out for 7 rungs. Copy/design, not engineering.
- ➕ **Resolve the naming/positioning** (Studio OS vs Presence vs Davis Digital Studio) here — the A9 board called this the #1 commercial risk; the edition-comparison matrix already exists as data (`commerce/editions.ts`) and can drive the public matrix.
- 🔍 **EXPAND / commercial:** pressure-test the $24–$49 founder prices against value before the founder cohort locks rates.

### Phase I — Guided Onboarding  ·  *A9 C-2*
First-run experience · Guided setup · Product education · Customer activation journey.
- Note: a first-run checklist backend already exists (`/commerce/first-run`); this phase is the *guided* layer over it.

### Phase G — Native Apps  ·  *sequence AFTER launch, not before*
macOS · Windows · iPhone · Android · feature parity · one-codebase-where-practical.
- 🔍 **EXPAND / sequencing:** launch the web product first, learn from real usage, *then* wrap native. The unified shell already consumes `/portal/context.nav` as data, so native surfaces inherit the IA without re-authoring — but building four apps before a single paying customer is premature. Recommend moving G to *after* N (launch).

### Phase N — Product Completeness & Launch Readiness
Validate every customer journey · Pricing flows · **Demo flows** · **Booking flows** · Forms · Emails · Preview · Launch checklist.
- ➕ **Genuinely new here:** *demo flows* (a way to try without buying) and *booking flows* (FD-F3 — the `booking` form kind exists as capture; real calendar availability is unbuilt). Forms/preview/emails are ✅ done (Phase F) — validate, don't rebuild.
- ➕ **The launch checklist should include "cross the go-live gate (push)"** as an explicit, owner-owned step.

### Phase S — Security & Engineering Hardening  ·  ➕ ADDED (missing from the roadmap)
*The roadmap has no backend-quality/security-hardening phase. These are real pre-scale items, not features.*
- **`svc()` id-scope audit** — confirm every service-role query taking a request-supplied id filters by tenant/site/org. Service role bypasses RLS; one missing filter is a cross-tenant leak. Do this once, deliberately, before real tenants. (Was B6 on the Launch Board.)
- **Hardened HTML sanitizer for Developer Mode (FD-B2)** — the current denylist regex is fine for trusted developers; replace with an allow-list parser + a published-site CSP *before* custom-HTML authoring broadens.
- **Serialized/ephemeral integration test harness (FD-E1)** — integration suites flake under concurrent staging state (pass in isolation). Fix before relying on the suite as a CI merge gate — false green is a trust risk.
- 🔍 **EXPAND:** a lightweight dependency/secret-exposure review + confirm the `RESEND`/`STRIPE`/`NETLIFY` tokens are least-privilege.

### Phase O — Zero-Gap Certification  ·  ⚠️ REDUNDANT (mostly done in Phase E)
Whole-platform certification · Zero-Surprise Certification · every action has a clear outcome · unified experience review.
- ⚠️ **Phase E (Product Integrity Verification) already produced an Integrity Certification** across editions/roles/workflows/integrations, with a Risk Register. **Trim O to its one genuinely-new delta:** a *"every action has a clear, understandable outcome"* pass — i.e., an empty-state + confirmation-copy + error-message review across the surfaces (a UX-writing audit), not a re-certification. Otherwise it re-does E.

### Phase P — Platform Optimization  ·  ⚠️ LARGELY REDUNDANT (Phases L + M)
Click reduction · Navigation optimization · Workflow optimization · Search quality · Keyboard shortcuts · Operator/customer efficiency.
- ⚠️ Click/nav/workflow/operator/customer optimization was the substance of **Phase M (Site Operations)** and **Phase L (Operational Excellence)** — done. **Trim P to the two genuinely-new items:** **content search across items** (V1.1 — today's palette searches nav only) and **keyboard shortcuts** (V1.1 — beyond ⌘K). Don't re-run the optimization pass.

### Phase Q — Client Portal Optimization  ·  ⚠️ PARTIALLY REDUNDANT (CRM + Phase F/M)
Client understanding · Approvals · Notifications · Comments · History · Leads · Reports · Sharing · Trust.
- ⚠️ Approvals (one-tap), Leads (inbox), History (timeline), Sharing (A7.2), Trust (ownership/approval-first) are ✅ done. **Trim Q to its real deltas:** **per-item shared comments (FD-19)**, **persisted read/unread notifications (FD-C1-shell)**, and **client-facing reports** (a calm read, *not* dashboards — Law 13).

### Phase R — Cross-Workspace Validation  ·  ⚠️ REDUNDANT (Phase C1 + E)
One navigation · one design language · one design system · one product identity.
- ⚠️ **Phase C1 (Unified Workspace Shell)** already delivered one nav + one shell + one identity, and Phase E verified cohesion. **Trim R to the physical consolidation that's genuinely outstanding:** **design-token de-duplication (FD-15)** (pages still inline matching tokens), **typeface unification (FD-16)**, and **wordmark cleanup (FD-17)**. That's real maintainability work; the *validation* is done.

---

## ➕ V1.1 Feature Backlog (from the review — cheap, high-leverage, not blockers)

Ordered by value-per-effort:
1. **Weekly client digest (FD-5)** — reuses the Moments engine + email; highest retention-per-hour.
2. **Auto-notify on approval (FD-F2)** — send the one-tap email automatically when a plan is proposed (today it's operator-triggered). Tiny.
3. **Shareable preview link (FD-6)** — signed, no-login preview URL; closes the approval loop for clients who won't log in.
4. **Per-item shared comments (FD-19)** — the one collaboration gap a client would consciously notice vs Notion/HighLevel.
5. Named snapshots + version compare (FD-7/12) · published-site uptime watch (FD-10) · public third-party API · per-page meta override.

*(These are already in the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md); listed here so the roadmap and the queue agree.)*

---

## Redundancy Register (what to trim so the roadmap doesn't imply rework)

| Remaining phase | Overlaps completed | Keep only |
|---|---|---|
| O — Zero-Gap Certification | Phase E (Integrity + Certification) | the "clear-outcome / copy + empty-state" UX-writing pass |
| P — Platform Optimization | Phases L + M | content search + keyboard shortcuts |
| Q — Client Portal Optimization | CRM + Phase F/M | comments, persisted notifications, client reports |
| R — Cross-Workspace Validation | Phase C1 + E | token de-dup (FD-15), typeface (FD-16), wordmark (FD-17) |
| N (parts) | Phase F | demo + booking flows + launch checklist (forms/preview/emails done) |

---

## 🔍 Things to look into / expand

- **Sequencing:** J (activate) → K (QA) → H (front door) → I (onboarding) → N (launch checklist + push) → **then** G (native apps). Native before launch is premature.
- **The go-live push is a decision, not a phase** — surface it explicitly in N's launch checklist with an owner.
- **Progress framing:** engineering ≈ 100%; *shippable-to-a-paying-customer* is lower until J + K + H + the push land. Consider tracking two numbers so "98%" doesn't read as "2 weeks from revenue."
- **Booking availability (FD-F3)** and **demo flows** are the only genuinely-unbuilt customer-facing capabilities in N — scope them before committing dates.

---

## Standing Product Rules (unchanged — preserved)

- Every proposed feature goes through Discovery → Product Review → Customer Value Assessment → Roadmap Decision → Implementation (if approved).
- Do not add features simply because competitors have them.
- Preserve the Product Constitution and Product Laws.
- Maintain one platform, one codebase, one navigation system, one publishing pipeline.

---

## Current Progress (reconciled)

- **Engineering / platform implementation:** ~100% (tested, deployed to staging+prod).
- **Live to a customer:** ~0% (frontend unpushed; activation not done).
- **Overall V1 (including activation + QA + front door + onboarding + push):** the honest number is lower than 98% — call it "engine done, last mile remaining." The remaining phases are mostly non-engineering (activation, QA, website, onboarding) plus the trimmed deltas above and the new hardening phase (S).
