# Phase C — CRM Expansion & Operational Workspace

*Discovery-first implementation. Studio OS's CRM is an **operational relationship hub**, not a sales CRM. It aggregates what the platform already records into one calm per-client view, plus one new capability (relationship notes). Nothing was built to mimic a competitor; features that failed the test were rejected or deferred with reasons.*

---

## Step 1 — Discovery

**What already exists.** There was **no CRM**. Relationship signals were scattered across surfaces the studio had to hop between:

| Signal | Where it lived |
|---|---|
| Content & publish activity | `presence_change_events`, `presence_publishes` (the room) |
| Connected services + health | `presence_connections`, `presence_connection_events` (connections.html) |
| Intelligence | `presence_moments` (today.html) |
| Pending approvals | `presence_infra_plans`, `presence_connection_writes` (foundations/connections) |
| People with access | `presence_site_members` (sharing.html) |
| Roster + tags | `presence_agency_clients` (agency.html) |
| Ownership/export | `/export`; audit via change events |

The gap was never *missing data* — it was **no single relationship lens** over it. So the CRM's job is aggregation, not a new datastore.

**What each audience needs (and the honest answer).**
- **Freelancer / Agency:** one place per client to see health, what's happened, what's pending, and to keep private notes and shared notes. ✅ the core of what was built.
- **Business owner (the client):** a calm "your account" view — is my site live, what changed, what's waiting on me — without studio-internal chatter. ✅ served by the shared-audience view.
- **Enterprise:** the same per-location relationship view, inheriting the existing Organization→Region→Location model — no separate CRM. ✅ compatible (reads per-site; org rollups already exist in the agency/enterprise surfaces).
- **What should never become CRM:** deal pipelines, lead scoring, sales forecasting, marketing automation, task management as a productivity app. These serve a *sales* motion Studio OS deliberately isn't. Rejected.

**Competitor review — why people use them, and can we serve the need better as Calm Software:**

| Product | The real job people hire it for | Our answer |
|---|---|---|
| HubSpot / Salesforce | Sales pipeline + marketing automation | **Reject** — not our purpose. We serve *service relationships*, not a sales funnel. |
| HighLevel | Agencies running many client accounts from one place | **Serve better** — portfolio + per-client relationship hub, calm and without the sprawl. |
| Zoho / Freshworks / Copper | All-in-one contact + activity history | **Serve partially** — the relationship *activity history* is exactly the timeline; contact-as-lead-record is not our model. |
| Monday / ClickUp | Task/project management | **Reject** — task apps conflict with the calm ethos; our "tasks" are approvals + moments, already surfaced. |
| Pipedrive | Visual deal pipeline | **Reject** — sales pipeline, not our purpose. |

**Conclusion:** the only CRM that fits Studio OS is a **Client Relationship Center** — a per-client aggregation of existing signals (profile, unified timeline, calm health, pending approvals, connected/moments, summary) + **relationship notes** (internal/shared). Everything else is rejected or deferred.

---

## Step 2 — Feature review (Build / Merge / Reject / Future — with *why*)

| Capability | Decision | Why |
|---|---|---|
| Client Timeline / Activity Feed / Interaction History | **Build** | The centerpiece connective tissue — unifies existing events into one calm feed. New value, zero duplication. |
| Customer/Client Profile | **Build** | Aggregates identity, edition, status, members, connected, moments, approvals. |
| Client Health | **Build** | Calm word from existing signals (Law 13 — never a score). |
| Internal Notes | **Build** | Genuine gap: the studio had nowhere to keep private relationship notes. |
| Shared Notes | **Build** | Two-way trust: a note the client can see; respects the audience boundary. |
| Relationship / AI Summary | **Build (deterministic)** | Plain-language summary from aggregated signals — always available, no score, no AI cost/gating. AI-enhancement deferred (FD-C1). |
| Approvals in CRM | **Merge** | Surfaces existing pending plans/writes; the decision still happens in the approval flow. |
| Connected Services in CRM | **Merge** | Surfaces existing connection health; management stays in connections.html. |
| Business Moments in CRM | **Merge** | Surfaces existing moments; the engine is unchanged. |
| Export / Audit | **Merge** | Reuses `/export`; the timeline *is* the human-facing audit view. |
| Tags | **Merge** | Already on `presence_agency_clients`; surfaced, not re-modeled. |
| Notifications | **Future** | Real notify system = FD-3 (notify-to-approve) + FD-8 (global chrome). CRM surfaces "needs attention" instead of a new inbox. |
| Business Reports (dashboards) | **Reject** | A9 rejected dashboards (Law 13). The relationship view is the report. Digest = FD-5. |
| Tasks | **Reject** | A9 rejected a task surface (FD-14); a to-do app conflicts with calm. Our tasks are approvals + moments. |
| Opportunities / Pipelines / Deals | **Reject** | Sales CRM; not Studio OS's purpose (explicit). |
| Custom Fields | **Reject / Future** | Generic-CRM mimicry; conflicts with structured content. Deferred (FD-C2) only if a real need appears. |
| Workspace Personalization / Saved Views | **Reject** | A9 rejected personalization; conflicts with one-cohesive-platform + calm. |
| Universal Search / Command Palette | **Future** | Merged into "global chrome" (FD-8). |
| Customer Success Center / Support Console / Audit Center / Operator Dashboard | **Future** | Merged into "operator console" (FD-9). The CRM per-client view is the operational unit those consoles will list. |
| Lead Capture / Forms / Bookings / Quote Requests / File Uploads | **Defer (FD-2)** | These are the *client business's* inbound from *their* visitors — a Business-OS capability with a different audience, not the studio↔client hub. Substantial; own milestone. Will *feed* the CRM timeline when built. |
| Files (relationship docs) | **Future (FD-C3)** | Sharing contracts/briefs is a small real gap; deferred to keep scope tight. |

---

## Step 3 — Operational workflow review

Every core workflow now has a natural home and flows together:

- **New client / Invite client / Share workspace / Assign permissions** → agency.html + sharing.html (A7/A7.2), unchanged; the CRM reads members/roster.
- **Client Portal / Approvals / Comments** → client.html (A7.2); CRM surfaces the *same* pending approvals and shared notes.
- **Publishing / Preview / Versioning / Rollback / Restore** → the room + Developer Mode (Phase B/B1); CRM timeline shows every publish/restore.
- **Connected Platform / Business Moments / AI** → connections.html / today.html; CRM aggregates their state and links back in context (no duplication).
- **Support / Billing** → existing surfaces; CRM links out (billing not re-modeled).
- **Developer Mode** → Phase B/B1; a dev customization publish shows in the CRM timeline like any change.

The relationship view **connects** these surfaces; it never replaces them. Each "Open in context" link opens the real surface.

---

## Step 4 — What was implemented

**One new table, one aggregation lens, zero duplication.**

- **`presence_relationship_notes`** (migration 0048) — internal/shared notes, soft-delete, deny-all RLS.
- **`crm/contract.ts`** (pure) — timeline normalizers per source, the audience rule, merge/sort/cap, calm health derivation, the plain-language summary, note validation.
- **`crm/store.ts`** — async aggregators over existing tables (publishes, change events, connection events, moments, infra plans, connection writes) + notes CRUD.
- **`routes/crm.ts`** — `/crm/profile`, `/crm/timeline`, `/crm/notes` (+ pin/delete). Audience = studio (operator + agency) vs client (business owner on their own account), via existing principal/agency signals.
- **`crm.html`** — the Client Relationship Center: profile + calm health chip + summary, quick facts, relationship notes (internal/shared), unified activity timeline, and "Open in context" doorways. Doorways added from today.html and agency.html.

**Respects, unchanged:** permissions, visibility, approval, audit, versioning, tenant isolation, navigation model (reached via doorways — a formal `buildNav` entry is intentionally deferred to honor this milestone's "do not modify navigation" fence; see Recommendations).

---

## Integration verification

| Integrates with | How | Duplicates? |
|---|---|---|
| CMS / Publishing / Preview / Versioning / Rollback / Restore | Timeline shows every publish/restore; doorway to the room | No |
| AI / Business Moments | Surfaces active moments + counts | No (engine untouched) |
| Connected Platform | Connected count + needs-attention in profile & timeline | No (management in connections.html) |
| Developer Mode | A dev-layer publish appears as a publish event | No |
| Client Portal | Shares the same pending approvals + shared notes | No |
| Agency | Roster in agency.html → per-client CRM detail | No (complementary) |
| Enterprise | Per-site reads; org rollups already exist | No |
| Admin Tool | Operator reaches the CRM as studio-side | No |
| Commerce | Links out to billing | No |

Nothing feels disconnected: the CRM is the connective tissue *between* these, not a parallel silo.

---

## Workflow optimization

- **Clicks / screens:** the studio previously visited 4–5 surfaces to understand a client; the CRM collapses that to **one** screen (health + activity + pending + notes), with one-click doorways to act.
- **Decisions:** "what needs attention" is answered by the health chip + pending count + needs-a-look connected count — no hunting.
- **Discoverability:** the timeline makes history legible in plain language (it doubles as the human-facing audit).
- **Automation without breaking approval-first:** the summary and health are computed, but **nothing acts automatically** — every change still flows through approval. No auto-anything was added.
- **Merges:** approvals, moments, connected health, and export are *surfaced* here rather than re-built — the merge is the point.

---

## Verify

- **Permissions / visibility:** reviewer boundary already refuses `/crm/*`; internal items gated to studio side; `deriveClientHealth`/summary carry no score (Law 13). **Invariants 14/14.**
- **Security / isolation:** deny-all RLS on the new table; svc reads are site-scoped; audience enforced server-side; sanitized note bodies.
- **Regression:** crm 24/24, dev_render 21/21, devmode 41/41, render 28/28, workspace 38/38, `deno check` clean; **live staging** room 38/38 + pipeline 30/30. Deployed staging+prod; smoke: catalog 200, `/crm/*` 401 gated.
- **Browser:** self-contained, theme-aware, #5b3fa0; the authed browser round-trip is the one human-QA step.
- **Performance:** the profile is 6 count-queries in parallel; the timeline is 7 capped queries in parallel — no N+1, all bounded.

---

## Feature discovery additions (documented, not built)

- **FD-C1 · AI-enhanced relationship summary** — optionally let Concierge draft the summary/next-best-step (on the AI spine, approval-safe). *Medium.*
- **FD-C2 · Structured relationship fields** — only if a real need appears (renewal date, primary contact) — as typed fields, never free-form custom fields. *Low; watch for generic-CRM drift.*
- **FD-C3 · Shared relationship files** — attach a contract/brief to the relationship (studio↔client). Pairs with FD-20 brand assets. *Medium.*
- **FD-C4 · Formal CRM nav entry** — add "Relationship" to `buildNav` when the "don't modify navigation" fence lifts (currently a doorway). *Low.*
- **FD-C5 · Agency-wide relationship roll-up** — a portfolio health board (reuses the agency portfolio + CRM health). *Medium.*
- (Lead Capture / Forms / Bookings = **FD-2**, still the top Business-OS gap — a different audience, its own milestone.)

---

## Final Questions (answered honestly)

- **Does the CRM feel like part of Studio OS?** **Yes** — same brand, auth, calm voice; it reads existing data and opens existing surfaces. It's a lens, not a bolt-on.
- **Does it improve daily operations?** **Yes** — one screen replaces 4–5 for "how is this client and what's pending."
- **Does it duplicate anything?** **No** — one new table (notes); everything else aggregates. Management still happens in the real surfaces.
- **Is it calm?** **Yes** — a word and a sentence, no scores, no dashboards, no task-app pressure.
- **Is it simple?** **Yes** — profile, notes, activity, doorways. Nothing to configure.
- **Would freelancers love it?** **Yes** — private notes + a clear per-client picture is exactly their gap.
- **Would agencies love it?** **Yes** — the roster (agency) → relationship (CRM) drill-in completes the operating system.
- **Would small businesses actually use it?** **Some** — the "your account" view is genuinely useful (is my site live, what's waiting on me); it's calm enough not to be a chore. It's more valuable to the studio than to a solo owner, honestly.
- **Would enterprises accept it?** **Yes for the relationship view** — it inherits the existing org/location model. Enterprise *procurement* still wants SSO/SOC2/SLA (unchanged from A9), which are separate from the CRM.
- **Would you remove anything?** **No** — the build is deliberately minimal; there's nothing extra to cut.
- **Would you merge anything?** Already done — approvals, moments, connected, export are surfaced, not rebuilt. The next merge is the operator-console consolidation (FD-9), future.
- **Is the CRM now complete?** **Complete as the operational relationship hub it should be** — profile, timeline, health, notes, and integration are done and live. It is *not* a generic CRM and never will be. The honest open edges are all deferred-by-design: AI-drafted summary (FD-C1), shared files (FD-C3), a formal nav entry (FD-C4), and lead capture (FD-2, a Business-OS capability with a different audience). None is missing connective tissue in the relationship hub; each is additive.

---

**Phase C — CRM Expansion complete.**
