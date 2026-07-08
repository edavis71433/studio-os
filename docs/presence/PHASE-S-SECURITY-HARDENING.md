# Phase S — Security & Engineering Hardening

*Production hardening for immediate real-customer traffic. Comprehensive security + engineering + resilience review; only V1 improvements implemented (rate limiting on public writes, verified via a live 429 trip); everything else classified in the Risk Register. No architecture change. Consolidates the Security Audit / Engineering Audit / Performance Report / Operational Resilience Report / Risk Register.*

---

## Executive summary

Studio OS is **fundamentally sound to serve paying customers**, with one real V1 gap now closed. The security model is strong by construction: deny-all RLS, `svc()` (service-role) vs `asUser()` (caller-JWT) separation, tenant isolation via `resolveSite(jwt)`, approval-first for every world-changing action, Developer Mode as sanitized *data* (never runtime code), signed HMAC tokens for one-tap approve, encrypted+revocable connected tokens, and a strong static-site header set (HSTS preload, `X-Frame-Options: DENY`, a real CSP, `nosniff`). The **one verified V1 hole was the absence of rate limiting on the public write routes** (`/forms/:id/submit`, `/commerce/signup`, `/approve`) — a table-backed limiter (`rate_hit`, migration 0008) already existed but was unused by the presence function. **This phase wired it in and proved it live** (signup trips 429 after 5/min; a single approve call still returns 400, not 429). A focused **`svc()` id-scope audit** found tenant scoping intact everywhere client-facing — the only unscoped-id service calls are operator-only (`admin.ts`, staff-gated) or self-token-keyed (`commerce.ts` signup rows). Remaining items are operational (owner activation) or V1.1 hardening, all in the Risk Register — none blocks serving customers.

---

## Security audit (verified)

| Area | State |
|---|---|
| AuthN / sessions / tokens | Supabase JWT; per-request validation; storageKey-scoped; one-tap = signed HMAC-SHA256 with expiry + timing-safe compare ✅ |
| AuthZ / tenant isolation | deny-all RLS + `resolveSite(jwt)`; `svc()`/`asUser()` split; **id-scope audit: client routes all filter by site_id** ✅ |
| **Rate limiting / abuse / brute-force** | **was ABSENT on public writes → NOW wired** (`lib/ratelimit.ts` over `rate_hit`): forms 10/min-IP + 60/min-site, signup 5/min-IP, approve 20/min-IP; fail-open; live-verified 429 ✅ |
| Spam | honeypot (`_hp`) + always-200 to bots + rate limit (defense in depth) ✅ |
| Input validation / output encoding | closed field sets + `clean()` control-char strip; `esc`/`attr`/`safeHref`/markdown sanitizer in render; every interpolation escaped ✅ |
| File uploads / media | server-side variant pipeline, EXIF strip, alt required; type/size bounded ✅ |
| Developer Mode | allow-list tokens + sanitized CSS/HTML as inert data, re-sanitized at serialize; no `<script>`/handlers/js-urls ✅ (constitutional) |
| Secrets / least privilege | env-only; service key server-side; `rate_hit` RPC revoked from anon/authenticated; graceful degradation when secrets absent ✅ |
| Security headers / CSP / CORS | `_headers`: HSTS preload, X-Frame DENY, CSP, nosniff, Referrer-Policy, Permissions-Policy; scoped CORS ✅ |
| CSRF | token/JWT-authorized state changes (no ambient cookie auth on the API) ✅ |
| Dependencies | pinned CDN (supabase-js 2.45.4); Deno std; minimal surface — audit cadence = FD-S3 |

## Engineering audit / performance

- **Rendering:** pure, deterministic, **zero JS emitted**, one hand-authored CSS sheet, fingerprinted assets — inherently fast. Verified by the render/business_classic suites.
- **DB:** PostgREST reads scoped + `limit`-bounded; snapshots are single-row JSON (no N+1 at publish); RLS indexes on tenant keys. Real p95 under live load = FD-S1 (measure at activation).
- **Media:** responsive variants + long-cache headers + CDN (Netlify) ✅.
- **Error handling / degradation:** every external dependency degrades gracefully / fails-closed (RESEND no-op, Stripe "unavailable", CONNECTION_ENC_KEY fail-closed, AI honest-unavailable); the new limiter fails **open** (availability > perfect throttling on a public form).
- **Observability:** audit ledgers + provenance events + `/system/health` capability map. Structured error metrics/alerting = FD-S2 (owner activation).
- **Tech debt:** the migration hold-back ritual (tracked B5/FD-S4) is the notable maintainability residue — manual, one typo from a prod slip; reconcile post-launch.

## Operational resilience

Backups/restore: every publish is a versioned snapshot with 1-step rollback ✅; PITR + a restore drill = owner activation. Cron reliability: `/system/run` exists; scheduling it (pg_cron or external) = owner activation. Deployment safety: `supabase-go` deploy + the hold-back for single migrations; CI gate = FD-S5. Monitoring/alerting = FD-S2. **None of these are code gaps — they're the documented owner-activation runway.**

## Risk Register

| ID | Risk | Severity | Disposition |
|---|---|---|---|
| — | No rate limiting on public writes | High | **CLOSED this phase** ✅ |
| — | `svc()` cross-tenant id leak | High | **Audited — none found** ✅ |
| FD-S1 | Real p95 / cold-start / bundle size unmeasured under load | Med | V1 owner-activation (measure), not a code change |
| FD-S2 | Function-error metrics + alerting not wired | Med | Owner activation (external monitor) |
| FD-M3 | No legal/privacy page on published sites collecting PII | Med-High | **V1 candidate** (engineering) — build before broad launch |
| FD-M4 | No self-serve account deletion (export exists) | Med | V1.1 (V1 if EU) |
| FD-S3 | No scheduled dependency-vuln audit | Low-Med | V1.1 (CI cadence) |
| FD-S4 | Migration hold-back ritual is manual | Med | V1.1 (reconcile history) |
| FD-S5 | No CI gate on the test suite | Med | V1.1 (wrap the local runner) |
| FD-S6 | Rate-limit windows are per-instance-clock fixed windows | Low | Acceptable for V1 (durable counter shared via DB); sliding-window = future |

## Testing

Implemented: `ratelimit_test.mjs` 9/9 (IP precedence, fail-open, 429 contract) + **live 429 trip on staging** (signup 5→429; approve single→400). Full pure regression green (business_classic 21/21, commercial 30/30, render 28/28, invariants 14/14, + all suites). Live staging room 38/38 + pipeline 30/30 after deploy (publish/preview/rollback/CRM/BOS unaffected). Function deployed staging + prod; no migration this phase (the limiter table pre-existed). Negative testing: over-limit → 429 with Retry-After; limiter outage → fail-open (unit-locked).

## Final questions (honest)

- **Trust it to serve paying customers?** **Yes** — with FD-M3 (legal page) built and the owner-activation runway (monitoring/PITR/cron) done. The core security model is sound and the one real hole (rate limiting) is closed and verified.
- **Trust it to host my own business?** Yes — same two caveats (they're operational, not architectural).
- **Remaining security risks?** None High/open in code: rate limiting closed, tenant scoping audited clean. Residual is Med/Low and queued (dependency-audit cadence, sliding windows).
- **Engineering risks?** Load-verified p95 (FD-S1) and a CI gate (FD-S5) — measurement/process, not defects.
- **Operational risks?** The owner-activation set (monitoring, PITR drill, cron) — documented, gated, not engineering.
- **Must complete before Owner Activation?** FD-M3 (legal page) as the one engineering item; the rest of the gate is activation itself (secrets, cron, PITR, monitoring) + browser QA + the push.
- **Safe for V1.1?** Account deletion (non-EU), dependency-audit CI, migration-history reconcile, sliding-window limiter, load-tuning.

**Phase S — Security & Engineering Hardening complete.**
