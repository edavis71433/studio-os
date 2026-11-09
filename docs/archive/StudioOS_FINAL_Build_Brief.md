# Studio OS Final Build Brief
## The single authoritative implementation instruction for Claude Code

This document replaces all previous build briefs. Where any other document conflicts with this one, this one wins. Companion documents (Architecture, Gap Analysis, Pricing Strategy, Founder Agreement, Legal Pack) are reference material; the instructions are here.
Status: final pending the Open Decisions at the end and the repo audit, which is step zero of the build.

---

## 1. Project goal

Convert Studio OS from a single-tenant production system serving Davis Digital Studio into a multi-tenant, license-ready SaaS platform that agencies and freelancers pay to use, without breaking the current production system at any step. Enterprise-grade means clean contracts and strong foundations. It does not mean enterprise infrastructure.

Stack: Supabase (Postgres, Auth, Storage, Edge Functions), Netlify static hosting, Stripe, Resend, Anthropic API.
Key artifacts: admin panel `dds-studio-manage-9k2p.html` (~1.3MB single file), client portal `portal.html`, edge function (~11K lines, ~184 routes; authoritative file to be confirmed, verify in repo audit).

## 2. Non-negotiable working rules

1. Complete deploy-ready files only. Never partial implementations, patches, or snippets.
2. Read the actual code before making any claim about it. The repo has a history of stale duplicate edge function files causing production incidents. Confirm the authoritative deployed function with Eric (he will paste deployed source from the Supabase dashboard) before editing anything.
3. Never assume. Anything unverified is marked "verify in repo audit."
4. Never invent product data, anywhere, ever. If data is missing, the product says so.
5. Plain language. No em dashes in user-facing copy.
6. Existing production functionality keeps working at every step. Every change deploys incrementally. Never leave production half-migrated overnight.
7. All schema changes are forward-only migration files in the repo, numbered, each with a written rollback note. No dashboard-only schema changes.
8. Deployment variance is config-only (environment variables). Never per-environment code edits.
9. Every major decision gets a short written rationale (ADR style) in the repo.
10. Money is integer cents. Timestamps are UTC (timestamptz). Database identifiers are snake_case; mapping to camelCase happens only at the API edge.

## 3. Final architectural decisions (closed, do not reopen)

- Modular monolith with hard internal boundaries. No microservices, no event bus, no framework rewrite.
- True multi-tenancy (SharedSchema) inside one shared platform is the build. White-label physical isolation is deferred as a possible future premium option.
- TenancyProvider abstraction: all tenant resolution goes through one contract. SharedSchema is the first implementation.
- Single AI Gateway: no route calls the Anthropic API directly.
- Entitlements model: every limit and feature check reads entitlements, never plan names.
- Append-only billing ledger: modules emit usage/charge events; billing consumes the ledger.
- Every request passes one pipeline: identity -> tenant -> authorization -> revocation check -> rate limit -> handler -> audit hook.
- tenant_id on every tenant-owned table from day one.
- One canonical repo, staging before production, scripted deploys.

## 4. Final build scope

Everything in sections 6 through 15, and nothing in sections 17 and 18. Scope additions during build require Eric's explicit approval in writing.

## 5. Build order (dependency order, do not resequence)

0. Repo audit (separate instruction already prepared): confirm authoritative function, inventory routes and tables, map routes to modules, validate pipeline feasibility. Output feeds every later step.
1. Environments and migration tooling: staging Supabase project, Netlify preview deploys, migration runner, secrets/config inventory per environment.
2. Request pipeline middleware and route registry with API conventions (section 14).
3. Tenancy: tenants table, tenant lifecycle states, tenant_id migration and backfill, SharedSchema TenancyProvider, RLS policies, service-role bypass fix. Isolation test suite proves it before proceeding.
4. Entitlements: plans, plan entitlements, tenant overrides, seeded with the four public plans plus the Founder override.
5. AI Gateway: single door, model routing, prompt-injection protection, usage ledger with prompt versions, output retention, notices, spend circuit breaker.
6. Billing: subscriptions with trials, ledger consumption, nightly Stripe usage reporting for overage, packs, dunning, proration, webhook idempotency, scheduled jobs with job-run logging.
7. Files: tenant-prefixed storage paths, object migration, storage RLS.
8. Ops: structured logging floor, audit trail, health check, backup/restore tooling with one real tested restore, export route, retention scheduler with manual-confirm deletion, incident one-pager.
9. Onboarding automation: provision-tenant route (create tenant, seed entitlements, invite owner), Eric's usage dashboard view, licensee usage meter.
10. Identity completion: memberships with roles enforced server-side; owner-only UI.

## 6. Modules and ownership boundaries

Each route, table, and UI section belongs to exactly one module. The repo audit assigns all existing routes a module home.

1. **Identity & Access**: auth, memberships (user_id, tenant_id, role: owner/admin/staff/read), sessions, revocation. Contract: every request yields {user_id, tenant_id, role} or is rejected. No other module parses JWTs.
2. **Tenancy**: tenant records, lifecycle state machine (trialing, active, past_due, suspended, closed, purge_scheduled), TenancyProvider. No other module knows how isolation works.
3. **Clients & CRM**: client records, leads, intake, onboarding state.
4. **Work**: projects, deliverables, journal, growth partnership records.
5. **Communication**: messages, notifications, all outbound email (Resend). Single notification-event door; all sends go through it.
6. **Files**: uploads, signed URLs, listing, deletion. Owns the path convention {tenant_id}/{client_id}/... No other module constructs storage paths.
7. **Billing**: 7a platform billing (licensees paying Studio OS) and 7b client payments (a licensee's clients paying the licensee), firewalled from each other. 7b remains on current single-account behavior for Eric's own tenant; Stripe Connect is deferred.
8. **AI Gateway**: the only door to Anthropic. Owns routing, trust boundaries, metering, logging, retention, circuit breaker.
9. **Analytics & Reporting**: GA4/Search Console, report generation. Read-only consumer of other modules through their contracts.
10. **Platform Ops**: audit trail, export, backup/restore, retention, health, job runs, rate-limit state.

Frontend rule: admin panel and portal are pure API clients. No business rule (limit, price, permission) exists only in the frontend.

## 7. Database standards

- snake_case names. uuid primary keys. Every tenant-owned table: id, tenant_id (not null), created_at, updated_at.
- Money: integer cents. Time: timestamptz UTC.
- Foreign keys with explicit ON DELETE behavior.
- Append-only tables (audit_log, ai_usage, billing_ledger, job_runs, processed_webhook_events): never updated or deleted by application code; hard deletion only via the retention scheduler.
- Soft delete policy: pending Open Decision (recommended: deleted_at on tenant business records; hard delete only via retention scheduler).
- external_ref (nullable text) column convention on clients and projects for future data import provenance.
- Migrations: forward-only, numbered, in repo, applied to staging first, each with a rollback note.
- Existing schema state: verify in repo audit (known history of drift between dashboard and repo).

## 8. Tenancy requirements

- tenants table with lifecycle state; every state transition writes to the audit trail.
- tenant_id added to every tenant-owned table (enumerate from live schema, verify in repo audit) and backfilled to Eric's tenant as tenant #1. Migration reversible.
- RLS enabled and enforced on every tenant-owned table, scoped by tenant membership. The service-role bypass is closed: runtime reads execute under the caller's JWT (or a scoped mechanism validated in the repo audit), with tenant_id predicates in queries as defense in depth. Service role is reserved for system jobs, which are audited.
- TenancyProvider resolves tenant from verified identity; suspended and closed tenants are rejected at the pipeline with a clear message.
- Eric's production tenant behaves identically before and after migration.

## 9. Entitlements requirements

- plans (starter, professional, business, agency, founder-internal), plan_entitlements (key, value), tenant_entitlement_overrides.
- Entitlement keys at minimum: max_active_clients, ai_actions_included, team_seats, white_label, growth_module, per-tenant rate ceilings (seam now, enforce before public launch).
- Seeded values: Starter 49 USD/mo, 5 clients, 250 actions. Professional 99, 20 clients, 1,000 actions. Business 199, unlimited clients, 3,000 actions, white_label, 3 seats. Agency 399+, 10,000 pooled actions (not published). Founder: Starter-tier price of 49 locked for life with Professional entitlements, six-month trial.
- Every limit check in the platform reads entitlements. Plan names never appear in enforcement logic. Overrides beat plan defaults. This mechanism doubles as per-tenant feature flags.

## 10. AI Gateway requirements

- Single gateway contract: request({tenant, route, task_class, inputs}) -> {output, usage_row_id}. All existing AI routes are refactored to pass through it (route list: verify in repo audit).
- Model routing by task_class: small model for short actions (quick critiques, suggestions, drafts), flagship model for reports and deep analysis.
- **Prompt-injection protection (required, day one):** all client-supplied or externally sourced content (portal messages, intake answers, survey text, file names, imported data) is untrusted. The gateway wraps untrusted content in delimited data blocks; system prompts state that such blocks are quoted material and never instructions; instructions come only from Studio OS templates. Outputs quoting client text render it as quotation. Add adversarial test inputs to the test suite (a message containing instructions must not alter AI behavior).
- Honest-data policy enforced in the gateway: prompts are constructed only from real records; templates instruct the model to state when data is missing rather than estimate. No route may bypass this.
- Metering: every generation writes one ai_usage row (tenant_id, route, task_class, model, prompt_template_version, input_tokens, output_tokens, cost_estimate_cents, status). Failed generations: pending Open Decision (recommended: logged with status failed, not counted toward allowance).
- Output retention: generated output stored linked to the usage row, full text for 90 days, then reduced per retention policy.
- Allowance state per tenant per period; soft cap only. Nothing blocks at any threshold.
- Notices, verbatim, no em dashes:
  - At 80 percent: "You've used most of this month's included AI. Everything keeps working past the limit. Extra actions are $0.20 each, or 500 for $19."
  - At 100 percent: "You've used your included AI for this month. Nothing has stopped. Extra actions are $0.20 each and will appear on your next invoice, or add a 500-action pack for $19."
- Global spend circuit breaker: platform-wide monthly AI spend threshold that alerts Eric when crossed (alert, never block).
- Prompt templates are versioned constants; the version is recorded on every usage row.

## 11. Billing requirements

- Platform subscriptions in Stripe: monthly and annual prices for each public plan; Founder subscription created on day one with a six-month trial and card on file, converting automatically to 49 USD/mo.
- Billing ledger (append-only): AI overage events, pack purchases, session charges, adjustments. Stripe is the payment truth; the ledger is the usage/charge truth; reconciliation between them is a scheduled job.
- Overage: beyond allowance, each action accrues 20 cents to the ledger; a nightly job reports usage to Stripe metered billing. Invoice line item text: "AI actions beyond plan allowance."
- Packs: 500 actions for 19 USD via Stripe Checkout; an idempotent webhook credits pack_actions_remaining. Pack consumption order: pack credits before per-action overage. Pack expiry: pending Open Decision (recommended: never).
- Webhook idempotency: processed_webhook_events table keyed by Stripe event id; every handler is idempotent by construction; replayed events are no-ops. Signature (HMAC) verification on all webhooks, as the existing webhook does (verify in repo audit).
- Dunning: failed payment moves tenant to past_due; Stripe Smart Retries enabled; founder agreement's 14-day cure honored; unresolved past_due moves to suspended (access blocked with a clear message, data intact); founder rate preserved 60 days after suspension per the agreement.
- Proration: upgrades prorate immediately; downgrades take effect at period end. (Add one sentence to the ToS.)
- Refund handling: 30-day pro rata on annual per ToS, executed as a documented admin procedure. Dispute webhooks recorded; admin procedure documented. Stripe Tax: before public launch, not now.
- Trials, conversion, cancellation, and month-seven founder billing are all testable with Stripe test clocks (see section 15).

## 12. Security requirements

- RBAC: memberships table (owner/admin/staff/read); pipeline enforces a declared minimum role per route. Owner-only UI for now; enforcement is complete regardless.
- RLS on every tenant-owned table and on storage; the isolation test suite is the proof, not code review.
- Session revocation: the pipeline rejects requests when tenant state is suspended/closed or when the membership was modified after token issuance. Effect within minutes, not token expiry.
- Audit trail: append-only audit_log with actor, tenant, action, target, timestamp, and request id. Security events (auth failures, permission denials, impersonation) are logged with distinct event types.
- Impersonation: architecture reserved now (session type flag + audit tagging in the pipeline design); the feature itself is deferred to before public launch. Founders consent informally in advisory sessions until then.
- Secrets: environment variables only; per-environment inventory documented with rotation cadence. No secret ever in code or in the frontend beyond the Supabase anon key.
- Rate limiting: durable store (table-backed), per-IP now; per-tenant ceilings read from entitlements before public launch (seam now).

## 13. Operations requirements

- Environments: staging Supabase project and Netlify preview context exist before any other build step. All migrations and deploys hit staging first, always.
- Deployment: scripted and repeatable from the canonical repo (CI, e.g. GitHub Actions with the Supabase CLI). Rollback story: forward-fix plus tested restore; documented.
- Health check: an endpoint reporting function liveness and database reachability.
- Scheduled jobs (pg_cron): monthly allowance reset, nightly Stripe usage reporting, retention clock, backup verification, ledger reconciliation. Every job writes a job_runs row (job, started, finished, status, detail). Every job is idempotent (safe to run twice). A job that has not run on schedule is visible to Eric.
- Backup and restore: automated backups verified by a job; one full restore rehearsed on staging before founder #1. DR targets: RPO 24 hours, RTO 1 business day (tighten before public launch).
- Export: per-tenant export route producing JSON plus a files manifest, owner-role only, audited.
- Retention: 90 days after closure, purge_scheduled; deletion executes only after manual confirmation by Eric (an automation bug must never be able to mass-delete tenant data).
- Structured logging: request id and tenant id on every pipeline pass; consistent error taxonomy; logs are the seam for any future observability stack.
- Incident response one-pager and status-communication template exist in the repo before founder #1.

## 14. API conventions

- Route registry: every route declares module, version, minimum role, cost-bearing flag (auto-attaches metering), and rate class. New routes cannot be added outside the registry.
- One response envelope for all routes; one error taxonomy with stable machine-readable codes.
- Versioning: version recorded per route in the registry; breaking changes require a new version entry, never mutation of a live contract.
- Pagination: mandatory on all new list routes; existing routes adopt it when touched (full retrofit is deferred).
- Idempotency keys accepted on mutating billing-adjacent routes.
- The registry doubles as the API documentation source. Existing route behavior: verify in repo audit.

## 15. Testing requirements

- Isolation suite (the gate for step 3): tenant A's authenticated session cannot read, list, write, or delete any tenant B row or file. Run against real roles via real queries on every deploy. Includes storage paths and signed URLs.
- Pipeline contract tests: unauthenticated, wrong-role, suspended-tenant, and revoked-membership requests are rejected with the correct error codes.
- AI Gateway tests: metering writes exactly one row per generation; failed generations behave per the decided policy; notices trigger at exact thresholds; adversarial injection inputs do not alter behavior; the honest-data missing-data path states absence rather than estimating.
- Billing tests: Stripe test clocks prove trial conversion at month seven, dunning transitions (past_due, cure, suspension), proration on upgrade, overage reporting, and pack crediting. Webhook replay produces no double effects.
- Job tests: every scheduled job run twice in a row produces the same end state.
- The suite runs in CI against staging before any production deploy.

## 16. Acceptance criteria (definition of done for founder launch)

1. Isolation suite passes on staging and production. Eric's tenant #1 data intact and fully functional throughout.
2. Provisioning a new tenant is one route call: tenant created, entitlements seeded, owner invited, portal reachable.
3. Founder subscription exists from day one with trial and card on file; test-clock conversion at month seven succeeds; dunning path honors the 14-day cure.
4. Every AI generation is metered, versioned, retained, and injection-protected; notices appear at 80 and 100 percent with the exact locked copy; nothing ever blocks.
5. Overage accrues to the ledger and reports to Stripe nightly; packs credit idempotently; replayed webhooks are no-ops.
6. Entitlements enforce all limits; the Founder override (Starter price, Professional entitlements) works; no plan name appears in enforcement logic.
7. A suspended tenant loses access within minutes; every privileged action appears in the audit trail with a request id.
8. One real restore has been rehearsed; export route delivers a complete tenant archive; retention scheduler marks but does not delete without manual confirmation.
9. All scheduled jobs log runs and are provably idempotent; the health check reports honestly.
10. Founder agreement (post attorney review) signed before any founder's access begins; legal pack published; pricing page wording says "typically" on response times.

## 17. Deferral registry (seams preserved, do not build)

Stripe Connect (Billing 7b firewall). Self-serve signup and public checkout (Billing 7a + Identity). Seat management UI and staff/read role UIs (memberships already model them; gates public launch of Business seats). Impersonation feature (architecture reserved in pipeline). Per-tenant rate ceiling enforcement (entitlement key exists). Stripe Tax, dispute tooling beyond recording (Billing). PII inventory automation (Ops; manual for founders). Pagination retrofit of existing routes (adopt when touched). Data importers (external_ref convention exists). Notification preferences and digests (single notification door exists). Observability stack beyond the logging floor. Frontend modularization of the 1.3MB admin file. White-label physical isolation as a premium option (TenancyProvider seam). Multi-provider AI adapters (thin seam in the Gateway). Evals program (prompt versions + retained outputs are the seam). SOC 2 / GDPR programs. Marketplace, public API keys, templates. Tighter DR targets. Continuity/credential escrow package (before public launch, not in this build).

## 18. Explicit list of things not to build

Kubernetes or containers. Microservices. Event buses or queues. GraphQL. A React or framework rewrite of the admin panel or portal. Multi-region anything. A BI system (the usage dashboard is simple views over the ledger). Automated deletion without manual confirmation. Any billing through Apple. Any AI route outside the Gateway. Any feature gated on plan names instead of entitlements. Any schema change outside a migration file. Anything sized for a customer count Studio OS does not have.

---

## Decisions: answered and locked (July 5, 2026)

1. **Founder cap**: 8 founder seats.
2. **Failed AI generations**: logged with status failed, do not count toward allowance. User-triggered retries count.
3. **Support response wording**: "typically" on all published response times. Business support is "typically next business day" while Eric's day job continues.
4. **Hettie Orange Designs**: custom hybrid arrangement unless Eric explicitly converts her later. Does not count against the 8 founder seats yet.
5. **Attorney review**: owner and date pending. HARD GATE: legal publication and signed founder agreements are blocked until attorney review is complete. Build proceeds; founder access does not.
6. **First cohort targets**: pending. Build does not require names. HARD GATE: founder access cannot begin until at least one approved target is named.
7. **Soft delete**: approved. deleted_at on tenant business records; hard delete only through the retention scheduler with manual confirmation.
8. **Packs**: never expire.
9. **Repo-audit-dependent decisions**: approved as written. If the audit shows the pipeline cannot be adopted incrementally, pause and report to Eric before choosing any workaround.

This brief is now fully closed. Hand Claude Code, in order: (1) the repo audit prompt, then (2) this brief. Build step zero begins with the audit; implementation begins only after Eric approves the audit.
