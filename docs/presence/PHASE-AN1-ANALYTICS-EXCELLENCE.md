# Phase AN-1 — Analytics Excellence

*Not a dashboard. Analytics makes a small business **understand what's happening** — in calm sentences, numbers only where they're real. It composes signals the platform already stores; it adds no engine, no AI cost, and never fabricates a number.*

## What it is
A first-class **Analytics** outcome (nav + `analytics.html`) with a backend that composes plain-English understanding from existing data:
- **`GET /analytics`** — the home: *inquiries* (this period + trend + by-kind + unread), *your website* (last updated + publishes this period), a *milestone* (from the Customer Journey), *health* (the Health Coach's one-sentence read + up-to-3 suggestions), *what we're noticing* (Business Moments), and an honest *not measured yet* section.
- **`GET /analytics/customers`** — inquiries detail (AN-3), honestly labelled "inquiries" (no invented repeat-customer/conversion figures).
- **`GET /analytics/search`** — getting-found readiness from **real** SEO booleans (title/description/verification/sitemap), honest that clicks/impressions need Search Console (AN-4).
- **`GET /analytics/portfolio`** — agency scope (AN-7): who's growing / needs attention / gone quiet, composed from the **existing** `gather` + `buildPortfolio` rollup (no duplicate aggregation). Resolved from the JWT before site resolution (agency members own no site).

## The honesty ledger (what's real vs deliberately not shown)
The audit was blunt: **there is no web-analytics substrate** — the rendered sites inject no tracker, and GA4/GSC are `planned` connected providers, dormant. So Analytics shows only what's genuinely measured and **states the rest plainly**:

| Shown as real | Source |
|---|---|
| Inquiries: count, trend, by kind, unread | `presence_form_submissions` (real, indexed) |
| Website: last updated, publishes this period | `presence_publishes` (status=live) |
| Milestones | Customer Journey `buildTimeline` (existing, pure) |
| Health sentence + suggestions | Health Coach `coachRead` (existing, pure) |
| What we're noticing | `presence_moments` (existing, curated, plain-English) |
| Getting-found readiness | `presence_identity`/`presence_settings` SEO fields (real booleans) |
| Agency portfolio | `gather` + `buildPortfolio` (existing rollup) |

| Honestly "not measured yet" (never faked) | Why |
|---|---|
| Website visitors / pageviews / popular pages / devices / locations / referrers | No tracker injected; GA is a dormant `planned` provider → "connect Google Analytics" |
| Search clicks / impressions / CTR / position | GSC dormant in `presence` → "connect Search Console" |
| Conversions, lead response time, repeat customers | No source columns exist — we do not invent them |

## AN-9 — does Analytics increase AI cost? **No.** (Verified.)
Every source is a **stored row or a pure function**. `routes/analytics.ts` and `analytics/compose.ts` import **no** model/AI/engine-run module — enforced by a unit test (`analytics_test`: "AN-9 guard"). Reading Moments/Journey/Health output re-runs nothing. AI cost delta = **0**.

## AN-10 — reinforcement, not duplication
Analytics is a *lens* over Health Coach + Journey + Moments + inquiries + publishing — the same data Today/Inbox/Customers use, framed as understanding. No second reporting store, no second aggregation (agency reuses `buildPortfolio`).

## Competitive review
- **Google Analytics / GA4** — powerful, unreadable for an SMB owner; the thing we deliberately are *not*. We answer "how's my business?" in a sentence; GA4 makes you assemble the answer from reports.
- **Plausible / Fathom** — the right instinct (one calm page, privacy-first). Better than us at *traffic* today (they actually measure it). We intentionally don't inject a tracker yet; when we do, this is the model — one honest page, not a chart wall.
- **Microsoft Clarity** — heatmaps/recordings; deliberately **not** doing this (privacy + interpretation burden, no SMB action).
- **HubSpot / HighLevel** — funnels/attribution; enterprise interpretation load we reject.
- **Wix / Squarespace** — closest peer: built-in "insights" in plain-ish language. We match the calm and add cross-client (agency) understanding they lack; we trail them on traffic until a connection exists.
- **What Studio OS intentionally does NOT do:** vanity chart walls, session recordings, multi-touch attribution, real-time counters, or *any* fabricated/estimated number.

## Final questions — answered honestly
1. **Would a plumber understand it?** Yes — it's sentences: "You received 6 inquiries this week."
2. **A salon owner?** Yes — same.
3. **My business in under 30 seconds?** Yes — the home is 3–5 sentences, most-important first.
4. **Simpler than Google Analytics?** Dramatically — one page of understanding vs. a reporting suite.
5. **Duplicate reporting?** No — composes existing signals; agency reuses `buildPortfolio`.
6. **Duplicate AI?** No — zero AI added (guard-tested).
7. **Every insight actionable?** Yes — each card links to where you act (Inbox, Website, Connections).
8. **Helping run the business vs interpreting charts?** Yes — no charts; it tells you what happened and what to do.
9. **V1.1?** First-party visitor tracking (a tracked pixel + a `presence_visits` table + a `/collect` endpoint) so traffic/sources/pages become real; GSC/GA ingestion wired into `presence` (real today only in the separate `clever-api`); PDF reports (no renderer today → currently print-friendly HTML); content/page-level attention (needs pageviews); lead response-time + conversion (needs a status-change timestamp + an outcome field).
10. **Ship it proudly tomorrow?** Yes — because it's honest. It never lies with a fake number, and everything it says is true and useful.

## Verification
- **Pure:** `analytics_test` **26/26** (composition + AN-9 no-AI guard). Regression: files 21, dam 32, scope 14, scoped-audit 17, workspace_roles 42, invariants 14, nav 3, shell 18 — all green. `deno check` clean.
- **Live integration (real staging Postgres):** `analytics_integration_test` **8/8** — the home composes real inquiry counts + honest "not measured" traffic card; customers detail reflects real by-kind and refuses invented figures.
- **Playwright:** `analytics.spec.ts` — mounts under the shell, leads with sentences, **no `<canvas>`**, shows the honest "not measured" card, forwards the SC-1 scope header.
- Deployed to staging + prod; live route probe healthy (401 auth-gate, not 500).

## Deliberately deferred (V1.1 — separate phases, not gaps)
First-party visitor tracking; GA/GSC ingestion into `presence`; PDF report rendering; page-level content analytics; lead response-time & conversion (need schema additions). Each is flagged above and never faked in the meantime.

**Phase AN-1 — Analytics Excellence complete.**
