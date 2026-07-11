# CMS-UX-3 — Website Attention Center

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). One calm, customer-facing projection that answers a single question — *"What needs my attention today?"* Not a dashboard, not an admin panel, not an audit report.

Every card answers four things in plain words: **What happened · Why it matters · What to do · one clear action.**

## Prioritisation (calm, no severity colours)
`Needs attention` · `Coming soon` · `Completed` · and the all-clear state *"Everything looks good."* Tone is carried by a soft hue rail and grouping, never an alarm colour.

## Architecture — a pure projection over existing signals
Same shape as CMS-UX-1/2: a pure adapter + a thin gathering route. No new store, **no second notification system**, no duplicated validation.

- **`lib/attention_center.ts`** — pure `buildAttentionCenter(input) → AttentionCenter`. Turns pre-derived signals into what/why/action cards and the calm buckets. Client-safe by construction.
- **`routes/attention.ts` → `handleAttentionCenter(site, cors)`** — gathers from existing tables and calls the adapter.
- **`index.ts`** — `GET /attention` in the authed, tenant-resolved section.
- **Reuse of CMS-UX-1:** the website-content signals come from **`siteContentTree(site)`** — the Content Tree assembly, now extracted from `handleContentTree` so the validation → customer-safe status mapping lives in exactly one place. The Attention Center reads `site_status`, `has_unpublished_changes`, `last_published_at`, and the `missing_required` sections straight off that tree.

## Inventory + preservation matrix
Every attention signal reuses an existing source. The only new code is the projection.

| Attention signal | Existing source | Reuse strategy |
|---|---|---|
| Missing required content ("… needs a little more") | snapshot/publish validation → **Content Tree** `missing_required` sections | reuse `siteContentTree`; no re-validation |
| Publish didn't finish | Content Tree `site_status='publish_failed'` (from `presence_publishes`) | reuse tree |
| Unpublished changes ready | Content Tree `has_unpublished_changes` (from `describeChanges`) | reuse tree |
| A publish is scheduled | `presence_scheduled_publishes` (pending) | direct read → "Coming soon" |
| Domain renewal / trial / payment / lead / search notices | `presence_plan_notices` (active) + `noticeHref` (exported from workspace.ts) | reuse notices + href; split by kind into Needs/Coming-soon |
| Changes awaiting your approval | `presence_infra_plans` + `presence_connection_writes` (proposed) + `presence_media` (pending replace) | reuse the shell-bell queries (portal context) |
| A new enquiry | `presence_form_submissions` (`status='new'`, non-spam) | direct read |
| A connected service needs reconnect | `presence_connections` (status expired/error/revoked · health attention/down) | reuse + provider label |
| Delivery approval waiting / studio replied / action needed | `presence_approvals` (pending) + `presence_project_events` (`client_action`/`support_message`) via the **Agency–Client Bridge** (`linksForCustomer`, `client_visible` only) | reuse bridge; client-visible only |
| Entitlement/trial/payment state | already encoded as `presence_plan_notices` kinds | reuse notices (no separate entitlement read) |
| Completed reassurance | Content Tree `last_published_at` + clean state | reuse tree |

**No duplication:** validation isn't re-run (it's the Content Tree's), the notice system isn't rebuilt (it's `presence_plan_notices` + `noticeHref`), and the bell's approval queries are the same ones `handlePortalContext` already uses.

## Card model (client-safe)
`title` (what) · `why` (why it matters) · `action_label` + `action_href` (the one action) · `tone` (`needs_attention`/`coming_soon`/`completed`) · `icon`.
Never emitted: table names, ids, internal notice `kind` strings, field paths (asserted by test #14). Notice kinds are mapped server-side to friendly headlines/hrefs; the raw kind never reaches the client.

## Security / tenant isolation
- Runs after site resolution — `site` is scoped to the caller (RLS under their JWT; agency drill-in via `resolveScopedSite`). Every own-site read is hand-scoped `site_id=eq.${site.id}`.
- Bridge reads reuse `linksForCustomer(site.client_id)` and filter `client_visible=is.true` on the agency site — the same P2-D tenant-isolation gate; a customer never sees another client's approvals or actions.
- Best-effort bridge block: if it errors, the Attention Center still stands on the site's own signals.

## Files
- `supabase/functions/presence/lib/attention_center.ts` (new — pure adapter)
- `supabase/functions/presence/routes/attention.ts` (new — gathering route)
- `supabase/functions/presence/routes/room.ts` (extracted `siteContentTree` for reuse)
- `supabase/functions/presence/routes/workspace.ts` (exported `noticeHref`)
- `supabase/functions/presence/index.ts` (registered `GET /attention`)
- `tests/presence/attention_center_test.mjs` (new — 37 assertions)
- `attention.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`attention_center_test.mjs` — 37/37 pass**: all-clear state, the what/why/action card shape, publish-failed-first ordering, missing-required cap + roll-up, ready-to-publish suppression while blocked, combined approvals count, connection cap, enquiry wording, studio-action surfacing, notice split by kind, scheduled→"Coming soon", completed reassurance, bucket ordering, **client-safe shape**.
- **Regression: 143/143 pure + structural pass** (platform invariants 14/14; CMS-UX-1 33/33; CMS-UX-2 80/80). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /attention` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't see Tenant B's attention, and a bridged customer sees only client-visible approvals/actions.
- Human **browser/mobile/AT pass** on the rendered Attention Center.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Boundaries respected
Stopped at CMS-UX-3. Did **not** begin CMS-UX-4.
