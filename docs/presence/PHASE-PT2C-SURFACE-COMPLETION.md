# Phase PT-2C — Premium Experience Surface Completion

*PT-2B built the capabilities; this phase surfaces them. Every item reuses an endpoint that already exists — no duplicate systems, no second monitoring, no second memory.*

## 1. Health Coach UI — one health experience ✅
Today's home line **no longer calls the search-only `/search/health`**; it now calls the Business Health Coach (`/coach/health`), which composes every signal into one plain-English read (headline + the single most-useful suggestion, deep-linked). There is now exactly **one** health experience on Today. Verified by a Playwright spec.

## 2. Customer Journey ✅
A "Your journey" card on Today consumes `/coach/journey` — the milestone arc (created → published → findable → first inquiry → first customer → renewal). Achieved milestones show ✓ and the most recent celebration headlines the card; unreached ones read as anticipation. **No scores.** Playwright-verified (celebration copy renders; no numeric score present).

## 3. Admin Health Center ✅
A focused `admin-health.html` renders the unified `health_center` — one card per operational area (platform/secrets, cron, domains, billing, AI, email, usage, errors, alerts, backups) with an honest state (ok / needs-a-look / off). It's fed by a new **operator-authenticated `GET /admin/health-center`** that reuses `computeHealthCenter()` (the same aggregation behind `/system/health` — the cron endpoint is secret-gated, so the operator UI needs its own authenticated door). **No second monitoring system.** Playwright-verified (cards + honest states; non-operators are turned away).

## 4. AI Memory Integration ✅
The Concierge now **actively uses** the AI Business Memory (`grounding.businessMemory`): guidance answers become **stage- and season-aware** — a setting-up business is nudged toward "get live"; an established one gets an industry-seasonality line ("what I keep in mind for a restaurant: holidays and patio season…"). It only ever *enriches* — absent memory leaves answers byte-identical (kept the 22 existing concierge assertions green), and it reuses the existing `loadBusinessMemory` loader (no second memory). New concierge assertions prove the enrichment (30/30).

## 5. Template Preview Gallery ✅
The Design Studio look-chooser is now a **visual gallery**: each family renders a mini-mock card (its paper, accent rule, and type "Aa" + a one-line character tag) — Business Classic (modern/clean), Restaurant (warm/hospitality), Editorial (print serif). Data-driven from `/site/templates` with a **graceful fallback swatch for future families**, so adding a template automatically gets a card. Playwright-verified (a card per family, the Editorial swatch tag renders).

## 6. Contextual Education Expansion ✅
The one-time hint system gained an **imperative API** (`window.ddsHint(key, html)`) alongside the declarative markers, sharing one seen-store and a strict **one-at-a-time** guard (never intrusive). Hints now teach in context across: **Design** (palettes are contrast-checked), **Foundations** (approve-first, nothing changes on its own), **Search** (plain questions, no jargon), **Publish** (atomic + every version kept), **Photos/DAM** (in-use vs. waiting), and **CRM** (private vs. shared notes) — plus the existing Today/Leads hints. *Analytics* is intentionally skipped — that surface doesn't exist yet (honest, not faked).

## Testing
- Backend: `concierge_test` **30/30** (＋ memory-usage assertions), `premium_experience` 21/21, `coach` 46/46, `platform_invariants` 14/14, render/editorial/shell/nav green. `deno check index.ts` clean.
- Browser: new/extended Playwright specs — Today Health Coach + Journey, `admin-health.spec.ts`, template gallery in `cms.spec.ts`, hints in `onboarding.spec.ts`; all 12 e2e files lint clean.
- Deployed to staging + prod; `/admin/health-center` verified serving. Frontend (today/presence/crm/admin-health/shell) follows the UI-staging pattern.

## Reuse ledger
Health Coach UI → `/coach/health` (PT-6). Journey → `/coach/journey` (PT-7). Admin Health Center → `computeHealthCenter()` shared with `/system/health` (PT-8). AI memory → the existing `loadBusinessMemory` + grounding (PT-9). Preview gallery → `/site/templates` (existing). Hints → the shell hint system (PT-5). Nothing duplicated.

**Phase PT-2C — Premium Experience Surface Completion complete.**
