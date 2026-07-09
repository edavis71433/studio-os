# Studio OS — Product Polish & Cohesion Execution Roadmap

**Type:** Implementation roadmap (no code). Converts the approved [STUDIO-OS-PRODUCT-GAP-ANALYSIS.md] findings into executable workstreams.
**Date:** 2026-07-09.

## How this relates to the existing roadmap (read first)

There are now **two parallel tracks**. They do **not** renumber or disturb each other:

- **Track A — Presence CMS Phase 1 hardening (M1–M10).** Engine scale-safety (publish robustness, GC, security audits, CI). Approved and unchanged. Mostly **backend**.
- **Track B — Product Cohesion & Polish (WS1–WS7, this doc).** Turns a superb engine into a polished commercial product. Mostly **frontend / packaging / ops**.

The tracks touch mostly different surfaces, so they interleave with minimal collision. Where Track B *reuses* a Track A deliverable (e.g., the M3 draft-hash powers "unpublished changes"; the M9 diff powers "what's changing"), that is called out as a **dependency, not a duplication** — Track B is the UI/UX layer on top of Track A's plumbing.

**Fence reality:** WS1, WS3, WS4, WS5, WS7 touch public/portal pages → **built and committed locally, not published** until the owner lifts the go-live fence (which lines up with launch). So most of Track B is *build-now, ship-at-launch*. WS6 is ops (part owner, part engineering).

**Decision-filter tag** on each workstream shows which approved criteria it satisfies: `trust · cohesion · simplify · consistency · discoverability · onboarding · scale · reuse`.

---

## Owner steer (Jul 9 2026) — FUNCTIONAL seamlessness first; visual UX checked live

The priority is that **functionality works cleanly and seamlessly between the surfaces** — the data, state, actions, and handoffs must flow end to end. **Visual/UX polish is judged live**, so the *cosmetic* workstreams (WS2 design-system adoption, WS3 visual/branding consistency, WS7.2–7.4 marketing polish) are **deferred to live QA / post-launch** and must NOT gate functional work. What is elevated: WS1 (does the consolidation *preserve every capability and every link*), WS6 (does prod actually match GitHub, is it gated/observable), and the **functional halves** of WS4/WS5 (does publish actually deploy, does a nav node deep-link to the right editor, does validation actually fire).

### The cross-surface flows that must provably work (this is the real "cohesion")

The lifecycle is the test. Each arrow is a **functional handoff** that must be verified working end-to-end across the surfaces (building on the earlier INT-1 integration pass):

| Handoff | What must functionally work | Surfaces crossed |
|---|---|---|
| Visitor → **Lead** | public form/audit submit → `presence_form_submissions` / `audit_leads` → appears in Inbox + Customers | Public site → Studio App |
| Lead → **Proposal → Contract → Invoice** | pipeline advance writes state readable by the client; documents generate | Studio App (CRM) |
| Invoice → **Payment** | Stripe checkout → webhook flips invoice/order to paid → CRM + client see it | Studio App ↔ Stripe ↔ Client App |
| Payment → **Client Portal** | paid client is provisioned + can sign in to the Client App with the right modules | Studio App → Client App |
| Portal → **Website Build → CMS** | site exists; the client edits structured content that renders | Client App (Website) |
| CMS → **Publish → Live** | draft → snapshot → render → Netlify deploy → live URL, status reflected in UI | Client App → engine → Netlify |
| Edit → **Approval → Publish** | reviewer approves → repoint/publish → client sees "live"; feed clears | Client App ↔ Studio App |
| Connections → **Data → Analytics/Moments** | a connected provider's data flows into Analytics/Health/Moments the client sees | Client App modules |
| Files → **Website / Approvals** | media picked in the editor + "where used" deep-links; replace repoints on publish | Client App modules |
| Support → **Renewal → Expansion** | renewal window + expansion signals surface to operator (and optionally client) | Studio App |

**Deliverable of the functional track:** for each handoff — a verification (does it work today, end to end, across the real surfaces) + a fix for any break, reusing the existing engine. Much of this was proven in INT-1/EC-1; the **new risk is WS1**, because consolidating ~28 pages into two shells must not sever any of these arrows. So WS1 is re-scoped as *functional-preservation-first* (every capability + every cross-surface link keeps working), with visual consistency riding along but not gating.

---

## WS1 — Two-App Consolidation  ·  `simplify · cohesion · reuse`

**Objective.** Collapse the ~28 standalone signed-in pages into exactly **two app shells** — the **Studio App** (operator/agency) and the **Client App** (customer) — each hosting modules under the *existing* `shell.js`/`shell.css` frame. Preserve every capability; remove the seams and the duplicate/transitional pages.

**Page disposition (the concrete deliverable — review of every signed-in page):**

| Page | Disposition | Target |
|---|---|---|
| `today.html` | **Keep → module** | Client App · Home (Business Moments) |
| `presence.html` | **Keep → module** | Client App · Website (CMS editor) |
| `files.html` | **Keep → module** | Client App · Files |
| `analytics.html` | **Keep → module** | Client App · Analytics (client lens) |
| `connections.html` / `connections-callback.html` | **Keep** (callback = util) | Client App · Connections |
| `visual-studio.html` | **Keep → module** | Client App · Visual Studio |
| `inbox.html` / `leads.html` | **Merge** | Both apps · Messages (client + operator lenses) |
| `schedule.html` | **Keep → module** | Client App · Scheduling |
| `approve.html` / `sharing.html` | **Merge** | Client App · Approvals/Sharing (into the shell surfaces) |
| `get-started.html` | **Keep → first-run** | Client App · Onboarding |
| `portal.html` / `client.html` | **Retire → redirect** | Superseded by the Client App shell; 301 old URLs |
| `crm.html` | **Keep → module** | Studio App · Customers |
| `agency.html` | **Keep → module** | Studio App · Agency (agency edition) |
| `admin-growth.html` / `admin-health.html` | **Merge** | Studio App · Growth / Health Center |
| `dds-studio-manage-9k2p.html` | **Merge → core** | Studio App · operator console |
| `developer.html` | **Keep → module** | Studio App · Developer |
| `provision.html` / `client-archive-ui.html` | **Merge** | Studio App · site lifecycle |
| `help.html` | **Keep (shared)** | Both apps · Help |
| `signup` / `welcome` / `set-password` / `start` / `project-survey` | **Keep → funnel** | Pre-app auth/onboarding funnel (standardize chrome only) |
| `tests.html` | **Retire from prod surface** | Internal/dev only |

**Deliverables.** Two app shells (reusing the existing frame + nav) hosting the modules above; retirement + 301 redirects for `portal.html`/`client.html`/standalone admin pages; a single sign-in that routes to the correct app by role; the transitional `clever-api`-backed features migrated onto the presence-function modules they duplicate.

**Dependencies.** WS2 (design-system tokens/components — so the two shells are consistent); the existing `shell.js` unified frame + `buildNav`; role/principal resolution (already exists); Phase 1 **M1 CI** (so a consolidation this broad is regression-gated).

**Complexity: High.** The single biggest item — but mostly *route-under-one-shell + retire duplicates + redirect*, not a rewrite.

**Milestones.** WS1.1 Client App shell (route today/website/files/analytics/connections/visual/messages under one frame; retire `portal.html`/`client.html` → redirect). WS1.2 Studio App shell (crm/agency/admin-*/manage/developer/lifecycle under one frame). WS1.3 clever-api transitional feature migration + sunset plan. WS1.4 redirect + link audit (no dead ends).

**Recommended order (internal):** WS1.1 → WS1.2 → WS1.3 → WS1.4.

**Risks.** `clever-api` still serves live transitional pages — retiring them requires migrating their live features first (biggest risk in the whole plan; do it behind the fence, verify against staging). Broken deep-links during transition (mitigate with the redirect audit + M1 CI + the e2e workflow).

**Success criteria.** Exactly two signed-in shells; zero standalone transitional pages reachable; every prior capability present as a module; no dead links (nav-guard + e2e green); a customer never crosses a chrome boundary inside their app.

---

## WS2 — Design System Adoption  ·  `consistency · cohesion · reuse`

**Objective.** Finish adopting the *existing* design system (`DESIGN-SYSTEM.md`, `shell.css` tokens, `ddsEmpty/ddsError/ddsToast/.dds-skeleton`) on every screen. This is a **finish, not a build** — ~70% exists.

**Deliverables.** A per-screen adoption audit (which pages roll their own buttons/forms/cards/tables/empty-loading-error-success states/modals/headers/spacing); a living component reference page under `design/`; a lightweight check (grep/lint) that flags a new screen rolling its own instead of using the tokens/components.

**Dependencies.** The existing tokens + shared state components (built); pairs naturally with WS1 (the two shells adopt as they consolidate).

**Complexity: Medium.** High ROI because the components exist.

**Milestones.** WS2.1 audit + gap list per surface. WS2.2 adopt shared state components everywhere (empty/loading/error/success/toast). WS2.3 standardize buttons/forms/cards/tables/headers/modals against tokens. WS2.4 component reference page + adoption check.

**Recommended order (internal):** WS2.1 → WS2.2 (cheapest, highest polish) → WS2.3 → WS2.4.

**Risks.** Low — additive. The deliberate exceptions (the warm CMS editor, the public marketing palette) are *kept by decision*; document them so "consistency" doesn't over-flatten intentional character.

**Success criteria.** No screen defines its own empty/loading/error/success state; buttons/forms/cards/tables derive from tokens; the adoption check passes in CI.

---

## WS3 — Platform Cohesion  ·  `cohesion · consistency · trust`

**Objective.** Make Public Website + Studio App + Client App read as **one product family** — navigation, visual, language, branding, dashboard, and interaction patterns.

**Deliverables.** A cohesion checklist applied across all three surfaces: consistent nav/menus/breadcrumbs/search, unified notifications/page-titles/dashboard layout, one voice (calm, honest, jargon-free — already the copy standard), one brand vocabulary (see the name decision in WS7), and a deliberate, *designed* handoff from marketing → app (no visual cliff).

**Dependencies.** WS1 (two shells must exist first) + WS2 (shared components). This is the *integration* layer, so it comes **after** WS1/WS2 land.

**Complexity: Medium.**

**Milestones.** WS3.1 nav + breadcrumb + search consistency across both apps. WS3.2 shared dashboard/interaction patterns. WS3.3 marketing→app handoff (visual + auth continuity). WS3.4 language/brand consistency sweep.

**Recommended order (internal):** after WS1.1–WS1.2 and WS2.2–WS2.3.

**Risks.** Over-flattening intentional differences (marketing character, editor mode) — cohesion ≠ sameness. Keep the deliberate exceptions.

**Success criteria.** A customer instantly recognizes they're still in Studio OS on every screen; the marketing→signup→app path has no jarring seam; one nav grammar across both apps.

---

## WS4 — Trust Layer  ·  `trust · consistency`

**Objective.** Narrate at the moments that matter — publish, validate, "what changed," "you're live." The engine already does the right thing; make the UI *say* so.

**Deliverables.** Publish confirmation + "what's changing" summary (reuses **Phase 1 M9 diff**); a real "you're live" success moment (link + screenshot, from the Netlify deploy already produced); draft/published badges everywhere (reuses **M3 draft hash** + publish metadata); inline validation with plain-language fixes (reuses `validateSnapshot`); website health + content-completeness indicators (reuses the audit/validation); progress indicators on long actions; friendly, specific empty states (shared components from WS2).

**Dependencies.** Phase 1 **M3** (draft hash), **M8/M9** (diff, optimistic lock, shared-component adoption); WS2 (components). *This is the UI on top of Track A's plumbing — not new logic.*

**Complexity: Low–Medium.** Among the cheapest, highest perceived-quality gains available.

**Milestones.** WS4.1 the "you're live" + publish-confirm moments (Low, do first). WS4.2 draft/published badges + "what happens next" toasts. WS4.3 inline validation + fix-first one-liners. WS4.4 health/completeness indicators (feeds the Navigator).

**Recommended order (internal):** WS4.1 → WS4.2 → WS4.3 → WS4.4. Start WS4.1–4.2 immediately (near-zero risk, reuse-only).

**Risks.** Very low. Only risk is over-notifying — keep messages calm and singular.

**Success criteria.** Every state-changing action confirms what happened; the customer always knows draft vs. published and what's missing; "you're live" is a real moment.

---

## WS5 — Client Experience  ·  `onboarding · discoverability · simplify`

**Objective.** Make the first-time, non-technical journey obvious end to end: onboarding → navigate → edit → publish. Ensure the user always knows what to do, where they are, what changed, what's published, what's missing, what's next.

**Deliverables.** The **Website Navigator (minimal CMS-UX-1) as the Client App home** (orientation backbone — read-only projection, per its spec); a guided first-publish checklist (extends `get-started.html`); smart defaults so an empty section is never a dead end; simplification passes on the editing + publishing flows using WS4's trust surfaces.

**Dependencies.** WS1 (Client App shell) + **CMS-UX-1** (Content Tree — recommend pulling a minimal version forward) + WS4 (trust moments).

**Complexity: Medium.**

**Milestones.** WS5.1 minimal Content Tree as Client App home. WS5.2 guided first-publish checklist. WS5.3 empty-state defaults + editing-flow simplification. WS5.4 publishing-flow polish (with WS4 confirmations).

**Recommended order (internal):** after WS1.1 (Client App exists) + WS4.1–4.2.

**Risks.** Scope creep toward "builder" features — hold the read-only, guided line. CMS-UX-1 is future; only the *minimal* tree is pulled forward here.

**Success criteria.** A first-timer completes edit → preview → publish without help; always knows their location + status; no dead ends.

---

## WS6 — Operational Readiness  ·  `scale · trust`

**Objective.** Make the platform safe and observable at 100 → 10,000 customers. **Separated into owner vs. engineering.**

**Engineering deliverables.** Activate CI as a required gate (Phase 1 **M1** — push + branch protection); **GitHub↔Production synchronization** (resolve the 172-commit divergence at fence-lift; guard against a GitHub deploy regressing prod); migration-history reconcile + one-command apply; uptime monitor + a public **status page**; backup + DR validation drill (Phase 1 **M10**).

**Owner actions.** Roll the exposed Stripe key + delete the photo; enable **PITR**; register `STRIPE_WEBHOOK_SECRET` + (when wiring a programmatic operator caller) `OPERATOR_SECRET`; confirm CI platform/branch-protection.

**Dependencies.** M1 (CI), M10 (DR); the pre-launch parked list.

**Complexity: Medium.**

**Milestones.** WS6.1 CI activation + GitHub↔prod sync (**do now** — acute risk). WS6.2 monitoring + status page. WS6.3 migration automation. WS6.4 backup/DR validation (with M10).

**Recommended order (internal):** WS6.1 first (unblocks safe iteration for every other workstream), then 6.2–6.4.

**Risks.** The 172-commit divergence is a live footgun (a manual GitHub production deploy regresses prod) — resolve early.

**Success criteria.** Every push runs the gate; prod = GitHub = local; a monitored status page; a *drilled* restore; no manual migration ritual.

---

## WS7 — Public Product Experience  ·  `trust · discoverability · onboarding`

**Objective.** Present Studio OS as a product a stranger trusts in 60 seconds — without changing the underlying product. (Fenced: build-now, ship-at-launch.)

**Deliverables.** Resolve the **name/positioning** (decision: Studio OS = platform, Presence = the website product, Davis Digital Studio = the studio) and sweep the copy; a **product demo / interactive preview** (a sandbox site or live template gallery) so customers see the product pre-purchase; a product tour + real screenshots + plain feature explanations; **pricing clarity** (the audit-tier plain-language work is the model — extend to the platform plans); trust signals (ownership, privacy-by-design, "no consent banner because we don't track you", real export).

**Dependencies.** The name decision (owner); WS2/WS3 (so screenshots show the polished product); **fence** (public pages — commit local, publish at launch).

**Complexity: Medium.**

**Milestones.** WS7.1 name/positioning decision + copy sweep (decision = Now; sweep behind fence). WS7.2 demo/preview experience. WS7.3 product tour + screenshots + feature pages. WS7.4 pricing clarity + trust signals.

**Recommended order (internal):** WS7.1 (decision) now; WS7.2–7.4 pre-launch, ship at launch.

**Risks.** Fence — nothing public ships until the owner declares go. Name change touches many pages (do it as one coordinated sweep).

**Success criteria.** A visitor understands what Studio OS is + sees/tries it before buying; consistent name; pricing is legible; trust signals are explicit.

---

## Roadmap integration — where each workstream fits

| Workstream | Placement vs. Phase 1 & launch | Rationale |
|---|---|---|
| **WS6.1** CI activation + GitHub↔prod sync | **Before Phase 1 completes** (do now) | Gates everything safely; resolves the acute divergence risk |
| **WS4.1–4.2** trust moments + badges | **During Phase 1** (parallel; reuse-only) | Cheapest high-impact; reuse existing components + M3 hash |
| **WS2** design-system adoption | **During → immediately after Phase 1** | Finish-what's-built; prerequisite for WS1/WS3 |
| **WS7.1** name/positioning decision | **Now** (decision only) | Unblocks copy sweeps + screenshots; near-zero effort |
| **WS1** Two-App consolidation | **Immediately after Phase 1** (gated by M1 CI) | The big structural item; needs the regression gate first |
| **WS5** client experience + minimal Content Tree | **After WS1.1** (Client App exists) | Lands on the consolidated Client App shell |
| **WS3** platform cohesion | **After WS1/WS2** | Integration layer; needs two shells + components |
| **WS4.3–4.4** validation + health indicators | **After Phase 1 M8/M9** | Depends on the diff + hash plumbing |
| **WS7.2–7.4** demo/tour/pricing | **Before launch** (fenced; ship at launch) | Public surface; conversion levers |
| **WS6.2–6.4** monitoring/status/DR | **Before launch** | Launch-readiness ops |
| **CMS-UX-1/2** full Navigator | **After launch** | Enhancement on the shipped Client App |

---

## The master sequence — the one-question answer

**"If we stopped inventing features today, what sequence would most efficiently make Studio OS a polished, cohesive, launch-ready commercial SaaS?"**

*(Re-ordered per the owner steer: **functional seamlessness first; visual/UX polish deferred to the live pass.**)*

1. **Now, in parallel with Phase 1 M1:** WS6.1 (activate CI + sync GitHub↔prod — kills the divergence footgun and gates everything) + the **functional end-to-end handoff verification** (walk the lifecycle table; confirm every arrow works today across the real surfaces; fix any break reusing the engine) + WS7.1 (name decision — functional clarity, not visuals).
2. **During Phase 1 (M2–M10):** the **functional halves of WS4/WS5** as their M3/M8/M9 plumbing lands — publish actually deploys and the UI reflects real deploy state; validation actually fires; nav nodes deep-link to the correct editor. (These are *behavioral*, not cosmetic.)
3. **Immediately after Phase 1 (gated by CI):** **WS1 Two-App Consolidation — functional-preservation-first.** The highest-leverage structural work; the bar is *every capability and every cross-surface handoff keeps working* after ~28 pages become two shells. Visual consistency rides along but does not gate. Delivers the functional core of **WS5** (Client App works end to end).
4. **Before launch:** re-run the **handoff verification on the consolidated two apps** (nothing severed); WS6.2–6.4 monitoring/status/DR validation. *(Visual cohesion WS3 and marketing polish WS7.2–7.4 are staged but NOT gating — they're judged live.)*
5. **At launch:** lift the fence → push once (GitHub = prod = local) → flip CI to a required gate → go live.
6. **After launch — the live UX pass (your call, seeing it real):** WS2 design-system adoption, WS3 visual/branding cohesion, WS7.2–7.4 marketing polish, and the full CMS-UX-1/2 Navigator. This is exactly the cosmetic/experience layer you said you'd check when it's live — now you can.

**Why this order wins (functional-first):** it proves the *plumbing between surfaces actually works* end-to-end before spending effort on how it looks, sequences the one expensive structural item (consolidation) behind the CI safety net with a *capability-preservation* bar, keeps every public/portal change behind the fence until one coordinated launch push, and parks all visual/UX judgment for the live pass where you can actually see it. Nothing here invents a feature; every step *verifies, connects, or narrates* a system that already exists.
