# Studio OS — Environment Architecture (permanent · FD-T22)

*Frozen. The environment strategy for the platform and for customer websites. Change only by an explicit architecture amendment.*

## Two independent environment models

Studio OS runs **two** environment models — one for the **platform** (the software we operate) and one for **customer websites** (what a customer edits and publishes). They are not the same and must not be conflated.

### Studio App (the platform) — Development · Staging · Production
The Studio OS platform itself has three engineering environments:
- **Development** — local authoring of the edge function, templates, and UI.
- **Staging** — `wjlpursnwbmlcdwbeowv`; config-only variance from prod; every change is deployed + smoke-tested here first.
- **Production** — `qksstlqzbhesadrrofgn`; the live platform serving all customers.

These belong to us (the operator). **Customers never see or use them.**

### Customer Websites — Draft · Preview · Live
Every licensed CMS website has exactly three states. **Customers do NOT receive a Development environment** — that concept belongs only to the platform.

| State | What it is | How it's served |
|---|---|---|
| **Draft** | The working editing state — every unpublished change. | Rendered on demand in the editor (`/preview?version=draft`). |
| **Preview** | A **pinned** snapshot of the draft, published to a **private, shareable URL** (password-optional), with an honest preview badge. For review + client/stakeholder sign-off before going live. | Served through the **render pipeline** at `/p/:token` — no second deploy (FD-T20). |
| **Live** | The published production site. | The CDN deploy (Netlify) — the one publish pipeline (`runPipeline`). |

**The one-way flow:** Draft → (Publish to Preview) → Preview → (Promote to Live) → Live. The live site never changes until a promote. Every promote is an atomic publish; every prior Live version is kept and restorable (version history + Launches).

## Why Preview is served by the render pipeline, not a second deploy
The published **Live** site is a CDN deploy (zero external origins, fast). **Preview** is served by rendering the pinned snapshot through the **same** `renderSnapshot` engine at a tokened URL. This is a deliberate reuse decision:
- **No duplicate deployment pipeline** — Preview reuses the render engine; only Live deploys.
- **No duplicate infrastructure** — the pinned snapshot lives in the same `presence_snapshots` store; the slot is one row in `presence_site_preview`.
- **Password + share control is ours** — the tokened URL is gated in the function (SHA-256 password hash), not by hosting features.
- Preview carries **`noindex`** + a badge so it's never mistaken for, or indexed as, the live site.

## What reused what (no new engines)
- **Capture** (Draft → snapshot): `lib/staging.ts` `captureDraftSnapshot` — shared by Preview (FD-T20) **and** Launches (FD-T7).
- **Render:** `renderSnapshot` (the one engine) — Draft preview, Preview, and Live all render identically.
- **Promote:** `runPipeline('publish')` — the one publish pipeline; Promote-to-Live is an ordinary atomic publish of the preview snapshot.
- **History / rollback:** `presence_publishes` (versions, labels, restore) + `presence_launches` (named staged releases) — surfaced together in Preview Management (FD-T21).

## Relationship to Launches (FD-T7)
- **Preview** is the *standing* review slot every site always has (one Draft, one Preview, one Live).
- **Launches** are *named, optional* staged releases for a bigger redesign — schedule, approve, promote, roll back — alongside the standing Preview. Both use the same capture/render/publish machinery; neither is a second pipeline.

*See PHASE-FE-1 (Two-App Law), PHASE-T-BLOCKS-4 (Launches), and the roadmap items FD-T20/T21/T22.*
