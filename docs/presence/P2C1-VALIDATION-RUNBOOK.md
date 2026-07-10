# P2-C1 — Validation Runbook (turnkey)

**Purpose:** everything needed to validate the Lead/CRM/Opportunity/Pipeline foundation the moment migration `0074` is applied — so the team *executes*, not plans. Order is fixed (prove-first): **1 → 2 → 3 → 4 → 5**. No optimization until all five pass (see `P2C-FOUNDATION-FIRST-SPLIT.md`).

**Frozen model under test:** a lead and an opportunity are ONE `presence_deals` record, differentiated by `stage`; history in `presence_deal_events`. No separate tables, no sync.

---

## Step 1 — [OWNER] Apply migration `0074` (the gate)
Nothing below runs until this is done. Paste `supabase/migrations/0074_p2c_sales_lifecycle.sql` into the Supabase SQL editor for **staging** first, then **prod**:
- Staging → `https://supabase.com/dashboard/project/wjlpursnwbmlcdwbeowv/sql/new`
- Prod → `https://supabase.com/dashboard/project/qksstlqzbhesadrrofgn/sql/new`

**Verify it landed** (same editor):
```sql
select to_regclass('public.presence_contacts')     as contacts,
       to_regclass('public.presence_deals')         as deals,
       to_regclass('public.presence_deal_events')   as deal_events,
       to_regclass('public.presence_proposals')     as proposals,
       to_regclass('public.presence_contracts')     as contracts;
```
All five non-null = applied. (The migration is idempotent — safe to re-run.)

---

## Steps 2–3 — [AUTOMATED] Runtime + tenant isolation on staging
Set the staging creds, then run **one command**:
```bash
export SALES_E2E_TARGET="https://wjlpursnwbmlcdwbeowv.functions.supabase.co/presence"
export SALES_E2E_ANON="<staging anon key>"
export SALES_E2E_JWT="<operator-A session JWT>"          # a workspace with the relationship edition
export SALES_E2E_SITE="<operator-A site uuid (x-dds-scope-site), or blank for own site>"
export SALES_E2E_JWT2="<operator-B session JWT>"          # a DIFFERENT workspace (for step 3)
export SALES_E2E_SITE2="<operator-B site uuid>"

deno run --allow-read --allow-env --allow-run --allow-net scripts/validate-p2c1.mjs
```
- **Step 2** runs `sales_foundation_e2e` — new lead · contact dedupe · search · filter · pagination · update · lead→opportunity stage advance · invalid-move rejection · activity history.
- **Step 3** runs `sales_tenant_isolation_e2e` — workspace B provably cannot read/update/move/attach-to workspace A's contacts or deals, and A's records never appear in B's lists.

The runner prints a gate-status board. **Green on both = steps 2–3 done.** (Without creds the live steps skip and the runner tells you exactly which env vars are missing.)

*Getting an operator JWT:* sign in at the staging portal in a browser, then from devtools run
`JSON.parse(localStorage.getItem('sb-wjlpursnwbmlcdwbeowv-auth-token')).access_token` (or read the `dds-portal-auth` session). Use two different accounts for A and B.

---

## Step 4 — [HUMAN] Browser / mobile / accessibility QA
Do this in a staging browser after step 1. Check each item on the three surfaces.

### `pipeline.html` (Studio App → Customers → Pipeline)
- [ ] Loads on the shell (top bar, ⌘K, account menu present); no console errors.
- [ ] **New deal** dialog: opens, title required, creates a deal, appears in the list.
- [ ] Stage filter chips switch the list; **only valid next-stage buttons** show in a deal.
- [ ] Deal detail: contact shown; add proposal / add agreement forms open inline (no `prompt()`); stage move works; convert shows the plan picker (P2-C2 — don't exercise convert here).
- [ ] Empty state (no deals), loading skeleton, and error state (kill network) all render.
- [ ] **Deep link** `?deal=<id>` opens that deal directly.

### `leads.html` (Studio App → Inbox/Messages)
- [ ] Form submissions list; **"→ Deal"** promotes an inquiry into a pipeline deal and lands you in `pipeline.html?deal=…` (no re-typing).
- [ ] Reply/Call, Mark-read, Archive still work.

### `crm.html` (Studio App → Customers)
- [ ] Timeline + notes render; a new lead's form submission appears in the timeline.

### Accessibility (WCAG 2.2 AA) — on each page
- [ ] **Keyboard only**: every action reachable via Tab/Enter/Space; visible focus ring throughout.
- [ ] Dialogs trap focus and close on Esc; focus returns sensibly.
- [ ] Screen reader (VoiceOver/NVDA): buttons/inputs have labels; the list updates announce (`aria-live`).
- [ ] Color contrast holds in **light and dark** themes.

### Mobile (real device or emulator, ≤ 400px wide)
- [ ] No horizontal page scroll; cards/dialogs/forms fit and are tappable.
- [ ] The shell mobile drawer opens; nav works.

Record pass/fail + any defects inline in this file (or a linked issue).

---

## Step 5 — [THEN] Confirm the architecture is stable
Only after 1–4:
- [ ] No schema change was needed after live testing (the frozen model held).
- [ ] No route/contract change was needed.
- [ ] Any defects from step 4 are either fixed (behavior-preserving) or logged as post-validation optimizations — **not** model changes.

When all five hold, **P2-C1 is production-quality.** Then — and only then — pick up the deferred optimizations (lead-dedup, CRM↔Pipeline link, polish) and, separately, the P2-C2 review.

---

## Quick reference — what's ready right now (pre-`0074`)
| Asset | Purpose | Status |
|---|---|---|
| `scripts/validate-p2c1.mjs` | one-command validation runner + gate board | ✅ ready |
| `tests/presence/sales_foundation_e2e_test.mjs` | step-2 runtime proof (foundation only) | ✅ ready (skips w/o creds) |
| `tests/presence/sales_tenant_isolation_e2e_test.mjs` | step-3 live two-tenant isolation | ✅ ready (skips w/o creds) |
| `tests/presence/sales_lifecycle_test.mjs` · `sales_routes_test.mjs` | pure + structural (always green) | ✅ 33/33 · 44/44 |
| this runbook (step 4 checklist) | human QA, turnkey | ✅ ready |
| migration `0074` | creates the 5 tables | ⏳ **owner apply = the only blocker** |
