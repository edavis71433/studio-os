# Phase SC-1 — Secure Client Scope (Studio → Client drill-in)

*An agency operator opens a client and the whole shell re-scopes to that client's business — inside one shell, with `Studio › Joe's Plumbing` always visible — without ever compromising tenant isolation. Security over convenience; every doubt fails closed.*

## The model (reuses existing authorization; invents no second auth)
- **Scope is a request, never an authority.** It rides the URL `?client=<id>` (per-tab, shareable, refresh-safe) and is sent as `x-dds-scope-site`. The client cannot grant itself access by setting it.
- **One chokepoint.** All tenant resolution flows through `resolveSite` in `index.ts`. SC-1 adds: if a scope header is present, `resolveScopedSite(jwt, id)` runs and either returns the client's `SiteRow` (fully authorized) or a 4xx — and on any failure the request is **rejected, never falling back to another tenant**. Un-scoped requests are unchanged (RLS confines to the caller's own site).
- **Authorization = the existing agency model.** A scope is granted **iff** all hold: the caller is an **active agency member** (`resolveAgencyMember`, already fail-closed on bad token / paused agency / no row); their role can manage clients (`can(role,'bulk_publish')` — read-only agency roles get no drill-in); and `site_id ∈ agencySiteIds(agency)` (**active** clients only). The scoped operator resolves to `business_owner` on that client — which they already are via bulk-publish authorization, so **no new privilege, no escalation**.

## The security decision is pure and exhaustively tested
`lib/scope.ts` factors the entire authorization into `scopeDecision(inputs)` — a pure function, so every attack scenario is a unit test (`scope_test.mjs`, **14/14**). Deny takes precedence; order puts the cheapest, most-denying checks first; the site row is read only *after* authorization would pass (no read on a forged/unauthorized id).

## Attack review — every scenario fails closed
| Attack | Result |
|---|---|
| Forged / other-tenant scope id | not in `agencySiteIds` → **403** (`unauthorized`) |
| Business owner (non-agency) forging the header | `resolveAgencyMember` → null → **403** (`not_agency`) — can only ever see their own site |
| Read-only agency role drilling in | `can(role,'bulk_publish')` false → **403** (`role`) |
| URL manipulation / bookmark / refresh / multi-tab | re-validated server-side every request; a bad scope never resolves |
| Stale scope after permission removal / client archived | `agencySiteIds` (active-only) recomputed each call → **403** |
| Deleted client | site row absent → **404** (`deleted`) |
| Suspended agency | `resolveAgencyMember` fail-closed → **403** |
| Malformed / injection id | `isScopeId` (strict UUID) rejects → **400**, never touches the DB |
| Logout / no JWT | auth gate rejects **before** scope resolution |
| Multiple failing conditions | any one denies; never a partial allow |

**Live-verified on prod:** an unauthenticated caller sending a valid-looking, a malformed, or a data-route scope header all return `unauthorized` — the auth gate runs *before* scope, and scope then requires agency membership. No tenant data is ever returned on a denied scope.

## Behaviour across the surfaces (one shell, always)
- **Selection:** open a client in the Studio → navigate to `/today.html?client=<id>`. No app switch, no second shell.
- **Every request** from every page forwards `x-dds-scope-site` (shell + today/presence/customers/inbox/leads/connections). The server re-resolves the tenant each time.
- **Breadcrumb:** the shell renders `Studio › {name}` from the server-confirmed `context.scope`, with a "Studio" link back (exiting the scope by navigating un-scoped). Accurate because the name comes from the validated server response, not the URL.
- **Refresh / bookmark / new tab:** the scope is in the URL → re-validated → correct or denied. **Per-tab** (URL, not shared storage), so tabs don't bleed.
- **Command palette, notifications, Today, Inbox:** all carry and honor the scope via the shared shell (`withScope` on nav/palette/notification hrefs; the scope header on data calls).
- **Logout / permission removal:** no JWT or lost membership → next request fails closed; no stale scope survives.

## Verification
- Unit: `scope_test.mjs` **14/14** (the full attack matrix on the pure decision).
- Browser: `scope.spec.ts` — breadcrumb renders; the exact scope id is forwarded; a 403 scope degrades to the minimal shell with **no workspace nav** (no cross-tenant render); an un-scoped owner shows no breadcrumb.
- Regression: workspace_roles 39/39, nav_integrity 3/3, shell 18/18, agency 28/28, invariants 14/14, commercial 57/57. Backend typechecks; all pages parse-clean. Deployed both envs.

## Deliberately conservative (v1)
Only agency roles with `bulk_publish` (owner/admin/account_manager) may drill in, as `business_owner` on the client. Extending scoped access to lower agency roles as `business_staff`/read-only would require threading a mapped site-role through the pipeline; that's a future enhancement, gated the same way, and its absence is **fail-closed** (those roles keep the read-only portfolio), not a risk.

## Final questions — answered honestly
- **Trust it with 10,000 agencies?** Yes. Authorization is recomputed per request from the active-membership set; there is no cached or client-trusted scope, so scale doesn't widen the attack surface.
- **Healthcare customers?** The isolation is sound (fail-closed, server-authoritative, no cross-tenant path). Healthcare would still need the broader program — a BAA, audit logging of operator access, encryption posture — before I'd claim HIPAA-ready; the *scope mechanism* itself is safe.
- **Financial customers?** Same: the tenant boundary is trustworthy; SOC-2-grade controls (access audit trails, change management) are org-level work beyond this mechanism.
- **Would I personally ship this?** Yes — with one addition I'd want before a healthcare/finance launch: an **audit log of every scoped access** (operator → client, timestamp). It's not required for correctness (isolation holds without it) but it's required for *forensics and trust* at that tier. For general agencies, ship as-is.

**Phase SC-1 — Secure Client Scope complete.**
