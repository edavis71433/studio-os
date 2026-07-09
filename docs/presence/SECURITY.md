# Security — Studio OS Presence

The consolidated security model. Every boundary here is enforced in code and covered by tests (see [QA-RELEASE-VERIFICATION § Security](QA-RELEASE-VERIFICATION.md)). Why it exists: the product's core promise is ownership and trust — a customer's data is theirs, nothing changes without approval, and one tenant can never see another.

## Authentication

Every authed route requires a verified caller JWT (`x-dds-user-jwt`) in addition to the anon bearer. `resolvePrincipal` classifies the caller as `staff | client | system | public`. Unauthenticated calls to authed routes return **401**. The `system` principal (scheduler) additionally requires `SCHEDULER_SECRET` in the body.

## Authorization

- **Customer routes** act only on the caller's own site.
- **Operator/advanced routes** (marketplace, enterprise, admin, system) gate on `p.kind === 'staff' || p.kind === 'system'` (`routes/marketplace.ts`, `routes/enterprise.ts`) and are dispatched **before** the client-site resolution (operators own no site).
- **Agency** composes `role × scope` (9 roles); actions outside a role return **403 `forbidden`**, and every org is **portfolio-scoped** (403 if not in your portfolio).
- Service-role resolves to `public`, never `staff` — a bare service-role call cannot perform operator actions.

## Tenant / Organization / Agency isolation

- **Tenant:** the caller's site is resolved from the JWT via RLS (`resolveSite(jwt)`), never from client input — a customer can address only their own `site_id`.
- **Organization:** enterprise config/rollouts are scoped to the org; a location inherits only within its org tree.
- **Agency:** rollups and approvals read only the agency's portfolio; cross-portfolio access is refused.
- **Scoped drill-in (SC-1):** an agency operator may re-scope the shell to a client via `x-dds-scope-site`, but scope is a **request, never an authority** — re-validated server-side every request at the `resolveScopedSite` chokepoint and **fail-closed** (never falls back to another tenant). Authorization reuses the agency model; the pure `scopeDecision` is exhaustively attack-tested. See [SC-1](PHASE-SC1-SECURE-CLIENT-SCOPE.md).
- **Scoped-access audit (SC-2):** every drill-in — allowed and denied — is recorded in the deny-all `presence_scoped_access_events` ledger (operator → client, outcome, reason, no tokens/bodies), readable via staff-gated `GET /admin/scoped-access`. The write is best-effort and orthogonal to the access decision, so it can never weaken the boundary. See [SC-2](PHASE-SC2-SCOPED-ACCESS-AUDIT.md).

## RLS

All 54 `presence_*` tables have **RLS enabled with no permissive policies** (deny-all) — direct client access returns nothing; access is function-mediated (`svc` = service role; `asUser` = RLS-scoped caller). The only permissive `using(true)` policies in the DB are in the **baseline** schema (`admins` — service-role only; `email_templates` — authenticated, and **not referenced by any Presence code**; see [Remaining Risks](QA-RELEASE-VERIFICATION.md#remaining-risks-not-bugs)).

## Approval enforcement

`requires_approval = true` is a **DB CHECK constant** on all five plan tables (infra, connected writes, marketplace, enterprise, visual). The executor re-checks approval, and the **atomic single-winner claim** (compare-and-swap on a claim column, with a staleness window) guarantees an approved plan executes exactly once — concurrent/duplicate executes are refused. Verified live (`connected_validation`).

## Encryption & Secrets

- Provider tokens are **out-of-row**, **AES-256-GCM** encrypted (`presence_connection_secrets`), key from `CONNECTION_ENC_KEY`. The crypto is **fail-closed**: no key → `seal`/`open` return null (never plaintext, never a fake success).
- Secrets live only in dashboards, never the repo; rotation cadence in [ENV-AND-SECRETS](ENV-AND-SECRETS.md).

## Replay / forgery / injection

- **OAuth callback state** is signed and verified (bound to site + provider + freshness); cross-site, tampered, stale, or empty states are refused before any code exchange.
- **Envelope discipline:** no stack trace or internal id ever crosses the boundary; errors are plain codes + messages.
- **XSS:** customer HTML escapes interpolated data (`esc()`); the OAuth callback inserts only developer-controlled strings, never a URL-reflected value.
- **SQL injection:** all DB access is via PostgREST/parameterized helpers; no string-built SQL in request paths.

## AI safety

- **Fact law:** the Writer may state only facts from the fact sheet; the Brand Guardian vetoes unattributable claims before anything is shown. Generated **images** are claim-scrubbed (no awards/ratings/#1/prices) — the fact law reaches pixels.
- **No autonomous publishing:** AI only drafts; publishing is a separate, human-approved, versioned step. Provenance (`ai_approved`) is recorded.
- **Manual parity:** every AI workflow has an equal manual path — a customer never has to touch AI.
- **Gated + honest:** AI/visual features are dark-but-honest without their keys; they never fabricate.

## Connected & Visual security specifics

- Connected: read-only by default; every write is an approval-gated plan with a reviewed rollback; disconnect revokes at the provider and destroys the stored secret.
- Visual: generations are private drafts; only an approved variation enters the media library; nothing reaches the live site without a publish.

## Security checklist (per release / per change)

- [ ] New route gated correctly (customer = own site; operator = staff/system before site gate).
- [ ] New table = deny-all RLS; sensitive material out-of-row/encrypted.
- [ ] Any external write goes through `lib/approved_plan.ts` (never a direct write).
- [ ] Customer-facing interpolation escaped; no secrets in logs or responses.
- [ ] `platform_invariants_test.mjs` green; `connected_validation` (state + atomic claim) green.
- [ ] Recommended pre-launch (not yet run in-env): a live penetration + accessibility + load pass.
