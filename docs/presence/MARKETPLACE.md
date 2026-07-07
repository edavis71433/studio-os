# L5.5 — Industry Pack Marketplace Foundation

Industry Packs now behave like installable software. The Marketplace is **infrastructure, not commerce** — it installs, enables, disables, updates, removes, exports, versions, validates, and audits packs, and nothing more. No storefront, no payments, no licensing, no subscriptions, no discovery. Every state-changing operation rides the **existing** Approved-Plan spine — no second approval system.

**Result:** the pure management core + a persistence + operation lifecycle on the frozen spine (migration 0042). 22 pure + 7 live checks; full regression green; invariants 14/14 held. Dependency resolution across 1000 packs in 194 ms.

---

## 1. Marketplace Architecture

Two tables and one pure brain:

- **`presence_pack_installs`** — the current state of each pack per scope (`global`, or a client id for private/agency packs).
- **`presence_pack_operations`** — the Approved-Plan ledger: every install/enable/disable/update/remove, proposed → approved → atomically-claimed → executed → audited.
- **`industry/marketplace_ops.ts`** (pure) — dependency resolution, install assessment, operation planning (as `ApprovedPlanBase`), states, customer features.
- **`industry/marketplace_store.ts`** — the I/O, which *reuses* `lib/approved_plan.ts` (`decidePlan`, `claimApprovedPlan`, `releaseApprovedPlanClaim`) — the same spine as connected writes and infra plans.
- **`routes/marketplace.ts`** — the operator surface (prepare/decide/execute/rollback/audit) and the customer features view.

The Marketplace works identically for **first-party, partner, third-party, private agency, and enterprise** packs — a pack is a pack; only `author`/`license`/`scope` differ.

## 2. Installation Lifecycle

```
prepare (assess → Approved Plan)  →  decide (approve/abandon)  →  execute (atomic claim → apply → verify)  →  audit
                                                                                            └→ rollback (reviewed inverse)
```

- **Prepare** — `POST /marketplace/:key/prepare {op}` assesses the pack and returns an Approved Plan, or **refuses (422)** with reasons if assessment fails.
- **Decide** — `POST /marketplace/operations/:id/decide {approve|abandon}` (the shared `decidePlan`).
- **Execute** — `POST …/execute` enforces approval, **atomically claims** the operation (never twice), applies it to the install state, and **verifies** by reading the state back.
- **Rollback** — `POST …/rollback` prepares the **inverse** operation as a new reviewed plan (even undo is approved).
- **Audit** — `GET /marketplace/audit` is the operation ledger; every step is recorded.

Every operation is auditable, approval-gated, and reversible-or-explained — inherited from the spine, not reinvented.

## 3. Dependency Guide

`resolveDependencies(pack, installed)` reports:

- **Required** — the `extends` ancestry (a child needs its parent installed).
- **Missing** — required ancestors not installed.
- **Conflicts** — evidence-type collisions with an installed pack.
- **Cycle** — a cyclic `extends` chain (bounded, never hangs).
- **Optional** — a declared extension point (none in the frozen contract yet).

Invalid installs are prevented **before** they occur: `assessInstall` runs validation + registry checks + dependency resolution + compatibility, and a blocked plan never executes.

## 4. Versioning Guide

- **Pack version** — semver; updates are forward-only (`updateAvailable`, `compareVersions`).
- **Platform compatibility** — `minPlatformVersion` vs `PLATFORM_VERSION` (5.4.0); an incompatible pack lands in the `incompatible` state and is refused.
- **Upgrade / downgrade / migration** — `update` moves the install to a new version; the previous version is restorable via rollback. Customer content is untouched by any version change.
- **Deprecation** — the lifecycle state machine (`deprecate`) ends a pack's life; installed sites keep their version until they choose to update.

## 5. Security Model

A pack, installed or not, can never bypass a platform guarantee — verified:

- **Cannot modify engines / contracts / laws / frozen architecture** — a pack is data + one pure provider; the SDK exposes no engine internals; the invariants suite (14/14) fails if an engine is touched.
- **Cannot write outside approved extension surfaces** — contributions are registry entries; anything else doesn't compose.
- **Cannot emit uncatalogued evidence** — the emit contract rejects it (proven).
- **Cannot bypass approval** — marketplace operations carry `requires_approval` as a **DB CHECK** (proven live: `requires_approval=false` is rejected by the database); recommendations still require approval.
- **Cannot bypass auditing** — every operation is a ledger row.
- **Cannot bypass ownership** — no operation touches customer content; disabling or removing a pack leaves every site's content, drafts, domains, and history intact.

## 6. Marketplace Validation Guide

The submission/install gate (`assessInstall` = `validatePack` + `validatePackAgainstRegistry` + deps + compat) checks, each with a clear message:

manifest integrity · required metadata · snake_case naming · semver versions · platform compatibility · duplicate identifiers · evidence-type collisions · missing dependencies · inheritance cycles · capability declarations · registry consistency. A pack that fails lands in `failed_validation`/`incompatible` and is refused before it can affect anything.

## 7. Marketplace Operations Guide (Operator)

One calm place (`GET /marketplace`, operator-only — staff or system) to:

- **Review packs** — every registered pack, its state, and whether an update is available.
- **Prepare/approve/execute** installs, enables, disables, updates, removes — as Approved Plans.
- **See dependencies** — resolved on prepare; blocked plans explain why.
- **Audit history** — the operation ledger.
- **Rollback** — the reviewed inverse of any completed operation.

## 8. Rollback Guide

Every operation has a defined inverse (`install↔remove`, `enable↔disable`, `update→update`). `rollback` prepares that inverse as a **new proposed operation** — so undoing is itself reviewed and approved, and audited, and reversible. Because no operation ever touches customer content, a rollback restores platform behavior without any risk to a site's work.

## 9. Marketplace Readiness Report

Ready as **infrastructure**: install/enable/disable/update/remove/export/import, dependency resolution, validation, states, audit, and rollback — all on the frozen Approved-Plan spine, all operator-gated, all preserving customer ownership. **Deliberately not built (future, per scope):** the commerce surface — a storefront, payments, licensing, subscriptions, discovery. None require a platform change; they sit on top of this foundation.

---

## Final review

- **Can the Marketplace manage hundreds of packs?** Yes — resolution/assessment are pure and O(chain); 1000-pack dependency resolution in 194 ms; state lives in one indexed table.
- **Can third-party packs be installed safely?** Yes — the same assessment gate (validation + collisions + deps + cycles + compatibility) applies to every pack regardless of author.
- **Can bad packs be rejected automatically?** Yes — `assessInstall` blocks a bad install before it runs, with self-explaining reasons and a clear failed-state.
- **Can the Marketplace evolve without changing engines?** Yes — it is a management plane over data; the engines and the invariants are untouched (14/14 held).
- **Does every change preserve customer ownership?** Yes — no operation touches customer content; disable/remove leave every site intact.
- **Does every Marketplace action use the Approved Plan spine?** Yes — `decidePlan` + `claimApprovedPlan` + the `requires_approval` CHECK; proven live (the DB rejects an un-approvable operation; the atomic claim executes exactly once).
- **Would another team understand it?** Yes — two tables, one pure ops module, one store that reuses the spine, one route file; the lifecycle is the same propose→approve→execute→audit→rollback used everywhere else in the platform.
