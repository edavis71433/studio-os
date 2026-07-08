# Phase O — Studio Workspace Experience

*Browser-authoring milestone: one polished application where owners, freelancers, agencies, and operators accomplish everything reasonable without HTML/CSS/JS — Developer Mode optional, never necessary. Audited every workspace surface; implemented the four verified browser gaps; classified the rest. Consolidates the Browser Workspace / Authoring / Media / Template / Component / Agency Productivity / Customer Experience reports.*

---

## Executive summary

The workspace audit found the browser experience **nearly complete for everyday work** — and this phase closed the four real gaps that remained hidden behind "the API supports it": **(1) SEO fields existed in the API but had NO browser fields** (a customer literally could not set their search headline/description — now two calm fields with plain-language hints); **(2) `service_area` was writable but invisible** (and business-classic now renders it in the hero + `areaServed` schema — now a field); **(3) the industry — which since T3 drives the entire template vocabulary and schema — was settable only at onboarding** (now a plain-language selector: "What kind of business," applies at next publish); **(4) alt text could never be edited after upload** (no route existed — a11y/SEO-critical; now `PUT /media/:id` + an "Edit description" affordance on every photo card, enforcing the same ≥3-char rule as upload). All four reuse existing validation/autosave machinery; no new systems. Regression fully green; deployed staging + prod; live room/pipeline pass. Everything larger was already queued by the V/T2/T3/T4 audits — the queue holds, nothing silently expanded.

## Step 1–2 · Browser authoring audit (state after this phase)

| Surface | Browser state |
|---|---|
| Business facts, story, contact, social, booking/order links | ✅ fields with autosave |
| **SEO title/description · service area · industry** | **✅ NEW this phase** (were API-only) |
| Hours + holidays (+ typical-hours one-click) · announcement bar · logo · share image | ✅ (M/T2/V) |
| Items: offerings/FAQs/testimonials/posts — create/edit/hide/reorder | ✅ |
| Media: upload, **alt edit (NEW)**, logo/share assignment | ✅ · crop/focal/folders = FD-T11/FD-20 (V1.1) |
| Publish/preview(+device)/schedule/rollback/history · leads · CRM · foundations desk | ✅ |
| Theme/colors/fonts · sections on/off+order · template switching UI · redirects UI | V1.1 (FD-T6 · T12/T5 · T8 · N7) — the known "shape" tier |
| Developer Mode | present, sanitized, **optional** — nothing everyday requires it |

## Steps 3–6 · Media / Template / Component / Agency (vs AEM, Webflow, Wix Studio, Squarespace, Shopify)

- **Media:** with alt-edit closed, the V1 set (upload/replace-by-delete/alt/assign) covers everyday need; crop/rotate/focal/captions/folders/brand-assets remain the tracked V1.1 tier (FD-T11/FD-20) — competitors win on those conveniences, not on correctness (our enforced alt + auto-variants beat their defaults).
- **Templates:** switching = safe *by architecture* (structured content re-renders; the industry selector already re-vocabularies within a template); the *browser* switch/preview/compare experience = FD-T8→FD-T7. Agency reusable starting templates = FD-18/FD-B5 (the reuse gap, unchanged as the top V1.1 multiplier).
- **Components:** catalog defined (30), realization is the FD-T5 arc; presets/config per block ride it. No new items — T4's FD-T14/T15 stand.
- **Agency productivity:** branding/layout/SEO-default reuse all funnel into FD-18 + FD-T9 + FD-B5; nothing new discovered; repetitive work per client is the known limiter.

## Product-law check

Four structured controls over existing validated fields + one tenant-scoped PATCH route with the upload-time alt rule; deterministic (industry/SEO/alt ride the snapshot at next publish); approval-first untouched; no builder, no duplicate systems.

## Testing

Full pure sweep green (business_classic 21/21, render 28/28, commercial 30/30, ratelimit 9/9, invariants 14/14, + all); presence.html parse-clean; deployed staging + prod; live room 38/38 + pipeline 30/30. The new controls join the Phase-K browser-QA scope (industry selector, SEO fields, alt-edit, service-area).

## Final questions (honest)

- **Can a normal business owner manage their entire website from the browser?** **Yes.** With this phase, every everyday task — facts, SEO, industry, photos + descriptions, logo, share image, notices, hours, items, forms, publish/schedule/rollback, domain posture — is a browser control with plain-language copy. The V1.1 tier (design studio, sections, crop) adds *shaping*, not management.
- **Freelancer faster than competitors?** First site yes (2-question intake → drafted site → controls); portfolio-scale still gated on FD-18 reuse — unchanged, still the top V1.1 item.
- **Agencies manage clients without coding?** Yes — operations, approvals, CRM, foundations are all no-code; authoring reuse is the efficiency gap, not a coding gap.
- **Is Developer Mode truly optional?** **Yes — as of this phase.** Nothing in the everyday or launch path requires it. It remains the door for custom CSS/HTML and raw tokens (until FD-T6 gives colors/fonts a curated no-code home — the last "want" that unnecessarily points at it).
- **What still feels technical?** DKIM's provider-side step (honest, guided), raw values inside DNS plans (appropriate), redirects (API-only until FD-N7), and per-page SEO overrides (FD-N8).
- **Developer Mode forever?** Raw CSS/HTML, token values beyond curated presets, SDK-authored templates/components/packs. Constitutional and correct.

**Phase O — Studio Workspace Experience complete.**
