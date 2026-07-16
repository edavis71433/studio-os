# CRM + Client Portal — Salesforce-Style Redesign Spec

*2026-07-16 · Draft for Eric's review. Inputs: docs/design/salesforce-reference.md
(§1–§11, incl. the verified SLDS component anatomy) + docs/design/crm-portal-inventory.md
(current-state code audit, parts 1–3).*

**Eric's directive:** "Be very aggressive on the redesign. Especially the messages.
I wanted to look just like salesforce." Scope: **the CRM AND the client portal,
redesigned together.** The Jul-14/15 parity work (record page + tabs, highlights
strip, merged message thread, activity logging, to-dos 0107/0108, global search,
AR view) is the floor, not the target.

---

## 0. The shape of the redesign in one paragraph

Every people-screen becomes one of three Lightning surfaces: a **record page**
(highlights panel · left detail column · right activity timeline · one composer),
a **console list** (list views with columns/sort/filter, Kanban with a Path
chevron for deals), or a **split-view inbox** (list pane with unread dots ·
reading pane · docked composer). Messages stop being a chat-bubble wall and
become the Salesforce **activity timeline**: type-colored icons on a vertical
connector line, expandable rows ("You emailed Lea Chan…" → From/To/Body inline),
Upcoming & Overdue above Past, filter chips, and ONE multi-action composer
(Email · Log call · Task · Note) on the record itself. The client portal keeps
its six friendly tabs but adopts the same anatomy: context-bar nav, related-list
cards, a real activity timeline on each project, and a split-view Messages tab.

---

## 1. Design language

Lightning **anatomy**, dds **skin**. We copy Salesforce's layout grammar,
component anatomy, state machines, and labels (verified in salesforce-reference
§11 down to state classes and ARIA contracts) — rendered in the existing
workspace brand tokens (`--dds-*` from shell.css; the builder's slice-A theme
contract is the precedent). Concretely:

- Chevron Path, timeline connector lines, unread dots, docked composer,
  highlights tiles: Salesforce geometry, dds colors (plum where Lightning uses
  brand blue; the four activity-type colors become four dds-sanctioned hues
  that survive both themes).
- Record pages move from the current 940px single column to the Lightning
  **three-region layout**: full-width highlights header, ~60% left column
  (details / related cards), ~40% right rail (activity timeline + composer).
  Collapses to one column ≤1000px, timeline first.
- Type scale, radii, and shadows stay dds — this is Salesforce organization,
  not a Salesforce clone screenshot. **(Decision D2 below if Eric wants it
  more literal.)**

---

## 2. CRM side — screen by screen

### 2.1 Client Record (`crm.html`) → the Lightning record page

The centerpiece. Today: narrow column, five tabs, two of them iframes, two
competing timelines, composer fragments scattered across three pages.

**New anatomy (top → bottom):**

1. **Record header + highlights panel** — object icon, record name, status
   chip; a row of 5–7 key-fact tiles (Deal value · Stage · Outstanding ·
   Next step · Health · Website), each tile a label-over-value, inline-editable
   where the fact is a real field. This upgrades the existing 4-fact strip.
2. **Path** (when the record has an open deal) — the chevron stage bar rides
   directly under the highlights, with **"Mark Stage as Complete"** on the
   right and the coaching panel (Key Fields This Stage · Guidance for Success —
   content from the existing `PIPELINE_GUIDANCE` map, which also fixes the
   `pipeline.html:694` `suggested_action`/`action` latent bug).
3. **Two-region body:**
   - **Left (~60%): tabbed detail** — `Details · Deal · Delivery · Files` as
     related-list **cards**, not iframes. Deal card = value/close/next-step +
     proposals/agreement/invoice rows with status chips (each row links to the
     full pipeline drawer for heavy editing — the money machinery does NOT get
     rebuilt, it gets framed). Delivery card = milestones/tasks/deliverables
     summary linking into projects.html. Details card = contact facts + custom
     fields with inline edit (exists today).
   - **Right (~40%): THE activity timeline** — one merged, filterable timeline
     replacing both the Overview "Activity" merge and the Messages chat.
     Anatomy per salesforce-reference §11.1–11.2: type-colored connector line,
     white-ring icons, actor lines ("You emailed…", "Client replied…"),
     right-aligned timestamp + overflow, **expandable rows** (email rows expand
     to From/To/Body; support rows to the thread; booking rows to the slot).
     **Upcoming & Overdue** band (open to-dos, next steps, unpaid invoices) on
     top, then Past grouped by month. Filter chips: All · Messages · Emails ·
     Calls · Tasks · System.
4. **The composer** — one publisher, tabs `Message · Email · Log call · Task ·
   Note`, pinned above the timeline (record-page variant of the docked
   composer). "Message" posts to the existing project/support reply routes;
   "Email" is gated on D1; Log call/Task/Note post to the existing
   `/sales/deals/:id/activity|tasks` and `/crm/notes` routes — the point is
   they finally live where the conversation is read. Saved replies get an
   Insert-template button here (they exist today with no composer).

**Backend for 2.1:** one new read route `GET /crm/activity?client…` that merges
what `/crm/timeline` + `/crm/messages` + deal timelines each partially merge
today (same best-effort-per-channel doctrine, one contract; the old routes stay
until the UI is off them). Write routes already exist. No schema change
required for the read-time version — see D4 for the persisted upgrade.

### 2.2 Customers + Contacts rosters → list views

Today: flat card feeds with one search box. New: a real **list-view header**
(salesforce-reference §11.3): object icon + view name dropdown (`All customers ·
Active · Needs attention · Waiting on client`), "N items · Updated just now",
sort header, refresh; **table rows** with sortable columns (Name · Company ·
Open deals $ · Outstanding · Last contacted · Status) and inline-editable
status; a display toggle **Table ⇄ Cards** (cards = today's look, kept for
warmth). Contacts gets the same header + columns (Name · Company · Email ·
Phone · Deals). Saved custom views and bulk actions are **out of scope v1**
(D3). Leads keeps its card feed (it's a triage queue, not a roster) but gets
the list-view header + status columns treatment in v2.

### 2.3 Pipeline → Path + board polish

The board exists (columns, totals, guarded transitions, stalled badges). Adds:
the **Path chevron** replacing the "Move stage" button stack in the deal
drawer (with won/lost terminal states + check icons on completed stages, and
the coaching panel), the `suggested_action` bug fix, a **Board ⇄ Table** toggle
on the list side (table = sortable columns Deal · Contact · Stage · Value ·
Next step · Last contacted), and the drawer header restyled as a compact record
header (title + inline-editable stage/value/close). The deal drawer's money
sections are already excellent — they get the related-list card visual
treatment, not a rebuild.

### 2.4 Inbox → the split-view console

The aggressive one. Today: a one-column feed that navigates away per item.
New (salesforce-reference §11.3 Split View):

- **Left list pane** (collapsible, ~24rem): two-line rows — client name + when;
  preview + status chip — with **unread dot indicators** (`needs_reply` exists
  in the feed today), list header with view dropdown (`Everything · Messages ·
  Needs your OK · Enquiries · Support queue`), count + sort.
- **Right reading pane**: selecting a row loads the conversation **in place** —
  the same timeline + composer components as the record page (scoped to that
  client), with a "Open full record →" link. Approvals/enquiries render their
  card + inline Approve / Not yet / → Deal actions in the pane.
- Support triage becomes visible state: status chip (open / in progress /
  resolved) is changeable from the reading pane (routes exist:
  `/support/:id` PATCH).
- Mobile (<760px): the panes stack — list first, pane pushes in; same
  components.
- The one-column "toolkit" extras (Saved replies, FAQ editor) move into an
  overflow menu in the list-pane header.

### 2.5 Navigation chrome (shell.js)

The dropdown-sections top bar becomes a Lightning **context bar**: waffle-style
app launcher popover (all destinations, replacing the burger's mega-list) ·
app name · flat object tabs (Home · Inbox · Customers · Pipeline · Website ·
Files…) each with a dropdown caret listing **recent records** (⌘K's `/crm/search`
recents, localStorage-cached) + quick actions (+ New deal, + Contact). Global
search stays in the center pill. Bell/help/profile unchanged. Mobile bottom
bar unchanged.

---

## 3. Client portal side (`client.html`)

Same anatomy, friendlier voice. The six tabs stay (Home · Messages · Files ·
Invoices · Requests · Help) — they map 1:1 to Salesforce's Customer Account
Portal standard pages (reference §5/§10) and clients know them.

1. **Context-bar nav** — the top rail becomes the same context-bar component
   (studio's logo/name as the "app", tabs as items). Mobile bottom tabs stay.
2. **Home** — "Needs you" becomes a proper **queue card** with unread dots and
   per-item actions (it already has inline approve); project cards become
   **related-list cards** with a mini progress Path (milestones as chevrons —
   done/current/upcoming, read-only). Moments stay.
3. **Messages → split view.** List pane = every conversation (general thread +
   per-project + support requests) as two-line rows with unread dots and
   status chips; reading pane = the thread rendered as a **timeline** (same
   component, client palette) + composer. Reviewer persona: panes render
   read-only, composer hidden (the server boundary already enforces this).
4. **Project drill-in → record page.** Header + highlights tiles (% complete ·
   things waiting on you · target date · files shared), milestone **Path**
   (read-only chevrons replacing the vertical timeline), left column = the
   existing sections as cards (Approvals with decided history, To-dos, Files +
   upload, Survey), right rail = the project's client-visible **activity
   timeline** (events already exist in `presence_project_events`) + composer.
5. **Files / Invoices / Requests / Help** — restyled as list-view cards with
   the standard header treatment; no structural change. Case/support rows get
   honest status chips everywhere.

Persona guardrails (from the inventory): every new surface must degrade for
`client_reviewer` (403 on all `/client/*`) — panes render from `/portal/feed`
only, composers hidden; and all client reads stay bridge-verified. No new
routes for the portal beyond what 2.1's timeline route provides.

---

## 4. Messages, aggressively (the heart of the directive)

Today there are 12 channels, three thread systems, five composer locations, no
per-conversation unread, and no inbound email. Target ("just like Salesforce"):

1. **One timeline per record** (2.1) — every channel lands in ONE filterable,
   expandable timeline; bubbles survive only inside expanded support-thread
   rows where a back-and-forth is genuinely a chat.
2. **One publisher** — Message · Email · Log call · Task · Note, on the record
   and in both split-view inboxes. Saved replies wired in as templates.
3. **Split-view inboxes on both sides** (2.4, 3.3) with unread dots.
4. **Per-conversation unread** — new tiny table `presence_thread_reads`
   (reader key + thread key + last_seen_at; same reader-key idioms as
   `presence_activity_reads`) so rows can show real unread dots instead of
   section-level heuristics. RLS-on, policy-less, function-mediated (constraint
   §5.1 of the inventory).
5. **Inbound email capture — THE headline decision (D1).** Verified: outbound
   only today; a client's email reply never enters the system (the timeline's
   "email" is a hand-typed note). Salesforce's EmailMessage-on-the-timeline is
   the single feature Eric's "especially the messages" most implies. Plan if
   approved: Resend Inbound webhook → new pre-auth route (HMAC-verified
   svix signature) → match sender to client/contact by email → append to the
   support/project thread → timeline row `kind:'email_in'` + unread + bell.
   Needs from Eric: a Resend Inbound domain/config step (~15 min in the Resend
   dashboard) once the route ships.

---

## 5. Backend work summary

| Item | What | Schema? |
|---|---|---|
| Unified timeline read | `GET /crm/activity` (+ client-visible variant for the portal) merging the existing channel reads under one contract | none |
| Per-thread unread | `presence_thread_reads` | 1 small migration |
| Inbound email (D1) | Resend Inbound webhook route + email→identity match | 1 small migration (message store column/kind) |
| Path data | none — stages, guidance, transitions all exist | none |
| List views | none — rosters already return the fields; sort/filter is client-side v1 | none |
| Persisted activity spine (D4, later) | `who_id/what_id` unified activity table; the event-ledger shape is already standardized | deferred |

Everything respects the inventory's constraints: deny-all RLS + function
mediation, site_id scoping + bridge, signed-token doors untouched, one-log-
derived-views doctrine (the timeline stays a projection), deploy-order
tolerance, `detail.from='client'` audience invariant.

---

## 6. Decisions for Eric

- **D1 — Inbound email capture** (build the Resend Inbound webhook so client
  email replies land in the timeline/inbox?). Recommended: YES — it's the
  biggest single step toward "messages just like Salesforce". Needs a one-time
  Resend dashboard step from you when it ships.
- **D2 — How literal the look?** Recommended: Lightning anatomy in dds brand
  (spec as written). Alternative: SLDS-literal blue/gray palette for maximum
  "looks like Salesforce" recognition.
- **D3 — List-view depth v1.** Recommended: columns + sort + filter chips +
  view dropdown with fixed views. Deferred: user-saved views, bulk select,
  inline edit beyond status.
- **D4 — Persist the activity spine?** Recommended: not in this redesign —
  read-time merge under one route now; the `who_id/what_id` migration is its
  own later project.
- **D5 — Portal Messages split view on mobile**: stacked panes (recommended)
  vs keeping the current simple list.

## 7. Slice plan (each: adversarial review → gates → before/after screenshots → Eric approves → merge)

1. **Slice 1 — the record page** (crm.html three-region layout, highlights,
   Path, related cards replacing iframes, unified timeline + composer; the
   `GET /crm/activity` route). The centerpiece and the style-setter.
2. **Slice 2 — studio Inbox split view** (+ `presence_thread_reads` unread).
3. **Slice 3 — rosters & pipeline** (list views, Board⇄Table, Path in the deal
   drawer, guidance bug fix).
4. **Slice 4 — portal**: context bar + Home cards + project record page.
5. **Slice 5 — portal Messages split view** (shares slice-2 components).
6. **Slice 6 — inbound email** (if D1 approved; can run parallel to 4–5).
7. **Slice 7 — nav context bar** (both shells) + polish sweep.

Mockups accompany this spec as pictures (record page · studio inbox · portal
project page) so the layout choices are visual, not prose.
