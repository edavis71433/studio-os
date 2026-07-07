# Brand Guardian — M9.5D (Phase 4 of the AI Content Studio)

The Guardian **protects consistency**. The Writer creates, the Editor improves, the Reviewer critiques quality — the Guardian protects the customer's *identity*: everything published should feel like it came from the same business. Structurally it cannot do anything else: its module has no write path to content (no serializer, no Draft Writer, no content routes imported), findings carry no payloads, and handoffs come from a fixed table the model cannot touch.

## Architecture

```
routes/brand.ts                    guardian/rules.ts (PURE)              guardian/engine.ts
─ GET/PUT /brand/profile           ─ 16-category consistency taxonomy    ─ profile + fact sheet + media →
  (16 fields; `learned` is         ─ the 15-field finding contract         deterministic findings (ALWAYS —
  read-only through PUT)           ─ guardianFindings (AI-off tier)        the Guardian works with AI off)
─ POST /brand/review               ─ sanitizeGuardianFindings: fake      ─ optional model tier for
  {scope: site|section}              ids/fields/categories die;            contradictions/personality,
─ GET reports / report               contradictions need BOTH sides        sanitized, merged
  (internal_metrics never            quoted verbatim                     ─ observeLearning → `learned`
  selected — Law 13)               ─ deriveGuardianHandoff: fixed          (guidance only; customer fields
─ POST /:id/dismiss                  category table → editor | manual      untouched by anything but the
                                   ─ observeLearning (guidance only)       customer)
```

## The Brand Profile (the customer's, entirely)

Sixteen fields, all edited by the customer through `PUT /brand/profile`: mission · vision · core_values · personality · voice_characteristics · preferred_vocabulary · words_prefer · words_avoid · never_claims · reading_level (everyday/relaxed/professional/technical) · industry_terminology · taglines · elevator_pitch · target_audience · brand_promise · selling_points.

A separate `learned` column holds observed guidance — which proposal kinds the customer accepts or discards, which tones they choose. It is written **only** by the review engine, is **not writable** through the profile route (tested: a `learned` key in the PUT payload is ignored), and is **never merged into the customer's fields**. The learning output deliberately shares zero keys with the 16 profile fields, so it *cannot* overwrite them even by accident. Learning informs; the customer decides.

## Category taxonomy (16)

tone_drift · vocabulary · terminology · formatting · capitalization · headlines · cta_consistency · personality · reading_level · professionalism · business_consistency · generic_ai_language · repeated_phrases · contradictory_messaging · visual_photography · visual_assets.

## The deterministic tier (AI off — full function)

Consistency checks that need no model: avoid-list words in the copy (the customer's own law, confidence 1.0) · stock-AI phrasing ("nestled", "culinary journey", "look no further"…) · tone drift via reading-ease spread across substantial passages · 4-gram phrases repeated 3+ times · mixed price formats · category casing variants (Mains/mains/MAINS) · description reading-ease vs the profile's chosen level · phone numbers in copy that don't match the business number · CTA/link mismatches (ordering link never mentioned; "reserve a table" with no booking link) · photography orientation mix and low-resolution images (review only — the Guardian never touches assets).

## The model tier (optional, sanitized)

Only for what patterns can't catch: contradictory_messaging, personality, tone_drift, professionalism, terminology, headlines. The sanitizer enforces: only those six categories survive; locations must reference real entity ids and real identity fields; supporting quotes must be verbatim substrings of the actual content; **a contradiction finding without both sides quoted dies**; confidence is clamped to [0.5, 0.85]. Deterministic findings win their (category, location) slot in the merge; the model adds only new angles. Report bounded at 16 findings, attention-first.

## No scores (Product Law 13)

Internal consistency measures are numbers (tone spread, price-style count, repeated-phrase count) and live in `internal_metrics` — a column the report route **never selects**. Nothing numeric reaches the customer; every finding is a sentence in merchant language. The integration test asserts the report payload contains no `internal_metrics` and no `"score"` anywhere.

## Relationship to the Editor (and no one else)

"Improve" is a handoff, not an action: voice findings carry `{route: editor, kind: edit_*, action, target_id}` and the room calls the Editor's own `/editor/improve` — proposal, compare, approval, Draft Writer, all as in M9.5B. Three classes stay **manual** by fixed rule: visual findings (humans choose photographs), business_consistency (humans verify facts — the Guardian can see two phone numbers disagree but not which is right), and contradictory_messaging (only the customer knows which side is true). The model never chooses a route.

## Review integrity

Whole-site (`Does it all sound like me?` in the room) or per-section. Each run supersedes the previous open report of its scope; dismissal is per-finding, recorded, never deleted. The strongest property is tested directly: **content is byte-identical before and after a brand review.**

## Tests

`tests/presence/guardian_test.mjs` — 40 checks. Pure tiers (no LLM): taxonomy, the 15-field contract + constants, every deterministic detector, clean-brand silence, section scoping, the sanitizer's six kill rules, fixed handoff derivation, learning-can't-touch-the-profile. Staging integration: profile edit, `learned` not writable via PUT, invalid reading level rejected, a real whole-site review (model tier live), contract on stored findings, no metrics/score leakage, byte-identical content, learning written without touching customer fields, per-finding dismissal.

## Storage

`presence_brand_profile` (0027): one row per site, RLS client-all on the 16 fields, `learned jsonb` function-written. `presence_brand_reports` (0027): findings jsonb, `internal_metrics jsonb` (internal), scope/target/status, RLS client-read only.
