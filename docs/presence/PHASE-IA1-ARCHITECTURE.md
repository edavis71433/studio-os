# Phase IA-1 — Product Architecture Consolidation (evaluation, no code)

## The one-paragraph answer
You're right about the destination — **one product, one login, one shell, capabilities revealed by permission** — and the good news is the platform is already ~90% built that way (one `shell.js` frame on every signed-in page; `buildNav` already derives the menu from role + edition). Where I'd **push back** is on the *method*: don't design navigation as a hand-written list per persona. Design it as capabilities revealed by **two independent switches — Edition × Role** — plus **one context switcher** for agency operators, and make the **Reviewer a single screen, not a tab bar**. That model scales to any future role or edition with *zero* new nav definitions, it's the smallest possible engineering change, and it kills the "which app am I in?" problem for good.

## The first-principles frame: two orthogonal axes, not personas
Your proposal lists a fixed nav per persona (Platform Owner gets X, Business Owner gets Y, Reviewer gets Z, CMS edition gets W…). The hidden problem: **you're blending two independent dimensions into one list.**

- **Edition = what the account bought** → which capability *areas exist at all* (CMS = website; CRM = customers; Studio OS = both; Agency = both + agency tools).
- **Role = who you are inside the account** → *how much* of those areas you can touch (owner = all; staff = subset; reviewer = approve-only).

The correct nav is simply the **intersection**: `visible = capabilities(edition) ∩ permissions(role)`. Define the two axes once and every combination composes automatically. Hand-listing personas means: every new role or edition multiplies the lists (5 roles × 5 editions = 25 hand-maintained navs), they drift out of sync, and a "CRM-edition Reviewer" is undefined until someone writes it. Deriving from two axes means those 25 combinations already work and the 26th is free. **This is the single most important correction.** (And it's what `buildNav(editionFlags × capabilities)` already does — your instinct to unify is right; the persona-lists would actually walk it backward.)

## What Apple / Notion / Linear / Shopify would each do
- **Apple** — one app, ruthless progressive disclosure, and they'd make the *lowest-need* user (the Reviewer) almost invisibly simple — one screen, not four tabs. They'd delete the words "Portal / OS / Admin Tool" without hesitation.
- **Notion** — one workspace; everything is the same surface; *per-object permissions* reveal what you can open. No separate "products." They'd resist edition-as-a-different-app entirely.
- **Linear** — opinionated and minimal; two clean axes (workspace-level settings vs. per-team membership) that *compose*; **guests get a deliberately tiny surface.** They would never hand-list a nav per persona.
- **Shopify** — one merchant admin where plan + staff-permissions unlock sections — **but** they deliberately keep *their own* operator tools (Partners dashboard) **separate** from the merchant admin, reached by a **store/context switcher**. This is the precedent for your "Platform Owner" question below.

Synthesis: **one product, two composable gates (edition × role), a context switcher for operators, minimal surface for low-need roles, and the words for the sub-products disappear.**

## The one place I disagree with your list: "Platform Owner" as just another nav
You listed Platform Owner (you) as a peer nav in the same menu: Today · Clients · CRM · CMS · DAM · Analytics · Approvals · Messages · Settings · Admin. That is precisely the shape that overwhelmed you in the cockpit, because **you wear two different hats and they're different jobs:**

1. **Operating a client's web presence** (edit their site, approve, publish) — this *is* the customer product, in an elevated **Agency/operator role**. It belongs *inside* the one product.
2. **Running the studio as a business** (who to pitch, proposals, invoices, MRR, growth outreach) — this is *your company's* back-office. It is a different domain than "run a website."

Cramming (2) into the same flat nav as a business owner's website tools is what created the crowding. The fix is **not** a separate app (that reintroduces "which app?") — it's **one context switcher**: at the top-left, you're either in **"My Studio"** (your agency back-office: pipeline, clients, invoicing, growth) or **"Acting for: [Client]"** (that client's Presence account, in the agency role). Same login, same shell, same brand — you *switch context*, you don't switch apps. A business owner simply never sees the switcher (they have one context: their own account). This is the Shopify store-switcher / Linear team-switcher / Slack workspace model, and it's the elegant reconciliation of "one product" with "two very different jobs."

## The Reviewer should be one screen, not four tabs
Your Reviewer nav was Today · Approvals · Files · Messages. For the lowest-need user, four tabs re-creates "which tab?" A reviewer's entire world is *"here's what's waiting for your OK."* Make it **one calm surface** (the existing `client.html` already is this) with approvals first, updates below, and messages inline — no nav to reason about. Every product you admire gives guests the *smallest* surface, not a scaled-down copy of the owner's.

## Terminology — yes, all three names die (externally)
- **"Customer OS"** → just the product/brand name. It isn't a *thing* a user picks; it's the product.
- **"Client Portal"** → becomes *the Reviewer view of the one product*. The word "portal" disappears.
- **"Admin Tool"** → becomes *the "My Studio" context of the one product* (internal label: "Studio Console"). "Admin tool" disappears externally.
There is ONE brand. A user never chooses between products; the product reveals what their edition + role allow.

## #13 — keep routes separate internally, one experience externally (strong yes)
Do **not** merge `today.html / presence.html / client.html / leads.html` into a single SPA — that's large effort for zero user benefit and real regression risk. They already share one shell, one session, one nav source. The consolidation is **framing, not rebuilding**: one brand, one nav derived from edition×role, the context switcher, and the reviewer reduced to one surface. Internally the routes stay exactly as they are. This is the *minimize-engineering* answer.

## The 14 evaluation points, briefly
1. **Navigation** — one shell (built); nav = edition ∩ role (built); add the context switcher. 2. **IA** — capability areas (Website, Customers/CRM, Leads, Files/DAM, Analytics, Approvals, Messages, Billing, Settings) exist once; shown by permission. 3. **Permissions** — keep the frozen role/capability + edition-gating model (do not touch security). 4. **Editions** — stay as data (`editions.ts`); they gate *areas*, roles gate *depth*. 5. **Standalone CMS** — the one app showing only Website+Files+Publish+Design (already works, Phase SKU). 6. **Standalone CRM** — the one app showing only Customers+Leads+Pipeline+Messages+Analytics. 7. **Studio OS** — the union. 8. **Agency** — Studio OS + the "My Studio" context. 9. **Reviewer** — one surface. 10. **Business owner** — full workspace for their edition. 11. **Platform owner** — the agency operator with the context switcher (not a mega-nav). 12. **Upgrades** — an edition change flips capability flags; the same nav reveals more (the felt "upgrade moment" already exists, PP-6). 13. **Routes** — separate internally, unified externally (above). 14. **Terminology** — the three names disappear (above).

## Comparing the two proposals
| | Your proposal | Recommended |
|---|---|---|
| One product, permission-driven | ✅ (correct) | ✅ (same) |
| Nav definition | hand-listed per persona | derived from edition × role |
| Scales to new role/edition | multiplies the lists | free (composes) |
| Platform-owner complexity | flat mega-nav (overwhelm risk) | context switcher ("My Studio" ↔ "Acting for") |
| Reviewer | 4 tabs | 1 surface |
| The three names | implicitly gone | explicitly deleted |
| Engineering | rewrites navs | ~90% already built; add a switcher + trim |

**Weaknesses in your proposal:** persona-hand-listing doesn't scale and conflates two axes; the platform-owner mega-nav re-creates the overwhelm; the reviewer is over-served.
**Weaknesses in mine:** the context switcher is *one* concession against "literally one nav" — a business owner never sees it, but it is a concept an agency operator must learn (mitigated: it's the single most familiar SaaS pattern). Deriving nav from a matrix demands disciplined edition×role rules (we already have them).

## CTO review — recommendation
Adopt: **one product; nav = edition ∩ role; a context switcher for agency operators; the reviewer as one surface; the three sub-product names deleted; routes kept internal.** It materially improves simplicity (fewer definitions), cohesion (one brand/shell), low cognitive load (progressive disclosure, minimal reviewer), and scalability (combinations compose) — and it is *less* engineering than your persona model because it leans on what's built. The only genuinely new build is the **context switcher**; everything else is terminology + trimming + turning off a few nav items by permission. I'd reject anything beyond that as "different, not better."

## Convergence — Option 4 (owner's refined proposal) is the strongest, and it updates my position
The owner refined to a fourth option: **one Studio OS, role-based workspaces — the agency gets the full OS as one workspace; business owner a simplified workspace; reviewer simpler still; CMS-only/CRM-only see the same shell with only what they bought.** I tried to break it, and I'm updating my recommendation: **this beats my earlier "separate operator console / context switcher" framing.** Reasons:
- A *persistent* "My Studio ↔ Acting-for" toggle is heavier than needed. The cleaner mechanism is **drill-in scoping within one workspace**: the agency's home is the *studio scope* (Clients, pipeline, portfolio); **opening a client re-scopes** the same shell to that client's account (their Website, their Leads, their Approvals), with a breadcrumb back. Same nav, re-scoped — more Notion/Linear (drill-in) than Shopify (separate dashboard). One workspace, not two spaces. That is Option 4, and it's cleaner.

**The one non-negotiable inside Option 4:** the workspace has **two levels of scope** and the UI must always make *which* obvious. "Website / Leads / Customers" are meaningless without "whose." So the agency workspace = **studio scope** (my clients, my pipeline, my invoicing) **↔ client scope** (this client's site), reached by opening a client. A business owner has exactly one scope (their own account) and never sees the studio level. This isn't a second product — it's nesting, made explicit.

## Where I still hold the line (the genuine challenges that survive)
1. **Derive nav from Edition × Role — do not hand-list per persona.** Option 4 is still described as fixed lists ("business owner gets A,B,C…"). Define the two axes once; compose the menu. 5 roles × 5 editions = 25 navs you'd otherwise hand-maintain and keep in sync; composition makes them free and the 26th automatic. This is *how* Option 4 should be built, and it's already how `buildNav` works.
2. **Reviewer = one surface, not a tab bar.** Even "simpler" should mean *one screen* (approvals first, updates below), not a shrunk owner nav.
3. **Keep the business-owner "Customers" LIGHT.** We deliberately built the customer-side relationship view as a calm hub, *not* a heavy sales pipeline (that's the CRM edition's job and the agency's studio scope). Don't let "Customers" in the owner workspace balloon into a pipeline — that re-imports the complexity we're removing.
4. **Routes stay internal; only the frame unifies.** No SPA rebuild.

## Final endorsed architecture
**One Studio OS. One login, one shell, one brand.** Navigation = **Edition ∩ Role**, composed (not hand-listed). **Scope nests** for agency operators (studio ↔ client via drill-in). **Reviewer = one surface.** **Editions gate capability areas; roles gate depth.** The names *Client Portal / Customer OS / Admin Tool* are **deleted** externally; internally the routes are untouched. Net new engineering: the **client-scope drill-in** for the agency workspace, terminology unification, and turning nav items on/off by permission — everything else is already built. This is Option 4, sharpened.

**Phase IA-1 — Product Architecture Consolidation complete.**
