# Studio OS — Product Constitution

*The permanent rulebook. Every future feature conforms to this; this does not conform to features. It sits on top of `STUDIO-OS-ARCHITECTURE-V1.md` (frozen). Amend only at a major version (v2.0), never per-feature.*

---

## Section 1 — Core Principles (never violated)
1. **One operating system.** One login, one shell, one design language, one permission model. A customer never switches apps.
2. **One navigation, composed — never hand-listed.** The menu is always `Edition ∩ Role`. New personas add nothing to maintain.
3. **One Inbox.** All "needs you" — messages, approvals, notifications, tasks — live in one place. There is never a second notification system.
4. **One command palette (⌘K).** Reaches every destination and every action. It accelerates; it is never the *primary* nav (the visible nav leads, for the non-technical majority).
5. **Outcome language over technical language.** Customers see Website / Customers / Files / Analytics / Inbox — never CMS / CRM / DAM / any engineering word.
6. **Sentences over scores.** Health, analytics, and coaching speak in plain sentences. No grades, no gamification, no wall of charts.
7. **Plain English over jargon.** If a small-business owner wouldn't say it, we don't show it.
8. **Never expose engineering concepts to customers.** Edition, Role, Reviewer, snapshot, render, migration — internal only.
9. **Every capability has exactly one home.** No feature appears in two areas. Ambiguity is resolved in Section 3, permanently.
10. **Progressive disclosure.** Show the one thing that matters; everything else is one click deeper. Absent (not shown-locked) until owned.
11. **Automation over manual work.** The platform does the work quietly; the owner is told only when a decision is theirs.
12. **Approval-first for anything that changes a live surface.** Nothing publishes or alters a customer's site without their yes.
13. **Everything must reduce cognitive load.** A feature that adds a choice must remove a larger one, or it doesn't ship.
14. **Scope always shows whose data.** A breadcrumb (`Studio › Joe's Plumbing`) is present whenever context is nested.

## Section 2 — Navigation Laws (permanent)
- **No new top-level navigation item** without an architectural-review exception recorded here. New functionality lives **inside an existing capability** first.
- **Billing lives under Settings** (account menu). Never a primary nav item.
- **Automation is never a navigation item.** It runs; it is configured *within* the area it affects.
- **Approvals never become their own app or tab.** They surface in the **Inbox**.
- **Messages and Notifications stay inside the Inbox.**
- **Analytics is one area of plain-English understanding**, never a dashboards hub.
- **The Studio ↔ Business nesting is role-gated.** A solo owner never sees the Studio level.
- **The Reviewer surface stays minimal** (Today / Inbox / Approvals). Reviewers are never turned into administrators.
- **Standalone editions are intentional, not stripped.** A Website-only or Customers-only account must feel complete, never like "the platform with things removed."

## Section 3 — Capability Ownership (one permanent home each)
| Capability area | Owns |
|---|---|
| **Today** | The calm home · what needs you now · the Customer Journey / milestones · the Health Coach line |
| **Website** | Pages · Blog/Updates · SEO · Search settings · Forms (authoring) · Publishing · Design (templates, palettes, type) · Foundations (domain, DNS, SSL, email, hosting) · business facts (incl. NAP correctness) |
| **Customers** | Leads (a lead **is** a Customer record in *new* state) · relationships/timeline · notes · per-customer communication history |
| **Files** | DAM · Photos · Documents · Contracts · Templates · Brand assets & guidelines · AI-generated assets · marketing/social collateral · asset version history |
| **Analytics** | Traffic · sources · conversions · Search Console performance · plain-English AI insights |
| **Inbox** | Messages · Approvals (incl. Files/asset approvals) · Notifications · tasks needing attention · **inbound lead arrivals** |
| **Settings** (account menu) | Billing · plan/upgrade · team & access · profile · integrations config · automation configuration |
| **Studio** (agency roles only) | The client list/portfolio · studio pipeline · studio invoicing · studio growth · cross-client health — then *open a client* to re-scope into that client's Website/Customers/etc. |

**Resolved dual-homes (permanent):**
- **A Lead** — record lives in *Customers*; its *arrival* is an *Inbox* item; the *form* that captured it is authored in *Website*. Three touchpoints, one record-home (Customers).
- **An approval** — the item being approved lives in its own area (a Website change, a File); the *approval action* always happens in the *Inbox*.
- **NAP / business-facts correctness** — owned by *Website* (they're your site's facts); a drift *alerts* via the *Inbox*.
- **The Health Coach** (now / what-needs-you) is *Today*; **Analytics** (over-time understanding) is *Analytics*. Different questions, different homes.
- **AI** has no home — it is invisible plumbing inside Website (drafting/optimization), Customers (concierge), Files (generation), and Analytics (insights).

## Section 4 — Roadmap Validation (every remaining item fits v1.0)
| Roadmap item | Fits? | Home | New nav? | Reuse |
|---|---|---|---|---|
| Analytics (traffic/sources/conversions) | ✅ | Analytics | no | Search Console read |
| DAM / Files library UI | ✅ | Files | no | `/assets/*`, presence_media |
| DAM / asset approvals | ✅ | Inbox (action) + Files (asset) | no | Approval system |
| Search Console integration | ✅ | Analytics | no | connected engine |
| NAP monitoring | ✅ | Website (fact) → Inbox (alert) | no | connected reads |
| AI optimization suggestions | ✅ | inside Website + Analytics | no | intelligence pipeline |
| Additional templates | ✅ | Website → Design | no | render engine |
| Customer Journey / milestones | ✅ | Today | no | `/coach/journey` |
| Admin Health Center | ✅ | Studio (or Settings, operator) | no | `/system/health` |
| Brand management / brand assets | ✅ | Files (Brand collection) | no | DAM |
| Workflow improvements | ✅ | within the relevant area | no | existing spines |
| Future AI features | ✅ | invisible, inside an area | no | metering + pipeline |
**Every current roadmap item fits without new top-level navigation and without changing the architecture.**

## Section 5 — Feature Review Standard (every proposal answers these)
A feature ships only if the answers are yes: (1) measurable customer value; (2) reduces work; (3) simplifies something; (4) increases trust; (5) reuses existing systems; (6) creates no duplicate functionality; (7) fits Architecture v1.0; (8) belongs to exactly one capability; (9) its AI cost is justified by value; (10) its ongoing maintenance is justified. **Any "no" → redesign or reject.** A feature that only "adds a capability we could build" is rejected by default.

## Section 6 — AI Philosophy (highest value per AI dollar, not "AI everywhere")
- **Keep (clear time-savings):** content drafting (pages/posts/FAQs), the grounded Concierge (answers from real facts, no filler), Growth Coach look-ahead, brand-voice review. These replace real minutes of the owner's work.
- **Keep but meter tightly:** Visual Studio image generation (gated on a key; per-op metered) — valuable but the most expensive; never auto-generate, always on request.
- **Prefer deterministic over AI where quality is equal:** health/analytics *sentences*, reply-prefill, journey milestones — these are composed deterministically (zero AI cost) and must stay that way. Do not "upgrade" a deterministic sentence to an AI call.
- **Reject:** AI that generates output nobody asked for, AI scores/ratings, AI that duplicates a deterministic result at a cost. Every generative feature is metered against plan capacity; a feature that can't justify its tokens is revised or cut before launch.

## Section 7 — Technical Debt Prevention (permanent engineering rules)
Reuse before rebuild. Extend before replace. **One source of truth** per fact. **One API per capability.** No duplicate data models. **No second notification system, approval system, search, or file store** — ever. New surfaces render through the one pipeline; new schedules ride the one cron; new notices ride the one notices rail; new assets live in `presence_media`. A PR that introduces a parallel system is rejected on sight, regardless of feature value.

## Amendment process
This constitution and Architecture v1.0 change **only** at a declared major version, and only to fix a *verified* usability, security, or scalability problem — never for a single feature's convenience. Exceptions to a Navigation Law must be recorded in Section 2 with the reviewer and the reason.
