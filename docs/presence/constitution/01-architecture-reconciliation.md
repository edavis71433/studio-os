<!-- Recovered verbatim from the M6.5 session (2026-07) — the ratified text. Amendments are separate, numbered files in this directory. -->

# Presence Platform — Final Design Reconciliation
**Architecture Review Board · Post-M6 · Pre-M7 · Single Source of Truth**

---

## 1. Executive Summary

The design deck, the design review, and the implemented architecture (M1–M6) are closer than three independently produced artifacts have any right to be. The pipeline the deck promises — one draft, deterministic publishing, calm failure, honest history — is the pipeline that exists in production. This reconciliation therefore changes little and *decides* much.

Three decisions dominate this document:

1. **The Board reverses the design review on restore semantics.** Restore-to-Draft, as originally designed, is the correct ten-year architecture. The review chose the cheaper implementation; the Board chooses the better invariant: *the draft is the only writable surface, and everything that will ever become live passes through it.* This decision creates the platform's most important future primitive — the **Draft Writer** — which restore, AI proposals, and cross-product intelligence will all share.

2. **The ConciergeNote feed is promoted from UI component to architectural seam.** It is the single surface through which rules, AI, humans, and eventually every other Studio OS product speak to the client — and its accept/dismiss outcomes are the raw material of Presence Intelligence Memory. It must be persisted, sourced, and event-logged from day one.

3. **Standalone Presence (Product B) is achievable with a written boundary contract, not a rewrite.** Presence was built as a bounded context; it stays sellable alone if — and only if — we codify the dependency rules now, before M7 adds a single route.

Everything else is scoping, sequencing, and eleven cheap-now decisions that prevent expensive-later regret. No frozen principle is weakened. The renderer remains the heart; nothing bypasses it.

---

## 2. Final Decisions

### 2.1 Accepted (as recommended in the design review)

| # | Item | Board note |
|---|---|---|
| R2 | **Change-sentence diff engine** — sentences computed by diffing draft snapshot vs. live snapshot; never from provenance (names-only contract holds). One engine powers the publish sheet, the draft pill, and history summaries. | Promoted: it will also describe AI proposals ("this proposal changes 2 things"). Build once, reuse forever. |
| R3 | **Region markers emitted by templates now**; preview change-outlines ship post-launch. | Markers become part of the template manifest contract (see Marketplace Readiness). |
| R4 | **Preview renders any retained snapshot through the one renderer** (draft, live, historical). No iframing of live sites. | Also the mechanism for history "View" and for reviewing a restore. Honors the one-renderer rule. |
| R5 | **Explicit ordering** for offerings and sections enters the content contract before any CRUD route exists. | Contract-level decision, not a UI nicety. |
| R6 | **Alt-text is a designed moment in upload**, batchable, required. Formats messaged as "photos from your phone just work." | The constraint already exists; the design now honors it. |
| R7 | **Domain fact scoped to real signals** (connected, DNS, SSL). Renewal/billing language removed until registrar management exists. | Honesty is the brand. |
| R8 | **All GBP references gated behind M10**, with designed pre-GBP states: manual testimonials + starring; vertical starter-question set for FAQs; publish progress mentions the website only. | The destination list in UI must always equal the destination list in the pipeline. |
| R10 | **No version screenshots at launch.** Plain-English summaries are the memory anchor. | Revisit only on evidence. |
| — | **Recommended build stands:** Direction C · Home 1a · Preview 1d · Publish 1f · Mobile 1h. | Frozen. |

### 2.2 Accepted with Modification

**R1 — Restore semantics: REVERSED. Restore-to-Draft is adopted.** *(Full reasoning in §3 below — this is the Board overruling the design review, not rubber-stamping the deck.)* Modifications to the original design:
- Restoring **replaces** the draft; it never merges. Before replacement, the current draft is automatically preserved as a retained version ("We set your current draft aside — you can come back to it"). Nothing is ever lost; no merge machinery is ever built.
- Entities present in the draft but absent from the restored snapshot are **hidden, not deleted** (the toggle philosophy, applied to time).
- Snapshots referencing since-pruned media restore with the reference dropped and a plain-language note.
- **Operator tools are unchanged**: M6's instant deploy-restore and admin snapshot-restore remain direct-to-live. Operators get speed; clients get the ritual. Two audiences, two tools, one pipeline.

**R9 — ConciergeNote as persisted data: ACCEPTED AND PROMOTED.** Not merely "rule-based notes stored in a table," but the platform's **suggestion seam**: every note carries a `source` (rule, AI, human concierge, CRM, Projects, Growth, Journal, Messaging), a real reason, at most one action, and a recorded outcome (accepted / dismissed / expired / edited-then-accepted). This is simultaneously the M9 approval surface and the memory layer's event stream. (§5, §6.)

**Presence Health tri-state (Product Decision 4): ACCEPTED AS DATA MODEL, NOT AS UI.** `healthy | needs_attention | outdated` becomes the machine-readable enum *behind* the health sentence — deterministic derivation (validation blockers or hosting/domain issues → needs_attention; staleness signals such as long-idle drafts, stale seasonal wording, ancient last-publish → outdated). The client always sees the sentence; the enum drives glyph and color, feeds the mobile Today tab, the operator fleet view (M6 admin list gains scannable state), the API, and future AI. No percentages. No scores. Ever.

**Design tokens (review's minor item): ACCEPTED AND EXPANDED** into full white-label vocabulary (§7).

### 2.3 Rejected

| Item | Why |
|---|---|
| **The design review's R1** (restore = review-sheet-over-snapshot, no draft involvement) | Creates the draft-resurrection footgun: after a direct snapshot restore, the client's draft still contains the content they just restored *away from*; their next publish silently brings it back. A system whose most safety-critical action plants a time bomb in its safest place is not a ten-year architecture. |
| **Client-facing confidence percentages, scores, benchmarks of any kind** | Confidence gates whether a suggestion appears at all; it is never displayed. Anti-gamification is structural, not stylistic. |
| **Runtime plugin architecture** (WordPress-style) | Arbitrary third-party code inside a deterministic pipeline destroys the determinism that is the product. Extension happens through contracts: new templates, new destinations, new AI skills — never injected code. |
| **Full commerce / ordering in core** | Menus are truth; transactions are a different business with different liabilities. Future partner integrations project *toward* commerce platforms; Presence does not become one. |
| **Template switching as a client feature** | The template casino is Squarespace's churn engine and the studio's support nightmare. Template changes are a concierge conversation. |
| **Inventing features to match competitor checklists** | Per constraints. The comparison in §11 informs; it does not mandate. |

### 2.4 Deferred (post-launch, in rough order)

Preview change-outlines (markers already emitted) · scheduled Updates "on a date" (fast-follow; the platform's scheduler exists) · testimonial share-link form (fast-follow) · shareable draft preview links (new public surface; needs signed expiry design) · Google review import & GBP projection (M10) · all AI moments (M9, against the seams defined here) · weekly digest email · offline read cache / PWA · registrar & renewal management · multi-location UI · localization (reserved, §9) · native mobile apps · version screenshots · search/command palette (revisit on scale evidence only).

---

## 3. Restore Semantics — the Board's Reasoning (Product Decision 3)

The question is not "which restore is easier?" It is "what is the draft?"

**If the draft is the single writable surface — the one place where the future of the site is composed — then everything that composes a future must pass through it.** Client edits do. AI proposals will. Cross-product suggestions will. Under the review's R1, restore alone would bypass it, making live divergent from draft and turning the draft into a trap. Under Restore-to-Draft, the invariant holds universally: *live is always the last reviewed projection of the draft; the draft is always the complete statement of intent.*

The implementation cost the review feared — a reverse serializer — is real, but mislabeled. Snapshot-to-draft writing is not restore machinery; it is the **Draft Writer**: the single gate through which any structured content enters the draft. Restore is merely its first caller. Its second is M9 (applying an accepted AI proposal). Its third is cross-product intelligence (a completed project becoming a portfolio draft item). Building it for restore means M9 inherits a tested primitive instead of inventing an untested one. The "cheap" path deferred this cost to the most delicate possible moment — the first AI feature. The Board declines.

Costs acknowledged and bounded: reverse mapping is defined per content-contract version (v1 is small and closed); replace-not-merge plus the automatic safety version eliminates conflict logic; hidden-not-deleted handles set differences; pruned-media policy is enumerated above. The client API gains an additive route; nothing shipped depends on the old client restore semantics because no client UI exists yet — the freeze's compatibility test passes trivially. The admin surface is untouched.

**Decision: Restore Snapshot → Draft → Review → Publish is the architecture. The Draft Writer is a named platform primitive from this day forward.**

---

## 4. New Requirements

### 4.1 Presence Intelligence Memory (Product Decision 1) — *design now, build at M9*

**Requirements now binding on all future work:**

1. **Memory is derived, never primary.** It is recomputable at any time from an append-only event trail. No AI feature may store a conclusion without the events that justify it. (The provenance table already models this discipline; memory extends it, never shortcuts it.)
2. **The event substrate is largely already flowing:** change events (what gets edited, when, seasonally), publish records (cadence), the notes feed (accepted/rejected/edited proposals — the highest-value signal), voice profile (explicit seed), FAQ answer/skip choices, testimonial starring (taste), offering toggles (seasonal patterns). M7 must preserve outcome-recording on every one of these surfaces — that is the *only* M7 obligation this requirement creates.
3. **Scope and namespace:** memory is per-site, namespaced (`presence/*`) so cross-product memory can join later without collision; tenant-level aggregation is permitted for the studio, never across tenants.
4. **Client-visible and client-owned:** memory must be explainable ("we suggest this wording because you've chosen 'neighborly' phrasing 9 times"), exportable, and deletable. Learning that can't be shown can't be shipped.
5. **What it learns** (the product decision's list, adopted verbatim): preferred wording, tone, accepted/rejected proposals, seasonal patterns, preferred CTAs, business vocabulary, appropriate customer-demographic signals, publishing cadence, service priorities. Demographics only ever from content the client authored or data they connected — never inferred from visitors (no client-site tracking; see §11, Ghost).

### 4.2 Cross-Product Intelligence (Product Decision 2) — *seams now, wires later*

The seam is already three-quarters designed; this section names it:

> **Any Studio OS product may propose; only the client disposes; only the Draft Writer applies.**

- **Inbound seam — the notes feed.** A `source`-attributed ConciergeNote with a structured, contract-versioned **draft patch** payload is the only way another product influences Presence. CRM conversation → FAQ suggestion note. Completed project → portfolio-item note. Invoice pattern → featured-service note. Growth Partnership → recommendation note. Journal → context on a note's reason line. Messaging → recurring-question note.
- **Apply seam — the Draft Writer.** An accepted proposal's patch is applied to the draft like any edit: provenance `ai_approved` (which the contract already reserves), visible in the diff engine's sentences, published through the one pipeline. AI assists; the ritual protects.
- **Outbound seam — read-only projections.** Other products read Presence health, publish history, and content via the frozen API. Never the tables.
- **The independence rule:** every seam is an *optional input*. Presence must render, edit, and publish with zero other products present (see §5). Cross-product features detect capability; they never assume it.

Nothing is built now. What is bound now: the patch format is versioned with the content contract; notes carry source + payload from M7 even while only rules use them.

### 4.3 Additional AI-architecture requirements (from §10 evaluation, Product Decision 7)

- **Delegated authority ladder**, explicit and per-site: *suggest-only → draft-on-request → auto-draft-for-review → auto-publish-with-review-window.* Every rung is opt-in, visible, and revocable. Agent workflows exist only on this ladder. Default: suggest-only. Design the setting's existence now; ship only rung one.
- **The no-new-facts rule:** AI may rephrase, arrange, and ask; it may never assert a business fact the client didn't provide. This is a hard rail specified at the architecture level, testable per feature.
- **Explainability floor:** every AI proposal stores its plain-language reason at creation. The note grammar's reason line is populated from it — reasons are real signals, never decoration. Reasoning history = the notes archive.
- **Quality telemetry, operator-facing only:** acceptance/edit rates per suggestion type are the studio's AI quality dashboard and the learning loop's health check. Never client-facing.
- **Usage metering events** logged per AI action per tenant from the first AI feature — cost attribution is trivial now, forensic archaeology later.
- **Early-candidate note:** alt-text drafting is the ideal first AI feature — high value, zero fact-invention risk, exercises the full propose→approve→memory loop on the smallest possible canvas.

---

## 5. Standalone CMS Readiness (Product B) & 6. Presence Add-on Readiness (Product A)

**Finding: the architecture already substantially supports both products**, because Presence was built as a bounded context: its own function, its own tables, entitlements evaluated at its own boundary, one shared auth module. Product A (add-on) is what exists. Product B requires codification, not construction:

**The Presence Boundary Contract (binding from M7):**
1. Presence functions may import only the shared auth/http modules — nothing product-specific.
2. Presence may read exactly two foreign concepts: an **account** (today satisfied by the CRM's client record: id, name, email) and **staff membership**. These are interfaces, not tables. Standalone ships a thin accounts module satisfying the same shape; nothing else changes.
3. Entitlements remain self-contained (they already are) — Product B's billing flips the same switch A's does, from a different biller. Billing logic stays outside Presence permanently.
4. The room UI must render complete without any other room present: no hard references to Messages, Projects, Billing, Growth. Concierge notes degrade by source (a standalone deployment simply has no `human`/`crm` sources — the grammar doesn't change).
5. Cross-product features are capability-detected (per §4.2), never load-bearing.
6. **Upgrade path B→A is schema-identity:** a standalone site upgraded into Studio OS keeps its data untouched; the surrounding products attach to it. This is the acid test for every future schema decision: *would this column force a migration on upgrade?*

**What must change now (all cheap):** write the boundary contract into the frozen docs; audit M7 route designs against it before implementation; name "account" as the abstraction in all new specs. **What need not change:** nothing implemented violates it today.

---

## 7. White-label Readiness

Recommended now (each cheap now, expensive later):

- **Tokens carry everything visual** — the deck's own palette/type discipline becomes the enforced mechanism; the nine components consume tokens exclusively. Already accepted; now binding.
- **Vocabulary tokens carry everything verbal:** product name, "your studio," concierge persona name ("Mara" is a brand asset, not a constant), email from-names, footer attribution. Copy written against tokens from the first M7 string.
- **The preview/staging domain root is configuration** (`*.studioos.site` today; an agency's own domain tomorrow).
- **Template manifests gain author/license/attribution metadata** — three fields today; the difference between a marketplace and a legal problem later.
- Explicitly *not* now: white-label admin theming, reseller billing, per-agency feature flags. Real work, no retrofit penalty.

## 8. Marketplace Readiness

The foundations are, deliberately, already in place: templates are registered `slug@version`, pure, manifest-described, cap-declaring, and now region-marker-declaring. A future marketplace is "more entries in the registry plus review governance." Bound now: manifests are the *complete* interface (a marketplace template needs nothing a manifest can't declare); the renderer's purity rules are the non-negotiable acceptance bar; template majors follow the same governance as contract majors. Nothing else until there is a second template worth selling.

## 9. Enterprise Readiness

- **Multi-location:** schema is already plural. Before M7 content routes freeze their shapes, verify the serializer/contract treat locations as a *list* (of one) rather than a scalar — a one-line check now versus a contract major later. UI remains single-location until demand.
- **Localization:** the render contract reserved `locale` at M4 — the reservation stands. Rule now: template strings stay isolatable; content is single-locale per site in contract v1; multi-locale content is a planned contract-major, not an ambush.
- **Concurrency:** single-draft last-write-wins is acceptable for SMB; note as a known limit. Field-level presence indication is a later, additive UI concern.
- **Roles:** all portal users of a client share one capability today. The authority ladder (§4.3) is where per-user delegation will eventually live; nothing needed now.

## 10. Technical Debt Prevention — ranked

Every decision that becomes extremely expensive after launch, ranked by (cost-if-deferred × certainty-of-need):

1. **Content-contract versioning discipline** — already frozen; every item below versions against it. Breaking this breaks everything. *(Held.)*
2. **Restore/Draft Writer semantics** — decided in §3. *(Decided.)*
3. **Notes-as-data with outcomes + sourced patch format** — the AI memory substrate and cross-product seam. *(New requirement, M7.)*
4. **Region markers in templates** before the template accumulates real-world majors. *(Accepted, M7 build-time.)*
5. **Ordering in the contract** before CRUD routes ossify shapes. *(Accepted, pre-M7.)*
6. **Design + vocabulary tokens** before thousands of strings and styles exist. *(Accepted, M7 discipline.)*
7. **Standalone boundary contract** before M7 adds routes. *(New requirement, paper-only.)*
8. **Locations-as-list verification** before content routes freeze. *(One check.)*
9. **Content export as a client right** (structured JSON per contract) — trust feature, portability answer to Contentful/Sanity, GDPR-adjacent; trivial while the contract is small. *(New, small, M7 or fast-follow.)*
10. **AI usage metering events** from the first AI call. *(M9 gate.)*
11. **Locale reservation** *(held)*; **public API / marketplace / plugins** — foundations exist (frozen API, template registry, no-plugins ruling); no further pre-work earns its keep.

## 11. Product Comparison — informing, not mandating

| Platform | Copy | Reject | Customers will expect | Debt to avoid | Where Presence is genuinely different |
|---|---|---|---|---|---|
| **WordPress** | Revisions everywhere (have, better); ecosystem *lesson* → extension seams | Runtime plugins; edit-live theming; admin sprawl | A blog (have); "can I export?" (→ export right, §10.9) | Plugin entropy | Determinism as a service vs. entropy as a hobby |
| **Webflow** | Output-quality bar; staging domains (have) | Canvas editing for clients — the anti-thesis; CSS exposure | Polished sites | Bespoke per-site DOM breaking the contract | Clients own facts, never layout |
| **Squarespace** | Onboarding smoothness; domain hand-holding (ours is human) | Template casino; upsell noise | Easy domains, mobile edits (have) | Template-switch support burden | Concierge does the scary parts |
| **Wix** | ADI *intent* (structured input → site) | ADI *execution* (AI layouts nobody owns); widget sprawl | "AI made me a site" | Widget zoo | AI proposes into a reviewed draft, never surprises |
| **Framer** | Preview delight & speed (1d's stage) | Canvas + generated pages | Fast, modern sites | — | Preview is a projection of truth, not a drawing |
| **Duda** *(closest competitor)* | White-label depth; client-permission simplicity; operator multi-site views (M6 has) | Widget marketplace sprawl | Agency dashboards (have) | Per-widget upkeep | Structured contract + concierge; Duda white-labels a builder, we white-label an outcome |
| **Shopify** | Merchant language (adopted); sections/structured-content discipline | Full commerce in core | "Can people order?" → partner projection later | Checkout liability | The menu is truth; transactions are a projection target, not the product |
| **HubSpot CMS** | CRM↔content unification — *validates Product A and §4.2 exactly* | Marketing-suite bloat; lead-gating | CRM-aware sites | Suite gravity | Same unification, calm instead of funnel-brained |
| **Contentful / Sanity** | Contract-first content, content/presentation split (our core) | Developer-first UX; query languages as user surface | Portability (→ export right) | — | "Sanity for owners who will never see Sanity" |
| **Ghost** | Publishing calm; speed; newsletters as a future **destination** (fits the projection model perfectly); no-tracking ethos | Theme-developer model | A journal that feels good (have: Updates) | — | Multi-destination truth vs. single-channel publishing |

**The moat, stated once:** every competitor sells a tool for making a website. Presence sells *being correct everywhere* — the website is one projection of a structured truth, kept accurate by a human-and-AI concierge through a deterministic, reversible pipeline. No platform on this list treats the website as merely the first destination.

## 12. Things That Must Be Decided Before M7 — now decided

1. Restore-to-Draft + Draft Writer primitive — **decided** (§3).
2. Diff engine as the single change-explainer — **decided** (R2).
3. Ordering in the contract — **decided** (R5); locations-as-list verified alongside.
4. Notes feed: persisted, sourced, outcome-recorded, patch-capable — **decided** (§4).
5. Health enum behind the sentence — **decided** (§2.2).
6. Region markers in template contract — **decided** (R3).
7. Preview-any-snapshot parameterization — **decided** (R4).
8. Boundary contract for standalone — **decided** (§5).
9. Token + vocabulary discipline — **decided** (§7).
10. Pre-GBP and pre-AI states designed in, not bolted on — **decided** (R8/R9).

## 13. Updated Master Checklist

**Frozen and untouched:** render contract & purity · one renderer, no bypass · content contract v1 + governance · additive-only API v1 · entitlement boundary · append-only provenance (names, never values) · calm-failure contract · one-in-flight publishing · accessibility by construction · security posture (token isolation, RLS doctrine, staff fail-closed).
**Newly frozen by this document:** draft as sole writable surface · Draft Writer primitive · restore-to-draft (client) / direct restore (operator) · propose→dispose→apply seam · memory-as-derived-events · authority ladder · no-new-facts rule · health tri-state (never scores) · boundary contract · token/vocabulary discipline · no runtime plugins.
**M7 builds:** room shell + Home (sentence, four facts, notes feed) · six sections CRUD (ordered) · preview stage (any snapshot) · publish sheet + diff engine · history + restore-to-draft · first-run · mobile (1h) · markers · tokens · export right (or fast-follow).
**Sequenced after:** §2.4 list, unchanged.

## 14. Final Recommendation

With the decisions recorded here — one reversal, two promotions, four product-decision integrations, eleven debt-prevention bindings, and zero violations of frozen principle — the specification is reconciled. There is no architectural ambiguity remaining between the deck, the review, and the platform.

**The Board approves this document as the single source of truth for M7 and beyond. Design finalized. Implementation may proceed against it.**
