# Presence Recommendation Engine — M9.2

The third constitutional link (05 §2): Observation → Evidence → Judgment → **Recommendation** → *(M9.3+) Human Decision → Draft Writer → Draft → Publish*. The engine answers, from judgments alone: *what should be done, why, on what evidence, how valuable, how difficult, and whether it can be undone.* It consumes **only** M9.1 judgments — never evidence, never websites, never a model — and produces structured recommendation objects that no customer ever sees raw. M9.3+ translates the survivors into the concierge's grammar.

## Architecture

```
engine.ts (I/O)                       rules.ts (PURE)
─ load latest judgment batch          ─ recommend(judgments, ctx) → recs
─ load prior recommendation keys      ─ eligibility: active, unexpired,
─ store batch (suppressed included)     interruptible, deduped per rule
                                      ─ 18-rule catalog, 1:1 with every
                                        interruptible judgment rule (tested)
                                      ─ informational floor → suppressed
                                      ─ stable order → reproducible output
```

## The Recommendation Contract (19 fields, deterministic)

`recommendation_id` (content hash over supporting judgments — order-independent, reproduced 6/6 on real staging re-runs) · `timestamp` · `supporting_judgment_ids` (full traceability: judgment → its evidence ids ride along as `affected_resources`) · `category` · `title` / `description` / `reason` / `expected_benefit` (**internal engineering language, never customer copy** — tested: no "you", no exclamations, no ✦) · `estimated_effort` (minutes/hour/hours/project) · `estimated_risk` (none/low/medium) · `undoability` (not_applicable / fully_undoable / versioned — content work is always `versioned`: draft → ritual → history) · `timing` (inherited from the judgment; urgency originates in evidence) · `affected_resources` · `recommended_action` (exactly one of twelve) · `requires_ai` · `manual_available: true` · `approval_required: true` · `expiration` (min of judgment expiry and rule TTL) · `deduplication_key`. Plus engine fields: rule, priority, audience, value_dimensions, status, suppression_reason, first_seen_at.

## Action taxonomy

create · update · remove · review · verify · monitor · connect · complete · refresh · replace · enable · disable — every recommendation belongs to exactly one (schema-checked). v1 usage: verify (hosting health, phone truth, closed flag), connect (provisioning), complete (first publish, missing facts), update (snippets, image descriptions), review (template passes, waiting drafts, broken paths), refresh (stale content), replace (heavy media), create (next-step paths, content depth), enable (security headers). remove/monitor/disable are reserved, already legal values.

## The approval model (constitutional, schema-enforced)

Every recommendation **requires customer/operator approval, has a manual workflow, never auto-completes, never publishes, never modifies content.** This is not convention: `approval_required = true` and `manual_available = true` are `CHECK` constraints in 0022 — a row violating Law 25 cannot exist. The engine has no write path to content; its output stops at the recommendation table.

## The AI boundary

`requires_ai` marks recommendations whose *proposed workflow* is AI drafting when M9.3+ ships: v1 flags exactly three (search snippets, image descriptions, content depth — the alt-text/rewording/drafting scope of constitution 05 §7 Class A). Everything else — verify hours, connect hosting, replace photographs, complete facts — is manual-only forever. AI-capable never means AI-required: the manual path is declared on every row, by law and by schema.

## Value classification

Nine dimensions: trust, search_visibility, accessibility, customer_experience, performance, business_accuracy, reputation, conversion, freshness — attached per rule, carried as `value_dimensions`.

## Lifecycle & suppression

One batch per `POST /admin/sites/:id/recommend` (staff-only) over the latest judgment batch; `GET /admin/sites/:id/recommendations` reads (active default; `?status=all|suppressed`, `?batch_id=`). Input hygiene is inherited and enforced: suppressed judgments recommend nothing, expired judgments are stale input, `audience: none` proposes to nobody, duplicates collapse deterministically. Engine-level suppression: `informational_floor` — "may be intentional" proposals are recorded for audit, surfaced to no one. `first_seen_at` carries per key across batches; `expiration` bounds staleness.

## Testing & measurements

`tests/presence/recommendation_test.mjs` — **31/31 green**: catalog integrity (18 rec rules ↔ 18 interruptible judgment rules, 1:1, no ambiguity), internal-language lint, AI boundary (both classes explicit; Law 25 on every row), approval model, full-chain traceability (evidence → judgment → recommendation with reasons and resources riding along), duplicates/suppressed/expired/no-audience input hygiene, upstream conflict preservation, informational floor, byte-determinism, order-independence, hash reproducibility, 19-field completeness, first-seen lifecycle, scale (full-catalog set → bounded ≤18 in ~2 ms), perf (~0.35 ms/pass), staging integration (6 recommended / 6 active / 0 unconsumed; hashes reproduced 6/6; client 403). Regression: admin 51/51, judgment 29/29. Deployed staging + prod with 0022.

## Extension points

New judgment rules fail the coverage test until a recommendation rule owns them. Destination-era actions (M10) get `connect`/`monitor` without contract change. When rung 2+ ships, `requires_ai` rows become Draft-verb proposals through the Draft Writer — the objects here are already shaped for the five verbs (title/reason/benefit/undoability map onto the note-and-proposal grammar) without a schema change.
