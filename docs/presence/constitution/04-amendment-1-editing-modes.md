# Amendment 1 — Editing Modes, Developer Surface, and Template Lock

**Status: RATIFIED & FROZEN — 2026-07-06.**
Amends: `02-commercial-constitution.md` (Part 11 Product Laws, Part 2 Feature Matrix) and `03-final-constitution.md` (Part 4 Template Philosophy, Part 6 Marketplace Policy — clarified and extended by one seam, see §1 Mode 3).
Origin: owner directive, 2026-07 (pre-M7-completion), reconciled against the ratified constitution; the one open question (JavaScript) was resolved by a second owner directive adopting **Platform Extensions** and the template-layer freedom law. The reconciliation record is §6.

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

Explicitly enabled, clearly labeled, never ambient. **The governing principle, now law (Law 29): developer freedom lives at the TEMPLATE layer, not the LIVE SITE layer.** Within their template, a developer's freedom is genuine and total:

- **Fork/clone a Studio template's source** and modify it, or **create templates from scratch** against the published render contract (`render(snapshot, manifest, siteConfig) → FileMap`)
- Write HTML and CSS, build custom layouts and custom render logic, create reusable components
- Ship custom fonts, layout systems, entirely different visual worlds
- **Package, version, own, migrate, and share** their templates — and eventually **sell** them (§Marketplace)
- Consume Platform Extensions (Modification B) for behavior
- Understand plainly what their template's lock status means for upgrades and support (§3)

Everything still renders through the official contract. Nothing bypasses **Snapshot → Renderer → FileMap → Publish Pipeline**; the renderer remains the only path to production.

**Modification A — where developer work happens (protects Law 6 and Part 6):** Developer Mode is **template authorship, not live-site code editing**. A developer works on a template — locally against the published contract, or in a future authoring surface — and the result enters the platform as a **versioned, reviewed template in the registry**, exactly the seam Part 6 already opened for third-party templates (v2, review governance). There is no in-place "edit the HTML of my live site" textarea: that path has no versioning, no review, no rollback story, and it is how every legacy CMS becomes unsupportable. The developer's power is total *within their template*; the pipeline's guarantees (one renderer, atomic deploys, restorable history) remain total around it. AI is completely optional here, as everywhere (Law 24).

**Modification B — JavaScript, resolved as Platform Extensions (owner directive, ratified):** the constitution says twice, in frozen sections, "no scripts beyond platform-approved primitives" (03 §4 Determinism; 03 §6 third-party template conditions). The resolution keeps both frozen sections intact and gives developers what they actually need — behavior, not script tags:

> **Behavior enters client sites only as a Platform Extension**: a reviewed, versioned integration (analytics, calendars, maps, reservations, forms, tracking, live chat, payments, embeds, widgets, and their kin) exposed through a platform extension API. Templates — first-party and developer alike — **consume** extensions by declaring mount points; they never ship their own runtime script. Extension guarantees, permanent:
> - **Nothing bypasses rendering.** An extension's markup enters through the renderer like all markup; its runtime assets are versioned platform bundles referenced by the FileMap — same snapshot + same extension versions = same bytes. Determinism holds.
> - **No extension can mutate canonical content.** Extensions read what the snapshot gives them and talk to their own service; structured content has exactly one write path (the Draft Writer and the client's own keystrokes), and extensions are not on it.
> - **No extension can reach platform secrets.** Extensions receive scoped, per-site configuration — never platform credentials, never cross-tenant anything.
> - **Review is the gate.** The extension catalog grows the way the marketplace policy already prescribed: contract-mediated, reviewed, versioned, revocable.
>
> This extends the Marketplace Policy's contract-seam list (03 §6) from three seams to **four: templates, destinations, AI skills, and extensions** — an addition to the frozen text, made by this ratified amendment, in its spirit ("an ecosystem of contracts, not code").

**Reserved, not built:** if unrestricted JavaScript is ever wanted, it exists only as a distinct **Developer Self-Managed Mode** — separate name, separate lock status ("Custom Template" is its natural home), explicitly different support expectations, and no claim on the platform's determinism/accessibility guarantees. The architecture reserves the name and the boundary; nothing more is designed, scheduled, or implied now.

---

## 2. AI Is Never Mandatory (adopted as proposed — now law)

Already implied by Laws 10–14 and the Suggest-default; now explicit and stronger (see Laws 24–25, §4). The concrete guarantee: a client may never click an AI control, never generate a word, never accept a suggestion — and every feature of the product remains fully usable. Every AI workflow has a manual equivalent; the manual path is never slower, hidden, or degraded to promote the AI one.

---

## 3. Template Lock (adopted, with the fourth status precisely defined)

Every site's template carries exactly one lock status, honestly displayed to whoever cares for the site:

| Status | What it means | Upgrades | Support |
|---|---|---|---|
| **Studio Template** | First-party, unmodified. | Automatic (minors); majors ship with a migration path — as ratified in 03 §4. | Fully supported. |
| **Customized Template** | Studio template + Designer-Mode configuration only. Configuration is data, never code. | Automatic; configuration is preserved across upgrades. | Fully supported. |
| **Developer Template** | Built against the render contract, versioned, passed review, in the registry. **The implementation is owned by the developer.** | Manual — the platform proposes contract/primitive updates; the template owner merges and re-versions. | **Platform supported**: the contract, the pipeline, the extension APIs, and the registry are supported by us; the template's own code is supported by its developer. |
| **Custom Template** | Customer-owned. The platform never overwrites it, ever; **the customer controls its lifecycle.** | None guaranteed. Contract compliance is still verified at registry admission (a custom template that breaks the render contract can't deploy through the pipeline — that's physics, not policy). | Pipeline around it supported; code inside it is the customer's. This is also where a future Developer Self-Managed Mode would live. |

Lock status is registry metadata — additive when the developer path ships; nothing in the current schema changes.

---

## 3b. Support Philosophy (permanent rules)

Support follows ownership, and both are always honest and visible:

- **Platform support** — the pipeline, hosting, publishing, restore, the render contract, the extension APIs, and the registry are supported by the platform for every site, on every template type, always. The machine around a template never becomes the customer's problem.
- **Template support** — Studio and Customized templates are supported code. Developer templates are supported by their developer; Custom templates by their owner. A template's lock status *is* its support statement — shown, never discovered.
- **Developer support** — the platform supports developers with published contracts, fixtures, golden/a11y/perf/SEO test harnesses, and versioned registry tooling (§3c). We support the *interface* completely and the *implementation* never.
- **Agency support** — an agency is the studio for its fleet: first-line care for its clients, with the platform behind it (operator surface, runbooks, escalation). Law 21 stands: agency clients inherit every law unmodified.
- **Customer responsibility** — content truth, and (only on Custom templates) the template's lifecycle.
- **Studio responsibility** — everything the customer was promised was handled: care, upgrades on supported templates, honest notice when a template's status limits what "handled" can mean.
- **Upgrade expectations** — automatic for Studio/Customized; offered-and-merged-manually for Developer; never assumed for Custom. No template is ever upgraded *out from under* its owner.
- **Migration expectations** — content migrates freely across template types in both directions, because structured content is the source of truth (Law 5) and templates are projections. Moving from a Custom template back to a Studio template is always possible and never punished (Law 3's spirit, applied to templates).

---

## 3c. The Official Template Development Lifecycle (frozen shape)

The developer workflow, when it ships, is the same discipline the platform already applies to its own templates (fixture.json, golden tests, and the render harness shipped with restaurant-classic 1.0.0 — first-party templates have no private shortcuts):

**Create template → develop locally → render against fixture snapshots → golden tests → accessibility tests → performance tests → SEO tests → package → register (versioned, signed) → publish → assign to customer.**

Review (Part 6) sits at registration for third-party work; the test gates are identical for everyone. A template that hasn't passed the gates doesn't exist in the registry — verified, not attested.

---

## 4. Product Law Amendments (Part 11 gains six laws)

The directive's laws, reconciled: five are **already ratified law** — customers own content/domains (Laws 1–4), structured content is the source of truth (Law 5), AI never gates editing and stays labeled/reversible (Laws 10–12). The genuinely new ones join Part 11:

24. **AI can be turned off entirely.** With AI disabled, the product is complete — not degraded, not nagging, not diminished. AI is an assistant, never a requirement.
25. **Every AI capability has a manual equivalent.** The manual path is a first-class path: never slower to reach, never hidden, never worse.
26. **Presentation customization is configuration, never code.** Designer choices are finite options declared by the template's manifest, designed and verified in advance. A client cannot configure their way into a broken or inaccessible site.
27. **Code enters the platform only as a reviewed, versioned template.** Code editing is opt-in, explicitly enabled, and labeled as a developer capability. A standard client never encounters it, and complexity added for developers may never leak into the Guided experience.
28. **Upgrade honesty.** Automatic upgrades are guaranteed for Studio and Customized templates, offered by review for Developer templates, and never applied to Custom templates. A template's lock status is always visible to whoever cares for the site.
29. **Developer freedom exists at the template layer, not the live-site layer.** Developers may build fully custom templates against the Presence render contract — HTML, CSS, layouts, render logic, components, packaged, versioned, owned, and shareable — while deterministic publishing, accessibility, security, and upgradeability are preserved by the contract itself. Behavior enters sites only as reviewed Platform Extensions; nothing bypasses Snapshot → Renderer → FileMap → Publish Pipeline.

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

## 5b. Marketplace (confirmed strengthened)

The developer path makes the Part 6 marketplace *more* enforceable, not less: what is sold is **templates — never plugins, never runtime code** — and every marketplace artifact has, by construction, already passed the same gates as first-party work (§3c) and can only consume behavior through reviewed extensions. The frozen sentence survives intact and gains teeth: *Presence has no ecosystem of code; it has an ecosystem of contracts* — and now every contract has a named seam, a test gate, and an owner.

---

## 6. Ratification Record — 2026-07-06

The owner's reconciliation directive resolved the single open question. The seven closing determinations:

1. **Does this resolve the JavaScript contradiction?** Yes. No frozen sentence is weakened: sites still carry "no scripts beyond platform-approved primitives" — Platform Extensions *are* those primitives, given a governance model (reviewed, versioned, scoped, revocable) and a growth path. Developers get behavior without ever owning a script tag on a hosted site.
2. **Does this preserve deterministic publishing?** Yes. Extensions render through the renderer and reference versioned platform bundles; same snapshot + same template version + same extension versions → same bytes.
3. **Does this preserve security?** Yes. No arbitrary runtime code on hosted sites, no extension access to canonical content's write path or platform secrets, scoped per-site configuration only, review at every gate.
4. **Does this preserve accessibility?** Yes. Templates pass a11y gates at registration regardless of author; extensions pass review including accessibility; Designer options are pre-verified combinations.
5. **Does this preserve upgradeability?** Yes, honestly stratified: automatic where the platform owns the code (Studio/Customized), offered where the developer owns it (Developer), never presumed where the customer owns it (Custom) — with lock status always visible (Law 28).
6. **Does this improve the future agency and marketplace strategy?** Yes. Agencies get a real front door (fork → own → fleet), the marketplace gets sellable artifacts that are safe by construction, and the platform's own template discipline becomes the public developer experience — one bar for everyone.
7. **Is the amendment now complete?** Yes.

**Constitution Amendment 1 is ratified and frozen.** The constitution directory now reads: 00–03 as ratified at M6.5, plus this amendment. Planning is closed again; implementation resumes at M7-5 exactly where it paused.
