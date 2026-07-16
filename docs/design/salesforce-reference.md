# Salesforce Reference — for the CRM + Client Portal redesign

*2026-07-16 · Compiled from Eric's links (each crawled tab-by-tab; salesforce.com
properties 403 direct fetch, content recovered via search extraction of the same
pages + official Help/Trailhead/SLDS docs) plus a parallel deep-research pass on
Lightning UI anatomy. Sources cited inline in the session record; this doc keeps
the actionable facts. Status: 6 of 9 link crawls landed; remaining sections
appended as they complete.*

Eric's directive: **CRM + client portal redesigned together, aggressively, to look
just like Salesforce — especially Messages.** After increment 6 completes.

---

## 1. The Lightning record page — the anatomy to copy (CRM side)

The composition grammar of every Salesforce record screen:

**record page = highlights panel (header) + Path + tabbed body (Activity / Details / Related) + activity timeline rail**

- **Highlights panel**: strip across the top — key fields (up to ~7, from the
  "compact layout") + action buttons (Edit, Log a Call, New Task, Email…).
  Inline-editable key fields.
- **Path**: horizontal chevron of stages directly under the header (leads,
  opportunities). Per-stage "Key Fields" + "Guidance for Success" text.
  "Mark Stage as Complete" button.
- **Tabbed body**: canonical tabs are *Activity*, *Details* (field sections),
  *Related* (related lists as cards — e.g. an Account's Contacts, Opportunities).
- **Activity timeline**: reverse-chronological, typed entries (email / call /
  task / event icons), grouped as **Upcoming & Overdue** then past activity by
  month; expandable rows; filter dropdown; a **composer** at top with tabs for
  Log a Call / New Task / New Event / Email. With email tracking, open/click
  engagement shows alongside emails in the timeline.
- Different roles can get different page compositions of the same data
  (pages are assignable per app/record-type/profile).

## 2. The console + list conventions (CRM side)

- **Split view** (Service/Sales console): persistent record LIST docked left of
  the workspace — triage a queue while working records. THE thing that makes an
  inbox feel organized.
- **Workspace tabs + subtabs**: each case/record opens as a tab; related records
  open as subtabs — multi-record work without losing context.
- **Three-column service record layout**: left = case + contact details;
  center = highlights + feed/interaction log; right = related lists + suggested
  knowledge.
- **Utility bar**: fixed footer dock (History, Notes, phone, macros).
- **List views**: pinned filters, inline edit, Kanban ⇄ table toggle. **Kanban**:
  cards in per-stage columns, column headers sum deal amounts, drag between
  columns changes stage, **yellow warning icon on cards with no activity in 30
  days**, side Details panel with inline-editable key fields per selected card.
- **Navigation chrome**: app launcher (grid), object tabs with dropdown recents,
  global search with typeahead recent records.

## 3. Messages — how Salesforce actually organizes them

- **On-record**: every email/call/meeting/task is a typed entry on the record's
  activity timeline (one home per customer). Email composer lives ON the record.
- **Email integration**: Gmail/Outlook sync (Einstein Activity Capture)
  auto-relates emails + events to the right contact/lead/deal — no manual
  logging. Templates; **Send Later** scheduling; **Insert Availability**
  (bookable calendar slots dropped into an email); text shortcuts.
- **Threading (Email-to-Case)**: each email = one EmailMessage under a Case;
  replies matched by threading token → In-Reply-To/References headers →
  Outlook Thread-Index; no match = new case/thread. Store those keys.
- **Chat/SMS/WhatsApp**: MessagingSession model (see §5) — sessions routed like
  work items, transcript entries within a session.
- **The two-sided loop**: a portal/case message from the customer lands as a
  first-class record → assignment rules pick a queue → routing hands it to a
  person in the console → replies land back in the customer's portal thread.

## 4. The data model (what the diagrams say)

- **Hub-and-spoke**: Account (company) is the hub; Contact → Account;
  Opportunity → Account; Case → Account+Contact. **Lead is an island** until
  conversion (converts into Contact + Account + optional Opportunity,
  reparenting its activities). *A small CRM that merges lead/contact into one
  "person" skips the whole reparenting problem — biggest available
  simplification vs Salesforce.*
- **Activities = the polymorphic glue**: Task/Event carry **WhoId** (person:
  lead|contact) + **WhatId** (thing: account|deal|case|…). Any record's
  timeline = one query over two indexed polymorphic pointers. Keep who/what
  separate.
- **Message ≠ Conversation ≠ Channel** (three levels): Channel (your address) →
  Conversation/Session (the episode — the routable, assignable work unit) →
  Entry (individual message, incl. system events). Route and report on the
  SESSION, not the message.
- **Separate identity from conversation**: MessagingEndUser pattern — a
  channel identity (this phone / this email → contact X) resolved once; every
  future inbound auto-links. Per-conversation links to a deal/ticket live on
  the session, not the identity.
- **Junctions where roles matter**: person↔deal (OpportunityContactRole),
  person↔campaign (CampaignMember), person↔account secondary affiliations.
- **Portal = a sharing filter over the SAME records, not a second schema**:
  "my cases" = cases where contact_id = viewer; public/private flag suppresses
  internal-only entries in the customer view.

## 5. The client portal — Salesforce's Customer Account Portal anatomy

- **Global chrome**: brand header, global search (records + knowledge),
  nav menu, **notification bell** (in-app; instant/daily/weekly email prefs),
  profile menu (profile page, notification settings, logout).
- **Home = a tile launcher, not a marketing page**: large visual tiles to the
  key destinations (Orders/Projects, Invoices, Support, Knowledge, Profile) +
  personalized snapshots (open cases, recent orders, unpaid invoices).
- **Member Profile hub**: all account info + settings in one place — contact
  details (edits write back to the CRM record), email/notification preferences;
  B2B: team members with role-based permissions.
- **Lists-with-status everywhere**: orders/cases/invoices as status-tracked
  lists → detail pages; the case detail carries the **conversation thread**
  with the vendor (customer-visible entries only) + attachments.
- **Deflection-first support**: while the customer types a case, suggested
  articles/answers interpose BEFORE submission; then form (minimal fields —
  subject/description; identity auto-set), confirmation + case number,
  status tracking in "My Cases".
- **Portal templates Salesforce ships**: Customer Account Portal (account
  self-service: invoices, account info, cases, knowledge, tile menu),
  Customer Service (community/knowledge-flavored + case deflection),
  Partner Central (leads/deal registration), Build Your Own. All edited in a
  drag-and-drop builder with branding + audience targeting.
- Embedded chat (Messaging for In-App & Web) with pre-chat form and
  verified-user context available as a page component.

## 6. Small-business packaging signals (Starter Suite)

- Starter Suite ($25/u/mo) = ONE simplified app across sales+service+
  marketing, not per-cloud apps. Emphasis: **Home with recommended action
  cards**, a **Guidance Center** (header panel: guided setup checklist,
  import data, invite users), prebuilt paths/reports/dashboards/templates,
  email builder + brandable templates, AI activity capture, payment portal.
- Opinionated defaults over configuration — the SMB translation of the
  enterprise machinery. (Forecasting, flows/approvals, API = higher tiers.)
- **The signature "looks like Salesforce" elements** a user recognizes:
  the chevron Path, the activity timeline with composer, the highlights
  panel, related-list cards, split-view console lists, Kanban pipeline,
  the bell + global search chrome.

## 7. Multi-tenant/roles patterns worth borrowing

- Permissions are **additive-only** layers (baseline → sharing rules →
  permission sets): a higher layer can only OPEN access, never restrict what
  a lower layer granted. Clean mental model for portal tiers.
- Portal identity = a User backed by a Contact; tenant-scoped visibility
  (a client can see "their" account manager; optionally teammates on the
  same account).

---

## 8. Additional anatomy (salesforceben walkthrough crawl)

- **Home page** (the CRM's landing surface): a quarterly performance chart
  (progress toward goal), an **Assistant** (an action list of things to do
  today), recent records, configurable dashboard/report cards. SMB Starter
  adds recommended-action cards + a guided-setup Guidance Center.
- **App Launcher**: waffle/grid icon at the far left of the nav; overlay to
  browse/search all apps and switch context.
- **List views**: pinned views, inline cell editing, a slide-out filter panel
  on the right, and an optional chart panel summarizing the list.
- **Case Feed** (console center column): one chronological compiled feed of
  call logs, texts, emails, and status changes, with the reply composer
  ("publisher") at top — the service twin of the activity timeline.
- **Experience Builder page model**: a page = theme regions (header, footer,
  nav menu, search, profile menu) wrapping a content area of drag-in
  components (record lists, record detail, case-create form, article search,
  CMS blocks). **Audiences** show/hide components per user group; **branding
  sets** can re-theme per audience — maps directly onto our per-plan/persona
  portal rendering.
- **Terminology owners recognize**: Lead → Convert → Contact + Account (+
  Opportunity); Pipeline/Stage; Case; Activity (task/call/event); List view;
  Record page; Knowledge article; Dashboard/Report; Portal.

---

## 9. Working-level detail (s2-labs tutorial-series crawl)

- **List-view screen controls** (the browse surface): view-name dropdown +
  pin-as-default, gear menu (create/clone/share views, choose columns),
  slide-out FILTER panel, slide-out CHART panel (list → totals/percentages),
  display switcher table ⇄ Kanban ⇄ split view, inline cell editing
  (pencil = editable, lock = not), New button.
- **Stage History**: changing Stage/Amount/Probability/Close Date appends to a
  built-in audit related list — the deal's paper trail as UI.
- **Reports**: Tabular (flat), Summary (grouped subtotals — the workhorse),
  Matrix (rows × columns), Joined. **Dashboards**: up to 20 components fed by
  Summary/Matrix reports, explicit Refresh (as-of-last-run data).
- **Case intake**: Email-to-Case, Web-to-Case (site form → case), phone;
  assignment rules route to QUEUES (shared inboxes of unassigned records);
  auto-response acknowledgment emails; SLA escalation. Case requireds:
  Status (New/Working/Escalated/Closed), Origin, Priority.
- **Home components** (composable per role): performance chart, Assistant
  (up to 10 prioritized "needs attention" items), Key Deals mini-list,
  Today's Tasks/Events, Recent Records.
- **Compact layout reuse**: the same key-field strip powers the desktop
  highlights panel, mobile record cards, and hover preview cards.
- Chrome extras: favorites star (bookmark any record/list/report),
  notifications bell, gear → Setup, avatar menu.
- **Chatter is internal-only** discussion on a record, deliberately separate
  from the customer-facing activity timeline — matches our internal-notes
  vs client-visible split.

---

*Pending sections: the official Customer Account Portal pages help-doc family
and the SLDS/Lightning deep-research synthesis. Appended on completion.
Companion doc: docs/design/crm-portal-inventory.md (our own code, mapped).*
