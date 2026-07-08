# Studio OS Presence — Documentation (Version 1)

**Start here.** This is the single entry point to every Studio OS Presence document. If you are inheriting this system, read this page, then the [V1 System Reference](V1-SYSTEM-REFERENCE.md), then the [Constitution](constitution/). That is enough to understand, run, and extend the platform.

> **Status:** Version 1 is **feature-frozen** and **QA-passed** (see [QA-RELEASE-VERIFICATION](QA-RELEASE-VERIFICATION.md)). The codebase is deployed to staging + prod; the customer-facing static pages are committed but **not pushed** (an intentional go-live gate — see [Owner Activation](RELEASE-NOTES.md#owner-activation-checklist)).

---

## What is this system, in three sentences

Studio OS Presence is a calm SaaS that keeps a small business's public presence — website, listings, reviews, analytics — correct, found, and growing, without the owner becoming a webmaster. The owner states **facts** (hours, menu, story); the platform owns **presentation** deterministically (one renderer, one pipeline, every version kept). Intelligence flows one way — **Evidence → Judgment → Recommendation → Business Moments → Concierge** — and anything that changes the world outside the customer's draft goes through **one approval spine**.

The two architectural spines, frozen, are the whole system in miniature — see [PLATFORM-CONTRACTS](PLATFORM-CONTRACTS.md).

---

## New team: could you do each of these? (each links to the answer)

| I need to… | Read |
|---|---|
| Understand the system in a day | [V1 System Reference](V1-SYSTEM-REFERENCE.md) → [Constitution](constitution/03-final-constitution.md) |
| Deploy it | [Deployment & Operations](DEPLOYMENT-AND-OPERATIONS.md) |
| Recover production | [Deployment & Operations § Rollback/DR](DEPLOYMENT-AND-OPERATIONS.md#rollback--disaster-recovery) + [runbooks/](../runbooks/) |
| Debug a failing request | [API Reference](API-REFERENCE.md) (boundary order + error codes) + [V1 System Reference § Request Flow](V1-SYSTEM-REFERENCE.md#request-flow) |
| Add a feature (safely) | [V1 System Reference § Extension rules](V1-SYSTEM-REFERENCE.md#extension--what-can-and-cannot-change) + [PLATFORM-CONTRACTS](PLATFORM-CONTRACTS.md) |
| Add an Industry Pack | [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md) |
| Add a Connected Provider | [CONNECTED-PLATFORM § adding a provider](CONNECTED-PLATFORM.md) |
| Support a customer | [Customer Guide](CUSTOMER-GUIDE.md) + [runbooks/](../runbooks/) |
| Turn the product on (keys) | [Owner Activation Checklist](RELEASE-NOTES.md#owner-activation-checklist) |
| Know what's deferred / owed | [Release Notes § Tech Debt + V1.1](RELEASE-NOTES.md) |

---

## The authoritative documents (one source of truth per topic)

### Executive & Architecture
- **[V1 System Reference](V1-SYSTEM-REFERENCE.md)** — executive overview, architecture, subsystem map, feature inventory, and every flow (request, approval, publishing, AI, connected, enterprise, agency, pack, visual, commerce). **The current, whole-platform picture.**
- **[PLATFORM-CONTRACTS](PLATFORM-CONTRACTS.md)** — the frozen contracts + the 14 machine-enforced invariants. *What must never change.*
- **[Constitution](constitution/)** — the Product Laws and the reasoning behind them (9 parts + amendments). *The supreme authority; when any doc disagrees with the constitution, the constitution wins.*

### Engineering
- **[V1 System Reference](V1-SYSTEM-REFERENCE.md)** (folder structure, coding standards, extension rules)
- **[API Reference](API-REFERENCE.md)** — every route, the envelope, auth, gating, boundary order.
- **[Database](DATABASE.md)** — all 54 tables, the RLS model, and the migration reference.
- **[Environment & Secrets](ENV-AND-SECRETS.md)** — every variable, required vs optional, per environment.
- **[Testing](V1-SYSTEM-REFERENCE.md#testing)** — how the 44 suites run (pure + live-staging integration).

### Frontend / Browser
- **[Browser Platform Completion](BROWSER-PLATFORM-COMPLETION.md)** — the frontend/UX/a11y/performance/security review of the customer browser app, the browser risk register, and the completion checklist (Must-Before-QA / Recommended / V1.1).

### Operations
- **[Operations & Production Readiness](OPERATIONS-PRODUCTION-READINESS.md)** — the SRE/DevOps audit: monitoring, alerting, backups/DR, reliability, security ops, the Infrastructure Risk Register, and the production/launch checklists.
- **[Deployment & Operations](DEPLOYMENT-AND-OPERATIONS.md)** — deploy technique (function + migration hold-back), monitoring, logging, backups, rollback, disaster recovery, maintenance, production checklist.
- **[RUNBOOKS](RUNBOOKS.md)** + **[runbooks/](../runbooks/)** — step-by-step operator procedures (new customer, domain, DNS, promotion, byte-check).
- **[OPERATIONS](OPERATIONS.md)** — the L2 operational model (capacity, metering, the unattended cycle).

### Architecture & Permissions
- **[Workspace Implementation (A7)](WORKSPACE-IMPLEMENTATION-A7.md)** — the built foundation: site roles + the Presence `client_visible` visibility model + `/portal/*` API + developer-mode hook + canonical naming (tested, deployed); the client-portal/agency UIs staged on it.
- **[Workspace Architecture, Visibility & Experience (A6)](WORKSPACE-ARCHITECTURE-A6.md)** — the whole-platform workspace/cohesion/navigation/Developer-Mode/UX review + role matrix + implementation plan (design only).
- **[Client Portal Visibility & Permission Model](CLIENT-PORTAL-VISIBILITY-MODEL.md)** — the detailed audience/surface/client-portal visibility matrices, permission gap analysis, and the freelancer→client exposure model (design only).

### Security & Privacy
- **[SECURITY](SECURITY.md)** — authentication, authorization, RLS, approval enforcement, encryption, secrets, tenant/org/agency isolation, AI safety, Visual/Connected security, and the security checklist.
- **[Data Governance & Privacy Audit](DATA-GOVERNANCE-PRIVACY-AUDIT.md)** — the verified data inventory, classification, flows, AI/Connected/Visual/Commerce data handling, customer rights, retention, the privacy risk register, and the compliance mapping the legal documents must match.

### Customer & Support
- **[Customer Guide](CUSTOMER-GUIDE.md)** — administrator + customer user guide, onboarding, per-feature how-to, FAQ, troubleshooting, known issues, support.

### Release
- **[Remaining Engineering Roadmap (LOCKED)](ROADMAP-LOCK.md)** — the permanent post-RC1 roadmap: V1 finish-up (connected completion, CI, type cleanup, docs), Developer Mode, Desktop, Mobile, CRM, Packaging, then Website → Onboarding → Owner Activation → Launch. Nothing removed.
- **[Release Candidate RC1](RELEASE-CANDIDATE-RC1.md)** — the V1 capstone: completion report, full inventory, frozen-architecture verification, documentation verification, and the `v1.0.0-rc1` release recommendation.
- **[Release Notes](RELEASE-NOTES.md)** — V1 release notes, full version history (M1 → L5.9 + Visual Studio), the **Technical Debt Register**, the **Version 1.1 Backlog**, and the **Owner/Production Activation Checklists**.
- **[Full-System QA](FULL-SYSTEM-QA.md)** — the master QA pass (every area), the QA matrix, link audit, per-area reports, bug/fix logs, and the release recommendation.
- **[QA-RELEASE-VERIFICATION](QA-RELEASE-VERIFICATION.md)** — the deep QA pass and its verdict.
- **[Audit Findings Implementation](AUDIT-FINDINGS-IMPLEMENTATION.md)** — the Critical/High/Must-Before-QA findings and their resolution.
- **[PRODUCT-FREEZE](PRODUCT-FREEZE.md)** — the feature-freeze audit.

### Per-subsystem deep dives (reference depth)
Intelligence pipeline: [EVIDENCE-ENGINE](EVIDENCE-ENGINE.md) · [JUDGMENT-ENGINE](JUDGMENT-ENGINE.md) · [RECOMMENDATION-ENGINE](RECOMMENDATION-ENGINE.md) · [MOMENTS-ENGINE](MOMENTS-ENGINE.md) · [CONCIERGE](CONCIERGE.md) · [OPTIMIZATION-ENGINE](OPTIMIZATION-ENGINE.md)
Creative/AI: [AI-WRITER](AI-WRITER.md) · [AI-EDITOR](AI-EDITOR.md) · [AI-REVIEWER](AI-REVIEWER.md) · [BRAND-GUARDIAN](BRAND-GUARDIAN.md) · [GROWTH-COACH](GROWTH-COACH.md)
Connected: [CONNECTED-PLATFORM](CONNECTED-PLATFORM.md) · [CONNECTED-PROVIDERS-READ](CONNECTED-PROVIDERS-READ.md) · [CONNECTED-INTELLIGENCE](CONNECTED-INTELLIGENCE.md) · [CONNECTED-WRITES](CONNECTED-WRITES.md) · [CONNECTED-PLATFORM-VALIDATION](CONNECTED-PLATFORM-VALIDATION.md) · [CONNECTED-CUSTOMER-EXPERIENCE](CONNECTED-CUSTOMER-EXPERIENCE.md)
Industry/Marketplace: [INDUSTRY-PLATFORM](INDUSTRY-PLATFORM.md) · [RESTAURANT-PACK](RESTAURANT-PACK.md) · [PACK-EXPANSION](PACK-EXPANSION.md) · [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md) · [MARKETPLACE](MARKETPLACE.md)
Scale: [ENTERPRISE](ENTERPRISE.md) · [AGENCY-PLATFORM](AGENCY-PLATFORM.md) · [AGENCY-ENTERPRISE-OPS](AGENCY-ENTERPRISE-OPS.md)
Product surfaces: [AI-VISUAL-STUDIO](AI-VISUAL-STUDIO.md) · [PRESENCE-MONITOR](PRESENCE-MONITOR.md) · [COMMERCE](COMMERCE.md) · [PLATFORM-SERVICES](PLATFORM-SERVICES.md) · [PLATFORM-SPINE](PLATFORM-SPINE.md)

---

## Historical / point-in-time documents (NOT living reference)

These recorded a decision or a review at a moment in time. They are kept for provenance but are **superseded** — do not treat them as the current state. The current state is in the authoritative docs above.

- **Superseded reference:** `ENGINEERING-ATLAS.md` (frozen at M8.5 — depth on M1–M8.5 only; for the whole platform use the [V1 System Reference](V1-SYSTEM-REFERENCE.md)), `API-INVENTORY-v1-FROZEN.md` (M5 surface only — use the [API Reference](API-REFERENCE.md)), `docs/SECRETS-INVENTORY.md` & `docs/PRODUCTION-BASELINE.md` (pre-Presence-pipeline baselines — use [Environment & Secrets](ENV-AND-SECRETS.md) / [Deployment & Operations](DEPLOYMENT-AND-OPERATIONS.md)).
- **Point-in-time reviews/plans (historical):** `LAUNCH-READINESS.md`, `LAUNCH-BOARD.md`, `PRODUCT-COMPLETION.md`, `PRODUCT-SURFACE.md`, `PUBLIC-EXPERIENCE.md`, `V1-CUSTOMER-WORKFLOW.md`, `V1-FEATURE-COMPLETION.md`, `M9.5F-ARCHITECTURE-REVIEW.md`, `M9.5G-CONSOLIDATION.md`, `M14.5-PLATFORM-RECONCILIATION.md`, `L1.5-COMMERCIAL-VALIDATION.md`, `L3-PROMOTION-AUDIT.md`, and the `L3.x`/`OPTIMIZATION-ENGINE-FOUNDATION` milestone-audit notes. Their conclusions are folded into the authoritative docs.

---

## Conventions across all docs

- **Why / How / Maintain / Extend / Never-change / Safe-to-change** — each authoritative doc answers these.
- **The constitution is supreme.** Then the frozen contracts, then the code, then everything else.
- **Plain language for customers, precise language for engineers.** No customer-facing doc contains scores, tokens, or software jargon (Law 13).
- **Environments:** staging `wjlpursnwbmlcdwbeowv`, production `qksstlqzbhesadrrofgn`. Same code, different config only.
