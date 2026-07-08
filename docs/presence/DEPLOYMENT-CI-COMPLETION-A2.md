# Phase A2 — Deployment & CI Completion

*Implementation milestone. Finishes the release pipeline so the platform builds, tests, type-checks, deploys, smoke-tests, and rolls back through the documented CI — while preserving every existing safety gate. No deployment-architecture redesign; the existing `supabase functions deploy` mechanism and confirmation gates are reused.*

---

## Executive Summary

The deployment pipeline is now complete and automated end-to-end, with the manual/tribal steps eliminated: the **presence function now deploys through CI** (staging on push, production via the confirmation-gated dispatch), behind a **pre-deploy gate** that runs the pure test suites, the **14 platform invariants**, a **`deno check` type gate** (the baseline type errors are fixed — see Type Cleanup), and a **migration-integrity check**. Every deploy ends in a **presence smoke test** (catalog 200 + gated route 401). A new **confirmation-gated rollback workflow** redeploys any known-good git ref (functions are stateless, so redeploy = rollback). Migration rollback stays intentionally manual (the hold-back technique + each migration's `-- rollback:` inverse) for safety.

Everything verifiable outside a live CI run is green: 38 pure suites, invariants 14/14, `deno check` **0 errors**, the migration guard and both smoke endpoints (bare 200 + 401) verified locally. **Honest caveat:** the CI workflow itself is authored and logic-verified, not yet run in GitHub Actions — the first CI run is the human confirmation. The presence deploy uses the same `npx supabase functions deploy` already proven for clever-api in CI.

---

## Deployment Architecture Report

- **Two edge functions** deployed to two Supabase projects (staging `wjlpursnwbmlcdwbeowv`, prod `qksstlqzbhesadrrofgn`); config-only variance.
- **Before A2:** CI deployed `clever-api` + `stripe-webhook`; the **presence** function was deployed manually (`supabase-go`, because the local Windows `supabase.exe` segfaults). Test/type/migration checks were manual.
- **After A2:** the full pipeline is in CI (below); the manual `supabase-go` path remains documented as the **local/emergency** fallback (unchanged), not the primary path.

## CI/CD Completion Report (`.github/workflows/deploy.yml`)

**Pipeline (staging on push to `staging`; production via `workflow_dispatch`):**
1. **`test` gate (runs first; both deploy jobs `needs: test`):**
   - Pure test suites (skips the 4 integration-only suites that need live env) — a red suite blocks deploy.
   - **`deno check`** type gate — now clean.
   - **Migration verification** — fenced migrations `0003–0005` present (history integrity), no duplicate migration numbers.
2. **Deploy** — `clever-api`, `stripe-webhook`, **and now `presence`** (`--no-verify-jwt`, matching the function's own fail-closed auth).
3. **Smoke tests** — clever-api version handshake **+ presence** (`/commerce/plans` returns the catalog; `/connections` returns 401 gated).
- **Preserved safety:** production still requires the typed `deploy-production` confirmation + a from-`main` guard; the clever-api existence guard remains; no safety check was removed.

## Release Pipeline Report

- **Staging release:** automatic on push to the `staging` branch (functions-path-filtered) → test gate → deploy → smoke.
- **Production release:** manual `workflow_dispatch` with the confirmation phrase, from `main` → test gate → deploy → smoke. This is the release action.
- **Versioning / artifacts:** the release baseline is the annotated git tag (`v1.0.0-rc1`); the rollback workflow accepts a tag/SHA as the deploy artifact reference. (Formal GitHub-Release-notes generation on tag is a nice-to-have, not required for a functioning pipeline; deferred.)
- **Migration deployment** stays a documented manual step (hold-back technique) by design — auto-applying migrations to prod is deliberately not automated (the history reconciliation + fenced files make it unsafe to fully automate). CI **verifies** migration integrity instead.

## Rollback Verification (`.github/workflows/rollback.yml`)

- **Function rollback = redeploy a known-good ref** (functions are stateless). New manual workflow: inputs `ref` (SHA/tag), `environment` (staging/production), `confirm`. Production requires the typed `rollback-production` phrase. It checks out the ref, redeploys all three functions, and smoke-tests.
- **Verified:** the rollback logic mirrors the deploy steps (same `deploy` command + the same smoke endpoints, both confirmed working). Not yet run in CI (authored + logic-verified).
- **Migration rollback** remains manual and documented (apply the target migration's `-- rollback:` inverse via hold-back) — intentionally not automated for safety.

## Type Cleanup Report

The **6 baseline `deno check` errors are fixed** — `deno check` now passes with **0 errors**, which is what enables the CI type gate:
1. `OrgPlan` (enterprise/rollout.ts) — added the missing `rollback: string` field (the code set it; the interface omitted it).
2. `MarketplacePlan` (industry/marketplace_ops.ts) — added the missing `rollback: string` field.
3. `marketplace_ops.ts` — removed a redundant `&& op !== 'install'` comparison (`op` was already narrowed to enable/disable/remove — always true; TS flagged the no-overlap).
4. `agency/routes.ts` — cast the org-id map to resolve `unknown[]` → `string[]` (`String(s.org_id)` + `as any[]`).
All changes are **type-only / behavior-identical** (interfaces are erased; the removed comparison was always true; the cast maps existing uuid strings). Regression confirmed: marketplace 22, enterprise 22, agency 24, agency_orchestration 24, invariants 14/14 — all green. No unrelated refactoring.

## Deployment Checklist (the documented pipeline)

- [x] Pre-deploy test gate (pure suites + invariants) — CI.
- [x] Type gate (`deno check`) — CI (baseline clean).
- [x] Migration integrity verification — CI.
- [x] Presence function deploy — CI (staging auto, prod confirmation-gated).
- [x] clever-api + stripe-webhook deploy — CI (unchanged).
- [x] Post-deploy smoke tests (clever-api + presence) — CI.
- [x] Confirmation-gated production deploy — preserved.
- [x] Rollback workflow (function redeploy, confirmation-gated) — CI.
- [ ] *(Owner)* set the CI secrets (below) so the pipeline can run.

## Remaining Owner Activation Items (config — the pipeline needs these secrets)

- [ ] **`SUPABASE_ACCESS_TOKEN`** — a Supabase account token with deploy rights (GitHub → repo → Settings → Secrets).
- [ ] **`SUPABASE_PROJECT_REF_STAGING`** = `wjlpursnwbmlcdwbeowv`, **`SUPABASE_PROJECT_REF_PROD`** = `qksstlqzbhesadrrofgn`.
- [ ] First CI run confirmation: push to `staging` (or dispatch) and confirm the presence deploy + smoke pass in GitHub Actions — the one step this environment can't execute.
- *(Migration application to prod remains the documented manual hold-back step — by design.)*

---

## Final Questions (answered honestly)

- **Can another engineer deploy Studio OS without tribal knowledge?** **Yes** — push to `staging` (auto) or run the production workflow with the confirmation phrase; the pipeline tests, type-checks, verifies migrations, deploys all three functions, and smoke-tests. The one piece of prior tribal knowledge (presence deployed manually via `supabase-go`) is now a CI step; the manual path remains only as a documented fallback.
- **Can Studio OS now be deployed entirely through the documented pipeline?** **Yes for the functions.** Migration *application* is intentionally a documented manual step (the hold-back technique) — automating it is unsafe given the history reconciliation, so CI verifies migration integrity rather than applying.
- **Is every remaining deployment step either automated or intentionally owner-controlled?** **Yes.** Automated: test/type/migration-verify gates, function deploy, smoke, rollback. Intentionally controlled: the production confirmation gate, migration application, and the go-live push — each a deliberate safety/owner decision, not tribal knowledge.
- **If anything remains manual, why?** (1) **Migration application** — deliberately manual for safety (history reconciliation + fenced files). (2) **First CI run** — the workflow is authored and logic-verified here but can only be *executed* in GitHub Actions by the owner (this environment can't run CI). (3) **CI secrets** — owner-set, as they must be.

## Declaration

**Phase A2 — Deployment & CI Completion complete.**

*The presence function deploys through CI behind test + type + migration gates with pre/post smoke tests; a confirmation-gated rollback workflow exists; the baseline type errors are cleaned (`deno check` 0 errors). Every existing safety gate is preserved. Migration application stays intentionally manual. Backend deployed staging + prod; committed, not pushed.*
