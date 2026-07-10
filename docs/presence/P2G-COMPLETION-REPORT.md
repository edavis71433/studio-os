# P2-G — Legacy Retirement & Phase 2 Closure — Completion Report

**2026-07-10.** The final Phase 2 milestone: cleanup, verification, retirement, simplification. Not a feature milestone. Executed in the prescribed order. **Headline: the major legacy system (`clever-api`) is load-bearing for the agency's own operations and has no `presence` replacement, so per P2-G rule 2 it is documented-and-retained, not deleted. The genuinely-dead subset was retired; the presence product architecture is verified clean.**

---

## 1. Legacy inventory + dependency map

| Component | What it is | Depends-on / used-by | Verdict |
|---|---|---|---|
| **`supabase/functions/clever-api` (12,029 lines)** | The original single-tenant edge function | **LIVE** for: public agency lead capture (`contact`, `audit`, `buy-audit`, `report-card`, `ai-critique`, `start`, `project-survey`), the operator console (`dds-studio-manage-9k2p`, ~85 endpoint calls), `admin-growth`, `portal`, `provision`, `set-password`, `client-archive-ui` | 🔴 **RETAIN — no replacement** |
| clever-api DB tables (`audit_leads`, `audit_orders`, `discovery_intake`, agency `clients`/`invoices`/`messages`, …) | The agency's own operational data | clever-api (above) | 🔴 **RETAIN — live** |
| `supabase/functions/presence` (the product) | Multi-tenant Studio OS: CMS, publishing, billing, entitlements, AI, projects/bridge, analytics | The two customer apps + shell | ✅ Current architecture — keep |
| `client-archive-ui.html` | Standalone client archive/restore/purge UI on clever-api | **Orphan** — linked from nowhere; capability duplicated in the console | ✅ **RETIRED (deleted)** |
| `portal-workspace.html` | JS redirect → `portal.html#growth` (post-migration compat) | Linked from nowhere; catches old bookmarks | 🟡 **RETAIN — compat shim** (documented; delete when a server 301 replaces it) |
| `portal.html` service sections | Older service-delivery UI, superseded by the `client.html` bridge | `portal.html` is the **live** DDS client portal (on clever-api) | 🟡 **RETAIN** — portal.html itself is live; the sections retire with clever-api |
| `pipeline.html` | Deal-detail view reached from `leads.html` after convert | Referenced by `leads.html` | ✅ **RETAIN — reachable/live** |
| `_internal/*.html` (function-test, email-nurture-sequence) | Dev/reference pages | Linked nowhere; `_internal/` namespace | 🟡 **RETAIN** — intentional internal references, zero ship/maintenance cost |
| presence migrations `0000–0085` | Additive schema history | The product | ✅ **RETAIN** — additive history; not removable without rewriting applied state |

**Dependency reality:** `presence` (the product) and `clever-api` (the agency's own site + ops) are two independent stacks. Phase 2 built the *customer product* on `presence`; the *agency's own operations* still run on `clever-api`. They do not import each other.

## 2. Capability verification (before retiring anything)

- **`clever-api` → replacement?** **NO.** Its live capabilities — the public marketing site's lead capture, the operator console, the client portal, the audit tools — have **no `presence` equivalent**. `presence` is the multi-tenant *product*, not the agency's own operational tooling. **Per P2-G rule 2: STOP, document, do not delete.** Retiring clever-api = migrating the Davis Digital Studio agency site + console onto Studio OS, which is exactly the **Phase 3 (DDS Website)** work + a future dedicated Studio OS launch (and is gated by the Platform Secrecy Rule — the platform stays behind the curtain until DDS runs on it in production).
- **`client-archive-ui.html` → replacement?** **YES** — client archive/restore/purge exists in the operator console. Orphan + duplicate → safe to retire.
- **The customer post-sale stack (projects/messaging/deliverables)** was **net-new on `presence`** (P2-D); the clever-api version was disposable prototype data, never a live system with users to migrate. So there is no live customer-facing legacy to cut over — it was built fresh on presence, verified across P2-C/P2-D/P2-E/P2-F.

## 3. Retirement (only verified, safe)

- **Deleted:** `client-archive-ui.html` (orphan duplicate; capability in the console; git-reversible).
- **Deliberately NOT deleted (with reasons):** `clever-api` + its tables (live agency ops, no replacement); `portal.html` + service sections (live client portal); `pipeline.html` (reachable); `portal-workspace.html` (compat redirect for old links); `_internal/*` (intentional references); presence migrations (additive history). Piecemeal excision of the *dead* routes *inside* the clever-api monolith was rejected as unsafe — it mixes live and dead code with shared tables, and there is no test harness for clever-api; it retires wholesale at the DDS migration.

## 4. Regression validation — all green

- **presence suite: 140/140 pure & structural green**; 6 live-integration suites skip cleanly without SB creds (unchanged). Covers tenant isolation, lifecycle, billing, CMS, publishing, AI, analytics, forms→CRM, notices, oversight.
- **Platform invariants: 14/14 HELD** (single Evidence spine, one-way pipeline, one approval law, one atomic claim, ownership guarantees, append-only ledgers, no score/grade vocabulary…).
- Typecheck clean across the product. No test changed as a result of P2-G.

## 5. Architecture audit (after cleanup)

| Check | Result |
|---|---|
| Duplicate systems | **None** in `presence` — enforced by the 14 frozen invariants (single spines for Evidence, Approved-Plan, entitlement writer, notice model, publish pipeline, renderer). |
| Duplicate routes | **None** — every route file in `routes/*` is imported/wired; the only repeated route strings are method-differentiated (GET/PATCH on the same path). |
| Duplicate models | **None** — one content model, one renderer, one publish pipeline, one AI-usage ledger + ceiling, one notification/notice model, one entitlement writer (`entitlement_sync.ts`). |
| Orphaned tables | Within `presence`: none. `clever-api`'s tables are **live**, not orphaned. |
| Unreachable code | No orphan route files. **Module-level scan (Jul 10):** every `presence/**/*.ts` module was checked for inbound imports. All are wired **except two Presence-native forward modules that no route reaches yet** — `connected/maturity.ts` (provider-maturity summary) and `lib/palettes.ts` (premium palette set, Phase-PT design). Both are tested (`platform_spine_test`, `palettes_test`) and intentional; they are **retained, not deleted** — they own tested behaviour and are staged forward work, not clever-api legacy (deleting them would discard planned capability, which P2-G forbids). Flagged here for an explicit owner decision (wire or drop) rather than silent removal. Client-side dead code is catalogued in `HTML-DEEP-AUDIT.md`; clever-api-internal dead paths retire with clever-api. |
| Dead navigation | The one confirmed orphan page (`client-archive-ui.html`) removed. |
| Legacy dependencies | `presence` has **no** dependency on `clever-api`. `clever-api` remains an independent, live agency stack. |

**Intentional retentions, restated plainly:** `clever-api` and everything on it stays because it *is* the running Davis Digital Studio agency site + operator tooling, and its replacement (Studio OS running the agency) does not exist yet. Removing it now would take down the live business.

## 6. Before vs after / debt

- **Code reduction:** −1 orphan UI page (`client-archive-ui.html`); the large reduction (retiring the 12k-line `clever-api` monolith) is **staged for the DDS migration**, not achievable in Phase 2 without removing live capability.
- **Maintenance reduction:** the *product* (`presence`) is confirmed single-spine, invariant-locked, fully tested — no duplicate systems to maintain. Two clean stacks with a clear boundary (product vs agency-ops) rather than one tangled one.
- **Technical debt eliminated (this session, feeding P2-G's "cleanest architecture" goal):** P2-E billing/lifecycle correctness; P2-F integration seams (forms→CRM, unified notices, oversight); 14 waves of HTML fixes (systemic stale-token, XSS, a11y keyboard/focus, SEO, dark-mode, dead CSS). See `HTML-DEEP-AUDIT.md` resolution log.
- **Remaining technical debt (documented, deferred with justification):** (a) the `clever-api` monolith retires at the DDS→Studio-OS migration; (b) the 19k operator-console structural refactor (shared `esc`/`callEdge`, dead-module removal) needs a staging harness; (c) legal-completeness (terms/privacy) needs counsel; (d) the HTML long-tail (per-page modal ARIA, remaining SEO). None block Phase 2 closure.

## 6b. Recommendations before beginning Phase 3
1. **Treat `clever-api` as the current agency runtime, not a retirement target** — Phase 3 (the DDS website) runs on it. Its retirement is a *later* step: it happens *when* Phase 3's output (the migrated agency site) plus a Studio-OS-runs-the-agency milestone make it redundant. Sequence, not cleanup.
2. **Honor the Platform Secrecy Rule in all Phase-3 copy/screenshots** — public pages present platform capability only as *Davis Digital Studio service benefits*; no Studio OS / CMS / SaaS / platform / white-label / licensing / agency-edition / platform-pricing language until DDS runs on the platform in production. (`[[platform-secrecy-rule]]`)
3. **Owner launch-time items remain open and unchanged** — prod migrations `0075–0085` apply at launch; production OAuth/consent screens; Stripe test-mode checks; push the local commit backlog at fence-lift; Phase-6 human browser/mobile/WCAG QA.
4. **Decide on the two unwired forward modules** (`maturity.ts`, `palettes.ts`) — wire them into a route or drop them; today they're maintained-but-dormant.
5. **The 19k operator console** wants a staging harness before its structural refactor (shared `esc`/`callEdge`, dead-module removal) — do it during agency-tooling work, not blind.

## 7. Simplified dependency graph
```
  Customer (small business)              Davis Digital Studio (agency)
        │                                        │
   presence.html / today / client   ┌── public marketing site (index, services, …)
        │                           │        │  lead capture
   ┌────┴─────────────┐            │        ▼
   │  presence (edge) │            │   clever-api (edge, 12k) ── agency DB
   │  — the product   │            │        ▲
   │  CMS·publish·AI  │            └── dds-studio-manage (operator console)
   │  billing·bridge  │                     admin-growth · portal · audit tools
   └──────────────────┘
   (multi-tenant, invariant-locked)   (single-tenant agency ops — retires at DDS migration)
   NO cross-dependency between the two stacks.
```

---

**P2-G verdict:** Complete. The inventory is done, replacements are verified, the one safe orphan is retired, the presence product architecture is confirmed clean (140 green + 14/14 invariants), and the one big legacy system is **correctly retained-and-documented** because removing it would delete a live business with no replacement. That deferral is not debt from avoidance — it is the Platform-Secrecy-Rule sequence working as intended: the platform stays behind the curtain until the agency itself runs on it.
