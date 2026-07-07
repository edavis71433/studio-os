# L4.5 — Platform Spine Consolidation

Not a feature milestone. Studio OS is treated as a mature product: this consolidates the architecture *before* expanding it. The headline change — the two approval systems (Infrastructure Plans and Connected Write Plans) now share **one** lifecycle spine. No customer-visible behavior changed; no Product Law or constitutional guarantee changed; one guarantee got *stronger*.

**Result:** the approval law, the decision transition, and the atomic execution claim now live in exactly one file and are reused by both systems. 22 consolidation checks + full regression green (platform 34, services 26, connected suites, pipeline engines) + live integration re-proven for both the infra-plan apply flow and the connected write flow.

---

## 1. Platform Spine Architecture

Studio OS has exactly **one** way anything changes outside the customer's own draft: an **Approved Plan**. Two executors implement it — infrastructure (DNS/domain/hosting/email) and connected writes (provider APIs) — but they share one lifecycle:

```
Propose → Review → Approve → Atomic Claim → Execute → Verify → Audit → Rollback (where applicable)
```

That lifecycle lives in **`lib/approved_plan.ts`** — the spine:

- `ApprovedPlanBase` — the plain-language contract every plan carries (`title`, `summary`, `risk`, `reversible`, `requires_approval: true`). Both `InfraPlan` and `WritePlan` `extends` it.
- `decidePlan(decision)` — the one decision transition: `approve → approved`, `abandon → abandoned`, anything else → null. Used by the foundations route **and** the connected write store.
- `isApproved(status)` / `REQUIRES_APPROVAL` — the approval law as a predicate + constant.
- `claimApprovedPlan(...)` / `releaseApprovedPlanClaim(...)` — the atomic execution claim, **table-parameterized**, so every plan table reuses the identical guarantee: exactly one caller executes; a concurrent/duplicate caller is refused; an interrupted claim self-recovers after a staleness window.

The executor differs; the lifecycle does not.

## 2. Approved Plan Contract

*(Now a frozen contract — see §3.)*

| Element | Contract |
|---|---|
| Shape | `ApprovedPlanBase`: `title`, `summary`, `risk`, `reversible`, `requires_approval: true` |
| Statuses | `proposed → approved \| abandoned → (claimed) → executed/applied \| failed` |
| Approval | `requires_approval = true` — a schema CHECK on every plan table; enforced in the route **and** the executor |
| Decision | `decidePlan()` — the only transition into `approved`/`abandoned` |
| Claim | `claimApprovedPlan()` — atomic CAS on a claim-timestamp column while `approved`; the only path to execution |
| Release | `releaseApprovedPlanClaim()` — returns an incomplete run to approved-and-retryable |
| Terminal | executor-named (`applied` for infra, `executed` for connected) — the only per-executor variation |

Every write-capable workflow — GBP post/hours, Search Console verify, and every infrastructure plan — shares this. Handoffs (email/social/calendar drafts) ride the same lifecycle but their "execute" prepares content and touches no provider.

## 3. Platform Contract Freeze

These contracts have proven themselves across M9–L4.5 and are now **frozen** — permanent architectural guarantees, changed only by explicit constitutional amendment:

1. **The Intelligence Pipeline** — `Evidence → Judgment → Recommendation → Business Moments → Concierge`. Pure, deterministic, one-way; each stage consumes only the prior; nothing bypasses it (connected data had to enter as evidence or not exist).
2. **The Approved-Plan lifecycle** — `Propose → Approve → Atomic Claim → Execute → Verify → Audit → Rollback`. One spine; the executor may differ, the lifecycle may not. Approval is a schema CHECK, never a setting.
3. **Capabilities are declared, never assumed** — `automatic | guided | unsupported`; adapters never claim what they cannot do; providers are replaceable adapters behind a stable contract.
4. **Extension by additivity** — new providers/rules/catalog entries/workflows are appended; engines are never modified.
5. **Ownership as a platform constant** — identical for every provider; connect/disconnect/export/leave/revoke always available, never penalized, no lock-in.

The four named pipelines all resolve to these: the **Creative** and **AI** pipelines (Generate → Review → Approve → Draft → Publish) are the Intelligence pipeline feeding the Approved-Plan lifecycle; the **Infrastructure** (Observe → Plan → Approve → Execute → Verify) and **Connected** (Connect → Observe → Normalize → Evidence) pipelines are the Approved-Plan lifecycle and the pipeline's front door respectively. There are, in truth, **two spines** (Intelligence + Approved Plan) — frozen above — and everything else composes them.

## 4. Provider Maturity Matrix

Generated from what is actually built (`connected/maturity.ts`), never hand-kept. Stages: **Planned** (stub) → **Read** (real normalizer) → **Connected Intelligence** (reads feed L4.2 signals) → **Approved Writes** (has an approval-gated write) → **Fully Mature** (intelligence + writes).

| Stage | Providers |
|---|---|
| **Fully Mature** | Google Business Profile, Google Search Console |
| **Connected Intelligence** | Google Analytics, Yelp, Trustpilot, Bing Webmaster |
| **Read** | Facebook Page, Instagram, LinkedIn, YouTube, Google Calendar, Calendly, HubSpot, Salesforce, Mailchimp, Klaviyo, Stripe, Square |
| **Planned** | Apple Business Connect, Google Tag Manager, Meta Business |

Summary: `planned 3 · read 12 · connected_intelligence 4 · approved_writes 0 · fully_mature 2` = 21. (No writes exist without also feeding intelligence, so `approved_writes`-only is empty by design — a write-capable provider is at least Fully Mature.)

## 5. Architecture Consolidation Report

**Merged (clear maintainability win, no behavior change):**
- **Approval law** — was implicit in two routes; now `isApproved` / `REQUIRES_APPROVAL` in the spine.
- **Decision transition** — was duplicated inline in `foundations.handleFoundationsDecide` and `writestore.decideWritePlan`; now both call `decidePlan()`.
- **Atomic execution claim** — was implemented only for connected writes (L4.4); the inline claim SQL is removed from the write store and lives once in `claimApprovedPlan()`. **Infrastructure apply now reuses it** — the concurrency/interruption guard it previously lacked (a strengthened guarantee, released on failure so retry timing is unchanged).
- **Plan shape** — `InfraPlan` and `WritePlan` now `extends ApprovedPlanBase`; the shared fields are one type.

**Deliberately NOT merged (clarity would suffer):**
- **The two plan tables** (`presence_infra_plans`, `presence_connection_writes`) stay separate. Their columns and executors genuinely differ (DNS records/steps vs provider payload/verification); one table would need a sparse union and a behavior-risky migration for no real gain. The *lifecycle* is shared; the *storage* stays honest to each domain.
- **The two executors** stay separate — that is the point (“the executor may differ”).

## 6. Technical Debt Register

| Item | Status | Note |
|---|---|---|
| Approval logic duplicated | **Paid down** | one spine (`lib/approved_plan.ts`) |
| Atomic claim missing on infra apply | **Paid down** | infra now reuses the shared claim |
| `futureWrites` vs `WRITE_SPECS` drift | **Guarded** | a test asserts every shipped write is a declared future-write (shipped ⊆ declared) |
| `opt_dormant` graveyard rule | **Logged, not changed** | holds unrelated silent evidence types; removing emission is a (safe-but-real) behavior change, out of scope for a no-behavior-change milestone — revisit when touching the evidence catalog |
| 13 placeholder normalizers | **Logged** | honest stubs (status Planned in the matrix); carrying cost is low; fill when a provider is prioritized |
| `connected_data.prev` is one-deep history | **Logged** | L4.2 change detection compares only the last two reads; a time series is needed before trend features |
| Migration hold-back ritual | **Logged** | applying one migration needs the manual hold-back dance; reconcile `schema_migrations` history before the table count grows again |
| Test runner needs `$env:TMPDIR` + no CI | **Logged** | one-operator incantation; a `deno task` + CI would retire it |

## 7. Extension Guide

Everything grows by **data + adapters**, never engine edits:

- **A new provider** → append to `CONNECTED_PROVIDERS` (registry) + a normalizer in `NORMALIZERS`. The inventory, surface, maturity matrix, and evidence bridge pick it up automatically.
- **A new read signal** → a normalized field + a category-prefixed catalog entry; the evidence provider emits it, judgment groups it.
- **A new write workflow** → a `WRITE_SPECS` entry + a `buildWritePlan` branch; the spine (approve/claim/execute/audit) is inherited unchanged.
- **A new infrastructure plan** → a `plan*()` builder returning an `InfraPlan`; the foundations lifecycle is inherited unchanged.
- **A new judgment/recommendation/moment** → append a rule/template; the engines are frozen.

If an addition requires editing an engine or the spine, that is the signal to stop and reconsider — the architecture is designed so it shouldn't.

## 8. Future Architecture Notes

- **When a third executor appears** (e.g. a new external system with approval-gated writes), it implements `ApprovedPlanBase` + reuses `claimApprovedPlan` — it should add an executor, not a lifecycle.
- **Before trend/time-series features**, promote `connected_data.prev` to real history; the change-detection is deliberately one-deep today.
- **Before scaling providers past ~30**, reconcile the migration history so single-migration applies don't need the hold-back ritual.
- **The two frozen spines (Intelligence, Approved Plan) are the load-bearing walls.** New surfaces should compose them, not fork them. Any proposal that would create a *third* approval lifecycle or a *second* intelligence pipeline should be treated as an architectural regression until proven otherwise.

---

## Final review

- **Is the platform simpler?** Yes — one approval spine instead of two mirrored copies; the shared law/decision/claim are in one file.
- **Is there less duplication?** Yes — decision transition, approval predicate, and atomic claim are de-duplicated; a drift guard prevents `futureWrites`/`WRITE_SPECS` from diverging.
- **Can future features be added more easily?** Yes — a new write workflow or infra plan inherits the entire lifecycle for free; the Extension Guide is one page.
- **Did any architectural guarantees become stronger?** Yes — infrastructure apply gained the atomic concurrency/interruption guard it lacked, and both plan types now share one typed contract.
- **Would another senior engineer immediately understand the platform?** Yes — two frozen spines (Intelligence, Approved Plan), providers/rules/workflows as data, one Extension Guide, a generated maturity matrix.
- **Does Studio OS now have one clear architectural spine?** For *changing the outside world*, yes — one Approved-Plan spine. For *understanding the business*, one Intelligence pipeline. Everything else composes those two.
