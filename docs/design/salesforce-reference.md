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

## 10. Customer Account Portal — the official page/component inventory

*(Help-doc family crawl. Direct fetches were bot-blocked; page table is
high-confidence reconstruction cross-checked against verified fragments —
flagged where not live-verified.)*

**Shipped pages** (the template's page menu): Home (Tile Menu + optional Hero,
Search or CTA type) · **Account Management** (the signature page — hosts the
Member Profile component: "all their account information and settings in one
convenient place") · Contact Support (case form with deflection) · Record
List / Record Detail / Related Record List / Create Record (generic
object pages — My Cases, Orders, Invoices all render through these) ·
Article Detail + Topic Detail (knowledge) · Search results · Feed
Detail/Messages · User Profile + User Settings · Error · the Login family
(Login, Register, Forgot Password — brandable to match).

**Verified components**:
- **Tile Menu** — the hallmark: a nav menu rendered as image tiles; each tile
  can target a site page, a Salesforce OBJECT (cases, orders, contracts,
  dashboards, tasks…), an external URL, or a global action.
- **Member Profile** — consolidated account info + settings, configurable tabs.
- **User Profile Menu** — avatar dropdown: go to profile, OPEN A CASE, locale
  & email-notification settings, log out.
- Mobile profile page collapses to four tabs: Feed / Cases / Details / Related.

**Branding controls**: theme panel (fonts/colors/images; header+hero+footer as
shared theme regions), **Branding Sets assignable per audience** (different
look per customer segment), page variations per audience, prebuilt themes,
CSS escape hatch, brandable login pages.

**Positioning** (Salesforce's own words): "a secure and completely private
place for your customers" — see and pay invoices, update account info, search
knowledge; login-based, record-centric, "structured self-service and account
transparency." The discussions-first sibling is the Customer Service template;
CAP is account-first — the closer match to our portal.

---

*Pending: the SLDS/Lightning deep-research synthesis (running) and the
backend data-model inventory (running). Companion doc:
docs/design/crm-portal-inventory.md (our own code, mapped).*

## 11. SLDS component anatomy — deep-research synthesis (verified, 2026-07-16)

Deep-research pass (100 agents: fan-out search → fetch → 3-vote adversarial
verification per claim; 25 claims survived, 0 refuted). Evidence is the official
SLDS blueprints themselves — salesforce-ux/design-system GitHub + versioned npm
tarballs — corroborated by help.salesforce.com/Trailhead. This is the exact,
buildable anatomy for the five signature Lightning surfaces.

### 11.1 Activity Timeline (→ Customers/Deals record history, on-record Messages)
- Exactly FOUR activity types: **task, call (log_a_call), email, event** — each
  with a type-colored vertical connector line (design token per type) and a
  matching object icon with a white border ring sitting ON the line.
- Rows are **expandable** (`slds-timeline__item_expandable` / `__item_details` /
  `slds-is-open`, aria-expanded/aria-hidden contract; title can be the toggle).
- Right-aligned actions container per row: timestamp (`10:00am | 3/23/17`) + a
  "More Options" overflow menu. Natural-language actor lines: "You logged a call
  with Adam Chan", "You emailed Lea Chan", "You created an event with Aida Lee
  and 5 others".
- Designed for TWO widths: full main-page area OR the narrow right sidebar (the
  "timeline in the right rail" record layout).
- **Email threads inline**: the expanded email row renders From Address / To
  Address / Text Body fields inside the timeline row (help.salesforce.com
  corroborates: "The Text Body field on sent emails always appears in the
  details section"). Event rows expand to Location + Attendees ("Jason Dewar
  (Organizer) + 5 others").
- xx-small utility-icon status badges on rows: Has attachments · Group email ·
  Recurring Task · Public sharing.

### 11.2 Path — the pipeline chevron (→ Deals)
- Horizontal chevron steps (`slds-path__item`) with generated state classes
  `slds-is-{current|active|complete|incomplete}` plus dedicated terminal
  **won**/**lost** states; complete stages get an x-small check inside the chevron.
- Right side: "Stage: {name}" label + a brand-colored **"Mark Status as
  Complete"** button that flips to **"Mark as Current Stage"** when a non-current
  stage is selected.
- A trigger expands the coaching panel (`slds-path__coach`) with exactly two
  sections: **"Key Fields This Stage"** (with Edit) + **"Guidance for Success"**.
- A11y: with coaching = tabset semantics; without = horizontal listbox with
  arrow-key movement.

### 11.3 Split View (→ the Inbox / console screens)
- Purpose (verbatim): "navigate between records in a list while staying on the
  same screen" — list pane + reading/workspace pane.
- Four canonical states are FIRST-CLASS: Selected Item · Overflow · **Unread
  Items** · **Collapsed Panel**. Unread rows: dot indicator
  (`abbr.slds-indicator_unread`, "Unread Item") + `slds-is-unread` row class.
  Collapse toggle flips between "Open Split View"/"Close Split View".
- List-pane header checklist: object icon + list-view name as dropdown button
  ("My Leads ▾") · meta line "42 items • Updated just now" · More Actions ·
  display-toggle · Refresh · sort header ("Sorted by: Lead Score - Descending").
- Rows: compact TWO-LINE entries, four truncated fields (name+score /
  company+status), demoed at 20rem pane width; ARIA listbox where clicking an
  option opens the record in a workspace tab (option gets aria-selected).

### 11.4 Docked Composer (→ Gmail-style compose in Messages/Inbox)
- Persistent, pinned bottom-right (`position:fixed; bottom:0; right:0`);
  expands (`slds-is-open`, 480px) / collapses to bar height. Header + body +
  footer + toolbar regions. States: Open/Focused · Closed · Closed/Focused ·
  Popped out · With overflow menu.
- Three documented examples matching the record-page composer actions:
  **Log a task**, **Email Composer** (To/Cc/Bcc combobox · "Enter Subject" ·
  "Compose Email..." rich-text body · Attach File + Insert Template toolbar ·
  brand Send button in the footer), **Voice** (ten call states incl. Ringing,
  Connected, No Answer, Call Logged).
- Multiple composers dock side-by-side; overflow pill with numeric count when
  they exceed viewport width; header pop-out promotes to a full modal.

### 11.5 Global Navigation (→ app chrome)
- Context bar, mandated order: **primary region** (App Launcher waffle + App
  Name) then **secondary region** (object tabs). Tabs are text link OR text
  link + dropdown-caret button (the per-tab recents/actions menu).
- The App Launcher is explicitly CLICK-invoked (the one nav element that never
  opens on hover).
- Console workspace tabs have SEVEN feedback states: active · unsaved · unread ·
  warning · error · success · pinned — with aria-live announcements for the
  notification states ("New activity in Tab: Chat - Customer").

### 11.6 Signature-element priority (what reads as "Salesforce" at a glance)
1. Path chevron + Mark-Complete + coaching panel (Deals).
2. Right-rail activity timeline: type-colored icons on a connector line,
   expandable rows, "You emailed…" actor lines (Customers, record Messages).
3. Split View with unread dots + collapsible list pane (Inbox).
4. Bottom Docked Composer (email/tasks/calls).
5. Context bar: waffle + app name + object tabs with carets.

### 11.7 Caveats / gaps (for the spec to fill from §1–§10 instead)
- NOT verified by this pass (no surviving claims): the record-page highlights
  panel + Activity/Chatter/Details/Related tab set (covered in §1 from the link
  crawls), "Upcoming & Overdue" vs month-grouped timeline sections + filter
  dropdown, Messaging Sessions chat UI, Kanban↔table toggle, global search
  typeahead, the notes/history/phone utility bar.
- Evidence is component blueprints + docs text, not product screenshots — it
  nails ANATOMY, not default record-page composition.
- Version-scoped: timeline anatomy from SLDS 2.6.1 (component now named
  "Timeline" on current site, same anatomy on master), Split View from Winter
  '20 (2.10.x), Path from Spring '20 (2.11.6).

## §12 Reports & Dashboards (slice-8 research pass, 2026-07-17)

*Method matches §10–§11: salesforce.com help/Trailhead pages 403 direct fetch —
facts recovered via search extraction of those pages; SLDS specifics verified
directly from the salesforce-ux/design-system repo (blueprint SCSS + token YAML
+ docs.mdx). UNVERIFIED flags inline.*

### 12.1 Dashboard page anatomy
- **Page = header (name + actions + "As of" stamp) + optional filter bar +
  12-column grid of card-chrome widgets, each fed by exactly one source
  report.**
- Header actions: **Refresh** (any viewer), **Subscribe**, Edit, overflow
  (Save As/Clone/Delete). Refresh model is EXPLICIT STALENESS: "dashboards show
  data from the last refresh, not real-time"; the "As of" timestamp sits next
  to Refresh. (Exact label copy UNVERIFIED.)
- Subscribe = scheduled refresh + emailed HTML snapshot (Daily/Weekly/Monthly;
  max 5 per user; dashboard filters never applied to the emailed copy).
- Grid: dashboard property = **12 columns (default) or 9**, full width either
  way; drag body to move, corners to resize. (Row-height unit UNVERIFIED.)
- Widget chrome: three text props — **Title, Subtitle, Footer** — plus the
  **"View Report" link** which opens the source report WITH current dashboard
  filters applied (Winter '18 RN). Placement bottom-of-card (exact corner
  UNVERIFIED).
- Limits: ~20 chart/table components per dashboard; ≤1,000 groupings rendered
  per component. Theme + palette are DASHBOARD-level (14 palettes; Wildflowers
  default, Mineral = color-blind-safe); never per-component.

### 12.2 Widget canon (type → verified purpose)
- **Metric**: "highlight a single value… total closed opportunities for a
  month, number of new leads" — source report's grand total as a big number
  under the title; conditional highlighting (breakpoints color the number).
  (SLDS v1 "Metric Display" type scale UNVERIFIED — page 403.)
- **Gauge**: "how far you are from reaching a goal" — semicircular arc with
  colored segment ranges; Show Percentage / Show Total; dynamic variants read
  target from a report value. Meaningless without a goal number.
- **Donut**: "proportion of each grouping against the total, but also the
  total amount itself" — the total renders in the hole. Legend side is fixed
  per type (not configurable in Lightning; default side UNVERIFIED).
- **Funnel**: "ordered set… ideal to show the stages of your opportunities" —
  THE pipeline-by-stage widget, stages top-to-bottom in stage order.
- **Bar/column**: explicit group axis + measure axis; "Max Values Displayed"
  caps groups; axis range Automatic or custom min/max. Line: date grouping,
  cumulative variant.
- **Lightning table**: ≤200 records × ≤10 columns, any field from the source
  report type; conditional highlighting; subtotals on first-level groups.
- **Color assignment**: palette colors are assigned to groupings sequentially
  IN SORT ORDER — a color is a palette index, not a semantic choice.

### 12.3 Dashboard filters
- ≤3 filters per dashboard, ≤50 values each; a row of dropdowns under the
  header applying to EVERY widget via per-report field mapping.
- Lightning dashboards ALWAYS OPEN UNFILTERED — a filter is a session choice,
  not saved state. View Report carries active filters into the report run.
- Exclusions: no formula/bucket fields; joined-report charts unfilterable.

### 12.4 Report run page (for a future "report view" slice)
- Header = summary-metrics strip ("up to 8 metrics, in report order").
- Toolbar: chart toggle · slide-out filter panel (chip → edit → Apply) ·
  Refresh · Edit · menu (Clone/Save/Subscribe/Export).
- Column-header sort; column menu offers group/summarize/bucket in place.
- Summary format: group header rows + per-group subtotal row + grand total;
  footer toggle bar = Row Count / Detail Rows / Subtotals / Grand Total.

### 12.5 SLDS specifics worth copying (repo-verified)
- **Card chrome**: 1px solid border (border-base), radius 0.25rem, white bg;
  base CARD_SHADOW none but the oneSalesforce theme overrides to
  `0 2px 2px 0 rgba(0,0,0,.10)` — flat border + ONE subtle hard shadow.
  Title 0.875rem, bold in the Lightning theme, flex row (icon+title+actions).
  Footer 0.8125rem behind a thin top border — exactly the "View Report" strip.
- **Chart color LOGIC** (guidelines): midtone hues around the wheel, adjacent
  sequential entries ~180° apart; ONE COLOR = ONE MEANING across every chart
  on the page; categorical palettes ≈5 entries; ordinal data in linear order.
  → dds: one ordered categorical ramp from tokens, indexed by sort order;
  stage colors identical to pipeline.html's Kanban.
- **Empty state** = Illustration pattern: aria-hidden SVG + REQUIRED heading +
  optional body + ≤2 CTAs (base 300×200). **Loading** = stencils: only when
  >300ms, gray layout-shaped blocks, no control placeholders, cross-fade to
  data with no white flash.

### 12.6 Copy vs skip (v1 assessment)
COPY: header grammar (title + "As of" + Refresh) · 12-col grid of flat
bordered cards with View-report footers · widget canon (metric row, funnel,
donut-with-total, bar, line, one table) · one global filter bar (date range)
opening unfiltered · stencils + illustration empty states · color discipline.
SKIP v1: Subscribe/email snapshots, dashboard builder, palette picker,
dynamic gauges, scatter, matrix/joined reports, per-widget filter mapping.
REPORT VIEW: dashboard-only is Salesforce-faithful for v1 PROVIDED every
widget's "View report" footer deep-links to the real run page (pipeline.html,
leads.html, inbox.html, customers.html) carrying the active date filter; a
true grouped-table report page is a clean later slice, not a v1 requirement.
