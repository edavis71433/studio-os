# Final verification runbook (#172)

The complete pre-release verification sweep, in three tiers. Tier 1 runs anywhere
with no credentials; Tier 2 needs staging credentials; Tier 3 is owner/human-only.
Last full Tier-1 run: **2026-07-15 — ALL GREEN** (results inline below).

## Tier 1 — sandbox, no credentials

| # | Command | Expected | 2026-07-15 |
|---|---------|----------|------------|
| 1 | `bash scripts/ci-pure-tests.sh` | 195 passed · 0 failed · 4 skipped (live-only) | ✅ 195/0/4 |
| 2 | `deno check supabase/functions/presence/index.ts supabase/functions/clever-api/index.ts supabase/functions/stripe-webhook/index.ts` | clean | ✅ |
| 3 | `deno check tests/isolation/isolation_test.ts tests/smoke/smoke_test.ts` | clean | ✅ |
| 4 | `deno run --allow-read scripts/dr-verify.mjs` | "Engineering-side DR readiness: complete" | ✅ |
| 5 | `deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-phase1.mjs` | 10/10 subsystems | ✅ 10/10 |
| 6 | `…validate-p2c1.mjs && …validate-p2c2.mjs && …validate-p2d.mjs` | offline groups green, live groups print creds-needed | ✅ |
| 7 | `npm install && npx playwright test` (needs real browser binaries — GH Actions `e2e.yml` or a dev machine) | 14 hermetic specs, 3 viewports | ⏳ CI-only (sandbox ships a different browser revision; the cms/files specs that run locally pass, remainder verified in CI) |

Notes for step 2 in a sandbox where deno.land is unreachable: the three functions
have exactly ONE remote import (`std@0.168.0/http/server.ts`); type-check with a
local import map shimming that URL to a stub `serve()` — check-time only, never
committed.

The golden render gate (8 template families × determinism + baseline + hostile
payloads) runs inside step 1 via `render_test.mjs`. Regenerate baselines only
deliberately: `deno run --allow-read --allow-write --allow-env
tests/presence/render_test.mjs --update-golden`.

## Tier 2 — staging credentials required

1. `export SB=<staging url> SR_KEY=<service_role> ANON=<anon>` then run the four
   integration suites (`admin_test`, `pipeline_test`, `room_test`, `service_test`)
   with `deno run --allow-read --allow-env --allow-net`; the hybrid suites' live
   tiers re-run automatically inside `ci-pure-tests.sh` with those vars set.
2. `export SALES_E2E_TARGET/ANON/JWT/JWT2[/SITE]` → re-run validate-p2c1/p2c2/p2d
   (live gates flip ⏳ → ✅).
3. `tests/smoke/smoke_test.ts` (anon tier; add SR_KEY for full tier).
4. `tests/isolation/isolation_test.ts` — **staging only** (creates/deletes users).
5. Probes: `rls_probe.mjs`, `retention_media_probe.mjs` (SB/SR_KEY).
6. `LOADTEST_TARGET=<staging presence URL> deno run --allow-net --allow-env scripts/loadtest/run.mjs`.

## Tier 3 — owner/human only

- Prod backups + PITR confirmation and a restore drill (see DISASTER-RECOVERY.md;
  dr-verify prints the checklist).
- Browser/mobile/screen-reader QA pass (`scripts/qa-staging-serve.mjs`).
- GitHub branch protection: make `ci.yml` "test" and `e2e.yml` "browser" required
  checks on main.
- GitHub Actions secrets present: `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_PROJECT_REF_STAGING` (the 2026-07-15
  deploy failure was these missing on the new repo).
