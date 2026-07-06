# Business Moments Engine — M9.3

The fourth constitutional link (05 §2/§5) and the **first customer-facing intelligence**: Observation → Evidence → Judgment → Recommendation → **Business Moment** → *(M9.4) Concierge → Draft Writer → …*. The engine deterministically translates M9.2 recommendations into **at most three** calm moments in merchant language. No AI, no chat, no concierge surface (that is M9.4), no raw recommendations exposed, no priority values shown to customers.

## The Moment Contract (12 fields, deterministic)

`moment_id` (content hash — "new evidence" is precisely "this hash changed") · `timestamp` · `supporting_recommendation_ids` · `moment_type` (good_news / needs_attention / reminder / opportunity / celebration / seasonal / business_health / learning — the last four are reserved legal values for later sources) · `headline` + `summary` (Direction A voice, customer words only) · `tone` (reassuring / attentive / encouraging / celebratory / informative) · `importance` (1–5, **internal** — the customer payload never contains it, by test) · `dismissable` · `deduplication_key` · `expires_at` · `future_follow_up` (when a remembered dismissal will age out).

## Selection rules

1. **Eligibility:** active, customer-audience, unexpired recommendations — one per rule. Operator concerns can never become customer moments (there are no templates for them, by test).
2. **The merging law (standing):** two or more improvement-class concerns always become ONE bundle moment ("A few improvements are ready when you are."), naming the areas in plain words. Five SEO observations became one judgment at M9.1; multiple improvement *recommendations* become one *moment* here.
3. **The ladder:** deterministic score = priority base (critical 800 → informational 100) + value-dimension bonus (trust 50 > business accuracy 45 > search 40 > accessibility 35 > performance 30 > … > growth). A bundle carrying N concerns gets +N — breadth outranks a single equal-priority concern, never jumps a class.
4. **The three-moment law:** everything competes for three seats by score; losers are *deferred* (reported, not stored as noise).
5. **A day with nothing to say says so:** zero surviving concerns → exactly one non-dismissable good-news moment ("Everything customers can see is current."), expiring in 2 days.

## Tone rules (enforced by lint test, not convention)

Merchant words only. The test fails the build if any template **or any generated output** contains engineering vocabulary (SEO, schema, metadata, canonical, HTML, API, error, broken…), alarm words (urgent, immediately, critical), exclamation marks, ✦, sales language, or blame constructions. The voice is a thoughtful business partner: "Worth confirming things are current." — never "CRITICAL: stale content detected."

## Dismissal lifecycle (memory)

Dismissal is recorded on the moment row (`status=dismissed`, `dismissed_at`) via the client route. On regeneration, a candidate with a remembered dismissal is **suppressed** (stored with reason `dismissed_remembered` and a `future_follow_up` date — auditable) unless one of three deterministic conditions resurfaces it:
1. **New evidence exists** — the content hash changed (different supporting recommendations).
2. **Materially worse** — importance now exceeds the importance at dismissal.
3. **The dismissal expired** — 30 days (`DISMISSAL_TTL_DAYS`).

`first_seen_at` carries per key across batches; each generation supersedes the previous active set (`status=superseded`), so history is complete.

## Surfaces

- **Engine (staff/system):** `POST /admin/sites/:id/moments-generate` (consumes the latest recommendation batch), `GET /admin/sites/:id/moments` (full internal view).
- **Client (additive to API v1):** `GET /moments` — ≤3 active moments through `clientView()`: id, type, headline, summary, tone, dismissable, created_at — nothing else, by test; `POST /moments/:id/dismiss`. RLS: clients read their own rows; all writes via the function. **The room UI is deliberately not wired** — carrying moments into Today is the concierge's job (M9.4).

## Testing & measurements

`tests/presence/moments_test.mjs` — **29/29 green**: template coverage (11/11 customer rec rules; zero operator leakage), tone lint over templates and generated output, healthy business (one good-news moment, constitution-exact copy), three-moment law under full load, standing merge with plain-word lists, ladder ordering, all three dismissal-resurface conditions plus memory expiry, input hygiene, no-internals client view, byte-determinism and order-independence, perf (**~0.15 ms** per pass), staging integration (full four-engine chain → 1 calm moment; client read with safe fields; real dismissal; memory held across regeneration). Regression: room 38/38, admin 51/51, recommendation 31/31. Deployed staging + prod with 0023.

## Extension points

Celebration/seasonal/learning types are already legal values awaiting their sources (publish events, the business calendar, destination signals — M9.4+/M10). New customer recommendation rules fail the coverage test until a template exists. The concierge (M9.4) consumes exactly `clientView` + the notes seam it already owns — no contract change needed to put moments on the Today page.
