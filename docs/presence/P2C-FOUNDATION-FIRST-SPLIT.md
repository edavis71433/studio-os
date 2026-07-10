# P2-C re-frame — Foundation-First Split (P2-C1 / P2-C2)

**Decision (Jul 9 2026):** the already-built P2-C is split into two milestones with honest boundaries. **Nothing is rebuilt or thrown away** — the code exists and is tested; the split changes how we *review and harden* it, not what we ship.

- **P2-C1 — Lead Management & CRM Foundation.** Lead → CRM → Opportunity → Pipeline. **Status: built; now brought to *production quality* (live-verified) before we lean on it.**
- **P2-C2 — Sales Closing Workflow.** Proposals → Contracts → Convert → Onboarding. **Status: built; parked for its own review once P2-C1 is production-quality.**

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

### The model decision (needs your sign-off)
**Lead and Opportunity are one `presence_deals` record, distinguished by stage** (`lead` → `qualified` → … → `won`/`lost`), not two tables. This matches P2-C1's own "eliminate duplicated concepts / simplify the data model." A "lead" is a deal in an early stage; it becomes an "opportunity" as it advances — same row, full history preserved in `presence_deal_events`. **Recommendation: keep unified.** The alternative (separate `leads` + `opportunities` tables with a promotion step) adds a table, a copy, and a sync seam for no launch benefit. → *Bless this before we harden around it.*

### Production-quality gate — the real remaining work
This is where P2-C1 has teeth. The foundation is *built* but not *proven*:
1. **[OWNER] Apply migration `0074`** to staging (then prod). Until then every `/sales/*` route 502s. This is the gate for everything below.
2. **[OWNER/eng] Runtime verification on staging** — run `sales_e2e_test` (the foundation steps: contact → deal → search → stage move; tenant isolation; pagination). First true proof it works.
3. **[human] Browser / mobile / AT QA** of `pipeline.html`, `leads.html`, `crm.html` (keyboard, focus, screen-reader labels, mobile layout).
4. **[eng, cheap — recommend do now] One deal per source inquiry.** A partial-unique guard so double-clicking "→ Deal" on a lead can't create duplicate deals from the same `source_submission_id`. Genuine lead-level duplicate protection; ~one index + one check.
5. **[decide] The two small deltas P2-C1 lists** — see below.

### Small deltas (P2-C1 checklist items not yet built) — with a recommendation each
- **Tags** (P2-C1: "if justified") → **DEFER.** No segmentation/filter need at launch; adding tag CRUD + a filter UI now is speculative. Add when a real filter demands it (bloat guard).
- **Contact-level status** (distinct from deal stage) → **DEFER.** `deleted_at` already gives archive; a contact's "state" is expressed by its deals' stages. Revisit if a contact-without-a-deal view needs it.
- **Lead duplicate detection** → **DO (item 4 above).** This one is justified and cheap.

### CRM lens ↔ Pipeline integration (cohesion opportunity)
`crm.html` (relationship lens) and `pipeline.html` (deals) are separate surfaces. **Recommendation for P2-C1: a light link** (surface a customer's open deal on `crm.html`, and a "view relationship" link on the deal) — not a full unified rebuild. Full unification is a later-milestone opportunity, not launch-blocking.

### P2-C1 Definition of Done
0074 applied (staging≥) · e2e green on staging · browser/mobile/AT pass · lead-dedup guard · model blessed · roadmap updated. **No proposals/contracts/convert work counts toward P2-C1.**

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

## Task buckets (so this is actionable)
- **Do now (cheap engineering):** the lead-dedup guard (item 4). Optionally the light CRM↔Pipeline link.
- **Owner:** apply migration `0074` (staging then prod) — the gate for all live verification.
- **Human (post-0074):** browser / mobile / AT QA of the three surfaces + the staging e2e.
- **Decide:** bless the unified-deal model; accept the tags/contact-status defers.
- **Defer:** tags, contact-status, full CRM/Pipeline unification, and all of P2-C2's own review until P2-C1 is production-quality.

## Roadmap impact
`STUDIO-OS-ROADMAP.md` / `ROADMAP-MASTER.md`: the single "P2-C" entry becomes **P2-C1 (foundation, built → hardening)** + **P2-C2 (closing workflow, built → parked)**. Everything previously logged under P2-C is preserved under the two.
