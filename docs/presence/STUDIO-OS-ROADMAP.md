# Studio OS — Master Roadmap (Consolidated Source of Truth)

**One authoritative roadmap** combining engineering, product, and launch work in realistic sequence. Detailed phase history lives in `ROADMAP-MASTER.md`; this is the forward plan.
**Updated:** 2026-07-09. Items tagged **⟐** were folded in from the Jul 9 roadmap-review refinements.

**Current active milestone:** **Phase 2 · P2-B — App Shells, Navigation & Shared Foundations** (P2-A ✅ done Jul 9 — the frozen capability classification + rebuild list; see `PHASE-2-EXECUTION-PLAN.md`). Phase 1 ✅ COMPLETE ([PHASE-1-COMPLETION-REPORT.md]); its remaining items are owner activation only. Phase 2 = rebuild worthy capabilities multi-tenant + optimize (DoD) + retire `clever-api` after verified parity (data is disposable). Do not begin P2-B implementation without explicit approval.

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
- ⏳ **P2-B — App Shells, Navigation & Shared Foundations** *(next active · safest first code)* — Studio + Client shells on one realm (`shell.js`), server `buildNav`, design-system adoption, retire duplicate shells (`portal.html`/`portal-workspace.html`).
- ⏳ **P2-C — Sales & Customer Lifecycle** — leads · CRM · pipeline · proposals/quotes · contracts · convert→provisioned Client App · onboarding (multi-tenant, end-to-end).
- ⏳ **P2-D — Projects, Communication & Service Delivery** — projects · tasks · milestones · files · messaging · notifications · surveys · approvals · support · reporting.
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
