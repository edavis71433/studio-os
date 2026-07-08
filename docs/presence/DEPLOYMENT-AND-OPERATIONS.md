# Deployment & Operations — Studio OS Presence

Everything needed to deploy, monitor, recover, and maintain production. Consolidates the deploy technique, the operational model ([OPERATIONS](OPERATIONS.md)), and the operator runbooks ([RUNBOOKS](RUNBOOKS.md), [runbooks/](../runbooks/)).

## Environments

- **Production:** `qksstlqzbhesadrrofgn` · **Staging:** `wjlpursnwbmlcdwbeowv`. Same code, config-only difference ([ENV-AND-SECRETS](ENV-AND-SECRETS.md)).
- **Frontend:** static HTML at the repo root, published to Netlify (`davisdigitalstudio.com`) by `git push`. **The go-live gate:** customer pages are committed but not pushed until the owner confirms pricing, Stripe, and nav — pushing publishes live.

## Deploying the function

**Primary path (CI — A2):** the `presence` function now deploys through GitHub Actions (`.github/workflows/deploy.yml`) — **staging** automatically on push to the `staging` branch, **production** via a confirmation-gated `workflow_dispatch` (type `deploy-production`, from `main`). Every deploy is gated by the pure test suites + `deno check` + migration-integrity check, and followed by smoke tests (clever-api handshake + presence catalog 200 + `/connections` 401). **Rollback:** run `.github/workflows/rollback.yml` with a known-good ref (SHA/tag); production requires the `rollback-production` phrase. Function rollback is a stateless redeploy; **migration rollback stays manual** (apply the target migration's `-- rollback:` inverse via the hold-back technique). CI secrets required: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_STAGING`, `SUPABASE_PROJECT_REF_PROD`.

**Local / emergency fallback:** use **`supabase-go.exe`** (the standard `supabase.exe` segfaults intermittently on deploy). The verified path:

```
pwsh scripts/deploy-presence.ps1 -Env staging   # then -Env prod
# or directly, per project:
C:\Users\edavi\Tools\supabase\supabase-go.exe functions deploy presence --no-verify-jwt --project-ref <ref>
```

- The script deploys `presence` + `stripe-webhook` and **verifies the "Deployed Functions" confirmation** — a silent half-deploy is the designed-against failure. Re-run on any non-confirmation; never trust a half-deploy.
- A `WARN: failed to read file: … sdk.ts` line is **benign** (a re-export stub) — deploy still succeeds; verify with a smoke test.
- `--no-verify-jwt` is correct: the function does its own auth.

## Applying a migration (the hold-back technique)

Remote migration history tracks only a subset (`0000–0002, 0006–0019, 0036–00NN`); `0003–0005` are fenced. So `db push` cannot run plainly. To apply one migration:

1. Move every **non-target** migration out of `supabase/migrations/` into a scratch dir, leaving only the remote-history set **+ the new target**.
2. `supabase-go.exe db push --yes` (it connects passwordless via cached account credentials; applies only the target).
3. For staging: `supabase-go.exe link --project-ref wjlpursnwbmlcdwbeowv`, push, then `link --project-ref qksstlqzbhesadrrofgn` to restore the prod link.
4. **Restore all held migrations** (move them back) and verify the file count.

Do this for staging **and** prod. Confirm with a smoke test after.

## Post-deploy smoke test

```
GET /commerce/plans            → 200 with ≥5 plans (function boots, catalog healthy)
GET /visual/kinds  (no JWT)    → 401 "Please sign in" (route live + gated)
GET /connections   (no JWT)    → 401 (route live + gated)
```

## Monitoring, Logging, Alerting

- **Health:** `GET /system/health` (secret-gated) — secret validation, DB reachability, active-site count, last cycle, failures in the last 24h.
- **Logging:** every scheduled unit and webhook event is a durable row; structured `console` lines carry tags (`[metering]`, `[stripe-webhook]`, …).
- **Alerting:** a cycle with failures emails `OPS_ALERT_EMAIL` (best-effort); the failure is always in the ledger regardless.

## Backups & Restore

- **Backups:** Supabase-managed PITR (a project setting). **Verify quarterly:** Dashboard → Database → Backups shows PITR enabled and a recent restore point; confirm the retention window meets the ownership promise.
- **Recovery drill:** clone the project to a scratch instance from a backup, run the test suites against it, confirm `presence_*` tables + entitlement/usage rows restore intact. Record the date in this doc.
- **Customer-facing backstop:** the export right (`GET /export`) lets any customer download everything they own — independent of platform backups.

## Rollback & Disaster Recovery

- **Bad function deploy:** redeploy the previous commit's function (`git checkout <prev> -- supabase/functions/presence && deploy`), or `supabase-go functions download` the prior version. The function is stateless — rollback is a redeploy.
- **Bad migration:** each migration file has a `-- rollback:` inverse; apply it via the same hold-back technique. Prefer a forward-fixing migration where safe.
- **Bad publish (customer site):** every publish is versioned — `POST /restore` to any prior version; a failed publish already leaves the live site unchanged.
- **Bad external change:** connected writes, DNS, and org rollouts are Approved Plans with a reviewed rollback (inverse plan or honest explanation).
- **Full DR:** restore the Supabase project from PITR, re-deploy the function to the restored ref, re-point config; run the integration suites to confirm.

## Maintenance schedule

- **Quarterly:** verify PITR + run a recovery drill; rotate secrets past cadence ([ENV-AND-SECRETS](ENV-AND-SECRETS.md)); review the [Technical Debt Register](RELEASE-NOTES.md#technical-debt-register).
- **On every change:** keep `platform_invariants_test.mjs` green; update the [API Reference](API-REFERENCE.md) and [DATABASE](DATABASE.md) alongside code.

## Production readiness checklist

- [ ] Function deployed + "Deployed" confirmed on staging **and** prod; smoke test green.
- [ ] Target migration applied to both; migration dir restored; file count verified.
- [ ] Required secrets set on both; activation keys set for any feature being turned on.
- [ ] `platform_invariants_test.mjs` 14/14; full suite green.
- [ ] PITR verified; a recent restore point exists.
- [ ] Go-live gate consciously cleared (prices, Stripe events, nav) before pushing the frontend.

## Operator runbooks (step-by-step)

New customer → live site, domains, DNS, promotion, byte-check, stale-cache: [RUNBOOKS](RUNBOOKS.md) and [runbooks/](../runbooks/) (`ENVIRONMENTS`, `DOMAIN-STALE-CACHE`, `PROD-PROMOTION-safety-fixes`, `BYTE-CHECK`). The unattended scheduler cycle (metering, retries, coach) is documented in [OPERATIONS](OPERATIONS.md); scheduling SQL is `supabase/ops/schedule-presence-cron.sql` (run once per project with the ref + `SCHEDULER_SECRET`).
