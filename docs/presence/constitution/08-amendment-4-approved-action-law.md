# Amendment 4 — Law 35: One way to change the world

**Status: RECOMMENDED (pending owner ratification).** No law is ratified silently; this records a law that emerged naturally through implementation (L4.0–L4.6) for the owner to accept or decline.

## The law

> **Law 35. One way to change the world.**
> Every action that changes state outside the customer's private draft — an internal recommendation, an infrastructure change, or an external provider write — happens only as an **Approved Plan**: proposed, explicitly approved, atomically claimed, executed, verified, and audited. No feature may create a second approval path, and nothing self-executes.

## Why it emerged (not invented)

Law 25 established the approval + manual-parity guarantee for the **Recommendation** engine: `approval_required = true` and `manual_available = true` as CHECK constraints (migration 0022), the engine with no write path to content.

L4 extended the same shape to two more executors without anyone designing a second philosophy:

- **Infrastructure Change Plans** (M12/M14, `presence_infra_plans`, migration 0033) — `requires_approval = true` CHECK; apply refuses anything not approved.
- **Connected Write Plans** (L4.3, `presence_connection_writes`, migration 0041) — `requires_approval = true` CHECK; execute refuses anything not approved; handoffs touch no provider at all.

L4.5 then proved they were the *same* lifecycle by consolidating them onto one spine (`lib/approved_plan.ts`): one decision transition, one approval predicate, one atomic claim. The pattern was already law-shaped in three places; Law 35 simply names the invariant that was already true.

## What it guarantees

- **No silent state change** anywhere outside the draft — internal or external.
- **No auto-execution** — a human approval is always the gate; the atomic claim ensures exactly-once, never-twice, self-recovering execution.
- **No second approval system** — a future contributor cannot fork a parallel, weaker approval path; the invariant test (`platform_invariants_test.mjs`, INV-3/INV-9) fails if they try.

## What it does NOT change

- It does not restrict *reads* (observation is free and continuous).
- It does not alter Law 24 (the platform still silently fixes what it owns — that work is platform-owned and carries no customer approval because there is no customer decision to make; Law 35 governs actions that leave the platform's own responsibility).
- It adds no customer-visible behavior; it is an architectural guarantee.

## Enforcement (already in place)

`requires_approval`/`approval_required` CHECK on every plan table; `isApproved()` + `claimApprovedPlan()` in the one spine; INV-3 and INV-9 in the invariants suite. If ratified, Law 35 is enforced the day it is written — nothing new to build.

## Recommendation

Ratify Law 35 as the generalization of Law 25 across all executors. If declined, Law 25 continues to govern recommendations and the infra/connected approval CHECKs stand on their own — the behavior is identical either way; ratification only makes the *unification* a named, permanent contract.
