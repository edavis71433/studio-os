# L4.6 — Platform Contract Freeze

The final architectural milestone before L5. M9 → L4.5 built and validated the platform; this freezes the contracts that survived implementation, validation, and real integration **without ever requiring architectural redesign**. From here, expansion happens by *extension*, not modification.

The freeze is enforceable, not aspirational: **`tests/presence/platform_invariants_test.mjs`** guards every invariant below (14/14 held). A change that violates one fails there, in CI-shaped tests, before it can reach production.

No features, providers, or redesign were added. One Product Law is *recommended* (§ Product Laws) for the owner to ratify.

---

## 1. Platform Contract Freeze

Frozen — permanent, changed only by an explicit constitutional amendment:

### The two spines

**A. The Intelligence Pipeline** *(understand the business)*
`Evidence → Judgment → Recommendation → Business Moments → Concierge` — pure, deterministic, one-way; each stage consumes only the prior; nothing bypasses it.

**B. The Approved-Plan Lifecycle** *(change the world outside the customer's draft)*
`Propose → Review → Approve → Atomic Claim → Execute → Verify → Audit → Rollback` — one spine (`lib/approved_plan.ts`), reused by both the Infrastructure and Connected-Write executors. The executor may differ; the lifecycle may not.

### The composed pipelines (resolve to the spines — frozen as compositions)

| Pipeline | Composition |
|---|---|
| **Creative** (Generate → Review → Approve → Draft → Publish) | Intelligence + the draft/publish ritual; AI drafts are approval-gated (Law 25) |
| **AI** (Ask → Proposal → Compare → Approve → Draft → Publish) | Creative with an AI proposal step; manual parity always (Law 25) |
| **Infrastructure** (Observe → Plan → Approve → Execute → Verify) | the Approved-Plan lifecycle, DNS/hosting executor |
| **Connected** (Connect → Observe → Normalize → Evidence) | the Intelligence pipeline's external front door (L4.1) |

### The standalone contracts

- **Export Contract** (Law 2) — the customer can always export their content, record, and observations; frozen.
- **Ownership Contract** (`OWNERSHIP`, Laws 1–4) — account + authorization are the customer's; connect/disconnect/export/leave/revoke always available, never penalized, no lock-in; identical for every provider.
- **Provider Capability Contract** — capabilities declared, never assumed (`automatic | guided | unsupported`); an adapter never claims what it cannot do.
- **Extension Contract** — `Registry → Adapter → Catalog → Rule`: growth is data + adapters; engines are never modified.

## 2. Architectural Invariants

Each is guarded by a test (`INV-n`):

1. **Nothing bypasses Evidence** — every evidence type is judged by exactly one rule; a connected observation is an evidence type or it doesn't exist.
2. **The pipeline is one-way** — no engine imports a later stage.
3. **Nothing bypasses Approval** — `requires_approval`/`approval_required` is a DB CHECK on every plan/recommendation surface (recommendations, AI drafts, growth, infra plans, connected writes) *and* enforced in every executor's code path.
4. **Nothing auto-publishes** — every recommendation carries `approval_required` + `manual_available` as `true`; the engine has no write path to content.
5. **Handoffs never write; writes are gated** — real writes declare an endpoint+method and are off until scopes are registered; handoffs declare neither and touch no provider.
6. **Nothing locks in customers** — ownership is a platform constant; leaving is never penalized.
7. **Everything is auditable** — append-only event ledgers for connection/write lifecycle and content changes.
8. **Growth is data, not engine edits** — every extension surface is an appendable list/record the engines consume generically.
9. **One Approved-Plan spine** — the atomic claim + approval law live once and are reused by both executors.
10. **Sentences, never scores** (Law 13) — no score/grade/percentage vocabulary reaches the customer-facing surface.

## 3. Extension Guide

Everything grows through the Extension Contract — **never** by editing an engine:

- **Provider** → append to `CONNECTED_PROVIDERS` + a `NORMALIZERS` entry.
- **Read signal** → a normalized field + a category-prefixed `CATALOG` entry.
- **Judgment / Recommendation / Moment** → append a `RULE` / `REC_RULE` / `TEMPLATE`.
- **Write workflow** → a `WRITE_SPECS` entry + a `buildWritePlan` branch; the Approved-Plan lifecycle is inherited.
- **Infrastructure plan** → a `plan*()` builder returning an `InfraPlan`; the lifecycle is inherited.
- **A new executor** → implement `ApprovedPlanBase` + reuse `claimApprovedPlan`; add an executor, not a lifecycle.

**Stop signal:** if an addition requires editing an engine or the spine, reconsider — the architecture is designed so it shouldn't.

## 4. Contract Reference

| Contract | Home | Frozen guarantee |
|---|---|---|
| Evidence | `evidence/contract.ts` (`CATALOG`) | 10-field observation; category-prefixed types; emitting an unregistered type fails that provider |
| Judgment | `judgment/contract.ts` | 13-field judgment; deterministic hash; audience-gated |
| Recommendation | `recommendation/contract.ts` | 19-field; `approval_required`/`manual_available` constants |
| Business Moment | `moments/contract.ts` | ≤3, merged, no scores; client view strips internals |
| Approved Plan | `lib/approved_plan.ts` (`ApprovedPlanBase`) | title/summary/risk/reversible/`requires_approval:true`; `decidePlan`, `isApproved`, `claimApprovedPlan` |
| Connected Provider | `connected/contract.ts` | declared capabilities; `OWNERSHIP`, `ERROR_PHILOSOPHY` constants |
| Provider Maturity | `connected/maturity.ts` | generated: planned/read/connected-intelligence/approved-writes/fully-mature |

## 5. Long-Term Maintenance Guide

- **Run the freeze on every change:** `platform_invariants_test.mjs` + `platform_spine_test.mjs` are the guardrails; a red one means an invariant was about to break.
- **Deterministic engines:** same input → byte-identical output. Never introduce `Date.now()`/`Math.random()` into an engine; the clock is passed in.
- **Migrations:** applying one migration needs the hold-back ritual (keep only remote-history files + the target). Reconcile `schema_migrations` history before the table count grows again (registered debt).
- **Provider activation is owner setup** (register apps / scopes); until then everything is honestly "not available yet," never a fake success.
- **Rotating `CONNECTION_ENC_KEY`** forces reconnects — announce first.
- **Deploy:** `supabase-go.exe functions deploy presence --project-ref <ref> --no-verify-jwt`; confirm "Deployed Functions".

## 6. Engineering Principles

1. **Declared, never assumed** — capabilities, permissions, and writes are declared; the system never pretends to a power it lacks.
2. **Calm by construction** — ≤3 moments, silence by default (Law 24), no scores (Law 13), no nagging; good news flows the same pipe as problems.
3. **Approval is a law, not a setting** — a DB CHECK, enforced in code, on every state-changing surface.
4. **Isolation** — a failing provider/adapter marks its own health and returns null; it never throws, never poisons a run.
5. **Honesty over convenience** — stale-but-labelled beats invented; "not available yet" beats a fake success; a plan says what it will *not* change.
6. **Reversible where possible, explained where not** — every write is undoable or carries a plain reason why undo is unneeded.
7. **The customer owns everything** — account, content, domain, authorization; leaving is a supported path, never a penalty.

## 7. Future Contributor Guide

Read, in order: `constitution/03-final-constitution.md` (the laws), `constitution/05-presence-intelligence-constitution.md` (the pipeline), `PLATFORM-SPINE.md` (the two spines), this file (the freeze), then the Extension Guide (§3).

- **To add anything**, find its extension surface (§3) and append. If you can't, ask why an engine needs editing before you edit it.
- **Before committing**, the invariants + spine tests must be green.
- **The two spines and the invariants are load-bearing walls.** A proposal that would create a *third* approval lifecycle, a *second* intelligence pipeline, an engine that writes to content, or a customer-facing score is an architectural regression until proven otherwise.
- **When unsure**, prefer silence, prefer the customer's control, prefer the reversible option.

---

## Product Laws — review & one recommendation

**Reviewed:** Laws 1–5 (ownership, export, no-penalty-to-leave, structured content as source of truth), 6 (pure renderer), 9 (honesty/as-of), 11 (fact law), 13 (sentences never scores), 17 (accessible by construction), 19 (no plugins/settings sprawl), 20 (no metered fees), 21 (same laws every edition), 22 (no ad-tech), 23 (findings earn their existence), 24 (silent platform fixes), 25 (approval + manual parity, a CHECK constant), 28 (lock status visible), 34 (additive editions). **All hold** across L4.0–L4.6 — verified against the invariants suite; none required change.

**One law emerged naturally and is recommended** (see `constitution/08-amendment-4-approved-action-law.md`):

> **Law 35 (recommended). One way to change the world.** Every action that changes state outside the customer's private draft — an internal recommendation, an infrastructure change, or an external provider write — happens only as an **Approved Plan**: proposed, explicitly approved, atomically claimed, executed, verified, and audited. No feature may create a second approval path, and nothing self-executes.

This is the natural generalization of Law 25 (which governed the *recommendation* engine) across all three executors, made mechanically enforceable by the L4.5 spine (`requires_approval` CHECK on every plan table; one shared `claimApprovedPlan`). It is *recommended*, pending owner ratification — no law is ratified silently.

**No further laws are necessary.** The remaining L4 behaviors (delegated encrypted tokens, provider isolation, honest gating) are *implementations* of existing laws (1–4 ownership, 9 honesty), not new laws.

---

## Final review

- **Can Studio OS now evolve without redesign?** Yes — every planned kind of addition has an extension surface; the engines and spines are frozen and guarded.
- **Would another engineering team understand the architecture?** Yes — two spines, everything-as-data, one Extension Guide, a Contract Reference, and a Contributor Guide; the invariants are executable documentation.
- **Would these contracts still make sense in five years?** Yes — they encode principles (ownership, approval, calm, determinism, isolation), not implementations; providers and infrastructure are replaceable adapters beneath them.
- **Did anything remain intentionally unfrozen?** Yes — provider *maturity* (still filling in normalizers/writes), the change-detection *history depth* (one-deep today), pricing, and the registered technical debt. These are extension points, not contracts, and are deliberately left open.
