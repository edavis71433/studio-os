# Route Registry — design doc (for review before implementation)

Status: PROPOSED. Nothing in here is built yet. This is the document Eric asked
for before the 165-route refactor: structure, migration path, zero-behavior-change
guarantee, risk areas, verification plan.

Build Brief §14: "Route registry: every route declares module, version, minimum
role, cost-bearing flag (auto-attaches metering), and rate class. New routes
cannot be added outside the registry. The registry doubles as the API
documentation source."

---

## 1. Current state (measured 2026-07-05, canonical `clever-api/index.ts`)

Route governance today is spread across four separate literals plus the giant
`if (type === '…')` dispatch chain:

| Structure | Count | Role today |
|---|---|---|
| `ROUTE_MIN_ROLE` | 124 (106 staff, 10 admin, 8 owner) | minimum role per privileged route |
| `PUBLIC_ROUTES` | 41 | deny-by-default allowlist (public/client/secret) |
| `NOTIFY_RELAY_TYPES` | 10 | which types the email relay may send |
| `RATE_LIMITED_TYPES` | 18 | per-IP in-memory throttle set |
| dispatched `type ===` | 161 + 7 `action` sub-routes | actual handlers |

Verified facts that make a registry safe:
- **Deny-by-default is already complete**: every single-quote-dispatched type is
  in `ROUTE_MIN_ROLE ∪ PUBLIC_ROUTES`. Nothing dispatched is ungoverned.
- The only non-standard dispatch is the double-quoted ops family (`"bug"`,
  `"outage"`, `"security"`) — the registry must account for it explicitly.
- Some types legitimately appear in TWO sets (e.g. `invoice_reminder` is in
  `ROUTE_MIN_ROLE` AND `NOTIFY_RELAY_TYPES`). The registry must model
  orthogonal facets, not a single category.

The problem the registry solves: adding a route means remembering to touch up to
four scattered literals; forgetting one is how routes end up unrated,
unmetered, or (historically) publicly exposed. One declarative source removes
that class of mistake and becomes the API doc.

---

## 2. Structure

One object, keyed by dispatch `type`, each value a declarative record. The gate
and helpers read from it; the dispatch chain is untouched.

```ts
type RouteAccess =
  | { kind: 'role'; minRole: 'readonly' | 'staff' | 'admin' | 'owner' }
  | { kind: 'public' }        // world-reachable, no auth (site tools, ops alerts)
  | { kind: 'client' }        // self-gated inside by the caller's own JWT + ownership
  | { kind: 'secret' }        // gated inside by a shared secret (scheduler, gsc_ingest)
  | { kind: 'relay' };        // notify-relay to Eric only (portal activity notices)

interface RouteDef {
  module:
    | 'identity' | 'tenancy' | 'clients' | 'work' | 'communication'
    | 'files' | 'billing' | 'ai_gateway' | 'analytics' | 'platform_ops';
  version: number;            // 1 today; bumps require a new entry, never mutation
  access: RouteAccess;
  costBearing?: boolean;      // true => auto-attach AI metering (wired in step 5)
  rateClass?: 'none' | 'ai' | 'intake' | 'auth';  // maps to a limiter policy
  notify?: boolean;           // may drive the email relay handler
  dispatch?: 'quoted';        // marks the double-quoted ops family
  notes?: string;             // one line; feeds the generated API doc
}

const ROUTE_REGISTRY: Record<string, RouteDef> = {
  invoice_reminder: {
    module: 'billing', version: 1,
    access: { kind: 'role', minRole: 'staff' },
    rateClass: 'none', notify: true,
    notes: 'Admin -> client overdue-invoice reminder email.',
  },
  ai_critique: {
    module: 'ai_gateway', version: 1,
    access: { kind: 'public' },
    costBearing: true, rateClass: 'ai',
    notes: 'Public free website review; calls Anthropic (moves behind the Gateway in step 5).',
  },
  run_scheduled_jobs: {
    module: 'platform_ops', version: 1,
    access: { kind: 'secret' }, rateClass: 'none',
    notes: 'pg_cron nightly entrypoint; gated by SCHEDULER_SECRET.',
  },
  // … one entry per dispatched type
};
```

The four existing literals become **derived views**, computed once at module load:

```ts
const ROUTE_MIN_ROLE   = derive role-kind entries -> {type: minRole}
const PUBLIC_ROUTES    = Set of public|client|secret types
const NOTIFY_RELAY_TYPES = Set of types with notify:true
const RATE_LIMITED_TYPES = Set of types with rateClass in {ai,intake,auth}
```

The gate logic does not change shape — it reads the same derived structures it
reads today. Only their *source* moves from hand-written literals to
`derive(ROUTE_REGISTRY)`.

---

## 3. Migration path (phased, each phase independently deployable to staging)

**Phase 0 — build the registry, derive the existing sets, ASSERT EQUALITY.**
Add `ROUTE_REGISTRY` populated to reproduce today's governance exactly. Derive
the four sets from it. At module load, assert each derived set deep-equals the
current hand-written literal (kept temporarily side-by-side under a
`_LEGACY_` name). If any differ, the function throws on boot — so a mismatch
can never reach production silently. This phase is **provably zero-behavior-change**:
the derived sets are byte-equal to the literals or the function won't start.

**Phase 1 — cut over.** Delete the `_LEGACY_` literals; the derived views are
now the only source. Behavior identical (Phase 0 proved equality). The gate now
reads registry-derived data. Ship to staging, run the full smoke/negative
matrix, then production (functions after frontends per ENVIRONMENTS §D-bis).

**Phase 2+ — enrich, incrementally, as later steps need it.** The richer fields
(`costBearing`, `rateClass` granularity, `version`, `module`) are already
populated but not yet *consumed* by anything. They get wired in when their
owning step arrives:
- `rateClass` → the durable, tenant-aware limiter (step 3 tenancy).
- `costBearing` → auto-metering to `ai_usage` (step 5 AI Gateway).
- `version` → response-envelope + breaking-change discipline (step 2 conventions).
- `module` → the generated API-doc table + ownership boundaries (ongoing).

No route handler is rewritten in any phase. The dispatch chain is inert to this
change — the registry governs the *gate*, not the *handlers*.

---

## 4. Zero-behavior-change guarantee

Three independent guarantees, strongest first:

1. **Boot-time golden assertion (Phase 0).** `derive(ROUTE_REGISTRY)` must
   deep-equal the frozen legacy literals or the function throws at load. There
   is no runtime path where a divergent registry serves traffic.
2. **Completeness lint (CI + boot).** Two set-equality checks:
   (a) every dispatched `type` has a registry entry; (b) every registry entry is
   actually dispatched. A route added to dispatch but not the registry fails the
   build — which is the "new routes cannot be added outside the registry"
   requirement, enforced mechanically.
3. **Behavioral test matrix (staging).** The existing smoke + negative tests
   (unknown → 403, public → 200, staff-gated no-JWT → 401, staff-gated JWT →
   200, relay-injection → 403) re-run unchanged and must produce identical
   codes before and after cutover.

The dispatch chain, request parsing, and every handler body are untouched, so
the only surface that can change is the gate — and it is pinned by (1).

---

## 5. Risk areas (named, with mitigations)

| Risk | Mitigation |
|---|---|
| A dispatched type missing from the registry → could 403 a live route | Completeness lint (§4.2) fails the build before deploy; Phase 0 assertion catches it at boot |
| Double-quoted ops family (`bug`/`outage`/`security`) dispatch not `type ===`-matched | Explicit `dispatch: 'quoted'` field; the derive step and lint special-case them (they are already in the registry as `public`) |
| The 7 `action` sub-routes (`approve`, `decline`, …) are not top-level types | Out of scope for v1 — they are guarded by their parent route's access. Documented as a known non-goal; revisit if a sub-route ever needs distinct gating |
| Client-portal routes are "self-gated" (own JWT + ownership) not role-gated | Modeled as `access: {kind:'client'}` — derives into `PUBLIC_ROUTES` exactly as today (they pass the central gate, then check ownership internally). No behavior change |
| Wrong `module` assignment for 165 routes (cosmetic, but feeds ownership) | Seed `module` from the audit's module map; `module` is not consumed by the gate in Phase 0/1, so a wrong value cannot break access — it only mislabels a doc row, fixable freely |
| Registry object is large (~165 entries) in an 11K-line file | It is pure data, no control flow; lives in one contiguous block; the generated API-doc table (below) makes it reviewable |
| Merge/edit error while hand-authoring 165 entries | Author the registry by *generating* the first draft mechanically from the existing four literals (a one-off script), then hand-review — not by typing 165 records from scratch. The Phase 0 assertion then proves the generation was faithful |

Explicit non-goals for v1 (so scope can't creep): no response-envelope change,
no metering, no pagination, no per-route rate *enforcement* changes (only
classification), no handler edits.

---

## 6. Verification plan

Before staging deploy:
- `deno check` clean (0 new errors vs baseline).
- Completeness lint passes (bidirectional dispatch ↔ registry).
- Phase 0 assertion compiles with legacy literals present and equal.

On staging (the established matrix, must match pre-change codes exactly):
- `version` → build unchanged.
- unknown type → 403; injected notify-shape → 403.
- a public route (`whoami`) → 200.
- a staff route without JWT → 401; with the seeded staff JWT → 200.
- a client-portal route with a client JWT → 200 (ownership path intact).
- `run_scheduled_jobs` without the secret → 401; with it → 200.
- the notify relay (Eric-only) → 200.

Deliverable artifact: a generated `docs/api/routes.md` table (module | type |
access | rate class | cost-bearing | notes) produced from the registry — the
"registry doubles as API documentation" requirement, and a human-reviewable
diff of governance whenever the registry changes.

Production: only after Eric approves the staging run; frontends before function
per ENVIRONMENTS §D-bis (no frontend change is expected for this refactor, so
the ordering risk is nil here).

---

## 7. Effort / sequencing note

Phase 0+1 (registry + derive + assert + lint + cutover, no enrichment
consumed) is the safe, high-value unit and is what §14 needs for step 2. The
enrichment consumers (rateClass, costBearing) are deliberately deferred to the
steps that own them (3 and 5), because wiring them now would pull tenancy and
the AI Gateway forward out of order. Recommendation: build Phase 0+1 as the
step-2 registry deliverable; carry the enriched fields as inert data that later
steps switch on.
