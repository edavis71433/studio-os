# The agency's seat: how the leaders run clients, sales, delivery and money — October 2026

**What this is:** the market research behind [STUDIO-AUDIT-2026-10.md](../STUDIO-AUDIT-2026-10.md), the studio-side companion to [market-benchmark-2026-10.md](market-benchmark-2026-10.md). That report looked at the business owner and the client. This one looks only at the **agency owner's own seat**: onboarding a client from zero, the client roster, acting on a client's behalf, selling, delivering, invoicing, the inbox, access, health and the agency home. Ten questions, researched on 2026-10-20, with the vendors' own help centres preferred and anything older than 2025 flagged. Products: HoneyBook, Dubsado, Bonsai, Moxie, 17hats, Basecamp, Productive, HubSpot, Pipedrive, Attio, plus Duda, Wix Studio and AgencyAnalytics where an agency website platform is the better comparison.

**The short version.** The agency tools agree on more than they differ. A new client is one form that creates the contact and the project together, with a passwordless portal that starts off and is switched on by the owner; nothing is seeded, and nobody provisions a website in the same breath. The roster is a table with pickable columns, chips and one-column sort, thin on bulk actions, and no vendor has a cross-client "needs me" queue. Acting for a client means a read-only preview almost everywhere, a real impersonated tab only in Moxie, and a client-approved, expiring, audited partner seat only in HubSpot. Selling is one document the client walks through in order, with the pipeline stage moving itself when the contract is signed, and a deposit invoice minted from the agreement. Delivery has a true client approve/decline only in Basecamp and Moxie, with reminders a day before and daily after. Money is four buckets on the home screen, three reminders by default, and a billing page that wraps Stripe rather than exposing it. The inbox is one list of threads anchored to projects, sent through the owner's own mailbox, with reply, mark and archive and almost no keyboard. Access is a global team role plus per-project membership, clients never seats, and "preview as client" near-universal but "who saw what" almost never logged. Nobody has an operations dashboard; health is inline icons, a feed and an email, and a status page. The agency home is a client list with health columns and a "today" strip of unanswered leads, unread messages, tasks and this month's payments.

Each section below is one question, in three parts: the converged pattern, the notable variants, and the numbers. Every claim links its source inline. The merged source list is at the end.

---

## Q1. Onboarding a new client from zero

### Converged pattern

Every studio-CRM collapses "new client" into **one form that creates two objects at once: a project (or company) plus an inline contact**, then treats the client portal as a per-project/per-contact switch rather than a separate invite. Dubsado's New Project form requires only title, contact ("choose an existing contact or create a new one") and a status, and "when a new contact is created, the information you entered is automatically saved" to Contacts ([Dubsado help](https://help.dubsado.com/en/articles/11402636-creating-projects)). HoneyBook's web flow is three clicks (+ New > Project, name + project type, Create project) and the mobile flow adds a fourth screen, "Next: add client to project", which you can Skip ([HoneyBook help](https://help.honeybook.com/en/articles/2209127-how-to-start-working-with-a-client)). Moxie's quick-add needs only the client's name ([Moxie help](https://help.withmoxie.com/en/articles/5776772-add-your-first-client)); Bonsai's New Company form has the company name as the "only required field" and contacts "can be created independently" and attached later ([Bonsai help](https://help.hellobonsai.com/en/articles/452120-how-to-create-and-manage-companies-and-contacts)). 17hats creates "a contact profile and project" immediately when a lead-capture form is submitted; manual contacts get a project added afterwards ([17hats help](https://help.17hats.com/en/articles/3110621-adding-contacts-to-17hats)).

The second convergence: **no client password at creation time.** HoneyBook clients get "loginless access" from any file or email sent through the system, and the general portal link offers magic-link, numeric code or optional password ([HoneyBook help](https://help.honeybook.com/en/articles/11095702-how-your-clients-log-into-the-client-portal)). Dubsado's client-specific link "doesn't require a password"; the client signs in with email only, and a password is needed only for the public/embedded login ([Dubsado help](https://help.dubsado.com/en/articles/15920579-share-the-client-portal)). Bonsai provides "access through a secure email link" ([Bonsai help](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal)). Moxie "does not send an automatic email when you enable portal access", so the owner shares the URL; the client needs no Moxie account ([Moxie help](https://help.withmoxie.com/en/articles/8238276-client-portal-client-access-and-login)). 17hats auto-creates "a portal for each contact" and delivers a tokenized link, with PIN optional ([17hats help](https://help.17hats.com/en/articles/1131267-client-portal-overview)).

Third: **the portal starts off and the owner flips it.** Dubsado: "Every client portal starts out deactivated"; activation is Projects > project > View details > Portal card > toggle (5 clicks) and can be automated by an "Activate Portal" flow action, but no flow action can set a password ([Dubsado help](https://help.dubsado.com/en/articles/15920580-activate-or-deactivate-client-portals)). HoneyBook auto-creates the portal per project, and sharing the general link is optional ([HoneyBook help](https://help.honeybook.com/en/articles/9468117-how-to-share-the-client-portal)).

Agency PM / website tools invert the order: **company first, then project, then an explicit invite that does create a login.** Productive's New company form takes short name, domains, legal name, Tax ID and default financial settings (currency, tax rate, payment terms, invoice template) that "apply automatically when creating deals, budgets, or invoices" ([Productive help](https://help.productive.io/en/articles/2179668-companies)); its 6-step project wizard (client/internal > scratch/template/AI > name, PM, workflow, client company > tabs > people access > budget) lets you create the company inline from the client dropdown ([Productive help](https://help.productive.io/en/articles/2179613-creating-a-new-project)). Clients are then invited from avatar > Invite people > Client > pick company > emails, and "Inviting clients to Productive is free" ([Productive help](https://help.productive.io/en/articles/2179579-inviting-clients-to-productive)). Basecamp adds clients inside the project: People icon > "Who can see this project" > Clients tab > type name or pick from a company > optional company name and note > Send invites; "Everything in a client project is private to your team by default" ([Basecamp help](https://5.basecamp-help.com/article/1081-working-with-clients)), and templates can carry the "Work with clients" switch so new projects inherit visibility ([37signals update](https://updates.37signals.com/post/new-in-basecamp-client-access-on-templates)).

Website builders create **site, then client account, then a per-site grant**. Duda: Clients & Team > Client Management > create client (name + email) > "Assign site" + permissions; the client's Access tab generates a set-up URL, valid 30 days, and "they will need to define their password" ([Duda help](https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients)). Client accounts "are granted access on a site-by-site basis" with named permissions (STATS_TAB, EDIT, PUBLISH, REPUBLISH, DEV_MODE, SEO, CUSTOM_DOMAIN, SEO_OVERVIEW; DEV_MODE requires EDIT) ([Duda developer docs](https://developer.duda.co/docs/access-permissions)). The invitation email (White Label > Client Invitation) is account-wide: "no option to customize it per client" ([Duda product update, 2019](https://www.duda.co/product-updates/client-invitation)). Wix Studio is 6 clicks: Sites > Collaborators icon > Invite People > email > role checkbox > Send Invite > pop-up "Client" > Done; marking as Client tailors the email/landing page and sets their Studio Editor to content mode; invites are valid 30 days and the client must "log into Wix or create an account" ([Wix help](https://support.wix.com/en/article/wix-studio-inviting-a-client-to-join-a-site)). A Client Kit (Client Kits > Create > choose site > add files/tutorial videos > agency details > add as collaborator or transfer ownership > Save) is the "starter kit" artefact; the invitation "will guide them directly to their site dashboard" ([Wix help](https://support.wix.com/en/article/wix-studio-creating-a-client-kit-5293562), [Wix help](https://support.wix.com/en/article/wix-studio-faqs-using-the-workspace)).

### Notable variants

- **Seeding from a template is the exception, not the rule.** Only Productive (project templates/AI, custom field values "always copied") ([Productive help](https://help.productive.io/en/articles/2179613-creating-a-new-project)), Basecamp (template visibility) and AgencyAnalytics (Client Templates: "dashboard sections or reports added to the Client Template will be generated when this template is used to create a Client", showing demo data until sources connect) seed content at creation ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/10389651-create-and-manage-client-templates)). AgencyAnalytics' Add Client takes a website URL plus advanced settings (template, timezone, group, country) ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/10344666-create-and-manage-clients)).
- **CRMs have no client object to invite.** HubSpot's Create company is CRM > Companies > Create company > properties (more fields appear after name or domain) > associate records > Create / "Create and add another" ([HubSpot help](https://knowledge.hubspot.com/records/create-companies)); a client login only exists via the Service Hub Pro/Enterprise customer portal, which emails "a simple registration email" to access-group contacts or allows self-registration ([HubSpot help](https://knowledge.hubspot.com/inbox/set-up-a-customer-portal)). Pipedrive adds people/orgs from "+ Person"/"+ Organization" or inside the Add deal dialog; a deal links to one person and one org ([Pipedrive help](https://support.pipedrive.com/en/article/contacts-people-and-organizations)). Attio creates records from cmd/ctrl+K "Add [object]" or the "+" column header, with no mandatory fields but a recommendation to "include a domain for companies" for dedupe/enrichment ([Attio help](https://attio.com/help/reference/managing-your-data/records/create-and-view-records)). Neither Pipedrive nor Attio offers a client portal.
- **Bonsai renamed Clients to Companies** and decoupled contacts, so one contact can sit under several companies and you "can't remove the last contact from a company with active records" ([Bonsai help](https://help.hellobonsai.com/en/articles/15166148-clients-is-now-companies-what-s-changing-in-bonsai)).
- **17hats** lets the portal link go out manually from a pre-built "E-mail Link" template or automatically in a workflow; "the platform will automatically remove the password information if you do not set a password" ([17hats help](https://help.17hats.com/en/articles/3160537-client-portal-giving-contacts-access)).
- **Productive client visibility tiers**: Client Collaborators (Essential) see projects/tasks; Client Leads (Pro/Ultimate) also see budgets and time; folders with Client access off stay hidden ([Productive help](https://help.productive.io/what-can-a-client-see-on-a-project)).

### The numbers

| Product | Objects created | Screens/clicks to project + invite | Client receives | Password? |
|---|---|---|---|---|
| HoneyBook | Project (+ contact) | 3 web / 4 mobile | File/email with loginless link | Optional; magic link or code |
| Dubsado | Project + contact | 1 form + 5 clicks to activate portal + Share | Email from template (manual send) | Optional; email-only login |
| Moxie | Client (+ contacts, projects) | 1 quick-add; portal toggle per contact | Nothing automatic; owner shares URL | No account |
| Bonsai | Company (+ contact) | 1 form; copy portal link | Secure email link | None |
| 17hats | Contact + project | Form; portal auto-created | Tokenized email, optional PIN | PIN optional |
| Basecamp | Project, then client company + users | 1 page, 5 steps | Invite email | Account |
| Productive | Company > Project > client user | 1 form + 6-step wizard + 3-step invite | Invite email, free seat | Account |
| Duda | Site > client account > per-site grant | 3 screens; set-up URL valid 30 days | Account-wide invitation email | Client sets password |
| Wix Studio | Site > collaborator invite (+ Client Kit) | 6 clicks; invite valid 30 days | Tailored email + site dashboard | Wix account |
| HubSpot | Company (+ contacts); portal optional | 1 panel; portal setup 7 steps | Registration email (Service Pro+) | Client registers |

## Q2. The client roster / portfolio home

### Converged pattern

The roster is a **project or company table with user-selectable columns, chip filters, single-column sort, and a status/stage grouping**; money and "next action" appear only where the tool bills. Dubsado's Projects page shows Project, Contact, Company, Status, Contract, Flow, Amount Paid, Project Date, Assigned to, Tags, Project Source, Created Date and custom fields; tabs are All/Leads/Jobs/Archived; filters are client, project dates, assignee, tags, created date; sort is Name, Client, Status, Project Date or Created Date; Board view groups by Status, Client, Source, Assignee or Tags; Export CSV covers "only projects visible in your current view and filters" ([Dubsado help](https://help.dubsado.com/en/articles/12856226-the-projects-page)). HoneyBook's pipeline sorts by name, date, type, "Moved" (date entered current stage) and Recent activity (payments and e-signatures), filters by project type, tags, lead sources and Gmail leads with AND logic, and surfaces overdue-task indicators when the Task column is on; custom views (up to 5 per company) each save filters, columns and sort ([HoneyBook help](https://help.honeybook.com/en/articles/5758575-how-to-navigate-your-pipeline)). Moxie's Clients list toggles Active/Archived/All, filters by record type, has-contacts and any custom field, switches card/table, sorts by column header and saves personal views; starring adds a client to Favorites ([Moxie help](https://help.withmoxie.com/en/articles/16179848-find-and-organize-your-clients)).

**Bulk actions are thin outside CRMs.** Dubsado: checkbox-select in Table view (not Board) to archive, delete or change status; projects with a contract cannot be deleted ([Dubsado help](https://help.dubsado.com/en/articles/14189991-taking-bulk-actions)); a March 2026 release adds bulk email, max 400 per rolling 24 h, Dubsado 3.0 only ([Dubsado updates](https://updates.dubsado.com/131749-project-action-suggestions-more-bulk-actions)). HoneyBook's and Moxie's roster articles list no bulk actions. CRMs are the opposite: HubSpot's action bar offers Assign, Edit property, create tasks (current page only), add to static segment and delete (needs Bulk delete permission), with "Select all [number] records" across pages ([HubSpot help](https://knowledge.hubspot.com/records/bulk-edit-records)); its index pages add column filters (cleared on refresh unless saved), quick filters and AND/OR advanced filters, with cross-object filtering unavailable past two million associations ([HubSpot help](https://knowledge.hubspot.com/records/view-and-filter-records)). Pipedrive organizations list: Schedule activities (max 100 at once, Growth+), Enrich items (Premium+), Delete, and bulk-edit of owner, labels, address, website, industry, revenue, employees and custom fields; filters are per item type ([Pipedrive help](https://support.pipedrive.com/en/article/bulk-editing-and-filtering)), with columns via the gear icon and "+" to add ([Pipedrive help](https://support.pipedrive.com/hc/en-us/articles/360000146149-List-View)). Attio table views allow stacked filters convertible to And/Or groups, multi-attribute sort, "Current user" owner filters, and saved settings shared with everyone on the view ([Attio help](https://attio.com/help/reference/managing-your-data/views/filter-and-sort-views)); bulk edits are drag-select plus copy/paste or CSV import, and multi-card kanban moves ([Attio help](https://attio.com/help/reference/managing-your-data/lists/bulk-updating-lists), [Attio help](https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views)).

**Website dashboards are site lists, not client lists.** Duda's Project List filters by Labels, Creation Date, Last Published Date, Site Comments and Status, sorts by publish date, creation date and site name, supports saved views and labels, and only Account Owners/Staff can export CSV ([Duda help](https://support.duda.co/hc/en-us/articles/26519246713751-Project-List)); Site Overview is "the default dashboard for clients with a single site" ([Duda product update, 2020](https://www.duda.co/product-updates/introducing-site-overview)). Wix Studio's Sites list filters by editor type, Premium plan, publish status, site ownership and tags (max 100 tags per account and per site, List View only), offers "Manage View > Save as new view" shared with teammates, and bulk Assign Tags / Move to Folder ([Wix help](https://support.wix.com/en/article/wix-studio-managing-sites-in-a-workspace)); separate tabs cover Client Reports (monthly analytics emails per client) and Billing & Subscriptions, which shows "which subscriptions need renewing, which ones are unassigned, and if any have payment problems" ([Wix help](https://support.wix.com/en/article/wix-studio-a-tour-of-the-workspace)).

### Notable variants

- **Cross-client "needs me" queue is essentially absent.** The closest are HoneyBook's overdue-task indicator and Recent-activity sort "to see recent projects that may require follow up" ([HoneyBook help](https://help.honeybook.com/en/articles/5758575-how-to-navigate-your-pipeline)); AgencyAnalytics' Data section, which shows green Connected / red Disconnected for "every integration for all your clients" ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/3530399-manage-data-sources-or-integrations)); and HubSpot's Sales workspace company tab with saved views and quick filters ([HubSpot help](https://knowledge.hubspot.com/prospecting/manage-companies-in-the-sales-workspace)).
- **Basecamp's home is a project grid, not a roster**: list-view filters are everything, pinned, projects, teams, "projects with clients", and archived+deleted ([37signals update, 2022](https://updates.37signals.com/post/new-refined-home-screen-participation-types)).
- **Productive's Companies page** "includes filters to help you search and organize results" but the help article names no columns or bulk actions beyond CSV import ([Productive help](https://help.productive.io/en/articles/2179668-companies)).
- **17hats** has no roster article; contacts carry a colored type (Hot Lead orange, Client green, Cold Prospect blue, Other grey) and tags drive filtering and bulk actions ([17hats help](https://help.17hats.com/en/articles/924376-17hats-contact-types)).
- **HoneyBook separates client from project**: the contact workspace shows "the full history with a client: emails, payments, files, and multiple projects" for lifetime value ([HoneyBook help](https://help.honeybook.com/en/articles/9055403-managing-clients-in-honeybook)).

### The numbers

- Dubsado: 12 standard columns, 4 tabs, 5 filters, 5 sorts, 5 group-bys, 3 bulk actions, 400 bulk emails/24 h.
- HoneyBook: 5 sorts, 4 filter dimensions, 5 custom views per company, 0 bulk actions documented.
- Moxie: 3 lifecycle states, card/table, personal saved views, favorites.
- HubSpot: select-all across pages; bulk delete gated by permission; 2M-association cap on cross-object filters.
- Pipedrive: 100 activities per bulk schedule; enrichment Premium+; filters do not cross item types.
- Duda: 5 filters, 3 sorts, CSV export owner/staff only. Wix Studio: 100 tags/account, 100 tags/site, 2 bulk actions.

## Q3. Acting on behalf of a client

### Converged pattern

**Studio CRMs give a read-only "preview as client"; nobody gives a true operator session.** HoneyBook: Projects > project > Client portal card > View & edit opens a preview where "upload, message, and Settings actions are blocked"; "the client portal preview is read-only" ([HoneyBook help](https://help.honeybook.com/en/articles/6428603-your-clients-experience-with-the-client-portal)). Bonsai: Client Portal > Portals > select client > Preview "exactly what a specific client will see", with no messaging or edits ([Bonsai help](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal)). Moxie is the outlier that comes closest to impersonation: "View portal as..." in the [...] menu opens a new tab logged in as that client ([Moxie help](https://help.withmoxie.com/en/articles/8238276-client-portal-client-access-and-login)). Dubsado's "View portal" only "opens the client's portal login page in a new tab so you can preview it before sharing" ([Dubsado help](https://help.dubsado.com/en/articles/15920579-share-the-client-portal)). Basecamp's current client article documents visibility toggles and removal ("they lose access immediately and won't be notified") but no see-as-client mode ([Basecamp help](https://5.basecamp-help.com/article/1081-working-with-clients)). 17hats, Productive, Pipedrive and Attio document nothing of the kind.

**Website builders solve it structurally: the agency is already the account, the client is the guest.** Duda team members "have access to all sites in an organization" while clients are scoped per site ([Duda developer docs](https://developer.duda.co/docs/access-permissions)), so there is no "log in as"; the agency simply edits. Wix Studio flips it when the client owns the site: Wix Partners > Contacts > client card > More Actions > Request Site Access > describe site, pick role, send; the client approves by email and the agency then accepts the invite ([Wix help](https://support.wix.com/en/article/wix-partners-requesting-to-collaborate-on-a-clients-site)). Webflow's Guest role lets a client Workspace invite an agency to specific sites with per-site Editor/Admin roles; guests are "free to add" on supporting site plans, and "clients decide who gets access, what they can do, and which sites they can see" ([Webflow University](https://university.webflow.com/videos/guest-role)). Site transfer sends the client an email; they log in or create an account, add a card and re-authenticate third-party apps; the site shows locked until accepted ([Webflow help](https://help.webflow.com/hc/en-us/articles/33961238786963)). Client payments keeps the site in the agency Workspace with the client paying hosting, "one client attached to a site at any given time", Agency/Freelancer plans ([Webflow help](https://help.webflow.com/hc/en-us/articles/35335039878035)).

**HubSpot formalizes agency access as a client-approved link.** Partner > Client Access Manager > Get access link > send; "once a client opens and approves your access link" the employee is created in the client portal as Partner Admin on a free Partner Seat; Partner Admins cannot add/remove Super Admins, change billing or manage Sensitive Data, and the relationship ends 60 days after the last qualifying activity once all employees are removed ([HubSpot help](https://knowledge.hubspot.com/partner-tools/manage-partner-employee-access-to-client-accounts)).

**OAuth on behalf of a client: reporting tools do not natively send a "connect your Google" link.** AgencyAnalytics connects GA4 under whichever Google login you use (needs Analyst/Editor/Admin on account and property) ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/8070783-connect-google-analytics-4)); the client-side route is to create a Client user, because "you can allow client users to connect their own integrations" ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/9774477-create-and-manage-users)). DashThis authorizes from the agency's own account per integration, with GA4 auto-adding data sources ([DashThis help](https://help.dashthis.com/connect-data-sources)). Semrush needs "at least Viewer access" on GA and Owner/Full on GSC under "your Google account" ([Semrush KB](https://www.semrush.com/kb/778-connect-my-google-accounts)); its Client Portal (5/20/unlimited portals by AGK tier) was sunset 30 April 2025 in favor of hashed-link online dashboards ([Semrush KB](https://vi.semrush.com/kb/1167-client-portal), [Semrush KB](https://pl.semrush.com/kb/1546-agency-growth-kit-sunsetting)). The "send the client a link, they approve in Google's OAuth screen" pattern lives in dedicated access tools such as AgencyAccess and Leadsie ([AgencyAccess](https://www.agencyaccess.co/integrations/google), [Leadsie](https://www.leadsie.com/blog/how-to-give-or-request-access-to-google-analytics)) and, for Wix, in the GSC Connection API ("Call Get Connect URL and surface the returned URL to the person connecting") ([Wix dev docs](https://dev.wix.com/docs/api-reference/business-management/seo/google-search-console/connection-v1/introduction)).

**Analytics on a client site is a paste-an-ID job by the agency.** Duda: Seo & Settings > Google Tools > paste G-/AW- tag, auto-saved ([Google help for Duda](https://support.google.com/analytics/answer/12027742)); Duda's free Search Console app verifies and submits the sitemap with a Google sign-in and requires SSL ([Duda help](https://support.duda.co/hc/en-us/articles/4410641708823-Google-Search-Console)). Wix: Premium + connected domain; Marketing Integrations > Connect Google Analytics > paste ID (article still shows UA format and says GA4 "is not currently supported", so treat as stale) ([Wix help](https://support.wix.com/en/article/adding-google-analytics-to-your-wix-site)); Search Console via SEO Setup Checklist > Connect to Google, owners and admin collaborators only, usable once ([Wix help](https://support.wix.com/en/article/connecting-your-site-to-google-in-the-wix-seo-setup-checklist)).

### Notable variants

- Moxie's "View portal as" is a real impersonated tab; HoneyBook/Bonsai previews block writes; Dubsado previews only the login page.
- HubSpot's customer portal (client-facing) and partner access (agency-facing) are separate systems; the latter is the only documented client-approved, revocable, 60-day-expiring agency seat ([HubSpot help](https://knowledge.hubspot.com/partner-tools/manage-partner-employee-access-to-client-accounts)).
- Duda's SSO docs cover app-in-iframe SSO, not an agency "log in as client" ([Duda developer docs](https://developer.duda.co/docs/app-sso)).
- Webflow has three access modes (guest, transfer, client payments) versus Wix Studio's two (collaborator, transfer) ([Webflow help](https://help.webflow.com/hc/en-us/articles/33961238786963), [Wix help](https://support.wix.com/en/article/wix-studio-creating-a-client-kit-5293562)).

### The numbers

- HoneyBook preview: 4 clicks, read-only. Bonsai: 4 clicks. Moxie: 1 menu item, full session.
- HubSpot partner access: 6 steps own link / 4 steps for a colleague; 60-day expiry after last activity; 3 blocked capabilities.
- Wix Studio request access: 5 steps + client approval + accept; collaborator invites valid 30 days.
- Webflow transfer: recipient has 7 days to accept per Webflow's lesson (snippet); client payments: 1 client per site.
- Duda client set-up URL: 30 days. Semrush portals: 5 / 20 / unlimited (sunset).
- GA permissions needed by the connecting login: AgencyAnalytics Analyst+; Semrush Viewer+ (GA), Owner/Full (GSC).

---

## Q4. Proposal → agreement → deposit, from the vendor's seat

### Converged pattern

Every tool starts the send from the client/deal record, not from a documents library. In the all-in-one studio tools the proposal, contract and invoice are **one document** the client walks through in order: HoneyBook's proposal smart file "should include an invoice block and a contract block", with payment schedule, payment-method and autopay options set inside the invoice block ([HoneyBook help](https://help.honeybook.com/en/articles/5748069-recreating-your-legacy-proposal-files-as-smart-files)); Dubsado's proposal form has "Include contract" and "Include invoice" toggles, the client signs after submitting and before reaching the invoice, and an invoice is generated from the chosen packages even if hidden ([Dubsado help](https://help.dubsado.com/en/articles/14426383-connect-a-contract-and-invoice-to-a-proposal)); 17hats "combined documents" tick contract/invoice boxes on a quote, the client cannot sign until the quote is accepted, and the invoice is not generated until the quote is accepted (and contract signed) ([17hats help](https://help.17hats.com/articles/924358-combined-documents)). Moxie's proposal carries fee-schedule, project/task and contract-terms blocks; a Payment block can collect money at acceptance, and a fully executed agreement generates projects, tasks and a deposit invoice that "waits in your invoices list, where you approve it to send it" ([Moxie help](https://help.withmoxie.com/en/articles/6307977-faq-s-about-agreements)). Bonsai is the **three-document chain**: proposals live under More > CRM > Proposals, are built from a template, tied to a client+project, and sent by email or link; an "automatically create an invoice on acceptance" option generates the invoice for the selected packages ([Bonsai help](https://help.hellobonsai.com/en/articles/5616844-all-about-proposals), [Bonsai help](https://help.hellobonsai.com/en/articles/2157748-automating-invoices-when-your-proposals-are-accepted)).

The CRMs are different animals. HubSpot's quote is created from the Quotes card on the deal, built in a single editor (header, parties, line items, terms, payments, acceptance), with acceptance by e-sign, print-and-sign or none, then shared by link, PDF or email ([HubSpot KB](https://knowledge.hubspot.com/quotes/create-and-send-quotes)); e-sign is Dropbox Sign, quotes show "Pending signature" on the index, countersigners are emailed when the buyer signs, and buyer/countersign/accepted events are workflow triggers that can move deal stage ([HubSpot KB](https://knowledge.hubspot.com/quotes/use-e-signatures-with-quotes), [HubSpot KB](https://knowledge.hubspot.com/workflows/set-event-enrollment-triggers)). Pipedrive Smart Docs creates a proposal from the deal's Documents tab with bracketed merge fields filled from the deal, shares a trackable link with open notifications, and requests e-signatures from the same screen ([Pipedrive KB](https://support.pipedrive.com/en/article/smart-docs), [Pipedrive KB](https://support.pipedrive.com/en/article/sales-documents-esignatures-beta)). Attio has **no native quote, e-sign or invoice**: its Deals object carries stage and value only, and quoting/invoicing arrives via third-party apps such as Hyperline (quotes from deals, invoices synced in as custom objects) ([Attio help](https://attio.com/help/reference/managing-your-data/objects/manage-standard-objects), [Attio app](https://attio.com/apps/hyperline)).

**After send**, all studio tools show the file status on the project and notify on signature: HoneyBook notifies by email and in the mobile app when a contract is signed ([HoneyBook help](https://help.honeybook.com/en/articles/5192723-using-smart-files-for-contracting)); Bonsai colour-codes proposals green/accepted, dark-grey/outstanding, light-grey/unsent and emails you on acceptance ([Bonsai help](https://help.hellobonsai.com/en/articles/5616844-all-about-proposals)); 17hats emails "A quote has been accepted" ([17hats help](https://help.17hats.com/en/articles/1967185-automatic-confirmation-emails-that-send-from-17hats)); Moxie fires sent/viewed/signed events for agreements ([Moxie help](https://help.withmoxie.com/en/articles/8842439-agreement-v2-webhook-events)); Pipedrive emails you when someone signs or declines and mails the signed PDF plus audit trail to all parties ([Pipedrive KB](https://support.pipedrive.com/en/article/sales-documents-esignatures-beta)).

**Stage automation on acceptance** is native in HoneyBook (pipeline automations move the project on "contract signed", "proposal signed", "first payment received", with triggers for Contract is signed / First payment paid / Invoice paid in full and a Move pipeline stage action) ([HoneyBook help](https://help.honeybook.com/en/articles/2463528-how-to-customize-your-pipeline), [HoneyBook help](https://help.honeybook.com/en/articles/9519175)); in Dubsado via workflow triggers "After Contract Is Signed by Client" and "After Invoice Paid in Full" plus a Change Project Status action ([Dubsado help](https://help.dubsado.com/en/articles/467074-creating-workflows-in-2-0)); in HubSpot via quote-event workflows; and absent in Pipedrive, whose community has asked since 2023 for a signed-document trigger ([Pipedrive community](https://community.pipedrive.com/discussion/7377/feature-request-automation-trigger-for-smart-docs-signing)).

### Notable variants

- **Deposit handling.** Moxie builds a deposit invoice from the agreement's payment terms and lets a deposit's paid amount be applied to later invoices ([Moxie help](https://help.withmoxie.com/en/articles/6050935-deposits)). Bonsai generates the invoice on acceptance when auto-invoice is on *or* the proposal requires a deposit ([Bonsai help](https://help.hellobonsai.com/en/articles/5616844-all-about-proposals)). HubSpot, with automatic contract creation in the Connected CPQ/Billing beta, creates a contract and sends the first invoice immediately on acceptance ([HubSpot KB](https://knowledge.hubspot.com/quotes/create-and-send-quotes)).
- **Public proposals.** Dubsado's public proposal can "Create new project once proposal is completed" and set its Lead/Job status ([Dubsado help](https://help.dubsado.com/en/articles/14363226-how-to-set-up-a-public-proposal)).
- **Approval gates.** HubSpot quotes can require internal approval before send, with in-app and email notifications on request/approve/changes ([HubSpot KB](https://knowledge.hubspot.com/quotes/create-and-send-quotes)). Dubsado's "Require approval before completing this action" holds a workflow step and emails you if you forget ([Dubsado help](https://help.dubsado.com/en/articles/467074-creating-workflows-in-2-0)).
- **Edits after acceptance.** 17hats forces re-acceptance and re-signing if an attached contract/invoice changes ([17hats help](https://help.17hats.com/articles/924358-combined-documents)); HoneyBook requires notifying the client, and sometimes re-signing, after editing a seen file ([HoneyBook help](https://help.honeybook.com/en/articles/5371221-share-your-smart-files)).
- **Document reminders.** 17hats quote/contract reminders default to 1 day before due, 1 day after, then monthly, stopping after 12 ([17hats help](https://help.17hats.com/en/articles/2280471-email-settings-document-email-reminders)). Pipedrive lets you send a manual reminder on a "Sent" signature request; requests expire after 60 days ([Pipedrive KB](https://support.pipedrive.com/en/article/sales-documents-esignatures-beta)). HubSpot has no quote reminder; the community workaround is a quote-based workflow notification ([HubSpot community](https://community.hubspot.com/t/quote-e-signature-notification/34025)).
- **Where the signed PDF lives.** Pipedrive stores it in your connected Google Drive/OneDrive/SharePoint; Smart Docs will not work without one ([Pipedrive KB](https://support.pipedrive.com/en/article/smart-docs)).

### The numbers

- HoneyBook send: open file → Share → email or Copy link; 2 screens. Pipeline: no cap on manual stages, some auto-created flows cap at 20, up to 5 custom views; group stages (opportunities vs projects) cannot be renamed ([HoneyBook help](https://help.honeybook.com/en/articles/2463528-how-to-customize-your-pipeline)). Automations need Essentials or Premium ([HoneyBook help](https://help.honeybook.com/en/articles/2641806-beginner-s-glossary)).
- Dubsado: one contract per proposal; "Multiple packages can be selected" defaults to Yes; redirect URL disabled when contract/invoice attached ([Dubsado help](https://help.dubsado.com/en/articles/14426383-connect-a-contract-and-invoice-to-a-proposal)).
- HubSpot: Revenue Hub seat required to create quotes; e-sign allowance per user/month Revenue Hub Pro 25, Enterprise 50; Sales Hub Starter/Pro 10, Enterprise 30; emailed PDFs over 20 MB are not attached ([HubSpot KB](https://knowledge.hubspot.com/quotes/use-e-signatures-with-quotes), [HubSpot KB](https://knowledge.hubspot.com/quotes/create-and-send-quotes)). Quote-based workflow triggers need Commerce Hub Pro/Enterprise ([HubSpot KB](https://knowledge.hubspot.com/workflows/set-event-enrollment-triggers)).
- Pipedrive: e-sign steps = create/upload doc → Request signatures → signers → fields → Send (5); up to 10 signers and 1,000 fields per document; Premium/Ultimate unlimited (fair use), Lite/Growth add-on 30 or 100 requests/month with a 14-day/5-signature trial ([Pipedrive KB](https://support.pipedrive.com/en/article/sales-documents-esignatures-beta)).
- 17hats: quote line items can be standard, "Choose One" or "Choose Any"; quote options include display title, valid-until date, tax, discount ([17hats help](https://help.17hats.com/en/articles/1698294-quote-templates)).

---

## Q5. Delivering the work and getting client approval

### Converged pattern

Projects are created from the won deal or from a template, and only four tools have a true client-facing **approve/decline** on a deliverable: Basecamp, Moxie, and (with caveats) HoneyBook and 17hats via document sign-off; the rest are comments-only.

**Creation.** Productive's won-deal dialog offers: create project + budget from the deal's services, add budget to an existing project, budget without project, or nothing; a deal is marked won by the Won button or by dropping it in the pipeline's Won stage ([Productive help](https://help.productive.io/winning-a-deal)). The Projects-tab wizard has six steps (client, scratch/template/AI, details, tabs, people, budget) ([Productive help](https://help.productive.io/en/articles/2179613-how-to-create-a-new-project)); templates don't carry budgets ([Productive help](https://help.productive.io/en/articles/6075104-duplicating-projects)). Pipedrive's Projects add-on offers "Mark as won and create a project" from the deal, with boards → phases → tasks/subtasks/milestones and Gantt dependencies; external access is only a shareable AI status report ([Pipedrive KB](https://support.pipedrive.com/en/article/projects-by-pipedrive)). Moxie generates projects and tasks straight from the executed agreement ([Moxie help](https://help.withmoxie.com/en/articles/6307977-faq-s-about-agreements)). Basecamp templates carry to-dos with relative dates and keep client-visibility settings ([Basecamp help](https://3.basecamp-help.com/article/66-templates)). Dubsado projects are created manually, by lead-capture form, or by public proposal, and must have a status ([Dubsado help](https://help.dubsado.com/en/articles/11402636-creating-projects)). Bonsai projects are optional and linked from a deal's Projects tab; task templates set dates relative to project start ([Bonsai help](https://help.hellobonsai.com/en/articles/10496156-manage-deals-in-bonsai), [Bonsai help](https://help.hellobonsai.com/en/articles/11488590-leveraging-task-templates)). In 17hats "the project is the client's file" holding every document, email, time log and to-do; workflows are pre-written to-do lists where to-dos don't block later steps but action items and pauses do ([17hats help](https://help.17hats.com/en/articles/3110647-project-overview), [17hats help](https://help.17hats.com/en/articles/879587-workflows-to-dos-action-items-pauses)).

**Client review and approval.** Basecamp: "Everything in a client project is private to your team by default", visibility is set per item, and clients can comment, complete to-dos and post ([Basecamp help](https://5.basecamp-help.com/article/1081-working-with-clients)); the Clientside approval asks a yes/no with a due date, the client answers without logging in, Basecamp reminds the client 24 hours before and then daily when overdue, and the firm gets a notification and receipt ([Basecamp help (BC4)](https://3.basecamp-help.com/article/118-using-the-clientside), [37signals (pre-2025)](https://signalvnoise.com/svn3/helping-clients-and-firms-get-to-yes/)). Moxie: a task status can be flagged as client approval with an optional approval-reminder cadence; moving a task into that column emails the client an action item in the portal ([Moxie help](https://help.withmoxie.com/en/articles/16179952-configure-project-types-and-task-statuses), [Moxie help](https://help.withmoxie.com/en/articles/6566142-client-project-collaboration)). Productive: clients added to a project can see, create, close and comment on tasks but see no financials; the agency hears about comments only if subscribed to the task ([Productive help](https://help.productive.io/en/articles/2179592-managing-clients-on-a-project), [Productive help](https://help.productive.io/en/articles/6359307-general-notification-settings)). Bonsai: portal task visibility is none / assigned-only / all, with per-company create-edit-comment permissions and no approve action ([Bonsai help](https://help.hellobonsai.com/en/articles/10003632-sharing-and-managing-task-with-clients-through-your-client-portal)). Dubsado: tasks can't be assigned to clients; a board set to "Client" is visible in the portal where portal users view, add, edit, upload and mark tasks complete, and Dubsado sends no task due-date reminders at all ([Dubsado help](https://help.dubsado.com/en/articles/15920560-creating-and-managing-tasks), [Dubsado help](https://help.dubsado.com/en/articles/15920562-using-task-boards)). HoneyBook tasks are internal, checked off one at a time, and the project is closed by archiving with a reason (completed/cancelled/no response) or by moving it to a Completed stage ([HoneyBook help](https://help.honeybook.com/en/articles/11239416-assign-tasks-in-a-project), [HoneyBook help](https://help.honeybook.com/en/articles/2209125-archive-completed-projects-in-honeybook-and-track-archive-status)). 17hats' project page is internal-only; clients act on documents in the portal ([17hats help](https://help.17hats.com/en/articles/928568-how-do-i-navigate-the-project-overview-screen)).

### Notable variants

- **Real approve/reject on a deliverable:** Basecamp (approval post), Moxie (approval status column). **Comments only:** Productive, Bonsai, Dubsado, Pipedrive Projects. **Document sign-off as proxy:** HoneyBook smart files and 17hats questionnaires/contracts. **None:** HubSpot (quotes/invoices only), Attio (internal tasks only, every plan) ([Attio help](https://attio.com/help/reference/productivity-collaborating/tasks)).
- **Due-date reminders.** Basecamp notifies assignee and assigner when due dates are added or shifted ([37signals (pre-2025)](https://signalvnoise.com/svn3/new-in-basecamp-3-get-notified-when-someone-reschedules-events-to-dos/)); Pipedrive's "Needs attention" card lists items due today or overdue up to 30 days ([Pipedrive KB](https://support.pipedrive.com/en/article/projects-by-pipedrive)); Dubsado has none.
- **Wrap-up.** Productive workflows have Not started / Started / Closed stages with multiple closed statuses (Done, Won't fix, Archived) that all count as complete ([Productive help](https://help.productive.io/en/articles/6254964-glossary)); Moxie treats the designated "complete" status and everything after it as done ([Moxie help](https://help.withmoxie.com/en/articles/16179952-configure-project-types-and-task-statuses)); HoneyBook's "Archive project" action ends an automation ([HoneyBook help](https://help.honeybook.com/en/articles/9519175)).
- **Client seats.** Basecamp counts every added person, clients included, toward the plan's user cap except on Pro Unlimited ([Basecamp pricing](https://basecamp.com/pricing)); Productive clients see time/budgets only as Client Lead on Professional/Ultimate ([Productive help](https://help.productive.io/en/articles/2179600-what-can-a-client-see-after-joining-productive)).

### The numbers

- Productive: 6-step project wizard; Pipedrive Projects included from Premium, add-on below ([Pipedrive KB](https://support.pipedrive.com/en/article/projects-by-pipedrive)).
- Basecamp approval reminders: 24 h before due, then daily ([Basecamp help (BC4)](https://3.basecamp-help.com/article/118-using-the-clientside)).
- Dubsado: 0 built-in task reminders; recurring tasks unsupported ([Dubsado help](https://help.dubsado.com/en/articles/15920560-creating-and-managing-tasks)).
- Bonsai task visibility: 3 settings, applied system-wide ([Bonsai help](https://help.hellobonsai.com/en/articles/10003632-sharing-and-managing-task-with-clients-through-your-client-portal)).

---

## Q6. Money across all clients, and the agency's own bill

### Converged pattern

**Receivables view.** The studio tools converge on a four-bucket widget. HoneyBook's home widget sorts the month's expected payments into Paid (green), Processing (orange), Upcoming (grey), Overdue (red); ACH sits in Processing 7–8 business days while cards go to Paid instantly ([HoneyBook help](https://help.honeybook.com/en/articles/8117311)); Finance > Overview graphs Paid/Overdue/Upcoming and links to the Payments page ([HoneyBook help](https://help.honeybook.com/en/articles/9510015-how-to-use-your-finance-overview)). Bonsai's P&L chart groups Outstanding, Overdue, Pending (paid, funds in transit, typically ACH 7–10 business days), Paid and Other Income ([Bonsai help](https://help.hellobonsai.com/en/articles/1202116-understanding-payment-categories-outstanding-overdue-pending-and-paid)). Dubsado's Insights > Finance reports shows Revenue, Amount remaining (all open invoices, ignores date range), Expenses and Net profit on a 30-day default; an invoice can only be overdue if it has a payment plan ([Dubsado help](https://help.dubsado.com/en/articles/16208391-finance-reports), [Dubsado help](https://help.dubsado.com/en/articles/12855238-staying-up-to-date-using-the-home-page)). HubSpot's invoice index has Draft/Open/Paid/Void, overdue via filters, and an Accounts Receivable dashboard (open, past due, balance due over time, A/R aging on Pro/Enterprise) ([HubSpot KB](https://knowledge.hubspot.com/invoices/manage-invoices)). Productive lists all invoices under Financials > Invoices, filterable by company/project/budget, with outstanding = "Overdue OR Payment Status = Unpaid" ([Productive help](https://help.productive.io/en/articles/2179656-tracking-invoices)). Moxie's Home "Needs attention" flags overdue records, failed schedules and work ready to bill ([Moxie help](https://help.withmoxie.com/en/articles/16240983-moving-from-moxie-v3-to-moxie-v4)). Pipedrive, Attio and Basecamp have no native invoicing: Pipedrive creates invoices in QuickBooks/Xero from the deal's Invoice tab and mirrors status on the deal ([Pipedrive KB](https://support.pipedrive.com/en/article/invoicing-feature-in-pipedrive)); Attio relies on Hyperline/Stripe apps ([Attio app](https://attio.com/apps/hyperline)).

**Sending from a project.** Productive invoices a budget by uninvoiced time & expenses, remaining amount, or percentage of budget, grouped by budget/service/project/task ([Productive help](https://help.productive.io/en/articles/4656350-create-a-invoice-in-productive)); retainer deals produce a recurring budget with one period per cycle ([Productive help](https://help.productive.io/winning-a-deal)). HoneyBook invoices live inside smart files with payment schedules and autopay, charged daily from 11:00 UTC ([HoneyBook help](https://help.honeybook.com/en/articles/2209040-faq-payments)). Moxie recommends Money > Recurring schedules for retainers with auto-charge of the card saved on the first "Pay now" ([Moxie help](https://help.withmoxie.com/en/articles/6010167-using-automatic-subscription-billing)). Bonsai subscription invoices auto-charge after the first manual payment, cards only ([Bonsai help](https://help.hellobonsai.com/en/articles/1065297-what-is-auto-invoicing-or-subscription-invoices)). Dubsado has payment plans (installments) and recurring invoices, which do not support discounts ([Dubsado help](https://help.dubsado.com/en/articles/15000573-create-a-recurring-invoice)). 17hats recurring invoices send copies but do not charge cards ([17hats help](https://help.17hats.com/en/articles/924380-money-matters-invoice-options)).

**Reminders.** On by default in HoneyBook (7 days before, due date, 2 days after) ([HoneyBook help](https://help.honeybook.com/articles/2209077-sending-payment-reminders)) and Bonsai (1 week before, 1 day before, 1 week after, 2+ weeks after, stopping 16 days past due) ([Bonsai help](https://help.hellobonsai.com/en/articles/1935318-automated-reminders-for-invoices)); 17hats defaults to 1 day before plus monthly past-due, repeat never/daily/weekly with a count ([17hats help](https://help.17hats.com/en/articles/879792-how-do-i-set-automatic-invoice-reminders)); HubSpot is off until toggled, then due date, +7, +14, up to 10 contacts per reminder, from noreply@hubspot.com unless configured ([HubSpot KB](https://knowledge.hubspot.com/invoices/set-up-the-hubspot-invoices-tool)); Dubsado adds none by default, each reminder is per installment and sends once ([Dubsado help](https://help.dubsado.com/en/articles/15000565-automated-payment-reminders)); Productive uses per-client reminder templates, auto-ticked on send when the client has one ([Productive help](https://intercom.help/productive/en/articles/17139803-adding-payment-reminders-to-invoices)).

**Own subscription.** All ten surface a billing page restricted to owners/admins: HoneyBook Settings > Company settings > Membership (owner only; upgrades prorated now, downgrades next cycle) ([HoneyBook help](https://help.honeybook.com/en/articles/7020217-top-questions-answered-about-honeybook-billing-and-membership)); Dubsado upgrades/downgrades any time, downgrade at cycle end, +$10/brand ([Dubsado help](https://help.dubsado.com/en/articles/15920232-choose-the-right-dubsado-plan-for-your-business)); Bonsai Subscription page > Change Plan with mid-cycle proration, one seat per invited member ([Bonsai help](https://help.hellobonsai.com/en/articles/2003194-how-to-change-your-subscription-plan), [Bonsai help](https://help.hellobonsai.com/en/articles/9102775-how-to-invite-team-members-to-bonsai)); Moxie Settings > Billing & plan ([Moxie help](https://help.withmoxie.com/en/articles/16240983-moving-from-moxie-v3-to-moxie-v4)); 17hats Admin > Billing Info / Plan Information ([17hats help](https://help.17hats.com/en/articles/3156330-account-settings-overview)); Basecamp owner-only Adminland for card, invoices, plan ([Basecamp help](https://3.basecamp-help.com/article/100-owner-actions)); Productive Settings > Billing with Billing History PDFs ([Productive help](https://help.productive.io/en/articles/2179591-how-billing-and-subscriptions-work)); HubSpot Account & Billing (billing-admin permission; downgrades only at renewal, 5 business days' notice) ([HubSpot KB](https://knowledge.hubspot.com/account/manage-your-hubspot-subscription)); Pipedrive Billing > Manage subscription (upgrade immediate with credit memo, downgrade at cycle end, per-seat) ([Pipedrive KB](https://support.pipedrive.com/en/article/how-can-i-switch-to-a-different-pipedrive-plan-or-change-my-billing-frequency)); Attio Workspace settings > Billing (admins; upgrades pro-rata, downgrades at renewal, PDF history, 90-day invoice preview on annual) ([Attio help](https://attio.com/help/reference/workspace-settings-billing/billing-and-payments)). None expose a raw Stripe customer portal; all wrap it.

### Notable variants

- **Who pays the processor.** Dubsado, Moxie and 17hats add nothing above Stripe/PayPal/Square ([Dubsado help](https://help.dubsado.com/en/articles/8901346-dubsado-payments-processing-fees-in-2-0), [Moxie help](https://help.withmoxie.com/en/articles/4793732-integrate-moxie-with-stripe), [17hats help](https://help.17hats.com/en/articles/6418020-17hats-payments)); HubSpot adds a platform fee (0.5% HubSpot payments after year one, 0.75% on Stripe) ([HubSpot KB](https://knowledge.hubspot.com/payment-processing/migrate-stripe-payment-processing-to-hubspot-payments)); Bonsai adds 1% (1.35% Amex) on Stripe/PayPal payouts ([Bonsai help](https://help.hellobonsai.com/en/articles/452273-what-does-it-cost-to-get-paid-via-bonsai)). Dubsado can surcharge cards but cannot pass fees on otherwise ([Dubsado help](https://help.dubsado.com/en/articles/9214820-what-is-surcharging-in-2-0)); Moxie lets you pass a configurable base Stripe rate (2.9% NA) to clients ([Moxie help](https://help.withmoxie.com/en/articles/9776507-summer-24-updates)).
- **Profitability.** Productive is the only one with cost-rate profitability: Profit = billable hours × price − hours × cost rate (+overhead), margin = profit/revenue, with Finance/Invoicing dashboards by client ([Productive help](https://help.productive.io/en/articles/3167633-the-budget-overview-tab), [Productive help](https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users)). Bonsai offers Invoice and Project Billing reports filtered by client ([Bonsai help](https://help.hellobonsai.com/en/articles/12995685-invoice-report)); 17hats and Dubsado produce cash-basis P&L from bookkeeping ([17hats help](https://help.17hats.com/en/articles/849340-17hats-invoicing-bookkeeping), [Dubsado help](https://help.dubsado.com/en/articles/15000569-bookkeeping-in-dubsado)).
- **Payout data location.** HubSpot shows payouts in-app only on HubSpot payments; Stripe users report in Stripe ([HubSpot KB](https://knowledge.hubspot.com/payments/manage-payouts)); 17hats and Dubsado hand you the Stripe dashboard ([17hats help](https://help.17hats.com/en/articles/6418020-17hats-payments), [Dubsado help](https://help.dubsado.com/en/articles/15920638-instant-payouts-with-dubsado-payments)).

### The numbers

- **Fees.** HoneyBook 2.9% + $0.25 Visa/MC, 3.4% + $0.09 Amex/Discover/card-on-file, 1.5% ACH ([HoneyBook](https://www.honeybook.com/blog/honeybook-payment-fees), [HoneyBook FAQ](https://www.honeybook.com/faqs)). Dubsado Payments 2.9% + $0.30 US cards, 4.4% + $0.30 international, ACH 0.8% capped $5, $4 failed-ACH fee ([Dubsado help](https://help.dubsado.com/en/articles/8901346-dubsado-payments-processing-fees-in-2-0)). Bonsai Payments 2.9% + $0.30, Amex 3.25% + $0.30, ACH 1% ($1 min), FX 2.5%, instant +1.5% ([Bonsai help](https://help.hellobonsai.com/en/articles/452273-what-does-it-cost-to-get-paid-via-bonsai)). 17hats 2.9% + $0.30 cards, ACH 0.8% + $1.50 capped $6.50 ([17hats help](https://help.17hats.com/en/articles/6418020-17hats-payments)). HubSpot payments US 2.9% cards, ACH 0.8% capped $10 + platform fee capped $10 ([HubSpot KB](https://knowledge.hubspot.com/payment-processing/payments-frequently-asked-questions)).
- **Payouts.** HoneyBook cards 2–3 business days, ACH 7–8; instant deposit +1% ($5 min), card only, after 30 days of payments ([HoneyBook](https://www.honeybook.com/blog/honeybook-payment-fees), [HoneyBook help](https://help.honeybook.com/en/articles/2209033-getting-paid-through-honeybook)). Bonsai new accounts 7–10 business days, established 2–4, instant cap $9,999/day ([Bonsai help](https://help.hellobonsai.com/en/articles/4296530-when-will-i-receive-my-payments)). HubSpot 2–4 days; card funds available 2 business days, ACH 4, SEPA 14 ([HubSpot KB](https://knowledge.hubspot.com/payments/manage-payouts)). Dubsado instant payouts 1% (US/CA/UK/SG), 1.5% AU, max 9,999, 10/day ([Dubsado help](https://help.dubsado.com/en/articles/15920638-instant-payouts-with-dubsado-payments)).
- **Subscriptions.** Dubsado Starter $35/mo or $335/yr, Premier $55/mo or $525/yr, 3 users included, 21-day trial ([Dubsado help](https://help.dubsado.com/en/articles/15920232-choose-the-right-dubsado-plan-for-your-business)). Basecamp flat $29/$79/$99 for 5/10/15 users, Pro Unlimited $199/mo annual or $329 monthly, 30-day trial ([Basecamp pricing](https://basecamp.com/pricing)). Productive minimum 3 paid seats, 14-day trial, deactivating a user does not reduce seats ([Productive help](https://help.productive.io/en/articles/2179591-how-billing-and-subscriptions-work), [Productive help](https://help.productive.io/en/articles/5144588-account-management-adding-and-removing-seats)). HubSpot seats cannot drop below the contract minimum until renewal ([HubSpot KB](https://knowledge.hubspot.com/account-management/manage-seats)). Attio Free 3 seats, Plus 10, Pro unlimited, 14-day Pro trial, pay-by-invoice on Pro ([Attio help](https://attio.com/help/reference/workspace-settings-billing/attio-plans-and-features)). HoneyBook team seats: Starter 0, Essentials 2, Premium 10 or unlimited (sources conflict) ([HoneyBook help](https://help.honeybook.com/en/articles/9777952-common-questions-about-team-member-and-bookkeeper-access-in-honeybook)). 17hats Bank Connections module $5/mo ([17hats help](https://help.17hats.com/en/articles/849340-17hats-invoicing-bookkeeping)).

---

---

## Q7. Working the inbox across all clients

### Converged pattern
Every product that has an inbox at all builds it as **one list of threads across all clients, where a thread is anchored to a project/record rather than to a person's mailbox**, and it only contains mail the system already knows about. HoneyBook's Inbox is "a single place to read and reply to every client email and SMS conversation across all of your projects"; each row is *one project, not one message*, showing latest sender, subject (or SMS icon), preview, date and a project chip, with views Unread / All / Sent / Drafts, a channel filter (email/SMS) and an "unanswered only" filter ([HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place)). Dubsado 3.0's Messages app opens to an Inbox of client replies to Dubsado-started threads plus mail from saved Contacts; each row shows project (or "No project"), sender, timestamp, subject, preview and an unread dot, with Inbox/All/Sent/Archived views, Unread/Read filter, and filters by Contact, Project and date ([Dubsado help](https://help.dubsado.com/en/articles/15811791-dubsado-inbox)). Moxie's Inbox merges synced email, texts, calls and tickets but "email only syncs when it involves someone Moxie already knows through a contact or opportunity" (or an approved client domain) ([Moxie help](http://help.withmoxie.com/en/articles/16181668-understand-inbox-communications)). HubSpot's Conversations inbox is channel-based (team email, chat, forms, Messenger, WhatsApp) with fixed views Unassigned / Assigned to me / All open / Chat and more under "More" (Email, Calls, All closed, Sent, Spam, Trash) ([HubSpot KB](https://knowledge.hubspot.com/inbox/use-the-conversations-inbox)).

**Triage** converges on reply, mark read/unread, archive/close, and attach-to-record; assign/snooze/convert exist only in the CRM-grade tools. HubSpot: Owner dropdown to reassign to user or team, internal @-comment tab, Move conversation (to another inbox needs Pro/Enterprise), Forward, bulk Close/Trash, and an Insert menu for snippets, documents, meeting links, quotes ([HubSpot KB](https://knowledge.hubspot.com/inbox/collaborate-with-your-team-in-the-conversations-inbox), [HubSpot KB](https://knowledge.hubspot.com/inbox/use-the-conversations-inbox)). Dubsado: Reply/Reply all, Archive, Delete (permanent), bulk checkboxes, "Attach to project" selector, canned-email templates from Compose, scheduled send once a project is linked; "Mark all as read" appears at 50+ unread ([Dubsado help](https://help.dubsado.com/en/articles/15811791-dubsado-inbox)). HoneyBook: hover-reply to thread a response, compose with templates/smart fields/smart files/AI assist, schedule send, mark read/unread per team member; no archive, snooze, assign or shortcuts documented ([HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place)). Pipedrive's Sales Inbox (Growth+): view/send/reply, auto- or manually link to a deal/lead/project (auto-link skips contacts with >1 open deal), mark threads Shared or private ([Pipedrive KB](https://support.pipedrive.com/en/article/email-sync), [Pipedrive KB](https://support.pipedrive.com/en/article/link-emails-items)).

**Keyboard shortcuts** are nearly absent. Attio is the only one documenting a key (press **c** anywhere to compose) ([Attio help](https://attio.com/help/reference/email-calendar/send-emails-in-attio.md)); HubSpot users have an open Ideas thread asking for inbox hotkeys ([HubSpot community](https://community.hubspot.com/t5/HubSpot-Ideas/Hubspot-NEEDS-hotkeys-Especially-for-conversation-inbox-message/idc-p/806539/highlight/true)).

**Unread / needs-reply logic:** HoneyBook unread is per team member and syncs with the bell (opening in either marks both read); the home "business overview" separately counts *new leads you haven't replied to* and *unread messages* ([HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place), [HoneyBook help](https://help.honeybook.com/en/articles/5339081)). HubSpot's "needs reply" is structural: a client reply reopens a closed conversation into All open / Assigned to me ([HubSpot KB](https://knowledge.hubspot.com/inbox/use-the-conversations-inbox)). Dubsado sorts threads by most-recent activity since Dec 2025 ([Dubsado updates](https://updates.dubsado.com/120189-december-3-2025-changelog)).

**Does an inbox reply land on the client record?** Yes everywhere, with the caveat that only replies sent *inside* the tool are logged: Dubsado replies "sent inside Dubsado are logged on the project; replies sent from a personal email account are not" ([Dubsado help](https://help.dubsado.com/en/articles/15811791-dubsado-inbox)); HoneyBook threads started outside HoneyBook never appear ([HoneyBook help](https://help.honeybook.com/en/articles/2209147-communicating-through-honeybook)); Attio replies from the record's Emails tab and logs sent mail there ([Attio help](https://attio.com/help/reference/email-calendar/send-emails-in-attio.md)); Pipedrive links the whole conversation to one deal/lead/project ([Pipedrive KB](https://support.pipedrive.com/en/article/how-are-emails-threaded-in-pipedrive)).

**Sending "as the studio":** the dominant model is *send through the owner's connected Google/Microsoft/SMTP mailbox*, so the from-address is the studio's own domain and deliverability (SPF/DKIM) is the studio's job. Dubsado allows one connected account per workspace (Admin/Owner action; aliases can't be connected; unconnected accounts get a daily send cap and worse deliverability) ([Dubsado help](https://help.dubsado.com/en/articles/15811785-connect-your-email-account-with-google), [Dubsado help](https://help.dubsado.com/en/articles/15811787-connect-your-email-account-with-smtp)). HoneyBook lets you read without an integration but not reply, and makes you responsible for DKIM/SPF/DMARC on a custom domain, with a domain test tool in the Integrations tab ([HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place), [HoneyBook help](https://help.honeybook.com/en/articles/7004773-email-faqs)). Attio "is not an ESP" and sends only via the synced Gmail/Microsoft account, default = first-synced account, aliases usable but not default ([Attio help](https://attio.com/help/reference/email-calendar/send-emails-in-attio.md)). HubSpot's shared "team email" channel (Gmail, Office 365 or "Other" for aliases/Google Groups) is the only true shared-studio-address inbox; an address cannot be both a personal inbox and team email ([HubSpot KB](https://knowledge.hubspot.com/inbox/connect-channels-to-the-conversations-inbox)).

### Notable variants
- **17hats** offers a vendor relay: the 17hats Mail Server (SendGrid) sends from each user's "Email Sent As" address, whereas connecting your own SMTP sends *everything from that one address regardless of who is logged in*; Office 365 requires the account address to match ([17hats help](https://help.17hats.com/en/articles/1063489-using-the-17hats-mail-server-as-your-outgoing-server), [17hats help](https://help.17hats.com/multi-user/multi-user-email-settings-using-the-17hats-mail-server)).
- **Bonsai** has no cross-client inbox; client conversation lives in the per-client portal "Messages" tab if Client Messaging is enabled, and system emails show "via Bonsai" unless white-labelled ([Bonsai help](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal), [Bonsai help](https://help.hellobonsai.com/en/articles/1458000-bonsai-s-white-labelling-features)).
- **Basecamp 5** has no email inbox; the "Hey!" menu is now a notifications Sidebar with work-hours scheduling ("Work Can Wait"), a catch-up digest, per-project bell ("Only notify me when...") and per-thread "Don't notify me" ([Basecamp help](https://5.basecamp-help.com/article/1177-notifications)).
- **Attio** sharing is tiered: default shares subject + metadata, bodies hidden; Pro/Enterprise can share full inbox with individuals; a shared email can be replied to by someone not on the thread ([Attio help](https://attio.com/help/reference/email-calendar/sharing-emails.md)).
- **Pipedrive** teammates see a thread only if it's Shared *and* linked to an item they can access, and can reply only if they were on the thread ([Pipedrive KB](https://support.pipedrive.com/en/article/email-privacy-and-sharing-emails-in-pipedrive)).
- **Role gating:** Dubsado's workspace Messages app is owner/admin only (basic members use the project Messages tab); HoneyBook basic members see only their own projects' threads ([Dubsado help](https://help.dubsado.com/en/articles/15811791-dubsado-inbox), [HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place)).

### The numbers
- HoneyBook: 4 views; drafts kept 14 days (browser-local); web only; SMS needs the Business Phone & SMS add-on ([HoneyBook help](https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place)).
- Dubsado: 4 views + Unread/Read filter; "Mark all as read" at ≥50 unread; 1 connected mailbox per workspace; SMTP ports 26/465/587 ([Dubsado help](https://help.dubsado.com/en/articles/15811791-dubsado-inbox), [Dubsado help](https://help.dubsado.com/en/articles/15811787-connect-your-email-account-with-smtp)).
- HubSpot: 4 pinned views + 9 under More; Move needs Pro/Enterprise; 6 assignment options when moving to an inbox; trash auto-deletes after 30 days; comment = 3 clicks ([HubSpot KB](https://knowledge.hubspot.com/inbox/collaborate-with-your-team-in-the-conversations-inbox), [HubSpot KB](https://knowledge.hubspot.com/inbox/use-the-conversations-inbox)).
- Attio: 12 emails/hour and 200/day per mailbox; mass send 10 recipients (Free) / 50 (paid); 5-minute gap between sequence sends ([Attio help](https://attio.com/help/reference/email-calendar/send-emails-in-attio.md)).
- Basecamp: event reminders 1 day and 1 hour before; assignment reminders daily after due date ([Basecamp help](https://5.basecamp-help.com/article/1177-notifications)).

---

## Q8. Sharing, access and inviting

### Converged pattern
**Team members** are invited by email from a Settings → Team page, given a *global role*, and then (in the project-centric tools) must be added to each project to see it. HoneyBook has 5 roles (basic, moderator, admin, super admin, one owner); "additional team members will not automatically be added as participants to projects" and only super admins/owners can add participants or customize the portal ([HoneyBook help](https://help.honeybook.com/en/articles/2209044-team-member-roles-in-honeybook)). Dubsado has Basic / Accountant / Admin; Basic sees only assigned projects and can't create them, Accountant is view-only Invoices + Transactions, and no role can touch login, billing, notifications or the connected calendar ([Dubsado help](https://help.dubsado.com/en/articles/13492341-team-member-roles-permissions)). Bonsai has Collaborator (time/tasks on invited projects, no client or financial data) and Project Manager (all clients/projects, no revenue) ([Bonsai help](https://help.hellobonsai.com/en/articles/9102775-how-to-invite-team-members-to-bonsai)). 17hats: Owner / Admin (no checkboxes, everything but business settings) / Team Member with per-area checkboxes and per-brand overrides ([17hats help](https://help.17hats.com/en/articles/840254-users-getting-started-and-setting-permissions)). Productive classes users Employee / Contractor / Client, then assigns a permission set (Admin, Coordinator, Manager, Profitability Manager, Staff, plus "restricted access" variants that must be added per project/budget); custom sets are Ultimate-only ([Productive help](https://help.productive.io/en/articles/2179641-employees-contractors-clients-and-contacts-an-overview), [Productive help](https://help.productive.io/en/articles/2179618-adjusting-user-permissions)). Basecamp 5: Company employee (can create projects, be admin/owner), Outside collaborator (sees everything in joined projects, can't create/invite), Client (sees only items made visible), with Admin/Owner as roles on employees ([Basecamp help](https://5.basecamp-help.com/article/1171-permissions)).

The CRMs split **what you can do** from **what you can see**. Pipedrive: permission sets (admin/regular/custom) govern actions; visibility groups govern data, one group per user, options owner-only / owner's group / group+sub-groups / all; deals-admins see all pipelines regardless ([Pipedrive KB](https://support.pipedrive.com/en/article/visibility-groups), [Pipedrive KB](https://support.pipedrive.com/article/permission-sets)). HubSpot: Users & Teams, "Limit access to new content" toggle, then Manage Access per asset (or bulk) to teams/users; Super Admins always see everything; nested teams are Enterprise ([HubSpot KB](https://knowledge.hubspot.com/account/partition-your-hubspot-assets), [HubSpot KB](https://knowledge.hubspot.com/user-management/create-and-manage-teams)). Attio: Admin vs Member, plus per-object access Full / Read and write / Read only, default Read-and-write for the workspace; team/member overrides can only *add* access, so to restrict you set workspace to Read only and grant upward ([Attio help](https://attio.com/help/reference/workspace-settings-billing/manage-members-and-admins.md), [Attio help](https://attio.com/help/reference/managing-your-data/objects/manage-access-to-objects)).

**Clients** are never seats; they get a portal or a per-project guest login that starts empty and is widened item-by-item. Basecamp: "Everything starts private"; each item carries a visibility flag with a Change control; Chat and Forwards are all-or-nothing; clients never see the flags; removal via People → Clients → ••• → Remove is immediate and un-notified ([Basecamp help](https://5.basecamp-help.com/article/1082-what-clients-can-see-and-do), [Basecamp help](https://5.basecamp-help.com/article/1081-working-with-clients)). Productive: clients don't use paid seats; a new client's dashboard is empty; they see tasks/docs/members of assigned projects, never worked time; budgets only for Client Lead/Manager on Professional/Ultimate ([Productive help](https://help.productive.io/en/articles/2179600-what-can-a-client-see-after-joining-productive), [Productive help](https://help.productive.io/en/articles/2179576-adding-clients-to-projects)). Dubsado: portal is activated *per project* (sidebar Portal → Activate → set password → Send) while branding/sharing is global at Settings → Client portal ([Dubsado help](https://help.dubsado.com/en/articles/15920580-activate-or-deactivate-client-portals), [Dubsado help](https://help.dubsado.com/en/articles/15920590-customize-the-client-portal)). Moxie: workspace defaults at Settings → Client portal → Features & navigation; per client "Customize for this client" override; access is per *contact* and revoked by toggling it off; time-worked visibility is set per project ([Moxie help](https://help.withmoxie.com/en/articles/5855648-client-portal-permissions), [Moxie help](https://help.withmoxie.com/en/articles/8238276-client-portal-client-access-and-login)). Bonsai: Portals → client → toggle portal on/off and visibility of Tasks, Project progress, Billing, Team members; clients log in via secure email link ([Bonsai help](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal)). 17hats: global portal settings with per-contact overrides to hide projects or document types; access is sent as an "E-mail Link" or via workflow ([17hats help](https://help.17hats.com/en/articles/3160537-client-portal-giving-contacts-access), [17hats help](https://help.17hats.com/en/articles/3160024-client-portal-customizing-per-contact)). HoneyBook: one global portal design; only super admins/owners customize ([HoneyBook help](https://help.honeybook.com/en/articles/2814167)).

**"What the client sees" preview** exists in most: HoneyBook project → Client portal box → Preview as client (mock data, read-only) ([HoneyBook help](https://help.honeybook.com/en/articles/2814167)); Bonsai Portals → client → Preview ([Bonsai help](https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal)); Moxie "View portal as…" ([Moxie help](https://help.withmoxie.com/en/articles/5855648-client-portal-permissions)); Duda Site Overview → View as client ([Duda help](https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients)); Basecamp shows a side-by-side screenshot but no live toggle ([Basecamp help](https://5.basecamp-help.com/article/1082-what-clients-can-see-and-do)).

**Audit of who-saw-what** is weak outside the CRMs: HubSpot Audit Logs (Super Admin; All Logs / Login History / Security Activity, 30-day window, more categories on Enterprise) ([HubSpot KB](https://knowledge.hubspot.com/account-management/view-and-export-account-activity-history)); Pipedrive Security Center dashboard shows who's logged in now, device history and audit log (Ultimate) ([Pipedrive KB](https://support.pipedrive.com/en/article/security-dashboard)); HoneyBook shows per-message opened-by/when via the envelope icon ([HoneyBook help](https://help.honeybook.com/en/articles/2209151-understanding-email-statuses)). No portal product documents a per-client "viewed file X" log.

### Notable variants
- **Agency website platforms invert the model:** Duda team members "always see all sites in your Duda account" (restrict by making them a Client instead), permissions via predefined groups (Admin, Designer, Blog, Store Manager) or custom groups; clients are granted per-site permission lists; Client Management is visible only to owners and staff with that permission ([Duda help](https://support.duda.co/hc/en-us/articles/26519392554775-Manage-Team-Members), [Duda dev docs](https://developer.duda.co/docs/creating-team-members), [Duda help](https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients)). Wix Studio teammates default to all sites/folders but "Manage Access" can scope them; a client is just a site collaborator flagged CLIENT at invite time (roles like Edit Content vs Admin/Co-Owner) ([Wix help](https://support.wix.com/en/article/wix-studio-manage-your-team), [Wix help](https://support.wix.com/en/article/wix-studio-inviting-a-client-to-join-a-site)).
- **HubSpot partner access:** Partner Admins manage a client's portal without a paid seat via a Partner Seat; clients control data-sharing with the partner ([HubSpot KB](https://knowledge.hubspot.com/partner-tools/grant-partner-admin-access-to-partner-employees)).
- **Basecamp templates** can carry client-visibility settings so new projects inherit them ([37signals updates](https://updates.37signals.com/post/new-in-basecamp-client-access-on-templates)).

### The numbers
- HoneyBook: Starter 0 team members, Essentials 2, Premium unlimited; bookkeepers unlimited; plans $29/$49/$109 per month billed yearly ([HoneyBook help](https://help.honeybook.com/en/articles/9777952-common-questions-about-team-member-and-bookkeeper-access-in-honeybook), [HoneyBook blog](https://www.honeybook.com/blog/honeybook-plans)).
- Dubsado: 3 extra users free; 4–10 users $25/mo, 11–20 $45/mo, 21–30 $60/mo ([Dubsado pricing](https://dubsado.com/pricing), [Dubsado help](https://help.dubsado.com/en/articles/15920692-invite-a-team-member-to-join-your-workspace)).
- Bonsai: $10/member/month ($100/yr); 2 roles ([Bonsai help](https://help.hellobonsai.com/en/articles/9102775-how-to-invite-team-members-to-bonsai)).
- Moxie Teams: $40/mo ($32 annual), 5 full licences, unlimited collaborators ([Moxie](https://www.withmoxie.com/product-pages/teams-and-collaborators-for-freelancers)).
- 17hats: Multi-user only on Standard/Premier; 5-user limit incl. owner (per help search) ([17hats help](https://help.17hats.com/en/articles/840254-users-getting-started-and-setting-permissions)).
- Attio: Free up to 3 seats; seats = active + invited; Teams on Pro (max 10 teams) / Enterprise; per-member object access Pro+ ([Attio help](https://attio.com/help/reference/workspace-settings-billing/manage-members-and-admins.md), [Attio help](https://attio.com/help/reference/workspace-settings-billing/billing-and-payments)).
- Pipedrive: visibility groups Premium 15 / Ultimate 25 / Enterprise 150; Lite/Growth default group only; 1 group per user ([Pipedrive KB](https://support.pipedrive.com/en/article/visibility-groups)).
- HubSpot: seat removals take effect next billing period; View-Only seat turns off email logging ([HubSpot KB](https://knowledge.hubspot.com/account-management/manage-seats)).
- Wix Studio: 50 invites per batch; client invites expire in 30 days ([Wix help](https://support.wix.com/en/article/wix-studio-manage-your-team), [Wix help](https://support.wix.com/en/article/wix-studio-inviting-a-client-to-join-a-site)).
- Basecamp client removal: 3 clicks, immediate, no notification ([Basecamp help](https://5.basecamp-help.com/article/1081-working-with-clients)).

---

## Q9. System health, admin and status

### Converged pattern
No small-studio tool has an "ops dashboard"; health surfaces as **inline status icons plus an Updates/notification feed plus email**, and the fix is almost always "reconnect it yourself." Email: HoneyBook shows a per-message envelope (sent / opened / red = not delivered, hover for who/when) and points you to DKIM/SPF/DMARC and a domain test tool; an invalid-DKIM banner is detected by HoneyBook but fixed at your DNS host ([HoneyBook help](https://help.honeybook.com/en/articles/2209151-understanding-email-statuses), [HoneyBook help](https://help.honeybook.com/en/articles/8909702-resolving-an-invalid-dkim-error)). Pipedrive pops a "sync has stopped" notification with a Re-authenticate button; failing that, Stop Syncing → Add another account ([Pipedrive KB](https://support.pipedrive.com/article/how-can-i-re-authenticate-my-email-sync-in-pipedrive), [Pipedrive KB](https://support.pipedrive.com/article/troubleshooting-email-sync-feature)). HubSpot documents IMAP/SMTP error states (ports 993/143, SSL cert, allow-list IPs) and "inbox disconnected" sequence errors ([HubSpot KB](https://knowledge.hubspot.com/connected-email/troubleshoot-imap-inbox-connection)). Payments: Dubsado marks the invoice Unpaid/Overdue, emails both parties, posts an Updates notification "An automatic payment has failed…", *cancels autopay enrollment*, and sends you to the Stripe dashboard for decline codes or allow-listing ([Dubsado help](https://help.dubsado.com/en/articles/15920620-why-did-my-client-s-payment-fail)). HoneyBook marks the invoice Overdue, emails the client, and support says autopay retries after 24 h (community) ([HoneyBook help](https://help.honeybook.com/en/articles/6399179-troubleshooting-client-payments), [HoneyBook community](https://community.honeybook.com/money-talk-143/auto-pay-2531)). Integrations: HubSpot's only sync-health UI is the Salesforce "Sync Health" tab with instant/daily/weekly error emails (Pro/Enterprise) ([HubSpot community release](https://community.hubspot.com/t5/Releases-and-Updates/Clear-Visibility-into-Salesforce-Sync-Health/ba-p/417749)); AgencyAnalytics has an account-wide Data Sources page with a Status column and filter for "Disconnected", but status refreshes only when you open the client's Data tab ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/5719775-account-level-data-sources-overview)).

**Status pages** are universal and mostly Statuspage/Better Stack: HoneyBook (11 components incl. Payments, Client Communication, Automations) ([HoneyBook status](https://status.honeybook.com/)); Dubsado at dubsado.statuspage.io ([Dubsado help](https://help.dubsado.com/en/articles/8558078-is-dubsado-down)); HubSpot (11 categories) ([HubSpot status](https://status.hubspot.com/)); Pipedrive with Email Sync and Smart BCC as named components, email/Slack subscriptions ([Pipedrive status](https://status.pipedrive.com/)); Attio (5 components, 99.98% web client uptime Jul–Oct 2026) ([Attio status](https://status.attio.com/)); 37signals for Basecamp 5 (basecampstatus.com redirects) ([37signals status](https://www.37status.com/)); Duda (Live Sites, Editor, API, Sandbox, eCommerce; email/SMS/webhook/RSS) ([Duda status](https://status.duda.co/)); Wix Services Status ([Wix help](https://support.wix.com/en/article/wix-services-status-page)).

**White-label / own brand** converges on: upload logo + colours, send from your own mailbox (Q7), and a CNAME subdomain for the portal. Dubsado: Settings → URL customization, CNAME to `ssl.dubsado.com`, Verify; covers portal, forms, schedulers, invoices; propagation up to 48 h; admin/owner only; resetting breaks previously sent links ([Dubsado help](https://help.dubsado.com/en/articles/15920685-customize-your-dubsado-urls)). HoneyBook: default `prefix.hbportal.co`, optional own subdomain, login-page colour/logo/text, super admin/owner only ([HoneyBook help](https://help.honeybook.com/en/articles/2814167), [HoneyBook help](https://help.honeybook.com/en/articles/9468125-client-portal-and-access-faqs)). Moxie: default `yourcompany.withmoxie.com`, CNAME for `clients.yourdomain.com` ([Moxie help](https://help.withmoxie.com/en/articles/5855651-client-portal-custom-domains)). Bonsai: "Hide Bonsai branding and show mine" (Professional+) removes "via Bonsai" from emails and portal, but no custom portal URL ([Bonsai help](https://help.hellobonsai.com/en/articles/1458000-bonsai-s-white-labelling-features)). Duda: White Label → Custom Branding (logo, favicon 16/32 px, 4 colour slots; Team plan+) and Custom Domain → Dashboard Domain via CNAME, so the *whole* editor/dashboard is on your domain ([Duda help](https://support.duda.co/hc/en-us/articles/26519443459991)). Wix Studio: Custom Branding puts your logo in invite emails, client site dashboards and free-site banners (owners/co-owners only), but Wix confirms partners cannot fully customize the client dashboard ([Wix help](https://support.wix.com/en/article/wix-studio-setting-up-custom-branding), [Wix help](https://support.wix.com/en/article/wix-studio-request-customizing-the-site-dashboard-for-clients)).

### Notable variants
- **Duda SSL/domains:** Let's Encrypt DV certs auto-issue after publish + DNS propagation (5 min–48 h, typically 15–30 min), auto-renew, with a manual "Generate certificate" fallback; Cloudflare proxy, AAAA and CAA records block issuance ([Duda help](https://support.duda.co/hc/en-us/articles/26520120146967-SSL-HTTPS), [Duda dev docs](https://developer.duda.co/reference/ssl-certificates)). Domain auto-renew changes are exposed as webhooks rather than a dashboard alert ([Duda dev docs](https://developer.duda.co/docs/domain)).
- **Wix domain expiry:** auto-renew 30 days pre-expiry; failed payment → up to 30-day grace with site disconnected → ~30-day redemption at $100; renewal dates and "Update Payment Method" live under Premium Subscriptions ([Wix help](https://support.wix.com/en/article/checking-your-domain-subscription-renewal-date), [Wix help](https://support.wix.com/en/article/wix-domain-renewal-payment-failure)). Wix Studio lets you route each notification type to dashboard and/or email across all sites in the workspace ([Wix help](https://support.wix.com/en/article/wix-studio-managing-site-notifications-in-your-workspace)).
- **Pipedrive Security Center** is the closest to an admin console: current sessions, device history, audit log (Ultimate), user last-login (30-day "remember me" caveat) ([Pipedrive KB](https://support.pipedrive.com/en/article/security-dashboard)).
- **Attio and Productive** publish no reconnect/failed-sync help article I could find; Attio relies on third-party guidance to disconnect/reconnect ([Supademo, 3rd-party](https://supademo.com/blog/guides/how-to-sync-email-and-calendar-in-attio)).

### The numbers
- Dubsado CNAME: ≤48 h; HubSpot IMAP ports 993/143; HubSpot audit log window 30 days; Pipedrive audit log ≈2 months (older article); Wix grace 30 d + redemption 30 d, $100; Duda SSL 15–30 min typical, 48 h max; Duda favicon 16×16/32×32 ([Dubsado help](https://help.dubsado.com/en/articles/15920685-customize-your-dubsado-urls), [HubSpot KB](https://knowledge.hubspot.com/connected-email/troubleshoot-imap-inbox-connection), [HubSpot KB](https://knowledge.hubspot.com/account-management/view-and-export-account-activity-history), [Pipedrive KB](https://support.pipedrive.com/en/article/security-dashboard), [Wix help](https://support.wix.com/en/article/wix-domain-renewal-payment-failure), [Duda help](https://support.duda.co/hc/en-us/articles/26519443459991)).

---

## Q10. Agency-specific home

### Converged pattern
Agency-serving products put **a client/site list with health columns** at the top, and push "today" into widgets the owner can rearrange. Productive's dashboard is the first screen after login; new accounts get 7 default dashboards, and "My Dashboard" (all users) shows open tasks, invoiced by month, **future utilization for the next 90 days**, and all open budgets; manager-only dashboards add Utilization (hours not logged last week/30 days, available vs scheduled next 30 days, forecast billable utilization), Invoicing (unpaid amount, **overdue invoices by aging and by client**, invoices not exported to accounting) and Tasks (my overdue tasks, overdue in my projects) ([Productive help](https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users), [Productive help](https://help.productive.io/en/articles/6423123-dashboards)). AgencyAnalytics' Home is the all-clients list (List or Tile view, folders with averaged totals, up to 50 metric columns, XLS export) and the Data page is the cross-client integration-status board ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/10157947-customize-your-home-page-and-profile), [AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/5719775-account-level-data-sources-overview)). Wix Studio's workspace splits Sites (filter by editor, Premium plan, publish status), Billing & Subscriptions (upcoming renewals, unassigned subscriptions, payment problems), Team and Clients (monthly Client Reports, CRM & Client Billing) ([Wix help](https://support.wix.com/en/article/wix-studio-a-tour-of-the-workspace), [Wix help](https://support.wix.com/en/article/wix-studio-managing-sites-in-a-workspace)). Duda's agency home is the Site List with a per-site Overview/Dashboard (stats, clients, View as client, publish state) ([Duda updates](https://www.duda.co/product-updates/introducing-site-overview), [Duda help](https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients)). HubSpot's Partner dashboard prioritises tier/points, 12-month sourced revenue and retention, **Upcoming HubSpot Renewals**, and a points breakdown per client ([HubSpot KB](https://knowledge.hubspot.com/account/view-and-manage-your-partner-dashboard)).

For studio tools, the home is a "today" strip: HoneyBook's overview bar counts **new leads not replied to, unread messages, tasks assigned to you, YTD bookings**, with movable Calendar / Recent Activity / Tasks / Payments widgets; the Payments widget groups this month's expected payments as paid / processing / upcoming / overdue and lets you send reminders inline ([HoneyBook help](https://help.honeybook.com/en/articles/5339081), [HoneyBook help](https://help.honeybook.com/en/articles/8117311)). 17hats' dashboard is "Let's Take Care of Business" (all action items grouped Leads / Documents / To Do's / Emails, each snoozable), a 3–5-day calendar strip, last-5-document client activity, and Pending items by document type; layout is fixed ([17hats help](https://help.17hats.com/en/articles/3110596-17hats-dashboard)). Dubsado's Home widgets are role-filtered (Accountants see only Finance Reports and Invoices) ([Dubsado help](https://help.dubsado.com/en/articles/13492341-team-member-roles-permissions)).

### Notable variants
- **Utilization is only first-class in Productive**; no CRM or studio tool surfaces capacity ([Productive help](https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users)).
- **Renewals/expiring assets** appear only on the website platforms and the HubSpot partner dashboard; Duda exposes domain auto-renew events only via webhooks ([Duda dev docs](https://developer.duda.co/docs/domain), [HubSpot KB](https://knowledge.hubspot.com/account/view-and-manage-your-partner-dashboard)).
- **Unread as a home KPI** is HoneyBook-only; Attio, Pipedrive and HubSpot leave it in the inbox views ([HoneyBook help](https://help.honeybook.com/en/articles/5339081)).
- **Sharing a home view** is gated: Productive dashboard sharing (view / edit / full access) needs Professional or Ultimate; data widgets refresh every 60 s ([Productive help](https://help.productive.io/en/articles/6423123-dashboards)).

### The numbers (a "today" screen for 10–30 small-business clients, by precedent)
- Needs-reply count (HoneyBook: leads unanswered + unread) ([HoneyBook help](https://help.honeybook.com/en/articles/5339081)).
- Overdue/unpaid by client and aging (Productive Invoicing dashboard) ([Productive help](https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users)).
- Utilization next 30/90 days and hours not logged last 7/30 days (Productive) ([Productive help](https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users)).
- Expiring/renewing subscriptions and payment problems (Wix Studio Billing; HubSpot partner renewals) ([Wix help](https://support.wix.com/en/article/wix-studio-a-tour-of-the-workspace), [HubSpot KB](https://knowledge.hubspot.com/account/view-and-manage-your-partner-dashboard)).
- Disconnected integrations across all clients (AgencyAnalytics Data page) ([AgencyAnalytics help](https://help.agencyanalytics.com/en/articles/5719775-account-level-data-sources-overview)).
- Snoozable action items grouped by type (17hats) ([17hats help](https://help.17hats.com/en/articles/3110596-17hats-dashboard)).

---

---

## Sources

1. https://help.dubsado.com/en/articles/11402636-creating-projects
2. https://help.honeybook.com/en/articles/2209127-how-to-start-working-with-a-client
3. https://help.withmoxie.com/en/articles/5776772-add-your-first-client
4. https://help.hellobonsai.com/en/articles/452120-how-to-create-and-manage-companies-and-contacts
5. https://help.17hats.com/en/articles/3110621-adding-contacts-to-17hats
6. https://help.honeybook.com/en/articles/11095702-how-your-clients-log-into-the-client-portal
7. https://help.dubsado.com/en/articles/15920579-share-the-client-portal
8. https://help.hellobonsai.com/en/articles/4409019-how-to-use-the-client-portal
9. https://help.withmoxie.com/en/articles/8238276-client-portal-client-access-and-login
10. https://help.17hats.com/en/articles/1131267-client-portal-overview
11. https://help.dubsado.com/en/articles/15920580-activate-or-deactivate-client-portals
12. https://help.honeybook.com/en/articles/9468117-how-to-share-the-client-portal
13. https://help.productive.io/en/articles/2179668-companies
14. https://help.productive.io/en/articles/2179613-creating-a-new-project
15. https://help.productive.io/en/articles/2179579-inviting-clients-to-productive
16. https://5.basecamp-help.com/article/1081-working-with-clients
17. https://updates.37signals.com/post/new-in-basecamp-client-access-on-templates
18. https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients
19. https://developer.duda.co/docs/access-permissions
20. https://www.duda.co/product-updates/client-invitation
21. https://support.wix.com/en/article/wix-studio-inviting-a-client-to-join-a-site
22. https://support.wix.com/en/article/wix-studio-creating-a-client-kit-5293562
23. https://support.wix.com/en/article/wix-studio-faqs-using-the-workspace
24. https://help.agencyanalytics.com/en/articles/10389651-create-and-manage-client-templates
25. https://help.agencyanalytics.com/en/articles/10344666-create-and-manage-clients
26. https://knowledge.hubspot.com/records/create-companies
27. https://knowledge.hubspot.com/inbox/set-up-a-customer-portal
28. https://support.pipedrive.com/en/article/contacts-people-and-organizations
29. https://attio.com/help/reference/managing-your-data/records/create-and-view-records
30. https://help.hellobonsai.com/en/articles/15166148-clients-is-now-companies-what-s-changing-in-bonsai
31. https://help.17hats.com/en/articles/3160537-client-portal-giving-contacts-access
32. https://help.productive.io/what-can-a-client-see-on-a-project
33. https://help.dubsado.com/en/articles/12856226-the-projects-page
34. https://help.honeybook.com/en/articles/5758575-how-to-navigate-your-pipeline
35. https://help.withmoxie.com/en/articles/16179848-find-and-organize-your-clients
36. https://help.dubsado.com/en/articles/14189991-taking-bulk-actions
37. https://updates.dubsado.com/131749-project-action-suggestions-more-bulk-actions
38. https://knowledge.hubspot.com/records/bulk-edit-records
39. https://knowledge.hubspot.com/records/view-and-filter-records
40. https://support.pipedrive.com/en/article/bulk-editing-and-filtering
41. https://support.pipedrive.com/hc/en-us/articles/360000146149-List-View
42. https://attio.com/help/reference/managing-your-data/views/filter-and-sort-views
43. https://attio.com/help/reference/managing-your-data/lists/bulk-updating-lists
44. https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views
45. https://support.duda.co/hc/en-us/articles/26519246713751-Project-List
46. https://www.duda.co/product-updates/introducing-site-overview
47. https://support.wix.com/en/article/wix-studio-managing-sites-in-a-workspace
48. https://support.wix.com/en/article/wix-studio-a-tour-of-the-workspace
49. https://help.agencyanalytics.com/en/articles/3530399-manage-data-sources-or-integrations
50. https://knowledge.hubspot.com/prospecting/manage-companies-in-the-sales-workspace
51. https://updates.37signals.com/post/new-refined-home-screen-participation-types
52. https://help.17hats.com/en/articles/924376-17hats-contact-types
53. https://help.honeybook.com/en/articles/9055403-managing-clients-in-honeybook
54. https://help.honeybook.com/en/articles/6428603-your-clients-experience-with-the-client-portal
55. https://support.wix.com/en/article/wix-partners-requesting-to-collaborate-on-a-clients-site
56. https://university.webflow.com/videos/guest-role
57. https://help.webflow.com/hc/en-us/articles/33961238786963
58. https://help.webflow.com/hc/en-us/articles/35335039878035
59. https://knowledge.hubspot.com/partner-tools/manage-partner-employee-access-to-client-accounts
60. https://help.agencyanalytics.com/en/articles/8070783-connect-google-analytics-4
61. https://help.agencyanalytics.com/en/articles/9774477-create-and-manage-users
62. https://help.dashthis.com/connect-data-sources
63. https://www.semrush.com/kb/778-connect-my-google-accounts
64. https://vi.semrush.com/kb/1167-client-portal
65. https://pl.semrush.com/kb/1546-agency-growth-kit-sunsetting
66. https://www.agencyaccess.co/integrations/google
67. https://www.leadsie.com/blog/how-to-give-or-request-access-to-google-analytics
68. https://dev.wix.com/docs/api-reference/business-management/seo/google-search-console/connection-v1/introduction
69. https://support.google.com/analytics/answer/12027742
70. https://support.duda.co/hc/en-us/articles/4410641708823-Google-Search-Console
71. https://support.wix.com/en/article/adding-google-analytics-to-your-wix-site
72. https://support.wix.com/en/article/connecting-your-site-to-google-in-the-wix-seo-setup-checklist
73. https://developer.duda.co/docs/app-sso
74. https://help.honeybook.com/en/articles/5748069-recreating-your-legacy-proposal-files-as-smart-files
75. https://help.dubsado.com/en/articles/14426383-connect-a-contract-and-invoice-to-a-proposal
76. https://help.17hats.com/articles/924358-combined-documents
77. https://help.withmoxie.com/en/articles/6307977-faq-s-about-agreements
78. https://help.hellobonsai.com/en/articles/5616844-all-about-proposals
79. https://help.hellobonsai.com/en/articles/2157748-automating-invoices-when-your-proposals-are-accepted
80. https://knowledge.hubspot.com/quotes/create-and-send-quotes
81. https://knowledge.hubspot.com/quotes/use-e-signatures-with-quotes
82. https://knowledge.hubspot.com/workflows/set-event-enrollment-triggers
83. https://support.pipedrive.com/en/article/smart-docs
84. https://support.pipedrive.com/en/article/sales-documents-esignatures-beta
85. https://attio.com/help/reference/managing-your-data/objects/manage-standard-objects
86. https://attio.com/apps/hyperline
87. https://help.honeybook.com/en/articles/5192723-using-smart-files-for-contracting
88. https://help.17hats.com/en/articles/1967185-automatic-confirmation-emails-that-send-from-17hats
89. https://help.withmoxie.com/en/articles/8842439-agreement-v2-webhook-events
90. https://help.honeybook.com/en/articles/2463528-how-to-customize-your-pipeline
91. https://help.honeybook.com/en/articles/9519175
92. https://help.dubsado.com/en/articles/467074-creating-workflows-in-2-0
93. https://community.pipedrive.com/discussion/7377/feature-request-automation-trigger-for-smart-docs-signing
94. https://help.withmoxie.com/en/articles/6050935-deposits
95. https://help.dubsado.com/en/articles/14363226-how-to-set-up-a-public-proposal
96. https://help.honeybook.com/en/articles/5371221-share-your-smart-files
97. https://help.17hats.com/en/articles/2280471-email-settings-document-email-reminders
98. https://community.hubspot.com/t/quote-e-signature-notification/34025
99. https://help.honeybook.com/en/articles/2641806-beginner-s-glossary
100. https://help.17hats.com/en/articles/1698294-quote-templates
101. https://help.productive.io/winning-a-deal
102. https://help.productive.io/en/articles/2179613-how-to-create-a-new-project
103. https://help.productive.io/en/articles/6075104-duplicating-projects
104. https://support.pipedrive.com/en/article/projects-by-pipedrive
105. https://3.basecamp-help.com/article/66-templates
106. https://help.hellobonsai.com/en/articles/10496156-manage-deals-in-bonsai
107. https://help.hellobonsai.com/en/articles/11488590-leveraging-task-templates
108. https://help.17hats.com/en/articles/3110647-project-overview
109. https://help.17hats.com/en/articles/879587-workflows-to-dos-action-items-pauses
110. https://3.basecamp-help.com/article/118-using-the-clientside
111. https://signalvnoise.com/svn3/helping-clients-and-firms-get-to-yes/
112. https://help.withmoxie.com/en/articles/16179952-configure-project-types-and-task-statuses
113. https://help.withmoxie.com/en/articles/6566142-client-project-collaboration
114. https://help.productive.io/en/articles/2179592-managing-clients-on-a-project
115. https://help.productive.io/en/articles/6359307-general-notification-settings
116. https://help.hellobonsai.com/en/articles/10003632-sharing-and-managing-task-with-clients-through-your-client-portal
117. https://help.dubsado.com/en/articles/15920560-creating-and-managing-tasks
118. https://help.dubsado.com/en/articles/15920562-using-task-boards
119. https://help.honeybook.com/en/articles/11239416-assign-tasks-in-a-project
120. https://help.honeybook.com/en/articles/2209125-archive-completed-projects-in-honeybook-and-track-archive-status
121. https://help.17hats.com/en/articles/928568-how-do-i-navigate-the-project-overview-screen
122. https://attio.com/help/reference/productivity-collaborating/tasks
123. https://signalvnoise.com/svn3/new-in-basecamp-3-get-notified-when-someone-reschedules-events-to-dos/
124. https://help.productive.io/en/articles/6254964-glossary
125. https://basecamp.com/pricing
126. https://help.productive.io/en/articles/2179600-what-can-a-client-see-after-joining-productive
127. https://help.honeybook.com/en/articles/8117311
128. https://help.honeybook.com/en/articles/9510015-how-to-use-your-finance-overview
129. https://help.hellobonsai.com/en/articles/1202116-understanding-payment-categories-outstanding-overdue-pending-and-paid
130. https://help.dubsado.com/en/articles/16208391-finance-reports
131. https://help.dubsado.com/en/articles/12855238-staying-up-to-date-using-the-home-page
132. https://knowledge.hubspot.com/invoices/manage-invoices
133. https://help.productive.io/en/articles/2179656-tracking-invoices
134. https://help.withmoxie.com/en/articles/16240983-moving-from-moxie-v3-to-moxie-v4
135. https://support.pipedrive.com/en/article/invoicing-feature-in-pipedrive
136. https://help.productive.io/en/articles/4656350-create-a-invoice-in-productive
137. https://help.honeybook.com/en/articles/2209040-faq-payments
138. https://help.withmoxie.com/en/articles/6010167-using-automatic-subscription-billing
139. https://help.hellobonsai.com/en/articles/1065297-what-is-auto-invoicing-or-subscription-invoices
140. https://help.dubsado.com/en/articles/15000573-create-a-recurring-invoice
141. https://help.17hats.com/en/articles/924380-money-matters-invoice-options
142. https://help.honeybook.com/articles/2209077-sending-payment-reminders
143. https://help.hellobonsai.com/en/articles/1935318-automated-reminders-for-invoices
144. https://help.17hats.com/en/articles/879792-how-do-i-set-automatic-invoice-reminders
145. https://knowledge.hubspot.com/invoices/set-up-the-hubspot-invoices-tool
146. https://help.dubsado.com/en/articles/15000565-automated-payment-reminders
147. https://intercom.help/productive/en/articles/17139803-adding-payment-reminders-to-invoices
148. https://help.honeybook.com/en/articles/7020217-top-questions-answered-about-honeybook-billing-and-membership
149. https://help.dubsado.com/en/articles/15920232-choose-the-right-dubsado-plan-for-your-business
150. https://help.hellobonsai.com/en/articles/2003194-how-to-change-your-subscription-plan
151. https://help.hellobonsai.com/en/articles/9102775-how-to-invite-team-members-to-bonsai
152. https://help.17hats.com/en/articles/3156330-account-settings-overview
153. https://3.basecamp-help.com/article/100-owner-actions
154. https://help.productive.io/en/articles/2179591-how-billing-and-subscriptions-work
155. https://knowledge.hubspot.com/account/manage-your-hubspot-subscription
156. https://support.pipedrive.com/en/article/how-can-i-switch-to-a-different-pipedrive-plan-or-change-my-billing-frequency
157. https://attio.com/help/reference/workspace-settings-billing/billing-and-payments
158. https://help.dubsado.com/en/articles/8901346-dubsado-payments-processing-fees-in-2-0
159. https://help.withmoxie.com/en/articles/4793732-integrate-moxie-with-stripe
160. https://help.17hats.com/en/articles/6418020-17hats-payments
161. https://knowledge.hubspot.com/payment-processing/migrate-stripe-payment-processing-to-hubspot-payments
162. https://help.hellobonsai.com/en/articles/452273-what-does-it-cost-to-get-paid-via-bonsai
163. https://help.dubsado.com/en/articles/9214820-what-is-surcharging-in-2-0
164. https://help.withmoxie.com/en/articles/9776507-summer-24-updates
165. https://help.productive.io/en/articles/3167633-the-budget-overview-tab
166. https://help.productive.io/en/articles/12750529-default-dashboards-for-new-users
167. https://help.hellobonsai.com/en/articles/12995685-invoice-report
168. https://help.17hats.com/en/articles/849340-17hats-invoicing-bookkeeping
169. https://help.dubsado.com/en/articles/15000569-bookkeeping-in-dubsado
170. https://knowledge.hubspot.com/payments/manage-payouts
171. https://help.dubsado.com/en/articles/15920638-instant-payouts-with-dubsado-payments
172. https://www.honeybook.com/blog/honeybook-payment-fees
173. https://www.honeybook.com/faqs
174. https://knowledge.hubspot.com/payment-processing/payments-frequently-asked-questions
175. https://help.honeybook.com/en/articles/2209033-getting-paid-through-honeybook
176. https://help.hellobonsai.com/en/articles/4296530-when-will-i-receive-my-payments
177. https://help.productive.io/en/articles/5144588-account-management-adding-and-removing-seats
178. https://knowledge.hubspot.com/account-management/manage-seats
179. https://attio.com/help/reference/workspace-settings-billing/attio-plans-and-features
180. https://help.honeybook.com/en/articles/9777952-common-questions-about-team-member-and-bookkeeper-access-in-honeybook
181. https://help.honeybook.com/en/articles/16776406-inbox-see-all-your-client-conversations-in-one-place
182. https://help.dubsado.com/en/articles/15811791-dubsado-inbox
183. http://help.withmoxie.com/en/articles/16181668-understand-inbox-communications
184. https://knowledge.hubspot.com/inbox/use-the-conversations-inbox
185. https://knowledge.hubspot.com/inbox/collaborate-with-your-team-in-the-conversations-inbox
186. https://support.pipedrive.com/en/article/email-sync
187. https://support.pipedrive.com/en/article/link-emails-items
188. https://attio.com/help/reference/email-calendar/send-emails-in-attio.md
189. https://community.hubspot.com/t5/HubSpot-Ideas/Hubspot-NEEDS-hotkeys-Especially-for-conversation-inbox-message/idc-p/806539/highlight/true
190. https://help.honeybook.com/en/articles/5339081
191. https://updates.dubsado.com/120189-december-3-2025-changelog
192. https://help.honeybook.com/en/articles/2209147-communicating-through-honeybook
193. https://support.pipedrive.com/en/article/how-are-emails-threaded-in-pipedrive
194. https://help.dubsado.com/en/articles/15811785-connect-your-email-account-with-google
195. https://help.dubsado.com/en/articles/15811787-connect-your-email-account-with-smtp
196. https://help.honeybook.com/en/articles/7004773-email-faqs
197. https://knowledge.hubspot.com/inbox/connect-channels-to-the-conversations-inbox
198. https://help.17hats.com/en/articles/1063489-using-the-17hats-mail-server-as-your-outgoing-server
199. https://help.17hats.com/multi-user/multi-user-email-settings-using-the-17hats-mail-server
200. https://help.hellobonsai.com/en/articles/1458000-bonsai-s-white-labelling-features
201. https://5.basecamp-help.com/article/1177-notifications
202. https://attio.com/help/reference/email-calendar/sharing-emails.md
203. https://support.pipedrive.com/en/article/email-privacy-and-sharing-emails-in-pipedrive
204. https://help.honeybook.com/en/articles/2209044-team-member-roles-in-honeybook
205. https://help.dubsado.com/en/articles/13492341-team-member-roles-permissions
206. https://help.17hats.com/en/articles/840254-users-getting-started-and-setting-permissions
207. https://help.productive.io/en/articles/2179641-employees-contractors-clients-and-contacts-an-overview
208. https://help.productive.io/en/articles/2179618-adjusting-user-permissions
209. https://5.basecamp-help.com/article/1171-permissions
210. https://support.pipedrive.com/en/article/visibility-groups
211. https://support.pipedrive.com/article/permission-sets
212. https://knowledge.hubspot.com/account/partition-your-hubspot-assets
213. https://knowledge.hubspot.com/user-management/create-and-manage-teams
214. https://attio.com/help/reference/workspace-settings-billing/manage-members-and-admins.md
215. https://attio.com/help/reference/managing-your-data/objects/manage-access-to-objects
216. https://5.basecamp-help.com/article/1082-what-clients-can-see-and-do
217. https://help.productive.io/en/articles/2179576-adding-clients-to-projects
218. https://help.dubsado.com/en/articles/15920590-customize-the-client-portal
219. https://help.withmoxie.com/en/articles/5855648-client-portal-permissions
220. https://help.17hats.com/en/articles/3160024-client-portal-customizing-per-contact
221. https://help.honeybook.com/en/articles/2814167
222. https://knowledge.hubspot.com/account-management/view-and-export-account-activity-history
223. https://support.pipedrive.com/en/article/security-dashboard
224. https://help.honeybook.com/en/articles/2209151-understanding-email-statuses
225. https://support.duda.co/hc/en-us/articles/26519392554775-Manage-Team-Members
226. https://developer.duda.co/docs/creating-team-members
227. https://support.wix.com/en/article/wix-studio-manage-your-team
228. https://knowledge.hubspot.com/partner-tools/grant-partner-admin-access-to-partner-employees
229. https://www.honeybook.com/blog/honeybook-plans
230. https://dubsado.com/pricing
231. https://help.dubsado.com/en/articles/15920692-invite-a-team-member-to-join-your-workspace
232. https://www.withmoxie.com/product-pages/teams-and-collaborators-for-freelancers
233. https://help.honeybook.com/en/articles/8909702-resolving-an-invalid-dkim-error
234. https://support.pipedrive.com/article/how-can-i-re-authenticate-my-email-sync-in-pipedrive
235. https://support.pipedrive.com/article/troubleshooting-email-sync-feature
236. https://knowledge.hubspot.com/connected-email/troubleshoot-imap-inbox-connection
237. https://help.dubsado.com/en/articles/15920620-why-did-my-client-s-payment-fail
238. https://help.honeybook.com/en/articles/6399179-troubleshooting-client-payments
239. https://community.honeybook.com/money-talk-143/auto-pay-2531
240. https://community.hubspot.com/t5/Releases-and-Updates/Clear-Visibility-into-Salesforce-Sync-Health/ba-p/417749
241. https://help.agencyanalytics.com/en/articles/5719775-account-level-data-sources-overview
242. https://status.honeybook.com/
243. https://help.dubsado.com/en/articles/8558078-is-dubsado-down
244. https://status.hubspot.com/
245. https://status.pipedrive.com/
246. https://status.attio.com/
247. https://www.37status.com/
248. https://status.duda.co/
249. https://support.wix.com/en/article/wix-services-status-page
250. https://help.dubsado.com/en/articles/15920685-customize-your-dubsado-urls
251. https://help.honeybook.com/en/articles/9468125-client-portal-and-access-faqs
252. https://help.withmoxie.com/en/articles/5855651-client-portal-custom-domains
253. https://support.duda.co/hc/en-us/articles/26519443459991
254. https://support.wix.com/en/article/wix-studio-setting-up-custom-branding
255. https://support.wix.com/en/article/wix-studio-request-customizing-the-site-dashboard-for-clients
256. https://support.duda.co/hc/en-us/articles/26520120146967-SSL-HTTPS
257. https://developer.duda.co/reference/ssl-certificates
258. https://developer.duda.co/docs/domain
259. https://support.wix.com/en/article/checking-your-domain-subscription-renewal-date
260. https://support.wix.com/en/article/wix-domain-renewal-payment-failure
261. https://support.wix.com/en/article/wix-studio-managing-site-notifications-in-your-workspace
262. https://supademo.com/blog/guides/how-to-sync-email-and-calendar-in-attio
263. https://help.productive.io/en/articles/6423123-dashboards
264. https://help.agencyanalytics.com/en/articles/10157947-customize-your-home-page-and-profile
265. https://knowledge.hubspot.com/account/view-and-manage-your-partner-dashboard
266. https://help.17hats.com/en/articles/3110596-17hats-dashboard
