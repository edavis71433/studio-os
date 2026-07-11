# Competitive Customer-Experience & No-Code Parity Pass

**Lens (per owner):** not feature-count parity — **seamlessness and automation**. The client should never have to *think*; the operator (Eric) should have the most hands-off path possible. Refine anything genuinely cumbersome for a customer, a client, or Eric. Behind the push fence; stop for review.

Benchmark set verified from current (2025–26) official/review sources — CRM: HubSpot, Salesforce, Zoho · CMS/DXP: Wix Studio, Webflow, WordPress.com, Adobe Experience Manager · Hosting/publishing: Netlify, Vercel, Cloudflare Pages.

---

## 1. HTML inventory (80 files) — dispositions
Full classified table in the analysis run. Summary:
- **Keep (as-is):** the 28 shell-based authed surfaces + 8 `cms.css` customer pages + public marketing/legal/tools. Navigation is **one source of truth** (`buildNav` → `shell.js`), adopted by all 28 authed pages.
- **Merge/redirect:** `leads.html` (orphan; not in `buildNav`; overlaps Inbox → route through Inbox). `portal-workspace.html` (already a reversible redirect to `portal.html#growth` — correct). `approve.html` overlaps `approval-center.html` (magic-link vs in-app — both legitimate, keep).
- **Improve:** `portal.html` (a second customer front-door on `dds-foundation.css`, not the shell — the known portal-retirement item).
- **Internal-only (obscure-URL/noindex):** `dds-studio-manage-9k2p.html`, `admin-health.html`, `admin-growth.html`, `email-signature.html`, `_internal/*`.
- **Developer-only (noindex):** `developer.html`, `provision.html`, `tests.html`, `a11y.html`, `mobile.html`, `styleguide.html`, `_internal/function-test.html`, `connections-callback.html`.
- **Design-system fragmentation (systemic):** five parallel CSS systems in the repo — `shell.css` (app), `cms.css` (customer CMS pages, unified this cycle), marketing `styles.css`, `dds-foundation.css` (portal/admin), `tokens.css`/`components.css` (styleguide). Consolidation is browser-QA work, not a headless change.

## 2. Competitor benchmark matrix (experience/automation lens)
Scoring is about *how seamless/hands-off*, not feature count. **L**=Leading · **C**=Competitive · **B**=Usable-but-behind · **X**=Intentionally different.

| Experience dimension | Benchmark leader (evidence) | Studio OS | Note |
|---|---|---|---|
| Guided first-run / onboarding | HubSpot (AI-guided setup, "productive in a week") | **C** | Guided intake + auto-provision + first-run; less AI-conversational than HubSpot |
| No-code CRM operation (SMB) | Zoho/HubSpot (no-code workflows, blueprints) | **C** | Every CRM action is button/form; no code. Narrower automation catalog than Zoho |
| One connected system (CRM↔site↔delivery↔billing) | *none of them* — all require integrations | **L** | Lead→proposal→contract→convert→**auto**-provision→project→publish→bill is ONE spine, no bolt-ons |
| Visual/creative page editing | Wix Studio / Webflow / WordPress.com (WYSIWYG, drag-drop) | **X/B** | Studio OS is deliberately **form-based & "can't-break-it"** — behind on creative freedom, ahead on safety/calm |
| Safe client editing / handoff | Wix Studio ("content mode", automated handoff) — closest analog | **C/L** | Client edits are gated, approval-first, and never touch layout; matches Wix's safe-handoff intent |
| Publishing seamlessness | Netlify (one-click, easiest of the hosts) | **L** | Hosts are **git/build/CLI pipelines**; Studio OS hides all of it behind one "Publish" — customer never sees git, builds, or deploy logs |
| Domains / DNS / SSL for non-devs | Netlify/Cloudflare (included, but config-exposed) | **L** | Guided in plain language ("Show this on Google?"), SSL auto, DNS drift repair one click — no raw records required |
| Version history / restore | WordPress revisions / Webflow backups | **C** | Named versions + one-tap restore + preview, in plain language |
| Reporting depth & customization | Salesforce/HubSpot (deep, customizable) | **B** | Studio OS gives *calm plain-English observations*, not customizable dashboards — deliberate for the audience |
| Bulk actions / large-team CRM | Salesforce/HubSpot | **X** | No multi-select/bulk — intentional for a solo/small operator; flagged if scale demands it |
| Enterprise authoring/governance | Adobe Experience Manager | **X** | AEM = $60–80k/yr + implementation teams + 1–2wk author training; Studio OS is the deliberate opposite (zero implementation, no code) |

**Honest positioning:** Studio OS **leads** where it counts for its audience — *invisibility of the technical layer* (publishing, hosting, domains/SSL) and *one connected lifecycle*. It is **competitive** on no-code CRM/CMS ease for a small business. It **trails, by design,** on creative-editing freedom, reporting customization, bulk/team features, and integration breadth — none of which serve "a small-business owner completes normal work without thinking." It is **not** an enterprise DXP and shouldn't be compared to AEM/Salesforce on depth.

## 3. No-code workflow coverage
**Result: no normal workflow requires editing HTML/CSS/JS/JSON, a DB id, or reading an API response.** Every CRM, CMS, and Client-App task has a button/form entry point (evidence in the workflow audit). The publish ritual (change journal → blockers-with-fix → confirm → progress → receipt → retry) is best-in-class for confidence. Genuine gaps:
- **Invoice create/reconcile** lives only in the internal admin panel; no button in the 7 CRM pages, and a client can pay only if Eric manually pasted a Stripe URL per invoice → *cumbersome for Eric + blocks client self-pay* (Stripe-integration + owner-gated → **owner item**, see §15).
- **Task assignment** (to a studio member) — no assignee control (low priority for a solo operator).
- **Bulk actions** — none anywhere (intentional per Scope Guard; revisit only if scale demands).
- **One code-edit for Eric:** `project-survey.html` hard-codes `GOOGLE_REVIEW_URL = "…YOUR_PLACE_ID"` — enabling review requests needs a JS edit. The page correctly hides the prompt until set (no broken client link), but it violates no-code-for-Eric. It's a **one-time studio setup** of Eric's own Google link → flagged; a settings-backed fix is a small follow-on.

## 4. Developer Mode — contract
Well-architected and correctly gated (verified): **off by default** (exclusive to the `developer` site-role), **server-enforced** (`requireDeveloper` on every `/dev/*`), **tenant-scoped** (`site_id`-keyed, deny-all RLS), **reversible** (draft → snapshot → same publish pipeline), **nav-hidden** unless entitled, **noindex**. Exposes only the SAFE presentation layer (allow-listed theme tokens, sanitized CSS, sanitized HTML block); templates/manifest are **read-only**; preview iframe is `sandbox=""`. It does **not** weaken auth/authorization/isolation/publishing-safety/entitlements. **Two real gaps before granting `developer` beyond trusted people:** (1) the promised published-site **CSP is queued, not built** — the HTML sanitizer is currently the only layer; (2) that sanitizer is a **denylist regex** (an allow-list parser is queued). Fixed this pass: corrected the code comment that overstated the defense as "two-layer" (§6).

## 5. Defects found (this pass)
1. **Context loss (bug):** on `today.html`, the hub link cluster hard-coded plain hrefs, so an operator scoped into a client (`?client=`) **lost that scope** on click — breaking the "one connected system" feel. Root cause: the "carry `?client=`" logic is re-implemented in ≥3 places instead of one helper.
2. **Overstated security posture (accuracy):** `devmode.ts` comment claimed a two-layer defense (sanitizer + published-site CSP); the CSP doesn't exist yet.
3. **Terminology drift (CX):** the leads destination is labelled 4 ways (Website enquiries / Your messages / Messages / Open enquiry); "Customers" (nav) vs "client" (body); "Approvals" vs "What needs your approval" adjacent to "What needs you." (Recommendation, §8 — not blindly mass-renamed to avoid contradicting canonical public terms.)
4. **Discoverability:** ~10 secondary pages (the CMS projections + `schedule.html`) aren't in `buildNav` or `⌘K` — reachable only via the `today.html` cluster.

## 6. Fixes implemented (safe, verified, behind the fence)
- **`today.html`** — every hub link now carries the agency `?client=` scope when the operator is scoped in (single inline helper; unscoped users see identical plain links). Fixes the context-loss bug.
- **`devmode.ts`** — corrected the comment to state the sanitizer is currently the only published-site defense layer and that the CSP + allow-list parser are queued and must land before widening the `developer` role. (Honesty/trust.)

## 7. Dispositions (merge/redirect/retain/defer)
- **Retain:** all 28 shell surfaces + 8 CMS pages + marketing/legal/tools.
- **Already-redirected:** `portal-workspace.html` (verified).
- **Recommend merge/redirect (browser-QA):** `leads.html` → fold into Inbox; consolidate the four public "free score" tools (audit/ai-critique/local-visibility/report-card).
- **Recommend improve (deferred, known):** `portal.html` onto the shared shell (portal-retirement / two-app model).
- **Keep gated:** all internal-operator + developer-only pages (obscure URL + noindex + server role gates).

## 8. Customer-experience recommendations (need owner call / browser QA)
- **Standardize destination labels** (proposed canon): the leads page → **"Messages"** everywhere; **"Customers"** for the entity (retire "client" in body copy where it's the same thing); keep **"Approvals"** (approval-center) distinct from **"Attention"** (rename the `today` "What needs you" link to reduce the adjacent near-duplicate). Copy-only but ripples across ~6 files — worth doing as one reviewed sweep.
- **`⌘K` discoverability:** add the ~10 secondary pages as searchable destinations (touches shared `shell.js` → verify in browser).
- **Adopt the shared status kit** (`ddsEmpty`/`ddsSkeleton`/`ddsError`/`ddsToast`) on the ~24 pages that still roll their own loading/empty/error — consistency win, browser-QA sweep.
- **Reduce the `today.html` 10-link wall** — the signal for the deferred **Workspace Home** consolidation.

## 9. Accessibility & mobile
The 8 CMS pages are consistently accessible (lang/h1/loading-status/aria/focus-visible/reduced-motion/colour-independence). Remaining a11y/mobile work is the standing **browser + screen-reader + real-device** pass (can't be verified headlessly) — unchanged from `GOLD-MASTER-READINESS.md`.

## 10. Cross-product cohesion
Backbone is strong (one `buildNav`, one shell, one command palette). Cracks are in the leaf layer: terminology drift (§8), the scope-carry bug (**fixed**), status-kit under-adoption, and the `?client=` helper duplicated ≥3×. Recommend a single shared `withScope()`/link helper to prevent recurrence.

## 11. Files changed
- `today.html` (scope-carry fix), `supabase/functions/presence/lib/devmode.ts` (comment accuracy). No migrations. No new routes/tables/workflows — reuse-only.

## 12. Security & tenant isolation
No new attack surface. Developer Mode gating verified sound (§4). No page exposes code/JSON/IDs/provider-config to non-developers (verified). Client-safe output asserted by per-module tests. The scope-carry fix *strengthens* isolation (an operator no longer silently falls back to their own context mid-navigation). Real security follow-ups: the Developer-Mode published-site CSP + allow-list parser (queued, pre-condition to widening the role).

## 13. Regression
Typecheck clean; **148/148 pure + structural pass** (6 creds-gated live suites skip); platform invariants 14/14. Backend untouched by the two fixes.

## 14. Staging deployment
No backend change to deploy (the two fixes are a frontend link helper + a code comment). All prior routes remain live/auth-gated on staging.

## 15. Remaining owner / human checks
- **Owner:** auto-generate Stripe payment links (so clients self-pay without Eric setting a URL per invoice) + surface invoice-create in the CRM; the `GOOGLE_REVIEW_URL` one-time setup; apply prod migrations; lift the fence.
- **Browser/QA:** the terminology sweep, `⌘K` discoverability, status-kit adoption, `portal.html`→shell, the `today` link-wall reduction, and the standing mobile/AT pass.
- **Security:** Developer-Mode CSP + allow-list parser before granting `developer` to anyone untrusted.

## 16. Honest assessment — where Studio OS leads / matches / trails
- **Leads (defensible, narrow):** invisibility of the publishing/hosting/domain/SSL layer for non-technical users (vs git-based Netlify/Vercel/Cloudflare); one connected lead→site→delivery→publish→bill lifecycle with no integrations; approval-first safe client editing.
- **Matches:** no-code CRM/CMS ease for a small business (HubSpot/Zoho/WordPress.com class) for the *common* workflows.
- **Trails (mostly by design):** creative/visual editing freedom (Wix Studio/Webflow), reporting depth/customization (Salesforce/HubSpot), bulk/team CRM features, integration breadth, native mobile apps. **Not** comparable to AEM/Salesforce on enterprise depth — and shouldn't try to be.
- No claim that Studio OS is "better than Salesforce/HubSpot/Wix." It is **better-fit** for one specific user: a small-business owner (or their agency) who wants normal work done without thinking, and without code.

## 17. Private Beta readiness
Unchanged and affirmed: **engineering-ready for a controlled Private Beta.** This pass found no launch-blocking defect — the two issues found were fixed; the rest are refinements (browser-QA) and automations (owner). The no-code standard is met for normal workflows; Developer Mode is correctly gated (with two queued security items before widening it).
