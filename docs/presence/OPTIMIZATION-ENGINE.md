# Presence Optimization Engine — M10

The long-running observation layer. **Not** an AI subsystem, **not** a customer-facing assistant — twelve new evidence providers that continuously evaluate a customer's digital presence and feed the frozen deterministic intelligence architecture. They detect opportunities, problems, and improvements; they produce structured evidence; nothing more. All customer communication continues through the existing pipeline (Judgment → Recommendation → Moments → Concierge / studio tools).

## Architecture — providers all the way down

M10 added **zero orchestration**. The M9.0 Evidence Engine already defined the extension model, in writing, in its own source:

- *"adding a provider is appending to PROVIDERS"* (`evidence/providers.ts`)
- *"new evidence types = new catalog entries; new fields = new columns/keys"* (`evidence/contract.ts`, frozen additivity rules)

M10 is those two sentences, exercised:

```
optimization/collect.ts        optimization/catalog.ts        optimization/providers.ts
─ ALL new I/O, individually    ─ 33 new evidence types        ─ 12 pure providers,
  fenced (timeout + try/catch    (10-field contract, same       appended to the ONE
  → null): DoH DNS, RDAP,        CatalogEntry shape), four      registry (15 + 12 = 27)
  robots/sitemap/HTTP probes,    new categories: infra-       ─ (input, emit) — no I/O,
  knowledge docs                 structure, aeo, analytics,     no clock, no guessing:
─ spliced into collect() as      knowledge; the rest deepen     null probe → NO evidence
  one additive `opt` field       existing categories
```

The orchestrator (`evidence/engine.ts`), the run record, the storage pipeline, fingerprints, and every downstream consumer are byte-identical to M9.5G. A provider failure still poisons nothing (`runProviders` isolation, tested with a deliberately-throwing provider among optimization providers).

## The twelve providers

| Provider | Observes | Needs |
|---|---|---|
| `infrastructure` | DNS apex/www resolution, domain expiration (RDAP, ≤45d), http→https redirect, redirect chains | custom domain |
| `email_auth` | SPF and DMARC presence — only when MX exists (no mail, nothing to authenticate) | custom domain |
| `technical_seo` | robots.txt global blocks, sitemap coverage per page, orphan pages, duplicate pages | live site / rendered pages |
| `aeo` | FAQPage schema for existing FAQs, entity sameAs links, answer depth, citation facts (NAP+hours on home), location terms in the description | rendered pages + draft |
| `accessibility_deep` | unlabeled form fields, positive tabindex, aria-hidden focusables | rendered pages |
| `performance_deep` | compression, cache headers, time-to-first-byte (budget 1800ms) | live probe |
| `local_presence_deep` | NAP consistency — any rendered phone that isn't THE phone | rendered pages + draft |
| `reputation` | testimonial velocity (gap between the two newest ≥180d) | draft content |
| `analytics` | the honest absence: `analytics.not_connected` — no integration exists; when one does, trend observations join here under the same contract | — |
| `trust_deep` | team/about information absent | draft content |
| `visual_assets` | no imagery at all, missing og:image, duplicate uploads (bytes+dimensions) — observation only, never generates images | media + pages |
| `knowledge` | document↔site disagreements: unlisted items, price mismatches, phone mismatches, hours available but unset | imported docs |

Areas the milestone names that this v1 deliberately observes via *absence* or defers with a note: Core Web Vitals beyond TTFB, WCAG contrast (needs a CSS engine — future provider depth), Google Business Profile / Apple Business Connect field-level checks (no connection exists; `local_presence.profile_unconnected` records that), review sentiment/trends (no source connected; `reviews.source_unconnected` records that), traffic/conversion analytics (`analytics.not_connected`). When those connections ship, they become collector fields + provider depth — no architecture change.

## Business Knowledge Import (the renamed Document Intelligence)

Customers hand over what they already have — a menu, a flyer, a price sheet — as pasted text (`POST /knowledge/import`, capped 50k chars, 10 docs). Extraction is **deterministic regex-class parsing** (`optimization/knowledge.ts`): items with prices, phones, emails, URLs, hours lines. No AI, no summaries, no document review, no generated content — knowledge in, evidence out. The `knowledge` provider compares stored facts against the live draft on every evidence run and emits disagreements. The customer sees only their document list ("3 items noticed") and may delete any document; everything else stays inside the perception pipeline.

## Feeding the frozen architecture (the judgment seam)

The Judgment Engine's completeness law — every catalog type must be consciously handled — is honored the way its own rules table prescribes: all 33 M10 types are registered under the existing `platform_roadmap` rule (audience `none`, always suppressed, "recorded, never surfaced"), exactly like `local_presence.profile_unconnected` before them. **No M10 evidence reaches a customer as a side effect of observing more.** Promoting any type to a surfaced judgment is a deliberate future rules change with its own review — that is the seam where M11+ turns observation into action.

## Lifecycle

collect (fenced I/O) → providers (pure) → one run record listing all 27 executions → evidence rows (ten-field contract, stable fingerprints) → judgment (M10 types: recorded/suppressed) → the existing pipeline. Runs trigger exactly as before: operator (`POST /admin/sites/:id/observe`), schedule, publish. Absence stays meaningful: the run record proves which providers executed, so a missing observation in a later run is provable improvement.

## Extension model (future providers)

1. New observations → entries in `optimization/catalog.ts` (or a new sibling catalog spread into `CATALOG`).
2. New I/O → a fenced collector in `optimization/collect.ts` returning nullable fields.
3. New provider → append to `OPTIMIZATION_PROVIDERS`. Null input → observe nothing.
4. New category → extend the `Category` union + the migration CHECK (additive).
5. Register the new types in a judgment rule — `platform_roadmap` until they earn a surfaced judgment.
Nothing else changes; the composability test proves a 28th provider plugs in untouched.

## Tests

`tests/presence/optimization_test.mjs` — 41 checks: catalog integrity inside the ONE catalog, extractor determinism and prose-rejection, every provider family in isolation on synthetic truth, null-probe honesty (no probe → no guessing), byte-identical determinism, 27-provider composability, failure isolation, structural boundary (no Draft Writer/serializer/model imports, no scores), and staging integration: real import → real 27-provider run → knowledge evidence stored through the untouched pipeline → content byte-identical. The M9.0 evidence suite grew to 32 checks (counts updated for sanctioned growth); judgment/recommendation/moments/coach/concierge/room/writer/editor/reviewer/guardian all green after.
