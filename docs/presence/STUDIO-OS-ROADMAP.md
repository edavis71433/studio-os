# Studio OS — Master Roadmap (Consolidated Source of Truth)

**One authoritative roadmap** combining engineering, product, and launch work in realistic sequence. Detailed phase history lives in `ROADMAP-MASTER.md`; this is the forward plan.
**Updated:** 2026-07-09. Items tagged **⟐** were folded in from the Jul 9 roadmap-review refinements.

**Current active milestone:** **Phase 2 · P2-E — Billing, Entitlements & Account Lifecycle — ACTIVE (started Jul 10)** (P2-A ✅ · P2-B ✅ · P2-C ✅ · **P2-D ✅ + Final Hardening ✅ COMPLETE Jul 10**). **🔒 ARCHITECTURE FROZEN (Jul 10, `ARCHITECTURE-FROZEN.md`):** Agency–Client Bridge is authoritative — agency workspace owns internal ops, customer owns their own workspace, connected via `presence_service_links` + `presence_customer_agency`; one authoritative delivery model, scoped Studio/Client views, no duplication, clients never members of the agency workspace. **Launch constraint frozen + enforced:** ONE primary agency per customer (`presence_customer_agency` PK, mig `0080`; `ensureBridge` refuses a customer owned by another agency); multi-agency deferred (relax by dropping the PK). **Billing boundary frozen:** the customer workspace owns its SaaS subscription/plan/entitlements/AI-usage/account-lifecycle; the agency may be seller for project work; SaaS vs service billing stay distinguishable (one Stripe, one webhook authority, purpose metadata); no duplicate Stripe/entitlement/invoice/usage systems. **P2-E = validate/harden/integrate/complete the EXISTING Stripe/subscription/entitlement/usage/webhook stack** (reuse-first, no second billing system); mandatory first step = capability & ownership map before code. **P2-D — Projects, Communication & Service Delivery** built the whole post-sale workflow multi-tenant on `presence` (net-new; it existed only in disposable clever-api) across 6 validated increments: projects/milestones/tasks/events (0075) · deliverables(overlay on presence_media)+approvals(content_hash version-integrity) (0076) · messages+derived-notifications (0077) · surveys+support (0078) · client reporting + `projects.html` on the shared shell (Projects nav). **The FULL 16-step service lifecycle passes live on staging (two tenants).** Gates: 75 pure + 116 structural + 103 live e2e (incl. 16/16 lifecycle) · full sweep 118/0/4 · typecheck clean. Deployed staging+prod. **3 genuine defects fixed** (bucket rejected PDFs → 0065 docs+deliverables were broken; Business-OS file-sharing gate; media delete-protection). Reuse-first, no parallel systems. Evidence: `P2D-COMPLETION-REPORT.md` + `P2D-CAPABILITY-MATRIX.md`; gate `scripts/validate-p2d.mjs`. **Prod migrations `0075`–`0078` owner-apply pending** (routes dormant on prod until then). **Human browser/mobile/keyboard/screen-reader QA of the surfaces → Phase 6 Gold Master** (add service-delivery surfaces to `P2C1-HUMAN-QA-PACKAGE.md`). Legacy retirement (portal.html service sections, clever-api service tables) deferred to P2-G after proven parity. **Do not begin P2-E.**
<br>**P2-C2** validated the closing workflow live on staging: closing e2e 21/21 · closing tenant isolation 9/9 · P2-C1 regression 16/16+8/8 · pure/structural 33/33+45/45 · full sweep 102/0/4 · typecheck clean. **Frozen model held** under the full close (proposal-accept + contract-sign mutate the same `presence_deals` row; convert stamps it). One genuine defect fixed (convert rollback now tracks every client it creates → no orphan on provision failure); deployed staging+prod. Evidence: `P2C2-VALIDATION-RESULTS.md`. **Human browser/mobile/keyboard/screen-reader QA remains relocated to Phase 6 Gold Master** (add the proposal/contract/convert screens there; carried via `P2C1-HUMAN-QA-PACKAGE.md`, not waived). **Prod `0074` still owner-apply at launch** (prod `/sales/*` dormant until then). **Do not begin P2-D implementation without explicit approval.** Deferred by evidence-first discipline: convert billing → P2-E; signing `ip_hash` + paired stage-change events + lead-dedup/CRM↔Pipeline link → only when evidence justifies. (P2-A ✅ · P2-B ✅ engineering done Jul 9 — shell adoption + capability-preservation matrix + duplicate-portal retirement; live browser/mobile/AT QA of the presence.html shell layout deferred to the live pass. See `PHASE-2-EXECUTION-PLAN.md` + `P2B-CAPABILITY-PRESERVATION-MATRIX.md`). Phase 1 ✅ COMPLETE. Phase 2 = rebuild worthy capabilities multi-tenant + optimize (DoD) + retire `clever-api` after verified parity (data is disposable). Do not begin P2-C implementation without explicit approval.

---

## ⚡ Do Now / Standing (⟐ pulled forward — don't wait for a launch phase)
These de-risk everything below them and are near-immediate (owner actions / one decision), not big builds.
- **⟐ Activate CI as a required gate** — M1 built the runner; it's *dormant* until pushed + branch-protected. It gates all of M3–M10. (Owner)
- **⟐ Resolve the GitHub ↔ Production divergence** — ~170 local commits are ahead of GitHub while prod runs the local code; a manual GitHub deploy would **regress prod**. Push once at fence-lift to sync. *Standing risk until done.* (Owner)
- **⟐ Decide the name/positioning** — Studio OS = platform · Presence = the website product · Davis Digital Studio = the studio. A 5-minute decision that unblocks all Phase 3 copy + screenshots. (Owner decision)

---

## ✅ Phase 0 — Foundation (Complete)
Core platform (auth, multi-tenancy, RBAC, RLS, Admin + Client portals, CRM, pipeline, messaging, dashboard, forms, contracts, invoices, Stripe, Resend, AI agents, audit engine, lead intelligence, drafting, reporting, session revocation, rate limiting, security hardening, production backend). Engineering hygiene (0 TS errors, regression suite, operator auth, audit-checkout fulfillment + **live Stripe verified**, JSON-LD reconciliation, payment-success routing, observation-engine cleanup, console cleanup). Product artifacts (design system, Presence CMS architecture + execution plan, product gap analysis, functional-cohesion + two-app strategy, CMS-UX-1/2 specs).

---

## ✅ Phase 1 — Presence CMS Hardening (COMPLETE · 10 of 10 · 100%)
Scale-safety on the existing deterministic engine. See `PRESENCE-CMS-PHASE-1-EXECUTION-PLAN.md` + `PHASE-1-COMPLETION-REPORT.md`.
- ✅ **M1** — CI & golden safety net
- ✅ **M2** — Security hardening (tenant isolation)
- ✅ **M3** — Draft-version hash
- ✅ **M4** — Publish reliability (idempotency + cooldown) — *FULLY LIVE; migration 0073 applied to both envs Jul 9*
- ✅ **M5** — Deploy robustness (timeout · reconcile cron · ceiling · telemetry) *(fully live)*
- ✅ **M6** — Media hardening (magic-byte · EXIF · quota · GC) *(fully live, no migration)*
- ✅ **M7** — Snapshot management (retention · GC) *(fully live, no migration)*
- ✅ **M8** — Preview hardening (render cache · signed links · watermark) *(fully live, no migration)*
- ✅ **M9** — Client safety (optimistic lock via M3 hash · shared api() helper · reused diff summary) *(fully live, no migration)*
- ✅ **M10** — Operational validation (validation runner · load-test framework · DR runbook+tooling · readiness + completion reports) *(engineering complete; owner activation documented)*

---

## 🚧 Phase 2 — Capability Rebuild, Optimization & Legacy Retirement (ACTIVE)
**Approved direction (Jul 9 2026):** rebuild the capabilities worth keeping using the correct **multi-tenant** architecture, **optimize as part of Definition of Done**, verify parity, then retire `clever-api` + its **disposable** fake data. **Not a data migration, not a code transplant** — legacy is a functional reference. Full plan + the frozen A/B/C/D/E capability classification: `PHASE-2-EXECUTION-PLAN.md`. QA + optimization are per-milestone, never deferred.
Consolidated into the fewest end-to-end milestones (each delivers a complete workflow):
- ✅ **P2-A — Product Boundary & Legacy Freeze** — classification frozen (Keep/Rebuild/Internal/Remove/Future) + rebuild list + retirement toggles. *(done Jul 9)*
- ✅ **P2-B — App Shells, Navigation & Shared Foundations** *(engineering done Jul 9)* — `presence.html` adopts the ONE shared shell (`shell.js`/`shell.css` — top bar · ⌘K · notifications · account · sign-out) + shared `ddsToast` state (M3/M8/M9 editor JS untouched, guarded by optimistic_lock 30/30); `buildNav` verified as the ONE surface-separating nav (Client/Website/Account/Studio; internal DDS tools never in buildNav); duplicate `portal-workspace.html` retired via reversible redirect (zero inbound links). `portal.html` KEPT (sign-in entry + 7 capabilities deferred to P2-C/D/E/Phase-8). Matrix: `P2B-CAPABILITY-PRESERVATION-MATRIX.md`. p2b_shell 23/23; sweep 95/0. Remaining = live browser/mobile/AT QA (deferred to the live pass).
- **P2-C — Sales & Customer Lifecycle → RE-FRAMED into P2-C1 + P2-C2** *(foundation-first split, Jul 9 2026; see `P2C-FOUNDATION-FIRST-SPLIT.md`)*. The whole chain is BUILT + deployed; the split is about review/hardening boundaries, nothing rebuilt.
  - ✅ **P2-C1 — Lead Management & CRM Foundation — COMPLETE (Jul 9 2026)** — lead→CRM→opportunity→pipeline. `presence_contacts` + `presence_deals` (**lead+opportunity unified by stage — FROZEN model, held under real use**) + `presence_deal_events` + `/sales/*` + `pipeline.html` + `leads.html` "→ Deal" bridge; reuses `crm.html`. **Completion criteria (all met, staging Jul 9):** runtime validation **16/16** · live tenant isolation **8/8** (two workspaces) · automated regression 33/33 + 44/44 · **architecture confirmed stable** (no schema/route/index change needed after live testing). Evidence: `P2C1-VALIDATION-RESULTS.md`. Finding along the way: `0074` wasn't actually applied to staging (validation caught it) → applied to staging via Management API; **prod `0074` remains owner-apply at launch.** **Human product-experience QA (browser/mobile/keyboard/screen-reader) RELOCATED to Phase 6 Gold Master** (validates the finished product, not the CRM architecture; run once against the integrated app) — carried forward via `P2C1-HUMAN-QA-PACKAGE.md`, not waived.
  - ✅ **P2-C2 — Sales Closing Workflow — COMPLETE (Jul 9 2026).** Validated (not rebuilt): proposals (signed accept) · contracts (version-integrity signing) · idempotent convert→`provisionForSignup`→guided onboarding (convert-time login invite, `?next=` landing, agency-portfolio link) · public-endpoint rate limits. **Live on staging:** closing e2e **21/21** (proposal→send→accept→contract→sign→convert→onboard, all idempotent, version-integrity enforced) · closing tenant isolation **9/9** (B can't attach/send/convert A's records; signed links bound to one id) · P2-C1 regression **16/16 + 8/8** · pure **33/33** · structural **45/45** · full sweep **102/0/4** · typecheck clean. **Frozen model held** under the full close. **Genuine defect fixed:** convert rollback now tracks *every* client-insert path (`createdClient`), so a provision failure can't orphan a `clients` row — never deletes a reused customer. Deployed staging+prod. Gate: `scripts/validate-p2c2.mjs`; evidence: `P2C2-VALIDATION-RESULTS.md`. **⚠️ Migration `0074` still owner-apply to PROD** (prod `/sales/*` dormant until then). Billing deferred to P2-E (convert grants active, unbilled access — deliberate). Human product-experience QA → Phase 6.
- ✅ **P2-D — Projects, Communication & Service Delivery — COMPLETE (Jul 10 2026).** The whole post-sale workflow, net-new multi-tenant on `presence` (existed only in disposable clever-api), reusing every supporting primitive (media store · relationship-notes · portal-feed · forms · Approved-Plan spine + contract content_hash · shared shell/roles/shares — no parallel systems). Matrix `P2D-CAPABILITY-MATRIX.md`; report `P2D-COMPLETION-REPORT.md`.
  - **P2-D-1** projects/milestones/tasks/events (`0075`) + convert→project handoff. **P2-D-2** deliverables (overlay on presence_media, signed download, delete-protected) + generic approvals (content_hash version-integrity) (`0076`) + bucket PDF fix. **P2-D-3** project messages (audience internal/client) + notifications derived from the ONE activity log + read-state (`0077`). **P2-D-4** surveys (idempotent submission) + support (submit→triage→resolve→reopen) (`0078`). **P2-D-5** client reporting (composed, no store) + `projects.html` on the shared shell + Projects nav. **P2-D-6** full 16-step lifecycle gate + legacy parity map.
  - **Gates:** FULL 16-step service lifecycle **16/16** live (two tenants) · 75 pure + 116 structural + 103 live e2e · sweep 118/0/4 · typecheck clean. Deployed staging+prod. **Prod `0075`–`0078` owner-apply pending.** 3 genuine defects fixed. Human product-experience QA → Phase 6.
  - ✅ **P2-D Final Hardening (Jul 10)** — Agency–Client Bridge (`presence_service_links`, mig `0079`): convert auto-creates the project + bridge; the Client App (`client.html`) consumes `/client/*` (bridge-scoped); multi-client leak closed; audit fixes B1–B6 + D1–D3; notifications unified into Inbox/bell; billing hooks documented for P2-E. **Bridge two-customer isolation 13/13 live**; sweep 120/0/4; deployed staging+prod (prod `0075`–`0079` owner-apply pending). Report: `P2D-FINAL-HARDENING.md`.
- ⏳ **P2-E — Billing, Entitlements & Account Lifecycle** — invoices · payments · subscriptions · entitlements · **dunning · cancellation · refunds · account deletion · Terms** (reuse the ONE Stripe infra; absorbs the former Phase-4 billing-lifecycle items).
- ⏳ **P2-F — Website, CMS, Analytics & AI Integration** — integrate the Phase-1 CMS/analytics/audits/AI/connections into the two-app experience + cross-surface deep links. *(Do not rebuild Phase 1.)*
- ⏳ **P2-G — Legacy Retirement & Capability-Parity Verification** — verified parity → staged removal of disposable data, obsolete pages/routes/tables (dependency-checked), unused secrets/jobs; final retirement report.
- **Deferred to Future (Phase 8):** Growth Partnership (productized) · advanced signals/reasoning BI · cold-outreach prospecting · signals-driven opportunity automation. **Kept internal (isolated) meanwhile:** DDS admin-DB console · Calendly · revenue/practice BI.

---

## 🚧 Phase 3 — Public Product Experience
*(Fed by the name/positioning decision in "Do Now".)* Interactive product tour · demo environment · screenshots · Studio OS / Presence / Business-OS product pages · pricing improvements · comparison tables · ROI calculator · Trust Center · case studies · testimonials · public changelog.

---

## 🚧 Phase 4 — SaaS Packaging
Final pricing · founder pricing · support tiers · AI usage limits · upgrade paths.
- **⟐ Customer help center / KB** — "support tiers" needs a support *mechanism* (P10 from the gap analysis).
- **⟐ Confirm a hard per-tenant AI cost ceiling** before public self-serve (partly there via capacity enforcement) — one abusive account shouldn't run up the model bill.
- *(Moved to Phase 2 · P2-E: dunning/failed-payment recovery · self-serve cancellation + refund · self-serve account deletion + Terms — they belong in the end-to-end billing/account-lifecycle workflow rebuilt with the ONE Stripe infra.)*

---

## 🚧 Phase 5 — Launch Readiness
**Engineering:** GitHub↔prod sync · CI required gate · monitoring · status page · migration automation · backup verification · DR verification.
- **⟐ Ops alerting** — monitoring you have to go look at ≠ being told. Wire `OPS_ALERT_EMAIL` (already in the env inventory) to real failures: publish failed, webhook failed, function error.
- **⟐ Dependency notes:** PITR (owner) must precede the DR drill; the Stripe **webhook test-event** must pass before the test-subscription/test-invoice runs.

**Owner:** ~~apply migration `0073_publish_idempotency.sql`~~ ✅ **DONE (Jul 9 2026 — applied to both envs; M4 fully live)** · Stripe webhook test event · publish audit pages · test subscription signup · test invoice payment · PITR enablement · Cookie/DPA review · Google OAuth consent · push local commits after fence lift.

---

## 🚧 Phase 5.5 — Beta / Soft Launch  ⟐ (NEW — inserted before full public launch)
A controlled, limited-customer beta between Gold Master and full public launch. Real customers surface what QA structurally can't — real content, real payment edge cases, real support load. Gate: a small cohort runs clean before opening self-serve to the world.

---

## 🚧 Phase 6 — Gold Master QA
Desktop · mobile · cross-browser · WCAG 2.2 AA · performance · final regression · launch sign-off.
- **⟐ Consolidated human product-experience QA (relocated here Jul 9).** The browser/mobile/keyboard/screen-reader validation is run ONCE against the fully-integrated app here, not per-milestone. **Carried forward (not waived):** the P2-C1/P2-C2 sales surfaces — `pipeline.html`, `leads.html`, `crm.html` — using `docs/presence/P2C1-HUMAN-QA-PACKAGE.md` (checklist + staging-serve harness + test accounts). Any milestone that ships signed-in UI adds its surfaces to this one pass.

---

## 🚧 Phase 7 — Post-Launch Product Evolution
- **CMS-UX-1 — Client Content Tree** (dynamic page/section tree · status + health indicators · deep linking).
- **CMS-UX-2 — Website Navigator** (search · page health · SEO snapshot · activity history · quick actions · breadcrumbs · expand/collapse).
- **Enhancements:** per-model AI cost dashboard (TD-1 #3) · paid-audit notifications (AUD-1 optional) · weekly client digest · shareable preview links · named snapshots + version comparison · published-site uptime monitoring · public API · advanced per-page SEO.
- **⟐ Preview-link consolidation (from M9 Part-1 review).** Two public preview doors coexist by design: `/p/:token` (FD-T20 — persistent, revocable, optionally password-protected) and `/p/s/:token` (M8 — stateless, HMAC-signed, self-expiring). They share ONE render path and are intentionally different tools; **neither supersedes the other.** *Future* (not now): unify them behind a single "Share preview" surface that mints EITHER a persistent or an expiring link from one UI + one route family, so future developers maintain one sharing model. Purely a consolidation/DX item — no capability gap today. See the doc-comment in `routes/preview_env.ts`.

---

## 🚧 Phase 8 — Future Platform Expansion  ⟐ (demand-driven only)
Mobile apps (iOS · Android · push) · agency (white-label · multi-workspace · multi-brand · reseller) · advanced CMS (multiple templates · industry library · ecommerce · booking · memberships · courses) · AI expansion (marketing · SEO · coach · analytics · content planner).
**⟐ Bloat guard:** this phase is the feature-magnet. Build each item only when a paying customer needs it; keep AI **structured + grounded + approval-gated** (not chat-assistant sprawl). The absence of sprawl is part of the product.

---

## What each refinement did (Jul 9 review → this roadmap)
| # | Refinement | Where it landed |
|---|---|---|
| 1 | CI activation + GitHub↔prod sync are urgent, not Phase 5 | ⚡ Do Now / Standing |
| 2 | Name/positioning is a decide-now item | ⚡ Do Now / Standing |
| 3 | QA continuous, not only Phase 6 | Phase 2 note |
| 4 | `clever-api` sunset is the hidden giant in WS1 | Phase 2 · WS1 sub-workstream + risk |
| 5 | Beta / soft-launch gate | **new Phase 5.5** |
| 6 | Account deletion + Terms | Phase 4 |
| 7 | Dunning + cancellation/refund | Phase 4 |
| 8 | Ops alerting | Phase 5 |
| 9 | Customer help/KB | Phase 4 |
| 10 | PITR before DR drill | Phase 1 M10 + Phase 5 notes |
| 11 | Webhook verify gates test-sub/invoice | Phase 5 note |
| 12 | Per-tenant AI cost ceiling | Phase 4 |
| — | Phase 8 bloat guard | Phase 8 note |

*Nothing was silently dropped: every refinement is either applied here or placed in its correct phase. None required code — they are sequencing, risk, and scope decisions.*
