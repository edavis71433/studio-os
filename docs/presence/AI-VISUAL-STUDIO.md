# AI Visual Studio (V1)

*The second of the two remaining Version 1 customer builds (the first was the Connected Platform customer experience, L5.9). Brand-aware image generation for the customer's own presence — generation, editing, hero/social/Open Graph assets, variations, storage in the media library, and approval before use. Built entirely within the existing constitution; no law amended.*

---

## What this is

A customer can make images for their presence — a page banner, a social post, a link preview — described in their own words and shaped by their brand. They see a few options, can ask for more or for a change, and **approve one**; only then is it saved to their media library. Their own photos work exactly as before — this is an addition, never a requirement.

## The scope-and-law reconciliation (important)

Earlier audits (V1 Feature Completion, V1 Customer Workflow) treated "AI Visual Studio" as intentionally excluded, citing a Product Law that "photos are customer-supplied, generation forbidden." **On review of the constitution, no such law exists.** What the constitution actually requires — and what this build honors — is:

- **Manual parity** (Amendment 1): every AI workflow has a manual equivalent that is never slower, hidden, or degraded. Uploading your own photos (`/media/upload-url`) is untouched.
- **Approval before use** (the ritual + the Approved-Plan spine): nothing enters the library, and nothing reaches the live site, until the customer approves it.
- **Provenance honesty** (commercial constitution): a stored asset records origin `ai_approved` — the customer owns it on acceptance, exactly like AI-drafted text; provenance is for honesty, not to limit use.
- **The fact law** (Law 11): a generated image never bakes in an unverifiable **claim** — no awards, ratings, stars, prices, or "#1". Graphics, not fabricated evidence.

The owner has confirmed AI Visual Studio is in Version 1; this build delivers it consistent with all four.

## Architecture — data + one gated model, on the existing spines

`supabase/functions/presence/visual/`:

| File | Role |
|---|---|
| `contract.ts` | `VisualKind` + `ASSET_SPECS` (real, platform-correct dimensions), `VisualPlan extends ApprovedPlanBase`, `BrandSnapshot`, and the `VISUAL_HONESTY` promises (one source of truth). Pure data. |
| `brief.ts` | Pure brand-aware prompt builder. Folds in palette, personality, vocabulary, and industry; **scrubs claim-language** from the subject (the fact law reaches pixels) and always tells the model to render *no text, awards, badges, ratings, or prices*. |
| `model.ts` | The one generative call, gated exactly like the Writer's model: no `VISUAL_MODEL_KEY` → `imageModel()` returns null and the Studio is honestly "not available yet." Injectable, never throws. |
| `generate.ts` | `planGeneration()` (pure) builds the proposed plan; `runVariations()` is the thin model boundary returning image bytes. |
| `store.ts` | Persistence + promotion. Rides `lib/approved_plan.ts`: proposed → approved → **atomic claim** → stored. Draft variations live in the private bucket and become a `presence_media` row **only on approval**, with `ai_approved` provenance. Signs short-lived preview URLs so the customer can see drafts. |

**Routes** (`routes/visual.ts`, customer/client-site gate in `index.ts`):

| Route | Does |
|---|---|
| `GET /visual/kinds` | The asset kinds (plain labels + sizes), the honesty promises, and whether generation is switched on. |
| `POST /visual/generate` | `{ kind, subject, count?, palette? }` → a proposed plan + brand-aware variations. |
| `GET /visual/plans` · `GET /visual/plans/:id` | Recent generations / one generation (with signed previews). |
| `POST /visual/plans/:id/vary` | More variations from the same brief. |
| `POST /visual/plans/:id/edit` | `{ instruction }` → variations guided by a change ("warmer light", "less busy"). |
| `POST /visual/plans/:id/decide` | `{ decision, variation_id?, alt_text? }` → approve (requires a chosen variation **and** alt text) → store into the library; or abandon (drafts removed, nothing saved). |

**Migration 0044** (`presence_visual_plans`): the generation records. Deny-all RLS (function-mediated), `requires_approval` CHECK constant, status CHECK (`proposed/approved/abandoned/stored/failed`), `claimed_at` as the atomic single-winner claim for promotion. Applied to staging + prod.

The asset kinds and their real sizes: **Page banner** 1600×900 (16:9), **Square post** 1080×1080, **Tall post** 1080×1350 (4:5), **Story** 1080×1920 (9:16), **Link preview** 1200×630 (Open Graph), **General image** 1024×1024.

## The customer experience

`visual-studio.html` — the same calm, premium design and portal auth as `today.html` / `connections.html`. Pick what you need, describe it, get a few options, then *Use this one* / *Make more* / *Change something* / *Discard*. Approving asks for a short description (alt text — accessibility isn't optional) and confirms *"Saved to your library. It's yours to use anywhere — nothing goes live until you publish."* A calm "not switched on yet" state when generation is dark, always pointing back to upload. Discoverable from a quiet doorway on `today.html`.

## Editing, in V1

"Change something" and "Make more" are instruction-guided regenerations that add new options to the same plan (the customer keeps choosing). This is honest text-to-image editing for V1; pixel-level inpainting is a V1.1 enhancement when a model that supports it is wired.

## Honesty & gating

Live generation is **owner setup**, exactly like Stripe (L1) and the connected write flag (L4.3): set `VISUAL_MODEL_KEY` (and optionally `VISUAL_MODEL_URL` / `VISUAL_MODEL_NAME`). Until then the Studio says so plainly and **never fabricates or fakes an image**. Nothing about the customer's own-photo workflow depends on it.

## Tests

`tests/presence/visual_studio_test.mjs` — **38 pure**, green: correct asset dimensions; the brief is brand-aware **and** fact-law-safe (claim wording scrubbed; "no text/awards/ratings" always in the negative); a generation is a proposed, approval-gated plan; the model is honestly gated (null → `not_available`, never a fake image); approve/abandon rides the shared spine; the honesty promises are stated. Platform invariants **14/14 held** (zero engine change). Whole-module `deno check` clean.

## Verification

- Backend deployed to **staging + prod** (`presence` function; migration 0044 applied to both via the hold-back technique). Prod function healthy (`/commerce/plans` 200); `/visual/kinds` returns 401 behind the customer gate (route live, correctly gated).
- **Honest caveat (unchanged pattern):** the customer pages are reference implementations built to the exact API and the portal's proven auth, syntax-verified — but I can't run a live signed-in browser or a real image model here. A human should QA a signed-in session (and set `VISUAL_MODEL_KEY`) before push. The git commit is **not pushed** (go-live gate).

## Final questions (answered honestly)

- **Can a customer complete the whole visual workflow?** Yes — choose a kind, describe it, generate brand-aware options, edit / make more, approve one into the library, all unassisted (once the owner has set the image-model key; until then it's honestly not available).
- **Is it brand-aware?** Yes — palette (customer-supplied or from brand cues), personality, preferred vocabulary, and industry all shape the brief; words-to-avoid steer the negative.
- **Are the required asset kinds covered?** Yes — hero, social (square/portrait/story), Open Graph, and general, each at correct dimensions; variations and instruction-guided edits included.
- **Does it store in the media library with approval before use?** Yes — the chosen variation becomes a `presence_media` row only on approval, with `ai_approved` provenance; unapproved drafts never enter the library.
- **Does it preserve Calm Software and the constitution?** Yes — manual parity intact, approval-before-use enforced, provenance honest, the fact law extended to pixels, no technical vocabulary on screen.
