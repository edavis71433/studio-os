# P2-C2 — Sales Closing Workflow: Validation, Hardening & Completion

**Run:** 2026-07-09, live against **staging** (`wjlpursnwbmlcdwbeowv`). **Objective:** prove the already-built closing workflow (proposals · contracts · conversion · onboarding), harden genuine defects, preserve every working capability, and honestly determine production quality. **Not a rebuild** — no parallel systems, no speculative optimization.

**Verdict: ✅ P2-C2 engineering-complete.** The full closing chain is validated end-to-end at runtime, tenant-isolated across two live workspaces, idempotent, version-integrity-guarded, and rides the ONE provisioning path. One genuine defect was found and fixed (convert rollback completeness). Human product-experience QA is consolidated at Phase 6 (not a P2-C2 gate).

---

## Phase 1 — Capability-preservation matrix
Every capability already implemented, classified. **Nothing removed; nothing disappears without a replacement.**

| Capability | Where | Classification |
|---|---|---|
| Contacts (person/company, per-site dedupe by email) | `routes/sales.ts` `handleSalesContacts` | ✅ Production-ready (P2-C1) |
| Deals — lead+opportunity as ONE record by stage | `handleSalesDeals/Deal/DealStage` + `lib/sales_lifecycle.ts` | ✅ Production-ready (P2-C1) |
| Deal events (activity + stage history + audit) | `dealEvent()` + `presence_deal_events` | ✅ Production-ready |
| Proposals = quotes (line items, deterministic subtotal, status) | `handleSalesProposalCreate` + `normalizeLineItems/subtotalOf` | ✅ Production-ready |
| Proposal send (HMAC-signed share link, idempotent re-send) | `handleSalesProposalSend` | ✅ Production-ready |
| Proposal decide (public token accept/decline, idempotent) | `handleSalesProposalDecide` | ✅ Production-ready |
| Contracts (body + `content_hash` version integrity + terms snapshot) | `handleSalesContractCreate` + `contractHash` | ✅ Production-ready |
| Contract send (signed link + hash, idempotent) | `handleSalesContractSend` | ✅ Production-ready |
| Contract signing (public token, hash-in-WHERE integrity, evidence) | `handleSalesContractSign` + `canSignContract` | ✅ Production-ready · minor: see Obs-3 |
| Signatures / signed evidence | `signed_evidence` (`{hash, at, token_exp}`) | ✅ Production-ready · minor: `ip_hash` reserved-not-recorded (Obs-3) |
| Approvals (accept/decline + sign are the approval gates) | proposal-decide + contract-sign | ✅ Production-ready |
| **Customer conversion** (idempotent, claim-first, guarded rollback) | `handleSalesConvert` + `convertOutcome` | ⚠️ **Needs hardening → FIXED** (Defect-1) |
| Customer creation (auth user + client; reuse-by-email, never duplicate) | `commerce/account.ts` helpers | ✅ Production-ready |
| Workspace provisioning (reuses ONE idempotent `provisionForSignup`) | `commerce/provision.ts` | ✅ Production-ready |
| Invitations (signed set-password link → `?next=/get-started.html`) | `generateSetPasswordLink` + `sendEmail` | ✅ Production-ready |
| Notifications (welcome/set-password emails, best-effort by design) | `sendEmail` | ✅ Production-ready |
| Onboarding handoff (reuses the EXISTING guided first-run) | `get-started.html` + `provisionForSignup` seeds | ✅ Production-ready |
| Lifecycle tracking (deal events + provenance change-event) | `writeChangeEvent` | ✅ Production-ready |
| Agency portfolio link on convert (Studio→Client loop, idempotent) | `resolveAgencyMember` + `presence_agency_clients` | ✅ Production-ready |
| Feature boundary (`/sales` → relationship / Business OS) | `middleware/feature.ts` | ✅ Production-ready |
| Rate limiting (public decide/sign/view per-IP) | `lib/ratelimit.ts` | ✅ Production-ready |
| Stripe / billing on conversion | — | ⏭️ **Deferred (explicit)** — convert grants **active access, UNBILLED**; billing is P2-E. A deliberate P2-C decision, not a gap. |

---

## Phase 2 — Runtime validation (live staging, 21/21)
The complete closing workflow, exercised against the real backend (`tests/presence/sales_closing_e2e_test.mjs`):

```
Lead → Opportunity → Proposal/Quote → (send · view · Accept via token)
     → Contract → (send+hash · version-integrity · Sign via token)
     → Convert → Workspace (provision) → Onboarding → Active customer
```

Proven: proposal created with a **deterministic subtotal** (400000 + 2×50000 = 500000); a labelless line item is **422, not 502**; the bounded ladder reaches `contract`; a contract mints a 64-hex `content_hash`; a contract-stage deal **converts → customer + workspace**, hands off to `/get-started.html`, and **invites** a brand-new login; **re-convert returns the SAME customer** (idempotent, no duplicate) and the deal is `won` carrying `converted_client_id`; a fresh lead is **refused (409 not_ready)**. Public token path: share link minted; **re-send idempotent**; prospect can **view** by token; **accept** advances the deal to `contract`; **re-accept idempotent**; contract link+hash minted; signing a **stale/edited version is refused (`version_mismatch`)**; the matching hash **signs**; **re-sign idempotent**; closing events recorded in history.

The public token steps ran for real — the link secret is configured on staging.

## Tenant isolation (live, two workspaces, 9/9)
`tests/presence/sales_closing_isolation_e2e_test.mjs`. Workspace **B cannot**: attach a proposal or contract to **A's** deal (404), send A's proposal or contract (404), or **convert A's deal** (404, no cross-tenant customer creation). Control: A still operates on its own. **Signed-link binding:** A's proposal token cannot decide a **foreign** proposal id (403 `invalid_link`), and B's own token cannot act on A's proposal (403). A signed link is bound to exactly one record + site.

## Regression (live + offline)
- P2-C1 foundation e2e **16/16** · P2-C1 tenant isolation **8/8** — still green (frozen model unchanged).
- Pure rules `sales_lifecycle` **33/33** · structural `sales_routes` **45/45** (was 44; +1 orphan-rollback assertion).
- **Full pure sweep: 102 passed · 0 failed · 4 skipped** (integration-only). Platform invariants, workspace roles, optimistic locking, shell — all green.
- **Typecheck:** `deno check supabase/functions/presence/index.ts` clean.
- One-command gate: `scripts/validate-p2c2.mjs` → **✅ green (offline + live)**.

## Security / permissions / optimistic locking / rollback
- **Permissions:** authed `/sales/*` gated to the relationship (Business OS) edition; public token routes are pre-auth **and authorized only by an HMAC-signed token** whose `site_id` is used for scoping (never session trust).
- **Optimistic locking:** stage moves guard the prior stage in the WHERE (`stage=eq.${deal.stage}`); contract signing guards `content_hash` in the WHERE — a stale version can't be signed.
- **Idempotency:** convert (claim-first + `converted_client_id` UNIQUE), send, decide, sign all safe to repeat.
- **Rollback:** convert now rolls back **every** client it creates and only what it created — see Defect-1.

---

## Defects found & fixed
**Defect-1 (genuine — fixed): convert rollback did not cover all client-creation paths.**
`handleSalesConvert` inserts a `clients` row on three paths — (a) new login via `createContactAndClient`, (b) an existing login with no client row, (c) a no-email studio-managed workspace. Only path (a) was tracked (`createdContactChain`), so a provision/stamp failure on paths (b)/(c) **orphaned a `clients` row** (plus any half-provisioned entitlement/site). Path (c) is especially reachable on staging, where plan `presence` provisioning fails on `hosting_unconfigured`.
**Fix:** a single `createdClient` flag set on **all three** insert paths gates both rollback DELETEs; `createdAuthId` still separately gates deleting a minted login. By construction `createdClient` is **never** true for a reused existing customer (`findClientByEmail` hit), so rollback can never delete someone else's account. Covered by a new structural assertion ("EVERY convert client-insert path is tracked for rollback") + typecheck + the live convert path (21/21). Re-run after the fix: gate green.

No other defects found. No data-integrity, tenant-isolation, or security defects.

---

## Architecture review
- **Did the frozen data model hold?** **Yes.** lead+opportunity = one `presence_deals` by stage held under the full closing workflow: proposal-accept and contract-sign both mutate the *same* deal row's stage, and convert stamps `converted_client_id` on that same row. proposal=quote (one `presence_proposals`); contract is its own entity by its separate legal lifecycle.
- **Schema changes required?** **None.** The five tables + indexes + deny-all RLS sufficed; nothing added.
- **APIs duplicated?** **No.** One coherent `/sales/*` surface; convert reuses the ONE `provisionForSignup`. No second provisioner, no second CRM.
- **Workflows duplicated?** **No.** Onboarding reuses the existing `get-started.html` first-run; account creation reuses `commerce/account.ts`.
- **Can anything be simplified?** Not warranted by evidence — the surface is already minimal-complete.
- **Did validation justify any optimization?** **No.** The only change was the Defect-1 fix. No speculative optimization was performed.

### Observations (documented, not changed — no evidence they're defects)
- **Obs-1 — convert gate semantics:** convert is allowed at stage `contract` **or** `won`. `contract` is reachable by proposal-**acceptance** as well as contract-signing, so a deal with an accepted proposal but no countersigned contract can convert. This is deliberate flexibility (an accepted proposal is a commercial commitment; managed deals may convert without a formal e-signature). The too-early error message ("Sign the agreement before converting") slightly overstates the requirement. No behavior change; noted for the owner.
- **Obs-2 — auto-advance events:** when a proposal is sent/accepted or a contract is signed, the deal's stage auto-advances and the semantic event (`proposal_sent`/`proposal_decided`/`contract_signed`) is recorded, but no separate `stage_change` event is. Current stage is always correct and the transition IS in history; a purist stage-audit would add the paired `stage_change`. Low value, deferred.
- **Obs-3 — signing evidence `ip_hash`:** the schema reserved `signed_evidence {hash, ip_hash, token_exp, at}`; the code records all but `ip_hash`. Adding a hashed signer IP would marginally strengthen legal signing evidence. Additive, reversible — **flagged as optional hardening for owner approval**; deferred to honor "no speculative work."

---

## Production-readiness assessment
**Engineering: production-ready.** The closing workflow is validated end-to-end at runtime, tenant-isolated, idempotent, version-integrity-guarded, single-provisioning-path, and defect-fixed; deployed to staging + prod. Remaining before real customer use — none are P2-C2 engineering blockers:
1. **Owner applies migration `0074` to prod** (launch step; staging validated). Prod `/sales/*` is dormant (502) until then.
2. **Billing formalization (P2-E):** convert currently grants **active, unbilled** access by design.
3. **Human product-experience QA at Phase 6 — Gold Master** (browser/mobile/keyboard/screen-reader), carried via `P2C1-HUMAN-QA-PACKAGE.md` (add the proposal/contract/convert screens there).

## Optimizations justified by evidence
**None performed.** No runtime evidence justified optimization; the one change was a correctness fix. Obs-2/Obs-3 are logged for evidence-driven follow-up, not done speculatively.
