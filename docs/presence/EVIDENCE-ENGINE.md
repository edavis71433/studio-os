# Presence Evidence Engine — M9.0

The platform's observation layer, built exactly to constitution 05 §2/§10: it **observes and records; it never judges, never recommends, never writes content, never talks to customers.** Every future recommendation (M9.1+) must cite rows this engine produced — *if something cannot be measured, it cannot be recommended.*

## Architecture

```
collect.ts (ALL I/O)          providers.ts (PURE)              engine.ts
─ site row, snapshots         ─ 15 independent providers  →    ─ open run row
─ FileMap via the ONE         ─ (input, emit) → items          ─ store items (append)
  renderer, in memory         ─ no fetch, no clock,            ─ close run with the
─ table aggregates              no randomness                    provider execution record
─ ONE live-site probe         ─ catalog-enforced emission
        └──────────── ObservationInput (immutable) ────────────┘
```

- **I/O isolation:** `collect()` assembles one immutable `ObservationInput` — draft + live snapshot content, the FileMap rendered in memory through the one renderer (nothing deployed), media/provenance aggregates, and a single 8-second live-site probe. Providers are pure functions of that input; `input.now` is the only clock they ever see.
- **The 15 providers:** website, seo, accessibility, performance, structured_data, metadata, freshness, business_info, media, links, local_presence, reviews, trust, content, conversion. Independent (a provider failure is contained and recorded, contributing zero partial output), composable (the engine runs whatever the registry holds), extensible (a 16th provider is an append — proven in tests).
- **External-source categories** (local_presence profiles, review sources) exist today with site-side checks plus an honest `*_unconnected` observation; their external checks arrive with the destinations milestone (M10) through the same contract.

## The Evidence Contract (frozen shape, additive evolution)

Every item: `category · type · severity · confidence · timestamp(observed_at) · source · resource · human · tech · next_action · facts · fingerprint`.

Three fields plus both explanation templates are **catalog metadata** — fixed per evidence type in `contract.ts` (65 types at v1): severity, confidence (1.0 exact → 0.6 heuristic), and `next_action`, a static remediation hint like a lint rule's docs. That is how "recommended next action" remains an observation-time constant and never a judgment. Providers can only emit types registered in the catalog (unregistered types throw — enforced by test); explanations are deterministic templates over measured `facts`. **Additivity:** new types = new catalog entries; new fields = new columns; no free-form structures.

`fingerprint = hash(site|type|resource)` is the observation's identity across runs — the latest state of any observation and its delta history are one indexed query.

## Storage

`presence_evidence_runs` + `presence_evidence` (migration 0020, additive, applied staging + prod). RLS enabled with **no client policies — service-role only**: raw evidence is operator/internal material; customers meet it only through the concierge (M9.1+). Rows append per run; the run row records **which providers and checks executed**, so an item's absence from a later run is provable improvement — evidence has history by construction. Storage discipline: only notable observations are stored (severity info+); passing checks are implied by the run record, keeping volume proportional to what needs attention (~25 items/run on the staging reference site).

## Execution

- **Trigger:** operator surface — `POST /admin/sites/:id/observe` (staff-only, additive admin route). The run row supports `trigger ∈ {operator, schedule, publish}`; scheduled cadence and post-publish hooks are deliberate non-goals of M9.0 (the pipeline was not touched) and slot in later without contract change.
- **Read:** `GET /admin/sites/:id/evidence` (latest finished run by default; `?run_id=`, `?category=` filters) and `GET /admin/sites/:id/evidence/runs`.
- **Cost:** full run ≈ 2.4 s wall on staging (dominated by the live probe + queries); the 15 providers themselves run in ~1–2 ms.

## Testing

`tests/presence/evidence_test.mjs` — **32/32 green**: catalog integrity (all 65 types well-formed, 15 categories); healthy-fixture baseline (zero criticals); ten-field contract completeness on every item; 11 targeted degradations (stripped titles, bare imgs, missing contact, duplicates, stale dates, dangling links, heavy media, phone mismatch…); hostile inputs (XSS payloads, 100 KB strings, emoji floods — all providers survive, items stay well-formed); malformed inputs (empty snapshot, no pages, no hosting — survival plus the emptiness itself observed); byte-determinism; composability (16th provider) and catalog enforcement (rogue type contained); performance (avg **1–2 ms** per full pure run, threshold 50 ms); staging integration (real run stored, filters, run record, cross-run fingerprint overlap = 25/25, staff-only 403 for clients). Regression after the admin-router change: admin 51/51, room 38/38.

## What this deliberately is not

No LLM calls, no prompts, no interpretation, no prioritization, no summaries, no Business Moments, no customer-facing anything, no pipeline or renderer changes, no notes written. The chain stops at **evidence**; judgment begins in M9.1 and must consume these rows.
