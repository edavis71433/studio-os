# Tenancy reconciliation plan (step 3) — for review before ANY migration runs

Status: PROPOSED. No migration in here has been run. Per Eric's standing rule,
this plan is to be reviewed and approved before execution. Revocation, durable
tenant-aware rate limiting, and audit hooks are folded in because they depend on
tenancy.

Evidence base: the frozen `0000_baseline.sql` (78 relations, 65 base tables, 65
RLS enables, 106 policies) + the canonical `clever-api/index.ts` + live probes
on staging (2026-07-05).

---

## 1. What the schema actually shows (measured, not assumed)

**Three tenant-shaped tables exist, but only one is live:**

| Table | Columns | Runtime refs | RLS refs | FK status | Verdict |
|---|---|---|---|---|---|
| `tenants` | id, name, slug, created_at | **yes** (memberships, verifyStaff) | **27 policies** | validated | **CANONICAL** |
| `agencies` | id, slug, name, owner_email, brand jsonb, plan | **0** | **0** | mostly `NOT VALID` | DEAD scaffolding (first attempt) |
| `organizations` | id, name, website, city, industry, + BOTH agency_id & tenant_id | 0 (allowlist only) | 0 | validated | CRM axis, NOT tenancy |

- ~32 business tables carry `tenant_id` (FK → tenants, validated).
- ~19 of those ALSO carry `agency_id` (FK → agencies, `NOT VALID`, unused).
- `contacts`/`leads`/`work_log` carry `org_id` (FK → organizations) — a
  client-company grouping, orthogonal to tenant isolation.
- Everything defaults to `00000000-0000-0000-0000-000000000001` (DDS = tenant #1).

**The isolation mechanism already exists in SQL** (this is the big finding):

```sql
-- the SharedSchema TenancyProvider, already implemented as a SECURITY DEFINER fn:
current_tenant_ids()  ->  select tenant_id from memberships where user_id = auth.uid()
current_client_ids()  ->  clients where lower(email) = lower(jwt email)
my_client_ids()       ->  clients linked via contact.auth_user_id or email/contact_email
```

Staff RLS policies read `tenant_id IN (select current_tenant_ids())`; client
policies read `client_id IN (select my_client_ids())`. RLS is ENABLED on all 65
base tables.

**Why the audit still called isolation "not enforced":** the edge function does
almost all data access with the **service-role key**, which *bypasses RLS
entirely* (161 service-role call sites vs 4 anon/JWT). So the correct policies
are **dormant on the main data path**. This is the single most important fact
for step 3: we are not building isolation, we are **stopping the runtime from
bypassing the isolation that already exists.**

**Two permissive RLS holes found:**
- `email_templates`: `authenticated USING (true) WITH CHECK (true)` — any logged-in
  user (incl. any client) has full access. Must be tenant-scoped.
- `admins`: `service_role USING (true)` — table is otherwise unused by runtime
  (the admins concept was deleted); drop-candidate.

---

## 2. Decisions proposed

1. **`tenants` is the canonical tenant.** It is already the live axis; runtime,
   RLS, and validated FKs all use it. `TenancyProvider` = `current_tenant_ids()`
   plus the pipeline resolver (below). SharedSchema is the implementation.
2. **`agencies` and every `agency_id` column are deprecated and removed** — after
   preserving intent. `agencies` holds three attributes `tenants` lacks and the
   platform will need: `plan` (→ entitlements, step 4), `brand` (→ white-label
   seam, deferred), `owner_email` (→ tenant owner). Migrate those onto an
   enriched `tenants`, confirm `agencies` has ≤1 row (the DDS row), then drop.
3. **`organizations` stays** as a CRM grouping of client companies. It is not a
   tenant boundary. Converge its scoping column to `tenant_id`, drop its
   redundant `agency_id`. Low priority; off the isolation critical path.
4. **Keep `member_role`** enum (owner/admin/staff/readonly) — already matches the
   brief's RBAC.
5. **`emit` RPC**: its `p_agency` parameter is a misnomer — callers pass the
   tenant UUID (`DDS_AGENCY = TENANT_ID`). Rename to `p_tenant` in a later,
   backward-compatible migration (keep the old signature as a shim). Not urgent.

Net effect: one tenant concept (`tenants`), one scoping column (`tenant_id`), one
resolver (`current_tenant_ids()`), with `organizations` demoted to plain CRM.

---

## 3. Reconciliation migrations (forward-only, reversible, staging-first — NOT YET RUN)

Each is a separate numbered file with a rollback note. Ordered so production is
never half-migrated and every step is independently deployable.

- **`0001_tenants_enrich`** — add to `tenants`: `state` (enum:
  trialing/active/past_due/suspended/closed/purge_scheduled, default active),
  `plan` (text), `brand` (jsonb default {}), `owner_email` (text),
  `updated_at`, `deleted_at`. Backfill the single DDS row to `active`.
  *Rollback:* drop the added columns.
- **`0002_agency_attr_backfill`** — copy `agencies.{plan,brand,owner_email}` for
  the DDS agency onto the DDS `tenants` row. Read-only w.r.t. business tables.
  *Rollback:* none needed (idempotent data copy; re-runnable).
- **`0003_org_scope_converge`** — ensure `organizations.tenant_id` is populated
  (already defaulted); drop `organizations.agency_id`. *Rollback:* re-add the
  column with the same default.
- **`0004_drop_agency_columns`** — drop every `agency_id` column and its
  `NOT VALID` FK from the ~19 tables. GATED on a pre-flight check that no row has
  an `agency_id` differing from its `tenant_id` (proves the columns are
  redundant before dropping). *Rollback:* re-add nullable `agency_id` columns
  (data not restored — but data == tenant_id, so re-derivable).
- **`0005_drop_agencies_table`** — drop `agencies` after 0002/0004. GATED on
  `agencies` row count ≤ 1. *Rollback:* recreate the table from this DDL (kept
  in the migration's rollback note); the single row is re-insertable.
- **`0006_rls_holes`** — replace `email_templates` `USING(true)` with a
  tenant-scoped policy; drop the unused `admins` table (or scope it). *Rollback:*
  restore prior policy text (kept in the note).
- **`0007_emit_rename`** (optional, later) — add `emit(p_tenant …)`, keep
  `emit(p_agency …)` as a shim delegating to it. *Rollback:* drop the new
  overload.

Backfill is trivial because every row already defaults to tenant #1 and RLS
already scopes by membership — there is no data reshuffle, only column/table
cleanup and `tenants` enrichment.

---

## 4. The real work: service-role → caller-JWT cutover (the "service-role bypass fix")

This is where the risk and effort live, not in the migrations. Brief §8: runtime
reads execute under the caller's JWT (RLS enforces); service role is reserved for
audited system jobs.

Approach — **route by route, behind the pipeline, gated by the isolation suite**,
never a big-bang flip:

1. The pipeline resolves `{user_id, tenant_id, role}` once (identity → tenant),
   already 90% present in `verifyStaff`. It then makes an **RLS-scoped client**
   (anon key + caller JWT) available to handlers, exactly as `client_project`
   already does today for the portal.
2. Convert handlers from the service-role `fetch` to the scoped client **one
   module at a time**, cheapest/safest first (reads before writes; a single
   module's routes per PR). Each conversion must pass the isolation suite before
   the next.
3. **Service role stays** only for genuine system jobs (the scheduler, webhooks,
   auth-admin user creation, cross-tenant platform ops) — and those get an
   explicit audit-log row per §8.
4. `tenant_id` predicates stay in queries as defense-in-depth even under RLS.

This is explicitly incremental (the audit's Q13 conclusion): the central gate is
the seam; each route flips independently; production keeps working throughout.

---

## 5. Folded-in pipeline stages (depend on tenancy)

- **Revocation** (Brief §12): after identity+tenant resolve, the pipeline rejects
  when `tenants.state ∈ {suspended, closed}` OR the membership was modified after
  the token was issued (compare `memberships.updated_at` — added in a migration —
  to the JWT `iat`). Effect within minutes, not token expiry. This needs
  `tenants.state` (migration 0001) and a `memberships.updated_at`, so it lands
  after 0001.
- **Durable, tenant-aware rate limiting** (Brief §12/§13): replace the in-memory
  per-IP limiter with a table-backed limiter (`rate_limit_state`, a new
  append/upsert table) keyed by tenant + rate class, ceilings read from
  entitlements (step 4). The `rateClass` field from the route-registry design
  feeds this. Per-IP stays for pre-auth public routes.
- **Audit hooks** (Brief §12): an append-only `audit_log` (actor, tenant, action,
  target, request_id, timestamp, event_type) written by the pipeline after every
  privileged handler and on every auth failure/permission denial. Needs the
  request-id from the pipeline and `tenant_id` from the resolver. New table via
  migration; the event spine (`emit`/`events`) is related but audit_log is the
  security-grade, append-only record §12 requires.

Sequencing within step 3: migrations 0001–0006 → pipeline resolver + revocation
→ isolation suite green → service-role cutover module-by-module → durable rate
limit + audit hooks → suite re-run on every deploy.

---

## 6. Isolation test suite (the gate for step 3 — Brief §15)

The proof, not code review. Two seeded tenants (A = DDS #1, B = a test tenant),
each with a staff user, a client user, and owned rows/files. The suite asserts,
via **real queries under real JWTs** (not service role):

- Tenant A staff cannot read / list / write / delete any tenant B row.
- Tenant A client sees only its own client rows (via `my_client_ids()`).
- Storage: A cannot read/sign/list B's objects (needs the tenant-prefixed path
  work, Files module step 7 — the suite covers paths + signed URLs).
- Pipeline contract: unauthenticated → 401, wrong-role → 403, suspended-tenant →
  rejected, revoked-membership → rejected, each with the right error code.

Runs in CI against staging on every deploy; must be green before any production
deploy. The staging staff user + tenant #1 seeded on 2026-07-05 are the first
fixtures; the suite adds tenant B.

---

## 7. Risk areas

| Risk | Mitigation |
|---|---|
| Service-role cutover breaks a read a handler relied on (RLS returns fewer rows) | One module per PR, isolation suite + the existing smoke matrix gate each; scoped client mirrors the proven `client_project` path |
| Dropping `agency_id`/`agencies` while something still reads it | Pre-flight gates in 0004/0005 (row-count and value-equality checks); runtime grep already shows 0 references |
| A client-visible RLS policy is subtly wrong → cross-tenant leak | The isolation suite is the gate, run under real roles; `tenant_id` predicates kept as defense-in-depth |
| `email_templates`/`admins` permissive policies | Explicitly fixed in 0006 before the cutover exposes them |
| Revocation comparing `iat` to membership change needs a timestamp column | Added in 0001/adjacent; until then revocation degrades to tenant-state checks only (documented) |
| Migrations run against prod out of order | Forward-only numbered files, staging-first, each with a rollback note; runner ledger enforces order |

---

## 8. What I need from Eric before running anything

1. **Confirm `agencies` row count in production** (expected: 1, the DDS row).
   `select id, slug, name, plan from agencies;` — paste the result. Gates 0005.
2. **Confirm no external system reads `agency_id`/`agencies`** (any dashboards,
   SQL views, or scripts outside this repo). Runtime code shows none.
3. Approve the migration sequence 0001–0006 (0007 is optional/later).
4. Approve the service-role cutover approach (module-by-module, suite-gated)
   before the first handler is converted.

Nothing runs until these are answered and you approve. On your go, I write the
migration files and apply 0001 to STAGING first, show you the result, and stop.

---

## 9. One-paragraph summary for the decision

Production already has the right tenancy bones: a `tenants` table, a
membership-based `current_tenant_ids()` resolver, and correct tenant-scoped RLS
on all 65 base tables. Two things are wrong: (a) a dead parallel `agencies`
lineage duplicated across ~19 tables that must be reconciled away, and (b) the
runtime bypasses all that RLS with the service-role key. Step 3 = reconcile to
one tenant concept (cheap, mechanical, low-risk migrations), then flip the
runtime off service-role onto caller-JWT module-by-module (the real work),
proven every step by an isolation suite, with revocation, durable rate limiting,
and audit hooks folded in because they hang off the resolved tenant. No data
reshuffle — everything is already tenant #1.
