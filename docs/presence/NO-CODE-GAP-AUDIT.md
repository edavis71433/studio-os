# No-Code Capability Gap Audit — Competitor Workflow Comparison

*Audit-only (no code changed). The question: what can a normal, non-technical business owner accomplish in Studio OS with buttons, fields, toggles, and pickers — versus AEM, Webflow, Wix/Wix Studio, Squarespace, Shopify, WordPress, Duda, Contentful, Sanity, HubSpot CMS, HighLevel, Framer, and Netlify/Vercel preview workflows. Every claim below was verified in the code, not assumed.*

---

## Executive Summary

Studio OS's no-code story is **strong on operations and honest facts, thin on presentation, and broken in one place**. A business owner can — without code — edit every business fact, show/hide/reorder items, publish/preview/schedule/roll back, work leads, approve with one tap, and get correct SEO *by construction*. That operational layer beats most competitors for calm and safety. But the same owner **cannot change a single visual thing** (no color, font, spacing, or theme control — all styling is Developer-Mode-gated), **cannot put their logo on their own website** (no logo field exists anywhere; the favicon is a generated letter), **cannot choose their social-share image**, **cannot add/remove/reorder page sections**, and — the audit's critical find — **the contact form rendered on published sites does not work with the lead-capture endpoint** (form-encoded POST with a single `contact` field vs. a JSON endpoint expecting `email`/`phone`; no honeypot; no success page). That last one is a **V1 blocker**: the flagship Phase-F lead-capture feature silently fails end-to-end on a real published site.

The pattern across all ten areas: **the machinery exists; the everyday control surface doesn't.** Theme tokens, the component catalog, redirects, connected review data — all built, none exposed to a normal user. The recommendations below are almost entirely "put a button on what already works."

---

## Competitor Capability Matrix (what a non-technical user can do with UI)

Legend: ✅ full · 🟡 partial/awkward · ❌ none. "Studio OS" = today, verified.

| Capability (no-code) | AEM | Webflow | Wix/Studio | Squarespace | Shopify | WordPress | Duda | HubSpot | HighLevel | **Studio OS** |
|---|---|---|---|---|---|---|---|---|---|---|
| Colors / fonts / theme presets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** (dev-gated tokens) |
| Add/remove/reorder sections | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** (items only) |
| Item show/hide/reorder | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Logo upload → site header/favicon | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** (no field) |
| Image crop / focal point | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | **❌** |
| Choose social-share (OG) image | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | **❌** (auto-picked) |
| SEO title/description | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 plugin | ✅ | ✅ | 🟡 | **✅** (site-wide; per-page auto) |
| Correct structured data w/o setup | 🟡 | ❌ | 🟡 | 🟡 | ✅ | ❌ plugin | 🟡 | 🟡 | ❌ | **✅** (after FD-T1) |
| Preview before publish | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | **✅ pixel-perfect** |
| Device (mobile/tablet) preview toggle | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | **❌** |
| Schedule publish / expire | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | ✅ | 🟡 | ✅ | 🟡 | **✅** |
| Version history + 1-step rollback | ✅ | 🟡 | 🟡 | 🟡 | 🟡 themes | ✅ posts | 🟡 | ✅ | ❌ | **✅** |
| Parallel future version (Launch) | ✅ | 🟡 staging | ❌ | ❌ | 🟡 theme preview | ❌ | ❌ | 🟡 | ❌ | **❌** (FD-T7) |
| Working contact form out of the box | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | **🔴 broken** (FD-N1) |
| Form fields / success message config | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **❌** (fixed 3 fields) |
| Approval-first + one-tap client approve | ✅ workflows | ❌ | ❌ | ❌ | ❌ | 🟡 | 🟡 | 🟡 | 🟡 | **✅ (differentiator)** |
| Leads inbox + CRM timeline | ❌ | ❌ | 🟡 | 🟡 | 🟡 | ❌ | 🟡 | ✅ | ✅ | **✅** |
| Announcement bar | 🟡 | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 | 🟡 | **❌** (in catalog only) |
| Accessibility correct by default | ❌ user's job | ❌ | 🟡 | 🟡 | 🟡 | ❌ | 🟡 | 🟡 | ❌ | **✅ (template-guaranteed)** |

**Reading:** Studio OS wins where structure wins (publishing, versions, approvals, leads, SEO/a11y-by-construction) and loses everywhere a normal owner expects a **picker** (style, logo, sections, images, form config) — plus one outright breakage.

---

## No-Code Gap Matrix (classification)

| # | Gap | Verified state | Classification |
|---|---|---|---|
| N1 🔴 | **Published contact form ↔ capture endpoint mismatch** — template posts form-encoded `name/contact/message`; endpoint parses JSON `email`/`phone`; no `_hp` honeypot in markup; no success/thank-you handling (visitor would land on raw JSON even if it parsed) | `render.ts:354-361` vs `commercial.ts validateSubmission` + `handleFormSubmit` (`req.json()`) | **V1 BLOCKER — fix before launch** |
| N2 | **No logo** — no logo field in identity/brand/serializer; favicon = generated letter; header renders text only | 0 grep hits for `logo` across identity/serializer/template | **Should be no-code V1** |
| N3 | OG/social-share image auto-picked (first offering photo or post hero), no choice | `render.ts:406` | **Should be no-code V1** (tiny picker) |
| N4 | Announcement bar defined in the component catalog, unrealized — the #1 small-business "holiday notice" use case | `site_components.ts` only | **Should be no-code V1** (first realized component; pairs with scheduled expiry) |
| N5 | No device preview toggle (mobile/tablet/desktop) on preview | no toggle in `presence.html` | **Should be no-code V1** (trivial iframe width switcher) |
| N6 | Styling: zero customer controls (colors/fonts/sizes/spacing/dark-mode/presets) | tokens dev-gated (Phase B) | **V1.1 = FD-T6 Design Studio** (already queued) |
| N7 | Section add/remove/reorder/hide | items ✅, sections ❌ | **V1.1** = FD-T5 (realize components) + FD-T12 (order-as-data) + a per-section visibility toggle |
| N8 | Image crop / focal point / captions / gallery ordering | none | **V1.1** = FD-T11 (+ captions/order folded in) |
| N9 | Form config: extra-field picker (endpoint already accepts bounded `fields{}`), custom success message, auto-reply | endpoint supports fields; form fixed | **V1.1** |
| N10 | Redirects manager UI (table + snapshot exist; no editor route) | `presence_redirects` read by serializer only | **V1.1** |
| N11 | Per-page SEO overrides + per-page noindex | auto-derived per page | **V1.1** (correct-by-construction is right for most; overrides for the few) |
| N12 | Review embed from connected GBP (data already read by Connected Platform) | reads exist; no site component | **V1.1** |
| N13 | Media folders, brand asset library | flat library | **V1.1** = FD-20 |
| N14 | Hide/show a section per device | none | **Adapt** → a structured per-section flag (V1.1-watch); freeform device editing **rejected** |
| N15 | Spacing/density/shadows/borders as freeform sliders | none | **Adapt** → curated "density/style" presets inside FD-T6 themes; freeform CSS-ish sliders **rejected** |
| N16 | Contrast warnings / a11y checklist for users | n/a | **Adapt** → contrast-validated curated palettes in FD-T6 (a11y stays a platform guarantee, not a user chore) |
| N17 | Coupons/promotions engine, lead magnets | none | **V1.1-watch** (commerce scope) |
| N18 | Popups/overlays, exit-intent | none | **Reject** (calm ethos) |

---

## Area audits (condensed; each verified)

**1 · Styling** — nothing customer-facing; everything routes to Developer Mode today. The full fix is FD-T6 (curated palettes, font pairings, type scale, density presets, dark mode as a theme property) over the already-built token layer. *Boundary:* curated picks = no-code; raw CSS = Developer Mode; new structure = SDK.

**2 · Components** — the catalog (30 blocks) exists as data; none realized. Items (offerings/testimonials/FAQs/posts) already have no-code show/hide/reorder — good bones. Section-level controls arrive with FD-T5 + FD-T12 + a visibility toggle per section. The **announcement bar should jump the queue** (N4): it's the single most-requested everyday block and pairs perfectly with the already-built scheduled publish/revert.

**3 · Image & media** — upload + enforced alt text + automatic responsive variants + EXIF strip are solid and *simpler* than competitors. Missing buttons: crop/focal (FD-T11), captions/order, **logo (N2)**, **OG image choice (N3)**, folders/brand library (FD-20), stock import (FD-T10).

**4 · SEO & metadata** — philosophy is right: correct-by-construction (title/desc/canonical/OG/schema/sitemap/robots auto from structure; site-wide `seo_title`/`seo_description` editable). After FD-T1, schema type is correct per industry with zero user effort — genuinely better than the plugin-and-pray competitors. Gaps: OG image picker (N3, V1), per-page overrides + noindex (N11, V1.1), redirects UI (N10, V1.1), post-slug editing exists.

**5 · Publishing & launch** — the strongest area, already at-or-above competitors: draft/preview(pixel-perfect)/approve/publish/schedule/expire/rollback/history/queue/readiness-checklist all no-code. Missing: share-preview link (FD-6), named snapshots (FD-7), Launches (FD-T7), and a **device preview toggle (N5)** — the one trivial V1 add.

**6 · Forms & leads** — inbox/status/notify/spam-model/CRM routing all built and no-code… **but the rendered form itself is broken against the endpoint (N1 — V1 blocker)**. Fix spec (for the build milestone): accept `application/x-www-form-urlencoded` + map `contact` → email-or-phone at the endpoint, add the hidden `_hp` field to the template form, and redirect to a rendered thank-you page (deterministic, works without JS). Then V1.1: field picker over the already-supported `fields{}`, custom success message, auto-reply.

**7 · Mobile & responsive** — templates are responsive by construction (the right model; nothing for users to break). Add the preview device toggle (N5). Per-device hide/show only as a structured flag if demand proves out (N14); freeform responsive editing rejected.

**8 · Accessibility** — Studio OS's story is *better* than competitors and should stay this way: alt text enforced, headings/labels/keyboard guaranteed by the template, reduced-motion respected. Don't add a user-facing checklist; add **contrast-validated palettes** in FD-T6 so a11y remains a platform property (N16).

**9 · Business & marketing** — hours/holidays ✅, social links ✅, booking/order links ✅, testimonials ✅, service-area text ✅. Missing everyday: **announcement bar (N4, V1)**, GBP review embed (N12), newsletter block (catalog), structured service areas (catalog), coupons/lead magnets (V1.1-watch), popups (rejected).

---

## Developer vs No-Code Boundary Report

| Layer | Belongs there | Examples |
|---|---|---|
| **No-code control** | Facts, choices among curated options, on/off, order, media | business facts · item/section visibility + order · theme preset/palette/font pairing · logo · OG image · announcement bar · form fields from a curated list · schedule/publish/rollback |
| **Structured component field** | Content inside a block | every `site_components.ts` field (typed, validated, AI-assistable) |
| **Theme token** | The look, parameterized | colors/type/radius/density/dark-mode — *set via Design Studio presets (no-code) or raw values (Developer Mode)* |
| **Developer Mode** | Custom presentation beyond curation | custom CSS · custom HTML block · raw token values |
| **SDK / template-only** | Structure + logic | new templates/components/packs · render logic · schema emission |
| **Not supported** | Law conflicts | drag-drop freeform layout · runtime code · auto-publish · popups/dark patterns |

Today's failure mode: the middle three layers exist, but the **top row is missing its surface** — everyday needs (style, logo, sections, form tweaks) currently dead-end into Developer Mode or "not possible." The recommendations move them up.

---

## Recommendations

**V1 (before broad launch)** — all small except the first two already-tracked items:
1. 🔴 **FD-N1 · Fix the published-form ↔ endpoint mismatch** (V1 blocker; the fix spec is in the queue item).
2. **FD-N2 · Logo** — upload → header + real favicon + OG fallback (identity `logo_media_id`; media pipeline exists).
3. **FD-N3 · OG image picker** — one field, huge shareability payoff.
4. **FD-N4 · Announcement bar** — first realized component; expiry via the existing scheduled revert.
5. **FD-N5 · Device preview toggle** — an afternoon of work.
6. *(Already tracked V1 gates: FD-T1 neutral template · FD-M2 rate limiting · FD-M3 legal pages.)*

**V1.1:** FD-T6 Design Studio (+contrast-validated palettes, density presets) · FD-T5/T12 + section visibility · FD-T11 crop/focal/captions · FD-N9 form config (field picker/success/auto-reply) · FD-N10 redirects UI · FD-N11 per-page SEO/noindex · FD-N12 GBP review embed · FD-20 brand library · FD-T10 stock · FD-T7/T8 Launches · FD-6/7 share-preview/named snapshots.

**Rejected (law/ethos):** drag-and-drop freeform layout · freeform per-device editing (adapt: structured flag) · freeform spacing/shadow sliders (adapt: density presets) · popups/exit-intent · auto-publish anything · runtime code for customers.

**Roadmap impact (analysis only; nothing added to the roadmap by this audit):** N1 joins the launch gate alongside FD-T1's market-scope decision; N2–N5 are cheap enough to ride any pre-launch milestone; everything else lands in the existing Phase T/U + V1.1 lanes. The strategic read: **Studio OS doesn't need to become a builder to win — it needs ~5 small controls and one bug fix to stop *feeling* like it's missing one.**

---

## Final Questions (answered honestly)

- **Can a normal business owner build and update a polished website without code?** **Update facts/content: yes, genuinely well. Build *and shape*: not yet** — no styling, no logo, no sections; and today only a restaurant gets a correct site (FD-T1).
- **Can they control the important things without HTML/CSS?** Operations yes; presentation no — every visual control currently requires Developer Mode.
- **Where does Studio OS rely too much on Developer Mode?** Styling (colors/fonts/sizes) — the single biggest misplacement; curated versions belong in no-code (FD-T6).
- **What basic controls do competitors provide that we should expose?** Logo, OG image, announcement bar, device preview, section order/visibility, form field/success config, crop/focal, redirects, theme presets — all specced above.
- **What would customers expect to be a button?** "Upload my logo." "Pick my colors." "Post a holiday notice." "Choose the photo that shows when I share my site." "See it on a phone." None is a button today.
- **What should stay developer-only?** Raw CSS/HTML, raw token values, anything structural — the boundary table above.
- **What must be built before broad launch?** **FD-N1 (the broken form — blocker)**, FD-T1 (neutral template, per the market decision), FD-M2/M3 (rate limit + legal pages), and the cheap dignity items N2–N5 (logo/OG/announcement/device-preview).
- **What can wait for V1.1?** Everything else above — Design Studio, sections, crop, Launches, form config, redirects UI, review embeds.
- **V1 blockers, clearly:** **(1) FD-N1** — published contact forms silently fail; **(2) FD-T1** *if* launching beyond restaurants; **(3)** the already-known non-engineering gates (activation, browser QA, go-live push).

---

**No-Code Capability Gap Audit complete.**
