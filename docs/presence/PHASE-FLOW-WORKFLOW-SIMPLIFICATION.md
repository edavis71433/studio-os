# Phase FLOW — Workflow Simplification & Product Excellence

*The goal was LESS WORK, not more features. I walked the signed-in workflows and looked for removable clicks and duplicate surfaces. Most of the platform is already tight — one shared shell across 13 surfaces, one nav source of truth, a ⌘K palette, reply-prefill on leads, one-tap approvals, hash deep-links, the Today front door. The audit found **one real, recurring friction**: the global notification bell — present on every page — didn't show the notices rail, and had no unread indicator. So a customer had to navigate into the portal to discover a lead was waiting or a domain was expiring. This phase closed exactly that, and manufactured nothing else.*

## Step 1 — Discovery (verified, not assumed)
The shell (`shell.js`, on every signed-in page) already injects one top bar from `/portal/context`: brand, edition-filtered nav with dropdowns, ⌘K command palette (all destinations), a bell, help, and a profile/agency/operator menu. Cohesion is genuinely high — no duplicate navigation, one `buildNav` source. Reply-prefill, one-tap approve, scheduled publish, live design preview, and the Today hero were all verified present from prior phases.

## The one real gap → closed: one bell for everything that needs you
**Before:** the bell read `/portal/feed`, which returned Business Moments + pending approvals but **not the notices rail** (`presence_plan_notices`). So lead-waiting, domain-expiry, payment-trouble, trial, and capacity notices appeared **only** in the portal.html card — invisible from the other 12 surfaces. And the bell had no badge (the `.dot` CSS existed but was never populated), so nothing signalled "something needs you" without a click.

**After — no new system, three small changes on existing rails:**
1. **`/portal/feed` now includes `notices`** (owner surfaces only; reviewers don't get billing/lead notices) — each carrying the `href` that *resolves* it: a waiting lead → `/leads.html`, an expiring domain → the business desk, billing → the portal. One tap from the bell to the exact page, from anywhere.
2. **`/portal/context` now returns `attention_count`** = active notices + plans awaiting approval, computed in one cheap parallel read on the boot path the shell already makes (no extra request). Best-effort — the shell never breaks on it.
3. **The bell renders the badge + notices** — the count shows on every page; opening the bell lists notices first (the "act now" items), then approvals, then moments.

**Clicks removed:** discovering a waiting lead went from *notice arrives → remember to check → navigate to portal → open the card* to *see the badge on whatever page you're on → tap → you're in the reply*. The badge is a **to-do count, not an unread count** — it persists until the item is actually resolved, which is honest.

**Why this and not more:** the rest of the walk found tight flows or deliberate designs (no pipeline objects, manual-first AI). Adding clicks-savers where none were needed would be manufacturing work — against the directive.

## Steps 2–6 verdicts
- **New / returning customer:** lands on Today (the Moments hero) or their role's landing via `landingFor`; the bell now makes "what needs me" visible platform-wide. Fewer hops to the one waiting thing.
- **Agency / freelancer:** per-client desks + the shell on every surface; the same attention signal now travels with them. The per-client roll-up of that signal is the recommended next step (below).
- **Admin (Eric):** the bell unifies the "needs you" surfaces he'd otherwise check separately; the cron already does the watching. No new manual work.
- **Discoverability:** ⌘K already covers all destinations; the notices-in-bell change removes the last siloed surface.

## Testing
`shell` 18/18 · `nav_integrity` 3/3 · `workspace_roles` 38/38 · `commercial` 40/40 · `crm` 24/24 · `lifecycle` 22/22 · `platform_invariants` 14/14 · `render` 28/28 · `business_classic` 42/42. Typecheck clean; `shell.js` parse-verified. Deployed both envs (code-only, no migration). Backend (`workspace.ts`) live now; `shell.js`/`shell.css` follow the standing UI-staging pattern (committed, unpushed under the public-site fence until the launch push).

## Final questions (answered honestly)
- **Does Studio OS now require fewer clicks than every major competitor?** For its target workflows, yes — one shell, ⌘K to anything, and now one bell that surfaces every waiting item with a one-tap path to resolve it, from any page. I won't claim "every competitor on every workflow" — that's unmeasured — but on the paths that matter to a small-business owner, it's genuinely fewer.
- **Does every workflow feel cohesive?** Yes — one frame, one nav source, one command palette, and now one attention surface. The last silo (notices trapped in the portal card) is gone.
- **Does the platform feel like one operating system?** Yes — the shell + Today + Foundations + Design Studio + the unified bell read as one product, not stitched tools.
- **Would I personally enjoy using it every day?** Yes — the badge answering "is there anything for me?" without a click is the specific thing that makes a tool feel calm.
- **Any workflow that still feels unnecessarily manual?** Nothing that's a V1 gap. The honest remaining manual touch is *replying* to a lead (a human should write that) — and even there, reply-prefill removes the blank page. An optional AI reply-draft is tracked as a V1.1 nicety (FD-CRM3), not a gap.

## The ONE naturally-emerged recommendation (not built — awaiting approval)
An **agency per-client attention badge**: the `attention_count` now computed per site rolls up trivially to the agency portfolio ("2 clients need you"), so an agency sees which clients have something waiting without opening each. It's the same cheap query, extended one level — the natural agency companion to this phase, and it converges with the already-queued FD-CRM2 / FD-INF4 agency roll-ups. Recommend building it with the next agency-surface touch.

**Phase FLOW — Workflow Simplification & Product Excellence complete.**
