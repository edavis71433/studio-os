# Phase AN-3.1 — Google Search Console Integration

*Makes Search real. Reuses the connected-platform OAuth, the shared `signals` time-series, and the ops cron — copying the PROVEN clever-api call shape — so Search Analytics lights up the moment the owner configures the Google app. No dashboards, no second analytics product; plain English throughout.*

## What was built (reuse-first, no duplicate systems)
| Piece | Reused / New | Detail |
|---|---|---|
| OAuth connect + encrypted token storage | **Reused** | The connected platform's `signState/authorizeUrl/exchangeCode/saveTokens` (AES-GCM in `presence_connection_secrets`) already worked generically — `/connections/google_search_console/connect` needed only the two bug fixes below. |
| GSC read (the actual data) | **New** (`ops/gsc_sync.ts`) | The provider's read was a stub (GET the site-list endpoint, no body). Replaced with the **proven** `searchAnalytics/query` POST shape copied from clever-api — site totals + query + page breakdowns, with 401→refresh→retry and Domain/URL-prefix property discovery. |
| Aggregate store (impressions/clicks/ctr/position) | **Reused** | The shared `signals` time-series (`source='gsc'`, `client_id`, `period`) — the exact store AN-3 already reads and auto-activates on. |
| Query/page detail store | **New** (`presence_search_terms`, mig 0067) | `signals` has no dimension column, so per-query/page/country/device rows need their own lean table. One row per (client, period, dimension, key). |
| Scheduled sync | **Reused** | A `gsc_sync` task on the existing `/system/run` dispatch + a daily cron block. Secret-gated, bounded (quota-safe), fail-safe (a bad site is skipped). |
| Surfacing | **Extended** | `search_perf.ts searchDetailInsights` (top search + best page, in sentences) + `analytics.ts readSearchTerms` → the Search view now returns `detail` + flips `detail_available`. Health Coach / Journey / Studio / Inbox already read `signals` (AN-3) and auto-activate. |

## Two latent bugs fixed (they would have silently broken a live connection)
1. **Scope string** — the provider declared `webmasters.readonly` (short form); Google rejects it. Now the full `https://www.googleapis.com/auth/webmasters.readonly`.
2. **`connectionState` column** — it read `presence_connections.provider` but the column is **`provider_key`**, so `conn.gsc` was always false. Fixed — the "connected" state now reads correctly.

## What it shows (plain English, sentences before charts)
- *"People saw your business 1,284 times on Google in June — up 157% from the month before."* (impressions)
- *"37 of them clicked through to your website."* (clicks)
- *"Your top search is 'joes plumbing' — 12 clicks from 200 appearances on Google."* (top query)
- *"Your services page brings the most people in from Google."* (best page)
Guard-tested: **no SEO jargon** (CTR/impressions/query/SERP) ever reaches the customer.

## Metrics collected — and what's deliberately deferred
- **Collected (high value, proven call shape):** impressions, clicks, average position (aggregate → `signals`); top **queries** + top **pages** (→ `presence_search_terms`).
- **Deferred (documented, not faked):** **countries/devices** (low SMB value — the dimension plumbing exists in the store if wanted later); **coverage / index status / sitemap status** — these need the **URL Inspection + Sitemaps APIs**, for which *no existing code exists to reuse* and which can't be verified here. Per "only collect what clearly creates customer value" + "where available," they're V1.1. Nothing is fabricated in the meantime.

## Privacy
- **Least-privilege:** read-only `webmasters.readonly` scope only.
- **Tokens:** encrypted out-of-row in `presence_connection_secrets` (AES-256-GCM under `CONNECTION_ENC_KEY`), never in the clear; refresh via the existing `refreshTokens`; revoke on disconnect. **Tenant isolation** is the connected platform's per-`site_id` model; the sync maps `site → client_id` before writing.
- Signed OAuth state (10-min TTL) via the existing `signState/verifyState`.

## ⚠ OWNER-GATED — what remains (I cannot do this; nothing flows until it's done)
The **entire Google side is owner/Google-console work**, not code:
1. Create a **Google Cloud project**, enable the **Search Console API**, configure the **OAuth consent screen** — the `webmasters.readonly` scope is **sensitive**, so Google likely requires **app verification/review** (can take days–weeks).
2. Register the redirect URI **`${SITE_URL}/connections-callback.html`**.
3. Set edge-function secrets: **`CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID`**, **`CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`**, **`CONNECTION_ENC_KEY`**, **`STATE_SIGNING_SECRET`**, **`SITE_URL`**.
4. A customer must then connect their own verified property.

Until then, `/connections/google_search_console/connect` honestly returns `not_available` (503), the daily cron finds no connected sites, and Analytics keeps showing the honest "connect Google Search Console" card. **I could not live-test the Google API boundary** — but the request/response contract is copied verbatim from the shipping clever-api collector, and the parsing, storage, sync iteration, and surfacing are all tested (17/17 unit + 7/7 live against the real stores).

## Final CTO review
1. **Search Analytics complete?** The **code** is complete and tested up to the Google boundary; it becomes *live* the moment the owner-gated Google app + secrets are set.
2. **Fits Studio OS naturally?** Yes — it reuses the connect surface, the signals store, the cron, and the plain-English Analytics; nothing bolted on.
3. **Anything feel bolted on?** No — the one new table feeds the existing Search view; there's no second product.
4. **Duplicate system?** No — reuses OAuth/tokens/signals/cron; the proven call shape is copied, not re-invented; no duplicate collector in presence beyond the one sync that writes to the shared store.
5. **Unnecessary complexity?** No — deferred the low-value/no-code-to-reuse pieces (countries/devices/coverage/index/sitemap).
6. **Would you launch it?** Yes — as soon as the Google app is verified; the code is safe (read-only, encrypted, fail-safe, quota-bounded).
7. **What's owner-gated?** The Google OAuth app + consent verification + the five secrets (above). Everything else is done.
8. **V1.1?** Countries/devices; coverage/index/sitemap (URL Inspection + Sitemaps APIs); historical trends beyond month-over-month.
9. **Is Analytics complete?** Yes — first-party visits (AN-2) + inquiries/publishing + search (AN-3/AN-3.1) all compose into one plain-English surface; the last honest "not measured" card disappears once GSC is connected.
10. **Ready for Launch Readiness?** Yes — with the Google app verification tracked as an owner activation item (like the other owner-gated launch items).

## Verification
`deno check` clean; `gsc` **17/17** (parsing/detail/no-AI), `gsc_integration` **7/7** (live: signals+search_terms → Analytics surfaces impressions + top-search + best-page + flips connected/detail_available), plus search_perf 24/24, analytics 26/26, visits 34/34, invariants 14/14. Migration 0067 applied to staging + prod; function deployed to both.

**Search Analytics is complete. No further Search Analytics work is recommended before launch** — beyond the owner-gated Google OAuth app + secrets (an activation step, not engineering) and the V1.1 items above.
