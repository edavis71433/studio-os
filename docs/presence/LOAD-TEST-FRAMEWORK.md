# Presence CMS — Load-Test Framework (Phase 1 · M10)

A **reusable, configurable, deterministic, documented** framework to measure the CMS under concurrency and recommend the M5 deploy-ceiling (`MAX_CONCURRENT_DEPLOYS`).

- **Pure core:** `scripts/loadtest/harness.mjs` — bounded worker pool, percentile stats, ceiling recommendation, config parsing. Unit-proven by `tests/presence/loadtest_test.mjs` (**19/19**).
- **Runner:** `scripts/loadtest/run.mjs` — wires the core to a live target.

The core is pure (no clock beyond the timings fed to it), so results are reproducible and the framework itself is trustworthy.

---

## Modes

| Mode | Endpoint | Side effects | Use |
|---|---|---|---|
| `preview` (default) | `GET /preview?page=/` | **None** — exercises `serializeDraft` + `renderSnapshot` (the CPU-heavy path) | Safe anywhere, incl. prod. Measures render latency under concurrency. |
| `publish` | `POST /publish` | **Deploys the site** — exercises the full pipeline + the M5 ceiling | **Staging only.** Guarded: refuses a non-staging target unless `LOADTEST_ALLOW_PUBLISH=1`. |

---

## Configuration (environment)

| Var | Default | Meaning |
|---|---|---|
| `LOADTEST_TARGET` | — (required) | Function base URL, e.g. `https://wjlpursnwbmlcdwbeowv.functions.supabase.co/presence` |
| `LOADTEST_MODE` | `preview` | `preview` (safe) or `publish` (staging only) |
| `LOADTEST_LEVELS` | `1,2,4,8,12,16` | Concurrency levels to sweep |
| `LOADTEST_ITERATIONS` | `40` | Requests per level |
| `LOADTEST_P95_BUDGET_MS` | `15000` | SLO — the highest level with p95 ≤ this and zero errors is recommended |
| `LOADTEST_SITE` | — | Site id (`x-dds-scope-site`) |
| `LOADTEST_ANON` / `LOADTEST_JWT` | — | Anon key + a user JWT for authed routes |

---

## Running it

```bash
# Safe render sweep (works against any environment)
LOADTEST_TARGET="https://<ref>.functions.supabase.co/presence" \
LOADTEST_SITE="<site-uuid>" LOADTEST_ANON="<anon>" LOADTEST_JWT="<jwt>" \
deno run --allow-net --allow-env scripts/loadtest/run.mjs

# Full-pipeline sweep — STAGING ONLY (deploys)
LOADTEST_MODE=publish LOADTEST_TARGET="https://wjlpursnwbmlcdwbeowv.functions.supabase.co/presence" \
LOADTEST_SITE="<staging-site>" LOADTEST_ANON="<anon>" LOADTEST_JWT="<jwt>" \
deno run --allow-net --allow-env scripts/loadtest/run.mjs
```

Output is a per-level table (`conc · n · errors · p50 · p95 · p99 · max`) and a recommended `MAX_CONCURRENT_DEPLOYS` (the highest level within the SLO).

---

## Interpreting results → tuning the M5 ceiling

The recommendation is the **highest concurrency level that had zero errors AND p95 ≤ the budget**. Compare it to the current default (`8`):

- **Recommended ≥ 8:** the default is safe; optionally raise `MAX_CONCURRENT_DEPLOYS` toward the recommendation for more headroom.
- **Recommended < 8:** lower `MAX_CONCURRENT_DEPLOYS` to the recommendation — the platform sheds excess deploys (retryable 503) before overloading Netlify.
- The ceiling is **fail-open**, so a wrong value never blocks publishing — it only changes when load-shedding kicks in.

---

## Status

- **Framework:** ✅ built + unit-proven (19/19), deterministic, documented.
- **Live concurrency tuning:** ⏳ **owner** — requires a staging load environment with representative data. Until then, the M5 default of **8** stands (a conservative, fail-open value). This is the only load-test step that cannot be completed without owner infrastructure, per the M10 brief.
