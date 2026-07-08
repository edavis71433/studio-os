# Phase V — No-Code Essentials & Everyday Editing Experience

*Implements the No-Code Gap Audit's V1 items — led by the 🔴 GM-2 form fix — as structured controls over existing architecture. No page builder, no CSS exposure, everything deterministic and approval-first. Consolidates the No-Code Essentials / Business-Owner Editing / Media Experience / Design Controls / Structured Component guides.*

---

## Executive summary

Five findings closed. **FD-N1 (GM-2, the V1 blocker)**: the published contact form now works end-to-end — the capture endpoint accepts plain HTML form posts (urlencoded/multipart), maps the form's single `contact` field to email-or-phone, the template form carries the honeypot + hidden context fields, and a visitor lands on a rendered `/thanks/` page (303 redirect — works with no JavaScript). **FD-N2**: a business can finally put its **logo** on its own site — one tap in the photo library sets it; it renders in the header, becomes the favicon, and backstops the share image. **FD-N3**: a one-tap **"use when shared"** picker chooses the Open Graph image (owner's choice → offerings → posts → logo). **FD-N4**: the **announcement bar** is real — a text field + optional link + "until" date in the Business view; renders site-wide, expires deterministically against snapshot time. **FD-N5** was found **already built** (the preview's `#devSeg` desktop/phone toggle) — audit classification corrected. All flows remain snapshot → deterministic render → approval-first publish. Migration 0051 applied and function deployed to staging + prod; pure sweep green (commercial 30/30, render 28/28 with regenerated golden, invariants 14/14); live staging room 38/38 + pipeline 30/30.

---

## What was built (per control)

### FD-N1 · The working contact form (GM-2 closed)
- **Endpoint** (`routes/commercial.ts`): sniffs content-type; form posts parse via `formData()` through the new pure `formParamsToSubmission()` (email-looking `contact` → email, else phone; `_hp` passes through so the honeypot still works). Browser form posts get **303 redirects** — `/thanks/` on success (bots included, so spam senders see success), `/contact/` on the rare validation failure. JSON callers are unchanged.
- **Template**: the form now carries `form_kind`/`source_page` hidden fields and a visually-hidden `_hp` honeypot (`tabindex=-1`, `aria-hidden`); a calm **`/thanks/` page** was added (noindex, not in nav or sitemap, `aria-current` on Contact).
- **Tested**: 5 new pure tests (mapping, round-trip validation, phone path, honeypot survival, empty safety) + live smoke (form-encoded parses, no 500).

### FD-N2 · Logo — one tap in the photo library
- `presence_settings.logo_media_id` (migration 0051) via the existing generic `/settings` field-rule route.
- **Render**: header brand shows the logo beside the business name; the favicon becomes the logo (falls back to the generated letter mark); the share image falls back to it. Flows through `ref()` so variants land in the media manifest.
- **UI**: every photo card in the library has **"Set as logo"** (toggle, shows current state, "publish to apply").

### FD-N3 · Share image — "Use when shared"
- `presence_settings.og_media_id`; OG chain is now **owner's choice → first offering photo → post hero → logo**. Same one-tap photo-card action.

### FD-N4 · Announcement bar
- `presence_settings.announcement_text/url/expires_at`; renders as a site-wide `role="status"` bar above the header when text is set and the expiry (if any) is after **snapshot time** — deterministic; combined with scheduled publishing, a notice can both appear and retire on schedule.
- **UI**: an "Announcement bar" card in the Business view (text + optional link + "until" date + save). Copy explains the publish-to-apply and drop-off behavior.

### FD-N5 · Device preview — already existed
The preview stage already has a desktop/phone toggle (`#devSeg` → `.proofFrame.phone`). Audit corrected: **Already exists**; tablet width is a non-need at this fidelity.

---

## The guides (condensed)

- **Business Owner Editing**: everything everyday is now a control — facts, items (show/hide/reorder), hours/holidays, social, logo, share image, announcement, publish/schedule/rollback. No HTML, no CSS, no Developer Mode anywhere in the daily path.
- **Media Experience**: upload → alt text (enforced) → automatic responsive variants; one-tap logo/share assignment; crop/focal + folders/brand library remain V1.1 (FD-T11/FD-20).
- **Design Controls**: unchanged this phase by design — curated palettes/fonts/sizes are the **Design Studio (FD-T6, V1.1)** over the existing token layer; raw CSS stays Developer Mode.
- **Structured Components**: the catalog (30 blocks) is the V1.1 build-out (FD-T5/T12); the announcement bar is its first realized block and the pattern-setter (fields → settings → snapshot → deterministic render).

---

## Product-law check

Structured content ✓ (five typed settings fields) · deterministic render ✓ (expiry against snapshot time, not the wall clock) · approval-first ✓ (every control says "publish to apply"; nothing auto-publishes) · no builder ✓ · no runtime code ✓ (the thank-you flow is a server redirect, no JS required) · one pipeline/one history ✓ (all of it rides the snapshot).

## Testing

Pure: commercial **30/30** (incl. the 5 new form-mapping tests) · render **28/28** (golden regenerated for `/thanks/` + a11y pass incl. the new page) · template_ecosystem 24/24 · onboarding 18/18 · editions 36/36 · shell 18/18 · workspace 38/38 · crm 24/24 · devmode 41/41 · dev_render 21/21 · activation 10/10 · nav_integrity 3/3 · invariants **14/14**. Live staging: room **38/38** · pipeline **30/30**; smoke: form-encoded + JSON paths parse on both envs (no 500s), prod catalog 200. Migration 0051 applied to both; function deployed to both. presence.html parse-clean. Remaining human step: the standing Phase-K browser pass (now including the announcement card + photo-card actions + a real form submit on a published site).

## Feature discovery update

FD-N1 ✅ (GM-2 closed) · FD-N2 ✅ · FD-N3 ✅ · FD-N4 ✅ · FD-N5 ✅ (already existed). Still queued, unchanged: FD-N6 form config · FD-N7 redirects UI · FD-N8 per-page SEO · FD-N9 GBP reviews · FD-T6 Design Studio · FD-T5/T11/T12 · FD-20. No scope silently expanded.

---

## Final Questions (answered honestly)

- **Can a normal business owner confidently update their website without touching HTML or CSS?** **Yes — for everything everyday.** Facts, items, hours, photos, logo, share image, a site-wide notice, publish/schedule/rollback: all buttons and fields now. The remaining no-code wants (colors/fonts, sections, crop) are V1.1 by design, not gaps in the daily path.
- **Does Studio OS expose the right controls while preserving its structured-content philosophy?** **Yes** — every new control is a typed field rendering deterministically from the snapshot; nothing bypasses approval; no builder appeared.
- **Anything competitors make easier that should still become structured no-code?** The known V1.1 set: curated design controls (FD-T6 — the biggest), section on/off+order (FD-T5/T12), image crop/focal (FD-T11), form field config (FD-N6). All queued with owners' reasoning; none blocks V1.
- **Any remaining V1 blockers in the everyday editing experience?** **No.** GM-2 is closed and verified; the launch gate reverts to the non-engineering items (owner activation, browser QA, the push) plus the FD-T1 market-scope decision.

---

**Phase V — No-Code Essentials & Everyday Editing Experience complete.**
