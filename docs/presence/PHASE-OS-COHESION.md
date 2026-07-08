# Phase OS — Operating System Integration & Cohesion

*The test: pretend the names Admin Portal / CMS / CRM / Client Portal don't exist — would a customer realize these are separate products? I walked every signed-in surface and every transition. The seams are almost all already closed (one shell, one nav source, one auth/session, one command palette, one notification bell unified in Phase FLOW, one approval spine, one intelligence pipeline, one render path). The audit found **one real remaining seam** — the home page and the global bell disagreed about "what needs you" — and closed it. Nothing manufactured.*

## Step 1 — Discovery (verified)
Every signed-in page (`today`, `presence`, `crm`, `leads`, `connections`, `visual-studio`, `schedule`, `developer`, `agency`, `client`, `sharing`, `help`, `get-started`) loads the **one shell** (`shell.js`), which draws its top bar from **one** `/portal/context` (brand, edition-filtered `buildNav`, ⌘K palette over all destinations, the notification bell, help, profile/agency/operator menu). One Supabase session (`dds-portal-auth`) is shared by every surface. There is no second navigation system, no second auth, no second notification channel. Cohesion is genuinely high before this phase.

## Steps 2–5 — the four "products", audited as one
- **Admin / owner workspace** (`presence.html` + `today.html`): Today is the Business-Moments hero; the workspace holds Business/Design/Media/Content/History/Search/Foundations, all hash-deep-linkable and ⌘K-reachable. No duplicated surface found; Foundations was the one important desk not yet deep-linkable (fixed below).
- **Client portal** (`client.html`): the reviewer sees only shared items + the plans put to them — a real server-enforced boundary, not a facade. It wears the same shell, so it never feels like a different app.
- **CMS**: stands alone (business classic + restaurant templates, one render path `renderSnapshot → template → injectDevLayer`) yet integrates — a publish is a CRM timeline event, a change feeds the intelligence pipeline. No parallel datastore.
- **CRM**: the operational relationship hub aggregates existing signals into one timeline; it does not duplicate the Client Portal or Today — it's the studio-side lens on the same events. The un-replied-lead nudge (Phase CRM) and weekly digest are its automation.

## Step 6/7 — the one seam found and closed: Today == the bell
**The break:** Phase FLOW unified the top-bar **bell** to show the attention feed — notices (a lead waiting, a domain expiring, billing) + pending approvals — with a badge on every page. But `today.html` — the page literally titled *"what needs you today"* — still rendered only Business Moments + the search-health line. So the bell could say **"2 need you"** while Today, the home surface, showed none of them. Two answers to one question: the exact kind of seam that makes software feel like stitched-together products.

**Closed (frontend-only, no new system):**
- **`today.html` now consumes the same `/portal/feed`** the bell reads and renders **notices + pending approvals as the top "needs you" cards**, above Moments — each tapping straight through to the page that *resolves* it (a waiting lead → the leads inbox, an infra approval → the Foundations Desk, a connected approval → Connections). The empty-state ("All clear") now correctly accounts for them, and the subheading reflects the true total. The bell and the home page now tell **one story**.
- **`presence.html` gains a `#foundations` deep-link** (routed exactly like the existing `#publish` / `#preview`), so the technical desk where domain/email/security approvals are decided is now reachable from Today, the bell, and ⌘K — the last important surface that wasn't deep-linkable.

No backend change: `/portal/feed` already returns notices + approvals (built in Phase FLOW); this phase makes the home page honor them. No duplicate approval UI — Today is a launchpad that points at the one place each decision is made, never a second decision surface.

## Step 8 — Discoverability
⌘K already reaches every nav destination; the notices silo (portal-only, closed in FLOW) and the Foundations deep-link (closed here) were the two remaining "you had to know where to look" gaps. Nothing else surfaced as hidden or a dead end.

## Testing
`nav_integrity` 3/3 · `shell` 18/18 · `workspace_roles` 38/38 · `platform_invariants` 14/14 · `commercial` 40/40 · `crm` 24/24 · `lifecycle` 22/22 · `render` 28/28 · `business_classic` 42/42. Inline scripts of `today.html` + `presence.html` parse-verified. Frontend-only — no migration, no function deploy; the HTML follows the standing UI-staging pattern (committed, unpushed under the public-site fence until the launch push). `routeHash()` runs on cold load, so `/presence.html#foundations` opens the desk directly.

## Final questions (answered honestly)
- **Does Studio OS now feel like ONE operating system?** Yes — one shell, one nav, one session, one palette, one bell, and now one consistent "what needs you" between the bell and the home page. The last visible seam is gone.
- **Could a customer use it for months without realizing there are separate products underneath?** Yes. Nothing in the signed-in experience announces a boundary between "CMS" and "CRM" and "portal" — they share the frame, the data, and the language. The only real boundary (client reviewer vs owner) is a deliberate, calm simplification, not a different app.
- **Would an agency naturally understand the flow?** Yes — per-client desks inside the same shell; the one open cohesion item is surfacing per-client attention at the portfolio level (recommended below).
- **Would an administrator naturally understand the flow?** Yes — the operator tools hang off the same profile menu and nav; the cron does the watching; the bell + Today concentrate "what needs me."
- **Would I personally ship this architecture?** Yes — it's genuinely one system with shared spines, not four apps behind one login. The remaining launch work (Playwright E2E, owner activation, the push) is not architectural.
- **Anything left preventing complete cohesion?** Nothing at the owner level. The one honest asymmetry: the owner's Today now mirrors the bell, but the **client portal's** home doesn't yet give the client the same unified "here's what's waiting on you" card treatment — that's the natural next step, below.

## The ONE naturally-emerged recommendation (not built — awaiting approval)
Extend this phase's "Today == the bell" treatment to the **client portal home** (`client.html`): render the client's pending approvals as the same actionable "needs you" cards, so the *client's* experience is as cohesive as the owner's. It's the same `/portal/feed` (already role-filtered for reviewers) rendered the same way — no new system, the direct mirror of what shipped here. (The agency per-client attention roll-up, FD-FLOW2, remains separately queued.)

**Phase OS — Operating System Integration & Cohesion complete.**
