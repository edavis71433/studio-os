# HTML Deep Audit — every recommendation, gap, opportunity, refinement & optimization

**2026-07-10.** Owner-requested exhaustive comb of all 72 HTML files (~45k lines). Six parallel line-referenced reviews. Findings are code-grounded (file:line). Nothing here is auto-fixed — this is the catalog; fixes are separate, prioritized work.

> **Read order:** §0 Platform-Secrecy & Fence (the owner's hard rule — most urgent) → §1 High correctness/security/broken → then the categorized catalog (a11y, SEO, perf, UX, legal, dead-code/retirement).

---

## §0 — 🔒 PLATFORM SECRECY & PUBLIC-FENCE VIOLATIONS (highest priority)

Per the Platform Secrecy Rule, the public site must never expose the CMS/Studio OS/SaaS/licensing/white-label/platform-pricing. The audit found **the public web root contains full internal app pages and SaaS/pricing/legal content.** These are the top launch blockers.

**A. Whole internal pages sitting in the public web root (reachable by URL; `noindex` ≠ private):**
- 🔴 **`pricing.html` — the entire SaaS subscription pricing page is public.** Title "Pricing — Studio OS Presence" (:6); sells a subscription (monthly/annual toggle :81-87, founders pricing "life of your subscription" :76-78/125, per-plan `$/mo` + "start a trial — no card" :144-152, "Most popular" badge :159); fetches `/commerce/plans` and renders the live tier catalog (:89); CTA → `/signup.html?plan=&term=` (:151); exposes the platform "Laws" (:91-99); "Already have an account? Sign in" (:102). **Also leaks the staging Supabase URL + `?env=staging` switch (:107-114).** → Remove from the public deploy / auth-gate. No `noindex`, no canonical, no OG.
- 🔴 **`agency.html` — internal agency/multi-tenant SaaS console.** "Studio — Studio OS" (:6), "the platform" (:82), client `edition` (:92), portfolio + client-switcher + "acting for a client" + **Starter-kits that copy one client's config into another** (:95-136 = the white-label/reseller capability), "studios managing multiple businesses" (:144). `noindex` present but reachable. → Move behind auth.
- 🔴 **`developer.html` — internal Developer-Mode CMS editor.** "Developer Mode — Studio OS" (:6,88), meta describes a theme/CSS/HTML site-builder (:8), "Presence SDK … deployed with the platform" + internal `/docs/presence/…` link (:172), "no-code workspace" (:208). The clearest white-label-CMS disclosure. `noindex` present but reachable. → Move behind auth.
- 🔴 **`help.html` — full Studio OS help + `/pricing.html` link, NO `noindex`.** "Help — Studio OS" (:6), "How Studio OS works" (:48), "Your plan & billing → See plans & pricing" → /pricing.html (:89-92), "our platform … SOC 2" (:99). → `noindex` + gate.

**B. Public LEGAL pages that expose the SaaS product (also violates the HARD FENCE):**
- 🔴 **`terms.html` §9 (:79-85)** — "Studio OS Presence subscriptions … plans, prices … pricing page", founder-locked prices, billing portal, "60 days after your subscription ends", **"Everything you put into Studio OS is yours. We host and render it"** (reveals CMS/hosting). → Relocate to a login-gated legal page or gate §9 until launch.
- 🔴 **`privacy.html` (:76-77)** — "Studio OS Presence accounts", "your workspace", "your published website … we generate that page for you", AI drafting, 60-day retention. → Same treatment.

**C. Internal utility pages that leak the obscured admin path `dds-studio-manage-9k2p.html`, NO `noindex`:**
- 🔴 `a11y.html` (:6 "DDS OS", :31), `tests.html` (:6, :60-61), `mobile.html` (:6, :35-36 `?debugw=1`). → Add `noindex` + exclude from the public bundle. `styleguide.html` reveals internal product structure (:32,184,201) — `noindex` too.

**D. Soft/borderline platform hints on public pages (reword):**
- `services.html:123` "the same capability behind the systems running this studio" → soften so it can't read as "we license our platform."
- `start.html:92` "Custom platform / web app ($12k+)" → "Custom web app".

**Owner action:** decide per file — pull from public deploy, auth-gate, or reword. `noindex` alone does not satisfy the secrecy rule (the URLs remain publicly fetchable). Recommend a deploy allowlist so only genuine marketing pages ship to the public bucket.

---

## §1 — HIGH correctness / security / broken (functional bugs)

- 🔴 **Stale access-token, systemic.** Every `/presence` page + `shell.js` captures the session token ONCE at boot and reuses it forever; Supabase refreshes the *session* but not the captured copy, so after ~1h every request 401s with no recovery. Files: `shell.js:346`, `crm.html:190`, `leads.html:139`, `inbox.html:99`, `schedule.html:109`, `pipeline.html:199`, `projects.html:254`, `files.html:429`, `connections.html:252`, `visual-studio.html:219`, `today.html:97,237`, `client.html:70,185`, `get-started.html:67,188`. Only `presence.html` (:699,731) and `portal.html gpApi` (:4052-4056) do it right. **Fix:** re-read the token per request (shared helper) or subscribe to `onAuthStateChange`.
- 🔴 **`portal.html` Home CTAs & doors are dead.** `renderHQ` wires every hero CTA/door to `onclick="hqSourceNav('…')"` but `hqSourceNav` (:4618-4630) only *returns* a nav-key string — it never navigates. Clicking does nothing when a `source.kind` is present (:4688,4717,4725,4738,4743,4750). **Fix:** `onclick="nav(hqSourceNav('approval'))"` or a `hqGo()` wrapper.
- 🔴 **`presence.html` duplicate `shell.css`+`shell.js` include** (:11-12 and again :351) → double-init (duplicate top-bar wiring/toasts/hints/listeners). Remove the :351 pair.
- 🟠 **`signup.html` trial UI/submit mismatch.** UI flips to "Start free trial" on the `trial=1` query (:120) but submit only sends `trial:true` if `PLAN.trial_eligible` (:134) — a non-eligible plan says "free trial" yet routes to paid checkout. Gate the UI on `trial_eligible`.
- 🟠 **`connections-callback.html` XSS** — unescaped `label` (from `localStorage`) into `innerHTML` (:42-44,53). Escape it.
- 🟠 **`get-started.html` `saveIndustry()` not awaited** before `/writer/generate` + navigation (:139,143,128) → the drafted site can use the wrong industry vocabulary/schema. Await it.
- 🟠 **`client.html` unread-count logic broken** (:178) — reads `body.unread_count` not `body.data.unread_count`; badge effectively always 0. Also `openProject` throws if the report lacks `progress`/`milestones` (:121).
- 🟠 **`portal.html` visit-stamp written before read** (`writeVisitStamp` in `loadHQ` at :4667 runs before `readVisitStamp` :1713) → "new since last visit" diffs are defeated everywhere except Home. Reorder: read first, write last.
- 🟠 **`portal.html` feedback priority selector inert** — buttons `id="fb-*"` (:1499-1501) but `setPriority` toggles `pri-*` (:3418-3420). No active-state feedback. Align IDs.
- 🟠 **`portal.html` AI suggestions/context read dead globals** (`window.WQ_*` :3855-3866, `window._timelineCache/_approvalsCache/_invoiceCache` :3937-3939) that are never assigned → chips always generic, AI context thin. Point at the real globals (`_progress`,`_deliveries`,`_pendingApprovals`).
- 🟠 **`portal.html` AI + edge calls sent with NO auth header** to `clever-api` (`PortalAI.send/draft` :3904-3907,4021-4024) — unauthenticated client project context. Confirm those routes are safe + rate-limited.
- 🟠 **`clever-api` public dependency (retirement risk).** Public `contact.html:183` and `buy-audit.html:98` (+ `start.html`, `project-survey.html:170`, `client-archive-ui.html:91`) POST to the legacy `clever-api` slated for P2-G retirement. If retired, lead capture + paid-audit checkout + survey notify break. Verify longevity or migrate to `presence`.
- 🟠 **`client-archive-ui.html` renders unstyled** — loads `./dds-system/tokens.css`+`components.css` but that dir doesn't exist (files are at repo root) (:10-11). Fix paths. (Also legacy clever-api; orphan → retire/rewire.)
- 🟠 **Wrong page metadata (copy-paste leak)** — `portal-terms.html` (:168-183), `ai-disclaimer.html` (:83-98), `contact-disclaimer.html` (:72-87) all carry `"Terms of Service"` JSON-LD + OG/Twitter + `og:url …/terms`. Fix each to its own page.
- 🟠 **`project-survey.html` placeholder Google Place ID** (`YOUR_PLACE_ID` :121) → the 4–5★ path sends happy clients to a broken review link. Set the real ID or hide the CTA.
- 🟠 **`contact.html` lead-conversion analytics never fires** — calls `gtag('event','generate_lead')` (:171-173) but the page never loads gtag → the highest-intent conversion is unmeasured. Add GA (consent-gated) or remove the dead call.

---

## §2 — Accessibility (WCAG 2.1 AA)

**Keyboard-inoperable controls (2.1.1 — High):**
- `pricing-estimator.html` + `local-visibility.html` quiz options are `<div onclick>` with no role/tabindex/keydown (estimator :233-372; local-vis :248-371). Convert to `<button>`/radio.
- `portal.html` notification rows + "view all updates" are `<div onclick>` (:1957,4602). Use `<button>` or role/tabindex/keyhandler.

**Modal focus management (High, app-wide):**
- No focus-trap / focus-move-in / focus-restore / Escape on: `presence.html` `.scrim`/`#ritualWrap`:568/`#stage`:634 (also bg not `inert`); `portal.html` revisionModal:1572/svcModal:4837/welcomeOverlay:1144(also missing `role=dialog`)/AI panel:3803; `files.html` detail slide-over:119; `connections.html`/`visual-studio.html` panels. (`pipeline.html`/`projects.html` use native `<dialog>` — correct; use as the model.)

**Invalid semantics:**
- `files.html` nested `<button>` — tile is a button (:288) with the favorite star button injected inside (:287). Undefined AT/keyboard behavior. Restructure.
- `ai-disclaimer.html:132-133` + `contact-disclaimer.html:121-124` — `role="banner"` hero inside/around `<main>` (invalid landmark; h1 outside main). `contact-disclaimer.html:162/169` footer `<h5>` → h1→h5 heading skip.

**Missing labels / names:**
- Form controls with placeholder-only or orphaned labels: `client.html` msg/survey/support (:135,153,160), `get-started.html` service inputs (:118), `crm.html` note textarea (:127), `local-visibility.html` Q6 (:385/386), `presence.html` hours time inputs (:874-876).
- Unnamed controls: `sharing.html` role=switch button (:91), `files.html` panel × (:306,330), toggle/segmented controls without `aria-pressed`: `get-started.html` industry chips (:104), `crm.html` internal/shared (:129), `analytics.html` segments (:20-22), `project-survey.html` stars (:62-68), `leads.html`/`pipeline.html` filter chips (`aria-selected` unset :100).

**No `aria-live` on dynamic results/errors** (screen readers get no announcement): `pricing-estimator` results (:382), `roi-calculator` results (:209), `local-visibility` results (:394), `buy-audit` error (:92), `signup.html` #msg (:65,101), `set-password.html` err/ok boxes (:76-77), `connections.html` concierge answer (:183), `today.html` #main swap, `contact.html` #thanks stays `aria-hidden` on reveal (:80), `welcome.html`/`connections-callback.html` spinners/results.

**Dark-mode / contrast:**
- `today.html` hardcoded light-only colors (healthLine:301, orientationCard:279, planCard:337) → light islands in dark mode; undefined `--faint` (:326) makes achieved/unachieved milestones identical.
- `rgba(255,255,255,.4/.6)` fine-print on dark panels across marketing pages (footer mono, web-design:149, panel-dark lead-muted); `payment-*` `--muted` ~4.3:1.

**Touch targets <44px:** `today.html` buttons (:36), `presence.html` mobile dock (:319), various.

**Missing state exposure / focus not moved into revealed content:** `client.html` project view, `connections-callback.html` result, `nav.js` dropdowns (verify keyboard + `aria-expanded` updates), `shell.js` nav/notif/profile menus (no `aria-expanded`, no Escape, no focus-in :124-255).

**Reduced-motion:** `welcome.html` spinner (:25-26) and `local-visibility.html` JS count-up (:129) don't honor `prefers-reduced-motion`.

---

## §3 — SEO / meta (public pages)

- **Missing OG/Twitter/favicon/manifest/theme-color/analytics** on: index (homepage — worst), services, work, about, how-we-work, the-experience, industries, contact, tools (partial), and all 5 industry pages. Only web-design/seo-strategy/monthly-retainer have the full kit — use as the template.
- **GA loads on only 3/14 marketing pages** → homepage + highest-intent surfaces (contact, industries) unmeasured. Add site-wide behind consent.
- **Missing JSON-LD on the "money" pages** (5 industry pages, industries hub, contact) while lower-value tool pages have it. Add `Service`/`LocalBusiness`/`FAQPage`/`BreadcrumbList` + OG images.
- **Extensionless canonicals** (`/services`, `/restaurant-web-design`, …) while files are `.html` — depends on a server rewrite; **verify** or self-canonical mismatches. `tools.html` og:url (`.html`) ≠ canonical (no ext) (:8,12).
- `twitter:site=@davisdigitalstudio` (18 chars) invalid (max 15). Overlong meta descriptions: index (~168), services (~230), the-experience (~250). `web-design` Service JSON-LD missing `offers`/price. `index` JSON-LD missing image/telephone/hours/geo.
- Industry pages: thin content for competitive keywords; add FAQ (+FAQPage), proof, internal links.

---

## §4 — Performance

- **Render-blocking Google Fonts** on ~8 marketing pages + several app pages (blocking `<link rel=stylesheet>`); 3 pages use the correct `preload`+`onload` swap. Standardize + subset (3 families: Fraunces w/ full optical range, Inter, Geist Mono = heavy).
- `presence.html:8` preconnects googleapis but not gstatic(crossorigin).
- **`shell.js` ⌘K file search** fires `/assets?q=` on every keystroke ≥2 chars, race-guarded but no time-debounce (:182-194) → N requests while typing. Add ~200ms debounce. Bell popover re-fetches `/portal/feed` every open with no cache (:207).
- **`projects.html` `/support` over-fetch** — GETs all support rows then filters client-side by project_id (:243-248). Add server-side `?project_id=`.
- `today.html` `/coach/health` + `/coach/journey` fire sequentially after the parallel batch (:294,312) — fold in. `portal.html updateLastSeen()` writes to `clients` on every `nav()` (:3239) — debounce.
- Duplicated inline reveal script across all marketing pages → shared deferred JS. Portal screenshots are large PNGs (have width/height — no CLS — but consider WebP).
- `presence.html` object-URL leak on upload (:1916 probe URL never revoked).

---

## §5 — UX / consistency / naming

- **Product naming drift (public):** "Solutions" vs "Services" (services title/h1 vs nav/url); retainer called "Growth Partnership"/"Ongoing care"/"ongoing partnership"/`monthly-retainer` (4 names); tools hub "Resources" title, not in primary nav.
- **Brand drift (app):** "Studio OS" vs "Davis Digital Studio" vs "Presence" across signup→set-password→get-started→presence→portal.
- **Duplicate/ambiguous labels:** `index.html` footer two links both "Free tools" (:289-290); nav audit "Free tools"(index:60) vs "Free site review"(others); "See what your site needs" → audit vs tools depending on page. `presence.html`+`sharing.html` two things named "Files" (media tab vs /files.html; sharing :73/74).
- **Dead-end links:** notice href defaults to `/today.html` (`today.html:121`); `inbox.html` non-project notifs link to `/inbox.html` (:61); agency `?client=` scope dropped on notice click.
- **Native `prompt()`/`confirm()` for real workflows** (unstyled, blocking, suppressible): `presence.html` launch/rollback/library (:2433-3025), `files.html`/`visual-studio.html` alt-text prompt (:393/:188), `portal.html`/`schedule.html` delete confirms.
- **Missing busy/disabled feedback:** `leads.html` → Deal double-click (:120), `client.html` Send (:144).
- **Payment pages dead-end SaaS buyers** — link only to marketing/portal, not `welcome.html`/`get-started.html` (:29-30).
- **DRY:** nav/header/footer duplicated across 10+ marketing files (no include mechanism, though `nav.js` loads everywhere) → templatize.
- **`start.html` off-brand fonts** (DM Sans/DM Serif) vs the Fraunces/Inter/Geist system; `project-survey.html` too (DM fonts — styleguide says removed).
- Cookie-consent inconsistency (tool pages have it; contact/industry pages don't but should if GA added).

---

## §6 — Legal completeness (owner/counsel)

- `terms.html`: California ARL (auto-renewal) compliance for §9 subscriptions; missing severability/entire-agreement/venue/arbitration/indemnification/DMCA; bump "Last reviewed" when §9 shipped.
- `privacy.html`: no CCPA/CPRA formal section, no GDPR lawful-basis/international-transfer, no retention **periods**, no cookie table, no postal address; policy describes GA/cookies the page itself doesn't run — reconcile.
- `accessibility.html`: only 3 sentences — not ADA-defensible. Add conformance target (WCAG 2.1 AA), statement date, feedback mechanism + response commitment, known limitations, AT/browsers tested, alternate-format offer.
- Harmonize effective/review dates across terms/privacy/portal-terms/disclaimers (currently Jun-25 vs Jul-5 mix).

---

## §7 — Dead code / orphans / retirement candidates

- **Orphan pages (linked from nowhere):** `contact-disclaimer.html` (also wrong metadata), `help.html`, `a11y.html`, `tests.html`, `mobile.html`, `styleguide.html`, `client-archive-ui.html` (also broken CSS + legacy API), `email-signature.html`. Decide: link, gate/`noindex`, or retire.
- **`portal.html` dead code:** `loadProjectSpine`/`mirrorSpineToProjectTab` (:4504-4506, non-existent DOM), `renderPostLaunch`/`renderStatusChip` (:1866/1789), `escAttr`/`notifyEric`(hardcoded Formspree)/`billRow`, the `if(false)` block (:2199), and the two parallel design systems (`.hq-*` vs `.lg-*/.jn-*/.cv-*`). Trim.
- **Dead CSS:** `.appnav` block in `connections.html`+`visual-studio.html` (:23-27, no such element).
- `portal-workspace.html` — clean JS redirect; prefer a server `301` (`_redirects`) and delete the file.
- `email-signature.html` — flexbox in email `<table>` (stripped by clients), raw `&` (:27).
- `404.html` — add `noindex`; dead `.reveal` observer JS (:93).

---

## §8 — Internal admin mega-tool (`dds-studio-manage-9k2p.html`, 19,195 lines) + audit tools

**The 19k-line console is the biggest single body of debt.** It's ~27 self-contained module IIFEs, each redefining micro-helpers that have DRIFTED into real bugs.

**Whole-file (High):**
- **Helper drift → latent XSS + `$NaN`:** `esc()` ×25, `att()` ×17, `money()` ×8, `safe()` ×19 copies. Several `esc()` copies escape only `<` (`:11112,11517,16818,16854,17106,18667,18714`) and feed `onclick="fn('"+esc(id)+"')"` (`:11201,11534`) — attribute/handler breakout. Several `money()` lack `Number(n)||0` → `$NaN`. **Fix: hoist ONE `esc/escAttr/att/safe/agoS/money` set; delete the per-module copies** (removes hundreds of lines + closes the escape gaps at once).
- **`innerHTML` ×392, inline `onclick=` ×619** — hot paths interpolate raw values (business_name/url/email at `:2994-2997,3399,3464-3466,3502-3503`, etc.); the inline-handler count also blocks a strict CSP.
- **Broken feature — `genReply` (`:9452-9463`) ships no `Authorization`/`x-dds-user-jwt`** → "Draft a reply with AI" 401s. Extract ONE `callEdge(type,payload)` (endpoint hand-rolled ~35×, all `clever-api`).
- **No `window.onerror`/`unhandledrejection`** anywhere; many `.then()` chains without `.catch` fail silently.
- **Per-keystroke full re-renders + fetch storms (High perf):** RHX health warm-up fires **40 `ddsHealth` calls per keystroke** (`:13429-13436`, also no `.catch` → a reject freezes the repaint); undebounced search rebuilding the page on `hubSearch/prSearch/fileSearch/oppxSearch/benchSearch/rhxQ/ivxSearch/fsxQ/msxQ/apxQ/tsxQ2/rpxQ/tpxQ/cxQ`; `renderProspects` sort calls `JSON.parse` inside the comparator (`:8102,8122`) → thousands of parses/keystroke.
- **Five search inputs lose focus every keystroke** (input is inside the re-rendered `innerHTML`): `apxQ:15587`, `tsxQ2:16077`, `rpxQ:17359`, `tpxQ:17892`, `cxQ:18160`.
- **Dead modules shipping:** Opportunities render cluster (`:5008-5720`, ~90 lines, never called), duplicate Approvals module (`:15400-15528` shadowed by `:15539`), duplicate taxonomies (`STAGES`/`LEAD_STAGES`).
- **Stuck-disabled buttons (early return before re-enable):** `msgSummarize:6203`, `qaBuild:6660`, `saveAndShareQuote:6697`, `discoverProspects:8533`. Use try/finally.
- **"Success on failure":** `sendMsg`/`ddsSendPortal` clear the textarea + toast success even when the write failed (`:6651,4787`) → destroys unsent text.
- **Data bugs:** kanban drop PATCHes wrong table for `os_` leads (`:2790`); quote-line `Date.now()` id collisions (`:7747`); `qbxShare` reads `sv.w` not `sv.why` → empty descriptions (`:13173`); Tasks page POSTs new rows as a *load* side-effect (`:15913-15922`, double-nav double-creates); timeline pulls global payments not the client's (`:14404`); Focus-Mode counts bypass the canonical outstanding predicate (`:18765`).
- **A11y (High, pervasive):** clickable `<div>/<span>/<tr>` rows/chips/tabs everywhere (no role/tabindex/keyboard); modals/panels (`ps-modal`, composer, GP modals, slide-overs) with no dialog role / focus-trap / Escape / restore; kanban drag-only; low-contrast muted text; charts no text alt.
- **A11y/UX:** native `prompt()/confirm()` (blocked in in-app browsers → silent no-op) across `saveTemplate/startSubscription/resetClientPassword/tpxNew/cxTask/tmxRemove`; weak temp passwords (`'dds-'+Math.random()` `:10248`) shown to the operator.

**audit.html (public lead-gen — keep indexable):** `deepCall` unabortable + `Promise.allSettled` with no `.catch` → the loading orb can hang forever (`:824-947`); FAQ accordion keyboard-inoperable (`:1543`); loading/results not announced/focus-moved; **un-escaped `d.url/d.name/d.city/d.email` into the operator email HTML** (`:1494-1519`); no double-submit guard (`:441`); FCP threshold compares seconds vs ms → always green (`:1235`); duplicate operator + user emails.

**admin-growth.html:** "Try again" is dead on detail errors (`route()` early-returns when `STATE.detail` set, `:575,1097`); no `res.ok` guard → 500 crashes the view (`:350`); date off-by-one in US TZ (`:525,945`); Health "add" edits the latest row instead of creating (`:894,1015`); nav is non-interactive `<div>`s; `modal()` no dialog semantics/focus.

**ai-critique.html (public):** email-me reports success on failure (`:844`); ~160 lines dead CSS (`:47-211`); hero subheading white-on-near-white invisible (`:317`); legacy clever-api (`:664`).

**report-card.html (public):** business type collected but never sent (`:784`); silent report failure looks like success (`:784`); form is a `<div>` (no Enter-submit) yet has form submit listeners (`:831`); newsletter subscribe discards the email (`:803`); infinite rAF cursor loop (`:822`); GA with no consent gate.

**admin-health.html:** `createClient` at top level outside try/catch → CDN failure spins forever (`:47`); no refresh affordance/"as of" timestamp; correctly uses `/functions/v1/presence` (the others use clever-api).

**Cross-file themes:** (1) endpoint split — console + marketing tools call legacy `clever-api` (85 refs), admin-health uses `presence`; (2) "success on failure" recurs; (3) missing focus management on every view transition + modal; (4) clickable `<div>` instead of `<button>` is the single most pervasive a11y defect; (5) GA consent inconsistency; (6) one shared `escapeHtml` + `callEdge` + version-pinning would remove the most duplication and close most latent XSS.

---

---

## RESOLUTION LOG (fixes applied 2026-07-10)

Committed in 8 reviewable waves (app pages are local, under the fence).

- **Wave 1 — secrecy + high correctness:** `noindex` on 12 internal/app pages (fetchable, not searchable); presence duplicate `shell.js`; signup trial bait-and-switch; connections-callback XSS; get-started await; client unread + null-guard; portal dead Home CTAs + feedback-ID + visit-stamp order; 3 legal pages' wrong metadata; client-archive-ui CSS paths; project-survey placeholder Place ID.
- **Wave 2 — systemic stale-token:** `onAuthStateChange` across `shell.js` + 12 app pages (sessions no longer die after ~1h).
- **Wave 3 — announce dynamic regions:** `role=alert`/`aria-live` on signup, set-password, and the 4 public calculators' result/error regions.
- **Wave 4 — dark-mode + dead CSS:** today.html `--faint` + hardcoded colors; removed dead `.appnav` CSS (connections, visual-studio).
- **Wave 5 — success-on-failure + data:** ai-critique email only confirms on real success; report-card sends businessType + records newsletter; files.html download `noopener`.
- **Wave 6 — audit.html:** hang-safety (deepCall signal + allSettled `.catch`); double-submit guard; FAQ keyboard-operable; FCP threshold (s→ms); email-HTML XSS escaping.
- **Wave 7 — public calculators:** pricing-estimator + local-visibility options keyboard-operable; local-visibility Q6 labels.
- **Wave 8 — admin-growth:** `res.ok` guard; dead "Try again"; date off-by-one (local-noon anchor).
- **Wave 9 — SEO/social meta:** OG + Twitter + favicon/manifest/theme-color added to the 13 marketing pages that lacked them (homepage had none); `Service` JSON-LD added to the 5 industry money-pages.
- **Wave 10 — admin console surgical High bugs:** `genReply` missing auth headers (broken AI-reply feature); `sendMsg` success-on-failure (destroyed unsent text); 4 stuck-disabled buttons (`msgSummarize`/`qaBuild`/`saveAndShareQuote`/`discoverProspects`) → try/finally re-enable.

**Remaining (catalogued above, not yet applied):** the bigger/riskier long tail — the 19k console's *structural* refactor (one shared `esc`/`att`/`callEdge`, killing the per-keystroke full re-render + fetch storms, removing the dead Opportunities/Approvals modules) needs a staging environment to verify; modal focus-traps + the clickable-`<div>→<button>` sweep across portal/files/console; §6 legal completeness (owner/counsel); the remaining §7 dead-code/retirement + P2-G legacy work. All safe to do incrementally.

## Cross-cutting strengths worth preserving
Consistent `esc()`-before-`innerHTML` across app pages (no injection found in presence/portal); per-invoice Stripe links (no shared link); optimistic-message reconcile (portal); the RLS verification harness; native `<dialog>` in pipeline/projects; reduced-motion + dark-mode handled throughout the app; `withScope` UUID-guarded `?client=`; open-redirect whitelist in `set-password.html`.
