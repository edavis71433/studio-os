# Prod migration runbook — apply 0074–0080

> **UPDATE (2026-07-11): the CLI hold-back method below does NOT work with supabase CLI v2.109.**
> Attempting it fails at the pre-flight check ("Remote migration versions not found in local
> migrations directory") — the CLI now enforces that local files match the remote history, and
> prod's history records `0000–0002, 0006–0019, 0036–0072`. Holding those back makes it refuse.
> **Nothing is applied** when this happens (it errors before touching the DB). Letting `db push`
> run WITH all files present is worse — it would try to apply the fenced `0003–0005` and re-apply
> already-live `0020–0035`/`0073`.
>
> **✅ USE THIS INSTEAD — apply the SQL directly (safe, idempotent, matches how 0020–0072 got there):**
> 1. Supabase dashboard → **prod** project (`qksstlqzbhesadrrofgn`) → **SQL Editor** → New query.
> 2. Open `docs/presence/APPLY-0074-0080-prod.sql`, copy **all** of it, paste, **Run**.
>    (It's the seven migrations concatenated in order; every statement is `create … if not exists`.)
> 3. Verify the tables (list below). Done.
>
> `psql` alternative if you prefer CLI:
> `psql "postgresql://postgres:[DB-PASSWORD]@db.qksstlqzbhesadrrofgn.supabase.co:5432/postgres" -f docs/presence/APPLY-0074-0080-prod.sql`
>
> The original hold-back steps are kept below for history only — **do not use them**.

---


**What this does:** applies the seven pending P2-C/P2-D migrations to **production** (`qksstlqzbhesadrrofgn`), waking the sales-pipeline, project-delivery, and agency-client-bridge routes that are currently dormant on prod.

**Why it's safe:**
- All seven are **purely additive** — `create table if not exists` + indexes + deny-all RLS policies. No `ALTER` on core tables, no data destruction (the `drop table` lines in the files are commented-out rollback docs).
- Because they're `if not exists`, a partial apply is **re-run-safe** — just run the push again.
- The tables they reference (clients, sites, media…) already exist on prod from earlier out-of-band migrations, so the foreign keys resolve.

**Why the hold-back:** prod's migration history only tracks through `0019`; everything `0020+` was applied out-of-band, and `0003–0005` are fenced (never apply). So a plain `db push` would choke. We hold back everything except `0074–0080` so the push applies exactly those seven, in order.

---

## Preconditions
- You're logged in: `supabase login` (or `SUPABASE_ACCESS_TOKEN` set).
- You have the **prod database password** handy (the push connects directly to the DB).

## Steps (PowerShell — copy/paste block by block)

```powershell
$CLI  = "C:\Users\edavi\Tools\supabase\supabase-go.exe"
$REF  = "qksstlqzbhesadrrofgn"                                  # PROD
$MIG  = "C:\Users\edavi\Documents\app\supabase\migrations"
$HOLD = "C:\Users\edavi\Documents\app\supabase\_migrations_hold"

# 1) Note the starting file count (write it down)
(Get-ChildItem $MIG -Filter *.sql).Count

# 2) Hold back EVERYTHING except 0074–0080
New-Item -ItemType Directory -Force $HOLD | Out-Null
Get-ChildItem $MIG -Filter *.sql |
  Where-Object { $_.Name -notmatch '^(0074|0075|0076|0077|0078|0079|0080)_' } |
  Move-Item -Destination $HOLD

# 3) Confirm exactly seven remain (0074 … 0080)
Get-ChildItem $MIG -Filter *.sql | Select-Object -ExpandProperty Name
```

```powershell
# 4) Link to PROD (prompts for the DB password the first time) and push
& $CLI link --project-ref $REF
& $CLI db push --yes
#   → expect: "Applying migration 0074…", 0075 … 0080, then "Finished".
```

```powershell
# 5) RESTORE everything — do this even if step 4 errored
Get-ChildItem $HOLD -Filter *.sql | Move-Item -Destination $MIG
Remove-Item $HOLD

# 6) Verify the count matches step 1
(Get-ChildItem $MIG -Filter *.sql).Count
```

## Verify it worked
In the Supabase dashboard (prod → Table editor) confirm these exist:
`presence_contacts, presence_deals, presence_proposals, presence_contracts` (0074) ·
`presence_projects, presence_milestones, presence_tasks, presence_project_events` (0075) ·
`presence_deliverables, presence_approvals` (0076) · `presence_messages`/comms (0077) ·
`presence_surveys, presence_support_requests` (0078) · `presence_service_links` (0079) ·
`presence_customer_agency` (0080).

## If step 4 fails partway
Because every table is `if not exists`, just re-run step 4 (`db push --yes`) — it skips what already applied and continues. Always run step 5 (restore) regardless. If it keeps failing, capture the error and stop — the additive nature means nothing existing was harmed.

## Companion step (recommended, separate)
The prod **edge function** is at your last prod deploy; the newer routes (the 8 CMS-UX projections, the Dev-Mode security hardening) are on staging. To bring prod current after the migrations:
```powershell
pwsh C:\Users\edavi\Documents\app\scripts\deploy-presence.ps1 -Env prod
```
This is backend-only and safe — no customer frontend is public until you lift the push fence.
