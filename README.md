# Studio OS

A website builder and back office for small businesses and the web studios that serve them — the site itself, the customers and deals around it, the projects, the money and the client portal — running live for [Davis Digital Studio](https://davisdigitalstudio.com).

Built and operated solo by [Eric Davis](https://github.com/edavis71433). This is not a tutorial project or a course exercise: it is the real system Davis Digital Studio runs on, and the product it offers to other studios and businesses.

---

## What it does

| Area | Capability |
|---|---|
| **Website builder** | Eight templates, a section editor on a live canvas, pages and menus, versions and checkpoints, preview links with comments, scheduled publishing, custom domains |
| **On the live site** | Contact forms, bookings, reviews, and a first-party visit counter — no third-party tracking |
| **Customers & pipeline** | Contacts, customer records, deals and stages, to-dos, saved views, reports |
| **Money** | Estimates, proposals, agreements with e-signature, invoices (one-off, scheduled or recurring), deposits, retainers (Stripe); the platform's own plans and trials |
| **Projects & client portal** | Projects, tasks, milestones, deliverables and approvals; a separate signed-in portal where clients see progress, message, upload and pay |
| **Studios** | A studio works inside its clients' sites through a checked scope, with roles for its team and for the client's own people |
| **AI** | Drafting and rewriting copy, a site reviewer, a brand guardian, a growth coach, image generation — metered against the plan's AI allowance |
| **Ops** | A 15-minute scheduled tick (publishing, reminders, reconciliation, retention), an error ledger, health checks, rollback and schema-dump workflows |

## Architecture

A **modular monolith** with hard internal boundaries — deliberately not microservices.

```
Browser (static HTML/CSS/JS, no framework)
        │
        ▼
Netlify CDN  ──  build-public.sh publishes an allowlisted dist/, never the repo root
        │
        ▼
Supabase Edge Function "presence"  (Deno / TypeScript, one router)
        │
        ├── request boundary: sign-in → whose site (own · a studio's checked scope ·
        │   an invited seat) → entitlement → role limits → edition features → route
        │
        ▼
Postgres (row-level security)  +  Storage  +  Auth  +  pg_cron
        │
        └── Stripe · Resend · Netlify · Google · Anthropic API
```

**Design decisions worth calling out:**

- **Every request answers for one site.** The router resolves the caller's site once — their own under row-level security, or a client's when a studio's scope is re-checked against its membership — and every route works inside it. A refused scope never falls back to another site.
- **Entitlements, not plan names.** What a site may do comes from its entitlement and edition; plans are data, not branching logic.
- **Roles are a table, not scattered checks.** Every write a team member can reach is listed once (`lib/site_roles.ts`) with the capability it needs; an unlisted write is refused.
- **Approval before change.** DNS, email-setup and connected-service changes are prepared as plans that someone approves before anything moves.
- **Forward-only migrations.** Numbered SQL files, never edited once applied; production gets each one from a re-runnable apply pack (`supabase/migrations/README.md`).
- **Money is integer cents. Timestamps are UTC.**

## Tech stack

**Backend** Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron) · Deno · TypeScript
**Frontend** Vanilla HTML/CSS/JavaScript — no framework, no build step for the app itself
**Infrastructure** Netlify · GitHub Actions
**Integrations** Stripe · Resend · Netlify · Google (Search Console, Analytics) · Anthropic API

## Testing & CI

As of November 2026:

- **64 Playwright specs** across desktop, tablet and phone, against stubbed backends (no secrets, no live data)
- **327 Deno suites** for the server and the pages' logic, plus a typecheck of the whole function
- **Accessibility assertions** via `@axe-core/playwright` on key pages
- **Six GitHub Actions workflows**: `ci`, `e2e`, `isolation` (the walls between studios, on a scratch database, with every deploy), `deploy` (by hand, after the checks), `rollback`, `schema-dump`

```bash
npm ci
npm run serve        # static server on :4173
npm run test:e2e     # Playwright suite
DENO=deno bash scripts/ci-pure-tests.sh   # the Deno suites, as CI runs them
```

## Repository layout

```
*.html, *.css, *.js       the app's pages, the marketing site and the free tools
supabase/functions/       edge functions — presence is the app's whole API
supabase/migrations/      forward-only numbered migrations
supabase/ops/             hand-run SQL for the scheduled jobs
tests/                    e2e (Playwright), presence (Deno), workflows, isolation, smoke
docs/legal/               published policies (privacy, DPA, AUP, retention, …)
docs/runbooks/            operational runbooks
scripts/build-public.sh   allowlist build — decides what reaches the CDN
```

## Project status

Live in production. New work lands through pull requests, and the server ships only when the deploy workflow is run by hand.

## A note on what's public

This repository contains the application source, schema migrations, and published policy documents. Secrets live in environment variables and are never committed; `docs/SECRETS-INVENTORY.md` lists which variables exist without their values. The Supabase keys visible in client code are anonymous publishable keys, which are safe by design — access is enforced by row-level security, not by key secrecy.

---

*Questions or hiring conversations: [davisdigitalstudio.com](https://davisdigitalstudio.com)*
