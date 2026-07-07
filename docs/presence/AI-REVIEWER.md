# AI Reviewer — M9.5C (Phase 3 of the AI Content Studio)

The Reviewer **critiques**. The Editor improves. The Writer creates. The responsibilities never overlap — structurally: the Reviewer's module has no write path to content (it imports no serializer, no Draft Writer, no content routes), its findings carry no payloads, and its handoffs are derived from fixed tables the model cannot touch.

> **M9.5G:** the customer now meets the Reviewer and the Brand Guardian as **one review surface** ("A look over your website" — sections *How it reads* / *Whether it sounds like you*). Brand-identity categories (`brand_voice`, `tone`, `consistency`) are **ceded to the Guardian**: the Reviewer's model tier may no longer emit them (`MODEL_CATEGORIES` = 21 − 3). The 21-category taxonomy stays frozen so historical reports render.

## Architecture

```
routes/review.ts                 reviewer/rules.ts (PURE)              reviewer/engine.ts
─ POST /review/run               ─ 21-category taxonomy                ─ fact sheet → deterministic
  {scope: site|section|entity}   ─ the 15-field finding contract         findings (ALWAYS runs — the
─ GET reports / report           ─ deterministicFindings (AI-off tier)   reviewer works with AI off)
─ POST /:id/dismiss              ─ sanitizeModelFindings: fake          ─ optional model critique,
  {finding_id}                     locations/fields/ids/categories        sanitized, merged
                                   die; unquotable evidence stripped   ─ ONE report stored; previous
                                 ─ deriveHandoff: category+location →    open report superseded
                                   editor kind/action | writer kind |
                                   manual — NEVER model-controlled
```

## The finding contract (15 fields)

`review_id` · `category` (21) · `severity` (attention/suggestion/note) · `confidence` · `location` ({kind, id?, field?} — must reference real content, enforced) · `finding` · `reason` · `expected_benefit` · `suggested_action` · `requires_editor` (derived) · `requires_writer` (derived) · `manual_possible: true` (constant) · `approval_required: true` (constant) · `supporting_evidence` (verbatim quotes from the actual content — unquotable "evidence" is stripped, not trusted) · plus per-finding `status` and the prepared `handoff`.

## Category taxonomy (21)

readability · accessibility · seo · aeo · trust · conversion · brand_voice · grammar · tone · consistency · plain_language · structure · cta · internal_linking · heading_hierarchy · scannability · freshness · missing_information · duplicate_content · customer_questions · local_presence.

## Relationship to Editor and Writer

"Fix this" is a **handoff, not an action**: prose critiques carry `{route: editor, kind: edit_*, action, target_id}` and the room calls the Editor's own `/editor/improve` — proposal, compare pack, approval, Draft Writer, ritual, all as in M9.5B. Missing-content critiques (`missing_information`, `customer_questions`) route to the Writer (`faqs`/`identity_copy`). Verify-only critiques (`local_presence`) stay manual. The mapping is a fixed table; the model can propose a finding but never chooses where it goes.

## Fact Law & review integrity

The Reviewer reviews only what exists: every location is validated against real entity ids and real identity fields; every supporting quote must be a verbatim substring of the actual content; unknown categories die in sanitization. It never assumes business information — "missing information" findings ask for content, never supply it. The whole-site integration test asserts the strongest property directly: **content is byte-identical before and after a review.**

## Scopes & lifecycle

`site` (Review My Website — one grouped report, bounded at 20 findings, attention-first), `section` (business/offerings/faqs/updates), `entity` (one item). Each run supersedes the previous open report of its scope; dismissal is per-finding, recorded on the report (never deleted). Deterministic findings win their (category, location) slot in the merge; the model adds only new angles.

## AI-optional by construction

The deterministic tier runs regardless of keys — jargon, duplicates, weak CTAs, heading hierarchy, missing descriptions, readability are all real checks over real text. With no model, reports are marked `deterministic_only` and remain useful. With a model, depth increases and every added finding passes the sanitizer.

## Room surface

"✦ Look over my website's writing" (Business page) → findings as cards: category eyebrow, the finding in serif, why + benefit + suggested action, the verbatim quote it rests on, and two quiet actions — **✦ Fix with help** (opens the Editor/Writer desk with the handoff pre-filled) and **Dismiss**. A clean review says so: "It reads well."

## Testing

`tests/presence/reviewer_test.mjs` — **25/25 green**: taxonomy + full-contract completeness, five deterministic detections on messy content, **zero false positives on rich clean content**, section/entity scoping, five sanitizer kill-cases (fake ids, fields, categories, unquotable evidence), handoff derivation (editor/writer/manual), merge discipline (dedup, bound, severity order), and live staging: a real model review (6 findings), **byte-identical content before/after**, recorded dismissal, and a real fix-this handoff path. Regression: editor 26/26, room 38/38. Deployed staging + prod with 0026; prod boundary 401.

## Extension points

New categories are taxonomy entries plus a handoff row. Evidence-aware reviews (citing M9.0 rows alongside quotes) slot into `supporting_evidence` without contract change. Scheduled reviews belong to the same cadence question as the Evidence Engine (deliberately deferred). M9.5D+ personas (Brand Guardian as a hard pre-publish gate, Growth Coach) build above this — the Reviewer stays the neutral quality partner.
