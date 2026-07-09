# Phase AI-1 — AI Cost & Value Optimization

*An audit of every AI surface: does it earn its tokens? Default stance — if deterministic logic is good enough, don't spend a token. Findings + the small set of changes where deterministic-or-deferred is equal-or-better.*

## The headline
**10 of the 14 audited surfaces are already fully deterministic — they spend ZERO tokens.** This platform was built AI-light on purpose (Analytics AN-1/2/3 are guard-tested zero-AI; Health Coach, Journey, Memory, Moments, SEO, Search, Inbox, Studio/Agency are all pure). The audit's job was to confirm that rigorously, find the genuine spend, and cut waste — not to add or defend AI.

## Every surface, classified
| Surface | Spends tokens? | Classification | Why |
|---|---|---|---|
| **Website drafting (Writer)** | Yes (Haiku, on-demand, metered) | **KEEP** | Real value; a customer explicitly asks; can't be deterministic (it's original prose). |
| **Content editing (Editor)** | Yes (Haiku, on-demand, metered) | **KEEP** | Same — rewrites the customer's own words on request. |
| **Concierge** | **No** for the answer | **KEEP (already deterministic)** | The answer is composed deterministically from grounding; the model only did optional cosmetic `polish`, which is **off by default** (`CONCIERGE_POLISH=off`). Nothing to cut. |
| **Business Health Coach** | No | **KEEP (deterministic)** | `lib/health_coach.ts` — pure sentences, no model. |
| **Journey** | No | **KEEP (deterministic)** | `lib/customer_timeline.ts` — pure. |
| **AI Memory** | No | **KEEP (deterministic)** | `lib/business_memory.ts` — assembled from existing rows; the name is a misnomer, it calls no model. |
| **Business Moments** | No | **KEEP (deterministic)** | `moments/engine.ts` — "No AI, no chat." |
| **SEO suggestions** | No | **KEEP (deterministic)** | evidence→judgment→recommendation engines; no model. |
| **Search explanations** | No | **KEEP (deterministic)** | `analytics/search_perf.ts` — pure, guard-tested. |
| **Analytics explanations** | No | **KEEP (deterministic)** | `analytics/compose.ts` — zero AI (AN-9), guard-tested. |
| **Inbox summaries** | No | **KEEP (deterministic)** | the feed is a plain aggregation; no summarization model. |
| **Studio / Agency tools** | No | **KEEP (deterministic)** | `agency/portfolio.ts` — pure rollup. |
| **Design assistance (Design Studio)** | No | **KEEP (deterministic)** | palettes/tokens/layout choices are data, not a model. |
| **Growth Coach (idea tier)** | Yes, optional | **SIMPLIFY (defer + meter)** | Deterministic tier always runs; the model tier was firing **eagerly** (see fix). |
| **Reviewer / Guardian** | Yes, optional, on-demand | **SIMPLIFY (meter)** | Deterministic findings always run; the model tier was **unmetered** (see fix). |
| **Visual Studio** | Yes (image), owner-key-gated | **KEEP** | Only fires on an explicit generate/vary/edit, gated on the owner's own image key. Correct. |

**No surface was REMOVED or REPLACED** — every deterministic surface already *is* deterministic, and the real AI (Writer/Editor/Visual) genuinely can't be replaced without losing the feature. That's the honest result.

## Changes made (only where deterministic-or-deferred is equal-or-better)
1. **Deferred the Growth Coach model tier to explicit user requests.** It was firing whenever `ANTHROPIC_KEY` was set — including the **unattended cron cycle** (`/system/run task=coach`, portfolio-wide) and the **agency bulk runner** — spending tokens across every site with **no user asking**. Now `runGrowthCoach(site, allowModel=false)`: the scheduler and bulk runner get the **deterministic tier only** (still free, still portfolio-wide); the model idea tier fires only from the explicit `/coach/run` route. **This is the real token saving** — it eliminates eager, portfolio-multiplied model spend. The customer experience is unchanged: the deterministic coach still produces opportunities everywhere; AI ideas generate the moment someone opens the Coach.
2. **Metered the previously-invisible spend.** Reviewer, Guardian, and the Coach model tier now record **real token counts** via the existing `meterModel` wrapper (they were unmetered or null-metered). No new system — reuses the metering that Writer/Editor already use. This makes *all* AI spend visible and capacity-enforced (you can't govern what you can't see).

Both changes reuse existing plumbing; no new AI, no new store, no feature change.

## Duplicate grounding / context (found, low-value — documented, not changed)
- `buildFactSheet(site)` is rebuilt per-request by each text agent (Writer/Editor/Coach/Reviewer/Guardian). These are independent user requests, so cross-request caching would need a new cache store — out of scope (would add speculative infra for a per-request DB read, not a token cost).
- Concierge `buildGrounding` issues a redundant `business_name` query beside `loadBusinessMemory`'s identity read — a **single small DB query**, not a token cost. Left as-is to avoid changing `loadBusinessMemory`'s shared contract.
- No model **result** is cached anywhere. Caching drafts/edits is risky (each is bespoke to the customer's current facts and intent) — correctly *not* cached; deferring (already on-demand) is the right lever, and Coach is now deferred.

## Estimated savings
There is **no per-token price table in the codebase** (only op-count envelopes), so a dollar figure can't be derived from code — but the **shape** of the saving is clear and large:
- **Before:** if `ANTHROPIC_KEY` is enabled, the Coach model tier could run once per active site per coach-cron cycle (and again on every agency bulk-coach) — i.e. **O(sites × cycles)** model calls with no user in the loop.
- **After:** Coach model spend = **O(explicit /coach/run clicks)** — bounded by real user intent.
- For a portfolio of N sites, that removes up to **N model calls per unattended coach run** (≈2,400 output tokens each on Haiku). At even a handful of clients this is the dominant avoidable cost; it scales down from "grows with the portfolio" to "grows with actual usage."
- **Latency:** the coach cron cycle and agency bulk runner no longer wait on a 25s-timeout model call per site — the unattended paths are now pure-deterministic and fast.

## Final CTO review
1. **Which AI should absolutely remain?** Writer, Editor, Visual Studio — explicit, on-demand, genuinely generative. And Concierge's grounding (deterministic) with optional off-by-default polish.
2. **Which AI creates little value?** None still running wastefully — the eager Coach tier was the one, now deferred.
3. **Which should be simplified?** Growth Coach (done: deferred + metered).
4. **Which should become deterministic?** None left — every surface that *could* be deterministic already is; the rest are irreducibly generative.
5. **Estimated monthly savings?** Removes eager, portfolio-multiplied Coach spend (O(sites×cycles) → O(user clicks)); exact $ needs a price table (recommend adding one for governance), but it's the single biggest avoidable line.
6. **Latency improvements?** Unattended coach/bulk paths no longer block on model calls — materially faster cron + bulk runs.
7. **Does Studio OS still feel intelligent?** Yes — the intelligence is mostly deterministic (Moments, Coach, Health, Analytics, Search), which is *more* trustworthy, not less; the generative parts (drafting) remain exactly where a human wants a fresh draft.
8. **Is any AI now unnecessary?** No — after deferring the eager tier, every remaining model call is on explicit intent.
9. **More sustainable?** Yes — no eager spend, and every model call is now metered + capacity-governed.
10. **AI ready for launch?** Yes. Recommend one governance follow-up (not a launch blocker): **add a per-model token→cost table** so spend can be reported in dollars (the code only tracks op-counts + raw tokens today).

## Verification
`deno check` clean; coach 46/46, guardian 30/30, reviewer 22/22, writer 30/30, invariants 14/14 (+ nav/shell/roles) — all green (the deterministic tiers are unchanged; only model-tier gating/metering changed). Deployed to staging + prod.

**No further AI cost/value work is recommended before launch**, beyond the optional cost-reporting table noted above. No new AI, no speculative features.
