# Engineering Atlas v1 — Studio OS Presence

**Documentation only. Changes nothing. Describes the platform exactly as it exists at commit `d15c4d1` (2026-07-06).**
Sources of truth: `docs/presence/constitution/00–06` (all frozen), `docs/presence/API-INVENTORY-v1-FROZEN.md`, `docs/presence/RUNBOOKS.md`, migrations `0001–0019`, and the milestone commits M1→M8.5. Where this document and a constitution disagree, the constitution wins. Where reality is genuinely undecided, it is listed in §11 as an open question, not guessed.

Audience: a senior engineer joining in three years. Read this, then the constitutions, before writing a line.

---

## §1 · Product overview

**What it is.** Studio OS is a two-surface platform run by a web studio (Davis Digital Studio). Surface one, **Studio OS**, is the operator platform — CRM, client portal, messaging, projects, billing. Surface two, **Presence**, is the client product: a calm system that keeps a small business's public presence — website first, other destinations later — always saying the right things everywhere customers find it.

**The problem.** Small business owners (restaurateurs, stylists, contractors) don't want a website builder; they want their hours, menu, and story to be *correct in public* without becoming a webmaster. Every existing tool makes them operate software. Presence makes them state facts; the platform makes those facts true everywhere, beautifully.

**The philosophy, compressed:**
- **Structured content is the source of truth.** Clients keep facts (name, hours, menu, kind words); the platform owns presentation entirely. There is no page editor because there are no pages to edit — there are facts and projections of facts.
- **Determinism is trust.** One renderer, one pipeline: same snapshot → same bytes, atomically deployed, every version kept forever, every failure honest ("your site was unchanged and nothing was lost").
- **Calm is the interface.** Health is a sentence, never a score. The primary experience is a few evidenced Business Moments a day, not a dashboard. Vocabulary is merchant words, never software words.
- **The concierge, not the tool.** The product feels like an experienced team quietly working — a host, one voice — whether the work behind it is rules, humans, or (from M9) models.

**Versus the market, philosophically** (expanded in §9): WordPress/Wix/Squarespace sell the customer the job of webmaster; Presence abolishes the job. Webflow/Framer sell design freedom; Presence sells the *right projection* and puts freedom at the template layer for developers, never at the live-site layer for owners. Contentful/Sanity sell structured content to developers as infrastructure; Presence sells its *outcome* to owners as care. SEO/marketing tools sell dashboards of anxiety; Presence's Optimization Engine observes silently and speaks only when something deserves a sentence.

---

## §2 · The product ladder (frozen — 03 §2 as amended by 06)

**Presence Monitor → Presence → Presence Managed → Presence Agency → Presence Enterprise → (surface) Studio OS**

| Edition | Begins | Ends |
|---|---|---|
| **Monitor** | Connect any existing site (WordPress, Webflow, Shopify, custom…) by URL. Optimization Engine observes; concierge explains and recommends — *in words*. | At the moment of action. Monitor never edits anyone's site; it has no write path. Recommendations end in instructions, never buttons. |
| **Presence** | Where the **Draft Writer** begins: the room, the draft, preview, the publish ritual, history, restore, hosting, domains, templates. | At human care. |
| **Managed** | Same product + a studio relationship: human concierge, white-glove onboarding, operator care via the admin surface. | At multi-client scale. |
| **Agency** | Studio OS white-labeled + Presence wholesale for a fleet: presets, cloning, guarded bulk ops (future per roadmap). | At governance. |
| **Enterprise** | Locations, roles, approvals, SSO/SCIM, audit export (future, pulled by demand). | — |
| **Studio OS** | The operator surface above the ladder. Never sold to SMBs. | — |

**Upgrade law (34, frozen):** every edition is additive; upgrades preserve data, content, history, domains, workflows — a Monitor customer entering Presence keeps their whole evidence history. **What never changes:** every law at every rung (21); one draft/renderer/pipeline; export as a right; no plugins, no page builders, no client-facing scores, anywhere, ever.

---

## §3 · System map

Everything lives in one repo: static marketing site + `portal.html` + `presence.html` at root; Supabase backend under `supabase/` (functions + migrations); tests under `tests/`; canon under `docs/`.

**Environments:** production Supabase `qksstlqzbhesadrrofgn` (+ davisdigitalstudio.com static hosting), staging `wjlpursnwbmlcdwbeowv`. Config-only variance by env var (e.g. `ALLOWED_ORIGINS`). Migrations `0003–0005` are historic *held* migrations — fenced, never applied; do not touch. Tools pinned locally: `C:/Users/edavi/Tools/{deno,supabase}`.

### 3.1 Portal (`portal.html`)
- **Purpose:** Studio OS client surface — messages, billing, journal, growth.
- **Shape:** ~5,400-line page-view app; POST-RPC to the `clever-api` edge function; supabase-js session under storageKey `dds-portal-auth`.
- **Presence touchpoint:** one sidebar link ("Your website" → `presence.html`), shown only when RLS returns a `presence_sites` row for the signed-in client.
- **Never:** contains Presence logic. The room is deliberately a separate page (boundary contract: `presence.html` *is* the future standalone shell).

### 3.2 Presence Room (`presence.html`)
- **Purpose:** the entire client experience — Today (statement, facts-as-prose, concierge letters, waiting-to-publish), six sections (Business, Menu, Questions, Kind words, Updates, Photographs), proofing desk, publish ritual, History, restore.
- **Shape:** one static file (~95 KB), no framework, no build. Direction A design system (paper/ink/plum; Fraunces/Inter/Geist Mono), room-scoped tokens. Shares the portal's auth session. Deep links via `?view=`; staging acceptance via `?env=staging`.
- **Inputs:** the frozen client API only. **Outputs:** nothing but API calls. **Never:** talks to tables directly (everything through the presence function), renders site HTML itself (preview HTML comes from the server-side renderer), or invents state (health/changes/notes are all server-computed).

### 3.3 Presence service (edge function `supabase/functions/presence/`)
- **Purpose:** the one bounded context for everything Presence.
- **Boundary order on every request:** CORS → principal resolution (`_shared/auth`, caller JWT via `x-dds-user-jwt`) → site resolution under RLS → entitlement gate (full/readonly/denied — *outside* RLS, at the boundary) → router.
- **Client routes (API v1, frozen, additive-only):** `GET /site` · `GET|PUT /identity` · `GET|PUT /location` · `/voice` · `/settings` · CRUD `/offerings|/testimonials|/faqs|/posts` · `POST /media/upload-url` · `GET /media` · `DELETE /media/:id` · `GET /preview?page&version=draft|live&publish_id` · `POST /publish` · `POST /restore` · `GET /publishes` · `GET /health` · `GET /changes` · `GET|resolve /notes` · `POST /restore-to-draft`.
- **Admin routes (staff-only, 15):** provision (idempotent + repair), list, per-site health, domain add/status/remove, lifecycle, deploys, publishes, force publish, retry, cancel, restore-snapshot (redeploy), restore-deploy.
- **Write discipline:** client content writes go through the *caller's JWT* (`asUser`) so RLS proves ownership; system tables (snapshots, publishes, notes-writes, settings internals) via service role (`svc`). Every mutation writes exactly one provenance event with field *names* only (never values).

### 3.4 Data model (Postgres, `presence_*`)
Core client-owned entities: `presence_sites` (one per client; lifecycle status; template slug@version; netlify_site_id; custom_domain), `presence_identity`, `presence_locations` (hours as 7-day JSON), `presence_offerings`, `presence_testimonials`, `presence_faqs`, `presence_posts`, `presence_media`, `presence_voice` (private; never rendered), `presence_settings` (category_order, cover). System: `presence_snapshots` (immutable content snapshots), `presence_publishes` (the ledger; partial-unique index enforces one in-flight publish), `presence_change_events` (**append-only, trigger-enforced immutable**), `presence_entitlements`, `presence_notes` (source/kind/dedupe_key/outcomes; unique partial index makes dismissal permanent per fact). RLS: clients see/write only their own; system tables are client-read-only or deny; deletes are soft (`deleted_at`) everywhere clients touch.

### 3.5 Renderer + templates (`lib/render*.ts`, `templates/restaurant-classic/1.0.0/`)
- **Contract (frozen):** `render(snapshot, manifest, siteConfig) → FileMap`. Pure: no network, no clock beyond snapshot timestamps, no randomness. The manifest is the template's *complete* interface: pages, entity caps, validation blockers/warnings, image variants, region markers (`data-pr`/`data-pr-id`), preview fixture.
- **One template shipped:** restaurant-classic 1.0.0 — 6 pages + post pages, JSON-LD, XSS-escaped everywhere, WCAG AA by construction, golden-tested byte-for-byte.
- **`normalizeSnapshotContent`** upgrades pre-contract snapshots (scalar location → locations list; guarantees all sections exist) so *any retained snapshot renders or is honestly refused* (`snapshotContentUsable` → 410).
- **Never:** touches Netlify, HTTP, the database, or users; ships arbitrary JS (behavior arrives only as reviewed Platform Extensions, per Amendment 1).

### 3.6 Serializer + validation (`lib/serializer.ts`, `lib/manifest_validate.ts`)
Draft tables → snapshot content (deterministic, ordered, media resolved to variant paths) → validated against the manifest (blockers stop publish; warnings ride along). Preview is allowed while invalid; publish is not.

### 3.7 Draft Writer (`lib/draft_writer.ts`) — *the one gate into the draft*
- **Semantics (frozen, reconciliation §3):** REPLACE never merge; safety snapshot of the current draft first; entities absent from the applied snapshot are HIDDEN not deleted; unresolvable media dropped, counted, told; one provenance event; refuses degenerate snapshots at the primitive itself.
- **Callers:** restore-to-draft today; AI proposals (M9) and cross-product patches tomorrow. **Never:** touches the live site; that's the pipeline's job.

### 3.8 Publish pipeline (`routes/publish.ts` + `lib/netlify.ts`)
Snapshot sealed → rendered → FileMap → atomic Netlify deploy (digest upload) → publish row `queued/deploying → live|failed` → site `last_published_at`. One in-flight publish per site (DB-enforced). Client polling reconciles stuck `deploying` rows via Netlify deploy state. Failure copy is CALM: client sees safety, operator sees `error_text`. **Never:** partial updates; skipping serializer/renderer; publishing while lifecycle forbids (archived/deleting; paused = staff only).

### 3.9 Diff engine (`lib/diff.ts`)
Change sentences computed at read time from draft-snapshot vs live-snapshot content — **never from provenance** (which has names only). Feeds the pill count, Today's waiting-list, the publish ritual, and (as summaries) the publish ledger. First-publish gets its own grammar.

### 3.10 Health (`lib/health.ts`) + Notes (`lib/notes.ts`) — the Business Moments seed
Health: internal model → tri-state enum *behind* a sentence (+detail, +first_run). Notes: persisted `presence_notes`, rule-sourced today (hosting caution, publish-failed, draft-idle, freshness, first-publish celebration), grammar = title + one reason + one action + dismiss-means-gone, ≤3 active, caution>suggestion>celebration, dedupe keys make dismissal permanent per fact; **outcomes (accepted/dismissed) are recorded — they are the memory substrate** the M9 Business Consultant persona reads.

### 3.11 Media (`lib/media.ts` + `routes/media.ts`)
Private storage bucket; signed upload URLs (mime allowlist, 10 MB cap, alt text required ≥3 chars); rows in `presence_media`; variants materialized deterministically at publish; preview substitutes short-lived signed transform URLs; EXIF stripped in pipeline. Deletes: hard delete nulls FK references (offerings/posts survive).

### 3.12 Admin & lifecycle (`routes/admin.ts`, `lib/lifecycle.ts`)
Staff-only operator surface: provisioning is idempotent-with-repair (only a *first* provision walks draft→provisioning; repairs never disturb lifecycle); lifecycle draft→provisioning→ready→live→paused→archived→deleting with guarded transitions; domain ops (add/status/SSL/remove); monitoring (hosting truth from Netlify, publish stats, in-flight detection); recovery (instant restore-deploy, snapshot redeploy, retry, cancel). Runbooks in `docs/presence/RUNBOOKS.md` (incl. Netlify token rotation and the orphaned-site cleanup procedure).

### 3.13 AuthN / AuthZ / RLS / Entitlements
Supabase auth (email/password); principals resolved shared-middleware-side into client|staff; client identity → `clients` row → site via RLS. Authorization is layered: RLS (ownership) + boundary entitlement gate (product state: active/paused→readonly/absent→denied) + lifecycle guards (publish blocked states) + staff-only admin prefix. Test identities: `rcat-acceptance@example.com` (client, staging), `staging-staff@studio-os.test`. **Never** reset `edavis7143@yahoo.com`.

### 3.14 Presence Intelligence & Optimization Engine — *constitutional, not yet built*
Defined entirely by `05` (+ `06`): Intelligence thinks (through the five verbs, writing only via the Draft Writer at the client's rung); the Engine observes (read-only, evidence records); evidence flows one way; neither publishes; eleven personas behind one concierge voice; Recommendation Contract (why/evidence/benefit/effort/undoability). **No code exists** — by design. M9 builds against this map.

---

## §4 · Data flows (as implemented)

**Edit → live:**
`keystroke → debounced PUT (caller JWT, RLS) → draft tables + provenance(names) → [GET /changes → diff sentences → pill/ritual] → POST /publish → serialize draft → validate (blockers stop) → snapshot INSERT (immutable) → publish row (unique in-flight) → render → FileMap → atomic Netlify deploy → live | failed(calm) → ledger`

**Preview (any version):**
`GET /preview?version=draft → serialize now (never persisted) | ?version=live|publish_id → load retained snapshot (410 if pruned/degenerate) → render via the snapshot's own template version → wrapper (signed image URLs, internal-link postMessage shim, CSS inlined) → single HTML into the proofing desk iframe`

**Restore:**
`History row → POST /restore-to-draft {publish_id} → snapshot loaded → usability check → Draft Writer: safety snapshot → REPLACE draft (hide absentees, drop+count dead media) → provenance('restore') → client reviews draft → normal ritual. Live site untouched throughout.`

**Health/moments (Today):**
`GET /health|/changes|/notes → serialize draft + last live publish + Netlify probe → deriveHealth sentence + four facts → rule notes ensured (deduped) → ≤3 letters + prose paragraph + waiting journal`

**Future (constitutional):**
`Observation → evidence record → Intelligence judgment → recommendation (5 clauses) → human accepts → Draft Writer → draft → ritual → live` — and for Monitor, the chain stops at the recommendation, permanently.

---

## §5 · Boundaries — what belongs where, and what never does

| Subsystem | Belongs | Never |
|---|---|---|
| **Renderer** | Pure snapshot→bytes; manifest-declared everything | Network, DB, clock, randomness, arbitrary JS, client CSS |
| **Draft Writer** | Every structured mutation that isn't a client keystroke; safety-first REPLACE | Touching live; merging; accepting degenerate content |
| **Pipeline** | Sealing, rendering, atomic deploys, honest ledger | Partial updates; content edits; more than one in-flight |
| **Publishing decision** | A human (or their explicit rung-4 standing consent) | Any system, persona, or engine |
| **Optimization Engine** | Observation, evidence, internal metrics | Writing anything, anywhere; talking to customers; scores in customer language |
| **Intelligence** | Judgment, proposals, drafts via the gate, one concierge voice | Publishing; inventing facts; speaking outside the five verbs; per-persona voices |
| **Concierge surface** | Moments, letters, recommendations in merchant words | Dashboards, metrics, nagging (dedupe law), "AI" as vocabulary |
| **Monitor** | Observe + explain + recommend external sites | Any write path; editing anyone's website; implying it can |
| **Admin** | Operator truth and recovery; lifecycle; hosting ops | Client-facing exposure; bypassing the pipeline (even force-publish runs the one pipeline) |
| **Room (frontend)** | Presentation of API truth; the ritual's ceremony | Direct DB access; computing health/diff locally; rendering site HTML |
| **_shared middleware** | CORS, json, principal resolution — for all functions | Product logic |

---

## §6 · Constitution summary (00–06) — practical implications

- **00 Design Review:** ratified the deck against built architecture; the "smallest revisions" list became R1–R4 (one renderer for preview, diff at read time, region markers, preview-any-snapshot). *Implication: preview/diff behavior is design law, not implementation choice.*
- **01 Architecture Reconciliation:** restore is restore-*to-draft* (single writable surface); Draft Writer named as the shared primitive; locations became a list pre-freeze; notes feed is persisted data with outcomes-as-memory. *Implication: any new writer of content must call the Draft Writer.*
- **02 Commercial Constitution:** product catalog, feature matrix, billing architecture, content ownership (export is a right), AI commercial model, hosting posture, agency/enterprise shapes, launch strategy, **Product Laws 1–23**, master roadmap. *Implication: pricing/packaging changes are constitutional events; "price the site, never the seat."*
- **03 Final Constitution:** edition strategy + terminology freeze; the five AI verbs (permanent UI vocabulary + M9 spec boundary); template philosophy (one flagship per vertical; acceptance bar: a11y/SEO/perf/determinism/upgradeability); vertical order; marketplace policy (ecosystem of contracts, not code); API strategy (public API is Draft-Writer-shaped, webhooks notify never control); metrics; mobile; brand; vision. *Implication: a feature that doesn't fit a verb, a contract seam, or the vocabulary doesn't ship.*
- **04 Amendment 1:** three editing modes — Guided (built), Designer = manifest-declared options only (v1.5+), Developer = template authorship through review (v2); **Platform Extensions** as the fourth contract seam (behavior, never inline JS); Template Lock (Studio/Customized/Developer/Custom) with support honesty; **Laws 24–29** (AI disableable; manual equivalents; config-not-code; code-only-as-reviewed-template; upgrade honesty; developer freedom at the template layer). *Implication: no live-site code editing will ever be a feature request to honor.*
- **05 Presence Intelligence Constitution:** two systems (think/observe) separated forever; eleven personas, one host; Business Moments as the primary experience; Recommendation Contract; writing/review/editing scope classes; Engine inventory; health models behind sentences; industry pack anatomy; **Laws 30–33**. *Implication: M9's spec is already bounded — build the seams, not new concepts.*
- **06 Amendment 2:** Monitor is the entry edition of the one line; ladder Monitor→…→Enterprise with Studio OS as the surface above; **Law 34** (additive editions; upgrades preserve everything). *Implication: Monitor engineering starts from the Engine + concierge grammar, never from a write path.*

---

## §7 · Implementation history — what each milestone did and deliberately did not

| Milestone | Did | Deliberately did not |
|---|---|---|
| **M1/M1a** | Extracted `_shared` (cors/http/auth) from the clever-api monolith behind a 19-check smoke gate (suite first: M1a) | Refactor the monolith itself; change any behavior (definition of done: identical smoke before/after) |
| **M2 (+closeout)** | 14 `presence_*` tables, RLS, system-table protection (0015); ARB fixes 0016 (D1 snapshot-retention FK: publish rows survive pruning with `snapshot_id` nulled; D2 media FKs null-on-delete); probes (RLS 29, retention/media 12); 0017 grants corrective | Any service code; any UI; retention *automation* (policy only) |
| **M3** | The presence edge function: bounded context, principal→site→entitlement boundary order, exactly 3 routes (site/identity GET+PUT), provenance discipline (names only) | Generic routing, publishing, media, anything beyond the three routes |
| **M3.5** | Froze the rendering contract on paper: `render(snapshot, manifest, siteConfig)→FileMap`, purity rules, manifest-as-complete-interface, reserved seams | Code |
| **M4** | The deterministic renderer + restaurant-classic 1.0.0 (6 pages, JSON-LD, XSS-hostile-tested, perf budgets) + golden suite (28) | Multiple templates; client-visible anything; Netlify |
| **M5** | Preview + publish pipeline + media pipeline + restore (redeploy semantics) + history + **API v1 freeze**; pipeline suite (30) | Admin ops; provisioning; the client room |
| **M6** | Admin/provisioning/hosting/domain/lifecycle/recovery (15 routes, 51 checks), Netlify integration verified on a throwaway first, runbooks; found+fixed the provisioning-repair lifecycle bug | Client UX; any client-facing route change |
| **M6.5 (+FINAL)** | The constitutions (00–03) and the freeze of planning | Code of any kind |
| **M7** | The Client Room: migration 0019 (settings+notes), health/diff/Draft-Writer/notes libs, additive room routes, region markers + goldens regenerated, contract locations-fix, `presence.html` v1, portal link, room suite (38 incl. full publish→restore e2e), prod deploy; CORS Allow-Methods fix in `_shared` | AI anything; new pipeline behavior; schema beyond 0019 |
| **M7.5** | Direction A craftsmanship: same APIs, complete re-dress (statement/prose facts/letters/menu-as-menu/ritual+receipt/journal/dock), vocabulary sweep | Any backend change; any feature |
| **M8** | Trust layer: empty/loading/error/success states, a11y (focus capture/return, live regions, contrast, targets), mobile wrap rules, trust copy (atomic promise, private proof), micro-motion, perf measurements, six-chair review; **refused Presence Score per Law 13**; report | Features, AI, analytics, integrations, backend |
| **M8.5 + Amendments** | Intelligence Constitution (05), Amendment 1 earlier (04), Amendment 2 (06); planning declared complete | Implementation of any of it |

**Standing quality record:** renderer 28 · service 22 · RLS 29 · retention/media 12 · pipeline 30 · admin 51 · room 38 · clever-api smoke 15 (anon tier) — all green at the M7/M8 commits against staging + prod boundary checks.

---

## §8 · Roadmap (ratified contents only; not reprioritized here)

- **M9 — Presence Intelligence v1** (authorized): per 02 Part 12 + 05 — alt-text drafting, rewording-in-voice (Assist/Draft), rule→AI notes under the moment grammar, draft-on-request Updates, voice sample generation, the memory substrate + explainability + metering, authority rungs 1–2. Bounded by 05 §7 Class A only.
- **M9.5 — reserved.** No ratified contents exist under this number. The natural candidate per 05 is Optimization Engine v1 (evidence records, first analyzers over our own published output) as Monitor's foundation — *but that is sequencing to be ordered, not yet ordered.*
- **M10 — Destinations: GBP** — Google Business Profile projection (hours/info/posts), review/testimonial import, truthful multi-destination publish progress.
- **Unscheduled but ratified (former "M8 Add-on Launch" scope, renumbered away when M8 became the trust layer):** export right implementation, billing/entitlement ladder incl. the **courtesy card** lifecycle state, assisted content import, founders-cohort onboarding, ops hardening, fast-follows (scheduled updates, testimonial share-link). These obligations stand in 02 and must land before/with Standalone.
- **Standalone Presence (v1.5):** thin account module, self-serve trial→domain→convert, **purge mechanism** (the deferred engineering obligation), standalone billing, marketing surface. **Monitor** (per 06) is the doorway edition — engineering starts from the Engine.
- **Agency (v1.5+):** white-label tokens, wholesale licensing, fleet dashboard maturation, presets/cloning, guarded bulk ops.
- **v2:** marketplace under review governance + Developer Mode/template authorship + Platform Extensions catalog; additional destinations; rungs 3–4; multi-location UI; native apps; Enterprise pulled by demand.
- **Launch readiness gates** (03 §9 success metrics): edit→publish unaided; time-to-first-publish <15 min; publish success ≥99.5%; zero regressions; note outcomes recorded. M7 verified all five on staging.

---

## §9 · Competitive position — philosophical, not tabular

- **WordPress:** sells infinite capability and transfers infinite liability (plugins, updates, breakage). Presence's law "no plugins — an ecosystem of contracts, not code" is the direct refusal of the WordPress bargain.
- **Wix/Squarespace:** sell the owner a design job with training wheels. Presence refuses to give the owner a design job at all: presentation is studio-owned, configuration is manifest-declared, and the owner edits *facts*.
- **Webflow/Framer:** superb designer tools — the customer is the designer. Presence agrees, and therefore puts that power at the **template layer** (Amendment 1) where designers/developers actually live, keeping the owner's surface fact-shaped.
- **Shopify:** commerce core; catalog and checkout gravity. Presence's boundary law (no commerce core; brochure-retail served, transactional retail routed to partners) is deliberate non-competition.
- **Contentful/Sanity:** structured content as developer infrastructure, sold by the seat to engineering teams. Presence is the same *belief* sold as an *outcome* to owners — the schema is hidden behind a menu that edits like a menu, and "price the site, never the seat."
- **Ghost:** honest, calm publishing — the closest spiritual neighbor — but built around the author/blog identity. Presence is built around the *business fact* identity; Updates are one section, not the center.
- **SEO/marketing suites:** dashboards, scores, alarm as a business model. Law 13 and the moments-not-dashboards law are the categorical rejection: evidence is gathered like theirs, but spoken as at most three calm sentences a day, with dismissal that sticks.

---

## §10 · Product principles (the permanent short list)

One draft · one renderer · one pipeline — nothing bypasses, not AI, not agencies, not us. Structured content is the source of truth. Deterministic, atomic publishing; every version kept; restore never touches live. Health is a sentence. Moments, not dashboards. Evidence before recommendation. AI optional forever, labeled always, five verbs only, one host voice. Customers own content, domains, history; export is a right; leaving is easy. Developer freedom at the template layer, never the live-site layer; behavior only as Platform Extensions; templates pass one bar for everyone. **Zero Translation:** every editor resembles the thing it edits. Calm is the default; failure copy leads with what's safe; no scores, no gamification, no surveillance. Every law at every edition. Everything exists to make a business easier to **discover, trust, choose, and manage** — a feature that doesn't serve one of those four doesn't ship.

---

## §11 · Open questions (genuine, current, unanswered)

1. **Purge vs. permanence.** `presence_change_events` is trigger-immutable and blocks CASCADE deletes (discovered M6). The client-deletion/right-to-erasure path (Laws 1–4, GDPR-shaped) vs. append-only history needs a designed purge mechanism — scheduled for Standalone, undesigned today. What is erased, what is anonymized, what is legally retained?
2. **Snapshot retention automation.** The D1 behavior (publish rows survive pruning; `snapshot_id` nulls) is proven, but *no automated pruning job exists* — retention window, trigger cadence, and storage-cost policy are undecided.
3. **Notes source for the Engine.** `presence_notes.source` enum has no `optimization` value; M9.x needs an additive migration plus a decision on how Engine-sourced moments share the ≤3 cap with rule/AI/human sources.
4. **Push vs. poll for publish state.** The room polls `/publishes` (4s) and the server reconciles via Netlify deploy state. Netlify deploy webhooks are unwired. At what fleet size does polling stop being acceptable?
5. **Frontend dependency pinning.** `presence.html` loads supabase-js from jsDelivr with a floating `@2` tag and fonts from Google. Pinning policy, SRI hashes, and self-hosting for the product surface are undecided.
6. **Staging anon-key in the prod-served page.** The `?env=staging` switch embeds the staging anon key in the production file. Anon keys are public by design, but is the acceptance-testing convenience worth the confusion surface?
7. **Hours contract vs. UI.** The contract supports multiple intervals per day and holiday exceptions; the room edits one interval and no exceptions. UI gap only — when does it close?
8. **Voice-profile consumption contract.** `presence_voice` is stored, private, unrendered. M9 will feed it to models: the prompt-injection posture for client-authored voice text (never-claim list as hard constraint vs. soft guidance) is undefined.
9. **Media storage GC.** DB rows and FKs behave (D2 proven); the *storage-object* lifecycle for deleted media and orphaned variants has no reaper.
10. **Staging data hygiene.** Probe suites permanently leave degenerate fixtures (handled defensively at read time), and suites share the RCAT tenant with password-reset churn. A per-suite seeded tenant strategy is undecided.
11. **Monitor's observation infrastructure.** Crawling external sites (robots respect, rate limits, JS-rendered pages, verification levels) is constitutionally bounded but technically undesigned — correctly deferred to its milestone.
12. **Roadmap renumbering.** The former "M8 Add-on Launch" obligations (export, billing ladder + courtesy card, import, onboarding, ops hardening) are ratified but currently unscheduled (§8). Where do they land relative to M9/M9.5?
13. **Room/portal convergence.** The boundary contract says `presence.html` becomes the standalone shell; whether the portal eventually embeds, links, or federates the room at Standalone scale is unresolved.

---

## §12 · Risks (real ones)

**Technical.** Netlify is the single deploy destination — abstracted behind `lib/netlify.ts` and the destination-contract philosophy, but an outage or API change is a product outage (mitigation: the abstraction, runbooks, and the constitutionally planned multi-destination future). Supabase coupling is deeper (auth, RLS, storage, functions) — acceptable and chosen, but migration cost is real. Floating CDN dependencies (§11.5). Append-only tables grow monotonically (events, snapshots) — cheap for years at current scale, but unbounded without §11.1/2. The room is one hand-written file: excellent until Designer-mode-era complexity; watch its size.

**Operational.** Bus factor ≈ 1: runbooks, this atlas, and the constitutions are the mitigation — keep them current or lose them. The Netlify token was once pasted into a chat session; the rotation runbook exists and **rotation before GA is mandatory**. Staging/prod config variance is env-var-driven and documented (SECRETS-INVENTORY), but drift is a standing risk. Test-suite password churn on the shared staging tenant occasionally invalidates sessions mid-verification (annoying, not dangerous).

**Commercial.** Single-vertical concentration (restaurants) until the frozen expansion order executes. Managed care is labor until Standalone ships — the margin story depends on the courtesy-card/billing work that is ratified but unscheduled (§11.12). The premium positioning demands the copy discipline never slip — editorial excellence is a permanent operating cost, not a launch cost.

**Scaling.** Netlify per-team site limits and API rate limits at fleet size (Agency edition) — needs verification before wholesale onboarding. Edge-function cold starts are fine for a room, worth watching for Monitor's crawl cadence. The ≤3-moments cap is a *product* answer to intelligence scale — protect it when sources multiply.

**Future maintenance.** Template goldens are byte-exact: every intentional template change requires the documented regenerate-and-justify workflow — cheap discipline, expensive if skipped. The five-verbs and moment grammar will be pressured by every future feature ("just add a badge/score/panel") — the constitutions exist precisely to lose those arguments for you.

---

## §13 · Final assessment

**Internally consistent?** Yes. The audit for this atlas found no contradiction between the frozen constitutions and the built system. The two places history *risked* contradiction were both handled constitutionally: custom-JS (resolved by Platform Extensions, Amendment 1) and Monitor productization (resolved by Amendment 2). One naming wrinkle exists — executed M7.5/M8 took the "M8" slot the 02 roadmap gave to Add-on Launch — recorded in §8/§11.12 as a scheduling fact, not a contradiction.

**Strongest parts.** (1) The contract spine: render contract + manifest-as-complete-interface + golden tests — determinism is *enforced*, not aspired to. (2) The Draft Writer as the single write gate with safety-snapshot semantics — the primitive that makes AI, agencies, and restores all safe by construction. (3) The honesty grammar: CALM errors, append-only ledger, failures kept visible — trust is architectural. (4) Provenance-names-only + diff-at-read-time — auditability without privacy debt. (5) The constitutional method itself: contradictions get caught and amended, not absorbed.

**Deserves the most protection.** Renderer purity. Draft Writer exclusivity. The append-only ledger. The five verbs. Health-as-a-sentence. The ≤3-moment cap and dismiss-means-gone. The one-host voice. Additive-only API v1.

**Should never be rewritten.** The pipeline core (seal→render→deploy atomically), the content contract's spine, the RLS + boundary-entitlement layering, and the render contract signature. Extend at the declared seams (manifest, destinations, AI skills, extensions); do not reopen the spine.

**What a future engineer must understand before changing anything.** Read constitutions 00–06 first — they are load-bearing, and "it would be easy to add" is not an argument here; several easy things are constitutionally illegal on purpose. Every write path funnels through two doors (client keystroke via RLS, or Draft Writer) — keep it that way. The tests are the contract's teeth: run the relevant suite before and after, and treat a golden diff as a design event. The product's moat is restraint; the codebase is small because the *decisions* are where the value lives.

---

## Readiness

The architecture is consistent, the contracts are frozen and tested, the seams M9 needs (five verbs, Draft Writer, notes grammar with outcomes memory, voice profile, evidence-shaped health inputs) all exist and are exercised in production code, and the open questions in §11 either belong to M9's own spec (3, 8) or to later milestones (all others; none blocking).

**The platform is ready to begin M9.** M9 is not begun here.
