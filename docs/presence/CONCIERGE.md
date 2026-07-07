# Presence Concierge — M9.4

The customer's guide, sitting **on top of** the deterministic pipeline: Observation → Evidence → Judgment → Recommendation → Business Moment → **Concierge** → Human Decision → Draft Writer → … . One host, five verbs, everything grounded. It explains, guides, teaches, clarifies, encourages — and never controls, never invents, never bypasses evidence.

## Conversation architecture

```
room (presence.html)                      presence function
─ moments render as letters                POST /concierge/ask
─ "Tell me more" opens an in-letter        ─ grounding.ts (I/O): moments →
  thread: 5 question chips + a quiet         recommendations → judgments →
  free-text ask                              plain-language evidence
─ history (topic ids) held CLIENT-SIDE     ─ answer.ts (PURE): intent →
  for the current interaction only,          grounded answer, one of five verbs
  dies with the page                       ─ polish.ts (OPTIONAL LLM, env-gated)
                                           ─ verify.ts (hallucination gate)
```

## Evidence sourcing

The grounding pack is the concierge's entire world: the ≤3 active moments, the recommendations they cite, the judgments those cite, and the evidence's already-plain `human` sentences. "Why are you recommending this?" is answered by **quoting the actual observations verbatim** — "Hours are not set for sat, sun." — never by paraphrasing engineering into new claims. Every response returns `sources` (moment id, recommendation ids, evidence count) so any answer can be audited back down the chain.

## The five verbs (and only five)

**Explain** (what this means, why it was raised) · **Recommend** (carrying the moment's proposal) · **Teach** (why it matters, what happens if ignored) · **Guide** (how to fix it, what will change — always ending in the approval law: *"Nothing changes on your live site until you've looked it over and published it yourself."*) · **Celebrate** (good-news topics, whatever was asked). Enforced by test: no answer wears any other verb.

## Translation layer

Deterministic merchant maps — value dimensions ("how easily customers find you when they search"), effort ("a few minutes"), undoability ("every version of your site is kept"), timing ("no rush at all") — plus a per-concern place-map into the room (Business, Photographs, Questions, the publish page). A lint test guarantees no engineering vocabulary (SEO, schema, canonical, metadata, API…) ever reaches a customer answer.

## Memory boundaries

Conversation memory belongs to the **current interaction only**: the room holds a short history of topic ids in page memory and sends it back with each ask; the server stores nothing. Follow-ups resolve against that history; a fresh page starts fresh. Permanent memory remains where the constitution put it — moment dismissals and note outcomes.

## Customer control

"Fix this" prepares, never performs: the answer returns labeled pointers into the room (`Open Business`, `Review & publish`); the customer walks through the same draft → preview → publish ritual as always. The concierge has no write path of any kind.

## The AI boundary

All factual content originates from the deterministic engines — the LLM's only permitted role is rewording. Implementation: `polish.ts` is **double-gated** (env `CONCIERGE_POLISH=on` + `ANTHROPIC_KEY`; default OFF in both environments until the per-client AI toggle exists, per Law 24) and every polished output must pass `verify.ts`, which rejects invented numbers, guarantees/superlatives, URLs, persona mentions, chatbot voice ("as an AI…"), and ballooned rewrites — falling back to the deterministic answer on any rejection or failure. The deterministic voice **is** the product; polish is optional varnish.

## Failure modes (honesty by design)

Unsupported question → *"I can only speak to what's actually been measured…"* plus what IS known today. No topic → honest refusal with today's headlines. Low-confidence evidence → disclosed in the answer (*"part of this is judgment rather than hard measurement"*). No evidence behind a flag → said so. Quiet day → said calmly. The concierge never guesses — tested.

## Testing & measurements

`tests/presence/concierge_test.mjs` — **32/32 green**: intent classification (six questions + do-it + overview + honest refusal of philosophy and weather), five-verbs enforcement, verbatim evidence quoting, approval-law presence in every guide, all honesty modes, no-invention checks (digits, recommendation ids), one-host + no-chatbot + no-jargon lints, conversation continuity and its absence without history, the full hallucination gate (7 cases), byte-determinism, **0.03 ms** per answer, and staging integration: a real client asked a live moment "why?" (17 evidence citations), "how do I fix it?" (4 room actions), a follow-up via history, and a weather question (refused honestly) — zero jargon in any live answer. Regression: room 38/38, moments 29/29. Deployed staging + prod (no migration — this milestone stored nothing new).

## Extension points

The five question chips can grow as intents are added to the classifier (each requires a grounded answer template — nothing ships ungrounded). When M9.5+ brings the Draft verb, "fix this" on `requires_ai` recommendations graduates from pointing at the room to preparing a reviewable draft through the Draft Writer — the answer contract already carries everything needed. Per-client AI preferences (Law 24's toggle) will gate `polish` per site instead of per environment.
