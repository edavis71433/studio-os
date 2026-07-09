# Phase T (continued) — Team Photos, Vertical Realization, Theme Looks, Launches Status

*Continues Phase T toward honest completion. FD-T18 (team photos) and FD-T4 (vertical realization) and FD-T3 (theme looks) are implemented; the remaining Phase-T items are each given an honest disposition grounded in the frozen constitution. Reuse-first; deployed staging + prod; no migration.*

---

## Built

### FD-T18 — Team-member photo picker
The team block editor became **structured**: each person has name / role / bio inputs **plus an optional photo** from the existing library (`openPicker`). The engine already resolved a member's `media_id` → `MediaRef` (T-BLOCKS-2), so this is UI over a proven path. Replaces the old pipe-delimited text control for team only.

### FD-T4 — Vertical realization (as presets, per Part 4)
The constitution caps templates ("as few as honesty allows… template count is a maintenance liability") and the Phase-T thesis is that **verticals differ by vocabulary + which blocks they emphasize, not by bespoke render code**. So a vertical is realized as *(one engine × industry vocab × theme × recommended blocks)*:
- **`lib/vertical_presets.ts`** (pure) — for an industry, the content blocks that make it feel intentionally designed (trades → before/after + service areas + process + certifications; beauty → team + gallery + pricing; professional → team + process + stats + certifications; medical → team + certifications; retail/food → gallery; community → stats + cta; generic baseline). Every suggestion is a realized `site_components` block.
- **`GET /blocks/suggested`** (reuses the stored `industry_key`; no client-side duplication of the map) → the block editor shows **“✨ Suggested for your business”** with a plain-English reason and a one-tap **“Add these sections.”**
- **This is a deliberate reading of "vertical templates."** If the owner wants literal bespoke per-vertical template code, that tensions with the frozen Part 4 and is flagged as a constitutional decision — not assumed.

### FD-T3 — Theme system completed with one-tap “Complete looks”
The Design Studio already had palettes (12, WCAG-checked), type presets, size/corners/background/density, and a per-industry suggestion — all on the one dev-token layer. Added **six named complete Looks** (Warm & inviting, Clean & modern, Bold & confident, Fresh & natural, Refined & elegant, Original) that set a coordinated palette + type + shape in one tap via the same `saveTokens` machinery. A look is a **variant of the one engine, not a new template** (Part 4).

---

## Honest disposition of the remaining Phase-T items

- **FD-T8 template-switch staged preview** — ✅ already done (CP-1): `/preview?template=` renders any look with the real draft content, nothing persisted, contract-checked.
- **FD-T11 crop/focal, FD-T12 section-order-as-data** — ✅ done (DS-5 / DS-2).
- **FD-T7 full Launches lane** — ⏳ the large remaining piece: a *named parallel draft* alongside the working/live draft, promotable atomically. It changes the one-draft model, so it needs **owner sign-off on the approach** before build. Proposed conforming design: a second named draft that renders through the **same** `renderSnapshot` pipeline and promotes as one atomic publish — **no second renderer, storage, or pipeline**.
- **FD-T9 logo→brand-kit** — ⏳ buildable (deterministic palette extraction from an uploaded logo); not built this round.
- **FD-T10 stock photos** — ⏳ **owner/provider-gated**: a live stock API is an external origin (Part 4 forbids external origins on the published site); a bundled curated set would conform.
- **FD-T2 lazy/indexed registry** — the registry is **already indexed** (`getTemplate`/`listTemplates`/`latestTemplateVersion`); **lazy dynamic-import** is deferred until version count warrants it (premature at 3 templates; Part 4 values a boring, in-head registry). No customer impact.
- **FD-T6 dark mode** — ⏳ **owner decision** (public small-business sites are light by design). **Custom uploaded fonts** — 🚫 **constitution-blocked** (external webfonts violate Part 4 zero-external-origins); the local/system type presets are the conforming answer.

---

## Testing, regression, deploy
- **`vertical_presets_test.mjs` — 14/14** (right blocks per family; every suggestion is a realized + catalog-declared block; deduped; every industry ≥2 suggestions + a note).
- **Regression:** full pure sweep **70/70** — site_blocks 38/38, feature-boundary 189/189, render 28/28, editions 36/36, invariants 14/14, and the rest.
- `deno check` clean (index + content + vertical_presets). `presence.html` inline script syntax-verified (`new Function`).
- **Deploy:** function to staging + prod, "Deployed Functions" confirmed; smoke `/connections`=401, `/blocks/suggested`=401 (routed+auth-gated), `/commerce/plans`=200 both. **No migration.**

## Conformance
- **Two-App Law:** all work lives inside the Studio App's Website module; no new app, no new user-facing surface.
- **Part 4:** determinism preserved (pure libs, one render pipeline); **zero external origins** upheld (looks/presets use only local tokens; stock-photo external APIs explicitly deferred).
- **Part 6:** blocks + presets are structured content the owner chooses and fills — not a page builder.
- **Reuse / no duplication:** one token layer (`saveTokens`), one media pipeline (`openPicker`/`ref()`), one settings endpoint, one render pipeline, the server owns the vertical map (client never duplicates it). No new AI.
