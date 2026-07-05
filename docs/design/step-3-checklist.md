# Step 3 (tenancy) — checklist

Staging-only until Eric approves each production move. Migrations are
forward-only, reversible, staging-first.

## Migrations (files written; apply status)

| File | Purpose | Staging | Production | Gate |
|---|---|---|---|---|
| `0001_tenants_enrich` | add lifecycle `state` enum + plan/brand/owner_email/updated_at/deleted_at + touch trigger | ✅ applied 2026-07-05 | ⛔ hold | — |
| `0002_agency_attr_backfill` | copy agencies.{plan,brand,owner_email} → tenants | ⏸ pending (awaiting review) | ⛔ hold | — |
| `0003_org_scope_converge` | drop organizations.agency_id, keep tenant_id | ⏸ pending | ⛔ hold | per-row agency_id=tenant_id |
| `0004_drop_agency_columns` | drop agency_id from 18 tables | ⏸ pending | ⛔ hold | per-table agency_id=tenant_id |
| `0005_drop_agencies_table` | drop agencies | ⏸ pending | ⛔ hold | **Eric: `select id,slug,name,plan from agencies;` on prod + confirm no external readers** + row-count ≤ 1 |
| `0006_rls_holes` | tenant-scope email_templates; (optional) drop unused admins | ⏸ pending (prepared, do NOT run yet) | ⛔ hold | — |

## 0001 staging result (applied 2026-07-05)

`tenants` row after apply:
```
id=00000000-0000-0000-0000-000000000001  name="Davis Digital Studio"  slug="dds"
state="active"   plan=null   brand={}   owner_email=null
created_at=2026-07-05T19:02:01Z   updated_at=<auto>   deleted_at=null
```
Verified: `state` enum defaults to `active`; `updated_at` trigger advances on
UPDATE (PATCH test: 19:17:50 → 19:20:42); migration ledger shows
`0000, 0001` applied, `0002–0006` pending; function unregressed
(`{"type":"version"}` → build 2026-07-04.11, staff `whoami` → 200).

## Pipeline stages (after migrations, on staging)

- [ ] Pipeline resolver exposes RLS-scoped client (anon+JWT) to handlers
- [ ] Revocation: reject suspended/closed tenant + membership-changed-after-iat
      (needs `tenants.state` [done in 0001] + `memberships.updated_at` [new mig])
- [ ] Durable tenant-aware rate limiter (`rate_limit_state` table; rateClass from
      route-registry; ceilings from entitlements/step 4)
- [ ] Append-only `audit_log` + pipeline audit hook

## Service-role → caller-JWT cutover (module by module, suite-gated)

- [ ] Isolation test suite stood up (tenant A=DDS, tenant B=test; staff+client
      users each; owned rows/files) — the GATE, run under real JWTs
- [ ] Convert reads before writes, one module per PR, suite green each time
- [ ] Service role retained only for audited system jobs

## Standing rules

- No production migration until Eric approves the staged run of that migration.
- `agencies`/`agency_id` drops (0004, 0005) blocked on Eric's prod query +
  external-reader confirmation (plan §8).
- 0006 prepared but NOT run pending review.
- Paired email-relay fix stays staging-only until Eric approves prod deploy
  (deploy order: admin panel to Netlify BEFORE the function).
