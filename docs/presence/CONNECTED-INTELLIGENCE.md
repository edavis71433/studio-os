# L4.2 — Connected Intelligence

Connected services should make Studio OS **smarter, never noisier.** L4.1 brought a customer's external accounts into the Evidence Engine as read-only facts. L4.2 makes those facts *work* — strengthening what we already know, quietly correcting what we had wrong, and celebrating what's going right — all through the one pipeline, never around it, and almost never by adding to the customer's list.

## Connected Intelligence Architecture

Connected data has always entered as ordinary evidence (`connected/evidence.ts`, catalogued, no bypass). L4.2 lets that evidence do four things, each at the stage that owns it:

| Behavior | Stage | How |
|---|---|---|
| **Detect change** | Evidence | Compare the freshest snapshot to the prior one (`prev`), emit `*_up` only on *meaningful improvement* |
| **Strengthen / correct** | Judgment | A pure cross-pass corroborates or contradicts *other* judgments |
| **Earn one concern** | Judgment→Moment | `connected_reputation` — the owner's reviews, edition-aware |
| **Celebrate** | Judgment→Moment | `connected_improved` — measured good news, one calm celebration |

Everything is pure and deterministic (`connected/intelligence.ts` derives effects from the evidence set; `judgment/rules.ts` applies them). A connected-less run is provably unchanged — the pass is a no-op with no connected evidence.

**The pipeline is never shortcut.** Evidence → Judgment → Recommendation → Business Moments → Concierge, for good news exactly as for problems. A celebration is intelligence too, and it flows the same pipe: a `connected_improved` judgment → a `monitor` recommendation (nothing to do) → a `celebration` moment.

## Confidence Rules

Connected data is *measured* (confidence 1.0), so where it independently agrees with an on-site judgment, that judgment is more trustworthy. Corroboration is applied narrowly and honestly:

- **People already arrive from search** (`seo.connected_search`, clicks > 0) **corroborates** the on-site search-listing judgments (`search_snippets`, `opt_ai_search`): a small, bounded confidence nudge (+0.05, capped at 1.0) and a reasoning note — *"connected search shows people already reach you this way; strengthening it compounds real, measured reach."*

Rules:
1. A bump is only ever applied to a judgment we can defend the corroboration for — never a blanket "connected data is present, boost everything."
2. It is **bounded and capped** — connected data nudges confidence, it never manufactures certainty.
3. It is **recorded in the judgment's reasoning** — auditable, never silent.
4. Unrelated judgments are untouched (tested).

## Evidence Merging

Connected concerns **merge, never duplicate.**

- The connected reputation task is **mergeable** — it folds into the existing "improvements bundle" moment alongside on-site opportunities, so the customer sees *one* calm shortlist, not a separate connected interruption.
- No connected concern re-states an on-site one: reputation (replying to external reviews) is a distinct surface from on-site content, so there is no double advice. When both are present, they bundle.
- Change signals are grouped: however many metrics improved (traffic, search, rating, new reviews), they become **one** `connected_improved` judgment → **one** celebration, never a per-metric ping.

## Suppression Rules (reducing false positives)

Connected data can prove an on-site heuristic wrong. When it does, the false judgment — and everything that rode on it — is suppressed:

- **Real activity contradicts "not live yet."** If connected analytics or search show real recent visitors/clicks, the site is provably live and being found. The `site_not_yet_live` judgment is suppressed (`connected_contradicts`), and because it leaves the active map, its *cascade* lifts too — valid public-facing concerns it had been masking (freshness, broken paths) correctly resurface.

Rules:
1. Only contradictions we can defend to a skeptical merchant are encoded (`CONNECTED_EFFECTS`).
2. A dip is **never** bad news — read-only intelligence never scolds; only improvement is observed, only false positives are removed.
3. Contradiction removes the judgment from conflict resolution, so it corrects the false positive *and* its downstream suppression.

## Celebration Rules

- Only **meaningful** improvement earns a celebration — deliberately conservative thresholds (traffic/search ≥20% *and* ≥10 more; rating ≥0.2★; ≥3 new reviews). A rounding-error wiggle is not a celebration.
- With **no prior read**, nothing is invented.
- A celebration is **the customer's to enjoy on every edition** (it isn't work, so it isn't reduced up the ladder) and is **grouped** into one warm moment.
- The Concierge celebrates a connected win the same calm way as an all-well day — warm, brief, "nothing to do."

## Provider Cooperation

- **One architecture, no per-provider behavior.** Every connected provider normalizes into the one shape; intelligence reads that shape, never a provider's API. Adding a provider adds data, never a branch (verified: multi-provider scenarios yield calm, non-contradictory output with no provider-specific code path).
- **Edition-aware, work-reducing.** Reputation is the customer's on self-serve (Monitor/Presence) and the **studio's on Managed and up** (`aud('optimization')`) — so connected intelligence *reduces* customer work as editions rise. On Managed, the same struggling shop shows the customer an all-clear while the studio holds the reputation task.
- **Monitor honesty.** A Monitor customer's connected accounts are their *own* — connected reputation and celebrations apply there (exempt from the Monitor "not applicable" suppression), because they're true of the customer's real external presence.
- **Observed-only stays observed.** Pure snapshots (`reviews.connected_summary`, `seo.connected_search`, `analytics.connected_traffic`) remain audience-none on every edition — the customer sees these numbers directly on the Connections surface; connecting a service never, by itself, adds an interruption.

## Tests & Validation

`tests/presence/connected_intelligence_test.mjs` — 31 pure checks: change detection (and its thresholds, and that dips/first-reads never fire), no-bypass mapping, confidence strengthening (bounded, recorded, no false corroboration), false-positive suppression + cascade lift, edition-aware reputation, the full celebration pipeline, merging without duplication, multi-provider harmony, additive-safety, determinism, and the Concierge's natural, jargon-free voice. Full regression green: evidence 25, optimization 33, judgment 23, recommendation 26, moments 23, concierge 26, connected-reads 15.

Multi-provider scenario validation (5 realistic businesses through the whole pipeline): a thriving cafe → one celebration; a new salon → the "not live" false positive removed and the valid freshness reminder resurfaced; a struggling shop → reputation merged calmly; the same shop on Managed → the customer sees an all-clear while the studio holds the work; a Monitor site → its own reviews still count. Every scenario: ≤3 moments, no contradictory tasks, no per-provider branching.

## Final review

- **Does connected data make Studio OS noticeably smarter?** Yes — it removes false positives, strengthens confidence where it independently agrees, and turns measured change into understanding.
- **Does it reduce customer work?** Yes — it *removes* false tasks, keeps observations silent, merges rather than adds, and shifts reputation work to the studio as editions rise.
- **Does it strengthen recommendations?** Yes — corroboration raises confidence and records why; contradiction retires recommendations that shouldn't exist.
- **Does it strengthen Business Moments?** Yes — it enriches the existing bundle, adds calm celebrations, and prevents a "not live" moment on a site that clearly is.
- **Does it preserve Calm Software?** Yes — no new interruption fires just for connecting a service; the only earned concern is mergeable; a dip never scolds; everything stays ≤3 calm moments in plain words.
