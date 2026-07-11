# CMS-UX-5 — Upcoming Changes

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). A calm, future-looking schedule that answers one question — *"What's happening next with my website?"* Not project management, not a task list, not a release log.

Completes the customer story: **Content Tree** (what exists) → **Timeline** (what happened) → **Attention Center** (what needs attention) → **Website Health** (is it healthy) → **Upcoming Changes** (what's next).

## Architecture — a projection over dated truth
Same pattern as CMS-UX-1–4: a pure adapter + a thin gathering route. No scheduling engine, no new store.

- **`lib/upcoming_changes.ts`** — pure `buildUpcomingChanges(input) → UpcomingChanges`. Buckets real future dates and lists genuinely-pending items. **Reuses** the future relative-date helper `whenWord` (exported from `attention_center.ts`) — presentation logic is not forked.
- **`routes/upcoming.ts` → `handleUpcoming(site, cors)`** — gathers dated truth (own site + bridge) and calls the adapter.
- **`index.ts`** — `GET /upcoming` in the authed, tenant-resolved section.

## Capability inventory + preservation matrix
Every item is backed by a **real stored date** or a **real pending state**. Nothing is estimated.

| Upcoming item | Existing source | Reuse strategy | Datable? |
|---|---|---|---|
| Your next update is scheduled | `presence_scheduled_publishes.scheduled_for` (pending) | direct read | ✅ real timestamp |
| Your domain renewal is approaching | `presence_sites.domain_expires_at` | read; shown only within 90 days | ✅ real timestamp |
| Your free trial ends soon | `presence_entitlements.trial_ends_at` | read; shown within 60 days | ✅ real timestamp |
| "…" is due / project wrap-up | `presence_milestones.due_date` · `presence_projects.target_date` (client-visible, via bridge) | reuse `linksForCustomer`; open/active + not-null date | ✅ real date |
| Changes waiting for your approval | `presence_infra_plans` + `presence_connection_writes` + `presence_media` (pending) + bridged `presence_approvals` | reuse the shell-bell + bridge queries | ⏳ pending (no date) → "Waiting on you" |
| A website update is almost ready | Content Tree `has_unpublished_changes` + no blockers | reuse `siteContentTree` | ⏳ pending → "Waiting on you" |
| Relative-date wording | `whenWord` (Attention Center) | reuse verbatim | — |

**Omitted per the Honesty Rule (no stored date exists):** plan/contract renewal (no `renews_at`/`current_period_end` column), invoice due (no stored due date), monthly review / Growth-Partnership cadence (no stored next-date). These are **not estimated** — same standard as Timeline / Health / Attention. If those dates become stored later, they slot straight in.

## Grouping
Dated items bucket by calendar day against the passed-in `now`: **Today · This week (≤7d) · Coming soon (≤30d) · Later**. Undated but genuinely-pending items sit in a natural **Waiting on you** group (always last, no date shown). Day-ordinal bucketing handles both `timestamptz` and date-only (`due_date`) columns honestly — a milestone due *today* reads as Today, not the past.

## Client-safe / language
Output carries only presentation fields: `title` (what) · `when` (relative, dated items only) · `at` (ISO) · `why` · `icon` · one `action`. Never emitted: table names, ids, internal kinds, column names, raw timestamps beyond the ISO `at` (asserted by test #12). No engineering wording.

## Security / tenant isolation
Runs after site resolution (`site` scoped to the caller; agency drill-in via `resolveScopedSite`). Own-site reads hand-scoped `site_id=eq.${site.id}`; bridge reads reuse `linksForCustomer(site.client_id)` filtered to `client_visible=is.true` on the agency site — the same P2-D isolation gate. Best-effort bridge block; the schedule still stands on the site's own dates if it errors.

## Accessibility
Keyboard-complete, screen-reader friendly, reduced-motion aware, visible focus. The "when" is a text label (not colour); the "Waiting on you" group is a labelled section, not a colour cue.

## Files
- `supabase/functions/presence/lib/upcoming_changes.ts` (new — pure adapter)
- `supabase/functions/presence/routes/upcoming.ts` (new — gathering route)
- `supabase/functions/presence/lib/attention_center.ts` (exported `whenWord` for reuse)
- `supabase/functions/presence/index.ts` (registered `GET /upcoming`)
- `tests/presence/upcoming_changes_test.mjs` (new — 32 assertions)
- `upcoming.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`upcoming_changes_test.mjs` — 32/32 pass**: bucketing ladder, past-date exclusion, renewal windows (near shown / far omitted), trial date, **honesty** (no date → nothing shown), date-only "due today", the undated Waiting group, waiting-sorts-last, `next_at` = soonest dated (waiting never "next"), **client-safe shape**.
- **Regression: 145/145 pure + structural pass** (invariants 14/14; CMS-UX-1–4 all green). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /upcoming` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't read Tenant B's schedule and bridged dates are client-visible only.
- Human **browser/mobile/AT pass** on the rendered page.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Future direction (noted, not built)
Built as one section of the future **Workspace Home**. Today was **not** redesigned this milestone.

## Boundaries respected
Stopped at CMS-UX-5. Did **not** begin CMS-UX-6.
