# Developer Mode — Guide

*Phase B. The one guide for developers customizing a Presence site. Covers the model, the theme/CSS/HTML surfaces, the read-only template layer, the SDK path, best practices, extension, and the architecture. Developer Mode is a **capability of Studio OS**, not a separate app or a second website builder — it extends the existing CMS and template system; it never replaces it.*

---

## The one principle

**Developer Mode extends the CMS. It is not a separate website builder.**

A site has exactly one source of truth: its structured content plus its pinned template. No-code editing (the workspace) and code customization (Developer Mode) act on that **same** site. There is no parallel "coded version." A person can move between no-code and code freely — the version history, rollback, approval flow, and live site are shared. Anything Developer Mode adds (theme tokens, CSS, an HTML block) layers **on top of** the template; it never forks it.

This is why Developer Mode is safe: it is bounded design freedom over one deterministic system, not an escape hatch out of it.

---

## Developer Guide (getting in and the model)

**Who gets in.** Developer Mode is reachable only by:
- an **operator** (Platform Admin), or
- a site member holding the **`use_developer_mode`** capability — the **developer** role (how an Agency / Business / Enterprise Developer, or an entitled Business Owner granted that role, gets access).

Everyone else (business owner without the grant, business staff, client reviewer) never sees the nav entry and is refused server-side (`403`). The role model is unchanged — access is a route rule over the existing capability.

**Where it lives.** Settings → **Developer Mode** (`/developer.html`), shown in the nav only when the capability is present. A header link switches back to the no-code workspace at any time — same site.

**What you edit.** Three safe surfaces, versioned and published like any change:

| Surface | File | What it is |
|---|---|---|
| **Theme** | `theme/tokens.json` | Allow-listed design tokens (accent, text, background, corner radius, type scale) |
| **Custom CSS** | `styles/custom.css` | CSS layered on top of the template |
| **Custom HTML** | `blocks/custom.html` | An inert markup block for a designated slot |

**What you don't edit here.** The template's render logic (`render.ts`, `manifest.json`) is **read-only** in Developer Mode — see *Template Guide* below.

**The loop.** Open a surface → edit → watch the **sandboxed live preview** → **Save** (validated + sanitized server-side) → **Publish** from your workspace through the normal approval flow. Saved work is a draft until published; publishing is versioned and reversible.

---

## Theme Guide

The theme is a small set of **allow-listed tokens**, each accepted only in a valid form:

| Token | Meaning | Accepted form |
|---|---|---|
| `accent` | Primary brand color | `#rgb`–`#rrggbbaa` hex |
| `accent_soft` | Soft accent (tints, chips) | hex |
| `ink` | Text color | hex |
| `bg` | Background | hex |
| `radius` | Corner radius | `<number>px\|rem\|em` |
| `font_scale` | Type-scale multiplier | `0.x`–`1.x` |

Anything else — an unknown key, a color that isn't a valid hex, a value containing `url()` or a semicolon — is **rejected on save** and reported back to you. This is the guarantee, not a limitation: a theme can never smuggle arbitrary CSS or code through a token. Deeper design lives in the template (via the SDK).

---

## Custom CSS Guide

`styles/custom.css` is layered after the template's own styles, so you can refine typography, spacing, and treatment. It is **inert** — CSS cannot execute code — and on save the platform strips the few constructs that could fetch or execute:

- `@import` (no external fetches)
- `expression(...)` (legacy IE script vector)
- `url(javascript:…)` / `url(vbscript:…)` / `url(data:…)`
- `behavior:` (HTC binding)

A hard size cap applies. Everything else — selectors, colors, layout, media queries — is yours. Scope your selectors to avoid fighting the template; prefer adding to a class over broad element resets.

---

## Custom HTML Guide

`blocks/custom.html` is an **inert markup block** for a designated content slot. On save the platform removes everything that could run code or exfiltrate:

- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`, `<svg>`, `<math>`
- `on*=` event handlers (quoted or not, any case)
- `javascript:` / `data:` / `vbscript:` URLs in `href`/`src`
- inline `style="…"` attributes (use `styles/custom.css` instead)

What remains is content — headings, paragraphs, links, images, lists. **This can never run JavaScript**, by design (determinism + no-foreign-code are Product Laws). If you need interactivity, that belongs in the template, authored with the SDK and reviewed.

---

## Template Guide (read-only here; SDK to change)

The template is the **render contract**: a versioned function that turns a content snapshot into deterministic HTML/CSS. In Developer Mode it is **read-only** — you can see `templates/<slug>/<version>/render.ts` and `manifest.json` in the file explorer, but not edit them in the browser.

Why: render logic runs at build time to produce every site's bytes. Editing and executing it at runtime would break determinism (same snapshot → same bytes) and the no-foreign-code guarantee. So render logic is authored with the **Presence SDK**, validated, and shipped as a **new template version** with the platform. Sites pin a version; old versions are never removed while a site uses them.

To change render logic: build a new template version with the SDK (see *SDK Guide*), publish it, and re-point the site's `template_version`. The customization layer (theme/CSS/HTML) carries across because it lives beside the snapshot, not inside the template.

---

## Component Guide

Components are **reusable parts of a template** (a hero, an hours block, a menu section) — authored inside a template version with the SDK, consuming the same structured content contract. Developer Mode does not add free-form components at runtime (that would be a page builder, which Studio OS deliberately is not — see [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md)). Instead:

- Style existing components with **custom CSS** (target their classes).
- Add a bounded block of static content with **custom HTML**.
- Add or change a component's structure/logic via the **SDK**, shipped as a template version.

This keeps every component compatible with the content model, the visibility model, and the renderer.

---

## SDK Guide

Render logic, templates, components, and industry packs are authored with the **Presence SDK** at build time. That surface is documented already:

- **[THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md)** — the pack/SDK author surface (`industry/sdk.ts`): the pack contract, validation, versioning, compatibility (`minPlatformVersion`/`isCompatible`).
- **[EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md)** — what the platform extends by design and the locked exclusions (no runtime plugins, no page builder, no A/B branching).

Developer Mode is the **in-app, no-build** half of extensibility (theme/CSS/HTML as data); the SDK is the **build-time** half (render logic as versioned code). Together they cover customization without ever executing untrusted code at runtime.

---

## Developer Best Practices

1. **Prefer tokens, then CSS, then HTML, then SDK** — use the least-powerful tool that does the job. It's the most portable and the safest.
2. **Scope your CSS.** Add to component classes; avoid broad `*`/element resets that fight the template.
3. **Preview before you save**, and save before you publish. Publishing is the approval-gated, versioned step.
4. **Treat custom HTML as content, not app.** No scripts will survive; don't design around them.
5. **Roll forward, not sideways.** For structural change, ship a new template version — don't try to recreate it in CSS/HTML.
6. **Everything is reversible.** If a change looks wrong live, restore the prior published version from the workspace.
7. **Respect the no-code user.** Your changes share the same site; keep it something a non-developer can still operate.

---

## Extension Guide

Ways to extend a Presence site, from lightest to deepest:

| Need | Use | Runs at |
|---|---|---|
| Recolor / retype / spacing | Theme tokens | build (deterministic) |
| Refined styling | Custom CSS | build (deterministic) |
| A bit of static content in a slot | Custom HTML | build (deterministic) |
| New structure / component / logic | **SDK** → new template version | build (deterministic) |
| New industry vertical | **SDK** → industry pack | build (deterministic) |

Nothing on this ladder executes untrusted code at runtime. Everything is versioned and reversible. Everything stays compatible with the content model, the visibility model, tenant isolation, and the approval flow.

---

## Architecture Overview

```
        No-code workspace  ─┐                 ┌─  Developer Mode  (this)
        (edit content)      │                 │   theme + CSS + HTML (data)
                            ▼                 ▼
                    ┌───────────────────────────────┐
                    │   ONE site (presence_sites)    │
                    │   structured content snapshot  │
                    └───────────────┬───────────────┘
                                    │  render (build-time, deterministic)
                                    ▼
                    ┌───────────────────────────────┐
                    │  Publish ritual (unchanged)    │
                    │  approval → version → live     │
                    │  restore / rollback            │
                    └───────────────────────────────┘
```

- **Live edit storage:** `presence_dev_customizations` (one row per site; theme tokens JSON + sanitized CSS/HTML) — the working copy the editor reads and writes. Deny-all RLS, function-mediated.
- **Snapshot storage (Phase B1):** on publish, the sanitized dev layer is captured into the **snapshot** (`presence_snapshots.dev_customization`), a sibling of `content`. This is what makes a developer edit part of the ONE snapshot — so it versions, rolls back, restores, and previews exactly like content.
- **The one render path (Phase B1):** `renderSnapshot(snapshot, siteCfg)` in `lib/render.ts` is the single render entry. It renders the template, then applies the snapshot's dev layer (`injectDevLayer`) as a deterministic post-render pass — one `<style id="presence-dev">` (theme tokens as `:root` vars + custom CSS) before `</head>`, and the sanitized HTML block before `</body>`. **Publish, preview, and restore all call it**, so there is no second renderer, no second publish path, no special deployment. With no customization the pass is a no-op and bytes are identical.
- **Determinism:** the dev layer lives in the snapshot, so *same snapshot → same render → same bytes*. Template-agnostic injection keeps the shipped templates immutable (no per-version edits). Templates consume theme tokens by referencing the `:root` variables; the immutable restaurant-classic 1.0.0 doesn't, so on it tokens take effect through your custom CSS (e.g. `.cta{background:var(--accent)}`) or a future token-aware template version via the SDK.
- **Access:** `use_developer_mode` capability (operator or developer). Enforced server-side in `routes/dev.ts`; nav entry gated in `lib/navigation.ts`.
- **Safety:** all input passes `lib/devmode.ts` (`validateThemeTokens`, `sanitizeDevCss`, `sanitizeDevHtml`) before storage **and** again at snapshot time (`buildDevLayer`) — no script/handler/dangerous-URL can land. The in-app sample preview is a `sandbox=""` iframe (no script permission); the "Preview real page" button renders through the server `/preview` (the publish renderer).
- **Publishing / versioning / rollback / restore:** unchanged pipeline — Developer Mode only adds a sibling field to the snapshot. `/publish` captures it, `/publishes` versions it, `/restore` and restore-to-draft bring it back. Nothing bypasses approval.
- **Frozen spines untouched:** the Intelligence Pipeline and the Approved-Plan Lifecycle are not modified; the 14 platform invariants hold (14/14).

---

*See also: [PHASE-B-DEVELOPER-MODE](PHASE-B-DEVELOPER-MODE.md) (the deliverables + review), [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md), [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md).*
