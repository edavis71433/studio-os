# AI Editor — M9.5B (Phase 2 of the AI Content Studio)

The Editor improves **existing** content — it never invents, never replaces meaning, never publishes. It rides the Writer's rails end to end: the same fact sheet, the same deterministic Fact Guard, the same proposal table with schema-enforced approval, and the same acceptance path through the **unmodified Draft Writer**:

**AI Editor → proposal (compare & review) → customer acceptance → Draft Writer → draft → preview → publish ritual.**

## Architecture

```
routes/editor.ts                writer/editor.ts
─ POST /editor/improve          ─ EDIT_ACTIONS: the 22-action taxonomy, each with its own
  (review/accept/discard          instruction + why + expected benefit (merchant words)
   shared with the Writer)      ─ buildBefore: the current text per kind — also fed to the
                                  guard as ALLOWED TRUTH (edits may keep every existing fact)
                                ─ sanitizeEditPayload: closed shape; only REAL entity ids survive
                                ─ changeSummary: deterministic field-by-field diff description
                                ─ comparePack: before / after / summary / why / benefit
engine.ts (extended)            ─ generateEdit: task → model → sanitize → guard → self-check
─ composeMerged: faqs_edit /      → compare → store; violating options DROPPED
  posts_edit apply IN PLACE
  (same id, same slug, same
  count — improve, not append)
```

## Editing actions (22)

rewrite · expand · condense · simplify · clarify · modernize · readability · accessibility · seo · aeo · conversion · trust · cta · headlines · linking · structure · flow · scannability · grammar · consistency · tone · brand — each carries its own *why* and *expected benefit*, spoken in merchant language (tested), so every proposal teaches as it suggests.

## Supported content — the honest mapping

**In place, into the draft:** identity copy (homepage/about/hero/value-prop/CTA framing → `edit_identity`), FAQs (`edit_faq`), menu/offering descriptions (`edit_offering`), shown updates/blog/news (`edit_post`), and **the whole website** (`site_polish` — one pass over identity + all visible answers + all item descriptions, one reviewable proposal). **As documents:** any pasted text — GBP posts, emails, social posts, policy drafts, landing/team-page copy (`edit_document`) — improved and returned for the customer to use where it lives. Draft-status updates are edited by hand (they're not in the snapshot yet); the room offers ✦ improve only on shown updates.

## The compare view (every option, mandatory)

`before` (the current text) → the improved payload → `change_summary` (deterministic: "question: unchanged; answer: revised (22→20 words)") → `why` (from the action taxonomy, plus "it supports a concern the room already raised" when recommendation-aware) → `expected_benefit`. The room renders it as struck-through before, serif after, and one honest meta line.

## Fact Guard integration

The guard runs with one addition: **the existing text is allowed truth** — an edit may keep any fact already written (a phone number in the current answer stays legal) but may add nothing new. All Writer protections stand (phones, prices, hours, awards, licenses, guarantees, quotes, staff, history, never-claims) plus new ones added this milestone: invented percentages and discount/offer language. Missing facts → questions, never guesses.

## Voice & recommendation awareness

The voice profile and industry pack guardrails ride in every prompt. An optional `recommendation_hash` loads that **existing, active** recommendation and lets its reasoning inform the edit — recorded in `evidence_used`, surfaced in the why line. The editor can support accepted recommendations; it cannot mint new ones (it only reads the recommendations table).

## Customer control & manual parity

Optional (only runs when asked) · editable (customer `edits` on acceptance win entirely) · reviewable (compare pack, approval schema-enforced) · reversible (Draft Writer safety snapshot + hand-editing restores anything — proven live) · nothing auto-publishes or auto-accepts · every piece of content the editor touches remains fully hand-editable through the M7 routes, untouched.

## Testing

`tests/presence/editor_test.mjs` — **26/26 green**: taxonomy completeness (22 actions, self-explaining, merchant-worded), before-builders (including honest `nothing_to_edit` / `target_not_found` / `text_too_short`), fact preservation (existing facts legal, invented offers/percentages rejected, never-claims binding), compare pack + deterministic change summaries, sanitizer id discipline (ghost ids dropped, closed shape per kind), in-place composition (same count, same ids, slugs and dates preserved, customer-edits-win), and a **live staging run**: a rambling FAQ answer genuinely improved in place ("22→20 words", guard passed), accepted through the unmodified Draft Writer with no append, then restored by hand. Regression: writer 37/37, room 38/38. Deployed staging + prod with 0025 (kind-check widened, additive); prod boundary 401.

## Extension points

M9.5C+ (reviewer) consumes the same self-check machinery over whole sites without generating. New actions are taxonomy entries; new editable kinds follow the before-builder + sanitizer + compose pattern. When contract pages ship (Class C), `edit_document` page copy graduates to in-place page editing. Per-client AI disable (Law 24) will gate `/editor/*` alongside `/writer/*`.
