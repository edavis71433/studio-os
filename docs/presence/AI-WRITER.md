# AI Writer — M9.5A (Phase 1 of the AI Content Studio)

The Draft verb (03 §3, rung 2) made real: the Writer produces **proposals of structured content, only when asked**, and nothing it writes can reach the world except through the chain it cannot skip:

**AI Writer → proposal (review) → customer acceptance → Draft Writer (unmodified) → draft → preview → publish ritual.**

## Architecture

```
routes/writer.ts                writer/engine.ts                    writer/guard.ts (PURE)
─ generate/list/get/            ─ fact sheet + industry pack        ─ THE FACT GUARD: rejects any
  accept/discard                  → task prompt → model (injectable)  invented phone/price/hours/
                                ─ sanitize (closed shape, caps)       award/license/guarantee/quote/
writer/facts.ts (I/O)           ─ guard + self-check per option;      staff/history/never-claim
─ the client's own content,      violators DROPPED                  ─ placeholders = the legal
  voice profile — ALL the       ─ accept: composeMerged (pure)        "missing", questions preferred
  truth the model may use        → applySnapshotToDraft (UNTOUCHED)
```

The model (`writer/model.ts`, claude-haiku-4-5 via the project's existing `ANTHROPIC_KEY`) is **injectable** — the entire workflow, guard, and acceptance path test without an LLM; the model is never trusted (output is sanitized to a closed shape, capped to the API's own field limits, then fact-guarded deterministically). No key → routes answer an honest 503 and the manual paths remain the whole product.

## Draft lifecycle & contract

`presence_ai_drafts` (0024) rows carry the full frozen contract: draft id, origin (customer_request | recommendation), prompt summary, confidence (docked deterministically per missing fact and assumption), **missing_facts** (questions, never inventions), evidence_used (recommendation hashes), assumptions, `approval_required` (**schema-enforced true**), generated sections (the options), generated assets (always `[]` in v1 — no asset generation), version, model (auditable). States: proposed → accepted | discarded | expired. Acceptance records `applied_summary` in plain words; the Draft Writer's own safety snapshot + provenance fire as always.

## Fact protection (the Fact Law's teeth)

Never invented, enforced by regex-class checks that run on every option regardless of the model: hours, phone, address, pricing, staff names, awards, licenses, guarantees, ratings/superlatives, reviews/testimonials/customer quotes, business history (founding years). Numeric runs absent from the fact sheet are violations; `[bracketed placeholders]` are the legal way to say missing; the client's `never_claim` list is a hard denylist; offering descriptions may only target **existing offering ids**. Violating options are dropped; if all violate, generation fails honestly ("…it was set aside. Try again — or write it by hand, which always works.").

## Voice system

The prompt receives the client's voice profile (tone notes, preferred vocabulary, never-claims) plus the **industry pack** guardrails (restaurant v1: appetite-forward, concrete, no health/sourcing claims, no cuisine clichés). The self-check scores readability (Flesch ≥50), jargon, weak CTAs, duplicates against existing content, grammar smells, and search-snippet lengths — stored per option for the customer to see.

## Supported content — the honest mapping

Everything in the milestone's list maps to what the contract can actually hold:
- **Into the draft** (via Draft Writer): homepage/about/mission/taglines/value-props/CTA/hero copy → `identity` fields; services & menus → offering descriptions (+ new offerings only in starter mode, from customer-provided facts); FAQs; blog/news/seasonal/holiday/promotions/events → posts; **whole starter website** → all of the above in one proposal.
- **As reviewable documents** (they can publish nowhere yet, and say so): testimonial *requests* (never testimonials), policies (template-assisted, placeholder-heavy, professional-review note), GBP/Facebook/Instagram/LinkedIn posts and emails/newsletters (until destinations, M10), landing/service/team **page copy** (until contract pages, Class C).
- Accepting a post marks it *shown in your draft* (Draft Writer post semantics); the ritual still gates the live site, and the Updates toggle can re-draft it in one tap.

## Customer control

Multiple directions (up to 3 tones) — the customer chooses; edits on acceptance **win entirely** over model output; everything discardable without trace; everything editable afterward exactly like hand-written content; everything reversible (the acceptance's safety snapshot + version history); nothing auto-publishes — ever. The room's entry points are ✦-marked "draft with help" affordances on Questions, Updates, and Business; the writing desk shows options with their guard/check results and the standing note: *"nothing is invented, everything lands in your draft only if you keep it."*

## Testing

`tests/presence/writer_test.mjs` — **37/37 green**: 12 fact-guard cases against hostile outputs (invented phones, prices, hours, awards, guarantees, founding years, fabricated quotes, named staff, never-claims, fake reviews — and placeholders passing), 6 self-check cases, 7 composition cases (additive, non-destructive, customer-edits-win, deterministic), taxonomy/approval partitioning, and a **live staging run**: real generation (2 options, 0 dropped, 4 missing facts honestly reported, confidence docked to 0.5), full-contract proposal, acceptance through the unmodified Draft Writer (+4 editable FAQs, safety snapshot proven), hand-reversal to the before-state, and traceless discard. Regression: room 38/38, concierge 32/32. Deployed staging + prod with 0024; prod boundary 401.

## Extension points

M9.5B (editing) reuses the same guard/desk seams on *existing* text. Destinations (M10) graduate `social_post`/`email_doc` from documents to projection proposals. Contract pages (Class C) graduate `page_copy`. New verticals are new pack entries. Per-client AI disable (Law 24's toggle) will gate `/writer/*` per site; today the writer is opt-in by construction — it only ever runs when asked.
