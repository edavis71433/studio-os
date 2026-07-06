# Presence Judgment Engine — M9.1

The second link in the constitutional chain (05 §2): **Observation → Evidence → Judgment** → *(M9.2+) Recommendation → Human Decision → Draft Writer → Draft → Publish*. The Judgment Engine answers four questions from evidence alone — *what matters, why, how urgent, and whether the customer should even be interrupted* — and hands structured judgments to M9.2. It speaks to no customer, writes no content, recommends no action, and calls no model.

## Architecture

```
engine.ts (I/O)                       rules.ts (PURE)
─ load latest finished evidence run   ─ judge(evidence, ctx) → judgments
─ load prior judgment keys            ─ 19 rules: group → prioritize →
  (first_seen carry-over)               classify timing/audience
─ store batch (suppressed included)   ─ suppression pass (conflicts, noise)
                                      ─ stable sort → reproducible order
```

Input is **only** M9.0 evidence rows from the latest finished run — the engine never inspects a website, never creates observations. The pure core takes `(evidence, {siteId, now, previous})`; prior state rides in as data, so even first-seen continuity is deterministic.

## The Judgment Contract (13 fields, deterministic)

`judgment_id` (content hash: same evidence → same id, proven across real staging re-runs) · `timestamp` (the pass's clock) · `evidence_ids` · `category` (11 business categories) · `priority` (critical/high/medium/low/informational) · `severity` (max of evidence) · `confidence` (min of evidence — conservative) · `reasoning` (deterministic template: counts, types, thresholds — every judgment self-explains) · `business_impact` (dimensions ⊂ {search_visibility, customer_trust, accessibility, business_accuracy, conversion, reputation, performance} + note) · `customer_impact` (internal explanation, **not customer copy**) · `timing` (immediate/soon/seasonal/whenever/none) · `dedupe_key` (stable per site+rule across runs) · `expires_at` (rule TTL). Plus engine fields: rule, `audience` (customer/operator/none — the interrupt answer), status, suppression_reason, evidence_count, first_seen_at.

## Priority rules

Deterministic functions of evidence only: severity ladders (critical evidence → critical/high judgment), count thresholds (≥3 undescribed images lifts low → medium), and measured facts (staleness ≥240 days lifts low → medium). No randomness, no models, no operator override inside the engine.

## Grouping rules

19 rules partition the entire 65-type evidence catalog — **every type is consumed by exactly one rule** (tested; unambiguous grouping, no silent gaps). Many observations become one business issue: 20 missing alt texts → one accessibility judgment; title+description+thin content → one search-snippets judgment; 6 broken links → one broken-paths judgment. Output is bounded by construction: never more judgments than rules (19), regardless of evidence volume.

## Suppression rules (all recorded, never deleted)

- `platform_roadmap` / `no_audience` — states nobody can act on today (unconnected profile sources, contract-future pages) are judged and shelved.
- `site_not_live` — conflict rule: a never-published site mutes public-facing judgments (freshness, snippets, broken paths…) as moot.
- `noise_floor` — a lone, low-confidence, informational observation is not a finding.
- Duplicates never arise (grouping); stale evidence never arrives (input = latest run only); resolved issues disappear because their evidence does; repeats don't stack (stable `dedupe_key`, `first_seen_at` carry-over).

## Lifecycle

Each `POST /admin/sites/:id/judge` (staff-only) produces one **batch** over the latest evidence run; suppressed judgments are stored with reasons — suppression is a decision and decisions are auditable. `first_seen_at` carries per key across batches (age of an issue is queryable). `expires_at` bounds staleness if observation stops. Reading: `GET /admin/sites/:id/judgments` (active by default; `?status=all|suppressed`, `?batch_id=`).

## Storage

`presence_judgments` (migration 0021, additive; staging + prod). RLS with no client policies — service-role only. Judgments reach customers only after M9.2 translates the surviving ones through the concierge grammar.

## Testing & measurements

`tests/presence/judgment_test.mjs` — **29/29 green**: rule-table integrity (65/65 types owned, zero overlap), healthy sets (zero active — nobody interrupted), dedup (20→1, 6→1), grouping, conflict suppression, noise floor, byte-determinism, order-independence, hash reproducibility, 13-field contract completeness, first-seen lifecycle, malformed evidence contained as `unmatched_types`, scale (**5,000 items → 57 ms, ~0.6 MB heap, output bounded at ≤19**), perf (**~0.9 ms** typical set), staging integration (7 judged / 6 active / 1 suppressed / 0 unmatched; re-judge reproduced 7/7 hashes; client 403). Regression: admin 51/51, evidence 32/32.

## Future extension points

New evidence types → assign to a rule (the integrity test fails until every type is owned). New rules → append; grouping stays unambiguous by the no-overlap test. External-source evidence (M10 destinations) → e.g. hours-parity types slot into `facts_inconsistent` to become the constitution's "business hours consistency issue." Scheduled judging and note-outcome awareness (dismissals shaping suppression) belong to M9.2+, where customer context legitimately enters.
