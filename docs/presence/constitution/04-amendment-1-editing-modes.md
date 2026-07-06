# Amendment 1 — Editing Modes, Developer Surface, and Template Lock

**Status: PROPOSED — awaiting ratification.**
Amends: `02-commercial-constitution.md` (Part 11 Product Laws, Part 2 Feature Matrix) and `03-final-constitution.md` (Part 4 Template Philosophy, Part 6 Marketplace Policy — clarified, not weakened).
Origin: owner directive, 2026-07 (pre-M7-completion). This document reconciles that directive against the ratified constitution. Everything below is either **adopted as proposed**, **adopted with a modification** (with the frozen law it protects named), or **flagged for an explicit owner decision**.

---

## 1. The Three Editing Modes (adopted)

The platform recognizes three editing modes. They are a **ladder of progressive disclosure inside one product**, not editions, not tiers, not prices (Terminology freeze, 03 §2: "plan" is a billing word; these are modes). Every client starts — and may happily stay forever — on the first rung.

### Mode 1 — Guided (default) ⭐ · *adopted as proposed*

What most customers use, and the only mode most customers ever see:

- Edit business information, offerings/services, FAQs, testimonials, updates, images
- AI assistance (optional, per the five reserved words — 03 §3)
- Preview any version · Publish through the ritual · Restore to draft

No HTML. No CSS. No risk. **Guided Mode is the M7 Client Room, already specified and frozen — this amendment changes nothing about M7.** The mode gains a name, not new scope.

### Mode 2 — Designer (configuration) · *adopted with one modification*

For clients who want more control without code. They can:

- Reorder sections · hide/show sections
- Choose typography pairings, color palettes, spacing density, motion presets, layout variants

**The modification (protects Law 19 and the Part 4 acceptance bar):** every Designer choice is an **option declared by the template's manifest** — a finite, named, versioned set the template ships with — never a free-form control panel. A template declares, for example, three typography pairings, four palettes, two layout variants for its hero; the client picks among them. Choices live in per-site configuration (`presence_settings`, the same seam `category_order` uses today), so:

- the renderer stays pure and singular (Law 6) — configuration in, deterministic bytes out;
- every combination the client can reach was **designed, contrast-checked, and performance-checked** when the template was reviewed — a Designer-Mode client cannot produce an inaccessible or broken site (Law 17);
- template upgrades remain automatic, because configuration is data, not code.

Free-form font-size sliders, arbitrary spacing values, and per-element styling are what Law 19 calls settings sprawl; they do not enter through this door.

**Font uploads:** not in Designer Mode. A font is an asset with licensing, subsetting, performance, and legibility consequences — it enters the platform inside a template through the developer path (Mode 3), where it is reviewed once and then becomes a declared typography option for everyone using that template. *(This is the one line-item from the directive moved between modes, and why.)*

### Mode 3 — Developer (explicitly enabled) · *adopted with modifications*

Explicitly enabled, clearly labeled, never ambient. Developers can:

- **Fork/clone an existing template's source** and modify it
- **Create new templates from scratch** against the published render contract (`render(snapshot, manifest, siteConfig) → FileMap`)
- Add custom CSS — inside their template, where it belongs
- Ship custom fonts, layout systems, entirely different visual worlds
- Understand plainly that automatic upgrades no longer apply (see Template Lock, §3)

**Modification A — where developer work happens (protects Law 6 and Part 6):** Developer Mode is **template authorship, not live-site code editing**. A developer works on a template — locally against the published contract, or in a future authoring surface — and the result enters the platform as a **versioned, reviewed template in the registry**, exactly the seam Part 6 already opened for third-party templates (v2, review governance). There is no in-place "edit the HTML of my live site" textarea: that path has no versioning, no review, no rollback story, and it is how every legacy CMS becomes unsupportable. The developer's power is total *within their template*; the pipeline's guarantees (one renderer, atomic deploys, restorable history) remain total around it. AI is completely optional here, as everywhere (Law 24).

**Modification B — custom JavaScript (protects the frozen determinism bar; ⚠ owner decision requested):** the ratified constitution says twice, in frozen sections, "no scripts beyond platform-approved primitives" (03 §4 Determinism; 03 §6 third-party template conditions). The directive asks for "custom JavaScript with clear limitations and warnings." The smallest correction that honors both:

> A developer template may include JavaScript **only from the platform's approved-primitives library** (e.g., menu filtering, lightbox, mobile nav, maps embed). The library **grows by review**: a developer who needs a new behavior submits it as a candidate primitive; once reviewed, it is available to every template. Arbitrary inline script remains excluded — not as a permissions matter but because it breaks determinism (same snapshot ≠ same bytes), opens an XSS surface on client sites we host, and makes "your site never lies" unenforceable.

If you want true arbitrary JS despite those costs, that is a genuine constitutional change to two frozen sections — say so explicitly and it will be amended with the trade-offs recorded. **Until then, the approved-primitives reading stands.**

---

## 2. AI Is Never Mandatory (adopted as proposed — now law)

Already implied by Laws 10–14 and the Suggest-default; now explicit and stronger (see Laws 24–25, §4). The concrete guarantee: a client may never click an AI control, never generate a word, never accept a suggestion — and every feature of the product remains fully usable. Every AI workflow has a manual equivalent; the manual path is never slower, hidden, or degraded to promote the AI one.

---

## 3. Template Lock (adopted, with the fourth status precisely defined)

Every site's template carries exactly one lock status, honestly displayed to whoever cares for the site:

| Status | What it means | Upgrades |
|---|---|---|
| **Studio Template** | First-party, unmodified. | Automatic (minors); majors ship with a migration path — as ratified in 03 §4. |
| **Customized Template** | Studio template + Designer-Mode configuration only. Configuration is data, never code. | Automatic; configuration is preserved across upgrades. |
| **Developer Template** | Forked or third-party code, passed review, in the registry. | By review — the platform proposes, the template owner merges. |
| **Custom Template** | Customer-owned code. The platform never overwrites it, ever. | None guaranteed. Contract compliance is still verified at registry admission (a custom template that breaks the render contract can't deploy through the pipeline — that's physics, not policy). Renders and deploys like any other; support covers the pipeline around it, not the code inside it. |

Lock status is registry metadata — additive when the developer path ships; nothing in the current schema changes.

---

## 4. Product Law Amendments (Part 11 gains five laws)

The directive's ten laws, reconciled: five are **already ratified law** — customers own content/domains (Laws 1–4), structured content is the source of truth (Law 5), AI never gates editing and stays labeled/reversible (Laws 10–12). The five genuinely new ones join Part 11:

24. **AI can be turned off entirely.** With AI disabled, the product is complete — not degraded, not nagging, not diminished. AI is an assistant, never a requirement.
25. **Every AI capability has a manual equivalent.** The manual path is a first-class path: never slower to reach, never hidden, never worse.
26. **Presentation customization is configuration, never code.** Designer choices are finite options declared by the template's manifest, designed and verified in advance. A client cannot configure their way into a broken or inaccessible site.
27. **Code enters the platform only as a reviewed, versioned template.** Code editing is opt-in, explicitly enabled, and labeled as a developer capability. A standard client never encounters it, and complexity added for developers may never leak into the Guided experience.
28. **Upgrade honesty.** Automatic upgrades are guaranteed for Studio and Customized templates, offered by review for Developer templates, and never applied to Custom templates. A template's lock status is always visible to whoever cares for the site.

*(The directive's "Templates are optional, not restrictive" is realized by Modes 2–3 + the export right (Law 2), rather than as a separate law: presentation is escapable through configuration, forking, or leaving with your content — the three honest exits.)*

---

## 5. Modes × Editions (no new matrix rows invented)

Modes are orthogonal to editions — Law 21 survives: every edition gets the same laws and the same modes.

| Mode | Availability | When |
|---|---|---|
| Guided | Every edition, default, forever | **M7 (now)** |
| Designer | Every edition, where the site's template declares options | **v1.5+** — first templates ship option sets; the settings seam already exists |
| Developer | Explicitly enabled; expected buyers are agencies, developers, and Standalone power users | **v2** — rides the marketplace/review governance already scheduled in 03 §6 |

**Effect on the roadmap:** none structural. Designer Mode gives v1.5's "Agency Edition (beta)" its presets substance; Developer Mode is the same v2 marketplace line item, now with a front door and a name. M7, M8, M9, M10 are untouched.

**Effect on M7 (verified against the built system):** zero new work, zero rework. The seams this amendment leans on already exist and are already frozen-compatible: per-site presentation configuration (`presence_settings` jsonb, shipped in 0019), the manifest as the template's *complete* interface (03 §4 — an `options` block is an additive extension), and the versioned template registry. M7 builds Guided Mode, which it was always building.

---

## 6. What requires your explicit sign-off

1. **Ratify this amendment** as written, or
2. **Overrule Modification B** (arbitrary custom JS) — a change to two frozen sections, made with the costs (determinism, XSS surface on hosted client sites, unenforceable truth guarantees) recorded here, or
3. **Adjust any mode boundary** (e.g., font uploads in Designer rather than Developer).

Until ratified, implementation continues under the constitution as previously frozen — which M7, being Guided-Mode-only, satisfies either way.
