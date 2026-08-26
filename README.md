# Studio OS

A production business-operations platform for a web design studio — CRM, project delivery, client portal, proposals, invoicing, and AI-assisted workflows — running live at [davisdigitalstudio.com](https://davisdigitalstudio.com).

Built and operated solo by [Eric Davis](https://github.com/edavis71433). This is not a tutorial project or a course exercise: it is the real system that runs Davis Digital Studio day to day, currently being converted from a single-tenant application into a multi-tenant SaaS product.

---

## What it does

| Area | Capability |
|---|---|
| **CRM & pipeline** | Contacts, companies, deal stages, attention queue, revenue-at-risk and churn-risk signals |
| **Project delivery** | Project roster and record pages, milestones, approval center, client-facing status |
| **Client portal** | Separate authenticated surface for clients — documents of record, approvals, messaging |
| **Money** | Proposals, contracts, Stripe subscriptions with trials, usage-based overage, dunning, proration |
| **AI** | Drafted replies, project help, SEO/site critique — all routed through a single AI gateway |
| **Ops** | Structured request logging, audit trail, health checks, backup/restore tooling, data export |

## Architecture

A **modular monolith** with hard internal boundaries — deliberately not microservices.

```
Browser (static HTML/CSS/JS, no framework)
        │
        ▼
Netlify CDN  ──  build-public.sh publishes an allowlisted dist/, never the repo root
        │
        ▼
Supabase Edge Function  (Deno / TypeScript, ~165 routes)
        │
        ├── request pipeline: identity → tenant → authorization → revocation
        │                     → rate limit → handler → audit hook
        │
        ▼
Postgres (~103 tables, row-level security)  +  Storage  +  Auth
        │
        └── Stripe · Resend · Anthropic API
```

**Design decisions worth calling out:**

- **True multi-tenancy on a shared schema.** `tenant_id` on every tenant-owned table, enforced by RLS, with a `TenancyProvider` abstraction so all tenant resolution goes through one contract.
- **Entitlements, not plan names.** Every limit and feature check reads an entitlements record. Plans are data, not branching logic.
- **Single AI gateway.** No route calls the Anthropic API directly. One door means one place for model routing, prompt-injection protection, usage metering, and a spend circuit breaker.
- **Append-only billing ledger.** Modules emit usage and charge events; billing consumes the ledger rather than reaching into module tables.
- **Forward-only migrations.** 116 numbered SQL migrations in the repo, each with a written rollback note. No dashboard-only schema changes.
- **Money is integer cents. Timestamps are UTC.** Database identifiers are `snake_case`; the mapping to `camelCase` happens only at the API edge.

## Tech stack

**Backend** Supabase (Postgres, Auth, Storage, Edge Functions) · Deno · TypeScript
**Frontend** Vanilla HTML/CSS/JavaScript — 84 pages, no framework, no build step for the app itself
**Infrastructure** Netlify · GitHub Actions
**Integrations** Stripe · Resend · Anthropic API

## Testing & CI

- **19 Playwright end-to-end specs** covering the real browser flows, including mobile viewports
- **Accessibility assertions** via `@axe-core/playwright` on key pages
- **Tenant isolation test suite** that must pass before any tenancy change ships
- **Five GitHub Actions workflows**: `ci`, `e2e`, `deploy`, `rollback`, `schema-dump`

```bash
npm install
npm run serve        # static server on :4173
npm run test:e2e     # Playwright suite
```

## Repository layout

```
*.html, *.css, *.js       the application surfaces (admin, portal, marketing site)
supabase/functions/       edge functions — clever-api is the main one
supabase/migrations/      116 forward-only numbered migrations
tests/                    e2e, isolation, smoke, presence
docs/adr/                 architecture decision records
docs/legal/               published policies (privacy, DPA, AUP, retention, …)
docs/runbooks/            operational runbooks
scripts/build-public.sh   allowlist build — decides what reaches the CDN
```

## Project status

Live in production as a single-tenant system. The multi-tenant SaaS conversion is in progress, sequenced so production keeps working at every step — environments and migration tooling, then the request pipeline, tenancy, entitlements, AI gateway, billing, files, ops, onboarding, and identity, in that dependency order.

## A note on what's public

This repository contains the application source, schema migrations, and published policy documents. Secrets live in environment variables and are never committed; `docs/SECRETS-INVENTORY.md` lists which variables exist without their values. The Supabase keys visible in client code are anonymous publishable keys, which are safe by design — access is enforced by row-level security, not by key secrecy.

---

*Questions or hiring conversations: [davisdigitalstudio.com](https://davisdigitalstudio.com)*
