# Production baseline — 2026-07-05

The definitive record of what is live in production after the step-2 safety
fixes and the step-3 tenancy migrations `0001/0002/0006`. This is the clean
starting point for the pipeline work (step 3 continued).

Git tag: `prod-baseline-2026-07-05` at commit `48590d7`.

## What is live

| Layer | State |
|---|---|
| `clever-api` function | **v249** — verified byte-for-byte identical to `supabase/functions/clever-api/index.ts` (sha256 `f4cf0494…`) via `functions download` |
| `stripe-webhook` function | v13 — unchanged (not part of this promotion) |
| Migration ledger | `0000,0001,0002,0006` applied; `0003,0004,0005` pending (held) |
| Frontend (admin) | `dds-studio-manage-9k2p.html` with the `notify()` JWT change, live at **studio-os-dds.netlify.app** (hash-matched to repo) |
| Frontend (portal + public site) | still live at **davisdigitalstudio.com** (CORS preserved) |
| `ALLOWED_ORIGINS` secret | `studio-os-dds.netlify.app, davisdigitalstudio.com, www.davisdigitalstudio.com` |
| Restore point (backup) | 2026-07-05 17:11:31 UTC |

## What is live BEHAVIORALLY (the shipped safety fixes)

- Notify catch-all bypass CLOSED — an unregistered `type` with a notify-shaped
  body now 403s instead of driving the email relay.
- `invoice_reminder` / `approval_needed` are STAFF-GATED — 401 without a valid
  staff JWT (were public).
- Four public intake routes (`lead_intake`, `discovery_intake`, `audit_lead`,
  `report_card`) are rate-limited.
- CORS is env-driven (`ALLOWED_ORIGINS`); hardcoded prod-URL fallback removed.
- `tenants` enriched: lifecycle `state` enum (default `active`), `plan`,
  `brand`, `owner_email`, `updated_at` (auto-trigger), `deleted_at`. DDS tenant
  backfilled from the real `agencies` row (plan=founder, owner_email set).
- `email_templates` RLS hole closed — tenant-scoped policy + `tenant_id` column;
  clients can no longer read/write staff templates.

## Production validation — 2026-07-05 (all green)

Automated (7/7):
- version → build `2026-07-04.11`
- unknown type → 403; injected notify-shape → 403
- `invoice_reminder` / `approval_needed` without JWT → 401
- CORS echoes both `studio-os-dds.netlify.app` and `davisdigitalstudio.com`
- portal.html serves 200

Manual, app-driven with Eric's real session (3/3):
1. Admin panel at studio-os-dds.netlify.app loads with real data, no auth errors
   — proves the real prod membership + session JWT authenticate through the
   staff gate (the same lineup `invoice_reminder` uses).
2. Email Templates section loads (12 real templates) and a save succeeds — `0006`
   tenant-scoped policy intact for staff; no RLS diagnostic box.
3. Client portal login loads normally with client data across tabs — no
   client-facing regression.

Baseline proof: deployed function sha256 == repo canonical sha256
(`f4cf0494cefe2f23ad06e26754c2d32a`).

## NOT in production (deliberately held)

- Migrations `0003_org_scope_converge`, `0004_drop_agency_columns`,
  `0005_drop_agencies_table` — gated on Eric's prod
  `select id,slug,name,plan from agencies;` + confirmation no external scripts
  read `agencies`/`agency_id`.
- Route-registry refactor — approved as approach, on hold until tenancy
  pipeline work begins (or if it becomes a blocker).
- `admins` table drop — commented out in `0006`; not run.

## Operational notes for the next session

- The Supabase CLI is currently linked to PRODUCTION (`qksstlqzbhesadrrofgn`).
  Before any STAGING work, re-link staging (`supabase link --project-ref
  wjlpursnwbmlcdwbeowv`, needs the staging DB password).
- Rollback anchors: function → commit `5b048b7`; migrations → inline ROLLBACK
  blocks; admin panel → commit `f39cdad`.
- Known non-fatal: `supabase` CLI intermittently segfaults on `projects
  api-keys` / `functions list`; retry loops handle it.
