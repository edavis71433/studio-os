# CMS-UX-7 — Business Insights

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). A small set of calm observations answering *"What should I know about how my business and website are performing?"* — like sitting down with a trusted advisor. Not Google Analytics, not GA4, not charts, not a metrics dashboard.

(Renamed from "Website Insights" → **Business Insights** — it speaks the customer's language.)

Completes another pillar: Content Tree · Timeline · Attention Center · Website Health · Upcoming Changes · Approval Center · **Business Insights ("what should I know")**.

## Architecture — a reframing, not a new analytics system
Same pattern as CMS-UX-1–6: a pure adapter + a thin route. **No new analytics, no forked sentences.** The platform already composes calm insight sentences; this milestone re-groups them into customer categories and adds the two things an observation needs beyond the fact — *why it matters* and *should I act*.

- **`lib/business_insights.ts`** — pure `buildBusinessInsights(insights) → BusinessInsights`. Takes the existing composed `Insight[]` and re-groups into six categories, keying each to a "why" + a tone-derived "should I". Never recomputes analytics.
- **`routes/insights_page.ts` → `handleBusinessInsights(site, cors)`** — reuses the existing gather helpers and compose functions, passing **only genuinely-measured** insights to the adapter.
- **`index.ts`** — `GET /business-insights` in the authed, tenant-resolved section.

## Capability inventory + preservation matrix
Every observation is the platform's own evidence-backed sentence.

| Observation | Existing source | Reuse strategy |
|---|---|---|
| Visitors · where-from · top page · contact taps | `trafficInsights` over `aggregateVisits(loadVisits)` — real first-party visits (`presence_visits`) | reuse the compose fn + aggregator; `loadVisits`/`readGsc` exported from `analytics.ts` |
| Most visitors on {device} | `aggregateVisits().devices` (real shares) | a one-line observation the compose layer doesn't emit — built only on a ≥50% majority (evidence) |
| Search performance | `searchInsights` over `readGsc` (Search Console signals) | reuse |
| Enquiries this month + trend | `inquiriesInsight` over `presence_form_submissions` | reuse; only when there's real inbound |
| Website last updated / updates published | `publishingInsight` over `presence_publishes` | reuse; only once ever published |
| Relative wording / trend phrasing | `trendPhrase`, `windowCounts`, `periodWord` (compose.ts) | reuse inside the existing sentences |

**Nothing rebuilt** — `analytics/compose.ts`, `analytics/search_perf.ts`, and `lib/visits.ts` are reused wholesale. The existing `handleAnalyticsHome` surface is untouched (I only added `export` to two private gather helpers).

## Honesty Rule (enforced in the route)
The route passes an insight to the adapter **only when it's genuinely measured**:
- traffic/device/top-page/source **only when `traffic.hasData`** (real visits) — never the "No visits yet" empty-state card,
- search **only when `gsc.hasData`**,
- enquiries **only when there's real inbound** this window or the prior one,
- publishing **only once the site has ever been published**.
No estimates, no fabricated trends, no invented analytics, no inferred causation — the same standard as every prior CMS-UX module. If nothing is measurable yet, the page shows a calm empty state rather than filler.

## Observation model
Each observation answers, conversationally:
- **What happened?** → `observation` (the platform's own plain sentence, reused verbatim) + optional `detail`
- **Why it matters** → `why` (a short per-category line)
- **Should I do anything?** → `should_i` ("Nothing to do — just good to know." for good/neutral; "Worth a look…" + one action for attention)

Tone stays conversational by construction — the sentences are the existing calm ones ("Most visitors arrive from Google.", "Your home page is getting the most attention.", "You received 3 inquiries this month."), never "session duration increased 14.2%".

## Categories
Visitors · Enquiries · Content · Search · Engagement · Growth — only categories with evidence appear (unknown keys fall to Growth, never dropped). No charts, no numbers-as-dashboard.

## Security / tenant isolation
Runs after site resolution (`site` scoped to caller; agency drill-in via `resolveScopedSite`). Every read is hand-scoped `site_id=eq.${site.id}` (visits, submissions, publishes) or `client_id`-scoped (search signals) — the same scoping the analytics surface already uses. Client-safe output only — no internal insight keys, tones, numbers, or table names (asserted by test #10).

## Accessibility
Keyboard-complete, screen-reader friendly, reduced-motion aware, visible focus. Category icons are decorative (`aria-hidden`); the label text carries the meaning; "why / should I" are labelled text rows (no colour-only signal).

## Files
- `supabase/functions/presence/lib/business_insights.ts` (new — pure adapter)
- `supabase/functions/presence/routes/insights_page.ts` (new — reuse-and-gate route)
- `supabase/functions/presence/routes/analytics.ts` (exported `loadVisits` + `readGsc` for reuse)
- `supabase/functions/presence/index.ts` (registered `GET /business-insights`)
- `tests/presence/business_insights_test.mjs` (new — 27 assertions)
- `business-insights.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`business_insights_test.mjs` — 27/27 pass**: reframing shape (what/why/should-I), category mapping across all six, calm order, tone→action, `search_*` fallthrough, unknown→Growth, blank-sentence skip, empty state, headline, **client-safe shape**.
- **Regression: 147/147 pure + structural pass** (invariants 14/14; CMS-UX-1–6 all green). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /business-insights` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't read Tenant B's insights and that only measured data appears.
- Human **browser/mobile/AT pass** on the rendered page.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Future direction (noted, not built)
Built as one section of the future **Workspace Home**. Today was **not** redesigned; navigation **not** consolidated; the refinement overhaul **not** begun — those come after the full customer-experience set is complete.

## Boundaries respected
Stopped at CMS-UX-7. Did **not** begin CMS-UX-8.
