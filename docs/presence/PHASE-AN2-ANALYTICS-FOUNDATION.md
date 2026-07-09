# Phase AN-2 — Analytics Foundation (Privacy-First Visitor Intelligence)

*The collection layer that makes Analytics, Health Coach, Journey, Moments, and Agency insight real instead of assumed. ONE tracker, one endpoint, one table. Privacy-first, cookieless, deterministic, zero AI.*

## The one collection layer
- **One injected tracker** — `trackerScript()` inserted at the single template-agnostic pass in `lib/render.ts` (`injectAnalytics`, mirroring `injectDevLayer`), so every page of every template + redirect stub gets exactly one tracker, idempotently. ~750 bytes, `sendBeacon` (zero latency), honors Do-Not-Track, sets **no cookie / no localStorage**.
- **One public endpoint** — `POST /px/:siteId` (`routes/collect.ts`), pre-auth, authorized by the site id itself (reuses the lead-form public-insert pattern: rate-limited, salted, always 204). Reachable with no apikey, exactly like a browser beacon (live-verified).
- **One table** — `presence_visits` (migration 0066), lean + append-only, deny-all RLS.

## Privacy-first, by construction
- **No raw IP stored.** A daily-rotating anonymous `visitor_hash` = sha256(ip+ua+site+**day**+salt) enables same-day unique-visitor counts and resets every UTC day → **no cross-day identity** (Plausible/Fathom model).
- **No cookies, no localStorage, no fingerprinting.** **Bots dropped** at collection (never stored). **Do-Not-Track honored** both client- and server-side. **Referrer reduced to host only** (never the full URL). **Coarse geography only** (country/region, best-effort). No personal data.

## What it collects (AN-2.2) — and what it reuses instead of re-collecting
Collected by the tracker: page views, referrer host, UTM, device/browser/os (parsed server-side from UA), coarse country, and click events — **phone**, **email**, **CTA**, **download**, **outbound**. Deliberately **reused, not re-collected**: **contact-form submissions** (already `presence_form_submissions`) and **publish events** (already `presence_publishes`) — composed in, never duplicated.

## Composition — reuse, never duplicate (AN-2.3–2.7)
Pure functions (`lib/visits.ts aggregateVisits`, `analytics/compose.ts`) turn stored rows into sentences:
- **Analytics home** now leads with real traffic ("214 people visited your website this week — up from 180"), most-common source, most-attended page, and call/email taps — and the traffic "not measured yet" card is **gone** (we measure it ourselves; only Search/GSC may remain honest).
- **Website view** (`GET /analytics/website`) — visitors, pageviews, top pages, sources, devices, countries, events; honest empty state when there's no data.
- **Customer Journey** — the "First visitor 🎉" milestone is now **real** (the old code honestly said it "needs analytics we don't collect yet"; now we do). Reuses `buildTimeline`.
- **Business Moments** — a traffic notice ("More people are finding you.") fires only on a **meaningful** change (≥2× prior, ≥12 visitors), never daily noise.
- **Agency portfolio** (`GET /analytics/portfolio`) — reuses `gather`+`buildPortfolio`, adds per-client visitors and the "**traffic but no inquiries**" signal (a client getting visits but no leads — worth a nudge).

## AN-2.9 Performance — extremely lightweight
- **Payload:** tracker ~750 bytes (once, cached with the page); each beacon < 300 bytes.
- **Latency:** `sendBeacon` is fire-and-forget — **zero** added latency to the visitor.
- **Write:** one tiny insert per event; bots/DNT short-circuit before the write.
- **Storage:** a visit row is a handful of short columns + a 20-char hash — no bodies, no blobs. Reads are bounded (windowed, `limit`), indexed by `(site_id, ts)`. Retention: prune `ts < now()-180d` (a scheduled follow-up; noted on the table).

## AN-2.10 AI audit — **zero AI added** (verified)
The collector, the visits library, and the composition import **no** model/AI. Guard-tested (`visits_test`, `analytics_test`). Analytics summarizes existing facts; it never generates them.

## Competitive review
- **Google Analytics / GA4** — measures everything, readable by nobody at SMB scale; the thing we're not.
- **Plausible / Fathom / Simple Analytics** — our north star: cookieless, one calm page, privacy-first. We match the privacy model (daily-rotating hash, no cookies, DNT, host-only referrer) and go further by turning the numbers into **sentences** and wiring them into Health/Journey/Moments/Agency — which standalone analytics can't do.
- **Microsoft Clarity** — heatmaps + session recordings; **intentionally not built** (privacy + interpretation burden, no SMB action).
- **What Studio OS intentionally does NOT copy:** cookies/consent-wall tracking, cross-site identity, session replay, fingerprinting, real-time vanity counters, or any chart wall.

## Architecture review — confirmed
One analytics engine · one tracker · one endpoint · one store · no duplicate reporting (agency reuses `buildPortfolio`) · no duplicate AI (none) · everything composes into existing systems (Analytics, Health Coach, Journey, Moments, Agency).

## Final questions — answered
1. **Privacy-first?** Yes — cookieless, no raw IP, daily-rotating anonymous id, DNT honored, host-only referrer, coarse geo, bots dropped.
2. **Avoids unnecessary data?** Yes — no personal data; form/publish reused, not re-collected.
3. **Measurable customer value?** Yes — real visitors/sources/pages/contact-taps in plain English.
4. **Improves Health Coach?** Yes — most-attended page + real activity feed its read (composed).
5. **Improves Moments?** Yes — meaningful-change traffic notice, no spam.
6. **Improves Journey?** Yes — "First visitor" is now a real milestone.
7. **Improves Agency insight?** Yes — per-client visitors + "traffic but no inquiries."
8. **Understood in under 30 seconds?** Yes — sentences, most-important first.
9. **Ongoing cost justified?** Yes — a few bytes per event, one indexed insert, bounded reads, no AI; among the cheapest analytics designs possible.
10. **Build it this way from scratch?** Yes — a single privacy-first first-party layer feeding one understanding surface is the right architecture.

## Verification
- **Pure:** `visits_test` **34/34** (UA parsing incl. the iOS-vs-macOS ordering bug, host-only referrer, daily-rotating hash, aggregation, tracker privacy, render-injection idempotency, AN-2.10 no-AI guard). `analytics_test` **26/26**, `premium_experience` **22/22** (Journey +first-visitor), full regression green. `deno check` clean.
- **Live integration:** `visits_integration_test` **10/10** against the **deployed** collector over HTTP — public beacon accepted with no apikey, UA parsed server-side, referrer host-only, anonymous hash, **bot dropped**, **DNT dropped**, and the Website view composes the real visit. This live pass caught a real **clock-skew** bug (DB `now()` reading ahead of the caller's clock dropped just-happened visits) — fixed by removing the current-window upper bound.
- **Playwright:** `analytics.spec.ts` — the home leads with a real visitors sentence, no `<canvas>`, honest cards, scope-forwarded.
- Migration 0066 applied to staging + prod; function deployed to both.

## Deferred (V1.1 — not gaps)
Daily rollup table + 180-day retention job (raw events are fine at SMB scale now); GSC/GA *connected* ingestion into `presence` (search performance stays honestly "connect to measure"); geo enrichment where the edge lacks a country header; a dedicated Website deep-view page (data already flows via `/analytics/website`).

**Phase AN-2 — Analytics Foundation complete.**
