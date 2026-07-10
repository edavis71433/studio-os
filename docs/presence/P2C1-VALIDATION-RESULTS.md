# P2-C1 — Validation Results (evidence)

**Run:** 2026-07-10, live against **staging** (`wjlpursnwbmlcdwbeowv`). **Frozen model under test:** lead+opportunity = one `presence_deals` by stage.

## Automated gate: ✅ PASSED (steps 1–3)
| Step | Check | Result |
|---|---|---|
| — | Data model + rules (pure) | ✅ `sales_lifecycle` 33/33 |
| — | API tenant/idempotency/integrity (structural) | ✅ `sales_routes` 44/44 |
| **1** | Migration `0074` + schema available on staging | ✅ applied + verified (see finding below) |
| **2** | Foundation runtime e2e on staging | ✅ `sales_foundation_e2e` **16/16** |
| **3** | Tenant isolation, two live workspaces | ✅ `sales_tenant_isolation_e2e` **8/8** |
| **4** | Browser / mobile / accessibility QA | ⏳ **HUMAN — pending** (accounts prepared below) |
| **5** | Architecture confirmed stable | ⏳ after step 4 |

Re-run anytime: `source <staging creds>; deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-p2c1.mjs`.

## Step 1 — a real finding
The service-role probe returned `PGRST205` and a raw `to_regclass('public.presence_deals')` returned **NULL** — i.e. **migration `0074` had NOT actually been applied to staging** despite being reported as applied. Validation caught it. It was then applied to **staging only** via the Management API (`supabase db query -f 0074… --linked`; idempotent DDL), the PostgREST cache reloaded (`notify pgrst, 'reload schema'`), and all five tables verified present + REST-visible. **Prod (`qksstlqzbhesadrrofgn`) still does NOT have `0074`** — that remains the owner's launch-time apply.

## Step 2 — foundation runtime (16/16), what it proved on live staging
new lead created (stage=lead) · contact created · **duplicate contact by email de-duplicated** (same id) · contact search · lead search (title) · pipeline filter by stage · pagination (limit echoed, ≤1) · lead update persists · **bad `expected_close` → 422 (not a 502)** · lead→qualified→proposal **stage advance on the SAME `presence_deals` row** (the frozen unified model, holding under real use) · invalid move refused (won is convert-only) · non-adjacent jump refused (bounded ladder) · activity history records created + stage changes · deal detail carries the contact · foreign id not reachable.

## Step 3 — tenant isolation (8/8), live two-workspace
Workspace A created a contact + deal; workspace **B (different account) could NOT** read / update / move-stage / attach-a-proposal-to A's deal (all **404**), and A's contact/deal **never appeared** in B's lists. Control: A can still read its own. **No cross-tenant leakage.**

## Setup fix baked into the runbook (so it can't recur)
The first live run failed 3/16 — a **test-setup** error, not a product defect: `SALES_E2E_SITE` was set to the workspace's own `site_id`. Sending `x-dds-scope-site` for your **own** site triggers the **agency drill-in** path (`resolveScopedSite`), which a solo owner isn't authorized for → the request is denied. **For a solo owner the scope header must be BLANK** (then `resolveSite(jwt)` finds their own site). With it blanked, the gate went 16/16 + 8/8. The runbook now states this explicitly. *(Product note, not a defect: the scope header is by design the agency operator's drill-in mechanism; a solo owner simply omits it.)*

## Human QA (step 4) — prepared accounts + URLs
Two real, provisioned **Business OS** (relationship-enabled) trial workspaces on staging (created during validation; keep them for QA):

| | Studio A | Studio B |
|---|---|---|
| Email | `e2e-a-1783662060@example.com` | `e2e-b-1783662060@example.com` |
| Password | `Valid1234pass` | `Valid1234pass` |
| Site id | `f2f812a8-d9df-4538-96e7-ec1e9ce98f19` | `30ba9361-6808-434b-a039-292e253c3c99` |
| Function | `https://wjlpursnwbmlcdwbeowv.functions.supabase.co/presence` | same |

**⚠️ Serving caveat (honest):** the app pages (`pipeline.html`, `leads.html`, `crm.html`) hardcode the **prod** Supabase URL + anon key and are **committed-local (unpushed) per the fence** — so opening them in a browser talks to **prod**, which does **not** have `0074`. To do the human QA against the validated staging schema, either:
1. **Local serve pointed at staging** — serve the repo locally and temporarily swap the hardcoded `SUPABASE_URL`/anon in those three pages to the staging values (revert after), **or**
2. **QA against prod** — apply `0074` to prod (owner launch step) and run the pages against prod with a prod Business-OS account.

Until one of those is done, the human browser/mobile/AT checklist (runbook §Step 4) **cannot be executed**, and **must not be marked passed.**

## Human QA — status at exit review (2026-07-10)
An exit review was requested on the basis that the human QA "has been completed." **On inspection, no human QA results are recorded anywhere:** `P2C1-HUMAN-QA-PACKAGE.md` still holds the blank checklist (no pass/fail marks), the git working tree is clean, there are no new commits, and no results file exists. The staging serve harness + accounts are confirmed **ready to execute** (verified: pages serve 200 pointed at staging, a test account signs in fresh, `/sales/deals` returns 200), but the checklist itself has **not been run and recorded**.

| Category | Result |
|---|---|
| Browser (desktop) | **NOT RECORDED** — cannot mark passed |
| Mobile | **NOT RECORDED** — cannot mark passed |
| Keyboard-only | **NOT RECORDED** — cannot mark passed |
| Screen-reader | **NOT RECORDED** — cannot mark passed |

Per the milestone rule ("do not mark a category passed unless it was actually tested") and §4 ("if a required gate remains incomplete, keep P2-C1 active, record the exact remaining blocker"), the human-QA gate stays **OPEN**. To close it: run the checklist in `P2C1-HUMAN-QA-PACKAGE.md` and paste/record the row-by-row pass/fail (a human or a browser-capable agent) — I'll then record it and close the gate immediately.

## Status summary (honest)
- **Automated validation: PASSED** (backend foundation 16/16 + live tenant isolation 8/8).
- **Human QA (browser/mobile/keyboard/screen-reader): NOT RECORDED** → gate OPEN.
- **P2-C1: NOT complete.** Waiting solely on recorded human-QA results.
