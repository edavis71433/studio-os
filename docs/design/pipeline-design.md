# Request-pipeline design (step 3 continued) — for review before implementation

Status: PROPOSED. Nothing here is built. Staging-only when it is. Covers the
five components Eric named: tenant resolver, revocation, durable rate limiter,
audit_log, and the isolation test suite. Production is untouched; `0003–0005`
(agency cleanup) stay held; the route-registry refactor stays on hold.

Grounding facts (from the live schema + canonical function):
- One central gate already exists at the top of `serve()` — the seam the whole
  pipeline hangs off.
- `verifyStaff(req)` already resolves `{userId, email, tenantId, role}` from
  `memberships` via the caller's JWT.
- RLS is enabled on all 65 base tables; `current_tenant_ids()` =
  `select tenant_id from memberships where user_id = auth.uid()` is the
  membership-derived tenant resolver, already in SQL.
- `tenants.state` (enum) exists as of migration 0001.
- Today the runtime mostly uses the SERVICE-ROLE key (bypasses RLS). Moving off
  that is the downstream cutover the resolver ENABLES; it is NOT part of this
  plan's build (it is its own module-by-module effort, suite-gated).

The pipeline order (Brief §3):
identity → tenant → authorization → revocation → rate limit → handler → audit

Identity + authorization already exist at the gate. This plan adds the tenant
resolver as a first-class object, then revocation, then the durable limiter,
then the audit hook — each an independent, staging-tested increment.

---

## New migrations this plan introduces (numbered AFTER 0006; 0003–0005 stay held)

- `0007_memberships_revocation` — `memberships.updated_at` (+ touch trigger).
  Enables "membership changed after token issued" revocation.
- `0008_rate_limit_state` — durable, table-backed rate-limit counters.
- `0009_audit_log` — append-only security/audit trail.

Each forward-only, reversible, applied to STAGING first, with a rollback note.
They apply after 0006; when 0003–0005 later run they are older-numbered but the
runner handles out-of-order (already proven twice).

---

## 1. Tenant resolver (the pipeline's first stage as a real object)

**What exists:** `verifyStaff` returns identity+tenant+role but only for
staff-gated routes, and handlers still reach for the service-role key.

**What to build:** one function, called once at the top of `serve()` for EVERY
request, that returns a `Principal`:

```ts
interface Principal {
  kind: 'staff' | 'client' | 'public' | 'system';
  userId: string | null;
  tenantId: string | null;          // resolved tenant (single-tenant today = DDS #1)
  role: 'owner'|'admin'|'staff'|'readonly'|'client'|null;
  jwt: string | null;               // the caller's token, for RLS-scoped reads
  requestId: string;                // minted here; threads through logs + audit
}
```

Resolution logic (deterministic, fail-closed):
- staff JWT present + membership row → `staff` with tenantId/role from
  `memberships` (this is today's `verifyStaff`, promoted to run for all routes).
- client JWT present + resolves via `my_client_ids()` → `client`, tenantId is
  the tenant owning those client rows.
- scheduler/webhook secret → `system`, tenantId null (cross-tenant system job).
- otherwise → `public`, everything null.

**What it exposes to handlers:** a `db()` helper bound to the principal that
uses the **caller's JWT + anon key** (RLS-scoped) rather than the service role.
This is the seam for the later service-role cutover — handlers migrate to
`ctx.db()` one module at a time. The resolver does not force that cutover; it
makes it possible and safe.

**Hooks in at:** the existing gate block in `serve()`. The gate keeps its
current role check (`ROUTE_MIN_ROLE` / `PUBLIC_ROUTES`); the resolver just
populates `Principal` and attaches `requestId`. Zero behavior change on day one
— it runs alongside the current checks and is consumed incrementally.

**Verification:** with the seeded staging staff + client users, assert the
resolver returns the right `kind`/`tenantId`/`role` for each identity, and
`public` for anonymous. No handler changes yet → no regression.

---

## 2. Revocation (reject suspended/closed tenants + stale memberships)

Brief §12: effect within minutes, not token expiry.

**Two checks, both at the gate, right after the resolver:**

1. **Tenant state.** If `tenants.state ∈ {suspended, closed, purge_scheduled}`
   → reject with a clear, machine-readable error (`tenant_suspended`). Reads the
   resolved tenantId (from stage 1) → one `tenants.state` lookup. `state` exists
   (0001).

2. **Membership changed after token issued.** If the caller's membership
   `updated_at` is newer than the JWT's `iat` (issued-at) → reject
   (`membership_revoked`), forcing re-auth. This catches role downgrades and
   removals within minutes. Needs `memberships.updated_at` → migration
   `0007_memberships_revocation` (column + touch trigger, mirroring the tenants
   trigger from 0001).

**Design choices to confirm:**
- Reject vs re-resolve: on a stale membership we REJECT (401 `membership_revoked`)
  rather than silently re-reading, so a downgraded user cannot keep acting on a
  cached elevated role. The client re-logs-in and gets a fresh token.
- `system` (scheduler/webhook) principals skip tenant-state revocation (they run
  cross-tenant by design) but are audited.
- Grace: none. The brief wants minutes-not-expiry; immediate rejection is the
  strict reading. (Open question for Eric: any soft-grace desired? Default: no.)

**Verification (staging):** flip the test tenant to `suspended` → its staff/client
get rejected; flip back → restored. Change a test membership's role, keep using
the old token → `membership_revoked`. All via real JWTs.

---

## 3. Durable, tenant-aware rate limiter (replaces the in-memory per-IP one)

**What exists:** `RATE_LIMITED_TYPES` + an in-memory per-IP counter — resets on
every cold start, not shared across instances, not per-tenant.

**What to build:** table-backed counters — migration `0008_rate_limit_state`:

```
rate_limit_state(
  bucket_key text,      -- e.g. 'ip:1.2.3.4:ai' or 'tenant:<uuid>:ai'
  window_start timestamptz,
  count int,
  primary key (bucket_key, window_start)
)
```

- Fixed-window counter: `bucket_key` + truncated window; atomic
  increment via an upsert RPC (`rate_hit(bucket_key, window, max) -> allowed`)
  so concurrency is correct across instances. `SECURITY DEFINER`, service-role
  invoked (system function — legitimately service-role).
- **Bucket selection by principal + rate class** (the `rateClass` from the
  route-registry design; until the registry lands we map from the existing
  `RATE_LIMITED_TYPES`):
  - public/pre-auth routes → per-IP (as today, but durable).
  - authenticated routes → per-TENANT (fair-use across a tenant's users);
    ceilings come from entitlements later (step 4) — until then a config default.
- Old-row cleanup: a tiny scheduled job (or opportunistic delete of windows
  older than N) so the table stays small. Fold into the existing
  `run_scheduled_jobs`.

**Hooks in at:** the gate's existing rate-limit check point — swap
`isRateLimited(req)` (in-memory) for `await rateHit(bucketFor(principal, type))`.
Per-IP behavior for public routes is preserved; authenticated routes gain
durable per-tenant limiting.

**Verification (staging):** hammer a rate-limited route past the ceiling → 429
after N, and (unlike today) the count SURVIVES a function redeploy/cold start
(proving durability). Two different tenants have independent buckets.

---

## 4. audit_log (append-only security trail)

Brief §12: append-only `audit_log` with actor, tenant, action, target,
timestamp, request id; security events (auth failures, permission denials)
logged with distinct event types.

**Migration `0009_audit_log`:**

```
audit_log(
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  request_id text not null,
  tenant_id uuid,                 -- resolved tenant (nullable for public/system)
  actor_user_id uuid,             -- null for anonymous
  actor_label text,               -- email or 'system'/'anon'
  event_type text not null,       -- 'action' | 'auth_failure' | 'permission_denied' | 'revoked' | 'rate_limited'
  route text,                     -- the dispatch type
  target text,                    -- affected entity id, when known
  detail jsonb not null default '{}'
)
```

- **Append-only by construction:** RLS denies UPDATE/DELETE to everyone;
  INSERT via a `SECURITY DEFINER` `audit(...)` function (service-role/system).
  Hard deletion only ever via the future retention scheduler (Brief §13).
- **Written by the pipeline**, not scattered in handlers:
  - every privileged (`ROUTE_MIN_ROLE`) request → one `action` row after the
    handler (success/failure captured in detail).
  - every gate rejection → `auth_failure` / `permission_denied` / `revoked` /
    `rate_limited` row.
- `request_id` (minted by the resolver) ties a log line to its audit row and to
  structured logs (the logging floor, Brief §13).
- **Not** the same as the existing `events`/`emit` spine (that is
  product/business events, client-visible). `audit_log` is security-grade,
  internal, append-only.

**Verification (staging):** a staff action writes exactly one `action` row with
the right tenant/actor/route/request_id; a no-JWT staff call writes one
`auth_failure`; UPDATE/DELETE on `audit_log` under any role is denied.

---

## 5. Isolation test suite (the gate for the whole tenancy effort — Brief §15)

The proof that isolation holds, run under REAL roles via REAL queries on every
deploy. This is the acceptance gate before the service-role cutover proceeds.

**Fixtures (staging):**
- Tenant A = DDS #1 (exists) with the seeded staff + client users (exist).
- Tenant B = a new test tenant + its own staff user, client user, and a small
  set of owned rows (a client, an invoice, a file row, a message) — seeded via a
  scripted setup, not by hand, so it is repeatable.

**Assertions (all via each identity's real JWT, anon key, RLS enforced):**
1. Tenant A staff CANNOT read / list / write / delete any tenant B row (per
   table that carries tenant_id) — and vice versa.
2. Tenant A client sees only its own client rows (`my_client_ids()`), never
   tenant B's, never another A-client's.
3. Storage: A cannot read/sign/list B's objects (this depends on the
   tenant-prefixed path work in Files/step 7; the suite includes the storage
   assertions now and they go green as that lands).
4. Pipeline contract: unauthenticated → 401; wrong-role → 403;
   suspended-tenant → rejected; revoked-membership → rejected — each with the
   correct machine-readable error code.

**Form:** a runnable script (Deno test or a shell+curl harness in
`tests/isolation/`) that seeds, asserts, and tears down; exit non-zero on any
cross-tenant leak. Wired into CI to run against staging before any deploy.

**Why it comes early:** it is the safety net for the service-role → caller-JWT
cutover. We stand it up, prove it passes against today's RLS, THEN convert
handlers module-by-module with the suite catching any regression.

---

## Proposed build sequence on staging (each step reviewed/committed separately)

1. `0007` migration (memberships.updated_at) → staging → verify.
2. Resolver object + `requestId`, wired at the gate as ADDITIVE (no handler
   changes) → deploy staging → resolver-return tests green, no regression.
3. Revocation checks (tenant state + stale membership) at the gate → staging →
   suspend/role-change tests green.
4. `0008` + durable limiter, swap in at the gate → staging → durability + per
   tenant tests green.
5. `0009` + audit hook in the pipeline → staging → audit-row tests green.
6. Isolation suite fixtures + assertions in `tests/isolation/` → run green on
   staging.
7. (Separately, later) begin the service-role cutover module-by-module, each
   gated by the suite.

Steps 1–6 are the "pipeline + isolation" deliverable. Step 7 is the larger
downstream effort this all enables.

---

## Risks / open questions for Eric

- **Revocation strictness:** immediate reject on stale membership (no grace) —
  confirm, or specify a soft window.
- **Per-tenant rate ceilings:** a config default now, entitlements-driven later
  (step 4). Confirm the interim default (e.g. current per-IP numbers reused).
- **audit_log volume:** every privileged request writes a row. Fine at current
  scale; the retention scheduler (step 8) handles growth. Confirm that's
  acceptable interim.
- **Resolver is additive first:** it does NOT flip handlers off service-role in
  this plan. That cutover is deliberately separate and suite-gated. Confirm you
  want the resolver landed as a seam first (recommended) rather than bundled
  with the cutover.
- Everything is staging-only until you approve a production promotion, exactly
  like the last one.

---

## Decisions — locked by Eric, 2026-07-05

1. Revocation: immediate reject on stale membership. No grace period.
2. Interim rate ceilings: reuse the current per-IP numbers until entitlements (step 4).
3. audit_log: one row per privileged request accepted at current scale; retention later.
4. Resolver lands additive-first as a seam; NO handler cutover in this phase.

Execution constraints reaffirmed: staging only; production untouched; 0003–0005
held; service-role cutover not started.

---

## Build log

- **0007_memberships_revocation — APPLIED TO STAGING 2026-07-05.** memberships.updated_at
  added, backfilled to created_at (verified identical: 19:02:01.903521 both), touch
  trigger advances on UPDATE (→ 20:57:32 on PATCH). Ledger 0007 applied; 0003–0005
  pending. Function unregressed. Production untouched.
  Next: tenant resolver (additive seam) — pending Eric's go.
