# Growth Coach — M9.5E (Phase 5 of the AI Content Studio)

The Coach **observes, plans, and prepares**. The Writer creates, the Editor improves, the Reviewer critiques, the Guardian protects identity — the Coach helps the customer think ahead: timely, evidence-backed business opportunities, prepared for review, never executed. Structurally it cannot execute: its module has no write path to content (no Draft Writer, no serializer, no content routes — asserted by a test that reads the source), opportunities carry no payloads, and every handoff routes only to the existing Writer/Editor flows or stays manual.

## Architecture

```
routes/coach.ts                 coach/calendar.ts (PURE)         coach/engine.ts
─ POST /coach/run               ─ US holidays computed per year  ─ fact sheet + latest evidence run
─ GET  /coach/opportunities       (nth-weekday math), seasons,     + first-publish date + memory →
─ POST /coach/opportunities/      business anniversaries           calendar → deterministic
  :id/decide                    ─ lead windows: surface BEFORE     opportunities (ALWAYS — works
  {decision: accept|dismiss|      urgent, never after              with AI off) → optional model
   defer, until?}               ─ `now` always passed in           idea tier, sanitized → customer
                                                                   memory → reconcile & store
coach/packs.ts (DATA)           coach/rules.ts (PURE)
─ growth packs: restaurant      ─ 16 areas, 10-element contract
  (flagship, deep) + dental,    ─ every generator requires
  landscaper, hvac, retail,       concrete grounding (THE VALUE
  generic — registry entries      FILTER is structural)
  per constitution 05 §13       ─ fixed handoff table
                                ─ applyMemory, sanitizeCoachIdeas
```

## The opportunity contract (every element, every time)

`opportunity` · `why_it_matters` · `supporting_evidence` (calendar facts, evidence observations, or the customer's own content — never empty) · `expected_benefit` · `estimated_effort` (plain language: "about an hour") · `recommended_timing` (starts/ends dates + a sentence: "Valentine's Day is about three weeks out") · `suggested_next_step` · `manual_possible: true` (schema-enforced constant) · `approval_required: true` (schema-enforced constant) · `ai_can_draft` + the prepared `handoff`.

## The value filter (structural, not aspirational)

No generator exists that can emit ungrounded text. Every area requires concrete grounding before it may produce anything: a calendar event **this pack says matters here**, an Evidence Engine observation, or the customer's own content (a real menu item for a promotion, a hidden-but-written offering for a launch, a published update for email/social reuse, a real story for education). The proof test: a bare business with no calendar events and no evidence yields **zero** suggestions.

## The business calendar

Pure date math, `now` always passed in (the evidence discipline). Fourteen US national/commercial holidays per year — fixed dates plus nth-weekday rules (Thanksgiving, Memorial Day, Mother's/Father's Day, Small Business Saturday…) — four seasons, and business anniversaries computed from the site's first live publish. Every event has a lead window: it surfaces from `lead_days` out until the day itself, **never after**, so suggestions arrive before things become urgent. Nothing is ever published or scheduled automatically.

## Industry packs

Same law as the Writer's pack registry (constitution 05 §13): restaurant shipped deep, every other vertical an entry in the registry — dental, landscaper, hvac, retail, generic fallback. A pack declares *which* holidays matter in this vertical and with what angle, per-season angles, recurring industry events, the education angle, and when review-asking lands naturally. A pack never generates anything by itself; rules require grounding regardless.

## Areas (16) and the fixed handoff table

Draftable via the **Writer** (`post`/`faqs` — real contract kinds): holiday, seasonal, industry_event, promotion, content_freshness, service_launch, customer_education, landing_page, gbp_post. Via the **Editor** (`edit_identity`): homepage_refresh. **Manual always** — the Coach never sends, posts, or asks on the customer's behalf: review_request, trust_building, email_campaign, social_campaign, referral_campaign. The table is fixed per area; neither data nor model chooses a route.

## Customer control & memory

Accept / dismiss / defer / ignore. Deciding is never executing — "accept" only marks the row and returns the prepared handoff; the room then opens the existing Writer/Editor desk (proposal, approval, Draft Writer, all unchanged from M9.5A/B). Memory is keyed by `(opp_key, opp_hash)`: dismissed or accepted opportunities never resurface while their grounding state (evidence types + occurrence — never day counts) is unchanged; deferred sleep until their date; ignored simply persist without repetition. Each holiday year is a new occurrence.

## The model tier (optional, sanitized)

The model may only **add** ideas in four idea areas (promotion, customer_education, social_campaign, email_campaign), and every idea must carry a `grounding_quote` verbatim from the customer's own content — no quote, no idea. Handoffs come from the fixed table regardless of model output; calendar areas are deterministic-only (the model cannot invent holidays). Capped at 3; deterministic opportunities win their `opp_key` slot.

## Relationship to Business Moments (explicit since M9.5G)

Moments are **reactive** (the site needs attention now, max three, judgment-driven); the Coach is **proactive** (worth planning for, opened deliberately). When both would speak about the same underlying evidence, **Moments speak and the Coach yields**: `COACH_YIELDS_TO` maps each evidence-gap area to the moment keys covering the same concern, and the area stays silent while such a moment is active or was dismissed within the 30-day moments memory — the customer never hears one concern from two mouths, and dismissing once means once. `review_request` has no moment twin and never yields; calendar/industry areas are the Coach's own ground and never yield. The Coach still writes only to its own table and never touches moments, judgments, or recommendations.

## Tests

`tests/presence/coach_test.mjs` — 49 checks. Pure: calendar date math and lead windows, industry-specific packs (restaurant fires Valentine's, generic doesn't, hvac gets furnace season), the 10-element contract, the value filter (bare business → zero), evidence grounding, duplicate suppression, dismissal/accept/defer memory, the fixed handoff table with real Writer/Editor kinds, no-execution structural checks, the idea sanitizer. Staging integration: a real run (model tier live), content byte-identical before/after, dismiss + defer recorded and honored across a rerun, accept returns the handoff and drives the real Writer (proposal only, discarded), published content untouched throughout.

## Storage & extension points

`presence_growth_opportunities` (0028): full contract columns, `manual_possible`/`approval_required` CHECK-constrained to true, status open/accepted/dismissed/deferred/superseded, RLS client-read. Extending: a new vertical = one `GROWTH_PACKS` entry; a new opportunity type = one grounded generator in `coachOpportunities` + an `AREA_HANDOFF`/`EFFORT`/`PRIORITY` row (and, if area-new, the migration CHECK list); new calendar events = entries in `holidaysFor`/pack `events`.
