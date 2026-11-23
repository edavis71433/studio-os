# Presence CMS — Disaster Recovery Runbook (Phase 1 · M10)

Everything recoverable that engineering can complete is complete and verified. The **live restore drill + PITR enablement** are the only owner prerequisites — clearly marked ⏳.

**Verification tool:** `deno run --allow-read scripts/dr-verify.mjs` — inventories the recoverable artifacts and prints a readiness checklist.

**Last verification (Jul 9 2026):** 74 migrations (`0000…0073`), **no numbering gaps, no duplicates**, M4 `0073` present. **Engineering-side DR readiness: ✅ complete.**

---

## What has to survive a disaster

| Asset | Recovery source | Owner of recovery |
|---|---|---|
| **Database** (54 tables, all tenant data, snapshots, publishes, media rows) | Supabase automated backups + **PITR** (point-in-time) | Supabase-managed; owner enables PITR |
| **Schema** | `supabase/migrations/0000…0073` — ordered, gap-free, re-runnable | Engineering (verified) |
| **Edge functions** (`presence`, `clever-api`, `stripe-webhook`) | Git — no build step; `functions deploy` re-creates them | Engineering |
| **Media objects** | Supabase Storage (`presence-media`, private bucket) — covered by project backups | Supabase-managed |
| **Published live sites** | Netlify content-addressed deploys — **self-contained** (baked variants); a DB loss does NOT take live sites down | Netlify-managed |
| **Secrets** | Owner's records + the activation dashboard (`/system/health`) inventory | Owner |

**Key resilience property:** published sites are baked into Netlify deploys and never read Supabase at request time, so a database incident degrades the *editor/publish* path, **not** customers' live websites.

---

## Recovery objectives (targets)

- **RPO (data-loss window):** with PITR enabled → seconds–minutes; with daily backups only → up to 24h. *This is why PITR is the launch prerequisite.*
- **RTO (time-to-restore):** database restore (Supabase-managed, typically minutes–hours by size) + function redeploy (minutes) + secret re-set if a new project (minutes).

---

## Recovery procedures

### A. Point-in-time / backup restore (database)
1. Supabase Dashboard → project → **Database → Backups** (or **PITR**).
2. Choose the restore point (PITR: a timestamp *before* the incident; backups: the latest good daily). **Restoring to a point before a migration was applied re-opens that migration** — re-apply any migrations dated after the restore point (they are all in `supabase/migrations`).
3. Wait for completion; confirm the dashboard reports success.

### B. Function recovery
```
C:/Users/edavi/Tools/supabase/supabase-go.exe functions deploy presence     --no-verify-jwt --project-ref <ref>
C:/Users/edavi/Tools/supabase/supabase-go.exe functions deploy clever-api    --no-verify-jwt --project-ref <ref>
C:/Users/edavi/Tools/supabase/supabase-go.exe functions deploy stripe-webhook --no-verify-jwt --project-ref <ref>
```

### C. Migration recovery (into a fresh or rolled-back DB)
Apply `supabase/migrations` in filename order (`0000…0073`). The set is verified gap-free and duplicate-free. **Migration `0073` (M4 idempotency) must be present** for publish idempotency.

### D. Secret recovery
Re-set the environment from the owner's records; verify with `GET /system/health` → `capabilities` all true. Secrets are project-wide (one set covers all three functions).

---

## Post-restore verification (do every time)
1. `deno run --allow-read scripts/dr-verify.mjs` → migrations clean.
2. `GET /system/health` → `db_ok:true`, `capabilities` all true.
3. `POST /system/run` (scheduler secret) → response has `reconcile`/`media_gc`/`snapshot_gc`.
4. Load one customer site's editor + do a preview render → renders correctly.
5. One publish on a **test** site → reaches `live`.

---

## Owner prerequisites (⏳ — cannot be completed by engineering)
- **Enable PITR on prod** — the dated decision; the week the first customers start paying. Until then RPO is the daily-backup window.
- **Confirm backups are enabled** on prod (dashboard).
- **Run the live restore drill on staging** — pick a restore point, restore, run the post-restore verification above, confirm success. This is the one step that proves the runbook end-to-end; do it after a backup that includes the current (Jul 2026) state so the drill can't regress the cron/migrations.

Engineering has completed the runbook, the procedures, and the verification tooling; the live drill is intentionally owner-owned because it operates on production infrastructure.
