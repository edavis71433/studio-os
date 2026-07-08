# Phase B — Developer Mode (Deliverables & Review)

*Implementation milestone. Developer Mode is built as a **capability of Studio OS** on top of the completed V1 platform — additive, zero-regression, and bounded by the constitution. It extends the CMS and template system; it is **not** a separate website builder.*

---

## Executive Summary

Developer Mode is live (staging + prod). It gives developers a safe, integrated way to customize a site's **presentation** — theme tokens, custom CSS, and a sanitized HTML block — through the same publish/approval/version/rollback ritual as any change, on the **same site** as the no-code workspace. It is gated by the `use_developer_mode` capability (operator or developer only) and enforced server-side. It **never** introduces runtime code execution: all input is validated and sanitized before storage, the preview runs in a script-less sandbox, and render logic stays read-only (authored with the SDK at build time). No Product Law, spine, or model was modified. The 14 platform invariants hold (14/14); the new suite is 41/41; the workspace suite is 38/38.

The one honest boundary, stated plainly: **render-LOGIC editing is not an in-app runtime editor** — it can't be, without breaking determinism and the no-foreign-code law. That capability lives in the SDK (build-time), and Developer Mode surfaces those files read-only. The **publish-time injection** of the customization into the live deployed bytes is specified as the single render-path integration seam and is tracked as a Feature Discovery item (it must be done determinism-preserving, i.e. folded into the snapshot) rather than forced through the frozen publish spine in this milestone. What ships is the complete, safe **authoring + gating + validation + preview + storage** capability with docs.

---

## Developer Mode Overview

- **Surface:** `/developer.html` — a two-pane developer tool (file explorer + editor/preview), self-contained, theme-aware, brand-consistent (`--p:#5b3fa0`).
- **Editable (data):** `theme/tokens.json`, `styles/custom.css`, `blocks/custom.html`.
- **Read-only (code):** `templates/<slug>/<version>/render.ts`, `manifest.json` — SDK/build-time.
- **Live preview:** a `sandbox=""` iframe renders sample content with the theme + CSS + HTML applied — **no scripts run**, ever.
- **Save:** `PUT /dev/customization` — validated + sanitized server-side; reports rejected tokens and any stripped CSS/HTML honestly.
- **Publish:** unchanged — from the workspace, through approval, versioned, reversible.
- **Access:** operator or `use_developer_mode`; everyone else `403` and no nav entry.

---

## Architecture Review

**It's a capability, not an app.** One new table (`presence_dev_customizations`, migration 0046), one pure lib (`lib/devmode.ts`), one route file (`routes/dev.ts`, 3 routes), one UI page, one nav href repoint. No change to the renderer, serializer, publish pipeline, snapshot shape, role model, visibility model, navigation architecture, approval architecture, tenant isolation, or packaging.

**Same-site guarantee (the user's constraint).** Developer Mode reads/writes the *same* `presence_sites` row, the *same* template, and publishes through the *same* ritual as the no-code workspace. There is no parallel site, no forked template, no separate builder. The customization layers on top of the template; no-code and code editing are two doors into one system, with shared history and rollback. The UI reinforces this ("same site — switch back anytime").

**Least-power ladder.** Tokens → CSS → HTML → SDK. Each rung is more powerful and less portable than the last; none executes untrusted code at runtime. This is the whole design: bounded freedom over a deterministic system.

---

## Integration Report

| Area | Result |
|---|---|
| **CMS** (templates, themes, components, media, publishing, preview, SEO, domains, navigation) | Integrates naturally: theme/CSS/HTML layer over the template; media unchanged (link to library); publishing/preview via the existing ritual; SEO/domains/nav untouched. No-code + developer work on one system. |
| **Business OS** (Business Moments, CRM, AI, Connected, Commerce, Knowledge, Reports) | No interference — Developer Mode touches only presentation data. Verified: the intelligence pipeline live-room + moments suites still pass; invariants 14/14 (incl. Law 13 vocabulary + the connected/approval spines). |
| **Workspaces** (owner, staff, client portal, agency, enterprise) | Nav entry appears only with `use_developer_mode`; the client reviewer boundary already refuses `/dev/*` (not whitelisted); operators reach it. Every other workspace is unaffected. |
| **Versioning / publishing** | The customization is stored per-site with `updated_by`/`updated_at`; going live uses `/publish` → `/publishes` → `/restore` unchanged. (See Versioning Review for the one open seam.) |

---

## Security Review

**No runtime code execution — enforced as data, tested hard.** `lib/devmode.ts`:
- `validateThemeTokens` — allow-list, deny-by-default; unknown keys and malformed values rejected and reported.
- `sanitizeDevCss` — strips `@import`, `expression()`, `url(javascript:|vbscript:|data:)`, `behavior:`; hard size cap.
- `sanitizeDevHtml` — strips `<script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>/<base>/<form>/<svg>/<math>`, `on*=` handlers (quoted/unquoted/any case), dangerous URL schemes, and inline `style=`.
- The **preview** is a `sandbox=""` iframe (no `allow-scripts`) — even unsaved malicious input cannot execute.

**Access & isolation.** `devModeAllowed(role, principalKind)` = operator OR `use_developer_mode` — pure and tested for every role. Deny-all RLS on the new table; function-mediated via `svc`; site-scoped by `resolveSite`. The role model was **not** modified to grant this — access is route logic over the existing capability.

**Coverage.** `tests/presence/devmode_test.mjs` — 41/41: 15 HTML-sanitization vectors (incl. svg-script, data:, unquoted handlers, inline style), 6 CSS vectors, 6 token cases, end-to-end build, read-only render-code assertions, and the full access matrix. Invariants 14/14. Workspace 38/38.

**Defense in depth.** Server-side sanitization is the first layer; a published-site CSP is the intended second. Regex sanitization is deliberately aggressive (denylist + strip-on-doubt); a hardened allow-list sanitizer is queued (FD-B2) as a strengthening, not a gap.

---

## Versioning Review

- **Can every change be versioned?** Content publishing is fully versioned (unchanged). The developer customization is stored with author + timestamp; **making it part of the published snapshot** (so a restore brings back the exact matching theme/CSS/HTML and determinism holds byte-for-byte) is the one render-path integration seam — specified below, queued as **FD-B1**, deliberately not forced through the frozen publish spine in this milestone.
- **Rollback / restore / republish?** Work as today for content and the live site; the customization currently behaves as a live layer with its own history. FD-B1 folds it into the snapshot so version/restore cover it precisely.
- **Audit history?** Preserved — writes carry `updated_by`/`updated_at`; the existing publish ledger and change events are unchanged.

**The seam (FD-B1), precisely:** add the site's dev customization into `serializeDraft`'s snapshot; pass it via the reserved `SiteConfig` seam to the template, which emits one `<style id="dev-custom">` block + a sanitized HTML slot at build time. This keeps *same snapshot → same bytes* (determinism), makes restore exact, and stays additive. It touches the frozen serializer/render, so it wants its own careful, live-verified change — hence queued, not bundled.

---

## Documentation

- **[DEVELOPER-MODE-GUIDE](DEVELOPER-MODE-GUIDE.md)** — the consolidated developer guide: model, Theme Guide, Custom CSS Guide, Custom HTML Guide, Template Guide, Component Guide, SDK Guide, Best Practices, Extension Guide, Architecture Overview.
- **SDK Guide** — [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md) (build-time author surface) + [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md) (what extends, and the locked exclusions).
- **This report** — deliverables, architecture/integration/security/versioning reviews, feature discovery, recommendations.

---

## Feature Discovery Additions

Logged to the [Feature Discovery & Product Review Queue](FEATURE-DISCOVERY-QUEUE.md) — **documented, not built**:

- **FD-B1 · Publish-time render injection (determinism-preserving).** Fold the dev customization into the snapshot and emit it via the `SiteConfig` seam so the live deployed bytes reflect theme/CSS/HTML and restore is exact. *High value · Medium effort · touches the frozen serializer → own milestone.*
- **FD-B2 · Hardened allow-list HTML sanitizer.** Replace the (aggressive) denylist regex with an allow-list parser + a published-site CSP. *Security strengthening · Medium.*
- **FD-B3 · Syntax highlighting in the editors.** A self-hosted lightweight highlighter for the CSS/HTML editors (no CDN dependency, keeping page resilience). *Polish · Low-Medium.*
- **FD-B4 · Custom fonts (self-hosted, approved).** Let a developer add a self-hosted webfont via the brand-asset library (FD-20). *Medium.*
- **FD-B5 · Per-template customization presets.** Save/reuse a theme+CSS set across a portfolio (pairs with FD-18 client setup templates). *Agency value · Medium.*

---

## Recommendations

1. **Ship FD-B1 next if Developer Mode's live effect is wanted before launch** — it's the one seam between "authored + previewed + versioned" and "reflected in the published bytes."
2. **Do FD-B2 before broadening who can author custom HTML** — an allow-list sanitizer + CSP raises the floor if HTML authoring opens beyond trusted developers.
3. **Keep the least-power ladder visible in the UI** — it's what stops Developer Mode from drifting toward a page builder.
4. **Human QA the browser flow** — the pure suites + gated smoke prove the boundary and the safety; the authored round-trip (sign in as a developer, edit, preview, save, publish) is the one step that needs a real browser.

---

## Final Questions (answered honestly)

- **Does Developer Mode feel like part of Studio OS?** **Yes.** Same brand, same auth, same site, same publish ritual, one nav entry. It reads as a mode, not a second app.
- **Does it preserve the no-code experience?** **Yes.** It's opt-in, capability-gated, and invisible to everyone without the grant. No-code and code act on one site with shared history — you can switch back anytime.
- **Can developers safely customize websites?** **Yes** — theme, CSS, and HTML, with hard server-side safety and a script-less preview. Deeper structure goes through the SDK.
- **Can agencies extend templates?** **Yes** — style and content per client in-app; structural extension via the SDK as versioned template/pack versions. (Cross-portfolio presets = FD-B5.)
- **Can enterprises build custom experiences?** **Partially, honestly.** Presentation customization: yes. Bespoke structure/logic: via the SDK (build-time), not an in-app runtime editor — by design. Enterprise-grade *custom apps* remain an SDK/services engagement, not a runtime plugin surface.
- **Does Developer Mode preserve every Product Law?** **Yes** — structured content, determinism, approval-first, no foreign runtime code, ownership. Invariants 14/14.
- **Does it preserve approval-first publishing?** **Yes** — publishing is unchanged; Developer Mode only stores what to publish.
- **Does it preserve tenant isolation?** **Yes** — deny-all RLS, function-mediated, site-scoped; no isolation code touched.
- **Is Version 1 now ready for CRM Expansion?** **Yes.** Developer Mode is additive and self-contained; nothing about CRM depends on it or is blocked by it. The V1 baseline (architecture ratified in A9) is intact, the invariants hold, and the CRM tables/routes (`presence_crm_*`) are untouched and ready to build on. **If** you want Developer Mode's customization reflected in *live published bytes* before moving on, do FD-B1 first — but that is not a prerequisite for CRM Expansion.

---

**Phase B — Developer Mode complete.**
