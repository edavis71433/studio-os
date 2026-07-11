# CMS-UX-2 — Website Timeline

**Status:** backend complete + tested + deployed to staging (Client-App view built, fenced). A calm, chronological story of the customer's website — it answers one question, *"What's been happening with my website?"* — not an activity log, not an audit trail, not an admin console.

## One timeline, not three screens
Per the product direction, **publishing history + website milestones + project milestones merge into ONE elegant timeline** rather than three separate features. A single chronological feed, grouped by when it happened (Coming up · Today · Yesterday · This week · Earlier), drawn from every existing event source and translated into plain English.

## Architecture — a pure projection over existing events
Same shape as CMS-UX-1: a pure adapter + a thin gathering route. No new table, no migration, no second event store, no duplicated business logic.

- **`lib/website_timeline.ts`** — pure `buildWebsiteTimeline(input) → WebsiteTimeline`. No I/O. **Reuses** the platform's existing plain-language mappers instead of re-deriving them, and adds only the customer presentation layer (category, icon, actor, deep link, day-grouping).
- **`routes/timeline.ts` → `handleWebsiteTimeline(site, cors)`** — one bounded parallel gather from the customer's own site, plus (if bridged) their linked project's client-visible events, fed to the adapter.
- **`index.ts`** — `GET /website-timeline` in the authed, tenant-resolved section (mirrors `/content-tree`, `/changes`).

## Capability inventory + preservation matrix
Every row reuses an existing source. Nothing was rebuilt; the only new code is the presentation projection.

| Timeline capability | Existing source (table) | Reuse strategy | Missing projection (added) |
|---|---|---|---|
| Published / restored | `presence_publishes` | Reuse `mapPublish` (crm/contract.ts) | category · icon · actor · grouping |
| Content edited | `presence_change_events` | Reuse `mapChange`; drop `publish`/`restore`/`internal_note` (de-dup vs publishes) | section deep-link · category |
| Publish scheduled | `presence_scheduled_publishes` | New 3-line mapper; future-dated → "Coming up" | whole projection |
| Website released / rolled back | `presence_launches` | New mapper (avoids the flagged `scheduled_for` column) | whole projection |
| Domain connected | `presence_infra_plans` (kind=`connect_domain`, `applied`) | New mapper → Milestone | whole projection |
| Service connected / disconnected | `presence_connection_events` | Reuse `mapConnected` + provider label | category · icon |
| New enquiry | `presence_form_submissions` | Reuse `mapLead` | category · link |
| Insight (Business Moment) | `presence_moments` | Reuse `mapMoment` | category=System |
| Milestones / messages / support / approvals / surveys | `presence_project_events` via the Agency–Client Bridge | Reuse `notifLabel` + `linksForCustomer`; **`client_visible` only** | category · customer href (`client.html`) |
| Relative time ("2 days ago") | `humanWhen` (crm/contract.ts) | Reuse verbatim | — |
| Chronological merge | `mergeTimeline` pattern | Reuse ordering | day-bucket grouping |
| SSL activated · Google review responded | **no store exists** | **Omitted — no fabricated events** (Proof-Integrity rule) | — |

**Honesty note:** "SSL activated" and "Google review responded to" have **no recorded event source** (both are computed-on-read or unstored). They are deliberately *not* shown — the timeline never invents an event that didn't happen.

## Event model (client-safe by construction)
Each event carries only presentation fields:
`title` · `description?` · `at` (ISO timestamp) · `when` (relative) · `icon` · `category` · `actor` · `href?` · `related_page?`.
Never emitted: table names, database ids, internal event `kind` strings, provider keys, field paths (asserted by test #14).

- **Categories:** Content · Publishing · Website · Communication · Support · Milestones · System (reuses existing event semantics; none invented beyond these).
- **Actor** normalises both actor-kind vocabularies (`client`/`customer`→"You", `staff`/`operator`→"Your studio", `system`→"Automatic"; enquiries→"A visitor").
- **Grouping** is deterministic against the passed-in `now` (no live clock in the pure layer): future → *Coming up*; then *Today / Yesterday / This week / Earlier*.

## Two surfaces, one story
- **The customer's own site** (`site_id`-scoped): publishes, content edits, scheduled publishes, releases, domain, connections, insights, enquiries.
- **Their linked project** (only if `site.client_id` has active `presence_service_links`): client-visible delivery/milestone/support events, reached through the existing bridge (`linksForCustomer`), pinned to the `agency_site_id` with `client_visible=is.true`. A self-serve customer with no project simply sees their own site's story.

## Security / tenant isolation
- Runs after site resolution — `site` is already scoped to the caller (RLS under their JWT; agency drill-in via `resolveScopedSite`). Every own-site read is hand-scoped `site_id=eq.${site.id}`.
- Bridge reads reuse `linksForCustomer(site.client_id)` and filter `client_visible=is.true` on the agency site — the same tenant-isolation gate P2-D already ships; a customer never sees another client's records or any internal-only event.
- Client-safe output only (test #14).

## Files
- `supabase/functions/presence/lib/website_timeline.ts` (new — pure adapter)
- `supabase/functions/presence/routes/timeline.ts` (new — the gathering route)
- `supabase/functions/presence/index.ts` (registered `GET /website-timeline`)
- `tests/presence/website_timeline_test.mjs` (new — 58 assertions)
- `timeline.html` (new — the Client-App view, fenced) + `today.html` doorway

## Validation evidence
- **`website_timeline_test.mjs` — 58/58 pass**: day-grouping ladder, "Coming up" for future, mapper reuse (publish/change/connected/moment/lead), publish/restore/internal-note de-dup, domain→Website routing, launch published→Milestone / rolled-back→Publishing / draft-skipped, domain-connected milestone, project-event categorisation + internal-churn omission, actor normalisation, **client-safe shape**, last-activity (past-only), unified merged ordering.
- **Regression: 142/142 pure + structural pass** (incl. platform invariants 14/14 and CMS-UX-1). The 6 skipped suites are live-integration tests needing staging creds.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging** (`wjlpursnwbmlcdwbeowv`); `GET /website-timeline` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A cannot read Tenant B's timeline and a bridged customer sees only client-visible project events.
- Human **browser/mobile/AT pass** on the rendered timeline.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Boundaries respected
Stopped at CMS-UX-2. Did **not** begin CMS-UX-3, the Website Navigator, design-system work, or portal retirement.
