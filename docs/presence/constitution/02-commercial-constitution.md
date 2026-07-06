<!-- Recovered verbatim from the M6.5 session (2026-07) — the ratified text. Amendments are separate, numbered files in this directory. -->

# The Presence Platform — Product & Commercial Constitution
**M6.5 · Product Definition Milestone · Commercial Source of Truth**
*Companion to the Architecture Reconciliation (M6.5-A). Where that document governs how Presence is built, this document governs what is sold, to whom, and on what terms. No engineering content. Approved decisions here bind M7 and beyond.*

---

## PART 1 — PRODUCT CATALOG

### 1.1 Studio OS Core
- **Purpose:** The operating system for a digital studio's client relationships — CRM, client portal, messaging, journal, growth partnership, billing, and the concierge operating model.
- **Target customer:** The studio itself (today: Dapper Digital Studios; tomorrow: tenants).
- **Primary value proposition:** *Run a high-touch studio without high-touch overhead.*
- **Included modules:** Clients/CRM, contacts & portal auth, Messages, Our Journal, Growth Partnership, Billing, admin operations, tenancy.
- **Excluded modules:** Presence (sold separately as an add-on), all Presence-only surfaces.
- **Upgrade path:** Core → Core + Presence Add-on (entitlement flip; no data changes).

### 1.2 Presence Add-on (Product A)
- **Purpose:** The client's presence room inside Studio OS — one structured truth, projected to website (and later GBP and other destinations), kept accurate by concierge + AI.
- **Target customer:** SMB clients of a studio (restaurant-first vertical), sold *through* the studio relationship.
- **Primary value proposition:** *Your business says the right things, everywhere customers look — and someone is watching it with you.*
- **Included modules:** Presence room (Home, Business, Offerings, FAQs, Testimonials, Updates, Media), preview, publish pipeline, history & restore, managed hosting/domain/SSL, concierge notes (rules now, AI at M9, human always), operator tooling (M6).
- **Excluded modules:** Nothing from Core is duplicated; Presence consumes Core's account, messaging, and billing.
- **Upgrade path:** None needed — it is the top of the A-line. Cross-grade to Standalone is defined in Part 3.9.

### 1.3 Standalone Presence CMS (Product B)
- **Purpose:** The identical Presence room and pipeline, sold directly, with no Studio OS surround.
- **Target customer:** SMB owners without a studio relationship; freelancers managing one or two sites; future funnel into agencies and Studio OS itself.
- **Primary value proposition:** *A website that stays correct — without becoming your hobby.*
- **Included modules:** Presence room, pipeline, hosting/domain/SSL, rule-based + AI concierge notes, export. A thin **account module** satisfies the boundary contract's "account" interface.
- **Excluded modules:** CRM, Projects, Messages, Growth Partnership, Journal, Studio billing, human concierge (unless attached to a studio/agency). Notes feed simply has no `human`/`crm`/`projects` sources — the grammar is unchanged.
- **Upgrade path:** Standalone → Studio OS client (schema-identity upgrade; the site's data is untouched, the surround attaches — the acid test from the reconciliation). Standalone → managed-by-Agency (tenant reassignment).

### 1.4 Agency Edition (Future)
- **Purpose:** Studio OS's operating model, licensed to other agencies: a tenant running many Presence sites under their own brand.
- **Target customer:** Web agencies and productized-service freelancers with 5–100 SMB clients.
- **Primary value proposition:** *Sell the outcome we sell — under your name, on our pipeline.*
- **Included modules:** Everything in Core + Presence, plus fleet dashboard (the M6 admin surface, matured), white-label tokens & vocabulary, template/config presets, wholesale licensing.
- **Excluded modules:** Marketplace publishing rights initially; enterprise governance features.
- **Upgrade path:** Agency → Enterprise (governance layer added). Individual agency clients may be released to Standalone or upgraded to a full Studio OS tenant relationship.

### 1.5 Enterprise Edition (Future)
- **Purpose:** Presence for organizations: multi-location, multi-brand, governed publishing.
- **Target customer:** Franchises, regional chains, multi-brand SMB groups.
- **Primary value proposition:** *Every location correct, every publish governed, one source of truth.*
- **Included modules:** Everything in Agency, plus roles/approvals, SSO/SCIM, audit exports (provenance-backed), brand governance, multi-location content, regional publishing, localization (contract-major when built).
- **Excluded modules:** Nothing conceptually; everything additional is governance, not new pipeline.
- **Upgrade path:** Terminal edition.

---

## PART 2 — FEATURE MATRIX

Legend: **✓** Included · **—** Unavailable · **F(x)** Future (milestone) · **✗** Never (by law).

| Feature | Studio OS Core | Presence Add-on | Standalone CMS | Agency | Enterprise |
|---|---|---|---|---|---|
| **Foundation** |
| Client/CRM, portal, Messages, Journal, Growth | ✓ | ✓ (via Core) | ✗ (by definition) | ✓ | ✓ |
| Account & auth | ✓ | ✓ | ✓ (thin account module) | ✓ | ✓ + SSO/SCIM F(Ent) |
| Tenancy | ✓ | ✓ | Single-tenant | ✓ multi-client | ✓ multi-brand |
| **Presence Room (M7)** |
| Home: health sentence + tri-state, four facts | — | ✓ | ✓ | ✓ | ✓ |
| Business / Offerings / FAQs / Testimonials / Updates / Media | — | ✓ | ✓ | ✓ | ✓ |
| Always-editable + autosave draft; draft pill | — | ✓ | ✓ | ✓ | ✓ |
| Concierge notes — rule-based | — | ✓ | ✓ | ✓ | ✓ |
| Concierge notes — human source | ✓ (staff) | ✓ | — (unless agency-attached) | ✓ | ✓ |
| Voice profile (traits + canned samples) | — | ✓ | ✓ | ✓ | ✓ |
| **Pipeline (built)** |
| Deterministic publish, one renderer, atomic deploys | — | ✓ | ✓ | ✓ | ✓ |
| Preview any snapshot (draft/live/history) | — | ✓ | ✓ | ✓ | ✓ |
| Publish sheet, diff sentences, real checks | — | ✓ | ✓ | ✓ | ✓ |
| History, restore-to-draft (client) | — | ✓ | ✓ | ✓ | ✓ |
| Operator instant restore / snapshot restore | ✓ (staff) | ✓ | ✓ (support) | ✓ | ✓ |
| Provenance trail (append-only) | ✓ | ✓ | ✓ | ✓ | ✓ + audit export F(Ent) |
| **Hosting (built)** |
| Managed hosting, CDN, SSL, custom domain | — | ✓ | ✓ | ✓ | ✓ |
| Subdomain-first launch (no domain required) | — | ✓ | ✓ | ✓ | ✓ |
| Media pipeline (private storage, variants, EXIF strip) | — | ✓ | ✓ | ✓ | ✓ |
| Self-hosting | ✗ | ✗ | ✗ | ✗ | ✗ (see Part 6) |
| **Ownership** |
| Full structured content export | ✓ | ✓ | ✓ | ✓ | ✓ |
| Client owns domain & content | n/a | ✓ | ✓ | ✓ | ✓ |
| **AI (M9)** |
| Alt-text drafting; rewording in voice; suggestion notes | — | F(M9) | F(M9) | F(M9) | F(M9) |
| Draft-on-request (Updates) | — | F(M9) | F(M9) | F(M9) | F(M9) |
| Intelligence memory (per-site) | — | F(M9) | F(M9) | F(M9) | F(M9) |
| Cross-product proposals (CRM→FAQ etc.) | — | F(post-M9) | ✗ (no sources) | F | F |
| Auto-publish rungs of authority ladder | — | F(v2, opt-in) | F(v2, opt-in) | F | F + approvals |
| Client-facing scores/confidence % | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Destinations** |
| Website | — | ✓ | ✓ | ✓ | ✓ |
| Google Business Profile | — | F(M10) | F(M10) | F(M10) | F(M10) |
| Email digest / newsletter / social projections | — | F(v2) | F(v2) | F(v2) | F(v2) |
| Commerce/checkout in core | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Scale & governance** |
| Fleet dashboard (many sites) | ✓ (M6 admin) | ✓ (studio) | — | F(Agency) | F(Ent) |
| White-label tokens & vocabulary | — | — | — | F(Agency) | F(Ent) |
| Template presets / clone config | — | — | — | F(Agency) | F(Ent) |
| Bulk updates across sites | — | — | — | F(Agency, guarded) | F(Ent, governed) |
| Roles, approvals, brand governance | — | — | — | — | F(Ent) |
| Multi-location content | — | F(v2) | F(v2) | F(v2) | F(Ent, first-class) |
| Localization | — | F(contract-major) | F | F | F(Ent) |
| Template marketplace | — | F(v2) | F(v2) | F(v2, publish rights) | F |
| Runtime plugins / page builder / template casino | ✗ | ✗ | ✗ | ✗ | ✗ |
| Visitor analytics dashboards for clients | ✗ | ✗ | ✗ | ✗ | ✗ (digest ≠ dashboard) |
| Native mobile apps | F(v2) | F(v2) | F(v2) | F(v2) | F(v2) |

---

## PART 3 — BILLING MODEL (architecture, not prices)

**3.1 The unit of billing is the site, not the seat.** One active Presence entitlement = one live site (the `site_limit` concept already exists for future multi-site). Unlimited users per client. Seats are never sold at SMB level — pricing people to edit their own hours is hostile.

**3.2 Terms.** Monthly and annual (annual = discount + the calm of not thinking about it). All plans include hosting, SSL, domain connection, publishing, support. **No metered publishing, ever.**

**3.3 Founders tier.** First cohort (per product launch, Part 10): permanently discounted rate, locked for the life of continuous subscription, badge of honor, in exchange for feedback rights. Founders pricing is a *rate lock*, never a feature fork — one product, always.

**3.4 Trials.** Standalone: full-featured trial on the platform subdomain; connecting a custom domain converts the trial (the natural commitment moment — no card-upfront hostage mechanics). Add-on: no trial concept; the studio provisions as part of the engagement.

**3.5 Lifecycle ladder** (maps to the built entitlement states):

| State | Trigger | Room | Live site | Publishing |
|---|---|---|---|---|
| **Active** | paid | full | live | yes |
| **Past-due (grace)** | payment fails; `grace_until` ≈ 14 days | full, gentle banner | live | yes |
| **Paused** | voluntary (seasonal businesses — a *feature*, offered proudly) | read-only | live, frozen | no (operator may, per M6) |
| **Lapsed** | grace exhausted | read-only + export | live, frozen, 30-day wind-down | no |
| **Parked** | wind-down ends | export only | **courtesy card** — name, hours, phone, map on the platform subdomain; custom domain released to owner | no |
| **Deleted** | 12 months parked, after three export reminders | — | — | — |

*The courtesy card is a product law in action: even in death, the site shrinks — it never lies and never 404s the business.* Content, snapshots, and history are retained through Parked; deletion executes the retention/purge policy (the append-only purge mechanism flagged at M6 becomes an engineering requirement of Standalone launch, not before).

**3.6 Downgrades.** Add-on → none exists below it. Standalone tiers (if introduced) downgrade at renewal, never mid-cycle, never with data loss — features gray out, content stays.

**3.7 Upgrades.** Instant, prorated, entitlement-flip only.

**3.8 Standalone → Studio OS.** Schema-identity upgrade (frozen in reconciliation §5): the account becomes a client, the surround attaches, billing transfers to the studio relationship. Zero migration, zero downtime, zero re-entry of content. This upgrade is the standalone product's strategic purpose.

**3.9 Studio OS → Standalone.** A client leaving a studio may take their site to a direct Standalone subscription (tenant release). The studio is compensated by policy (referral trail), not by friction. *No hostage clients* — this makes studios comfortable building on Presence and clients comfortable entering.

**3.10 Agency licensing.** Wholesale per-active-site tiers (volume brackets), agency bills its own clients at its own retail; OR referral mode (we bill the client, agency earns recurring share). Both supported by the same entitlement machinery; the difference is who owns the billing relationship. White-label rights attach to the wholesale tier.

**3.11 Enterprise licensing.** Annual contract, per-location bands, governance features included, SLAs defined at signing. Never self-serve.

**3.12 What lapse never touches:** export (always available, every state including Parked), the client's domain (theirs, always), provenance history (retained per retention policy), and the truth (the courtesy card stays accurate).

---

## PART 4 — CONTENT OWNERSHIP

| Asset | Owner | Notes |
|---|---|---|
| Content (all structured entities) | **Client** | We are custodians. Export at will. |
| Images/media | **Client** | Originals returned in export at full fidelity. |
| Domain | **Client** | Registered in the client's name even when we manage it. Transfer-out honored within days, no fee. Non-negotiable law. |
| Templates & renderer | **Platform** | Clients license the projection; they own what's projected. Export includes final rendered HTML snapshot *and* structured content — but the pipeline is not exportable. |
| Exports | **Client** | Structured JSON per content-contract version + media archive + last-rendered site. Self-serve, unlimited. |
| AI-generated content | **Client, upon acceptance** | Accepted-into-draft = client's, indistinguishable in ownership from typed content; provenance records origin (`ai_approved`) for honesty, not for claims. Unaccepted proposals are ephemeral platform artifacts. |
| History & snapshots | **Client's data, platform's format** | Included in export as content-per-version; retention per Part 3.5. |
| Memory (M9) | **Client** | Visible, exportable, deletable — reconciliation §4.1 binds this. |

**Leaving:** export → domain transfer → wind-down per ladder. Departing clients receive everything above; the courtesy card offer stands until Parked ends. **Returning:** within retention, reactivation restores everything (site, history, memory) exactly — *"welcome back, nothing was lost"* is a designed moment. After deletion, returning = new site.
**Migration in:** structured import (contract-shaped) is a fast-follow to Standalone launch; concierge-assisted migration is the Add-on's white-glove answer from day one.

---

## PART 5 — AI COMMERCIAL MODEL

**Placement.** All client-facing AI belongs to **Presence** (both products identically — one product, one experience). Studio OS Core gets operator-side AI (drafting replies, journal synthesis) on its own track. Agency/Enterprise get *governance over* AI (who may enable which authority rungs), never *more intelligence* — smarter-AI-for-richer-customers corrodes trust.

**Metering philosophy: the client never sees a credit.** Three classes:

| Class | Examples | Commercial treatment |
|---|---|---|
| **Assistive** (bounded, reactive) | Alt-text drafts, rewording in voice, hours parsing, FAQ starter answers shaping | **Unlimited** within fair use. Cost is trivial; anxiety about using them would destroy their value. |
| **Generative** (open-ended, on request) | "Draft this update," seasonal content proposals | Included with generous soft caps per plan; sustained heavy use surfaces as a plan conversation, never a mid-task paywall. Internal metering events (bound at reconciliation §4.3) make caps honest. |
| **Autonomous** (agentic, standing) | Auto-draft, auto-publish-with-review-window (v2) | Premium capability by authority rung; opt-in, revocable, always visible. |

**Approval requirements (permanent):** anything entering the draft requires acceptance (ladder rung 1–2 defaults); anything going *live* requires the publish ritual until the client explicitly climbs the ladder. **Never auto-run, at any tier, ever:** fact creation (no-new-facts law), publishing without standing consent, domain/hosting changes, deletion of anything, communications sent as the client. AI failure modes must be silent-safe: a failed suggestion is a suggestion that doesn't appear.

---

## PART 6 — HOSTING

**Philosophy: hosting is not a feature — it is the product's spine, and it is ours.** The deterministic pipeline (draft → snapshot → render → atomic deploy → instant restore) *is* the trust story. Every plan includes managed hosting, global CDN, automatic SSL, custom domains (subdomain-first onboarding, concierge-handled DNS), private media storage with automatic optimization and EXIF stripping, versioned snapshots as backups (every publish is a restore point — M6 proved both restore paths live), and export.

**Self-hosting: No — permanently.** Not as gatekeeping but as honesty: a self-hosted Presence site cannot receive the guarantees the product *is* — atomic publishes, instant restore, always-current SSL, accessibility-verified output, a concierge who can actually fix things at 9pm. Splitting the pipeline across infrastructure we don't operate reintroduces every failure mode this architecture was built to eliminate. The anti-lock-in answer is not self-hosting; it is the **export right**: you can always leave with everything — content, media, history, and your rendered site. You just can't take the pipeline, because the pipeline is the product. (WordPress sells you the engine and the maintenance burden; we sell the destination and keep the burden.)

**Migration:** out = Part 4. In = import + concierge white-glove. Between our own products = entitlement flips, never data moves.

---

## PART 7 — AGENCY MODEL

Verdicts on each question:

- **Create clients: Yes** — the core loop; provisioning is already one idempotent operation (M6).
- **Clone templates: Yes, as presets** — agencies configure template + voice defaults + starter content per vertical ("Restaurant Starter") and stamp new clients from them. They do **not** author arbitrary templates until the marketplace exists with review governance.
- **Clone Presence configurations: Yes** — same preset mechanism.
- **Bulk updates: Guarded yes** — bulk operations act on *facts within* many drafts (e.g., holiday hours across the fleet) and always produce per-site drafts + per-site publishes through the normal ritual (or the agency's operator authority). Never a bulk bypass of the pipeline. One renderer, one draft — even at fleet scale.
- **Shared assets: Yes, tenant-level media library** (stock/brand assets) feeding site-level media; site media stays site-owned.
- **Branding & white-label: Yes** — the token + vocabulary system (frozen at reconciliation) covers visual identity, product name, concierge persona name, preview domain root, and email identity. What is *never* white-labeled: the product laws, the ownership terms, and the export right — clients of agencies get the same constitution.
- **Reseller pricing: Yes** (wholesale, Part 3.10). **Referral pricing: Yes** (alternative mode, same machinery). **Seat pricing: No** — sites, not seats, at every level.

---

## PART 8 — ENTERPRISE

Enterprise is **governance over the existing pipeline**, not a second pipeline:

- **Multi-location:** first-class (schema already plural; contract path reserved). Location-scoped facts, shared brand content.
- **Brand governance:** locked fields (brand name, logo, legal copy editable only by brand-role), template pinning, voice profile locked at brand level.
- **Approvals:** the authority ladder generalized to humans — location managers propose (their edits land as drafts/notes), brand approves, publish executes. The propose→dispose→apply seam was designed for AI; it serves org charts for free.
- **Roles:** brand admin / location editor / viewer — the first real role model in the product; SMB stays roleless by design.
- **SSO/SCIM:** enterprise-tier auth federation and provisioning. Future; the thin account interface is where it attaches.
- **Audit:** the append-only provenance trail *is* an audit log by construction (who, what, when, provenance, never values) — enterprise adds export and retention contracts on top, not a new system. This is a genuine differentiator: our audit story is architectural, not bolted on.
- **Compliance:** data residency and DPA terms at contract level; the export/ownership regime already exceeds most requirements.
- **Localization:** enterprise is the paying driver for the reserved contract-major.
- **Multiple brands:** a brand = a site family under one tenant; `site_limit` and tenancy already shape this.
- **Regional publishing:** scheduled/scoped publishes per location group — the scheduler exists; governance wraps it.

---

## PART 9 — MARKET COMPARISON (commercial positioning)

| Platform | Their model | What customers learned to expect | Their weakness we exploit | Where we do **not** compete |
|---|---|---|---|---|
| **WordPress** | Free core, paid everything-else (hosting, plugins, maintenance) | "Websites are free, then bleed you" | Total-cost dishonesty; maintenance burden | Plugin ecosystems, self-hosting, developer market |
| **Squarespace** | Subscription site builder | Easy start, pretty templates | Post-launch abandonment — no one keeps it accurate | Template variety, DIY design |
| **Wix** | Freemium + relentless upsell | Free tier exists | Upsell fatigue, trust erosion | Free tier (we will never run one — trials, yes) |
| **Webflow** | Pro-sumer builder + per-site hosting | Designer-grade control | Too hard for owners; agencies bear forever-maintenance | Visual development |
| **Duda** | White-label builder for agencies | Agency dashboards, client permissions | It's still a *builder* — agencies resell labor | Widget breadth. **Duda is our nearest commercial rival; we out-position with pipeline + concierge + ownership laws.** |
| **HubSpot CMS** | CMS as CRM-suite bait | Content + CRM in one | Suite gravity, funnel-brained pricing | Marketing automation suites |
| **Shopify** | Commerce platform, take-rate economics | Transactions native | CMS is an afterthought | Commerce core — we project *toward* commerce, never run checkout |
| **Contentful/Sanity** | Developer seats + API usage | Structured content, portability | No SMB story whatsoever | Developer platform sales |
| **Ghost** | Open-source + managed hosting, no tracking | Ethics, calm, speed | Single-channel (publishing only) | Newsletter-first publishing |

**Positioning sentence:** *Everyone above sells tools for making websites. Presence sells the state of being correct everywhere — priced like a utility, governed like a trust.* We intentionally do not compete on: template count, free tiers, plugin ecosystems, developer platforms, commerce, or "unlimited design freedom." Those are other businesses' moats and our named debt.

---

## PART 10 — LAUNCH STRATEGY

**Order: A-first, founders-first, standalone-second, agency-third, enterprise-on-demand.**

1. **Studio OS is already live** (shipped pre-M1). It is the operating base, not a launch event.
2. **Presence Add-on launches first (M8), founders-first** with the studio's own clients. Rationale: the concierge model *is* the differentiator and it requires the studio; the feedback loop is direct; every hard edge (domains, publishing anxiety, restore) gets absorbed by people we talk to weekly; M6 already proved provisioning-to-live in minutes. Founders cohort = rate-lock + testimony.
3. **Standalone CMS second** — only after the room has survived real clients, the export right ships, the purge mechanism exists, and self-serve onboarding (trial → domain → convert) is proven. Standalone without a proven room is just another builder; standalone *after* is a productized track record.
4. **Agency beta third** — agencies buy evidence, and standalone's self-serve machinery (billing, onboarding, white-label tokens) is 80% of the agency edition. Recruit 3–5 design-partner agencies before opening.
5. **Enterprise last, pulled not pushed** — built when a franchise asks and pays, on the governance seams already reserved. Never speculatively.

---

## PART 11 — PRODUCT LAWS (permanent)

**Ownership & freedom**
1. Clients own their content, their media, their domain, and their history.
2. Export is a right, not a feature — available in every account state, forever.
3. No lock-in: leaving is easy, returning is warm, and neither is punished.
4. No hostage mechanics: lapse degrades gracefully; the courtesy card keeps the business's basic truth online; a domain is transferred out promptly and without fee.

**Truth & publishing**
5. Structured content first: clients keep facts; the platform keeps presentation.
6. One draft. One renderer. One pipeline. Nothing bypasses it — not AI, not agencies, not bulk operations, not us.
7. Publishing is deterministic and atomic; the live site is never partially updated and never changes without the ritual (or explicit, revocable standing consent).
8. Every version is restorable; restore never silently overwrites live.
9. The site never lies — not in preview, not in failure, not in lapse.

**AI**
10. AI assists, never surprises. Everything AI does is labeled, reasoned, reviewable, and reversible.
11. AI never invents facts. It may rephrase, arrange, and ask — never assert what the client didn't provide.
12. Autonomy is a ladder the client climbs deliberately, one visible rung at a time. Default is suggest-only.
13. No client-facing scores, grades, percentages, or gamification — health is a sentence.
14. Memory is the client's: visible, explainable, exportable, deletable.

**Experience**
15. Calm is the default state; color is information; noise must earn its existence.
16. Plain language everywhere — merchant words, never software words.
17. Accessibility by default, on our surfaces and on every site we publish.
18. Failure copy leads with what's safe before what's wrong.
19. No plugins. No page builders. No template casino. No settings sprawl.
20. Price the site, never the seat. No hidden fees, no metered publishing, no surprise AI charges — a client should never fear their own product.
21. Every client of every reseller inherits these laws unmodified. White-label changes the name on the door, never the constitution.
22. Security by design; privacy by default; no visitor surveillance sold as a feature.
23. Every feature must earn its existence — and this document is where it earns it.

---

## PART 12 — UPDATED MASTER ROADMAP

| Phase | Contents | Status |
|---|---|---|
| **M1–M6 · Architecture & Pipeline** | Shared foundation, schema/contract, service, renderer + template, publish pipeline + API freeze, admin/hosting/domain ops + runbooks | ✅ Complete |
| **M6.5 · Reconciliation & Constitution** | Architecture reconciliation; this document | ✅ Complete upon approval |
| **M7 · Client Room** | The reconciled design: Home (sentence + tri-state, four facts, notes feed as data), six sections CRUD (ordered contract), preview-any-snapshot stage, publish sheet + diff engine, history + restore-to-draft (Draft Writer primitive), first-run, mobile 1h, region markers, token/vocabulary discipline, boundary-contract compliance | Next |
| **M8 · Add-on Launch** | Portal integration polish, export right, content import (assisted), lifecycle/billing wiring (entitlement ladder incl. courtesy card), founders cohort onboarding, ops hardening, fast-follows (scheduled updates, testimonial share-link) | |
| **M9 · AI (Presence Intelligence v1)** | Alt-text drafting, rewording-in-voice, rule→AI notes, draft-on-request Updates, voice sample generation, memory substrate + explainability + metering, authority rung 1–2 | |
| **M10 · Destinations: GBP** | Google Business Profile projection (hours/info/posts/reviews import), publish-progress truthfully multi-destination, testimonial import | |
| **Post-launch / v1.5 · Standalone CMS** | Thin account module, self-serve trial→domain→convert, purge mechanism, standalone billing, marketing surface | |
| **v1.5+ · Agency Edition (beta)** | White-label tokens live, wholesale licensing, fleet dashboard maturation, presets/cloning, shared assets, guarded bulk ops | |
| **v2 · Expansion** | Preview change-outlines, share links, additional destinations (email digest/newsletter), authority rungs 3–4 (agentic), multi-location UI, native mobile apps, weekly digest, marketplace (with governance), Enterprise Edition (approvals, roles, SSO/SCIM, audit contracts, localization contract-major) — enterprise pulled by demand | |

---

**Final statement.** This constitution introduces no contradiction with the implemented architecture; on review, the architecture anticipated nearly every commercial requirement (entitlement states, tenancy, site limits, provenance-as-audit, export-shaped contracts) — the two genuinely new engineering obligations it creates are the **courtesy card** lifecycle state and the **retention/purge mechanism**, both scheduled (M8 and Standalone launch respectively), neither touching anything frozen.

Upon approval, this document is the commercial source of truth. **M7 may begin against it.**
