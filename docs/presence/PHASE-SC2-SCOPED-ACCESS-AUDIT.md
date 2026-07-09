# Phase SC-2 — Scoped-Access Audit Ledger

*SC-1 made the Studio → Client drill-in **safe** (fail-closed, server-authoritative, no cross-tenant path). SC-2 makes it **accountable**: every scoped access — allowed **and** denied — is recorded, so an operator reaching a client can always be answered for. The isolation boundary is unchanged; this phase only adds the trail beside it.*

## What is recorded (and what is deliberately not)
Every time `resolveScopedSite` runs — which is **only** when a request carries `x-dds-scope-site`, i.e. a genuine drill-in — one event is written:

| Field | Meaning |
|---|---|
| `operator_user_id`, `operator_email` | the agency operator (from the authenticated principal) |
| `agency_id` | their agency (from `resolveAgencyMember`) |
| `client_site_id`, `client_name` | the tenant they reached (name only on an allowed access) |
| `route`, `method` | the request **path** (query string stripped) + verb |
| `outcome` | `allowed` \| `denied` |
| `reason` | `''` when allowed; else `unauthorized` / `missing_membership` / `read_only_role` / `removed_client` / `malformed_scope` / `archived_client` |
| `request_id`, `ip`, `user_agent`, `created_at` | forensic context (IP = first forwarded hop only) |

**Never recorded:** tokens, the JWT, the `Authorization` header, request bodies, secrets, or the URL query string. This is a structural guarantee — `buildScopeAuditRow` is a pure function that reads *only* the whitelisted fields, so no caller mistake can smuggle a secret into a row (unit-tested three ways). **Unscoped (own-site) access is never logged** — the writer sits inside the scoped branch only.

## Where it lives — a dedicated table, on purpose
`presence_scoped_access_events` (migration **0064**), **not** `presence_change_events`. Reasons:
- **Different audience.** This is operator/security forensics, not a customer's content history. Folding operator drill-ins into `presence_change_events` would pollute every client's activity timeline with rows about *other people* reaching their site.
- **Different access.** Deny-all RLS (RLS on, **no policy**) → no authenticated role can read or write it; only the service role (the staff-gated admin endpoint) reads it. A business owner can never see it.
- **Different shape + retention.** Operator vs client, denial reasons, no content payload. One clear source of truth per concern (Constitution §7), and the audit read query stays cheap.

## Fail-safe: the audit can never weaken the boundary
The write is **best-effort and orthogonal to the access decision**. `resolveScopedSite` decides authorization first (unchanged from SC-1) and logs *after*. So:
- A logging failure **cannot expose data** — the authorization decision already happened and doesn't depend on the log.
- A logging failure **cannot block an authorized request** — we don't gate access on the write succeeding; blocking an already-authorized call because an audit row hiccuped trades availability for zero security gain.
- On a write failure we **alert ops** (`OPS_ALERT_EMAIL`, best-effort) so the gap is visible rather than silent.

A stricter *"no audit → deny writes"* posture is the SOC-2/finance policy option; it belongs to that tier's config, not to the general mechanism, and its absence is fail-*open-but-alerted*, never fail-unsafe.

The one refinement the audit adds over SC-1's decision: on an `unauthorized` denial it does a second, **audit-only** lookup (`agencySiteIds(includeArchived)`) to label an *archived* client distinctly from a *never-authorized* one. This never touches the security decision (active-only set still governs access) — it only sharpens the ledger.

## Operator visibility — a trail, not a dashboard
`GET /admin/scoped-access` (staff-only, proven in `index.ts` before dispatch). Filters: `client` (site uuid), `operator` (uuid or email substring), `agency`, `outcome` (`allowed`/`denied`), `since`/`until` (ISO date), `limit` (≤500). Returns `{count, allowed, denied, events[]}` newest-first. Deliberately a plain, filterable, chronological list — no compliance UI, per the phase scope.

## Verification
- **Unit — `scoped_access_audit_test.mjs`, 17/17.** allowed → empty reason; every denial reason maps into the DB CHECK vocabulary; an unknown internal reason degrades to `forbidden`; the row contains **only** the whitelisted fields; a token/body/`Authorization` handed in as junk never reaches the serialized row; route is path-only (query dropped); IP is first hop; long fields capped; absent operator → nulls, no throw; outcome ∈ {allowed, denied}.
- **Regression:** SC-1 scope 14/14, platform invariants 14/14, agency 28/28, workspace-roles 39/39. Backend `deno check` clean (scope.ts, index.ts, admin.ts).
- **Migration applied to staging + prod** (hold-back technique); `migration list` confirms 0064 tracked on prod.
- **Live-verified on prod:** the table is **deny-all to anon** (`42501 permission denied`); the admin audit endpoint is **staff-gated** (`401` to a non-staff caller); a forged scope with no session still denies at the auth gate **before** scope resolution (SC-1 boundary unchanged).
- **Human QA (needs a real operator JWT):** trigger one allowed + one denied drill-in as an agency operator, then confirm both rows appear via `/admin/scoped-access` filtered by that operator. Same class of residual as the browser QA — not automatable here without live agency credentials.

## Rollback
`drop table public.presence_scoped_access_events;` — the ledger is additive and read-only to the app; dropping it removes the trail and leaves the SC-1 access decision, and every other table, untouched.

**Phase SC-2 — Scoped Access Audit Ledger complete.**
