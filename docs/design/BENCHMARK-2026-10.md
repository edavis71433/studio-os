# Studio OS against the market leaders — October 2026

**For:** Eric, to decide. **Status:** proposal. Nothing here is built.
**What this is:** Studio OS held up, dimension by dimension, against the products that define "good" in each of its three halves, and against the published design systems the best SaaS products follow. The market research behind it, with 233 sources, is in [research/market-benchmark-2026-10.md](research/market-benchmark-2026-10.md). The Studio OS side comes from the code on `main` at ed14a1e and the walks in [WORKFLOW-AUDIT-2026-10.md](WORKFLOW-AUDIT-2026-10.md).
**Who it compares against:** CRM: Salesforce, HubSpot, Pipedrive, Attio. Website builders: Squarespace, Wix, Webflow, Framer, Shopify, WordPress.com. Agency and client-portal tools: HoneyBook, Dubsado, Bonsai, Moxie, 17hats, Basecamp, Productive. Design: Linear, Stripe, Notion, Vercel Geist, Salesforce Lightning, Shopify Polaris, Atlassian, HubSpot Canvas, Apple HIG, Material.

## The short version

- **The leaders have converged.** A CRM record, a builder's publish sheet and a portal's invoice page all have the same shape now: status at the top, one primary action, a link that never dead-ends, and a human click before anything irreversible. Studio OS does not need to invent an interaction language. It needs to adopt the published one and spend its originality where the leaders are weak.
- **Studio OS is already ahead in six places** (section 6): deliverable approvals in the client portal (no portal tool has this as a first-class feature), every publish restorable with compare and timewarp (Squarespace has no version history at all), scheduled whole-site publish (only Wix has it), AI answers that are grounded with a low-confidence guard, accessibility checks in CI, and sign-up to a live AI-drafted site in seven clicks with no card.
- **It is at par in most of the rest** (sections 2–5): the record page, the Kanban pipeline, one Inbox for every channel, inbound email landing on the record, the setup checklist, magic-link client sign-in, Stripe-hosted invoices, Stripe's billing portal, a 14px Inter base with one accent, dark mode, a three-tab phone bar.
- **It is behind in nine places**, all fixable (section 7, ranked): the moment after a client pays says nothing; invoice money has three states where the leaders show four; SEO has no search-result preview and no setup wizard; connecting a domain is a manual records table with no provider auto-connect; a proposal, agreement and deposit arrive as up to three emails where the leaders send one link; there are no owner-set automations (only system ones); the bell has no filters or mark-read; AI answers don't show what they drew on; and the visual language leaks in three ways (emoji as icons, long toasts, no spacing scale).
- **The ranked program** (section 7) is thirteen items. The first six are small-to-medium and would take Studio OS from "at par" to "recognisably in the same family as the leaders while ahead where a non-technical owner feels it most". Three of them are proposed as sessions for you to start.

---

## 1. How to read the tables

Each row is one dimension. "Leaders" is the converged pattern from the research (variants in the full report). "Studio OS" is what the code does today. The verdict is one of:

- **Ahead:** Studio OS does something the leaders don't, or does it better.
- **At par:** the pattern is there and works.
- **Behind:** the pattern is missing or weaker, with the fix named.
- **Skip:** the leaders do it, but it would not help a one-person studio and its clients. Said so deliberately, so nobody builds it by reflex.

---

## 2. CRM

| Dimension | Leaders | Studio OS | Verdict |
| --- | --- | --- | --- |
| Record page | Three zones: header with ~5 key fields and quick actions; a stage bar (Salesforce Path with ≤5 key fields and guidance per step); a merged activity timeline; related cards in a side column. HubSpot adds an AI "Summary" at the top. | `crm.html`: header, lifecycle bar Lead → Growth, tabs, one primary action (Send invoice), a merged timeline (messages, support, the originating enquiry, bookings, deal events, broadcasts), composer with saved replies. No AI summary. | **At par.** A one-paragraph AI summary at the top of the record (what this customer is, where they are, what's next) is a small add via `/concierge/ask`. |
| "Next step" | Stored per deal; cards sorted by next activity; Pipedrive asks "what's next?" when you tick an activity off. | `next_step` and `next_step_at` on deals; Today's *This week* lists them; the pipeline list sorts by them. No prompt when a to-do is ticked. | **At par.** The "what's next?" prompt after Done is a small add (item 13). |
| Pipeline | Kanban by default; per-stage rotting days turn a card red; HubSpot blocks a stage move until required fields are filled; forecast tiles. | Kanban with drag; a stale marker on cards; stage-aware actions; summary tiles. No per-stage rotting setting, no required-fields gate. | **At par.** Rotting days per stage: small (item 13). Required-fields gates: **skip**, a one-person studio knows its own deals. |
| Inbox and email | HubSpot: one team inbox for email, chat, forms, WhatsApp. Everywhere: a customer's email reply lands on their record by address matching. Sequences, open tracking, snippets. | One Inbox for client messages, support, website enquiries, approvals and notices. Inbound email lands on the record by address (known senders). Replies to enquiries sent from the app (Oct 20). Saved replies. No sequences, no open tracking. | **At par** on the parts that matter. Sequences and open tracking: **skip** (a studio with twenty clients does not run drip campaigns; broadcasts cover the rest). |
| Home / "needs me" | Tasks due, today's meetings, hot deals, unanswered leads, and money in four buckets: Paid, Processing, Upcoming, Overdue (HoneyBook). HubSpot's Sales Workspace puts "Start tasks" first. | Today: Needs you, today's schedule, the money band (outstanding and overdue), This week, Coming up, customers. | **At par.** The money band shows two buckets; the leaders show four (item 2). |
| Automation | Trigger → steps → an "awaiting your approval" gate (HoneyBook, Dubsado); HubSpot builds a workflow from a sentence. | System-run only: a lead follow-up nudge, one gentle unpaid-invoice reminder, a weekly owner digest. Nothing the owner can switch on, off or tune. | **Behind.** Not a workflow builder; three named switches (item 6). |
| AI | Draft → human clicks Apply (Shopify Sidekick, Intuit, Salesforce). Business-data assistants rarely cite what they used; support bots (Intercom Fin) do. HoneyBook: an 8am priority list, lead enrichment, email drafts. | Concierge Ask (grounded, returns `sources` and a `low_confidence` flag), the writer (drafts into the draft; nothing publishes without you), the coach (health, opportunities), Visual Studio. Entry points: Today's Ask box, Help, the builder desks. Sources are returned but never shown. No "draft a reply" in the composers. | **Ahead** on the guardrail and grounding; **behind** on showing it and on drafting (item 9). |
| Search and keyboard | ⌘K to search or run a command; `/` focuses search; single letters create (Pipedrive `D` deal, Attio `n`); `?` lists shortcuts. | ⌘K with pages, records and files. Nothing else. | **Behind**, small (item 10). |
| Onboarding a new owner | A 3–5 step checklist with "n of N", dismissible, a toast per step (Shopify's published pattern); a sample row to edit; import from a spreadsheet. | The setup card on the Website overview: n of N, dismissible, deep links. CSV import on Contacts. No sample data. | **At par.** Sample data: item 12. |

## 3. Website builder

| Dimension | Leaders | Studio OS | Verdict |
| --- | --- | --- | --- |
| Editing model | A pages panel with "+" offering blank or designed layouts; sections then blocks on a canvas; a global styles panel (font pair, five colours); autosave with a separate Publish; undo per session. | Business facts as forms plus a Design canvas with pages, sections and blocks; a layout picker for new pages; design tokens (accent, fonts); autosave ("Everything saved"); undo/redo; comments. | **At par.** |
| Preview and publish | One Publish button; a sheet before or after showing what changes (Framer's "View Changes" and "Optimized" pre-flight); then the URL and View site. | Publish · N → the ritual reads every change in plain words → Publish → "See your site" and Copy link. Share a read-only draft link (7 days). | **At par**, and the plain-words read-back is better than most. |
| Versions | Every publish a restorable version (Wix, Webflow, Framer, Shopify). Squarespace: none. | Every publish a version, with restore to draft, compare, checkpoints and timewarp. | **Ahead.** |
| Scheduled publish | Only Wix, via an automation. | Built in: pick a time, optional take-offline time, cancel. | **Ahead.** |
| Domain and launch | Free subdomain; Buy / Connect one I own / Transfer; auto-connect by logging into the registrar (Wix, Webflow via Entri, Shopify for GoDaddy) with a manual Type / Host / Value table as fallback; Verify; a green "Connected" chip; SSL automatic; "24–48h" quoted. | Free subdomain; "I already have a domain" / "I need to get one"; the two records with Copy buttons; "Check if it's ready"; SSL automatic; a Your domain card on the overview (Oct 20). No registrar auto-connect. | **At par** on the flow; **behind** on auto-connect (item 5). |
| SEO | Per-page title (≤60) and description (≤160) with a live search-result preview; Wix's three-question setup wizard (business name, locations, three keywords) that writes the tasks; one-click Google connect that submits the sitemap; a search dashboard. | Site-level and per-page search headline and description with a live Google-style preview and 60/160 counters; a three-question setup (name, where you serve, up to three words) that writes them and lists what is left; Search Console connect; a search card with next steps. | **Level** since item 4 shipped (PR #28, Oct 20). Google connect does not submit the sitemap, which is built in. |
| Onboarding to first publish | AI-first: answer a few questions, generate, edit, publish. Squarespace Blueprint: 5 steps. Paid plan required to publish (Squarespace, Wix); free to a subdomain (Framer, Webflow). | Industry + services + one sentence → AI draft → preview → publish: 7 clicks, no card, live on a subdomain. | **Ahead** on speed. |
| Content tools | AI text help in the editor; stock images; brand kit; forms inbox; bookings; reviews; blog. | Writer (generate, rewrite); stock search; brand kit and tokens; forms → Inbox; bookings; reviews; updates. Visual Studio makes brand images. | **At par**, Visual Studio is a plus. |
| Site home | Shopify Home: to-dos with counts, four metrics, alerts, the launch card. Wix: plan and domain status with Connect / Upgrade. | The Website overview (Oct 20): stat strip, pages with readiness, waiting to publish, recent activity, domain and health cards, setup card. | **At par.** |
| Mobile editing | Text and images only on phones (Squarespace, Wix, Shopify apps); none for Webflow and Framer. | The builder works at phone width (tested), a dock and sections sheet. | **At par.** |

## 4. Client side and money

| Dimension | Leaders | Studio OS | Verdict |
| --- | --- | --- | --- |
| Lead to cash | One emailed link to one combined document, in a forced order: choose → sign → pay. No client account. A 6-digit code only at sign or pay (HoneyBook's "smart file"). | Proposal → accept (sign.html) → agreement → typed-name signature with a certificate block → the deposit link appears → Stripe. Each document is its own email. Installments and retainers exist. | **At par** on the order; **behind** on "one link, one email" (item 7). |
| E-signature | DocuSign: review → consent → sign → finish; ~80% signed within a day. | Typed name as signature, consent line, certificate. | **At par** for a studio's agreements. |
| Client portal | A per-project link, no password, magic link or code; tabs: activity, files, payments, meetings, forms. Deliverable approval is weak everywhere (comments or e-sign only). Moxie enables portals silently with no email. | client.html: magic link or 6-digit code; Home, Messages, Files, Invoices, Requests, Help; a project record with Approve / Request changes on deliverables, to-dos, surveys, file sharing, booking. Invites are sent by email. | **Ahead** on approvals; **at par** elsewhere. |
| Payment UX | Stripe's hosted invoice page as the floor (87% paid within 24h). After paying: a receipt and the status flips. Four statuses. Reminders at most once a day. Autopay is an explicit checkbox. | Stripe's hosted page. Statuses: open, paid, void, with "overdue" derived. One gentle reminder. After paying, the client returns to a row that still says "open" until Stripe's webhook lands, and nothing says so. | **Behind** on the moment after paying and on the four states (items 1 and 2). |
| Notifications | One feed; filter tabs; "Mark read" (keep, unbold) vs "Clear" (hide); a priority tier (Linear); digests batch by group, never urgent items; user-set cadence. | The bell: a popover with rows and a badge that means "unseen since you looked". A weekly owner digest on Mondays. No filters, mark-read or clear. | **Behind**, small (item 8). |
| Help | Search first; an AI answer with its sources shown; then an explicit human hand-off (Intercom Fin). "What's new" somewhere. | Help page with an ask box over the grounded concierge, suggested questions, FAQ, "Still stuck?" to email. Sources not shown. No "what's new". | **At par**; sources in item 9. |
| Billing self-service | Stripe's Customer Portal with deep links; cancel now or at period end; no hidden path. | "Update payment" → Stripe's portal; a deletion card. | **At par.** |

## 5. Visual language

The leaders publish their numbers. This table puts Studio OS's tokens (`shell.css`) beside them.

| Dimension | Leaders | Studio OS | Verdict |
| --- | --- | --- | --- |
| Type | One neutral grotesque (Inter, Geist, SF); 13–14px base; ×1.2 scale on a 4px grid; 13px minimum for anything clickable; tabular numbers for money. Linear uses Inter Display for headings. | Inter for UI at 13–14px; Fraunces (a serif) for titles; tabular numbers on money. | **At par.** The serif is a deliberate signature; keep it, and keep it to titles. |
| Spacing | A published scale: 0/2/4/6/8/12/16/20/24/32/40/48/64/80 (Atlassian); 8px rhythm. | No spacing tokens. Values are chosen per page (10px, 11px, 14px, 18px…). | **Behind** (item 11). It is why pages built on different days feel different. |
| Radii | 6 / 12 / 16px (Geist). | 6 / 8 / 10 / 12px. | **At par.** |
| Colour | A 10-step neutral ramp with role mapping (bg 100–300, borders 400–600, text 900–1000); one accent used for the primary button, focus ring and selection; semantic hues never alone; light first, dark optional; 4.5:1 text, 3:1 UI. | Neutral set, one plum accent, good/warn/clay with soft variants, dark theme, focus ring in the accent. | **At par**; dark mode is ahead of several leaders. |
| Components | One primary button per view; empty state = title with a period + ≤14-word line + one action that mirrors the title (Stripe); skeletons on slow loads; drawers before modals; toasts of about three words, noun + verb (Polaris: "Product saved"). | One filled button per screen is now the rule on the audited screens. Empty states exist with a sentence. Stencils on Analytics. 138 toasts across five pages; several run to 100+ characters. | **At par** on structure; **behind** on toast length (the experience review, in progress, covers wording). |
| Icons | One set at 2px stroke (Lucide, Phosphor, SF Symbols); no emoji in product UI. | SVG icons in the shell and the builder; emoji as icons on the client portal (10), the Inbox (11), Today, the record and the pipeline. | **Behind**, small (item 3). |
| Motion | A ladder: 50–600ms, exits shorter, transform and opacity only; reduced-motion honoured. | `--dur`/`--ease` in the builder; reduced-motion honoured in the shell and the builder; no shared ladder. | **At par** in effect; tokens in item 11. |
| Copy | Sentence case; plain words; status words of 1–3 words; confirmations short. | Sentence case; plain words; some long confirmations. | **At par**, with the toast caveat. |
| Accessibility | 4.5:1 / 3:1; visible focus rings; keyboard-first. | Focus rings on; axe scans in CI on every PR; keyboard contracts on menus, palettes and tab strips. | **Ahead** for a product this size. |
| Mobile | 3–5 bottom tabs; a drawer beyond five. | Home · Inbox · Menu; a PWA with a service worker. | **At par.** |

---

## 6. Where Studio OS is ahead

Said plainly, because it decides where not to spend.

1. **Approve / Request changes on a deliverable, inside the client portal.** None of HoneyBook, Dubsado, Bonsai, Moxie or 17hats has this as a first-class feature; they fall back to comments or an e-signature. Keep it the document-grade moment it is.
2. **Every publish is a restorable version, with compare and timewarp.** Squarespace admits it has neither autosave nor version history.
3. **Scheduled whole-site publish, with an optional take-offline time.** Only Wix offers it, through an automation.
4. **AI that is grounded and says when it isn't sure.** The concierge returns its sources and a low-confidence flag; the writer never publishes. The leaders' business-data assistants mostly skip citations.
5. **Accessibility checks on every pull request.** Rare below enterprise size.
6. **Sign-up to a live, AI-drafted site in seven clicks, no card.** Squarespace and Wix require a paid plan before publishing.

---

## 7. The ranked program

Ranked by how much a non-technical owner or their client feels it, for the effort. S = a day, M = a few days, L = a week or more. Items 1–6 are the ones to do first.

| Rank | Change | Effort | Touches |
| --- | --- | --- | --- |
| **1** | **The moment after a client pays.** Stripe returns them to the Invoices tab with `?paid=<id>`; the row shows "Paid — confirming" with a check mark until the webhook flips it, and a toast says thank you. Today's money band and the record pick up the same state. | **S** | `client.html`, the invoice `success_url` in `sales.ts`, `today.html` |
| **2** | **Money in four states.** Paid · Processing · Upcoming · Overdue on the client's Invoices tab, Today's money band and the record's Billing tab, with the same formula everywhere (the audit's "one source for numbers" rule). | **S** | `client.html`, `today.html`, `crm.html`, `client_delivery.ts` |
| **3** | **One icon set.** Replace emoji-as-icons on the client portal, the Inbox, Today, the record and the pipeline with the shell's SVG set at 2px. Emoji stays in moments where it is content (a celebration), never as a control's icon. | **S** | `client.html`, `inbox.html`, `today.html`, `crm.html`, `pipeline.html` |
| **4** ✓ | **SEO like Wix.** A live search-result preview under each page's title and description (with the 60/160 counters), plus a three-question setup (business name, locations, up to three keywords) that fills the search settings and names the tasks left. Search Console connect already exists. | **M** | `presence.html` Business view, `search` routes. **Done: PR #28 (Oct 20).** |
| **5** | **One link from proposal to deposit.** One tokenized page that carries proposal → accept → sign → pay the deposit, and one email. `sign.html` already chains sign → deposit; the proposal joins it. | **M** | `sign.html`, `sales.ts`, the three email templates |
| **6** | **Three switches, not a workflow builder.** In Settings: *Acknowledge new enquiries within a minute* (with the sentence shown), *Remind unpaid invoices after N days, at most once a day*, *Nudge me when a deal has had no next step for N days*. Each previewable, each on or off. Two already exist as system jobs; this exposes and tunes them. | **M** | `settings.html`, `lifecycle.ts`, `presence_settings` |
| 7 | **AI shows its sources and drafts replies.** Under a concierge answer, chips naming what it drew on ("your hours", "last publish"). In the enquiry and message composers, *Draft a reply* via `/writer/rewrite`, inserted for you to edit, never sent for you. | **S** | `today.html`, `help.html`, `inbox.html`, `concierge.ts` |
| 8 | **The bell grows up.** Tabs (All · Needs you · Updates), Mark read vs Clear, and a priority tier for approvals and money. The Inbox page stays the one place. | **M** | `shell.js`, `workspace.ts` |
| 9 | **Registrar auto-connect for domains.** Entri or Domain Connect for GoDaddy, Namecheap and Squarespace Domains, with the manual table as the fallback. | **M–L** (vendor) | the Domain & email desk, `foundations` routes |
| 10 | **Keyboard beyond ⌘K.** `/` focuses search, `?` lists shortcuts, `n` opens the page's New action. | **S** | `shell.js` |
| 11 | **Design tokens for spacing and motion.** A spacing scale and a motion ladder in `shell.css`, documented in a short `DESIGN-SYSTEM.md`, then a sweep of the per-page values. | **M** | `shell.css`, every page's CSS |
| 12 | **Sample data on a new trial.** A seeded example customer, deal and enquiry the owner can explore and delete, so the first session isn't empty rooms. | **M** | `commerce/signup`, a seed, `today.html` empty states |
| 13 | **Pipeline hygiene.** A per-stage "stale after N days" setting, and the "what's next?" prompt when a deal's to-do is ticked. | **S** | `pipeline.html`, `sales.ts` |

**Deliberately skipped:** email sequences and open tracking; required fields before a stage move; a drag-and-drop workflow builder; a native mobile app (the PWA and phone layouts are tested); a second accent colour or a redesign of the palette. Each would add surface without helping a one-person studio.

**Already underway:** the experience review (wording, feedback after actions, empty and failed states, phone screens by eye) is running as its own session and covers the toast-length and wording findings above.

---

## 8. Numbers to watch

The leaders' numbers are vendor-reported and soft, so they are floors to beat, not targets to hit. The honest internal versions matter more.

| Measure | Leaders say | Worth tracking in Studio OS |
| --- | --- | --- |
| Time to first value | median 1.5 days; CRM 2 days 8 hours | sign-up → first publish (the walk: minutes) |
| Setup checklist completion | 19% average | first-run card completion |
| Activation | 37.5% average | first publish + first enquiry answered |
| Invoices paid within 24h | 87% (Stripe) | the same, on the studio's own Stripe |
| Agreements signed within a day | ~80% (DocuSign) | the same |
| Help resolved without a human | 54–67% vendor, ~30% confirmed | concierge answers not followed by "Still stuck" |
