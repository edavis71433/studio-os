# P2-C re-frame — Foundation-First Split (P2-C1 / P2-C2)

**Decision (Jul 9 2026):** the already-built P2-C is split into two milestones with honest boundaries. **Nothing is rebuilt or thrown away** — the code exists and is tested; the split changes how we *review and harden* it, not what we ship.

- **P2-C1 — Lead Management & CRM Foundation.** Lead → CRM → Opportunity → Pipeline. **Status: built; the next work is PURE VALIDATION — prove it end-to-end before any optimization.**
- **P2-C2 — Sales Closing Workflow.** Proposals → Contracts → Convert → Onboarding. **Status: built; parked for its own review once P2-C1 is validated.**

## ✅ FROZEN DATA MODEL (approved Jul 9 2026)
**A lead and an opportunity are ONE `presence_deals` record whose lifecycle is determined by `stage`, with history recorded in `presence_deal_events`.**
- Do **not** introduce separate Lead and Opportunity tables.
- Do **not** create synchronization between two business objects that represent the same commercial relationship.
- The stage says *where* the record is in its lifecycle, not *what type* of object it is.
- This is the **authoritative data model** — frozen unless a future business requirement proves it insufficient.
- Rationale: one source of truth · no cross-table sync · full history in events · simpler reporting/permissions/automation/analytics · less code + maintenance. (Matches how modern CRMs model this.)

## ⚠️ Execution order: VALIDATE FIRST, OPTIMIZE SECOND
Consistent with Phase 1 discipline (*prove first, optimize second*). **No convenience/optimization work on P2-C1 until the foundation is validated end-to-end.** The lead-dedup guard, CRM↔Pipeline linking, and any UX polish are **deferred until after** the validation gate below — we optimize a *proven* system, not an unvalidated one.

## Why split it
The whole P2-C was executed in one pass — 5 tables, ~15 routes, 2 pages, provisioning + invite + agency-link. That's a large surface with **no runtime verification** (migration `0074` unapplied) and no browser/mobile/AT QA. Foundation-first is lower-risk and gives smaller, honest review units: prove the CRM foundation is production-quality, *then* review the closing workflow. This is the milestone hygiene the original P2-C skipped.

---

## P2-C1 — Lead Management & CRM Foundation

### Scope (the foundation only)
Lead management (records · source · notes · status · assignment · search · filter · pagination · duplicate detection · activity history) · CRM (contact records · relationships · timeline · notes · ownership) · Opportunities (value · close date · stage · stage history · notes) · a simple pipeline.

### Current status — already built (as part of P2-C)
| Foundation capability | Where it lives | State |
|---|---|---|
| Lead + opportunity record (one entity, by stage) | `presence_deals` | ✅ built |
| Contact record + dedupe by email | `presence_contacts` (unique per site+lower(email)) | ✅ built |
| Source / source-from-inquiry | `deals.source` + `source_submission_id` (leads.html "→ Deal") | ✅ built |
| Assignment / ownership | `deals.assigned_to` | ✅ built |
| Search · filter · pagination | `/sales/deals`, `/sales/contacts` (ilike · stage · limit/offset) | ✅ built |
| Stage ladder + stage history / activity | bounded ladder + `presence_deal_events` | ✅ built |
| CRM timeline / notes / relationships | existing `crm.html` lens + `presence_relationship_notes` + deal↔contact link | ✅ reused |
| Studio surface | `pipeline.html` (on the shell, under Customers) | ✅ built |

### The data model — FROZEN (see the declaration above)
Unified `presence_deals` (lead+opportunity by stage). Approved + frozen; no separate tables, no sync. All P2-C1 validation and later optimization assume this shape.

### Production-quality gate — VALIDATION ONLY (in order)
The foundation is *built* but not *proven*. This gate is pure validation — **no optimization here.**
1. **[OWNER] Apply migration `0074`** to staging (then prod). Until then every `/sales/*` route 502s. This is the gate for everything below.
2. **[then] Verify complete runtime behavior on staging** — run `sales_e2e_test` (contact → deal → search → filter → pagination → stage move → activity history). First true proof it works.
3. **[then] Complete tenant-isolation verification** — confirm one workspace cannot read/write another's contacts/deals/events (live, not just structural), incl. the agency scope path.
4. **[then] Complete browser / mobile / accessibility verification** of `pipeline.html`, `leads.html`, `crm.html` (keyboard, focus, screen-reader labels, mobile layout).
5. **[then] Confirm the architecture is stable** — no schema/route changes needed after live testing; the frozen model holds under real use.

### P2-C1 Definition of Done
`0074` applied · runtime verified on staging · tenant-isolation verified live · browser/mobile/AT pass · architecture confirmed stable. **Only when all five hold is P2-C1 "production quality." No optimization/convenience work counts toward — or precedes — this gate.**

### AFTER validation — optimizations (do NOT start these before the gate above passes)
Deferred until P2-C1 is proven. Recommendations recorded now so we don't lose them, but **not to be built until the foundation is validated**:
- **Lead deduplication** — one deal per `source_submission_id` (a partial-unique guard) so a double-click on "→ Deal" can't create duplicate deals. *Justified; do it on a proven system.*
- **CRM ↔ Pipeline linking** — a light link (a customer's open deal on `crm.html`, a "view relationship" link on the deal). Not a unified rebuild.
- **Tags** → **DEFER** (no launch filter need; bloat guard).
- **Contact-level status** → **DEFER** (`deleted_at` already archives; state shows through deals).
- Any additional UX polish.

---

## P2-C2 — Sales Closing Workflow (built · parked)

### Scope
Proposals (line items · signed accept link · draft/sent/accepted/declined) · Contracts (version-integrity signing) · **idempotent Convert → `provisionForSignup` → guided onboarding** · convert-time login invite · agency-portfolio link.

### Status
**Built and deployed** (part of the P2-C commit series), with the deep-review fixes already applied (guarded rollback; claim-first convert; rate-limited public endpoints). **Parked** — it gets its **own** production-quality review *after* P2-C1 is proven, on the same gate (apply-migration-if-any · staging e2e · browser/AT QA · security pass). No new build expected; this is a review/verify milestone.

### Why park it rather than delete it
It's working, tested (98/0 sweep, 44/44 structural), and reuses the one provisioning path. Deleting it to "reset to a clean foundation" would discard proven code for a boundary we can get by re-framing. If the P2-C1 model sign-off changes the deal shape, P2-C2 adapts — but there's no reason to pre-emptively throw it away.

---

## What is NOT changing
- No rebuild of the foundation. No second CRM. No migration churn.
- The frozen P2-A classification, the P2-B shells/nav, and the reuse-first spine all hold.
- `clever-api`'s legacy sales routes remain flagged for P2-G (retire after verified parity) — unaffected.

## Task buckets (validation-first — this is the order)
1. **Owner:** apply migration `0074` (staging → prod) — the gate for all live verification. **Nothing else proceeds until this is done.**
2. **Validate (post-`0074`):** staging runtime e2e → live tenant-isolation → browser/mobile/AT QA → confirm architecture stable.
3. **Only after validation — optimize:** lead-dedup guard, CRM↔Pipeline link, UX polish.
4. **Deferred outright:** tags, contact-status, full CRM/Pipeline unification, and all of P2-C2's own review.
- **No engineering optimization happens before step 2 passes.** We optimize a proven system, not an unvalidated one.

## Roadmap impact
`STUDIO-OS-ROADMAP.md` / `ROADMAP-MASTER.md`: the single "P2-C" entry becomes **P2-C1 (foundation, built → hardening)** + **P2-C2 (closing workflow, built → parked)**. Everything previously logged under P2-C is preserved under the two.
