# Whole-site workflow audit — October 2026

**For:** Eric, to decide. **Status:** proposal. Nothing here has been built or changed.
**Measured on:** `main` at b94fdf0 (sections 1–5; section 6 re-measures on `ed14a1e`, after the changes), with the e2e fixtures (`tests/e2e/helpers/app.ts`, `installApp`), desktop Chromium at 1280×800. The walks use the real `buildNav` menu for a business owner with every feature switched on.
**Not included:** the open visual-refresh PRs (#10, #11, #14–#17). Where one of them changes a finding, the finding says so.

[WORKFLOW-MAP.md](WORKFLOW-MAP.md) covers six CRM jobs: invoice, enquiry → customer, chase payment, kick off a project, approve a change as the owner, and reply to a client. This audit covers what that map leaves out:

- the website side
- the client's side
- onboarding
- every signed-in page, including the eight "lens" pages

## The short version

- **Studio OS has 38 signed-in pages and 30 menu destinations.** Eight of the destinations are lens pages. A lens shows data that already has a home somewhere else.
- **The menu shows the duplicates side by side.** Type "history" in ⌘K and you get two results, *History* and *Version history*. They read the same `/publishes` data.
- **"Needs you" appears in six places:** Today, Inbox, the bell, *Website attention*, *Approvals* and the Studio queue.
- **The two quickest jobs leave Studio OS.** Replying to an enquiry and paying an invoice take two clicks each, but they open your mail app and Stripe, and nothing is written back to the customer's record.
- **Two jobs are hard to find.** Connecting a domain and adding a page are not in the menu, and ⌘K returns nothing for "domain" or "page". Each sits behind a control inside the website builder.
- **One bug blocks onboarding.** The website preview's **← Back** button sits underneath the shell's top bar, and Escape doesn't close the preview. A brand-new owner who presses *Review & preview your website* has no way back except a menu link (see [Bugs found while walking](#bugs-found-while-walking)).
- **Five changes would remove 10 pages and 8 menu entries**, and cut the client's approve and pay jobs to one click each. They are ranked at the end, each with an effort size, for you to approve.

---

## 1. Every signed-in page

"Reached from" means where a user finds the page:

- **Nav:** the menu built by `lib/navigation.ts` `buildNav`, which ⌘K also lists.
- **Overflow:** the profile/overflow menu. These are the `utility` sections.
- **Links:** links from other pages, `shell.js`, emails and bell notices.

"Same data also on" names the other page that reads the same endpoint or list.

### The studio owner's workspace (shell, sidebar)

| Page | What it is for | Reached from | Same data also on |
| --- | --- | --- | --- |
| `today.html` | The home screen: Needs you, today's bookings, the Ask box, and "all clear" links | Nav **Today**; landing page; brand mark | Inbox (`/portal/feed`), Analytics (`/analytics/dashboard`), Pipeline (`/sales/deals`) |
| `presence.html` | The website builder: overview, Business info, Design, Files, Bookings, Reviews, Domain & email, History, publish ritual | Nav **Website** ▸ Website · Business info · Design · Publish · History; Settings (`#settings`); bell; about 19 pages | Files (`#media`), schedule.html (`/schedule`), snapshot-history (`#history`), developer.html (`/dev/customization`) |
| `customers.html` | The customer roster | Nav **Customers** ▸ Customers; "Switch client" | contacts.html, agency.html (`/studio/customers`) |
| `crm.html` | One customer record: deal, billing, project, files, messages, timeline | Rosters, pipeline cards, Inbox threads, ⌘K record search; never in the nav | pipeline.html deal detail (`/sales/deals/:id`), Inbox (`/crm/messages`) |
| `contacts.html` | The people | Nav **Customers** ▸ Contacts; "+ Contact" | customers.html (`/sales/customers`, `/sales/contacts`) |
| `leads.html` | Website form enquiries | Nav **Customers** ▸ Enquiries; Today's "Take care of it →" | Inbox enquiry rows (`/forms/inbox`) |
| `broadcasts.html` | Write and send an update to a list | Nav **Customers** ▸ Broadcasts | — |
| `pipeline.html` | Deals by stage, with proposals, contracts and invoices | Nav **Pipeline**; "+ New deal" | crm.html (deal detail), Today |
| `projects.html` | Projects: tasks, milestones, deliverables, approvals | Nav **Projects**; record | Today (`/projects`) |
| `inbox.html` | One queue: messages, approvals, notices, enquiries | Nav **Inbox**; bell "See everything" | Today, leads.html, attention.html, approval-center.html |
| `files.html` | The file library | Nav **Files** ▸ Files | presence.html `#media` (`/assets`, `/media`) |
| `visual-studio.html` | Make brand images with AI | Nav **Files** ▸ Visual Studio; builder rail | — |
| `analytics.html` | Sales and website numbers | Nav **Analytics** | Today, business-insights.html |
| `schedule.html` | Schedule the draft to publish later | Nav **Website** ▸ Scheduled publishes; Today "What's next" | presence.html publish ritual "Publish later" and the Page ▾ menu (same `POST /schedule`); upcoming.html |
| `connections.html` | Connect Google and other read-only services | Overflow **Connections**; builder rail | — |
| `sharing.html` | Invite client reviewers; choose what they see | Overflow **Settings** ▸ Sharing & access; builder rail | — |
| `developer.html` | Theme tokens, CSS, HTML | Overflow **Settings** ▸ Developer Mode only | presence.html `#design` (`/dev/customization`) |
| `help.html` | FAQ and ask box | Overflow **Help**; shell "?" | the shell's help popover |
| `get-started.html` | First-run: industry and services, then "Build my website" | After sign-up; deal conversion (`onboarding`) | — |

### The lens pages (overflow ▸ *Focused views* and *Understand your site*, plus ⌘K)

| Page | What it is for | Reached from | Same data also on |
| --- | --- | --- | --- |
| `attention.html` | "Website attention": the website-only slice of to-dos | Overflow ▸ Focused views; links from content-tree, website-health, snapshot-history | Inbox. The page calls itself "the website-only cut" of it (attention.html:78) |
| `approval-center.html` | Only the things waiting for your go-ahead | Overflow ▸ Focused views only | Inbox and Today's Needs you (`/portal/feed` reads the same plans) |
| `timeline.html` | "Website story": what happened to the site, by date | Overflow ▸ Understand; attention.html; bell (`approval_decided`, `client_approval`) | crm.html timeline, Inbox activity (`/crm/timeline`, `/crm/activity`) |
| `upcoming.html` | "What's coming next": dated future events | Overflow ▸ Understand only | schedule.html (pending publishes). PR #10's Today *Coming up* card |
| `website-health.html` | Plain-English check-up of the live site | Overflow ▸ Understand; Today "all clear" links | presence.html Domain & email desk (launch checklist). Its actions link back there |
| `snapshot-history.html` | "Version history": saved versions, compare, restore | Overflow ▸ Understand; Today "all clear" links | presence.html `#history`: the same `/publishes`, `/publishes/compare`. Its restore buttons point there |
| `business-insights.html` | Short observations on traffic, search, enquiries | Overflow ▸ Understand; Analytics drill links | analytics.html (same traffic and Search Console sources) |
| `content-tree.html` | "Website map": every page and section with its status | Overflow ▸ Understand; Today "all clear" links; bell (`missing_required`) | presence.html Design ▸ *Content tree* tab; PR #16's overview *Pages* card |

### Agency and operator

| Page | What it is for | Reached from | Same data also on |
| --- | --- | --- | --- |
| `agency.html` | "Studio": client portfolio, cross-client queue, starter kits | Nav **Studio** (agency only); agency landing; "Exit to Studio" | customers.html (`/studio/customers`), analytics.html (`/agency/portfolio`) |
| `admin-health.html` | Operator health center: cron, domains, billing, email, backups | agency.html, only when the staff check passes | — (unique) |
| `admin-growth.html` | Growth partnerships and monthly reviews (legacy `clever-api`, own sign-in) | admin-health.html | — |
| `provision.html` | Internal: generates a partner deploy pack | Nothing links to it | — |

### The client's side

| Page | What it is for | Reached from | Same data also on |
| --- | --- | --- | --- |
| `portal.html` | Client sign-in door (code or magic link, password as a fallback) | "Client login" on the marketing site; emails; set-password default | — |
| `client.html` | The client's whole app. Tabs: Home · Messages · Files · Invoices · Requests · Help; the project record opens in place | Landing for reviewers and managed clients; email links (`?project=`) | Its own tabs repeat Home's queue (by design) |
| `approve.html` | One-tap approve from an email (signed token, no sign-in) | Approval emails only | client.html project record |
| `sign.html` | Accept a proposal or sign a contract, then pay the deposit (Stripe) | Sales emails | crm.html (studio side) |
| `doc.html` | View the document of record | Email links | — |
| `set-password.html` | Invite and recovery landing | GoTrue emails | — |

### Doors, callbacks and retired pages

`studio.html` (owner and team sign-in), `signup.html`, `welcome.html` (after Stripe Checkout), `connections-callback.html` (OAuth return, no UI). Retired and redirecting: `portal-workspace.html` → portal, `dds-studio-manage-9k2p.html` → studio. `mobile.html` is a developer's phone QA checklist.

**Count:** 38 pages that a signed-in person, or a client following an email link, can land on. That is 19 workspace, 8 lens, 4 agency/operator, 6 client, plus studio.html as the owner's door. The owner's menu has **30 destinations**: 17 in the primary bar and 13 in overflow. Of the 30, **9 open a page whose data has another home**: the 8 lenses plus *Scheduled publishes*.

---

## 2. The ten jobs (plus onboarding)

None of these repeat WORKFLOW-MAP's six. For "reply to an enquiry", the map covers turning an enquiry into a customer, not answering it.

**Studio owner**

1. **Publish a change.** Fix the hours or a line of text and put it live.
2. **Schedule a change.** Have it go live on its own at a set time.
3. **Connect a domain.** Move from the temporary address to `yourbusiness.com`.
4. **Add a page.** Add a new page, such as "Catering", to the site.
5. **Reply to an enquiry.** Answer someone who filled in the website form.

**Client**

6. **Sign in.**
7. **Read an update** from the studio.
8. **Approve a change** the studio sent for review.
9. **Reply** to the studio.
10. **Pay an invoice.**

**Onboarding:** sign up → first publish.

---

## 3. The walks

How the walks were counted:

- Each walk starts where a real user starts: Today for the owner, client.html Home for a client, the door page for sign-in and sign-up.
- "Clicks" counts presses on a button, link, tab or menu. Typing into a field counts as a field.
- "Filled button" is the visible button with a solid dark or brand background. A probe in the walk script reads it from computed styles.
- Screenshots are in [`audit/`](audit/). The raw step logs are in [`audit/walks.jsonl`](audit/walks.jsonl), and the scripts that produced them are in [`audit/walks/`](audit/walks/).

| # | Job | Clicks | Fields | Pages | Filled button where it matters? | Leaves Studio OS? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Publish a change | 4 | 1 | Today → Website (Business) → publish ritual | ✓ "Publish · 2", then "Publish these 2 changes" | — |
| 2 | Schedule a change | 4 (ritual) / 3 (schedule.html) | 0 / 1 | Today → Website → ritual; or Today → Scheduled publishes | ✗ in the ritual: "Schedule it" is outlined, while "Publish these 2 changes" stays filled | — |
| 3 | Connect a domain | 5 | 1 | Today → Website → Domain & email desk | ✗ no filled button anywhere in the flow | — (then the registrar) |
| 4 | Add a page | 5 (+3 to live) | 1 | Today → Website (Design) → two dialogs | ✗ Design shows **4** filled buttons at once | — |
| 5 | Reply to an enquiry | 2 | 0 | Today → Enquiries → mail app | ✓ "Reply" on each card (one per card) | **Yes, `mailto:`** |
| 6 | Sign in (client) | 2 | 2 | portal.html → mail → client.html | ✓ "Email me a sign-in link", then "Sign in →" | to read the code |
| 7 | Read an update | 0–2 | 0 | client.html | ✗ none on Home; *Recent updates* starts below the fold (y = 1216) | — |
| 8 | Approve a change | 2 | 0 | Home → project record | ✗ the record shows **4** filled buttons (Approve, Mark done, Choose a file, Send) | — |
| 9 | Reply to the studio | 3 | 1 | Home → Messages | ✓ "Send" | — |
| 10 | Pay an invoice | 2 | 0 | Home → Invoices → Stripe | ✗ Home shows "$1,200 to pay" but no Pay button | **Yes, Stripe tab; nothing confirms back** |
| N | Sign up → first publish | 7 | 3 | signup → get-started → Website preview → ritual | ✓ at every step, until the preview traps you | — |

### 1 · Publish a change: 4 clicks

**Steps:** **Website** (opens the sidebar section) → **Business info** → type the tagline (it saves itself) → **Publish · 2** → **Publish these 2 changes**.

- **Works:** the builder has one filled button, *Publish · N*. The ritual reads every change back in plain words before anything goes live.
- **Costs a click:** *Website* is a dropdown, so every Website job pays two clicks before it starts.
- **Layout jump:** on `main`, the builder swaps the sidebar for a top bar. PR #16 fixes this.
- **Today doesn't help:** Today's only filled button is the concierge **Ask**. Nothing on Today says "you have 2 unpublished changes".

![Business info](audit/o1-publish-1-business.png) ![The publish ritual](audit/o1-publish-2-ritual.png)

### 2 · Schedule a change: 4 clicks, three doors to one action

**Steps:** **Website** → **Publish** → **Publish later — pick a time…** → **Schedule it**. The date is pre-filled for tomorrow.

The same `POST /schedule` has three front doors:

- the ritual's *Publish later* link
- the builder's Page ▾ menu (*Publish later / scheduled changes…*)
- `schedule.html` (nav *Scheduled publishes*), a separate page with its own date field: 3 clicks plus a date

A fourth page, `upcoming.html`, lists the result read-only. Inside the ritual, "Schedule it" is outlined while "Publish these 2 changes" stays filled, so the screen still pushes *publish now*.

![Ritual with the schedule panel](audit/o2-schedule-1-ritual-panel.png) ![schedule.html](audit/o2b-schedule-page-1-schedule-page.png)

### 3 · Connect a domain: 5 clicks, nearly impossible to find

**Steps:** **Website** → **Website** → **Domain & email** (the builder's own side rail) → **I already have a domain** → type it → **Connect it →**. The desk then lists the two DNS records with Copy buttons.

What blocks people:

- **Not in the menu or ⌘K.** Neither the menu nor the overflow says "domain", and ⌘K "domain" returns **0 results**.
- **Buried in a modal.** The desk opens as a modal. The domain card is the second of six cards (Launch, Domain, Records, Security, Email, Hosting).
- **No filled button.** Even *Connect it →* is a text button.
- **The setup checklist goes to the wrong place.** Its "domain" step sends people to the Business view, not to this desk (`viewFor` at presence.html:10240).

PR #16 adds a "Domain & email" link to the builder overview's Tools card. That saves one click but not the search problem.

![Domain & email desk](audit/o3-domain-1-desk.png)

*Fixture note:* after "Connect it" the desk re-reads `/foundations/domain`, which the fixture keeps empty. So the second screenshot shows the intro again under the "Connected — here are your two records" toast.

### 4 · Add a page: 5 clicks to an empty page

**Steps:** **Website** → **Design** → **＋ Page** → type a name → **Next: pick a layout** → **Blank page**. Putting anything on it and publishing adds *＋ Add section* … *Publish · N* → *Publish these N changes*.

- **Hard to find:** "Add a page" exists only as a dashed pill inside Design. ⌘K "page" and "add page" return 0 results.
- **Too many filled buttons:** Design shows four filled buttons at once: *Publish · 2*, the *Home ⋯* page pill, and *＋ Add section* twice. So nothing on the screen says what to do next.

![Design view](audit/o4-add-page-1-design.png) ![Pick a layout](audit/o4-add-page-2-layout.png) ![Page created](audit/o4-add-page-3-created.png)

### 5 · Reply to an enquiry: 2 clicks, then you're in your mail app

**Steps:** Today's Needs-you row **Take care of it →** → Enquiries → **Reply**.

From the Inbox it is also 2 clicks (**Inbox** → the enquiry row → **Reply**). Both Replys are `mailto:` links (leads.html:196, inbox.html:916). The answer is written and sent outside Studio OS. All the app records is "read". The reply never reaches the contact's timeline, so the record (the "hub") can't show that Sam got an answer, or what it said.

![Enquiries](audit/o5-reply-enquiry-1-enquiries.png)

### 6 · Client signs in: 2 clicks, 2 fields, one trip to the mail app

**Steps:** portal.html → email → **Email me a sign-in link** → type the 6-digit code (or tap the magic link, 1 click) → **Sign in →** → client.html.

This works well, with one filled button per step. One thing to watch: clients use `portal.html` and owners use `studio.html`, two doors with two different looks. A client who bookmarks the wrong one is sent on by `landingFor`, so it is not broken.

![Client door](audit/c1-sign-in-1-door.png) ![Code step](audit/c1-sign-in-2-code.png)

### 7 · Client reads an update: 0 clicks in theory, a scroll in practice

The Home page stacks these sections, top to bottom:

1. the greeting
2. the welcome card, which lists the tabs
3. four glance tiles
4. Needs you
5. Recent updates, which starts at y = 1216 on a 1280×800 screen (below the fold)

From the bell it is 2 clicks: **bell** → the notification → the project record. Home has no filled button.

![Client Home](audit/c2-read-update-1-home.png) ![Landed from the bell](audit/c2-read-update-3-landed.png)

### 8 · Client approves a change: 2 clicks

**Steps:** **Review & approve** (Home's Needs-you row) → **Approve** on the project record.

From the email it is 1 click on `approve.html` (signed token, no sign-in). The project record gives *Approve*, *Mark done*, *Choose a file* and *Send* the same filled weight.

![Project record](audit/c3-approve-1-record.png)

### 9 · Client replies to the studio: 3 clicks

**Steps:** **Messages** → the conversation → type → **Send**.

The project record also has a composer in its rail, so a client who is already on the record replies in 1 click.

![Sent](audit/c4-reply-1-sent.png)

### 10 · Client pays an invoice: 2 clicks, then Stripe in a new tab

**Steps:** **Invoices** → **Pay — Design phase →**, which opens Stripe in a new tab.

Home's glance tile says **$1,200 to pay** but offers no Pay button. Rows without a Stripe link say "Your studio will send payment details." After paying, the client comes back to the same "open" row until Stripe's webhook lands. Nothing on the page says "thanks, we're confirming".

![Invoices](audit/c5-pay-1-invoices.png)

### N · Sign up → first publish: 7 clicks, 3 fields, and one trap

**Steps:**

1. `signup.html?plan=presence&trial=1`: name, email, password → **Start my trial**
2. `get-started.html`: **an industry chip** → **Build my website →** → **Review & preview your website →**
3. Website preview: **← Back**
4. **Publish · 6** → **Publish my site**

Each screen has exactly one filled button, which is good.

**The trap:** the preview's **← Back** sits under the shell's top bar (the preview layer is `z-index: 95`, the shell `2147483000`; presence.html:358, shell.css:99). Escape doesn't close it. A real user has to leave through a menu link. The walk had to press the button from a script.

The get-started checklist also promises "Preview it · **Approve it** · Publish". The walk never met an approve step.

![Sign up](audit/n-onboarding-1-signup.png) ![Get started](audit/n-onboarding-2-get-started.png) ![Drafted](audit/n-onboarding-3-built.png) ![The preview: ← Back is under the top bar](audit/finding-preview-back-covered.png) ![First publish](audit/n-onboarding-5-ritual.png)

---

## 4. The lens pages: stay, fold in, or go

Rule used: a page earns its place only if it shows something no home shows, for a job someone does on purpose.

| Lens | Verdict | Why (one sentence) |
| --- | --- | --- |
| `attention.html` — Website attention | **Go → an Inbox filter chip "Website"** | It is the Inbox filtered to website items. Its only extra rows (unpublished or failed content) belong on the Website overview's *Waiting to publish* list. |
| `approval-center.html` — Approvals | **Go → an Inbox filter chip "Approvals"** | Every pending approval already shows in the Inbox and in Today's Needs you. Its "recently approved" history fits as that filter's second section. |
| `timeline.html` — Website story | **Become a tab: "Activity" on the Website overview** | The history of one site belongs on that site's home, the way a customer's history lives on the record. Its bell notices can deep-link to the tab. |
| `upcoming.html` — What's coming next | **Go → Today's *Coming up* card** | PR #10 already builds *Coming up* on Today. Pending scheduled publishes also show inside the publish ritual. |
| `website-health.html` — Website health | **Become a card on the Website overview** | Health is a status, not a destination. PR #16's overview already has a health band that shows only when something is wrong. This page's evidence lines can fill it. |
| `snapshot-history.html` — Version history | **Go → fold into the builder's History** | Same endpoints, and its restore buttons already send you to `presence.html#history`. Two "history" results in ⌘K is the clearest duplicate in the product. |
| `business-insights.html` — Business insights | **Go → a section at the foot of Analytics** | Same traffic and search sources as Analytics, and its own back link says "Back to Analytics". |
| `content-tree.html` — Website map | **Become a card on the Website overview** | PR #16's *Pages* card and Design's *Content tree* tab already show the pages. The map's readiness status belongs on those rows. |
| `admin-health.html` | **Stay** | Operator-only, unique data, never in a customer's menu. |
| `agency.html` — Studio | **Stay, as the agency's Today** | It is the agency's landing page and cross-client queue. Its client roster duplicates Customers and should link there instead of repeating it. |

Net: **−8 pages**. The overflow's "Focused views" and "Understand your site" groups disappear, which takes **8 entries** out of the menu and ⌘K. Bookmarks keep working through 301s in `_redirects`, the same way the clean URLs already do.

Outside the lenses, two more duplicates are worth one line each:

- `schedule.html` should **go into the publish ritual** (see change 3).
- `leads.html` should **become the Inbox's "Enquiries" filter** once replies can be sent in-app (see change 5).

`files.html` vs the builder's Files, and `developer.html` vs Design, are real duplicates too. They are left alone here because each serves a different person (whole library vs. site photos; power user vs. owner).

---

## 5. The five changes, ranked for approval

The ranking is pages and clicks removed for the effort. None of them is started.

| Rank | Change | Pages | Clicks | Effort | Touches |
| --- | --- | --- | --- | --- | --- |
| **1** | **Retire the five pure-duplicate lenses.** attention and approval-center become Inbox filter chips; snapshot-history goes into the builder's History; upcoming goes to Today's *Coming up*; business-insights becomes an Analytics section. 301 each old URL to its new home. | −5 | −1 on every "what needs me / what changed" check (one place, not two); ⌘K "history" → 1 result | **S/M** | `lib/navigation.ts` (drop 5 items), `_redirects`, `today.html` "all clear" links, `workspace.ts` notice hrefs, `inbox.html` (two filter chips), `analytics.html` (insights section), presence `#history` (section diff strip), the 4 specs that cover those pages |
| **2** | **The Website overview absorbs health, the map and the story, and shows the domain.** A health card, page rows with readiness, an Activity tab, and a domain status card with *Connect your domain*. Add "Domain & email" and "Add a page" to `buildNav` so ⌘K finds them. Point the setup checklist's domain step at the desk. | −3 | Domain 5 → 3 (Website → Connect your domain → Connect it); Add a page 5 → 4 | **M** (builds on PR #16's overview) | `presence.html` overview + checklist `viewFor`, `lib/navigation.ts`, `_redirects`, cms.spec, website-health / content-tree specs |
| **3** | **One publish surface.** *Scheduled publishes* opens the ritual's schedule block (`presence.html#publish` with the panel open); `schedule.html` 301s there; "Schedule it" becomes the filled button once the panel is open. | −1 | Schedule 4 → 3, one door instead of three | **S/M** | `lib/navigation.ts`, `schedule.html` → redirect, presence ritual, `today.html` "What's next", schedule.spec (PR #14) |
| **4** | **Client Home leads with the one thing.** The top Needs-you item gets the page's only filled button (Approve, or Pay with the Stripe link). The "$ to pay" tile becomes a Pay button. The welcome card folds after the first visit, so *Recent updates* sits above the fold. The project record keeps Approve filled and makes *Mark done / Choose a file / Send* outlined. | 0 | Approve 2 → 1, Pay 2 → 1, read an update: no scroll | **M** | `client.html` only, portal.spec |
| **5** | **Reply to an enquiry inside Studio OS.** A composer on the enquiry sends through the email service Broadcasts already uses and logs the reply on the contact's timeline. Then the Enquiries list becomes an Inbox filter and `leads.html` 301s to it. | −1 | Reply stays 2 clicks but no longer leaves the app; the record shows the answer | **L** (new send route + timeline write) | a new presence route + `crm/activity`, `inbox.html`, `leads.html` → redirect, `lib/navigation.ts`, crm/inbox specs |

**If all five ship:** 38 → 28 pages, 30 → 22 menu destinations (10 removed: the 8 lenses, *Scheduled publishes* and *Enquiries*; 2 added: *Domain & email* and *Add a page*), and "Needs you" in four places instead of six. No job in this audit would take more than four clicks.

### Bugs found while walking

These are not part of the ranking. They are cheap and each is worth its own small PR.

1. **The website preview traps you (affects onboarding).** `.stage` is `z-index: 95` and `#dds-shell` is `2147483000`, so the shell's top bar covers **← Back**, Draft/Live and the page tabs. Escape doesn't close it. Present on `main`, and none of the open PRs touch it. Screenshot: [`finding-preview-back-covered.png`](audit/finding-preview-back-covered.png). Fix: offset the stage below the shell bar, or raise it above, plus an Escape handler. Touches `presence.html` CSS (and possibly `shell.css`).
2. **The setup checklist's domain step opens Business info**, not the Domain & email desk (presence.html:10240).
3. **Screens with more than one filled button:** the builder's Design view (4) and the client's project record (4). Today's only filled button is the concierge *Ask*, not the next action.
4. **The e2e nav fixture has drifted from `buildNav`.** `STUDIO_NAV` in `tests/e2e/helpers/app.ts` still sends Customers to `crm.html` and has no Pipeline, Projects or Scheduled publishes, so nav specs test a menu no user sees. The walks here use a `REAL_NAV` copied from `buildNav` (`audit/walks/fixtures.ts`).

---

---

## 6. After the five changes: the same walks, re-run on main (Oct 20)

Eric approved all five changes on Oct 20. They shipped as PRs #20–#24 (plus the preview fix, #19), and this section re-runs the walks from section 3 against main at `ed14a1e`, with the same fixtures, the same desktop size and the real menu as it is now. The scripts in [`audit/walks/`](audit/walks/) were updated to the new screens; the new screenshots are in [`audit/after/`](audit/after/), with [`after/walks.jsonl`](audit/after/walks.jsonl) as the step log. The Oct 19 screenshots stay where they were, for comparison.

| # | Job | Before | After | What changed |
| --- | --- | --- | --- | --- |
| 1 | Publish a change | 4 | **4** | Not in scope; unchanged. |
| 2 | Schedule a change | 4 (ritual) / 3 (schedule page) | **3** from the menu (4 on the first re-walk; gap 1 below); **1** from an old Scheduled-changes bookmark | One door instead of three. The schedule panel is on the publish page the moment it opens: **Schedule it** is outlined until the panel has focus, then it is the filled button and publish-now steps back. |
| 3 | Connect a domain | 5 | **3** | **Domain & email** is in the menu and ⌘K finds "domain". The desk opens on "type your domain" with the field already focused. The overview's *Your domain* card is a 4-click route to the same place. |
| 4 | Add a page | 5 | **4** | **Add a page** is in the menu and ⌘K finds "page". It opens the name dialog straight away. |
| 5 | Reply to an enquiry | 2, then your mail app | **2**, all inside Studio OS (3 on the first re-walk; gap 2 below) | The reply is written and sent from the enquiry, kept under it, and marked Replied. The Enquiries page is gone; its nudge opens the enquiry itself in the Inbox's Enquiries view. |
| 6 | Client signs in | 2 | **2** | Unchanged. |
| 7 | Read an update | a scroll (y = 1216) | **0 clicks**, above the fold (y = 686) on every visit after the first | The welcome card shows once; Recent updates sits under Needs you. On the very first visit it is still at y = 1001. |
| 8 | Approve a change | 2 | **1** | **Approve** is on the Home row, the page's one filled button. *See it first* keeps the old route. |
| 9 | Reply to the studio | 3 | **3** | Unchanged. |
| 10 | Pay an invoice | 2 | **1** | *View & pay* on the Home row (y = 562 on a return visit; y = 876 on the first visit, under the welcome card). The *$ to pay* tile is a door to it. Stripe still opens in a new tab. |
| N | Sign up → first publish | 7, with a trap | **7**, no trap | *← Back* on the preview is the topmost element and Escape closes the preview (#19). |

**Pages and menu:** 38 → **28** signed-in pages (the ten retired ones forward to their homes, `?client=` kept), and 30 → **22** menu destinations, exactly as section 5 predicted. ⌘K: "history" → 1 result (was 2); "approv" and "enquir" → Inbox; "domain" and "page" → 1 each (were 0); "health" → 1 again (gap 3 below).

### Gaps the re-walk found

These are honest misses against section 5, each small, none blocking. Four of the five shipped on Oct 20 in one PR (#32, branch `ux/audit-rewalk-gaps`); the walks were re-run on that branch and the table above and the step log carry the new numbers. Gap 4 stays as it is, by design.

1. **Schedule from the menu was 4 clicks, not 3.** The *Scheduled publishes* menu item went away, so the route was Website → Publish → Publish later → Schedule it. **Shipped:** the publish ritual renders the schedule panel the moment it opens (date field, optional offline time, note). The panel *rests* until it holds focus — *Schedule it* outlined, publish-now the filled button — and *arms* while it does — *Schedule it* filled, publish-now quiet — so there is one filled button at every moment. `#schedule` and *Publish later* still open it armed with the date field focused. The *Publish later — pick a time…* opener and *Never mind* are gone. Route now: Website → Publish → Schedule it = **3**. Pinned in `tests/e2e/schedule.spec.ts`.
2. **Reply to an enquiry was 3 clicks, not 2.** Today's nudge landed on the Enquiries *list*, and the row was the second click. **Shipped:** the `lead_followup` notice's href is now `/inbox.html#enquiries?sel=lead:<id>` (`noticeHrefFor` in `workspace.ts`, with the lead id read from the notice's `period` by `leadIdOfNoticePeriod` in `lib/commercial.ts`; the feed, the attention read and the web push all use it; every other kind keeps its kind-only landing). `inbox.html` reads `?sel=` from the hash once at boot and opens that row exactly as a click would. Route now: Take care of it → Send reply = **2**. Edge-function change: needs a `deploy.yml` run after merge. Pinned in `tests/e2e/inbox.spec.ts`, `tests/e2e/today.spec.ts` and `tests/presence/audit_rewalk_gaps_test.mjs`.
3. **⌘K no longer found "health".** Website health is a card on the overview, so the word was gone from the menu. **Shipped:** the Website menu item carries a `desc` ("Your site at a glance: what’s live, the health check and recent activity.") in `lib/navigation.ts`, so ⌘K "health" → Website, 1 result. The wording deliberately avoids "page" and "domain" so those two queries keep returning one destination each. Pinned in `tests/e2e/shell.spec.ts` and the Deno test.
4. **First visit for a client:** the welcome card still pushes Recent updates (y = 1001) and the Pay link (y = 876) under the fold once. From the second visit both are above it. **By design — not changed.** Noted so nobody re-measures it as a regression.
5. **Overview cards depended on `/health` carrying `facts`.** `hbLoadBoardExtras()` ran at the end of `renderFactsProse()`, which returns early without them. Production `/health` always includes them; a fixture without them hid the Domain and Health cards during the re-walk. **Shipped:** `loadToday()` calls `hbLoadBoardExtras()` itself (still once, behind its `HB_ASKED.extras` guard), so the Domain, Health check and Recent activity cards render whatever `/health` says. Pinned in `tests/e2e/cms.spec.ts`.

Everything else in section 5's ranked table is delivered as written.

## Appendix: how to re-run the walks

The scripts are in [`audit/walks/`](audit/walks/). They write screenshots to `docs/design/audit/after/` (set `AUDIT_SHOTS` to change that) and one JSON line per job to `AUDIT_LOG` (default `/tmp/audit-walks.jsonl`). The Oct 19 screenshots in `docs/design/audit/` are the originals from before the changes.

```bash
npx playwright test -c docs/design/audit/walks/playwright.walks.config.ts
```

- The config serves the repo on port **4198**. WebKit refuses 4190, and 4173 is often held by another checkout's server.
- It blocks service workers (the PR #12 lesson) and pins UTC.
- It runs desktop Chromium only.
- Nothing under `docs/` is part of the e2e suite or the deployed site (`_redirects` 404s `/docs/*`).
