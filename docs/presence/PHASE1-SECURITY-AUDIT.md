# Phase 1 · M2 — Tenant-Isolation Security Audit (record)

**Milestone:** Presence CMS Phase 1 · M2. **Type:** audit findings + surgical fixes. **Date:** 2026-07-09.
**Scope:** the one class of bug that can bypass deny-all RLS — a `svc()` query that looks up a row by a **request-supplied id** without scoping it to the caller's resolved site/tenant. Plus the all-zero "global sentinel" `site_id`.

## Method
Mapped the scoping seam (`resolveSite(jwt)` — the caller's site is derived from their authenticated token, never from request input), then enumerated every `svc()` query in the client-facing version routes that interpolates a request-supplied id, and every `presence_snapshots?id=eq` fetch across the function. Traced the `GLOBAL_SITE` sentinel.

## Findings

**Overall: the multi-tenant boundary is correctly enforced.** Every client route that accepts a version id from the request scopes it with `&site_id=eq.${site.id}` in the same query, so a cross-site id returns nothing (fail-closed) rather than another tenant's data. Confirmed scoped at the request-entry:
- `routes/publish.ts` `handleRestore` — `presence_publishes?id=eq.${publishId}&site_id=eq.${site.id}`
- `routes/room.ts` `handleRestoreToDraft` — same pattern
- `routes/launches.ts` `getLaunch(site, id)` — `presence_launches?id=eq.${id}&site_id=eq.${site.id}`
- `routes/preview.ts` `loadSnapshotFor` — launch/publish/preview/live lookups all `&site_id=eq.${site.id}`

**One hardening applied (defense-in-depth).** The follow-on `presence_snapshots?id=eq.${snapId}` fetches derived `snapId` from an already-site-scoped row, so they were safe — but not *self-evidently* so (a future refactor introducing an unscoped `snapId` source would go unnoticed). Added an explicit `&site_id=eq.${site.id}` to the three request-id-driven client fetches, matching the existing `admin.ts:326` precedent:
- `routes/preview.ts` (snapshot fetch)
- `routes/publish.ts` `handleRestore` (snapshot fetch)
- `routes/room.ts` `handleRestoreToDraft` (snapshot fetch)

**Reviewed and confirmed safe — no change needed** (provenance-scoped or non-client context):
- `routes/publish.ts` PATCHes by `pubId`/`p.id` — the publish row's *own* id, just inserted with `site_id: site.id` or iterated in the reconcile path (system context).
- `routes/launches.ts` `patchLaunch(l.id, …)` — `l.id` comes from the site-scoped `getLaunch`.
- `routes/room.ts:53`, `evidence/collect.ts`, `routes/assets.ts` — read the site's *own* live snapshot (`snapId` from a `site_id=eq.${site.id}` publish query).
- `ops/scheduler.ts`, `routes/admin.ts:300` — cron/operator (staff) context, cross-site by authority, not a client path.
- `lib/staging.ts` `loadStagedSnapshot(snapshotId)` — all callers (launches, preview_env) pass a snapshot id obtained from a site-scoped query; a signature change to thread `site` was judged out of proportion to the (provenance-safe) risk.

**Global sentinel (`00000000-…`).** Used only in operator-gated marketplace (`industry/marketplace_store.ts`) for the platform-global pack catalog, and as an audit/member fallback (`lib/scope.ts`, `lib/workspace.ts`). It is a fixed constant, never attacker-controllable, and reaches no cross-tenant *customer* data. Safe.

## Regression guard
`tests/presence/tenant_isolation_test.mjs` — a pure structural test asserting each security-boundary query stays site-scoped (positive assertions, no false positives) and that the sentinel stays confined to operator/scope/audit code. 9/9. It fails loudly if any scope filter is ever removed.

## Result
No exploitable RLS-bypass found. 3 defense-in-depth hardenings applied + a permanent regression guard. presence typechecks clean; 86/86 pure suites (incl. the new test); deployed staging + prod.
