# Studio OS — Architecture v1.0 (Language & Navigation Freeze)

*The permanent customer-facing foundation for launch. Internal engineering systems (CMS, CRM, DAM, Analytics, AI, Automation, Search, Approval system, Billing, Files, rendering engine) are UNCHANGED — they remain the sellable products in code/routes/db/pricing. This document freezes only what the **customer experiences**: one operating system, outcome language, permission-composed navigation.*

## Locked principles
One login · one shell · one navigation · one command palette (⌘K) · one Inbox (notification center) · one design language · one permission model. Navigation is **composed automatically from Edition × Role** — never hand-listed per persona (unchanged). The agency is not a separate app: **Studio → open a client → the shell re-scopes**, breadcrumb always shows *whose* data. Reviewers get one focused surface. Editions and the Edition×Role model are **unchanged**.

## The canonical vocabulary (internal name → what the customer sees)
| Internal system (stays) | Customer-facing label | Where it lives |
|---|---|---|
| CMS / "Website Builder" | **Website** | primary nav (edit + publish) |
| CRM | **Customers** | primary nav (the relationship area; inbound "leads" appear as *new* here + in the Inbox) |
| DAM | **Files** | primary nav (superset; Photos / Brand / Documents are *collections inside* it) |
| Analytics | **Analytics** | primary nav (plain-English business understanding, not dashboards) |
| Approval system | *(surfaced in)* **Inbox** | not its own tab |
| Messages + Notifications | **Inbox** | one notification center: what needs you + inbound + threads |
| Automation | *(invisible)* | runs; configured *within* each area; never a nav item |
| Billing | **Settings → Billing** | account (avatar) menu, not primary nav |
| Search / command palette | **⌘K** ("Search Studio OS") | secondary accelerator, reaches everything |
| Agency portfolio | **Studio** | the studio scope (agency roles only) |
| A client account | **[Business name]** | drill-in scope, e.g. `Studio › Joe's Plumbing` |
| — | **Today** | the calm home, every role |

Names that **disappear from the UI forever**: *CMS, CRM, DAM, Client Portal, Customer Portal, Customer OS, Website Builder, Admin Tool.* (They live on internally only.)

## Navigation, composed from Edition × Role (the frozen output)
- **Business owner (Studio OS edition):** Today · Website · Customers · Files · Analytics · Inbox  *(+ account menu: Billing, Settings; + ⌘K)*
- **Website edition:** Today · Website · Files · Inbox
- **Customers edition:** Today · Customers · Analytics · Inbox
- **Agency operator — Studio scope:** Today · Clients · Inbox · Analytics → **open a client** → the same shell becomes that client's business-owner nav, breadcrumb `Studio › Joe's Plumbing`
- **Reviewer:** one feed — Today / Inbox / Approvals — nothing else unless permissions add it

The **Studio/Businesses level is role-gated**: a solo owner has one business and never sees it — they land directly in their single context.

## Evaluations you asked for

**Files vs. something else (DAM naming).** Given it will hold images, video, brand assets, contracts, documents, templates, AI assets, and guidelines, **"Files" is the correct customer word** — it's the honest superset (Drive/Dropbox/365 all use it), instantly understood by a non-technical owner, and it scales to any content type where "Media"/"Assets"/"Library" would either be too narrow (Media) or read as jargon/read-only (Assets/Library). *Refinement:* organize *inside* Files with plain collections — **Photos, Brand, Documents, Templates** — so the breadth is discoverable without a new top-level word. (If you ever want a more premium feel, "Library" is the only serious alternative; I'd still choose Files for a plumber.)

**Analytics — organized as understanding, not dashboards (agree, strongly).** Your framing is *better* than a defer. Keep it first-class, but as **plain-English sentences**, matching the calm moat: "214 people visited this week." "Most came from Google." "Your phone number was tapped 11 times." "3 reached your contact page." One screen of *what it means*, with the option to see the number behind any line — never 50 charts. This is the same philosophy as the Health Coach (sentences, not scores) and it's the single biggest way Analytics can feel premium instead of enterprise. Endorsed as a locked principle.

**⌘K — comprehensive, but NOT the primary nav (my one real challenge).** ⌘K should reach **every destination AND every action** (Publish website, Invite user, Reply to lead, Approve changes, Open [customer], Find invoice, Generate a post…) — verbs, not just places. That's excellent and we should build it fully. But it must stay a **secondary accelerator, not the primary way to navigate.** Evidence: Linear/Superhuman are ⌘K-first *because their users are technical power users*; a plumber or salon owner is not, and a palette-first product would abandon the majority who click. Apple's Spotlight, Notion's ⌘K, Shopify's search are all *secondary* to a visible, calm nav. So: visible nav leads; ⌘K accelerates and can *do*, for those who find it. Making ⌘K primary would be the one change that *reduces* usability for the actual customer.

## Competitor read (why they win/lose; is Studio OS simpler)
- **Notion / ClickUp** — flexible/maximalist; overwhelm beginners. Studio OS is *opinionated outcome areas*, not a blank canvas → simpler.
- **Linear / Superhuman** — brilliant minimalism, but keyboard-first for technical users. Studio OS keeps the calm visible nav for non-technical owners → simpler for the target.
- **Shopify** — one admin, plan-gated sections, store switcher (= "open a client"). Studio OS mirrors the good parts and stays lighter.
- **HubSpot / HighLevel** — powerful, sprawling, high cognitive load (HighLevel is exactly the overwhelm we're avoiding). Studio OS wins by subtraction.
- **Squarespace / Webflow / Framer** — Squarespace simple, Webflow/Framer complex for non-designers. Studio OS is correct-by-construction (simpler than Webflow); the honest gap is template breadth.
- **Microsoft 365 / Google Workspace** — the key contrast: they're **app suites** (Word/Excel/Docs/Sheets) with an app-launcher — the literal "which app?" problem. Studio OS is deliberately the opposite: **one shell, capabilities revealed**, no app-switching. That is the differentiator.
**Conclusion:** for a non-technical small business (and the agency serving them), Studio OS is genuinely simpler than all of them — because it's outcome-named, permission-composed, one-shell, and subtractive.

## Final questions — answered
1. **Freeze it?** Yes. 2. **Ship for my own company?** Yes. 3. **Unnecessary complexity left?** Only the risk of *nav creep* if each area sprouts tabs — hold the line at the frozen set. (The 7-edition internal matrix is fine because the customer never sees "edition.") 4. **Still confusing?** Nothing, once "Reviewer/Edition" stay internal and the Studio level is role-gated. 5. **Nav items that disappear?** Automation (not a place), Approvals (→ Inbox), Billing/Settings (→ account menu), standalone "Leads" (→ Inbox + Customers). 6. **Scales solo → agency → franchise → enterprise without redesign?** Yes — *scope nesting* is the scalability: a franchise is "many locations," an enterprise is "orgs of businesses" — all are "open a scope," same shell, same Edition×Role composition. No redesign. 7-9. **Protects standalone CMS/CRM/DAM?** Yes — each is the one shell showing only that capability, intentional not stripped (verified Phase SKU). 10. **One OS, not multiple apps?** Yes. 11. **From scratch today, build differently?** No — this is what I'd build.

## CTO recommendation
The architecture is launch-ready. The only refinements are naming/rendering, not structure: the vocabulary table above, ⌘K as comprehensive-but-secondary, Analytics-as-sentences, Files-with-collections. Every one improves customer understanding and reduces cognitive load without touching the internal systems, security, permissions, editions, or routes.

**I recommend freezing Studio OS Architecture v1.0.**
