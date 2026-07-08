# Phase CP — Unified Portal Experience: the Strongest-V1 Recommendations Report

*Audit-only; NOTHING implemented — awaiting owner approval per the milestone. This is the full re-triage of every known improvement under the new Excellence Directive ("strongest V1, not earliest launch; effort alone never defers"). Every item is evidence-based from this session's verified audits (cited); competitor judgments are workflow-level vs AEM, HubSpot, HighLevel, Wix Studio, Duda, Basecamp/Teamwork/Monday/ClickUp. Consolidates the Unified-Portal / Workflow / Browser-first / AI-Opportunity / Customer / Admin / Client / Competitor audits.*

## The unified-journey verdict (Steps 1–6, compressed)

Walking the OS end-to-end (discover → buy → onboard → build → publish → operate → get paid → renew/leave) after this session's 20+ phases: **the spine is genuinely excellent** — one shell, one nav, approval-first everywhere, calm honest comms, self-running operations. The remaining weaknesses cluster in four places: **(1) repetition at agency scale** (every new client = re-typed setup — the one workflow where Duda/HighLevel clearly beat us), **(2) the shape tier** (sections/type still dev-gated where colors no longer are), **(3) automation tails** (lifecycle wind-down, owner digest, drift-watching — rails built, last mile manual), **(4) small trust caps** (self-serve deletion, magic-link invites, redirects for migrating businesses). None violate laws to fix; all fit the architecture. In-app messaging (Basecamp/HighLevel-style) is the one *deliberate rejection*: email + one-tap approvals + CRM notes already close the loop, and a second inbox is complexity-for-its-own-sake at V1 scale.

## THE RECOMMENDATIONS (each: evidence · competitor · benefit · effort S/M/L · fit/risk)

### 🔴 Tier 1 — REQUIRED BEFORE LAUNCH (strongest-V1: material, no valid defer reason)

| # | Recommendation | Evidence & competitor | Benefit | Effort | Fit / risk |
|---|---|---|---|---|---|
| **CP-1** | **Agency & freelancer reuse** — "duplicate site as starter" + saved setup kits (brand/SEO/config/content skeleton) (FD-18/FD-B5) | Named the #1 multiplier by T2, T4 AND UX; verified zero machinery. Duda/HighLevel win this workflow outright | Agency scalability, freelancer productivity — the 5th site becomes minutes | **L** | Snapshot/provision machinery exists; risk = tenant-isolation care (site-scoped copies only) |
| **CP-2** | **Section visibility & order** as structured data (FD-T12) | Every no-code audit; items have it, sections don't; all 10 builders have it | CX/shape control without a page builder | **M** | `category_order` pattern proven; deterministic; low risk |
| **CP-3** | **Design Studio completion** — curated type presets (system-font pairings, zero assets) + type scale + density (FD-T6-full) | Palettes shipped (COMP) and prove the pattern; type remains the visible dev-only styling | CX + competitiveness; 2 templates × palettes × type ≈ a real gallery | **M** | Token machinery proven; template var adoption + golden regen; low risk |
| **CP-4** | **Lifecycle automation tails** — day-45 export reminder, day-60 auto-park, reactivation welcome-back, one win-back (FD-RL1/2) | RL built rails + policy; the promise is manual at the tail | Trust + automation; the written policy self-executes | **S–M** | Sweep extension; low risk |
| **CP-5** | **Owner weekly digest email** — subs, failed payments, unanswered leads, health, drift (FD-BZ4/FD-5) | BZ verdict: "will Eric know" = a manual Monday routine | Admin automation; the routine becomes an email | **S–M** | Queries exist; rides the cron; low risk |
| **CP-6** | **Redirects manager UI + per-page SEO overrides** (FD-N7/N8) | N/Z audits; API + snapshot support exist; migrating businesses NEED redirects day-one | Trust (no lost Google juice on migration), pro-SEO parity with Yoast conveniences | **S+S** | Pure UI over existing data; trivial risk |
| **CP-7** | **NAP drift-watch** — site facts vs connected Google listing → calm Moment (FD-Z2) | Z audit; GBP read EXISTS; local-SEO's #1 silent killer | Automation + trust; nobody else does this calmly | **S** | One evidence rule; trivial risk |
| **CP-8** | **Domain expiry watch** — RDAP check → Moment before a customer domain lapses (FD-INF3) | U audit; a lapsed domain = dead site + support fire | Trust/automation | **S** | One scheduled check; trivial risk |
| **CP-9** | **Magic-link member activation** (+ "set up my password" on portal login) (FD-M7) | M audit verified the OTP-vs-autofill fight — the most error-prone moment for invited staff/clients | Client confidence + fewer support emails | **M** | Supabase magic links exist; low risk |
| **CP-10** | **Self-serve account deletion** (FD-M4) | Data-governance R1, still open; privacy page promises deletion on request | Trust/legal completeness (GDPR erasure) | **M** | Wind-down machinery exists; needs careful cascade; medium care, low architectural risk |
| **CP-11** | **AI alt-text suggestions + Coach surfaced on Today** (FD-M9/M10) | M audit; both proposal-only already | CX + AI-assist where hands are | **S+S** | Existing writer + existing coach output; trivial |
| **CP-12** | **Template-switch staged preview** + industry-suggested template (FD-T8) | T/UX audits; engine already renders any snapshot with any compatible template | CX; makes the 2-template × looks story tangible | **S–M** | Preview param + chooser; low risk |
| **CP-13** | **Focal-point control on images** (FD-T11-lite) | O/COMP audits; variants auto-crop blind today | CX (faces/subjects framed right) | **S–M** | One field + `object-position`; full crop stays deferred (real image-pipeline reason) |
| **CP-14** | **CI gate** — one command, all suites, required green (FD-S5) | S audit; suites exist, gate doesn't | Long-term quality; protects everything above | **S–M** | Wrap the existing runner; zero product risk |

### 🟠 Tier 2 — STRONGLY RECOMMENDED (material but with a sequencing dependency)

| # | Recommendation | Why not Tier 1 |
|---|---|---|
| **CP-15** | **Realize top catalog blocks** — gallery, team, stats, certifications/trust, structured service-areas (FD-T5-partial, + FD-T14's trust/availability blocks) | Per-block S effort but the *set* is L; sequence after CP-2 (sections) so blocks land orderable. Rest of the 30-block catalog = genuine value-tail → V1.1 |
| **CP-16** | **First theme variant per template** (FD-T3) + **logo→palette suggestion** (FD-T9) | Needs a human visual-QA eye — sequence with/after the GM browser pass, not before |
| **CP-17** | **Version diff summaries** — "what changed between these two versions" from existing change events (FD-12-lite) | Journal already tells a story; textual diff is S but visual diff is the real want → do textual now if approved, visual V1.1 |
| **CP-18** | **Brief auto-populate from discovery intake** (FD-M6) | Agency-side duplicate-typing, verified; sequence inside CP-1's reuse work |

### 🟡 Nice to have (approved-if-you-want): FD-BZ1 public KB · FD-B5 shareable component presets · FD-AEM2 conversational editing pilot.

### ⚪ FUTURE — deferred with the STRONG reason stated
- **FD-T7 Launches** (parallel draft lane): touches the one-draft assumption every writer/preview/publish path shares — genuine architecture work near frozen spines; wrong thing to rush into V1.
- **FD-R4 multi-language**: real architecture (per-locale rendering); deserves its own era.
- **FD-AEM1 headless API**: no V1 customer needs it; new public surface = new security surface.
- **FD-INF1 in-product domain purchase**: reseller/billing integration; genuine scope.
- **FD-Z1 cookieless analytics**: provider cost model (per-site fees) unresolved — product reason.
- **FD-BZ2/BZ3 demo + deck**: behind YOUR marketing fence until "done."
- **Full crop pipeline** (FD-T11-full), **FD-S4 migration reconcile** (touch migrations near launch = avoidable risk).

### ❌ REJECT — with reasoning
In-app messaging center (email + one-tap approvals + CRM notes close the loop; a second inbox = noise, Law-13-adjacent) · task-management surface (re-affirmed; FD-14) · drag-drop/freeform/personalization/popups (constitutional) · on-site search at brochure scale · feature-count parity of any kind.

## Effort summary if you approve everything Tier 1
~14 items: 8×S/S–M + 5×M + 1×L. Roughly **3–5 focused build days** in our phase cadence (CP-1 the largest single piece). Tier 2 adds ~2 more. All of it reuses existing architecture; zero new spines; every item lands with tests per the session's standard.

---

**AWAITING APPROVAL — nothing implemented.** Reply with any of: "approve Tier 1," "approve Tier 1 + 2," a list of CP numbers, or edits. I'll then run them as build phases in dependency order (CP-2 before CP-15; CP-16 after GM).
