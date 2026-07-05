# Step 3 (tenancy) — checklist

Staging-only until Eric approves each production move. Migrations are
forward-only, reversible, staging-first.

## Migrations (files written; apply status)

| File | Purpose | Staging | Production | Gate |
|---|---|---|---|---|
| `0001_tenants_enrich` | add lifecycle state + attrs + trigger | ✅ staging | ✅ PROD 2026-07-05 | — |
| `0002_agency_attr_backfill` | copy agencies attrs -> tenants | ✅ staging | ✅ PROD 2026-07-05 | — |
| `0003_org_scope_converge` | drop organizations.agency_id, keep tenant_id | ⏸ pending | ⛔ hold | per-row agency_id=tenant_id |
| `0004_drop_agency_columns` | drop agency_id from 18 tables | ⏸ pending | ⛔ hold | per-table agency_id=tenant_id |
| `0005_drop_agencies_table` | drop agencies | ⏸ pending | ⛔ hold | **Eric: `select id,slug,name,plan from agencies;` on prod + confirm no external readers** + row-count ≤ 1 |
| `0006_rls_holes` | tenant-scope email_templates (admins NOT dropped) | ✅ staging | ✅ PROD 2026-07-05 | — |

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

## 0002 staging result (applied 2026-07-05)

Staging `agencies` was empty (schema-only baseline), so a representative row was
seeded to exercise the copy (mirrors the prod DDS agency). Result:
```
BEFORE: tenants.plan=null   brand={}   owner_email=null
AFTER:  tenants.plan=founder brand={"name":"Davis Digital Studio","primary":"#5b3fa0"}
        owner_email=eric@davisdigitalstudio.com
```
Idempotency proven empirically: hand-set `plan='MANUALLY_SET_professional'`, re-ran
the 0002 body via a throwaway probe migration → value UNCHANGED (`coalesce`
preserves existing; `brand` only fills when `= '{}'`). Probe removed from the
ledger (`migration repair --status reverted`) and deleted. Ledger: `0000,0001,0002`
applied; `0003–0006` pending. Function unregressed (build 2026-07-04.11, staff
whoami 200).

Staging seed note: a test `agencies` row now exists on staging (id = DDS uuid).
Harmless — 0005's row-count≤1 gate still passes; it will be dropped by 0005 when
that runs on staging.

## 0006 staging result (applied 2026-07-05 — email_templates only)

Closes the `email_templates` hole (`authenticated USING(true)` let any logged-in
CLIENT read/write all staff templates). Adds `tenant_id` (default DDS, FK to
tenants, backfilled) and replaces the open policy with
`tenant_id IN current_tenant_ids()`. Access matrix, verified with real JWTs:

| Identity | read (before) | read (after) | write (after) |
|---|---|---|---|
| Client (no membership) | 200, sees rows | **[] (locked out)** | **403** |
| Staff (member of tenant #1) | 200 | 200, sees tenant rows | **201** |
| Service role (system) | full | full (RLS bypass) | full |

`tenant_id` backfilled to DDS on all rows. Function unregressed. The `admins`
optional drop remains COMMENTED in 0006 (Eric: do not drop yet).

### ⚠ Ledger is intentionally OUT OF ORDER
0006 was applied ahead of 0003–0005 (which are held for the agency-cleanup
gate). Remote ledger: `0000,0001,0002,0006` applied; `0003,0004,0005` pending.
When 0003–0005 are later applied (after Eric's prod agencies check), the runner
will apply them even though they are numbered below the already-applied 0006;
`supabase db push` may print an "older than latest remote" note but still
applies them. This is expected and safe — the three are independent of 0006.

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

## Isolation test suite — GREEN 2026-07-05 (staging)
tests/isolation/isolation_test.ts + README. Self-contained: seeds tenant B +
staff/client users in A and B with owned rows, asserts via real JWTs, tears down.
22/22 passed: staff cross-tenant read/insert/update/delete blocked both
directions; client-scoped invoice isolation; clients rejected from staff routes;
pipeline contract (401 / 403 / 403 tenant_suspended / 401 membership_revoked /
429); audit row per rejection with valid uuid request_id; rate buckets tenant vs
IP scoped. Teardown clean; smoke green; PROD untouched (v249); 0003-0005 held; no
handler cutover; no app code changed. This is the acceptance gate for the
service-role -> caller-JWT cutover.
