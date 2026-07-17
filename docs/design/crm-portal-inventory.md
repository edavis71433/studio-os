# CRM + Client Portal — Current-State Code Inventory

*2026-07-16 · Read-only audit feeding the Salesforce-style redesign spec.
Companion: docs/design/salesforce-reference.md (the target). All three parts complete.*

---

# PART 1 — STUDIO-SIDE CRM

All reading is complete. Here is the full inventory.

---

# Studio-side CRM surface inventory — pre-redesign baseline (read-only audit, 2026-07-16)

Scope: `customers.html`, `crm.html`, `leads.html`, `contacts.html`, `pipeline.html`, `inbox.html`, plus `shell.js` chrome and the CRM docs. All paths absolute under `/home/user/studio-os/`. All pages are single-file HTML with inline CSS + inline vanilla JS calling the Supabase edge function at `…/functions/v1/presence` with headers `Authorization: Bearer <anon key>`, `x-dds-user-jwt`, `x-dds-scope-site` (the `?client=` drill-in scope; see `shell.js:75-87`).

Navigation (server-driven, `supabase/functions/presence/lib/navigation.ts:87-94,115`): the primary-bar **Customers** group = Customers (`/customers.html`) · Enquiries (`/leads.html`) · Contacts (`/contacts.html`) · Pipeline (`/pipeline.html`) · Broadcasts; **Inbox** is its own top-level single item. `crm.html` is never in the nav — it is reached only by opening a record (roster, contacts, leads, inbox rows, ⌘K results).

---

## 1. Screens and their regions (top → bottom)

### 1a. Customers roster — `customers.html` (125 lines)
Entry point for the client record.
- **H1 + count subtitle** (`customers.html:83`), **search input** (live filter by name/email, `:84`).
- **Customer cards** (`:89-99`): initial avatar, name, email, project count, right-aligned badge `N waiting` (open support count) or `all clear`, a status pill (active/complete/on_hold/archived), and two actions: **Open** → `/crm.html?client=<site>&tab=delivery` (or `?client_id=` / `?project=` fallbacks, `openCustomer` `:68-76`) and **Manage their website** → `/today.html?client=<site>` (`:78`) — the record vs. the website cockpit are deliberately split.
- No list views, no columns, no sort — a flat card list with one search box.

### 1b. Unified Client Record — `crm.html` (358 lines; the Jul-14 "one relationship, one page")
`/crm/record` resolves whatever key the URL carries (`?client=`/`?client_id=`/`?deal=`/`?contact=`/`?project=`) into a canonical identity + available tabs (`crm.html:117-174`); converted customers get canonically re-addressed to `?client=<site>` with a one-hop `location.replace` (`:160-169`).
- **Back link** "← Customers" (`:192`).
- **Record header** (`renderShell` `:176-201`): serif H1 name; sub-row = status chip (**Customer**/**Prospect**) + company · mailto email · tel phone.
- **Highlights strip** (explicitly "the Salesforce highlights panel", `:184-190`): up to 4 pinned facts as small cards — *Deal value · Stage · Outstanding · Next step*, from `REC.highlights`.
- **Tab bar** (`:198`), order `Overview · Messages · Deal · Delivery · Details` (`:141-142`); server decides which exist per record (`REC.sections`); tab state lives in `?tab=` via `history.replaceState` (`:203`).
- **Overview tab** (`loadOverview`/`renderOverview` `:222-269`): health chip (Healthy / Needs attention / Getting set up / Quiet) + plain-language summary → **facts grid** (Website live/published, Approvals waiting, Connected services, Moments, Team) → conditional "Email the client to approve" card → **Notes** section (textarea composer with an Internal ⇄ Shared-with-client segmented audience toggle, note cards with audience pill + pin/remove) → **Activity** timeline (dot-and-line vertical timeline; event kinds publish/approval/note/connected/moment with per-kind dot colors `:75-82`, icon map `:138`, relative "when" wording).
- **Messages tab** — see §2.
- **Deal tab** (`:218`): a same-origin **iframe** of `/pipeline.html?deal=<id>&embed=1`. **Delivery tab** (`:219`): iframe of `/projects.html?project=<id>&embed=1`. Embeds run *unscoped* on purpose (deal rows live on the operator's own agency site, comment `:213-216`). Embedded pages postMessage back (`dds-deal-converted` / `dds-open-delivery`) so a convert reveals + switches to Delivery on the same record ("Won stays put", `:342-350`; sender in `pipeline.html:210,971`).
- **Details tab** (`:271-305`): contact facts key/value card (from `/sales/contacts/:id`) with inline **Edit** (PATCH), the owner's ≤5 custom fields, and a read-only list of the contact's deals (title · stage · last-contacted).
- Empty/edge states: picker ("Open a client to see their record"), signed-out, 403, retry (`:338-340`).

### 1c. Website enquiries (leads) — `leads.html` (149 lines)
- Rolebadge + H1 "Website enquiries" with `N new ·` subtitle (`leads.html:80-81`).
- **Filter chips**: Open / New (count) / All (`:82-86`).
- **Lead cards** (`:88-101`): who + relative when; kind tag (Quote request / Booking request / Message); mailto/tel contact line; message body; **action row** — `Reply` (a *mailto:* link prefilled with "Re: your quote request", greeting, and the quoted message, `replyHref` `:104-112`; replying auto-marks read `:118`), `→ Deal` (promotes the enquiry: creates contact + deal with `source_submission_id`, then jumps to `/crm.html?deal=<id>&tab=deal`, `createDeal` `:126-142`) or `✓ In pipeline — view deal` once converted, `Mark read`, `Archive`.
- No detail view — the card *is* the record. One-time hint: "Replying marks it handled" (`:60`).

### 1d. Contacts — `contacts.html` (495 lines)
- Rolebadge + H1 + count; **toolbar**: search, **+ Add a customer** (provision-or-connect dialog, `:124-156, 257-325`), **+ Contact** (dialog `:110-123`), **Import CSV** (inline parser/preview/chunked POSTs `:326-384`).
- **Contact cards** (`:192-201`): name, company, mailto/tel, actions `Email`/`Call` + `→ New deal` (creates a deal then navigates to `/crm.html?deal=<id>&tab=deal`, `:386-397`).
- **Opening a card navigates to the Client Record Details tab** — `openDetail(id)` is now just `location.href='/crm.html?contact=<id>&tab=details'` (`:405-409`). A large legacy in-dialog detail/edit/custom-fields implementation remains below it (`renderDetailView`… `:410-483`) — dead-ish code kept for the fields editor.
- **Custom field definitions** dialog (≤5 fields: text/number/date/choice, `:158-166, 467-483`); **duplicate detection** dialog on create (server fuzzy match, "Add as new anyway", `:239-256`).

### 1e. Pipeline — `pipeline.html` (992 lines; also the Deal tab's embed)
Two top-level panels swapped in place: `#listWrap` and full-screen `#detailWrap` (`:157-171`).
- **H1 + subtitle** → **summary strip** ("your numbers": Open $ across N deals · Won this month · Win rate, per-stage mini-cells, and the **AR line** — see §3) (`renderSummary` `:361-384`).
- **Stage filter chips** (All + 6 stages) (`:355-359`) → **+ New deal** button + **List ⇄ Board toggle** (`:162`).
- **List view** (`:440-448`): deal cards sorted by next-step due date (overdue first), each with title, source · expected close, "Due:/Next:" line, "Last contacted X ago", stage badge, value.
- **Board view** (Kanban, `:451-515`): columns = open stages only (`lead/qualified/proposal/contract`, `:246`), each with count + per-column $ total + a one-line guidance tip; cards show title · value · due/last-contacted · a **⏳ Stalled** badge at 30+ days no contact; movement via a tap-to-move menu (primary) or drag-drop, both constrained by `BOARD_NEXT` transitions mirroring server `canTransition` (`:250-252`) — `won` is convert-only.
- **Full-screen deal detail** (`openDeal` `:610-978`), sections in order: backbar → header (title, contact, stage badge, invoice status inline, last contacted) → **Move stage** (Path guidance tip + one primary forward button, quiet back buttons, separated "Mark as lost" with optional reason) → **Details** (value, expected close, next step + date, notes w/ draft preservation) → **To-dos** (§3) → **Proposals** (multi-line editor w/ services catalog dropdown, discount/tax, versioned Revise, viewed/expiry chips, send/copy-link/print/save-as-template) → **Agreement** (starter plain-language contract auto-draft `:311-353`, send-for-signature, signed chip, renewal-date reminder) → **Invoice & deposit** (single invoice, deposit, payment-schedule builder w/ preview) → **Retainer** (recurring Stripe authorization) → **Convert to customer** (gated on signed agreement; edition picker; postMessage to parent record when embedded) → **Activity** (quick-log + merged timeline — §2) → Delete.
- **Embed mode** (`?embed=1`, `:12-20, 206-210`): hides shell chrome + list + backbar; intercepts `/projects.html` links → postMessage `dds-open-delivery`.

### 1f. Inbox — `inbox.html` (306 lines)
One scrolling column (max-width 680px), sections in a fixed order (`render` `:108-194`):
1. **Header** "Inbox" + "Everything that needs you…" / all-clear banner.
2. **Messages** (`:135-159`) — grouped **one row per client** (#181): avatar initials, client name, when, preview ("Support: <subject>" / "Sent you a message" / "You replied — waiting on them"), a `Reply` badge or unread-count badge; sorted needs-reply-first. Each row opens `/crm.html?client_id=<id>&tab=messages` — a known client's conversation always opens on their Client Record (`:153-155`).
3. **Needs your OK** (`:161-173`) — approvals; infra/connected ones have **inline Approve / Not yet** buttons posting to `decide_path` (`:189-193`); file approvals link out.
4. **New enquiries** (`:175-177`) — new leads, linking to `/leads.html`.
5. **Project activity** (`:179-180`) — the studio's own worklog notifications (support/client messages filtered *out*, `:124`); read items stay visible but dimmed.
6. **Worth a look** (`:182-185`) — notices + moments.
7. **Your support toolkit** (`:195-292`) — two owner tools opened in modal sheets: **Saved replies** (canned answers CRUD) and **Customer FAQ** (portal-visible Q&A).
- Opening the inbox marks notifications read/clears the bell (`:301`).

### 1g. Shell chrome — `shell.js` (950 lines)
- Top bar: waffle App Launcher · brand (or scoped breadcrumb "Studio › {client}", `:157-161`) · dropdown nav sections · **Search ⌘K** pill · bell (badge = `attention_count` from `/portal/context`) · help (?) · profile menu (`render` `:134-176`). Mobile bottom bar: Home · Inbox (badge) · Menu (`:180-201`).
- **Command palette / global search** (`:233-299`): filters nav destinations locally; when the query ≥2 chars *and* the nav has a customers section (`hasCrm()` `:299`), it additionally fans out to **`GET /crm/search?q=`** (records) and `GET /assets?q=` (files) — explicitly "the Salesforce global-search pattern" (`:272-274`) — merging record rows (label + sub "Record") and file rows into the same listbox.
- Bell popover reuses `/portal/feed` (notices, approvals, moments) and footers into the Inbox (`:304-337`).
- Scope carry (`withScope`, `carryScopeGlobally` `:520-543`) rewrites every app link (incl. `/crm|contacts|pipeline|leads|inbox`) to keep `?client=`.

---

## 2. Messaging surfaces in detail

There are **three distinct messaging surfaces** plus mailto:

**A. The Client Record Messages tab (`crm.html:307-336`) — "ONE conversation with this client (Salesforce activity model)".**
- Data: `GET /crm/messages?project=<id>&client_id=<id>`. Server (`supabase/functions/presence/routes/crm.ts:95-104`) merges chronologically: project/general messages across ALL linked projects + support tickets/replies + the original website enquiry + bookings + logged calls/emails/meetings + email broadcasts, each best-effort per channel.
- Rendering: chat bubbles — client left (`bubble.client`), studio right (`bubble.studio`, accent-tinted) (`crm.html:41-50, 327-330`). Every item is channel-tagged via a header line (`headFor` `:317-324`): 🎫 support (+ uppercase status chip), 🌐 website enquiry, 📅 booking, 📣 broadcast, and for `kind==='activity'` the `ACT_TAG` map (`:316`): 📞 Logged call, ✉️ Logged email, 🤝 Meeting, 📝 Note, 📄 Proposal sent, ✍️ Contract sent, 🧾 Invoice sent. Footer: "You/Client · 3 days ago".
- **One reply box** (`:331-335`): posts to `reply_to` (= `POST /projects/:id/messages` with `{body, audience:'client'}`) when a project exists, else to `reply_support_to` (newest open support thread) (server `crm.ts:201`). If neither: "Replies open once this client has a project or an open support thread." No rich text, no attachments, no internal-comment mode in this composer (internal notes live on the Overview tab instead).
- Bubbles are display-only — no per-message actions, threading, or read receipts.

**B. Inbox Messages section (`inbox.html:135-159`)** — the cross-client "who's waiting" summary: `feed.client_messages` grouped per client, needs-reply first, each row deep-linking into surface A. Support requests and client messages are deliberately excluded from the "Project activity" list (`:118-124`) so they only appear here, first-class.

**C. Logged activities (calls/emails/meetings/notes)** — authored in the **pipeline deal detail quick-log** (`pipeline.html:724-730, 745-750`): kind chips 📞/✉️/🤝/📝, optional body, back-datable date, `POST /sales/deals/:id/activity`; they feed the deal's merged timeline (manual activities interleaved with system events: created, stage moves, proposal/contract/invoice events — `EVT_LABEL` `:254-263`), update "last contacted" everywhere, and surface again as `activity` bubbles in surface A. Also mirrored read-only on the contact detail data and the Client Record Details tab.

**Unread/notification handling:** no per-thread unread counts on the record itself. The bell badge = `/portal/context.attention_count`; the Inbox computes newness per section and `POST /notifications/read` on open (`inbox.html:301`); leads have their own new/read/archived status (`/forms/inbox/:id`); inbox message rows carry `needs_reply`/count badges. Web-push opt-in lives in the profile menu (`shell.js:456-494`).

**Outbound gaps by construction:** replying to a *lead* is `mailto:` (leaves the product, no record beyond auto-mark-read); Saved replies exist as an editor (`inbox.html:228-257`) but no composer inserts them; broadcasts are a separate page.

## 3. Deal / pipeline anatomy

- **Stages** (`pipeline.html:221-231`): enum `lead → qualified → proposal → contract → won | lost`, human labels "New lead / Qualified / Proposal sent / Agreement out / Won ✓ / Not a fit"; `contract`+signed renders "Agreement signed ✓". Transitions: forward one, back one, →lost; **won is convert-only** (`BOARD_NEXT` `:250`, server re-checks). Stage changes via detail-view buttons (`:735`), board move menu, or drag (`wireBoard:484-515`) — all `POST /sales/deals/:id/stage` (optional `reason` on lost).
- **Per-stage Path guidance** (`PIPELINE_GUIDANCE` `:235-243`): a tip + suggested next action shown in the detail header and as column tips. (Note: the detail view reads `g.suggested_action` at `:694` while the map defines `action` — the drawer's "do" text renders `undefined`-ish; a latent bug worth fixing in the redesign.)
- **To-dos (#203, migration 0108)**: table `presence_deal_tasks` (id/site/deal/title/due_date/status open|done/completed_at/deleted_at, `docs/presence/APPLY-0107-0108-prod.sql:27-45` — explicitly "Salesforce Activities parity", kept separate from post-sale project tasks). UI: "To-dos" section in deal detail (`pipeline.html:706-707, 388-396`): checkbox rows with due date (overdue highlighted), add row, ✕ delete; routes `GET/POST /sales/deals/:id/tasks`, `PATCH /sales/deal-tasks/:id`. Deals with due next-steps float to the top of the list view (`:438-441`).
- **Proposal tracking (#205, migration 0107)**: `first_viewed_at` ("👁 Opened 2 days ago" / "Not opened yet") + `expires_at` ("Expires …/⏳ Expired") chips on each proposal row (`:649-654`).
- **AR / who-owes-you**: the summary strip's 💰 line — Outstanding $ across N invoices · overdue $ (red) · "see who →" (`:378-383`) — opens **Receivables** in the same full-screen panel (`openReceivables` `:397-409`): rows of invoice title/amount/deal/due/overdue with "Open deal" jump; data `GET /sales/receivables`. Deal-level echo: an open/paid invoice chip in the deal header (`:692`).
- **Money machinery** hanging off the deal: proposals (line items from a services catalog, discount/tax meta, versions/supersede), agreements (starter text, e-sign links, renewal reminders), invoices + deposits + payment schedules (`/sales/deals/:id/schedule`), retainers (Stripe recurring), convert-to-customer (creates portal/workspace + project; edition picker; "Won stays put" postMessage).

## 4. What already matches Salesforce vs. structurally different

**Already there (the Jul-14/15 "floor" — `docs/presence/OPEN-PUNCHLIST.md:106-121` confirms these were built as Salesforce-parity and are explicitly the floor, not the target):**
- **Record page with tabs** and canonical record resolution from any key (`crm.html:117-174`).
- **Highlights panel** — the pinned key-facts strip, named as such (`crm.html:184-190`).
- **Single activity thread per record** merging every channel, each item channel-tagged (`crm.html:307`, `routes/crm.ts:95`) — the Salesforce activity-timeline model.
- **Activity logging** (call/email/meeting/note, backdatable) + merged system/manual timeline on deals (`pipeline.html:679-687`).
- **Deal to-dos with due dates** (0108) and **proposal open-tracking/expiry** (0107).
- **Global search across records + files** in ⌘K (`shell.js:272-291`, `/crm/search`).
- **Kanban pipeline with guarded stage transitions**, per-column totals, stalled-deal flags; **receivables view**; contact custom fields; duplicate detection; CSV import.

**Structurally different from Salesforce:**
- **No object/list-view layer**: rosters are flat card lists with one search box — no columns, sorting, filters, saved views, or bulk actions (`customers.html`, `contacts.html`; deliberate per `docs/presence/COMPETITIVE-NOCODE-PASS.md:31-32`).
- **Deal & Delivery tabs are iframes** of whole other pages rather than components of the record (`crm.html:218-219`) — visual style, spacing, and chrome differ inside the frame; the record page itself is a narrow 940px column, not a Lightning 3-region (highlights / left detail / right activity) layout.
- **Messages render as a chat** (bubbles + one composer) rather than a Salesforce activity timeline with per-item expanders, filters (Calls/Emails/Tasks), and "Upcoming & overdue" vs "Past" grouping; logged activities are composed on a *different page* (pipeline) from where they're read (record).
- **The activity timeline on Overview and the message thread on Messages are two separate merges** (`/crm/timeline` vs `/crm/messages`) — Salesforce has one timeline per record.
- Health word + plain-language summary instead of scores/dashboards; docs frame the CRM as "a lens, not a datastore" (`docs/presence/CRM-GUIDE.md:9`) — the sales objects (deals/contacts) were added later (P2-C) around that older aggregation core, which is why the record is stitched from `/crm/*` + `/sales/*` + embeds.
- Two inboxes of truth: bell popover vs Inbox page (intentional: bell = glance, Inbox = complete, `shell.js:327-334`); no console-style split-pane inbox.

## 5. Data routes per screen

| Screen | Routes (all `…/functions/v1/presence` + method) |
|---|---|
| **customers.html** | `GET /studio/customers` (`:115`) |
| **crm.html** | `GET /crm/record?client\|client_id\|deal\|contact\|project` (`:157`) · `GET /crm/profile`, `GET /crm/timeline`, `GET /crm/notes` (`:224`) · `POST /crm/notes`, `POST /crm/notes/:id/pin`, `DELETE /crm/notes/:id` (`:267-269`) · `POST /approve/send` (`:265`) · `GET /crm/messages?project&client_id` (`:312`) · reply: `POST /projects/:id/messages` or `POST` to `reply_support_to` (`:335`) · `GET /sales/contacts/:id`, `PATCH /sales/contacts/:id` (`:275,302`) |
| **inbox.html** | `GET /portal/feed`, `GET /forms/inbox`, `GET /notifications?limit=25` (`:296`) · `POST /notifications/read` (`:301`) · `POST <decide_path>` inline approvals (`:191`) · `GET/PUT /service/saved-replies` (`:233,251`) · `GET/PUT /service/faq` (`:265,286`) |
| **leads.html** | `GET /forms/inbox` (`:145`) · `POST /forms/inbox/:id` status (`:122`) · `POST /sales/contacts`, `POST /sales/deals` on promote (`:133-134`) |
| **contacts.html** | `GET /sales/contacts?limit=500` (`:487`) · `POST /sales/contacts` (+`dedupe_check`) (`:242`) · `PATCH /sales/contacts/:id` (`:463`) · `GET/PUT /sales/contacts/fields` (`:404,479`) · `POST /sales/customers` (provision/connect) (`:297`) · `POST /sales/deals` (`:391`) |
| **pipeline.html** | `GET /sales/deals[?stage]` (`:434`) · `GET /sales/summary` (`:368`) · `GET /sales/receivables` (`:402`) · `GET /sales/deals/:id` (`:617`) · `PATCH/DELETE /sales/deals/:id` (`:741,739`) · `POST /sales/deals/:id/stage` (`:735`) · to-dos: `GET/POST /sales/deals/:id/tasks`, `PATCH /sales/deal-tasks/:id` (`:390-395,744`) · `POST /sales/deals/:id/activity` (`:750`) · proposals: `POST /sales/deals/:id/proposals`, `POST /sales/proposals/:id/revise`, `POST /sales/proposals/:id/send` (`:840,756`) · contracts: `POST /sales/deals/:id/contracts`, `POST /sales/contracts/:id/send`, `POST /sales/contracts/:id/term` (`:858,757,916`) · docs: `GET /sales/{proposals\|contracts\|invoices}/:id/document` (`:767`) · money: `POST /sales/deals/:id/invoice`, `POST /sales/invoices/:id/send`, `POST /sales/deals/:id/schedule`, `POST /sales/deals/:id/retainer[+/cancel]` (`:887,925,954,912-913`) · `POST /sales/deals/:id/convert`, `POST /sales/deals/:id/resend-invite` (`:967,974`) · `GET/PUT /sales/services`, `GET /sales/templates`, `POST /sales/templates`, `DELETE /sales/templates/:id` (`:580-591,617,878-881`) · `GET /identity` (`:295`) · `POST /sales/contacts` (`:530`) |
| **shell.js** | `GET /portal/context` (`:875`) · `GET /portal/feed` (bell, `:310`) · `GET /crm/search?q`, `GET /assets?q` (⌘K, `:279-280`) · `POST /help/ask` (`:383`) · `/push/key`, `/push/subscribe`, `/push/unsubscribe` (`:474-487`) |

## 6. Biggest gaps vs. a Salesforce record page / console inbox (code-only observations)

1. **No unified record-page layout.** Salesforce Lightning is highlights panel + left detail column + right activity/chronology composer, all one surface. Here the record is a narrow single column, and its two heaviest tabs (Deal, Delivery) are iframes of foreign pages with their own headers, buttons, and spacing — the seams are visible and interactions (e.g. activity quick-log) live inside the frame instead of on the record.
2. **Two competing timelines.** `/crm/timeline` (Overview "Activity") and `/crm/messages` (Messages thread) are separate merges of overlapping data, plus a third merged timeline per deal in pipeline detail. Salesforce has one activity timeline per record with filters. There is no filtering, no expand/collapse, no upcoming-vs-past split, no "next steps" band.
3. **Composer fragmentation.** Log-a-call lives on the pipeline page; reply-to-client lives on the Messages tab; internal notes live on Overview; lead replies are `mailto:`. Salesforce puts one multi-action publisher (Email / Log call / Task / Note) on the record. Saved replies exist but are wired into no composer.
4. **No list-view infrastructure.** Customers/Contacts/Leads are card feeds with a single search field — no columns, sort, filter, saved views, inline edit, bulk select, or record counts by view. This is the single largest structural distance from "Salesforce-grade organization."
5. **No console/split-pane inbox.** The Inbox is a one-column feed that navigates away per item; a Salesforce-console-style inbox keeps a list pane + detail pane + composer, with statuses (open/waiting/closed) and ownership. Support thread status exists in the data (bubbles show a status chip) but there is no queue view or state management surface.
6. **Weak unread/threading model.** No per-conversation unread markers on the record, no read receipts, no assignment; the bell/inbox counts are section-level heuristics, and opening the Inbox bulk-marks activity read.
7. **Cross-object cohesion gaps.** The highlights strip only shows deal facts when present; contact custom fields, health, owed, and next to-do never appear together; related lists (deals, invoices, files, projects) as first-class record-page cards don't exist outside embeds.
8. **Small latent bug** for the redesign to sweep up: `pipeline.html:694` reads `g.suggested_action` but `PIPELINE_GUIDANCE` (`:235-243`) defines `action`, so the drawer's "what to do next" half of the Path line renders empty.

Context from docs: the redesign directive (`docs/presence/OPEN-PUNCHLIST.md:106-121`) confirms the Jul-14/15 parity work (record thread, activity model, highlights, global search, AR view, to-dos 0107/0108) is the floor; the original CRM philosophy docs (`CRM-GUIDE.md`, `PHASE-CRM-EXCELLENCE.md`) describe the older "lens, not datastore / no pipeline objects" posture that the P2-C sales layer has since superseded — useful history for understanding why the current record page is stitched from three subsystems (`/crm/*` aggregation, `/sales/*` objects, project delivery embeds).

---

# PART 2 — CLIENT PORTAL

All research complete. Here is the full inventory.

---

# Client Portal Code Inventory — Salesforce-Style Redesign Input

Read-only survey of the client-facing portal in `/home/user/studio-os`. All anchors are `file:line`.

## 0. Surface map (files)

| File | Role |
|---|---|
| `/home/user/studio-os/portal.html` (340 lines) | The sign-in door. Passwordless-first (OTP/magic-link) + password fallback; post-sign-in role router. |
| `/home/user/studio-os/client.html` (785 lines) | The entire portal SPA. One `#main` div rewritten per view; persistent tab nav outside `#main` (client.html:159, 221-247). Self-contained — deliberately does NOT load the operator shell (client.html:151-155). |
| `/home/user/studio-os/set-password.html` (260 lines) | Invite/recovery landing: verify code or link-session, set password, role-route to `/portal.html`, `/client.html`, `/get-started.html`, or `/studio.html` (set-password.html:229-254). Realm-routes storage key by `?next` (set-password.html:109-112). |
| `/home/user/studio-os/approve.html` (93 lines) | Public one-tap approval page, authorized only by a signed `?token` (approve.html:53). |
| `supabase/functions/presence/routes/client_delivery.ts` (534) | All `/client/*` handlers (Agency–Client Bridge). |
| `supabase/functions/presence/routes/workspace.ts` (459) | `/portal/context`, `/portal/feed`, `reviewerAllowed` boundary, members/shares. |
| `supabase/functions/presence/index.ts:765-810` | Route table for `/client/*` + `/portal/*`. |
| `supabase/functions/presence/routes/comments.ts`, `routes/commercial.ts:228-283`, `routes/preview_env.ts` | The signed-token (session-less) client flows: G11 draft comments, FD-3 one-tap approvals, M8/FD-T20 preview links. |
| `docs/presence/CLIENT-PORTAL-VISIBILITY-MODEL.md` | The A6 visibility/permission model (matrixes + designed gaps). |
| `docs/presence/OPEN-PUNCHLIST.md:106-135` | The redesign directive itself: portal increments 1–2 shipped, increment 3 = approval-flow polish; Salesforce-style CRM+portal combined effort. |

Frontend transport: `api()` at client.html:180 — `fetch` to `{SUPABASE_URL}/functions/v1/presence` with anon key + `x-dds-user-jwt` (Supabase session token from storage key `dds-client-auth`) + optional `x-dds-scope-site` from `?client=` (client.html:179).

---

## 1. Tabs / screens, top to bottom

Persistent nav: 6 tabs `Home / Messages / Files / Invoices / Requests / Help` — `TABS` at client.html:228, dispatcher `showTab` client.html:238-246. Bottom tab bar on mobile, top rail ≥720px (CSS client.html:82-103). Footer with sign-out on every view (client.html:162).

### 1.1 Boot / gating (`load()`, client.html:741-772)
1. `GET /portal/context` → persona flags; failure → "couldn't load" (client.html:738).
2. `GET /client/projects` → project list.
3. Plain owner (no projects, not managed client, `sees_full_workspace`) → owner-bounce card "This is the client view / Open your workspace →" linking `/presence.html` (client.html:739, 755).
4. Persona: `'client'` if projects or `is_managed_client`, else `'reviewer'` (client.html:760).
5. `GET /portal/feed`, `GET /client/notifications` → PORTAL state; deep links `?support=<id>` / `?project=<id>` open drill-ins then are stripped from the URL (client.html:744-747, 769-770).
- No session → "Sign in to see your updates" → `/portal.html` (client.html:737, 780).

### 1.2 HOME (`renderHome` client.html:297-316)
Top-to-bottom:
1. **Topbar**: role badge ("Your workspace"/"Client view") + **notifications bell** with unread badge (client.html:299-301). Bell panel `#np` renders grouped Today/This week/Earlier notifications (`groupNotifs` client.html:200, `notifPanelHtml` client.html:586-597); opening marks read via `POST /client/notifications/read` (client.html:607-612); items navigate in-portal via `navFromHref` (client.html:214-219).
2. **Header** "Home".
3. **First-run welcome card** (dismissible, localStorage `dds-portal-welcomed`) with a step-link to each tab (client.html:561-582).
4. **"Needs you"** section — aggregated across everything (`buildNeedsYou` client.html:319-338): feed `pending_approvals` (infra/connected/file — inline Approve / "Not yet" buttons posting to `decide_path`, client.html:324, 288), per-project pending approvals ("Review →" → drill-in #sec-approvals), open client to-dos, open surveys, unpaid invoices (Pay link or Invoices tab). Empty → "You're all caught up" (client.html:331).
5. **"Your projects"** — one card per project (name, status, target date, glance line "N% along · X things need your OK") → click opens project drill-in (client.html:291-295, 306, 321).
6. **"Recent updates"** — shared Business Moments from the feed (headline + summary, read-only) (client.html:307-311).

### 1.3 MESSAGES (`renderMessages` client.html:340-359)
1. Header "Talk to your studio — they usually reply within a day."
2. **"Message your studio"** — general (project-less) threads: list of the client's project-less support requests (subject, status tag, updated-rel, "View & reply") (client.html:343-346).
3. **General composer** (persona `client` only) — textarea + Send; first line becomes the subject; posts `POST /client/support` (client.html:347, 358). Reviewer sees empty-state instead (client.html:348).
4. **"Project conversations"** — one card per project → opens drill-in scrolled to `#sec-messages` (client.html:350-354).

### 1.4 FILES (`renderFiles` client.html:361-387)
1. **"Documents"** — proposals/agreements from `GET /client/documents` with kind label (Agreement/Proposal), status (Signed/Awaiting signature/Accepted/Declined/Sent) and a signed `view_url` (client.html:369-378).
2. **Per-project groups** — each project's shared deliverables (title, note, Download button → `GET /client/deliverables/:id/download` → signed URL opened in new tab, client.html:272).
3. Empty-state if neither (client.html:379).

### 1.5 INVOICES (`renderInvoices` client.html:396-403, cards `appendBilling` :391-395)
- Note line "Your website subscription is billed separately" (SaaS ≠ service billing).
- Card per invoice: name, `$amount`, status, due date; `pay_url` → "Pay this invoice →" (Stripe URL), else "Paid — thank you." / "Your studio will send payment details."
- Data via `ensureBilling()` → `GET /client/billing` (client.html:255).

### 1.6 REQUESTS (`renderRequests` client.html:408-444)
1. **Book a call** card → booking wizard (client persona only) (client.html:418).
2. **"Request a service"** — the studio's catalog from `GET /client/services` (name, category, description, price, "Request this") (client.html:420-431).
3. **"Something else?"** — generic message CTA → `openSupport(null)` (client.html:433).
4. **"Your requests"** — ALL support requests (incl. project-scoped) with status + "View & reply" (client.html:435-438).
- **Service request brief** (`openServiceRequest` client.html:515-533): what-you-need + optional timeline + budget → `POST /client/support {subject:'Service request: X', service:id, brief:{need,timeline,budget}}`. Copy stresses nothing is charged automatically.
- **Booking wizard** (client.html:449-495): `GET /client/book` → studio site id (client_delivery.ts:93-98) → public engine `GET /book/:site/types` → choose service → date picker → `GET /book/:site/slots?type&date` → slot chips → confirm name+email → `POST /book/:site {type_id,slot_start,name,email}` → "You're booked" (client.html:493). Public booking routes: index.ts:171-178.

### 1.7 HELP (`renderHelp` client.html:535-560)
1. Studio FAQ (server-rendered HTML from `GET /client/faq`, service_edges.ts:92-101) with client-side search filter (client.html:554-559).
2. "Still need help?" → message composer.
3. **"Your account"** card: signed-in email, Appearance cycle (System/Light/Dark, localStorage `dds-client-theme`, client.html:206-210), Change password (Supabase `resetPasswordForEmail` → set-password.html), Sign out (client.html:548-553).

### 1.8 PROJECT DRILL-IN (`openProject` client.html:618-684) — regions in order
Loads in parallel: `GET /client/projects/:id` (bundle), `/report`, `/client/support` (client.html:620).
1. "← Back to home" + header (name, status).
2. **Sticky chip bar** — anchors only to sections with content: Overview / Approvals / Files / Messages / Support (`chipsFor` client.html:189-197; chips render :627-628).
3. **Overview status strip** — "N% complete · x/y milestones · z actions for you" from the report summary (client.html:629).
4. **"Waiting for your OK" (approvals)** — per-card kind tag (File/Task/Project/Request via `AKIND` client.html:633), title, summary, **Approve** + **Request changes** (reveals a note textarea, "Nothing changes until you approve" helper) (client.html:635). Decide posts `POST /client/approvals/:id/decide {decision, presented_hash, note}`; 409 (version drift / already decided) surfaces the server sentence and reloads (client.html:666-674).
5. **"Decided" history** — paper-trail list of approved / declined / changes-requested items with relative decided-time (`DLBL`, client.html:636-638).
6. **"Your to-dos"** — `client_action_required` tasks with overdue flag and **Mark done** → `POST /client/projects/:id/tasks/:tid/done` (client.html:640-641, 676).
7. **Files** — shared deliverables (Download) + **client upload card** (file input + Upload) (client.html:643-646). Upload flow (client.html:498-511): `POST .../upload-url` → PUT bytes to signed URL → `POST .../uploads` records a client-visible deliverable.
8. **"A quick survey"** — active surveys → `openSurvey` (client.html:648).
9. **"Project timeline"** — vertical milestone timeline: done / current "You're here" / upcoming (`timelineHtml` client.html:277-287, :650).
10. **Messages** — chat thread (studio left, client right bubbles, `bubbleHtml` client.html:253) + composer → `GET/POST /client/projects/:id/messages` (client.html:652, 682-685).
11. **Support** — this project's (+ project-less) requests + "Open a support request" (client.html:653-657).

### 1.9 Sub-screens
- **Support thread** (`openSupportThread` client.html:687-703): original request body + `presence_support_messages` as bubbles; reply composer unless resolved/closed.
- **Survey** (`openSurvey` client.html:704-726): questions rendered by type (rating 1–5 select, choice select, text input) → `POST /client/surveys/:id/respond {answers}`; already-submitted shows a thanks card.
- **New support request** (`openSupport` client.html:727-735): subject + body → `POST /client/support`.

---

## 2. Messaging, in detail

Three distinct thread systems, all bubble-rendered by `bubbleHtml` (client.html:253 — `author_kind` staff/system = "Your studio" left; anything else = "You" right):

1. **Project messages** — table `presence_project_messages`, `audience='client'`. Handler `handleClientMessages` (client_delivery.ts:222-242): GET paginated desc (frontend reverses); POST inserts body (5000-char clean cap) with `author`/`author_kind` from the principal, then writes a `presence_project_events` row `kind:'message', detail.from:'client'` (client_delivery.ts:34-40, 240). No editing, no deleting, no attachments, text only.
2. **Support requests + support messages** — `presence_support_requests` (subject/body/status/priority/project_id/requester) + `presence_support_messages`. Create: `handleClientSupport` POST (client_delivery.ts:401-442) — optional project link (verified via the bridge), optional service ref + structured brief folded into the body via `composeServiceBrief`; auto-acknowledgment email on the agency's brand (client_delivery.ts:437-440). Read one + thread: `handleClientSupportOne` (:450-464) — requester-scoped ("the customer sees only its OWN requests", :446). Reply: `handleClientSupportMessage` (:466-483). Statuses seen in UI: open/in_progress/resolved/closed; resolved threads become read-only (client.html:695-696).
3. **General "Messages" tab** composer is sugar over #2: a project-less support request whose subject is the first line (client.html:358).

**Studio-side landing:** every client action writes a `client_visible` project event stamped `detail.from='client'` (the ONLY file that stamps this — client_delivery.ts:35-37), which:
- increments the studio's shell bell `attention_count` (workspace.ts:157-168),
- surfaces in `/portal/feed`'s first-class **`client_messages`** section — per-conversation summary with `needs_reply` (latest message came from the client) and hrefs into `/crm.html?project=…&tab=messages` or `/projects.html?support=…` (workspace.ts:363-431),
- support triage on the studio side is the sibling authed surface `/support`, `/projects/:id/messages` etc. (index.ts:731-752).

Composer locations: Messages tab general composer (client.html:347), project drill-in composer (client.html:652), support-thread reply (client.html:695), new-request form (client.html:728), service-request brief (client.html:517-522).

---

## 3. What a client can DO end-to-end

| Action | Frontend | Route | Server guarantees |
|---|---|---|---|
| Approve / request changes / reject a project approval | drill-in :635, :666-674 | `POST /client/approvals/:id/decide` | bridge-verified, `client_visible` only, `presented_hash` optimistic-concurrency → 409 `version_mismatch` / `already_decided` (client_delivery.ts:260-280); decision note ≤1000 chars; event rings the studio bell |
| Approve feed-level plans (infra / connected writes / file replacements) | Home Needs-you :324, :288 | `POST {decide_path}` (`/foundations/plans/:id/decide`, `/connections/:k/write/:id/decide`, `/assets/:id/status`) | the only writes a `client_reviewer` may make (workspace.ts:38-41) |
| One-tap approve from email (no session) | approve.html | `GET/POST /approve?token=` | HMAC-signed 7-day token, IP rate-limited (commercial.ts:249-283, index.ts:195-196) |
| Pay an invoice | Invoices tab / Needs-you | external `stripe_url` (`pay_url`) | only exposed when unpaid (client_delivery.ts:56) |
| Book a call | Requests tab wizard :452-495 | `GET /client/book` + public `/book/:site/*` | slot booking via the public engine, honeypot/rate-limited (index.ts:167-178) |
| Upload a file to the studio | drill-in Files :498-511 | `POST .../upload-url` → PUT → `POST .../uploads` | hardened media store (mime/size/quota), recorded as client-visible deliverable + `client_upload` event (client_delivery.ts:100-136) |
| Download deliverables | Files tab / drill-in | `GET /client/deliverables/:id/download` | signed short-lived URL; only `shared` + `client_visible` (client_delivery.ts:245-257) |
| View/sign proposals & agreements | Files tab Documents | `GET /client/documents` → signed `view_url` | 30-day signed doc token to the Document of Record (client_delivery.ts:155); accept/sign itself is pre-auth `/sales/*` (index.ts:197-211) |
| Request work / service | Requests tab :515-533 | `POST /client/support` (+`service`, `brief`) | always a PENDING request; "nothing charged automatically" is the stated moat (client_delivery.ts:418-423) |
| Message the studio | see §2 | project messages / support | events + inbox landing |
| Mark a to-do done | drill-in :676 | `POST .../tasks/:tid/done` | only `client_action_required` + `client_visible` tasks (client_delivery.ts:73-87) |
| Answer a survey | `openSurvey` :704-726 | `GET /client/surveys/:id`, `POST .../respond` | active+visible only; answers normalized; idempotent one-response-per-respondent (client_delivery.ts:283-321) |
| Comment on the shared website draft | via share link, not client.html | `GET /p/s/:token/sections`, `POST /p/s/:token/comments` | signed-token only (comments.ts:1-16) |
| Account self-service | Help tab :548-553 | Supabase auth | theme, password reset, sign out; name/email changes go through the studio |

---

## 4. Auth / persona model & signed-token flows

**Realms:** client sessions live under storage key `dds-client-auth`, operator under `dds-portal-auth` — one browser can hold both (portal.html:141-145, set-password.html:101-112).

**Door (portal.html):** passwordless-first `signInWithOtp` with `shouldCreateUser:false` (non-enumerating, portal.html:219-229), 6-digit code verify or magic-link hash arrival (portal.html:317-337), password fallback + forgot-password → set-password.html. Post-sign-in the ONE role router (`route()` portal.html:174-200): `GET /portal/context` → redirect to `data.landing`; 403 shows the server's own paused/lapsed message; team fallback via `clever-api whoami` → `/studio.html`; else honest "nothing connected" panel.

**Personas (server truth in `handlePortalContext`, workspace.ts:57-204):**
- **Managed client (bridged customer)** — a converted customer signed into their OWN site (`site.client_id` set) with ≥1 active `presence_service_links` row keyed by `customer_client_id` → `is_managed_client:true` → landing = client.html (workspace.ts:108-117). Full portal powers; every `/client/*` handler resolves `customerOf(site)` and verifies the bridge link before touching agency data (`linkForCustomerProject`/`linkForCustomerVia`, service_bridge.ts:75-99). Their data lives on the AGENCY's site; they are never members of the agency workspace (client_delivery.ts:1-7).
- **Invited reviewer (`client_reviewer` site role)** — an invited member on the shared site. Hard server boundary `reviewerAllowed` (workspace.ts:30-43): only `GET /portal/context|feed` + the four decide POSTs; everything else, including all `/client/*`, is 403 (index.ts:386-395). Frontend persona `'reviewer'`: tabs render calm empty states, composers hidden (`canMessage` client.html:342, 410, 537).
- **Owner bounce** — full-workspace owner with no client signals gets the "Open your workspace" card, no tabs (client.html:755, 739).
- **Operator scope-switch** — `x-dds-scope-site` header (from `?client=`) is re-validated server-side against agency authorization, fail-closed, and logged (index.ts:330-347); an agency operator drilled into a customer keeps operator tools (workspace.ts:113-116).

**Signed-token (session-less) client flows — all pre-auth, matched before the site gate (index.ts:160-232):**
1. **FD-3 one-tap approvals** — owner triggers `POST /approve/send` → per-item HMAC token (site_id+kind+plan_id+exp 7d) emailed → approve.html → `GET/POST /approve` verify + decide through the approval spine, rate-limited (commercial.ts:232-283).
2. **Sales docs** — `/sales/p|c|view/:token` review, `/sales/doc/:token` Document of Record, `/sales/proposals/:id/decide`, `/sales/contracts/:id/sign` — authorized only by the signed link, site_id inside the token (index.ts:197-211). The portal's Files tab re-mints 30-day doc tokens (client_delivery.ts:155).
3. **M8/G11 shared draft** — signed, expiring preview link `/p/s/:token`; the SAME token authorizes G11 feedback: `GET /p/s/:token/sections` (id+name list only) and `POST /p/s/:token/comments` (rate-limited, open-comment cap) into `presence_section_comments` with `author_kind='client'` (comments.ts:1-16; index.ts:212-226). Open client comments raise the studio's `client_feedback` notice + bell count (workspace.ts:100-103, 317-326). Operator side manages via authed `/comments*` (index.ts:586-591); a `client_reviewer` cannot reach those.
4. **FD-T20 public preview** `/p/:token` (+ optional password) (index.ts:227-232).

---

## 5. Data routes per screen

| Screen | Reads | Writes |
|---|---|---|
| Boot | `GET /portal/context` (workspace.ts:57), `GET /client/projects` (client_delivery.ts:164), `GET /portal/feed` (workspace.ts:241), `GET /client/notifications` (client_delivery.ts:324) | `POST /client/notifications/read` on deep-link (client.html:769-770) |
| Home | above + `GET /client/projects/:id` per project (snapshot cache `ensureSnaps` client.html:258-270, capped at 8) + `GET /client/billing` | `POST {decide_path}` (feed approvals), `POST /client/notifications/read` (bell open) |
| Messages | `GET /client/support` (filtered project-less) | `POST /client/support` |
| Files | snapshots + `GET /client/documents` | — (`GET /client/deliverables/:id/download` on click) |
| Invoices | `GET /client/billing` (client_delivery.ts:48-67) | — (pay = external Stripe) |
| Requests | `GET /client/support`, `GET /client/services` (client_delivery.ts:360-398) | `POST /client/support` (service brief) |
| Booking | `GET /client/book`, `GET /book/:site/types`, `GET /book/:site/slots` | `POST /book/:site` |
| Help | `GET /client/faq` (service_edges.ts:92) | Supabase `resetPasswordForEmail` |
| Project drill-in | `GET /client/projects/:id` (bundle: project, milestones, tasks+derived, events, deliverables, approvals, surveys, progress — client_delivery.ts:183-200), `GET /client/projects/:id/report` (:202-219, incl. CSAT), `GET /client/support`, `GET /client/projects/:id/messages` | `POST /client/approvals/:id/decide`, `POST .../tasks/:tid/done`, `POST .../messages`, `POST .../upload-url` + `POST .../uploads`, survey + support writes |
| Support thread | `GET /client/support/:id` | `POST /client/support/:id/messages` |
| Survey | `GET /client/surveys/:id` | `POST /client/surveys/:id/respond` |

Route table: index.ts:765-798 (`/client/*`), :801-810 (`/portal/*`). Notification href shapes consumed by `navFromHref`/`sectionForAnchor`: lib/notifications.ts:11-38 (`/projects/:id#approval-…/#messages/#files/#task-…`, `/client.html?support=…`) mapped client-side at client.html:202, 214-219.

---

## 6. Mapping to a Salesforce Customer Account Portal (code-derived)

| Salesforce portal standard page | We have (code) | Gap / delta |
|---|---|---|
| **Home** (welcome, quick actions, highlights) | Home tab: needs-you queue + project cards + moments + bell (client.html:290-338) | Ours is action-queue-first, no configurable components/quick-action tiles; welcome card is one-time (client.html:561) |
| **Cases** (create case, my cases, case detail feed) | Support requests ARE cases: create (`openSupport`/service brief), list w/ status (Requests tab + per-project), threaded detail w/ replies + resolved lock (client.html:687-703; client_delivery.ts:400-483) | No case priority picker in UI (server accepts `priority`, client_delivery.ts:417 — never sent by client.html), no attachments on cases, no case numbers/SLA display |
| **My Account / Orders / Billing** | Invoices tab (`/client/billing`) + Documents (proposals/contracts w/ signed views) + Requests catalog as a lightweight "store" that only creates pending requests (client_delivery.ts:355-398) | No self-serve account/contact editing — explicitly "message your studio" (client.html:548); payment is a Stripe link out |
| **Knowledge** (articles, search) | Help tab: studio-authored FAQ with client-side search (client.html:535-559; service_edges.ts:68-101) | Flat FAQ only — no articles/categories/deflection |
| **Profile / Settings** | "Your account" card: email, theme, password reset, sign-out (client.html:548-553) | No avatar, notification prefs, or profile fields |
| **Notifications bell** | Yes — derived, grouped, unread-count, deep-linking bell (client.html:583-617; client_delivery.ts:323-353) | Read-state is all-or-nothing per open (one `last_seen_at`), no per-item mark/actioning |
| No direct Salesforce analog | Project drill-in (milestone timeline, approvals with decided history + content-hash versioning, client to-dos, uploads, per-project chat, surveys); booking wizard; signed-token one-tap approvals & draft section comments | These are the portal's differentiators to preserve in the redesign |

Persona note for the design doc: the reviewer/managed-client split is a SERVER boundary (`reviewerAllowed`, workspace.ts:30-43), not a UI switch — any redesigned page must degrade for a reviewer who can only read `/portal/context|feed` and POST the four decide routes. Per docs/presence/OPEN-PUNCHLIST.md:130-135, portal redesign increments 1–2 are shipped and increment 3 is approval-flow polish; the CLIENT-PORTAL-VISIBILITY-MODEL doc (docs/presence/CLIENT-PORTAL-VISIBILITY-MODEL.md:60-99) records the still-open gaps: per-item Presence visibility and a read-only stakeholder role.


---

# PART 3 — MESSAGING + CRM DATA MODEL (backend)

All reading is done. Here is the full inventory.

---

# Studio OS — Messaging + CRM Data Model Inventory (backend, read-only)

Scope: `supabase/functions/presence/` routes + lib and `supabase/migrations/*.sql`. All paths below are relative to `/home/user/studio-os/`.

---

## 1. Entity Map (plain-English ERD)

### 1.1 Identity / tenancy spine

| Table | Defined | Key fields | Role |
|---|---|---|---|
| `clients` | `supabase/migrations/0000_baseline.sql:566` | `id, name, email, contact_email, contact_id → contacts.id`, Stripe cols, legacy contract cols | The **global customer/account record** (one per billed business). No `auth_user_id` column — auth identity lives on the linked contact. |
| `contacts` (legacy, global) | `0000_baseline.sql:644` | `id, name, email, auth_user_id, stage` | Legacy pre-presence contact; today its main live role is `clients.contact_id → contacts.auth_user_id`, the key that ties a signed-in customer to their `clients` row (used everywhere requester identity is resolved, e.g. `routes/crm.ts:59-68`, `routes/project_comms.ts:94-104`). |
| `presence_sites` | 0015/0018 | `id, client_id, status, edition …` | The tenant unit. **Everything CRM/messaging is `site_id`-scoped.** An agency's own site is the "agency site"; a converted customer gets their own site. |
| `presence_service_links` — **the Agency–Client Bridge** | `0079_p2d_agency_client_bridge.sql:12` | `agency_site_id, project_id (UNIQUE), customer_client_id, customer_site_id, deal_id, status ∈ active/ended` | The tenant-safe join: delivery data lives on the **agency** site; the customer reaches it only through this link. Helpers in `lib/service_bridge.ts:75-99` (`linksForCustomer`, `linkForCustomerProject`, `linkForCustomerVia`). |
| `presence_customer_agency` | 0080 | PK `customer_client_id → agency_site_id` | "One primary agency per customer" constraint, enforced in `ensureBridge` (`lib/service_bridge.ts:20-32`). |

### 1.2 Sales CRM chain (pre-sale, lives on the agency site)

```
presence_form_submissions ─(source_submission_id)→ presence_deals ─(contact_id)→ presence_contacts
                                                        │
              ┌─ presence_deal_events   (system events + logged activities, one table)
              ├─ presence_deal_tasks    (to-dos, 0108)
              ├─ presence_proposals ──→ presence_contracts
              ├─ presence_invoices     (deal_id / customer_client_id)
              └─ convert → clients.id (converted_client_id UNIQUE)
                         + presence_sites (converted_site_id)
                         + presence_projects (created_project_id UNIQUE)
                         + presence_service_links (bridge)
```

| Table | Defined | Key fields |
|---|---|---|
| `presence_contacts` | `0074_p2c_sales_lifecycle.sql:14` | `site_id, name, email (unique per site+lower(email)), phone, company, notes, custom jsonb` (values bag, `0097_contact_custom_fields.sql:13`; field *definitions* live in a reserved `presence_sales_templates` row `__crm_contact_fields__`, `routes/sales.ts:49-54`) |
| `presence_deals` | `0074:34` | `site_id, contact_id, title, stage ∈ lead/qualified/proposal/contract/won/lost, source, source_submission_id, expected_value_cents, expected_close, next_step, next_step_at` (0089), `converted_client_id (UNIQUE), converted_site_id, converted_at, created_project_id (UNIQUE, 0075:117)` |
| `presence_deal_events` | `0074:67` | `deal_id, site_id, kind ∈ created/stage_change/note/proposal_sent/proposal_decided/contract_sent/contract_signed/converted` (+`invoice_sent`,`invoice_paid` added in `0088_notice_kinds.sql:37`), `from_stage, to_stage, detail jsonb, actor, actor_kind, created_at`. **Doubles as the manual-activity store** (see §3). |
| `presence_deal_tasks` | `0108_deal_tasks.sql:7` | `site_id, deal_id, title, due_date, status open/done, completed_at, deleted_at`. CRUD at `routes/sales.ts:308-335`; deploy-order-tolerant (empty list pre-0108). |
| `presence_proposals` | `0074:84` | `deal_id, line_items jsonb, subtotal_cents, status draft/sent/accepted/declined, version, share_token`; + `first_viewed_at, expires_at` (`0107_proposal_tracking.sql:7-8`, Salesforce open-tracking parity). |
| `presence_contracts` | `0074:109` | `deal_id, proposal_id, body, content_hash, status draft/sent/signed/voided, signer_*, signed_evidence jsonb` |
| `presence_invoices` | `0086_presence_invoices.sql:14` | `site_id (agency), deal_id, customer_client_id, amount_cents, purpose service/deposit, status open/paid/void, stripe_url` |
| `presence_form_submissions` | `0050_presence_commercial_v1.sql:29` | `site_id, form_kind contact/quote/booking, name, email, message, status new/read/archived/converted (0085), spam, ip_hash` — the website-enquiry inbox and the CRM lead source. |

### 1.3 Delivery chain (post-sale, lives on the agency site)

| Table | Defined | Key fields |
|---|---|---|
| `presence_projects` | `0075_p2d_service_delivery.sql:17` | `site_id, client_id → clients, deal_id, name, status active/on_hold/complete/archived, client_visible` |
| `presence_milestones` / `presence_tasks` | `0075:45` / `0075:66` | tasks: `client_visible (default false), client_action_required, assigned_to, due_date` |
| `presence_project_events` | `0075:96` | `project_id, site_id, kind` (check extended in `0077:40` and `0078:81` to include `message, deliverable_added, approval_requested, approval_decided, survey_*, support_opened, support_message, support_resolved`), `detail jsonb, actor, actor_kind, client_visible, created_at`. **The ONE activity log** — notifications are a view over it. |
| `presence_deliverables` / `presence_approvals` | `0076:9` / `0076:31` | files & sign-offs, both `client_visible`-gated |
| `presence_surveys` / `presence_survey_responses` | `0078:8` / `0078:24` | one submitted response per (survey, respondent) via partial unique index |

### 1.4 Conversation ownership

- **A project conversation is owned by the agency site** (`presence_project_messages.site_id = agency site`); the customer reaches it through the bridge (`routes/client_delivery.ts:222-242`).
- **A support request is owned by `(site_id, requester)`**: `requester` is a plain text reader key = `principal.userId || email` (`routes/service_intake.ts:39`, `129`). The client sees only rows where `requester = readerKey(principal)` (`service_intake.ts:145`, `client_delivery.ts:446`). There is **no FK from support requests to clients/contacts** — identity is re-derived by matching auth-uuid/email keys (`routes/crm.ts:59-68`, `project_comms.ts:94-104`, `workspace.ts:402-416`). This string-keyed identity is the single most fragile join in the model.
- **`/crm/record` is the resolver** that stitches contact → deal → client → customer site → project into one identity tuple (`routes/crm.ts:218-308`), because "one relationship is physically split across four tables" (its own comment, crm.ts:208).

---

## 2. Every message channel

| # | Channel | Store | Written by | Read by | Merged into |
|---|---|---|---|---|---|
| 1 | **Project thread** (audience `internal` \| `client`) | `presence_project_messages` (`0077:9`) | Studio: `routes/project_comms.ts:38-66` (POST `/projects/:id/messages`); Client: `routes/client_delivery.ts:222-242` (POST `/client/projects/:id/messages`, forced `audience='client'`) | Same two routes (GET); client never sees `audience=internal` (`project_comms.ts:33`) | Emits a `kind='message'` project event (`project_comms.ts:50`, `client_delivery.ts:240`); merged into **/crm/messages**, **/notifications**, **/portal/feed** `client_messages`; studio→client posts also emit a throttled email via `emailBridgedCustomer` (`project_comms.ts:55-65`) |
| 2 | **Support threads** | `presence_support_requests` + `presence_support_messages` (`0078:44,66`) | Client door: `client_delivery.ts:401-483` (`/client/support*`, writes onto the **agency** site); studio door: `service_intake.ts:106-207` (`/support*`, triage/resolve/reply); auto-ack emails at `service_intake.ts:21-31` and `client_delivery.ts:439-440` | Studio list `/support`; client list `/client/support`; per-customer project-less list `/projects/:id/client-messages` (`project_comms.ts:80-108`) | Project-linked ones emit `support_opened/support_message/support_resolved` project events; **project-less ones emit no event** and are grafted into notifications by a second query (`project_comms.ts:127,139`); merged into `/crm/messages`, `/portal/feed`, both notification feeds; resolve offers CSAT (`service_intake.ts:183`) |
| 3 | **Logged activities** (call/email/meeting/dated note) | `presence_deal_events` rows with `kind='note'`, `detail={activity_kind, body, occurred_at}` — **no dedicated table** (`crm/deal_activity.ts:6-17`) | POST `/sales/deals/:id/activity` (`routes/sales.ts:487-505`) | Deal timeline (`sales.ts:441-442` via `mergeDealTimeline`), contact detail (`crm/contact_detail.ts`), "last contacted" on pipeline cards (`sales.ts:354-369`) | Merged into `/crm/messages` as `kind:'activity'` (`crm.ts:176-188`) |
| 4 | **Section comments** (draft feedback) | `presence_section_comments` (`0112:9`) | Operator: `/comments` (authed, `routes/comments.ts:60-80`); Client: `/p/s/:token/comments` — **pre-auth, signed preview token**, rate-limited, capped at 200 open (`comments.ts:152-188`); panel injected into the shared draft (`lib/section_comments.ts:155-241`) | Operator `/comments` list grouped into threads (`comments.ts:42-57`) | Open-count feeds the bell badge + a synthetic `client_feedback` notice (`workspace.ts:103, 281, 320-326`); **not** merged into /crm/messages |
| 5 | **Relationship notes** | `presence_relationship_notes` (`0048:9`), `audience internal/shared` | `/crm/notes` (`crm.ts:335-360`) | `/crm/notes`, `/crm/timeline` (audience-filtered, `crm/store.ts:55-58`) | Client Relationship Center timeline only |
| 6 | **Website enquiries** | `presence_form_submissions` (`0050:29`) | Public form collector | Leads inbox (`/forms/inbox`), CRM timeline `mapLead` (`crm/contract.ts:91-95`), attention center (`attention.ts:39`) | The deal's originating enquiry is merged into `/crm/messages` as `kind:'enquiry'` (`crm.ts:157-163`) |
| 7 | **Broadcast emails** (outbound marketing) | `presence_broadcasts` + `presence_broadcast_sends` (`0098:17,46`) | Broadcast composer/sweep | Send log | Sends matched by client email are merged into `/crm/messages` as `kind:'broadcast'` (`crm.ts:189-199`) |
| 8 | **Bookings** | `presence_appointments` (`0099:72`) | Public booking door | Bookings desk | Matched by customer email into `/crm/messages` as `kind:'booking'` (`crm.ts:164-174`) |
| 9 | **Notifications (in-app)** | **No store** — derived: `presence_project_events` + `presence_support_requests` + per-reader `presence_activity_reads` last-seen mark (`0077:28`) | Read routes only; `/notifications/read` upserts last-seen (`project_comms.ts:145-149`; client variant `client_delivery.ts:324-353` with reader key `client:<client_id>`) | Studio: `/notifications` (`project_comms.ts:111-143`); client: `/client/notifications` | Pure mapping in `lib/notifications.ts` (labels/hrefs/isRead) |
| 10 | **Bell badge / inbox feed** | Derived | — | `/portal/context` `attention_count` (`workspace.ts:141-181`) and `/portal/feed` notices + `client_messages` (`workspace.ts:241-433`) | Aggregates notices (`presence_plan_notices`, `0037:54`), approvals, enquiries, support, message events, section comments |
| 11 | **Web push** | `presence_push_subscriptions` (`0090:7`) | `/push/subscribe|unsubscribe` (`routes/push.ts:10-39`) | `pushToSite` sender (`push.ts:43-64`, RFC 8291/8292 impl in `lib/webpush.ts`) | Fired from notice/attention paths; prune-at-5-failures contract |
| 12 | **Transactional email (outbound only)** | none (Resend API) | `sendEmail` in `commerce/account.ts:105-129`; bridge nudges `lib/service_bridge.ts:105-140`; support acks; sales send/sign links | — | — |

**Aggregate read surfaces:** `/crm/messages` (channels 1,2,3,6,7,8 → one chronological thread per client, `crm.ts:95-205`); `/notifications` + `/client/notifications` (channels 1,2 via events); `/portal/feed` (channels 2,4,6 + notices + approvals); `/attention` (attention.ts, customer-facing); `/website-timeline` (`routes/timeline.ts`) and `/crm/timeline` (`crm/store.ts:47-70`) mix site-ops events with lead/notes signals.

---

## 3. Activity model vs Salesforce (Task / Event / EmailMessage on WhoId/WhatId)

**What Salesforce does:** one polymorphic Activity object (Task/Event/EmailMessage) attached to a person (`WhoId` → Contact/Lead) and/or a thing (`WhatId` → Opportunity/Account/Case), rendering as one timeline on every related record.

**What exists here (the pieces of that):**
- Typed manual activities exist — but only **deal-scoped**: `kind='note'` rows in `presence_deal_events` with `detail.activity_kind ∈ call/email/meeting/note` and a back-datable `occurred_at` (`crm/deal_activity.ts:6-58`, write at `sales.ts:487-505`). The file itself says "Salesforce Activities parity" for deal tasks (`0108:2`, `sales.ts:305`).
- A per-deal merged timeline (activities + system events, one table, ordered by effective time) — `mergeDealTimeline` (`crm/deal_activity.ts:134-138`).
- A per-contact roll-up across that contact's deals — `composeContactDetail` (`crm/contact_detail.ts:52-90`).
- A per-client merged conversation assembled **at read time** from six channels — `/crm/messages` (`crm.ts:95-205`). This is the Salesforce-style timeline, but computed by fan-out queries + email-string identity joins on every request, not stored.
- To-dos: `presence_deal_tasks` (deal-scoped) and `presence_tasks` (project-scoped) are **two disjoint task systems** with different schemas; nothing unifies "my tasks across the funnel".

**What's missing for the Salesforce shape:**
1. **No polymorphic anchor (`WhoId`/`WhatId`).** Every event table is hard-scoped to exactly one parent: `presence_deal_events.deal_id`, `presence_project_events.project_id`. An activity can't attach to a contact, client, or support case; contact timelines only work via `contacts→deals→deal_events`. A pre-deal contact and a converted client have no place to log a call.
2. **No unified persisted timeline.** The per-client thread exists only as the `/crm/messages` read-time merge; each of its six channels is "best-effort — one failing read never blanks the conversation, it just omits that channel" (`crm.ts:104`). There is no `activity` table with `(site_id, who_id, what_id, type, occurred_at)`.
3. **No first-class person key.** Identity across channels is reconstructed from `requester`/`customer_email` strings (`customerRequesterKeys`, `crm.ts:54-68`). Salesforce's Contact-as-WhoId is what makes its timeline cheap; here two casings of an email are already special-cased (`crm.ts:66`).
4. **No inbound email capture — verified.** Outbound only: `sendEmail` posts to `https://api.resend.com/emails` (`commerce/account.ts:105-129`); there is no inbound webhook, IMAP, or reply-parsing route anywhere in `functions/presence/` (grep for inbound/imap/reply-to finds none). The legacy `clever-api/index.ts:7906` states it explicitly: pulling replies in "requires a Resend Inbound webhook (a config step, tracked separately)" — i.e. known, not built. A logged "email" activity is a hand-typed note; the client's actual email reply never enters the system. Salesforce's `EmailMessage` equivalent does not exist.
5. **No cross-entity task view** (deal tasks vs project tasks vs `next_step` string are three parallel "what's next" mechanisms: `0089`, `0108`, `0075:66`).

**What a unification could reuse:** the event-ledger pattern is already uniform (deal_events and project_events share a shape — `0075:96` says "copy of the deal-events shape"); the audience/`client_visible` discriminator is consistent; `/crm/record` already computes the canonical identity tuple that a `who_id` column would persist.

---

## 4. Same data rendered in multiple places (and known divergences)

| Data | Surfaces | Divergences noted in code |
|---|---|---|
| Project client-thread messages | Studio project page (`/projects/:id/messages`), client portal (`/client/projects/:id/messages`), Client Record Messages tab (`/crm/messages`), notifications, portal-feed `client_messages` | `/crm/messages` spans **all** linked projects (`crm.ts:124-125`); the project routes show one. Notification hrefs fork by audience: studio → `/crm.html?project=…&tab=messages`, client → `/projects/:id#messages` — comment "#181: for the STUDIO, a client message belongs on the Client Record… client.html's deep-link parser depends on it" (`project_comms.ts:131-135`). |
| Support requests | Studio `/support` list, client `/client/support`, per-project `client-messages`, `/crm/messages`, both notification feeds, Inbox (`/portal/feed`), roster open-support counts (`client_delivery.ts:493-533`) | "W5 (3rd copy): the /support#… page doesn't exist" — support notification links had to be re-pointed per audience (`project_comms.ts:136-139`) while `lib/notifications.ts:28-34` still emits the project-anchored `#support-…` convention for clients. Project-less requests emit no project event, so they ride a **separate** query into notifications (`project_comms.ts:127`). Inbox rows are deliberately *not* cleared by the last-seen mark, unlike the bell (`workspace.ts:368-371`). |
| Unread state | Bell badge (`/portal/context`), notifications list, client portal | Three reader keys share one `presence_activity_reads` table: studio = `userId||email` (`project_comms.ts:19`), customer = `client:<client_id>` (`client_delivery.ts:335,351`) — the same human on two sides has two read cursors. Studio self-ring is prevented only by `detail.from='client'` stamped exclusively by the client door (`client_delivery.ts:34-40`, `workspace.ts:163-167`), because `actor_kind` can't distinguish owner from customer (both `'client'`). |
| New website enquiry | Attention center, bell/portal-feed synthetic notice, leads inbox, CRM timeline, deal's `/crm/messages` enquiry row | Dedupe against the `lead_followup` cron notice is done **twice**, independently, in context and feed (`workspace.ts:150-154`, `308-315`); inbox.html additionally filters the aggregate kind to avoid double listing (comment at `workspace.ts:306`). |
| Client health/profile | `/crm/profile` (relationship center) vs Client Record overview | Overview tab only enabled when a real customer site exists — "otherwise it would run against the operator's own site (the old crm.html landmine)" (`crm.ts:276-279`). |
| Client "conversation ownership" split | Reply target logic | The one composer picks: project thread if any, else newest **open** support thread (`reply_support_to`, `crm.ts:149-151, 201`) — so studio replies to the same client land in different stores depending on state. |
| Deal timeline | Pipeline drawer (`timeline` from `/sales/deals/:id`), contact detail, `/crm/messages` activity rows | Server labels deliberately mirror `pipeline.html`'s `evtLabel` "so the merged server timeline reads identically to the legacy History strip" (`crm/deal_activity.ts:76-78`) — a duplication kept in sync by hand. |

---

## 5. Constraints a redesign must respect

1. **Deny-all RLS + function mediation is the default.** Every CRM/messaging table enables RLS with **no policies** ("deny-all; function-mediated") — `0048:25`, `0074:31,64,81,106,132`, `0075`, `0077`, `0078`, `0079:30`, `0086`, `0098`, `0108:20`, `0112:27`. All access goes through the edge function's service role (`lib/db.ts svc()` → PostgREST). Exceptions with real policies use `my_presence_site_ids()` (`0015:66-103`; membership-based, granted to `authenticated` only), e.g. `presence_plan_notices` client-read (`0037:69-75`). `0106` closes stragglers and forces `security_invoker` on views. Any new table must ship RLS-on, policy-less, service-role-mediated unless there's an explicit client-read case.
2. **Tenant scoping is `site_id` in every WHERE, plus the bridge for cross-tenant reach.** No handler reads a delivery/support/message row without `site_id=eq.<agency site>`; customer access must first prove `presence_service_links` (`linkForCustomerProject` / `linkForCustomerVia`, `lib/service_bridge.ts:83-99`). The reviewer boundary is a route allowlist, not UI (`reviewerAllowed`, `workspace.ts:30-43`), and `/client/*` deliberately bypasses reviewer roles in favor of bridge scoping (comment at `workspace.ts:32-37`).
3. **Signed-token doors for unauthenticated access.** Pattern: HMAC over base64url payload with embedded `site_id` + `exp`, timing-safe compare, fail-closed (missing secret → 404; expired → 410). Instances: sales accept/sign links (`sales.ts:66-84`), Document of Record tokens (`docLink`, `sales.ts:86-96`; client portal reuse `client_delivery.ts:154-158`), preview/share-link comments (`comments.ts:115-129`). Public token writes are rate-limited per IP+site (`rateAllow`, `comments.ts:157`) with a hard abuse backstop (`MAX_OPEN_CLIENT_COMMENTS`, `lib/section_comments.ts:40`).
4. **Deny-by-default validation idioms** (uniform across routes): UUID regex gate before any id is interpolated; `clean()` control-char strip + length cap on every string; PostgREST filter-grammar neutralization on search input (`.replace(/[(),*"\\]/g,' ')`, `sales.ts:116`, `service_intake.ts:111`); bounded `clampLimit/clampOffset`; enum guards (`isStage`, `isSupportStatus`, `isAudience`) with explicit transition tables (`canSupportTransition`, `canTransition`); optimistic-concurrency guards pinning prior status in the WHERE (`service_intake.ts:176`, `sales.ts:518`); idempotency by unique index (converted_client_id, created_project_id, survey responses, broadcast sends).
5. **"One log, derived views" doctrine.** Notifications must never become a second store (`0077:3-5`, `lib/notifications.ts:1-4`); attention/CRM/inbox are pure projections over existing tables (`lib/attention_center.ts:8-12`, `crm/store.ts:1-4`). Pure logic lives in importable, test-isolated modules (`crm/contract.ts`, `crm/deal_activity.ts`, `lib/section_comments.ts`) — a redesign should keep the pure/impure split.
6. **Deploy-order tolerance.** Code ships ahead of migrations and must degrade: fallback selects for 0089/0107 columns (`sales.ts:346-351, 429-431, 458-463`), empty-list degradation for 0108/0112 (`sales.ts:311`, `comments.ts:51-53`), best-effort channel reads that omit rather than fail (`crm.ts:104`).
7. **Side-channel obligations on message writes.** A studio→client message must also reach email (throttled 15-min window, `project_comms.ts:51-65`); new tickets auto-ack (`service_intake.ts:21-31`); bridge emails are `critical: true` (survive marketing opt-out, `service_bridge.ts:118-120`); push is strictly best-effort with the prune-at-5 contract (`push.ts:43-64`). Redesigned channels must preserve these or the delivery loop stalls.
8. **Audience separation is column-level, enforced server-side**: `audience internal/client` (messages), `client_visible` (events/tasks/deliverables/approvals), `audience internal/shared` (notes), and the `detail.from='client'` stamp whose only writer is the client door (`client_delivery.ts:34-40`) — any new event writer must keep that invariant or studio bells will ring on the studio's own actions.

### Biggest structural facts for the redesign
- The "client 360" already exists as **read-time composition** (`/crm/record` + `/crm/messages`); persisting it means introducing the missing `who_id` (person) key and a unified activity table — the event-ledger shape to copy is already standardized (`presence_deal_events` ≡ `presence_project_events`).
- Identity is the weak joint: `requester`/email string keys instead of FKs (support, bookings, broadcasts, activity reads).
- Inbound email does not exist anywhere in the platform; every "email" in the timeline is either outbound (Resend) or a hand-logged note.
