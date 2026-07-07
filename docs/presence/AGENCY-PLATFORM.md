# Agency Platform — M13

Agencies, freelancers, consultants, and internal marketing teams manage many businesses through one operating system. **Orchestration, not duplication:** an agency is a lens over existing presence sites; every queue reads rows the frozen architecture already produces, and every bulk action dispatches the existing per-site engines. Customers manage one business; agencies manage many; nothing about how Studio OS fundamentally works changes at either scale.

## Architecture

```
agency/auth.ts                     agency/portfolio.ts (PURE)            agency/routes.ts
─ a THIRD principal: agency        ─ buildPortfolio: one row per         ─ /agency/* router: membership →
  member (fail-closed, like          client — moments, criticals,          capability check → operations
  verifyStaff); staff and            opportunities, plans, drafts,         fenced to the agency's OWN sites
  clients pass through the           reviews, migration state,           ─ gather(): FIXED-COST — one
  existing boundary untouched        publishing, notes                     batched query per table via
─ 8 roles → capability TABLE       ─ buildQueues: nine actionable          in.(...), reduce in memory —
  (permissions as data):             queues ─ buildPatterns: cross-        the same ~12 queries whether
  owner, admin, account_manager,     client concerns, empty ones           the portfolio holds 1 client
  content_strategist, designer,      simply absent (no dashboard           or 1,000
  developer, support, readonly       noise)
```

Storage (0034, deny-all RLS — access flows only through the function's gates): `presence_agencies` (branding, seat/client limits, plan), `presence_agency_members` (role, revocable), `presence_agency_clients` (the portfolio link: tags, owner, assignment, internal notes, archive/restore), `presence_agency_jobs` (scheduled bulk work with per-site results).

## Work queues — from the existing pipeline only

Nine queues, each item a client name plus one plain sentence of *why*: **High priority** (critical evidence + needs-attention moments) · **Review today** (open review/brand findings) · **Publish today** (unpublished changes; never Monitor sites) · **Infrastructure** (infrastructure/SSL evidence + approved-unapplied plans) · **Brand review** · **Growth opportunities** (the Coach's open rows) · **Migration ready** (M11 readiness) · **Awaiting client approval** (proposed drafts + proposed plans) · **Waiting on the agency** (approved plans not yet applied). Cross-client patterns group the same rows by concern — expiring domains, SSL problems, accessibility, stale content, thinning trust, review requests, missing faces, holiday prep, opportunities sitting unresolved — and empty concerns don't appear. No dashboards, no charts, no scores: queues are sentences with names on them.

## The approval chain, unchanged

Internal review happens in queues; agency approval happens on plans/drafts the agency prepares; **client approval stays exactly where it always was** — drafts wait on the client's accept, infrastructure plans wait on approval, publishing runs the one frozen pipeline whose history restores in one step. The agency layer holds no power a single-site route lacks; clients keep full control of their own rooms (verified live: the client's site is untouched by every portfolio operation).

## Bulk operations — explainable and reversible

`POST /agency/bulk {action, site_ids, run_after?}` dispatches the existing engines per site — observe, judge, recommend, moments, coach, review, brand_review, readiness, publish — with a per-site result recorded for every one ("3 observations", "refused (409)"). Reversibility is inherited: observation/proposal engines change nothing; publish restores from history. Foreign site ids are silently fenced out; capped at 25 per call; `run_after` turns the call into a scheduled job (scheduled publishing included) executed by `POST /agency/jobs/run-due`.

## Roles

Owner/admin: everything. Account manager: clients + publishing, not the team or the brand. Content strategist / designer / developer: observe and propose, never publish. Support: read + internal notes. Readonly: read, full stop. The capability table is data (`agency/auth.ts`); a new role is a row.

## White label

`branding` on the agency (display name, logo, colors, email-from, portal note, report footer) round-trips through `/agency/branding` and is served with every member resolution — the surface layer applies it to portals, logins, emails, reports, and notifications. The underlying Studio OS identity (provenance events, pipelines, contracts) remains intact beneath it.

## Provisioning & onboarding

The operator creates agencies (`POST /admin/agencies` — agency + owner seat). Agencies onboard clients by linking sites (`POST /agency/clients`), receiving a guided checklist derived from actual state: edition chosen → Monitor connect/verify → Brand Profile started (three fields first) → papers imported → first observation run. Every step names *how* in plain words; nothing acts alone.

## Commercial model

Seats and client limits live on the agency row and are enforced at invite/onboard time with plain-words refusals; `GET /agency/usage` summarizes seats, active/archived clients, edition breakdown, and publishes over 30 days — the billing-integration surface. The ladder holds: Monitor → Presence → Presence Managed → Agency → Enterprise, additive at every rung.

## Tests

`tests/presence/agency_test.mjs` — 44 checks. Pure: the full capability table, portfolio rollups from synthetic pipeline rows, directory filtering, all nine queues + patterns deriving only from existing-architecture rows, archived-everywhere exclusion, and **scale: 1,000 clients through the pure builders in ~40ms** with a structural fixed-cost assertion on the gather layer (one batched query per table, no per-site loops). Integration: agency provisioning, member resolution (client JWTs and anonymous both 401), onboarding checklist, live portfolio + queues, tags/notes/archive/restore, seat-limit enforcement, readonly proven read-only across five denials, branding round-trip, bulk dispatching the real engines with fenced foreign ids, scheduled jobs running when due, usage, and client ownership intact — cleaned up completely afterward. Regression sweep green: platform, monitor, evidence, moments, concierge, coach, room, M5 pipeline, M6 admin, writer.

*Operational note:* `supabase.exe` segfaults intermittently on `functions deploy`; `supabase-go.exe` is the reliable deploy binary.
