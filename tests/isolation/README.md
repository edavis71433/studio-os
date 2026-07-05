# Tenant isolation suite

The acceptance gate for the tenancy work (Build Brief §15). Proves, with REAL
JWTs and RLS-enforced queries, that tenants cannot reach each other's data and
that the request pipeline contract holds. **Must be green before the
service-role → caller-JWT cutover proceeds**, and re-run on every deploy.

## What it asserts (22 checks)

- **Staff cross-tenant (RLS, JWT + anon key):** tenant A staff cannot read /
  insert / update / delete tenant B rows, and vice versa; each staff user still
  sees its own tenant (sanity).
- **Client-scoped (RLS):** a client sees only its own client's rows
  (`my_client_ids`); no cross-tenant invoice access.
- **Role:** client users are rejected from staff-gated routes.
- **Pipeline contract (edge function):** missing token → 401; insufficient role
  → 403; suspended tenant → 403 `tenant_suspended`; stale/revoked membership →
  401 `membership_revoked`; over-limit → 429.
- **Audit:** a rejection writes exactly one `audit_log` row with the correct
  `event_type`, `route`, and a valid uuid `request_id`.
- **Rate buckets:** staff routes use a `t:<tenant>` bucket; public routes use an
  `ip:<addr>` bucket.

## Design

Self-contained and additive. It creates its OWN fixtures — a second tenant B
plus a fresh staff and client user in each of tenant A and tenant B, with owned
client/invoice rows — runs the assertions under those users' real JWTs, then
tears everything down. It changes NO application code and touches only its own
test rows (all tagged with a per-run marker). Staging only.

Isolation is tested at the RLS layer (anon key + each caller's JWT), because RLS
is the real enforcement mechanism. The edge function's own service-role data
path is NOT what this proves — this proves the isolation the service-role cutover
will rely on.

## Running (secrets via env — never commit them)

```
export STAGING_URL="https://<staging-ref>.supabase.co"
export ANON_KEY="<staging anon key>"
export SERVICE_KEY="<staging service_role key>"   # needed to seed/teardown fixtures
deno run --allow-net --allow-env tests/isolation/isolation_test.ts
```

Exit code 0 = all passed; 1 = a failure (names printed); 2 = missing env.
Never run against production — it creates and deletes auth users, tenants, and
rows. `SERVICE_KEY` must be the STAGING service_role key.

## Last run

2026-07-05: **22/22 passed** on staging (`wjlpursnwbmlcdwbeowv`). Fixtures torn
down clean; smoke matrix green; production untouched.

## Next (not part of this suite)

This suite is the gate for the service-role → caller-JWT cutover: convert
handlers to RLS-scoped reads module-by-module, re-running this suite green after
each module. The suite will also gain storage-path assertions when the Files
module (step 7) lands tenant-prefixed paths.
