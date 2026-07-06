<!-- Recovered verbatim from the M6.5 session (2026-07) — the ratified text. Amendments are separate, numbered files in this directory. -->

# M6.5-FINAL — The Presence Platform Constitution
**Final Reconciliation Pass · Permanent Freeze · The Last Planning Document**

---

## PART 1 — CONSTITUTION AUDIT

The Commercial Constitution was read end-to-end against the frozen architecture and the reconciled design. Findings, in order of severity:

**A. One near-contradiction, corrected: "the site never lies" vs. the courtesy card.**
A lapsed account is read-only; a courtesy card showing *hours* could therefore drift into falsehood — violating Law 9 by the mechanism meant to embody it. **Correction (binding):** the courtesy card carries only *durable* facts — business name, phone, address, map — and any volatile fact it shows (hours, if ever) carries an honest "as of [date]" stamp. The card states what we know and when we knew it. Law 9 survives intact.

**B. One clarification that strengthens a law: the courtesy card is a template, not a special page.**
The card must be produced by the one renderer from the site's last snapshot, using a minimal registered template, published by the system actor. This was implicit; it is now explicit. Nothing — not even our own lifecycle machinery — bypasses the pipeline. (No engineering change; this is how it must be built at M8.)

**C. Two missing business rules, added:**
1. **Trials are time-boxed as well as event-boxed.** A trial converts at the earlier of custom-domain connection or the trial period's end. Without this, the subdomain-first trial was an indefinite free tier by accident — and Law-adjacent principle says we run no free tier.
2. **Founders continuity survives Pause.** The founders rate lock persists through voluntary Pause (seasonal businesses are a feature, not a defection); it ends only if an account passes fully through wind-down to Parked. Fairness made precise.

**D. Missing product laws, added to Part 11 of the Commercial Constitution (renumbered 24–27):**
- **24. Grandfathering:** existing subscribers never lose a feature to repricing. Plans may change for the future; the past keeps its deal.
- **25. Honest incidents:** clients are told the truth about outages and security events, quickly and in plain language.
- **26. One-click goodbye:** cancellation is self-serve and immediate in effect at term end — no retention gauntlets, no phone-call-required.
- **27. The live site outlives our dashboards.** Published sites are static, CDN-served, and architecturally independent of the platform's own uptime. An outage of ours never takes a client's business offline. (This was always architecturally true; it is now a promise.)

**E. Duplication, resolved editorially:** the export right is defined canonically in Part 4 (Content Ownership); Parts 3, 6, and the Laws now *reference* it rather than restate it. One definition, many citations — constitution hygiene.

**F. Terminology inconsistency, resolved:** "Add-on," "Standalone CMS," "Agency Edition" were catalog labels, not names. Part 2 below freezes naming; the Commercial Constitution's catalog is re-labeled accordingly, with no change of substance.

**G. Commercial promises audited against architecture — all fulfillable.** Instant restore (M6-proven), export-in-every-state (scheduled M8; export runs against retained data, no architectural obstacle), atomic publishes (built), audit-grade history (provenance by construction), schema-identity upgrades (boundary contract). The two engineering obligations the Commercial Constitution created — courtesy card and retention/purge — are confirmed as scheduled work (M8; Standalone launch), not contradictions. **No promise was found that the architecture cannot keep.**

---

## PART 2 — EDITION STRATEGY (frozen)

The platform has **two surfaces** and **one product line**:

- **Studio OS** — the operator platform. Bought by studios and agencies. Never sold to SMBs.
- **Presence** — the client product. One name everywhere, in four editions:

| Edition | Who buys it | What it is |
|---|---|---|
| **Presence** | A business owner, directly | The standalone product. One business, self-serve, full pipeline. *(Internally "Product B"; the word "CMS" is an internal descriptor and never appears in customer-facing language.)* |
| **Presence Managed** | A studio, on behalf of its client | The same product, wrapped in a studio relationship: human concierge, white-glove onboarding, operator care. *(Internally "Product A.")* |
| **Presence Agency** | An agency | Studio OS licensed under the agency's brand + Presence wholesale for its client fleet. The Agency Edition *is* Studio OS + Presence, white-labeled — one platform, not a third codebase. |
| **Presence Enterprise** | An organization | Presence with governance: locations, roles, approvals, federation, audit contracts. |

**Why this structure:** the product is identical in every edition (Law 21 — the constitution is never white-labeled away); editions differ only in *who cares for it and at what scale*. Naming by relationship (Managed / Agency / Enterprise) rather than by size (Personal / Pro) avoids implying feature tiers that don't exist and never will.

**Terminology freeze:** "edition" = product shape; "plan" = billing term only; "site," "room," "draft," "publish," "restore," "concierge" as defined in the design; never "tier," "deploy," "CMS," or "add-on" in customer-facing language.

---

## PART 3 — AI PRODUCT LANGUAGE (permanent UI vocabulary)

Five words, mapped one-to-one onto the authority ladder. These are now reserved words in the product; they may never be used loosely.

| Word | Ladder rung | Definition (customer-facing) | May touch |
|---|---|---|---|
| **Assist** | 0 — always on | In-the-moment help inside something *you* are already editing: parsing "8–4" into hours, drafting alt text for a photo you just added, tightening a sentence you select. Never appears uninvited, never acts outside the field you're in. | The field under your cursor, with you watching |
| **Suggest** | 1 — default | A concierge note: a question or observation with a reason and one action. Writes nothing anywhere. Dismiss means gone. | Nothing |
| **Draft** | 2 — opt-in | Writes into your draft **only when you ask** ("Draft it for me"), always labeled ✦, always fully editable, never visible to customers until you publish. | Your draft, on request |
| **Prepare** | 3 — opt-in | Proactively drafts things it believes you'll want — a seasonal update, holiday hours — and sets them aside **for your review**. Nothing enters your draft until you accept. | A review queue, then your draft on acceptance |
| **Auto-publish** | 4 — explicit standing consent | Publishes prepared changes after a review window you set, unless you stop it. Revocable in one tap. Every auto-publish appears in history, attributed honestly. | Your live site, within your standing rules |

**Permanent language rules:** every AI act is labeled ✦ and named with one of these five words; the words are verbs, never mystique ("AI magic," "smart," "automatically" are banned); rung status is always visible in one place; climbing a rung is a deliberate, explained, reversible choice; the default is and remains **Suggest**. *(These words also bind the M9 spec: a feature that doesn't fit one of the five words doesn't ship.)*

---

## PART 4 — TEMPLATE PHILOSOPHY (frozen)

**How many:** as few as honesty allows. **One flagship template per vertical.** A second template within a vertical may exist only when evidence shows the vertical genuinely contains two presentation populations (not two tastes) — and never a third. Template count is a maintenance liability and a decision burden masquerading as a feature; we sell the *right* projection, not a catalog.

**The standard every template must meet (the acceptance bar — unchanged from the architecture, now commercial law):**
- **Accessibility:** WCAG AA by construction — contrast, structure, landmarks, alt enforcement — verified, not aspirational.
- **SEO/AEO:** complete structured data (JSON-LD for the vertical's entities), semantic pages, sitemaps, honest metadata — built in, never a plugin.
- **Performance:** static output, zero external origins, self-contained assets, green Core Web Vitals on reference content.
- **Determinism:** pure render — same snapshot, same bytes. No scripts beyond platform-approved primitives.
- **Upgradeability:** versioned `slug@version`; minors are safe and automatic; majors ship with a migration path and a review; region markers and caps declared in the manifest, which is the template's *complete* interface.
- **Maintainability:** shared primitives, one code pattern, small enough for one engineer to hold in their head.

**When templates are added:** at a vertical's launch; when a vertical demonstrably splits; when the flagship's major version replaces it.
**When never:** for marketing cadence, for template-count comparisons, for trend-chasing, or because a client asked — a client's template conversation belongs to the concierge, and template *changes* are a studio decision executed through versioning, never a client-side casino (Law: no template casino).

---

## PART 5 — VERTICAL STRATEGY (permanent expansion order)

The contract (facts, hours, offerings, testimonials, FAQs, updates, media) generalizes; verticals differ in the *shape of offerings*, the *dominant CTA*, and the *risk profile of AI language*. Order is chosen by contract-fit first, revenue second, risk last:

| # | Vertical | Why here | Difficulty | Revenue | Template complexity | AI complexity | Support complexity |
|---|---|---|---|---|---|---|---|
| 1 | **Restaurants** | Done — the proving vertical: volatile hours/menus, review-dense, presence-punished | — | High volume | Built | Moderate (menus) | Known |
| 2 | **Salons & personal care** | Offerings = services + prices; near-identical contract; review-driven; huge underserved population | Low | High | Low (services list vs menu) | Low | Low |
| 3 | **Home services & contractors** | Offerings = services; galleries = past work (future Projects synergy); quote CTA; highest willingness-to-pay for "handled for me" | Low–Med | **Highest** | Medium (portfolio emphasis) | Low–Med | Medium (seasonality) |
| 4 | **Fitness & wellness studios** | Offerings = classes/schedules (a structured variant); community updates fit Updates | Medium | Medium | Medium (schedule block) | Low | Low–Med |
| 5 | **Professional services** (legal, accounting, consulting) | High value, conservative buyers who *want* managed; FAQs shine | Medium | High per-site | Low | Medium (tone precision; no-new-facts is easy — they write carefully) | Medium |
| 6 | **Hospitality (lodging-light)** | Strong fit for facts/photos; but booking-engine expectations pull toward OTA integrations | Med–High | Medium | Medium | Low | High (booking questions) |
| 7 | **Medical & dental** | Directory-dominated, compliance-adjacent; the no-new-facts law is load-bearing here — enter only with mature AI rails | High | High | Low | **High risk** | High |
| 8 | **Retail (brochure)** | Last, deliberately: inventory expectations create constant commerce pressure against the boundary (Law: no commerce core). Serve brochure-retail; route transactional retail to partners. | High (boundary defense) | Medium | Medium | Medium | High |

This order is frozen. Skipping is permitted only forward (a paying design-partner in vertical N+2 may pull it earlier); reordering by whim is not.

---

## PART 6 — MARKETPLACE POLICY (frozen)

- **Plugins: Never.** Arbitrary runtime code inside a deterministic pipeline destroys the product. This is already Law 19; it is permanent.
- **Widgets / page-builder blocks: Never.** Same law, smaller costume.
- **Extensions: Yes, only as contracts.** The platform extends through exactly three contract-mediated seams: **templates** (the render contract), **destinations** (the projection contract), and **AI skills** (the propose→dispose→apply seam). Platform-operated first.
- **Third-party templates: Possible, v2, under review governance.** Conditions: pass the identical Part 4 bar (verified, not attested), signed and versioned through the registry, revenue-shared, revocable, no scripts beyond platform primitives, manifest-complete. A third-party template is indistinguishable from a first-party one in safety or it does not exist.
- **Public self-serve themes (upload without review): Never.** Review *is* the marketplace.

**The frozen sentence:** *Presence has no ecosystem of code; it has an ecosystem of contracts.*

---

## PART 7 — API STRATEGY (frozen philosophy)

| Layer | Philosophy |
|---|---|
| **Internal API** | Frozen v1, additive-only, governed (as ratified at M5). The product's own room is its first and most demanding client. |
| **Partner APIs** | Per-destination and per-source contracts (GBP, review sources, menu sources), negotiated, never generic. Partners integrate with our contract; we adapt at the edge. |
| **Public API** | Future, after Standalone launch: read/write **structured content per the content contract**, per-site scoped tokens, rate-limited. Writes enter through Draft-Writer-shaped endpoints only — the public API can fill a draft; it can never touch a live site except by triggering the same publish ritual. |
| **Agency APIs** | The M6 operator surface, productized: provisioning, fleet health, lifecycle. |
| **Enterprise APIs** | Federation (SSO/SCIM) and audit export. |
| **Webhooks** | Future, with the public API. Philosophy: **webhooks notify, never control** — outbound facts (published, health changed, note created), idempotent, replayable. Inbound control does not exist. |
| **Developer philosophy** | Developers are partners of the platform, not tenants inside it. We publish contracts and guarantees, not internals. |

**Private forever:** the renderer and deploy machinery, template registry internals, AI prompts and memory internals, entitlement/billing internals, the operator/admin surface, and all cross-tenant anything.

---

## PART 8 — PRODUCT METRICS (platform health, never analytics)

All metrics below are **internal or operator-facing**; clients only ever meet them as sentences (Law 13). Each exists to answer one question.

| Metric | Definition | Why it exists |
|---|---|---|
| **Presence Health** | The tri-state (`healthy / needs_attention / outdated`), deterministically derived | The single roll-up; drives the sentence, the fleet view, and escalation |
| **Freshness** | Time since volatile facts (hours, offerings, seasonal wording) were confirmed or edited | Staleness is the disease Presence treats; this is its thermometer |
| **Consistency** | Agreement of facts across destinations (site ↔ GBP at M10+) | The multi-destination promise, measured |
| **Completeness** | Contract coverage vs. the vertical's baseline (sections meaningfully filled) | Distinguishes "healthy because complete" from "healthy because empty" |
| **Review responsiveness** | Time from a new review/testimonial arriving to client action (feature/reply/dismiss) | Reputation is presence; neglect here is invisible without measurement |
| **Publishing cadence** | Interval pattern vs. *the business's own* baseline | Detects abandonment early — measured against themselves, never a leaderboard |
| **Recovery confidence** | Restore success rate and time-to-restored when invoked | The safety promise, audited by evidence |
| **Profile completeness** | GBP-era subset of Completeness | Destination-specific readiness |
| **Recommendation acceptance** | Accept / dismiss / edited-then-accept rates per suggestion type | The AI quality loop and memory substrate — if this decays, the AI is talking too much |

---

## PART 9 — SUCCESS METRICS (per milestone; initial targets, adjustable by evidence, never retroactively softened)

- **M7 (Client Room):** five real clients complete edit → preview → publish **unaided**; time-to-first-publish < 15 minutes from room entry; publish success ≥ 99.5%; zero regressions across all frozen suites; every M7 surface records note outcomes (memory substrate live).
- **M8 (Managed launch):** ≥ 10 founders sites live; 90-day founders churn = 0; export executed successfully end-to-end by a real client; support load < 1 substantive ticket/site/month after week two; courtesy-card lifecycle demonstrated in staging.
- **M9 (AI v1):** suggestion acceptance ≥ 40% (below 25% = the AI is noise — feature pauses); 100% alt-text coverage on new uploads; **zero** fact-invention incidents (one = feature freeze + post-mortem); memory explainability demo passes ("why did you suggest this?" answered from events).
- **M10 (GBP):** zero unresolved site↔GBP divergence beyond sync window; Consistency metric live on every connected site; review import feeding Testimonials with no un-starred content ever published.
- **Standalone launch:** trial→paid ≥ 25%; median time-to-live < 1 day unaided; purge mechanism operational; import path exercised.
- **Founders program:** 12-month retention ≥ 90%; ≥ 5 reference-able testimonials; founders feedback demonstrably shaping two shipped changes.
- **Agency beta:** 3–5 design-partner agencies; ≥ 10 sites per agency within 6 months; wholesale unit economics positive per site.
- **Enterprise:** success = one signed, paying pilot whose governance requirements are met by the reserved seams without architectural change.

---

## PART 10 — FUTURE INTEGRATIONS (classification only; nothing here is a commitment to build)

**Likely** *(fits the destination/source contracts and the vertical order)*
Google Business Profile (M10, roadmapped) · Apple Business Connect (same shape as GBP) · Resend (digest email; already platform infrastructure) · Stripe (already platform billing) · Calendly (booking *links* — CTA, not engine) · Facebook & Instagram (profile/post projections, v2 destinations) · Yelp, TripAdvisor (review ingestion sources) · Square, Toast (menu *import sources* for restaurants) · OpenTable (reservation links).

**Possible** *(plausible, unscheduled, contract-mediated if ever)*
Zapier (via the future public API — them integrating us) · Mailchimp (if clients demand it over Resend) · Twilio (notification channel) · LinkedIn (professional-services vertical) · X / Threads / Bluesky / TikTok (post projections if social destinations prove out) · DoorDash / Uber Eats (link-out only — never ordering) · QuickBooks (invoice→featured-service signal, cross-product era) · Shopify / WooCommerce (commerce *link-outs*; Presence projects toward them, never becomes them) · Salesforce (enterprise data source at Enterprise pull, never before).

**Never**
HubSpot / Salesforce **as CRM replacement or dependency** (Studio OS is the CRM; standalone has none by definition) · any ordering/checkout embedded in core (Law) · visitor-tracking/ad-tech integrations (Law 22) · Cloudflare, Netlify, Supabase, GitHub as *customer-facing* integrations — these are internal infrastructure and remain invisible; infrastructure choices are ours to make and change without customer ceremony.

---

## PART 11 — MOBILE STRATEGY (frozen philosophy)

**The phone is for the 9pm question.** Mobile Presence optimizes three jobs: *how are things* (health sentence), *fix a fact* (one bottom sheet), *ship it* (the same ritual, thumb-sized).

- **One tap (sacred):** see health · open preview · approve or dismiss a suggestion · toggle an offering · publish already-reviewed changes · stop an Auto-publish window.
- **Belongs in the app:** everything above, plus single-fact edits, photo capture-and-add (with the alt-text moment), testimonial starring, reading history, restore-to-draft initiation.
- **Allowed but never optimized:** long-form writing (Updates) — possible, not encouraged; the phone must never *block* anything, only decline to celebrate it.
- **Never in the app:** template/major-version decisions, agency fleet operations, bulk anything, account termination flows requiring reflection.
- **Desktop-first:** fleet dashboards, presets, media curation at volume, enterprise governance.
- **Tablet:** the full responsive room — no third design; a tablet is a desk that lost weight.
- **Future:** offline read cache and queued single-fact edits (v2); native apps wrap this exact philosophy, they do not renegotiate it.

---

## PART 12 — BRAND POSITION (permanent)

**Category created:** **Managed Presence.** Not website building — presence management.

**The real competitor** is not Squarespace or Duda; it is **neglect** — the site built three years ago by a nephew, wrong hours on Google, the review nobody answered. Named competitors are merely other things people bought before giving up.

**Positioning statement (frozen):**
> *Presence keeps your business saying the right things everywhere customers look — website, Google, and beyond — from one place you can update in a minute, watched over by people and AI who never change anything without you.*

**Customers must immediately understand:** it stays correct; I can change anything in a minute; someone's watching it with me; I own everything; I can leave anytime.

**We never claim:** "build a website in minutes" (builder framing — we are the end of building) · unlimited design freedom · guaranteed rankings or SEO magic · that AI runs your business · that we replace your marketing team · that we are free.

---

## PART 13 — COMPANY VISION (one page, timeless)

Small businesses are judged, every hour, by information they cannot keep current. A customer who finds wrong hours doesn't blame the software — they drive away, and the business never knows. The tools offered to fix this were all, in the end, the same tool: a builder. Builders convert a business owner into an unpaid, untrained webmaster, then punish them for having a business to run. The industry has spent twenty years selling more powerful versions of the wrong job.

**Presence exists to abolish that job.** A business's presence is a set of facts — what you offer, when you're open, where you are, what people say about you — and facts deserve better than pages. Presence keeps the facts in one structured place, projects them deterministically to every surface customers actually look at, and treats every change with the gravity of publishing and the ease of a text message. The owner keeps the truth; the platform keeps the presentation; nothing goes live without intent; nothing is ever lost; and everything the owner puts in, the owner can take out.

**Studio OS exists because care doesn't scale by working harder.** The studios and agencies who genuinely look after small businesses drown in the operational sludge between the caring — the follow-ups, the handoffs, the "did we update their hours?" Studio OS is the operating system for that care: the client relationship, the communication, the judgment, and now the presence, in one calm system, so a small team can be a concierge to many without becoming a call center to any.

Together they hold one belief: **software should assist like a good employee — visibly, accountably, and never by surprise.** The AI in this platform suggests, drafts, and prepares; it is labeled, it explains itself, it remembers what you prefer, and it never invents a fact or ships a word without earned authority. Trust is not a tone of voice here; it is an architecture — one draft, one renderer, deterministic publishing, restorable history, exportable everything.

**What we refuse to become is as permanent as what we are.** We will not become a page builder; the canvas is the job we abolished. We will not become an ad platform or a surveillance business; our clients' customers are not our inventory. We will not become a plugin bazaar; entropy is not an ecosystem. We will not become a checkout; money changing hands is someone else's excellent business. We will not gamify diligence with scores, or ransom content with lock-in, or grow by making leaving hard. We grow when a business owner realizes, some quiet afternoon, that they haven't worried about their website in a year — and that it was never once wrong.

The metric that outlives every roadmap in this constitution is that afternoon.

---

## PART 14 — FINAL RECONCILIATION

**1. Is the architecture complete?** Yes — for its scope. M1–M6 built, verified live, and frozen; the reconciliation resolved every ambiguity (restore, Draft Writer, seams, health, boundaries); future phases have reserved seams, not open questions.

**2. Is the commercial model complete?** Yes. Editions, billing lifecycle, ownership, AI model, hosting philosophy, agency and enterprise shapes are defined; the audit in Part 1 closed the four gaps (courtesy-card honesty, card-as-template, trial time-box, founders continuity) and added four laws.

**3. Is the roadmap complete?** Yes — M7 through v2, with success criteria (Part 9) attached to every phase, and the two constitution-created engineering obligations (courtesy card at M8; purge at Standalone) scheduled, not floating.

**4. Is anything important still missing?** Nothing that blocks. Three honest notes for the record, none blocking: (a) support/SLA operations for the founders cohort is an operational plan to write during M7, not a product gap; (b) legal instruments (ToS, DPA) must be drafted from Part 4's ownership regime before M8 revenue — an execution task with its source of truth already written; (c) initial numeric targets in Part 9 are evidence-adjustable by design.

**5. Can M7 begin?** Yes. The Architecture Constitution is frozen. The Commercial Constitution is frozen as amended by Part 1. The design is reconciled. The success criteria are set. There is no architectural ambiguity, no commercial contradiction, and no unowned decision between here and the Client Room.

**The planning phase is complete.**
