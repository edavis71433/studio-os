<!-- Recovered verbatim from the M6.5 session (2026-07) — the ratified text. Amendments are separate, numbered files in this directory. -->

# Presence Design Review — against the frozen architecture (M1–M6)

**Verdict up front: this design is 90% buildable on the platform exactly as it stands, and in several places it accidentally describes what we already built — but it is not ready to freeze. There are 10 revisions required first. Nine are small (copy, scoping, or a cheap schema addition). One — restore semantics — contradicts the frozen API and must be decided now, because building it as drawn would require new architecture.**

After those revisions: **Design Approved — Ready to Continue Implementation** would apply. Not before.

---

## Where the deck and the built platform already lock together

Worth stating because it means the design's core is *cheap*, not just pretty:

- **"One draft, publish is a ritual, live never changes until the button"** is literally the M5 pipeline: draft → snapshot → render → atomic deploy. The atomicity the failure card promises ("your live site is unchanged, nothing was lost") is not copywriting aspiration — it's the deployed behavior, and the deck's failure copy is almost word-for-word the API's calm message.
- **The three publish checks aren't theater** — in our architecture they're true by construction: a11y is guaranteed by the frozen renderer, alt text is a database constraint, links/assets are self-contained by contract, and "search-ready" is `validateSnapshot`. An amber check with an inline fix maps exactly to our 422 `fields[]` response.
- **"Published by Mara (concierge)"** attribution exists today (`actor_kind` on every publish); plain-English history summaries exist (`GET /publishes`); the draft pill's count derives from data we already compute.
- **"You can keep working — we'll let you know"** is the ⟐1 status-driven publish, verbatim.
- **Sections, not pages** matches G1's entity model one-to-one (Business = identity+location+voice; Offerings; FAQs; Testimonials; Updates = posts; Media).

---

## Required revisions before freeze (the smallest list)

**R1 — Restore semantics: the one real contradiction.**
The deck says *"Restore brings a version into your draft… nothing changes until you publish."* The frozen API's `POST /restore` re-publishes a retained snapshot through the pipeline — it does **not** write into the draft. Restore-into-draft would require a *reverse serializer* (snapshot → draft tables) plus a merge policy for whatever's already sitting in the draft — new architecture, new failure modes.
**Recommendation:** keep the built semantics and adjust the design: **Restore opens the same publish sheet**, showing in sentences exactly what will change, with the counted button. That delivers the design's real goal ("review before live, never silently overwrite") without a reverse serializer. Restore-into-draft can be a v2 if demand appears.
*Why: prevents future technical debt, increases trust · Phase 1 · Complexity: Low as revised (High as drawn) · Customer value: identical to intent · Technical impact: none as revised · Changes architecture: only if left as drawn.*

**R2 — Specify the change-sentence engine (and don't power it from provenance).**
The publish sheet's centerpiece is old→new sentences ("Saturday hours change from 7am–3pm to **8am–4pm**"). Our provenance trail stores field *names only, never values* — by contract (G1 §14). Sentences must come from a **diff of the current draft snapshot vs. the live snapshot**, computed when the sheet opens. This becomes one service that also powers the draft pill count and history summaries.
*Why: simplifies implementation, prevents debt (one "explain changes" engine, reused everywhere incl. future AI proposals) · Phase 1 · Medium · High customer value · Additive API route · No architecture change.*

**R3 — Emit region markers in templates now; ship preview outlines later.**
The amber "changed region" outlines that deep-link back to sections are the deck's most expensive idea: they need the rendered page to know which DOM region maps to which content entity. Retrofitting that into a live template later means a template major version. Emitting stable `data-` region attributes in the template **now** is invisible, contract-safe, and costs almost nothing; the outline overlay itself ships post-launch.
*Why: prevents an expensive retrofit · Markers: Phase 1 (build-time); outlines: later · Low now / High later if skipped · Technical impact: template minor · No architecture change.*

**R4 — Preview any snapshot through the renderer; don't iframe the live site.**
The draft/live toggle (and history "View") should render the *live snapshot* through the same `GET /preview` machinery (an additive parameter), not embed the real Netlify site in an iframe — our published sites ship security headers that may block framing, and cross-origin embedding is fragile regardless. Same renderer, one path, and it makes viewing any historical version free.
*Why: simplifies implementation, honors the one-renderer rule · Phase 1 · Low–Medium · Additive · No architecture change.*

**R5 — Decide offerings ordering in the schema before content CRUD is written.**
The menu is drag-orderable (items and sections) in the design. The content contract needs explicit `sort_order` on offerings and a per-site section order. If ordering isn't nailed down before M7's CRUD routes exist, every client and the renderer inherit ambiguity that's painful to fix later. Additive migration, same pattern as 0018.
*Why: prevents debt · Phase 1 (pre-CRUD) · Low · Technical impact: one additive migration + serializer ordering · No architecture change.*

**R6 — The upload flow must include the alt-text moment.**
"Drop photos anywhere" as drawn skips a step our platform *requires*: alt text ≥ 3 chars is a database constraint and an API 422. The a11y slide already promises "alt text prompted at upload" — the Media flow needs to actually show that one-line prompt (batchable). Also set expectations on formats: the API accepts JPEG/PNG/WebP; HEIC works on iOS mostly because Safari converts on input — say "photos from your phone just work" and let engineering handle conversion edge cases, but don't promise raw HEIC ingestion.
*Why: design/contract consistency, accessibility · Phase 1 · Low · No architecture change.*

**R7 — Scope the Domain fact to what exists.**
"Renews March 2027" and "your card will be charged" imply registrar + billing integration we don't have. M6 gives us real domain signals: connected, DNS, SSL. Phase 1 fact reads "Connected & healthy"; renewal tracking is a later feature tied to registrar management.
*Why: honesty = trust · Phase 1 copy change · Low · Registrar integration: post-launch, Medium–High.*

**R8 — Gate every Google Business Profile reference behind M10.**
"Refreshing your Google profile" (publish progress), auto-imported Google reviews, and "search demand" FAQ sourcing all assume GBP integration that is roadmapped for M10. The design needs the pre-GBP states: publish progress mentions only the website; Testimonials launches with manual entry + star curation (+ the share-link form as a fast-follow); FAQs launch with a **vertical starter-question set** shipped in the template manifest (no AI, still feels like "customers often ask").
*Why: prevents shipping promises the pipeline can't keep · Phase 1 states · Low · No architecture change.*

**R9 — Phase-tag the AI moments explicitly, with non-AI fallbacks.**
Voice-sample live rewriting, "Sounds like you ✦," search-derived FAQ suggestions, and "draft it for me" are M9. Each has a graceful Phase-1 fallback already implied by the design: canned voice samples per trait combination, starter questions, no drafting offer. One structural ask: **make ConciergeNote a persisted, dismissible data feed from day one** (rule-based: domain health from M6, holiday calendar, "been a while since an update"). That same feed *is* the future AI proposal/approval surface — provenance `ai_approved` already exists in the contract for exactly this. Designing notes as data now means M9 plugs into an existing surface instead of retrofitting one.
*Why: enables future AI capabilities cheaply · Phase 1 (rule-based feed) · Low–Medium · Additive table + routes · No architecture change.*

**R10 — Drop version screenshots from Phase 1.**
History thumbnails require headless-browser screenshotting — real infrastructure for decoration. The plain-English summary is the memory anchor; use a neutral mark for Phase 1. Screenshots can come later if ever.
*Why: simplifies implementation · Later · Low (as removed) · No architecture change.*

Minor, worth a line each: **scheduled Updates** — "now" and "with your next publish" are free in Phase 1; "on a date" is a small additive status + the platform's existing scheduler, fast-follow. **Shareable draft preview link** — new public surface (signed, expiring); post-launch. **White-label** — build the nine components on CSS design tokens from day one (the deck's own token discipline makes this nearly free now, expensive later).

---

## The checklist, item by item

| Item | Verdict |
|---|---|
| Presence Health | **Covered** — the health sentence; backed by a client-safe projection of M6's health data (additive route). |
| AI workspace / proposal review / reasoning history / approvals | **Seeded correctly** — ConciergeNote + labeled drafts are the approval surface; make notes persisted data (R9). Full workspace = M9. |
| Presence Timeline / Activity Feed | **Covered** — recent-changes list + publish history; concept 1b proves a richer timeline exists if wanted later. |
| Weekly reports / Presence Score / Benchmarking / Competitor comparison | **Deliberately absent, and rightly** — "health is a sentence, not a score" is the product's spine. A weekly *email digest* post-launch would prove value without importing anxiety. |
| Search / Command palette | **Absent, acceptable** — six sections, <100 items; keyboard shortcuts already specced. Revisit only if content scale changes. |
| Notification Center | **Deliberately absent** — the cut list ("no badges") is a feature. Concierge notes carry the load. |
| Website thumbnail / home hero | **Explored** (1c) and correctly demoted. |
| Version comparison | **Partially covered** — draft/live toggle + change sentences. Side-by-side diffing: later, powered by R2's engine. |
| Better Publish / Restore experience | **Covered** — publish is the deck's best work; restore needs R1. |
| Concierge improvements | **Covered** — the grammar (max 3, one action, human+AI share a surface) is genuinely strong. |
| Domain / SSL monitoring | **Backend done (M6)**; client-facing scope per R7. |
| SEO insights / Schema.org visibility | **Intentionally invisible to clients** — the renderer already emits full JSON-LD; "Search-ready ✓" is the right amount of exposure. Insights = post-launch, if ever. |
| Accessibility insights | **Covered structurally** — checks are real (renderer guarantees + upload constraints). |
| Mobile-first / tablet workflows | **Covered** (1h + bottom sheets); responsive covers tablet. |
| Offline considerations | **Gap, minor** — specify a graceful offline read state for mobile; PWA caching later. |
| First-run onboarding | **Covered** — and the "domain never blocks progress" note matches M6 provisioning (subdomain-first) exactly. |
| Agency / white-label readiness | **Gap, cheap now** — tokenize the palette/name (see above); tenancy already exists in the platform. |
| Multi-location readiness | **Schema-ready** (locations is already a table); design should note where location #2 lives in Business. Later. |
| Standalone CMS / standalone Presence readiness | **Covered by architecture** — the room is a client of the frozen API; nothing in the design couples it to the rest of the portal except the sidebar. |
| API readiness / public developer readiness | **Strong** — everything the design needs is additive to the frozen v1 surface. Public API = far later, unaffected. |
| Marketplace readiness | **Consistent** — no template picker (cut list), but `template_slug/version` live in the contract, so a future marketplace slots under the same renderer registry. |

---

## The six questions, explicitly

**1. Is this design ready to freeze?**
Not yet. It is one decision (R1) and nine small revisions away. Nothing structural is wrong; the recommended build (C · 1a · 1d · 1f · 1h) is the right one.

**2. What exactly should change?**
R1–R10 above. R1 is mandatory before any M7 line is written; R2, R3, R5, R9 shape data and templates and should be settled at freeze; the rest are copy/scoping.

**3. What should never change?**
- Health is a **sentence**, never a score, gauge, or percentage.
- **No edit mode.** Always-editable + autosave-to-draft, with the amber pill as the only ambient reminder.
- One draft, one preview, one counted publish button, one voice.
- **Restore never silently overwrites live** — every path to live goes through the review ritual.
- Failure copy leads with "your live site is unchanged / nothing was lost" — this is the CALM contract made visible; it must stay true and stay first.
- Concierge grammar: max three notes, one action each, dismiss means gone, human and AI share the surface, attribution always honest.
- Plain-English merchant language everywhere ("What you offer," "Kind words").
- The cut list stays cut: no analytics widgets, template pickers, settings pages, badges.

**4. What belongs in M7?**
The room shell + Home (health sentence, four facts, rule-based concierge notes, recent changes); all six sections with content CRUD (additive routes; ordering per R5); the preview stage with draft/live via the renderer (R4); the publish sheet with the diff engine (R2), progress/success/failure states; history + restore-as-ritual (R1); first-run flow; draft pill; mobile-responsive with the tab-bar model; region markers emitted (R3); components built on tokens.

**5. What belongs after launch?**
Preview change-outlines (markers already in), shareable preview links, scheduled posts ("on a date"), testimonial share-form (fast-follow) and Google review import (M10), all AI moments (M9), GBP publish steps (M10), weekly digest email, version screenshots, offline caching, registrar/renewal management, multi-location UI, native mobile apps, any search/palette.

**6. What would be extremely expensive to retrofit if not designed now?**
Five things — all cheap today: **(a)** template region markers (R3); **(b)** offerings/section ordering in the contract (R5); **(c)** the diff engine as the single "explain changes" service (R2) rather than per-screen hacks; **(d)** ConciergeNote as a persisted feed — it's the M9 AI-approval surface in disguise (R9); **(e)** design tokens for white-label. And one decision that gets expensive if deferred: **restore semantics (R1)** — every day of M7 built on the wrong assumption compounds.

---

The deck earns its recommendation: it's disciplined, honest about what it cut, and — rarely for a design produced apart from the backend — its promises are almost all things the frozen pipeline already keeps. Fix the restore contradiction, gate the not-yet-built integrations, lock the five retrofit-proofing items, and freeze it.
