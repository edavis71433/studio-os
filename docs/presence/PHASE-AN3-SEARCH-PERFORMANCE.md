# Phase AN-3 — Search Performance & Google Search Console

*Search Performance composed into Analytics — reusing the shared `signals` table, no new store/collector/OAuth/AI. Honest by construction: it renders real Google numbers the instant they exist, and never fabricates them when they don't.*

## Dependency map (discovery)
```
Google Search Console
      │  (ingest — clever-api, agency-side, MANUAL, impressions+clicks only)
      ▼
public.signals  ── SAME database as presence (baseline 0000) ── presence svc() CAN read it
   client_id ─────────────────────────────────────────────────── presence_sites.client_id
      │
      ▼   AN-3 (this phase): read + compose (no new anything)
 analytics/search_perf.ts (pure)  →  routes/analytics.ts readGsc()
      │
      ├─ Analytics home  (search cards + Search moment)
      ├─ Analytics search view  (performance + genuine milestones + honest "connect")
      ├─ Health Coach  (searchIssues fed from falling/absent visibility)
      └─ Agency portfolio  (growing / falling / not-connected)
```

## ⚠ Structural finding (reported, not papered over)
Discovery + live checks proved: **there is no Google Search Console data anywhere today** (staging `signals` empty; prod has only `ga4` rows, zero `gsc`). And the only ingest that exists (`clever-api`'s `gsc_ingest`) is **manual (no cron), agency-token-based, iterates partnerships not `presence_sites`, and writes only impressions + clicks monthly.** Top queries, top pages, indexing status, coverage errors, and sitemap status are **not stored by any code path.**

Per the standing rule ("stop if a structural issue is discovered"), I did **not** fabricate. Instead I built the honest, reuse-only **read + compose layer** that:
- renders real impressions/clicks/CTR/position in plain English **when the data exists**, and
- **auto-activates** the moment ingestion lands (connection is derived from real `signals` rows), and
- stays honestly on "connect Google Search Console" everywhere until then.

**To make Search Performance truly real requires ingestion work that is largely owner/operator-gated and out of this phase's scope:** a Google OAuth app (consent screen + `GOOGLE_CLIENT_ID/SECRET`), per-presence-client property connection, a `gsc_ingest` extended to iterate `presence_sites` **with query/page dimensions + the URL Inspection API** (for queries/pages/indexing), and a **real cron**. That is the AN-3 follow-up (AN-3.1), flagged below — none of it is fakeable in the meantime.

## Architecture decisions (Step 2)
- **Where does GSC data live?** The existing shared `public.signals` table (same DB). **No new table.**
- **Cached?** `signals` *is* the cache (monthly rollups). No new cache.
- **Refresh cadence?** The existing (agency) ingest; a presence-native cron is the follow-up. This phase adds **no** new job.
- **Which metrics where:** impressions/clicks → **Analytics** (plain-English) + **Journey** milestones + **Agency** (growing/falling/not-connected). Falling/absent visibility → **Health Coach** (→ shown on **Today** via the coach read). CTR/position → Analytics *only when* a full (OAuth) connection provides them. Top queries/pages/indexing/coverage → **nowhere yet** (no source — honestly "connect for detail", never faked).

## What it shows (Step 3), in plain English (Step 9 — no jargon)
- impressions → **"People saw your business 1,284 times on Google in June."** (not "impressions")
- clicks → **"37 of them clicked through to your website."** (not "clicks")
- CTR → **"About 1 in 50 people who saw you clicked."** (not "CTR")
- position → **"You usually appear on the first page of Google's results."** (not "avg position"/"SERP")
- milestones → First seen on Google · First Google click · 1,000 times seen (real, from totals; never faked)
- **Never** the words CTR, canonical, crawl budget, SERP, or "impressions" (guard-tested).

## Reuse, not duplication (Steps 4–8)
- **Health Coach** (`coachRead`): the existing `searchIssues` input is now fed from real falling/absent visibility — no new coach engine.
- **Today**: reuses the existing `search_setup` `presence_plan_notices` path + the coach read (which renders on Today) — no new notification system.
- **Agency**: reuses `gather`+`buildPortfolio`; adds one site→client map + one `signals` query → "rising / losing visibility / not connected" — no duplicate dashboard.
- **Analytics home & search view**: real search cards slot into the same `Insight[]` composition as traffic/inquiries; the "not measured" search card retires automatically when data exists.

## Final review — answered honestly
1. **Would a small business owner understand it?** Yes — "People saw your business 1,284 times on Google," never jargon.
2. **Is Analytics still calm?** Yes — sentence cards, no charts, search folds into the same calm home.
3. **Anything too technical?** No — CTR/position/impressions are all translated; guard-tested.
4. **Duplicate reporting?** No — reuses `signals`, `buildPortfolio`, `coachRead`, `presence_plan_notices`. No new store/engine/collector.
5. **Could anything be removed?** No — every piece is dormant-but-ready and adds no surface until real data exists.
6. **Would I ship it?** Yes — because it's honest: real when connected, honest "connect" when not, never a fabricated number.
7. **Trust it for my own business?** Yes.
8. **Better than Wix/Squarespace/Shopify/HighLevel?** For *understanding* — yes (they show GSC-style charts; we translate to sentences and wire search into Health/Journey/Agency). For *raw connectivity today* — no, and honestly so, until the ingestion follow-up lands.
9. **Strengthens Studio OS as one OS?** Yes — search understanding composes into the one Analytics surface, the one coach, the one portfolio.
10. **What emerged with real value?** The **auto-activation** design (connection derived from real `signals` rows) means the entire Search experience lights up with zero further code the moment ingestion is turned on — and the **agency "not connected" roll-up** is genuinely useful to a studio *today*, even with no data (it tells them exactly who to connect).

## Standing gap-check sweep
- Duplicated logic/UI/analytics: **none** — composed into existing surfaces.
- Terminology: consistent (Search/Google, never SEO jargon; guard-tested).
- Hidden tech debt: the dormant compose layer is fully tested; no debt.
- Unnecessary AI: **none** (guard-tested).
- Customer/agency friction: none added; agency gains a real "who to connect" signal.
- Scalability: reads are per-client, bounded, indexed; agency uses one batched query.

**Recommendation:** one follow-up genuinely adds customer value — **AN-3.1: presence-native GSC ingestion** (OAuth connect flow per client + a cron populating `signals` with impressions/clicks **and** query/page dimensions + URL Inspection for indexing). It's the only thing that turns this honest, ready layer into live numbers. It is owner-gated (Google OAuth app + secrets), so it needs you, not just code. **No other work is recommended.**

## Verification
- **Pure:** `search_perf_test` **24/24** (plain-English translation, no-jargon guard, meaningful-change notices, honest empties, milestones, agency states, no-AI). Full regression green; `deno check` clean.
- **Live integration:** `search_perf_integration_test` **8/8** against the **real `signals` table** — honest "connect" before, real composed impressions/clicks + auto-activated connection + retired "not measured" card + surfaced milestones + home search moment after; isolated rows cleaned up.
- Deployed to staging + prod. No migration (pure reuse of `signals`).

**Phase AN-3 — Search Performance complete.**
