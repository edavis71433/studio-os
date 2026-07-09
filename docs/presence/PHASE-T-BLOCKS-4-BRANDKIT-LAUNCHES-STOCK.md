# Phase T (continued) — Brand Kit, Launches, Stock Library

*FD-T9, FD-T7, FD-T10 — each implemented as the Constitution-compliant version of the item (not deferred). Reuse-first throughout: one theme engine, one publish pipeline, one scheduler, one media pipeline. Deployed staging + prod (migrations 0069 + 0070).*

## FD-T9 — Logo → Brand Kit
`lib/brand_kit.ts` deterministically derives the **existing** Design-Studio theme tokens from a brand kit (logo + primary colour + type + corner). Contrast-safe: a light brand colour is darkened until white button text is readable (WCAG ≥ 4.5). Stored as the source of truth on `presence_settings.brand_kit` (mig 0069); `PUT /dev/brand-kit` applies the derived tokens through the **same** `dev_customization` layer Design Studio/Developer Mode/render already consume — so buttons, links, and forms (all `var(--accent)`) rebrand at once. UI: a "Brand kit" panel above the granular Design controls. **No second theme engine.** 15/15.

## FD-T7 — Launches
A Launch is a **named staged snapshot** flowing through the one pipeline. `presence_launches` (mig 0070) + `routes/launches.ts`: create/recapture (stage the draft) → decide (approve, via the site-role `approve` capability + a reviewer-allowed decide route) → **schedule** (reuses `presence_scheduled_publishes` + the existing cron) or **promote** (atomic, `runPipeline` publish) → **rollback** (`runPipeline` restore of the pre-promote live snapshot) → cancel. Preview reuses `/preview?launch_id=`. UI in History (stage / preview / approve / update / launch now / schedule / roll back / cancel). **No second publishing engine or scheduler.** State-machine 11/11.

## FD-T10 — Stock Library
A **Stock Library collection inside Files** — never a second app or DAM. `GET /stock/search` browses a royalty-free source; `POST /stock/import` downloads the bytes and imports them into the customer's own `presence_media` via `importImage` (which reuses `createUpload` + the service-role storage write). From then on it's an ordinary asset — same storage, variants, usage, tagging, search, approvals, publishing — and the **published site self-hosts it (zero external origins, Part 4)**. Providers sit behind `lib/stock/registry.ts` so the default is swappable without changing the customer experience. UI: a Stock Library rail item in `files.html` with search + one-tap "Add to my files". 9/9.

**Provider recommendation + licensing (FD-T19):** **Pexels** is the recommended long-term default. The Pexels License permits free commercial use, modification, and **self-hosting** with **no required attribution** — the correct fit because we import each image into the customer's storage (we don't hotlink). Alternatives behind the same contract: Unsplash (permissive, but its API guidelines lean toward attribution + its CDN) or a paid source (Shutterstock/Adobe Stock) for indemnified licensing. Imported assets carry `source`/`license`/`license_url`/`stock_id` provenance metadata. **Owner activation:** set `PEXELS_API_KEY` (+ optional `STOCK_PROVIDER`); until then `/stock/*` answers `503 not_available` honestly, like GSC.

## Tests, regression, deploy
- New: brand_kit 15/15, launches 11/11, stock 9/9 (+ vertical_presets 14/14 from T-BLOCKS-3). **Full pure sweep 73/73.**
- `deno check` clean; `presence.html` + `files.html` inline scripts syntax-verified.
- Migrations 0069 + 0070 applied to staging + prod (hold-back technique; 71 files intact). Function deployed both; smoke `/dev/brand-kit`=401, `/launches`=401, `/stock/search`=401 (routed+authed), `/commerce/plans`=200.

## Conformance
- **Two-App Law:** all inside the Studio App's Website/Files modules; no new app.
- **Part 4:** determinism (pure brand-kit derivation, pure stock parsers); **zero external origins** (brand kit uses local tokens; stock images are self-hosted after import; video blocks remain poster+link).
- **Part 6:** no page builder — brand kit + launches + stock are structured, deterministic capabilities over the existing systems.
- **No duplication:** one theme engine (dev tokens), one publish pipeline (`runPipeline`), one scheduler (`presence_scheduled_publishes`), one media pipeline (`createUpload`/`importImage`). No new AI.

## Remaining Phase T (still incomplete)
- **FD-T2 lazy dynamic-import registry** — registry already indexed; lazy import premature at 3 templates (no customer impact).
- **FD-T6 dark mode** — owner decision. **FD-T6 custom uploaded fonts** — Part-4-blocked (external origins); presets are the conforming answer.
- **FD-T19** — owner activation (`PEXELS_API_KEY`) to turn the Stock Library on.
