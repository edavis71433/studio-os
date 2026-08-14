# Open punch-list — things raised in conversation (living doc)

Purpose: we keep losing items to context compaction. This is the durable list of
what Eric asked for that is **outstanding or needs Eric**. Updated 2026-07-15.
Legend: ⏳ open · ✅ done this stretch · 🔑 needs Eric (key/secret) · 🚀 needs Eric's `git push` · ❓ needs Eric to clarify.

---

## Needs Eric (do these "all at once")

- ✅ **Stock photos** — DONE 2026-07-14. `PEXELS_API_KEY` set on prod + redeployed (the
  key was in an image Eric pasted, which a text search of the transcript missed). Turns
  on Files → Stock Library + the builder's "Stock photos" picker tab.
- ✅ **Migration `0106`** — Eric applied it. Security Advisor errors closed. (44 warnings
  + 84 suggestions remain — lower priority, mostly function search_path / advisory.)
- ✅ **`git push`** — Eric pushed; the builder/studio frontend is live.
- ✅ **Visual Studio (AI-generated images)** — DONE 2026-07-14. `VISUAL_MODEL_KEY` (an
  OpenAI key, `sk-proj-…`) set on prod + redeployed. Defaults to OpenAI images
  (`gpt-image-1`); if that model needs org verification, switch `VISUAL_MODEL_NAME` to
  `dall-e-3`. All owner keys now in.
- ✅ **Messages** — DONE 2026-07-15. Salesforce-style record thread shipped (messages live
  on the client record) + #181 inbox client grouping shipped. Pending function deploy to
  go live.

## Code — for me to do (Eric will batch-review)

- ✅ **Analytics / Google Search Console connection** — DONE. Reworded the agency card to
  operator framing ("connect it for them — it's your setup, not theirs") and made it a
  working action: links straight to that client's scoped connections
  (`/connections.html?client=<siteId>`) when one client needs it. Deployed.
- ✅ **AEM component parity — Table, Title, Link List, Spotlight** — DONE. All four built
  (backend + builder editor) and deployed; drop them from "Add section". (Existing set
  already had carousel/image/text/accordion/buttons/columns/etc.)
- ✅ **Convert flow** — VERIFIED, no bug. All 3 convert options already land the customer
  in the client portal (`client.html`); the CRM only keeps *your* operator view.
- ✅ **"Add a section shows nothing"** — root-caused + fixed: added blocks are now seeded
  with editable placeholder content so a content section renders the instant you add it;
  media blocks open their editor to pick a file. Deployed + in presence.html (push).
- ✅ **#184 Drop a component into a column** — DONE. A column cell can now hold any
  component (text OR media: video, image, gallery, feature list, stats, table, …) via an
  "Or drop a component here" picker per column, each with a mini-editor. Backend +
  editor, deployed. (1-column was already supported.) Containers can't nest (no infinite
  recursion). NOTE: media already worked standalone (Image/Video/Gallery/Carousel
  components + per-cell image) — this just adds nesting.
- ✅ **More visual templates/themes** (#183) — DONE 2026-07-15. Now **8 template families**
  registered (restaurant-classic, business-classic, editorial, aurora, slate, meadow,
  atelier, harbor — `lib/render.ts` LOADERS). Starter *layouts* remain at 13.

## Done this stretch (verify after push)

- ✅ Builder: real drag-and-drop, "+ Add one section" actually adds, repeat any section,
  remove any built-in section incl. the hero, blank canvas + delete template/page.
- ✅ Editable GLOBAL menu (nav) with dropdowns + page links (migration `0105` applied,
  backend deployed).
- ✅ 13 starter layouts, generic ones at top.
- ✅ Visual Studio added to the builder left rail.
- ✅ Sidebar folded into Design (Today · Design · Photos · Visual Studio · Bookings ·
  Reviews · History).
- ✅ `/studio` no longer silently bounces a no-workspace account to the client portal —
  honest panel + explicit portal link. (Cause of Eric's bounce: signed into /studio with
  a personal/owner-less account; sign in with the **dds owner** account.)
- ✅ AI writing helper in text components; image component uses uploaded photos.

## Backlog tasks already tracked (not conversation-lost — see task list)

#180 Files→Design fold ✅ (both increments) · #181 inbox client grouping ✅ (pending
function deploy) · #174 admin consolidation + freelancer/agency provisioning ✅ (agency
provisioner + invites + door; page retirements can follow) · #166 compliance/doc-truth
✅ docs half (LEGAL HALF NEEDS ERIC: terms/privacy platform-subscription sections +
OpenAI/Pexels in the privacy provider list — drafts on request) · #169 optimization
pass ✅ (migration 0109 + waterfall collapse + context dedupe + vendored supabase-js) ·
#172 final verification ✅ Tier 1 all green 2026-07-15 (see FINAL-VERIFICATION-RUNBOOK.md;
Tier 2 needs staging creds, Tier 3 owner items listed there) ·
#167 seamlessness redesign — STILL GATED, see the standing rule below; Eric declares
the gate clear, not a session.

## 🎨 ADOBE PARITY DECISIONS FROM ERIC (2026-07-15 — do not lose to compaction)

Scope: SMB/mid-market value only, not enterprise (his words: "just the things that
add value for a small/mid business"). Spec: ADOBE-PARITY-ATLAS.md (29 gaps, 3 waves).
The four philosophy decisions, made explicitly by Eric with tradeoffs presented:
1. Per-breakpoint controls → CURATED TOGGLES (hide-on-phone/desktop per section + safe presets).
2. Freeform canvas → **BUILD IT** — Eric chose to add a true drag-anywhere layout mode,
   overriding the founding "structured list, never x/y" law. Build with guardrails
   (snapping, containment, mobile auto-stacking). Large/architectural — design doc first.
3. Template-author tier → SAVE-AS-STARTER-LAYOUT (operator saves a page's arrangement
   as a reusable starter layout; no locked-template role).
4. Per-element style overrides → **ALLOW THEM** — Eric chose full per-element styling,
   overriding contrast-by-construction; ship with contrast warnings, not blocks.
Also standing: the builder (presence.html) joins the workspace brand system (increment 6),
now Adobe-informed: side panel (blocks/files/content-tree tabs), editor modes incl.
Annotate + Timewarp candidates, Page Information menu. Workflows: route-for-review UX
on top of the existing approvals + launches machinery.

**Delivery status 2026-07-16 (deploys #8–#11, all green):** G11 section comments
end-to-end (migration 0112 applied prod+staging) · G18 zoom+captions · G27 overrides
end-to-end (backend + "Style this section" popover; second design-doc decisions:
3 aspect presets · 12 elements/4 canvases caps · brand shades + Custom… hex ·
Apply-Brand clears colors only) · G25 freeform backend slice 1 (editor slice pending;
freeform = a section TYPE, templates/columns stay — Eric confirmed) · G5/G6/G7/G9/G10
publish-pipeline upgrades. ✅ Increment 6 builder redesign COMPLETE 2026-07-16 —
all four slices approved by Eric and merged to main (A 15f91d2 theme contract ·
B 736fab7 Page ▾ menu · C 3cac4a3 three-tab panel + tree drag · D 3f2303d modes
bar Edit/Preview/Comments/Timewarp). NOW: the CRM + client portal Salesforce
redesign (directive below). Then: G13 in-place editing → freeform editor →
G12+G34 → S-finishers → G33/G14/G35.

## 🎯 CRM REDESIGN DIRECTIVE (Eric, 2026-07-16 — do not lose to compaction)

**"Be very aggressive on the redesign. Especially the messages. I wanted to look
just like salesforce."** Scope EXPANDED (Eric, same day): **the CRM AND the client
portal, redesigned together as one combined Salesforce-style effort** ("do both
simultaneously if you can"). Order is explicit: **"finish the redesign of the
Adobe part and then we can move onto the CRM and the client portal. One thing at
a time."** → increment 6 slices C+D complete FIRST, then CRM+portal, then the
Adobe Wave 2 features. Method: deep Salesforce Lightning UI research (running —
real docs/screenshots/SLDS component anatomy; no guessing, per his messaging
rule), then an aggressive combined spec with his decision points, then slices
with before/after screenshots for approval. Eric offered more links/references
on request. The Jul-14/15 Salesforce-parity work (one-thread-per-client record,
activity model, highlights panel, global search, AR view, deal to-dos 0107/0108)
is the FLOOR, not the target — Salesforce-grade look and organization end to
end, on both sides of the product.

**SPEC APPROVED by Eric 2026-07-16 ("looks good continue")** —
docs/design/crm-portal-salesforce-redesign.md, with the recommended defaults
on all five decisions: **D1 YES** inbound email via Resend Inbound (slice 6;
needs Eric's ~15-min Resend dashboard step when it ships) · **D2** Lightning
anatomy in dds brand (not literal SLDS palette) · **D3** list views v1 =
columns + sort + filter chips + fixed views (saved views/bulk later) ·
**D4** timeline stays a read-time merge under one new route (`GET
/crm/activity`), no persisted activity table yet · **D5** portal Messages
mobile = stacked split-view panes. Delivery: 7 slices (record page → studio
inbox split view → rosters/pipeline → portal shell → portal messages →
inbound email → nav context bar), each with adversarial review + before/after
screenshots → Eric approves → merge.

**Slice 1 SHIPPED 2026-07-16** — Client Record as a Lightning record page +
GET /crm/activity (3e37023, approved by Eric "Continue"; merged to main;
deploy #13 = functions + frontend). 28 review findings fixed + authorization
pass clean; e2e 167/0. NOW: slice 2 — studio Inbox split view +
presence_thread_reads. **Migration 0113 APPLIED by Eric 2026-07-16 ("sql
done")**. **Slice 2 SHIPPED 2026-07-16** — Inbox split view + real per-thread
unread (cd0cc0f; pre-approved "Approved" + "this is grreat approved"; 21
review findings fixed; e2e 204/0; deploy #14 green — functions + frontend
live; 0113 already applied so unread dots are real from day one). NOW:
**Slice 3 SHIPPED 2026-07-17** — rosters as list views + pipeline Path/
Board⇄Table/record header (362e00f; approved "go ahead"; 20 review findings
fixed; e2e 258/0; frontend-only → Netlify). **Slice 4 SHIPPED 2026-07-17** —
client portal context bar + Home queue + project record pages (8b13a60;
approved "approved continue"; 22 review findings fixed incl. the
message-attribution fix via events detail.from; e2e 285/0; frontend-only →
Netlify). **Slice 5 SHIPPED 2026-07-17** — portal Messages split view
(033f082; approved "Approved"; 24 findings → 13 fixes incl. three additive
backend upgrades: real support-reply attribution via `from`, support
last_activity_at recency, own-send notifications excluded; e2e 321/0;
deploy #15 green — functions + frontend). **Slice 6 SHIPPED 2026-07-17** —
inbound email capture, POST /email/inbound (290f04e; approved "do it";
rebuilt TWICE after container resets wiped uncommitted work — now committed
per-checkpoint; 37 findings fixed across two adversarial reviews incl. a
critical forged-Authentication-Results bypass; behavior change: studio
support replies now email email-native clients; e2e 321/0; deploy #16).
🔑 **NEEDS ERIC to activate**: (1) APPLY-0114-prod.sql — Eric's 2026-07-17
run hit ERROR 25001 (the Supabase SQL Editor wraps every run in a
transaction, which rejects CONCURRENTLY); the pack was REWRITTEN (a37ad4f)
as one plain idempotent run — paste the whole current file once, then the
verify select should return both index names; (2) Resend dashboard per
docs/presence/INBOUND-EMAIL-SETUP.md (inbound domain MX + route → webhook,
DKIM/SPF so Resend stamps a verdict, secrets RESEND_INBOUND_SECRET +
RESEND_INBOUND_DOMAIN). Dormant + fail-closed until then.
**Slice 7 SHIPPED 2026-07-17** — studio shell context bar: waffle App
Launcher replacing the burger (same #dds-drawer sheet on mobile, 3-col
popover on desktop), flat nav items with click-invoked caret dropdowns,
Customers caret = Recent records (localStorage, written by ⌘K + crm.html
opens) + quick actions, active underline with /crm.html→Customers fallback,
leads.html list-view header (a455222 + review fixes 9926614/bfd82f2;
pre-approved "ho ahead"/"go"; 26 findings across 3 reviewers → fixed incl.
recents×scope-carry wrong-tenant rewrite, javascript:/protocol-relative href
guards, recents cleared on sign-out, layer mutual exclusion, honest
aria-current, focus-out closure, forced-colors waffle glyph, leads soft
refresh; e2e 348/0; frontend+docs only → Netlify).
**Slice 8 BUILT + VERIFIED 2026-07-17 — SHIPPED 2026-07-18 (approved via
question dialog "Merge + deploy now"; merged 280b4bc; deploy #17 SUCCESS —
functions + frontend live)** —
Business dashboard (approved from mockups "Build it!" + "I think this is all
great" for the website band): analytics.html = Lightning dashboard (Sales +
Your website bands, As-of/Refresh, Period chip; agency portfolio branch
preserved incl. print) + GET /analytics/dashboard; portal "Your website"
card on client.html Home (plain-English sentence, in-place full picture,
privacy line VERIFIED true) + GET /client/website-stats. Zero schema change;
Service chip honestly omitted (deals carry no service field). Branch commits
1fc2eb8→450c940; 3-reviewer combined review = 27 findings (0 security),
all fixed: truncation honesty (ordered reads + flags + "based on recent
activity"), exact calendar boundaries, GSC stale-period "· in <Month>"
qualifier + unavailable≠not-connected, stale-response guard +
commit-on-success period chip, has_data honored (no fake zeros), portal
sentence honesty (events ≠ people). Gates: e2e 410/0, pure sweep 203/0,
deno check clean. SURVIVED container reset #4 (fix agent killed by model
credits mid-batch; audit agent confirmed/completed all 19 directives).
On approval: fast-forward main + deploy.yml (functions + frontend).
**Slice 9 APPROVED + BUILDING (Eric: "Build it as mocked", 2026-07-18)** —
studio projects.html roster → list view + project record page (highlights
panel, milestones-as-Path, two-column body); build agent running; usual
pipeline (review → gates → screenshots → Eric approves merge).
**HOTFIX SHIPPED 2026-07-18** — Documents of Record (proposals/agreements/
invoices) rendered as raw source: Supabase rewrites GET text/html→text/plain
on the shared *.supabase.co functions domain BY DESIGN (custom-domain-only
feature). Fix: doc.html viewer on OUR origin fetches + renders the function's
HTML; all three minting sites now emit `${SITE_URL}/doc.html?t=<token>`
(docViewerUrl in routes/sales.ts). ad813d3 → main, deploy #18 SUCCESS.
Old already-emailed direct links keep degraded behavior until re-sent.
**Slice 10 SHIPPED 2026-07-19** — Today both sides as Lightning Home
(studio: Needs-you action feed + This-month card from /analytics/dashboard +
tz-honest schedule + recents + waiting-on-clients; portal: greeting + honest
at-a-glance strip + action feed). 33a64e9/d793804 build + b783be1/84a22da
fixes (19 findings, 61-agent 3-vote review: per-row timezone "today",
dormant-vs-hiccup schedule split, glance tiles hide on failed reads,
needs-OK count unified with cards, messages tile counts real messages only,
real h2/h3 headings, empty-rail collapse). Approved "Merge and build";
main e055eef→84a22da; frontend-only → Netlify.
**Slice 11 APPROVED + BUILDING (Eric 2026-07-19 "Merge and build"; mock
s11-mock.html)** — Requests tab: quick-action tiles, service-catalog card
grid, requests list view; all existing flows preserved; frontend-only.
**Slice 12 APPROVED (Eric 2026-07-19 "Merge and build"; mock s12-mock.html)**
— Files tab redesign + "Share a file with your studio" surfacing the
EXISTING handleClientUploadUrl/handleClientUploadCreate machinery
(frontend-only; per-project uploads land as client_visible deliverables
with a client_upload event). Builds AFTER slice 11 (same file). PR #1 now tracks the redesign branch
(https://github.com/edavis71433/studio-os/pull/1).
**Slice 9 SHIPPED 2026-07-19** — studio Projects: roster → sortable list
view (Project/Customer/Status/Progress/Target/Open approvals, chips kept,
cards on mobile) + project record page (breadcrumb, highlights incl. Client
actions + CSAT when present, milestones-as-Path with mark-complete,
two-column body; every old capability verified preserved). 890ccae/585b6e2
build + 81cc940/e055eef review fixes (14 directives incl. the .sec CSS
bleed that boxed the shell nav, focus-preserving async re-renders, honest
sort order, real mutation round-trip tests, .lhead anti-drift pin).
Approved "Merge it"; main ad813d3→e055eef; frontend+tests only → Netlify.
PR #1 tracks the branch.
**Slice 10 APPROVED (Eric 2026-07-18: "we need to redo the 'today' tab" —
"for both"; mockups sent same day, approved "those mock ups are great")** —
studio today.html → Lightning Home (Needs-you action feed with per-row CTAs,
This-month performance card fed by GET /analytics/dashboard, Today's
schedule, Recent records from the slice-7 localStorage recents, Waiting on
clients, calm quiet-state); portal client.html Home → greeting +
at-a-glance strip (needs OK · messages · due · project status) + Needs-you
as the same action feed; website card/projects/updates KEPT. Zero new
backend. Builds right after slice 9 lands (one slice in the pipeline at a
time); usual review → gates → screenshots → Eric approves merge.

## ✅ SALESFORCE REDESIGN COMPLETE (2026-07-19)

**All 12 slices + the doc-viewer hotfix SHIPPED.** Final merge: slices 11
(Requests tab — 88b9e35/52f0526) + 12 (Files tab + client→studio sharing —
c486204/4690f7c/1bb197f incl. server-side upload post-verification) approved
"Merge it", main 84a22da→1bb197f, deploy #19 (functions + frontend — slice 12
touched client_delivery.ts). Suite grew 155→744 tests across the effort; every
slice: build → adversarial review (findings 3-vote/mutation-verified in later
slices) → fixes → full gates → Eric-approved merge. Survived 6+ container
resets on durable-commit discipline. PR #1 tracks the branch.

**NEXT (standing plan): Adobe Wave 2** — G13 in-place editing → freeform
editor → G12+G34 → S-finishers → G33/G14/G35.
**Still needs Eric**: 0114 SQL re-run (the fixed single-run pack) + Resend
dashboard setup (inbound email dormant until then) · legal drafts on request ·
Tier-2/3 verification (staging creds, owner items).

## 🔧 POST-AUDIT DIRECTIVE (Eric 2026-07-19: "Start with the big stuff and
then move down to the little stuff"; batch E "later")

Full audit: docs/design/POST-REDESIGN-AUDIT.md (six auditors, batches A-F).
ORDER: F big-ticket first — G13 in-place editing (Wave-2 queue head, with
server-stamped section keys replacing the three client mirrors) → freeform
EDITOR slice (G25 backend live but unreachable) → route-for-review bridge →
outbound email compose → remaining F items as Eric prioritizes. Batch A
(12 bugs/regressions, all S) runs as an immediate PARALLEL sweep — bugs
don't wait a week behind features. Then descend D → C → B; E (design-system
foundations) LAST as its own approved effort. Every batch: usual pipeline
(build → adversarial review → gates → screenshots → Eric approves merge).
## 🎨 G13 DECISIONS (Eric 2026-07-19): ship text-blocks first (slice 3 adds
hero/core); canonical section ids ACCEPTED — "but don't forget about ssl
certs and all that" → SSL provisioning/renewal is a HARD REQUIREMENT of the
DNS slices (post-delegation cert re-trigger + status + renewal watch + DS
pre-check). G13 slice 1 (server stamping) building.

## ✅ MIGRATION 0114 APPLIED (Eric, 2026-07-20, verified)

Eric ran docs/presence/APPLY-0114-prod.sql in the prod SQL Editor; the verify
select returned BOTH index names (screenshot confirmed). Inbound-email
idempotency (external_id columns + partial unique dedup indexes on
presence_support_messages/requests) is in place. The inbound-email receive
side now waits ONLY on Eric's Resend dashboard setup.

## 🏢 STUDIO-WIDE STANDARDS DIRECTIVE (Eric 2026-07-20 — do not lose to compaction)

Eric, after seeing the un-redesigned studio Files page (live site confirmed
CURRENT at main@ec4e46c — "looks the same" was correct, the page was never in
the 12 slices): **"yes i want the whole studio to those standards."** Scope:
EVERY studio tab to the redesign standard (roster .lhead + search/filter/sort
list views, record anatomy, split consoles, honest failure/empty states,
VIEW_SEQ, dds tokens). Not-yet-treated pages: files, broadcasts, schedule,
connections, sharing, website-health, snapshot-history, content-tree, timeline,
upcoming, business-insights, attention, approval-center, admin-health, agency —
plus delta gaps on the redone pages (audit batches C + D fold into this sweep).
Method: recon → docs/design/STUDIO-STANDARDS-SWEEP.md slice plan → Eric approves
order → slices through the usual pipeline. Sequenced after the G13 divergence
fix (built, in adversarial review + full e2e as of this entry).

**"And the portal" (Eric, same directive):** the client portal is IN SCOPE too —
every portal tab to the same standard. Slices 4/5/8b/10/11/12 treated Home,
Messages, website card, Today, Requests, Files; the sweep recons ALL portal
surfaces (incl. the untouched Invoices + Help tabs, the project drill-in,
booking flow, reviewer persona experience) and folds in audit batch B (B1-B6)
verbatim. One combined slice plan covers studio + portal.

## 🌐 MARKETING SITE — TRIAGE LIVE + OVERHAUL PLANNED (2026-07-26)

Eric (after using the site): "redo the architecture… so many clicks… my pricing
disappeared… the tools pages look like a whole different site."
SHIPPED to main (Netlify): (1) /pricing REBUILT as services pricing (was
orphaned SaaS-product pricing; real numbers only — $1,500 web design, $400/mo
Growth Partnership; nav/footer/services/sitemap/_redirects wired; SaaS content
preserved in git @82d63ba). (2) HOTFIX: pricing-estimator's false "$850/mo
retainer REQUIRED" → published "$400/mo optional Growth Partnership" (8ff1233);
ai-critique white-on-white hero fixed (8c0ca3e).
ERIC APPROVED THE FULL OVERHAUL (2026-07-26 "go ahead and do the full
overhall") with delegated decisions — DEFAULTS CHOSEN (recorded, reversible,
every slice shown to Eric pre-merge): P1 MERGE the-experience→how-we-work
(301). P2 PUBLISHED-NUMBERS-ONLY — /pricing is the price truth; estimator/
audit tier amounts stay as live today; positioning changes flagged at merge,
never invented. P3 Results → FOOTER-DEMOTE until real work publishes (Bacchus
flips it back). P4 SITEWIDE LIGHT (contact's lone dark skin removed; full dark
mode remains a future option). Build order per plan: MS1 nav/IA (one shared
nav, all pages) → MS2 money-path + MS3 tools-rebrand (parallel) → MS4
narrative merge → MS5 industries → MS6 entry/legal. MS1 also creates
tests/e2e/marketing.spec.ts (none exists).
PLAN: docs/design/MARKETING-SITE-OVERHAUL.md (recon: 41 pages, 5 auditors) —
click-depth maps (today's maze vs 6-slot flat nav), page verdicts, slices
MS1-MS…, ONE shared nav definition. ERIC DECISIONS P1-P4: merge the-experience
into how-we-work? · the price architecture (audit tiers $99-$899? package
catalog $3,800/$6,500?) · Results page (publish Bacchus vs footer-demote) ·
dark mode (contact-only today). Estimator "Package" catalog framing has no
published counterpart — part of the price-architecture decision.

### MS1 LIVE · MS2+MS3 BUILT (in combined review) — 2026-07-26

**MS1 MERGED to main @7eaa111 (Netlify):** ONE canonical chrome across 29 pages
via scripts/marketing-chrome.template.html + sync-marketing-chrome.mjs (--check
wired into build-public.sh as a tripwire; byte-identity pinned in
tests/e2e/marketing.spec.ts; only per-page variance = stamped aria-current).
Review fix: dark-OS contact form was 1.18:1 after P4's dark-skin removal —
contact.css restates dark surfaces behind prefers-color-scheme (P4a full strip
stays an Eric decision).

**MS2 BUILT (4884001…a4ac068):** six money pages, one price story — 7
contradictions resolved from published sources only (P2). pricing (audits-from-
$99 cross-quote + SEO answer), services (ghost buttons died), web-design
(~$1,500 + 4–6wk), seo-strategy (honest no-separate-SEO-price), monthly-
retainer (~$400/mo starts-around), audit (tier sentence). +21 red-first pins.
FLAGGED for Eric: /monthly-retainer→/growth-partnership rename (P5);
standalone SEO price if he wants one.

**MS3 BUILT (bde582a…dd93cbd) + GAP CLOSED (fa26ef3):** all EIGHT tools-family
pages rebuilt onto the index system (NEW tool-page.css; tools.css; purple
template dead: :root forks, pills, gradients, 19 emoji→stroked SVG, exit
popups, custom cursor, idle timers, CTA gauntlets→one closer, Calendly deep-
links→/contact). buy-audit got the slim payment chrome. local-visibility (the
page outside MS3's fence) rebuilt same pattern — quiz math + lead capture
preserved verbatim, 12 red→57/0 green. NEW tests/e2e/marketing-tools.spec.ts.
FLAGGED: estimator "Package" catalog framing + 25% rush (P2 decision),
ROI retire-into-estimator, concierge.js untouched (not in kill list), MS7 owes
email-signature removal from the public build.
✅ MERGED TO MAIN @4ad5a5a (Eric "Merge it", 2026-07-27; Netlify auto-deploy).
Quality trail: 19-agent combined review (6 dimensions + adversarial verify) →
22 findings (12 CONFIRMED, 10 PLAUSIBLE, 0 refuted; function-preservation
CLEAN) → all fixed in 5 commits (7f9ecce price truth · 22848ad _headers
/pricing no-cache + _redirects /snapshot-history glued-200 fix + well-
formedness pins · 489b066 test-gate strengthening, evasions proven closed by
mutation · 6a4db43 dark-OS contrast, all pairs measured AA+, the contact.css
class fixed family-wide + pinned · 4ad5a5a wizard focus mgmt + consent banner
joins the system). Gates: marketing suites 115/0 ×3 projects, sync --check 29/
29, pure 208/0/4, app tripwire 15/15. Shared-file blast radius: analytics.js
4 lines (banner visuals only), styles.css +3 (dark counterparts).
**MS4 BUILT (3f9e7e9) + reviewed:** the-experience retired into how-we-work
(P1) — beats 02/03/05 + Rosa's Bakery pmock moved verbatim, retitle "How it
works", not-a-step 04 deleted, launch renumbered; page+css deleted, 301 pair
for /the-experience(.html), sync manifest now 28 pages, 7 inbound links
rewritten (+ work.html "isn't a mockup" honesty fix per doc §2). Review:
CLEAN (3 notes, all addressed/recorded): false pmock-dark css comment fixed;
DEFERRED from doc MS4 §2-3 → fold into MS5/MS6: about.html near-duplicate
4-card workspace grid trim + "Not credentials" framing fix; coverage note:
the no-references pin scans root-level files only (fine today — repo-wide
grep clean). Gates: 119/0 ×3 projects, sync 28/28, pure 208/0/4.
## 📄 DELETE DRAFTS + AN AGREEMENT PER PACKAGE (Eric, 2026-08-07) — AWAITING SQL + DEPLOY

Two asks off the Bacchus deal: "theres no where for me to delete those"
(two duplicate $3,200 proposal drafts) and "this needs to be included in the
agreement for my growth package" (his Bacchus scope-of-work PDF).
ERIC'S DECISIONS: delete = UNSENT DRAFTS ONLY · one template PER PACKAGE ·
scope lives INSIDE the agreement (one document, one signature) · Growth
scope = standard skeleton + fill-in blanks.

DELETE (1a0f04a): there was NO delete route for proposals or contracts at
all — every mistaken draft was permanent. Now DELETE /sales/proposals/:id +
/contracts/:id, soft (deleted_at), status guard server-side and
authoritative (signed → 409 always; the guard also rides the PATCH WHERE so
a send landing mid-flight loses the race), audit event on the deal history.
⚠️ NEEDS MIGRATION 0117 — presence_deal_events.kind has a CHECK and
dealEvent() is best-effort, so PRE-0117 a delete SUCCEEDS WITH NO AUDIT
TRACE. Apply 0117 BEFORE the function deploy.

PACKAGES (65b4e07): DDS_AGREEMENT_LEGAL (§1-19, 14,964 chars) is now ONE
shared const spliced into every package — verified byte-identical at
RUNTIME across packages AND byte-identical to the pre-split template, so
the words a client signs did not change. Packages: growth (cover + the
Bacchus scope generalized, 25,563 chars) and custom_photo (byte-for-byte
carry-over, fixture-snapshotted). A <select> chooser, no inference (guessing
would put the wrong scope in front of a client); SEEDED tracking protects
typed work. unfilledBlanks() warns at send on BOTH paths, deliberately
ignoring the honest degradations ([project fee]) and [Client Name / Title].
THE GROWTH SCOPE: Eric's PDF was unreadable by the usual tools (subset fonts
+ 1-byte codes); extracted by decoding per-font ToUnicode CMaps. It was
BACCHUS-SPECIFIC despite "that's the standard package" — Tock, wine club,
catering, venue rental, 8-page sitemap, Pasadena keywords. Generalized to 25
marked [BLANKS]; §10 "About search results" kept verbatim (the best
paragraph in it). ⚠️ TEMPLATE BUILD PACKAGE OWED — Eric has published the
tier but given no scope; a commented extension point + a test that fails if
someone invents one.

REVIEW: NO BLOCKERS (6 mutations, every status value driven, every
client-reaching send path driven incl. 3 the suite missed). 3 LOW, 2 fixed
in 4448679: (F1) every PATCH failure was reported as "already sent" —
infra failure now says "couldn't remove it just now, nothing changed";
(F2) the blanks guard stood aside silently when the deal read omitted body
(new page + stale function window) — now it ASKS. (F3) is the 0117 deploy
ordering above. Reviewer also noted the contracts read has no LIMIT
(pre-existing shape; ~50KB/agreement) — cheap insurance if deals ever carry
many agreements.
Gates: pure 215/0/4, e2e pipeline+crm 76/0 on desktop+tablet+mobile.

## 🧾 CRM DEAL PAGE — FOUR FIXES BUILT (Eric, 2026-08-07) — AWAITING DEPLOY

Eric's four asks off the Bacchus deal screenshot. Recon → build → review →
fixes. Commits 09a0281 / b44e4d1 / 7b9370b / ee027bb, R-fixes 21828c7 /
4e64896 / 16b0d35.

1. CONTACT EDITING (the real bug) — `presence_deals.contact_id` was set ONLY
   at create; `handleSalesDeal` PATCH never accepted it, so a deal created
   without an email could NEVER gain one, and `emailSalesDoc` silently
   returned false. Now: contact_id patchable (tenant-guarded, 422 on
   foreign), Contact block at the TOP of Details (create-or-update), honest
   toasts naming the cause + the fix. Convert-to-customer starts working for
   previously-contactless deals as a side effect.
   NOTE for Eric: the signing link was ALREADY copied to his clipboard on
   send — he was never fully blocked, just never told.
2. TO-DO DROPDOWN — optional `todos` on StageGuidance, all six stages;
   select fills a still-editable input; POST unchanged.
3. SERVICES — the dropdown ALREADY existed on proposal line items; it was
   invisible because the catalog was empty. Now seeds 6 real published
   services (prices verified against pricing.html / pricing-estimator.html /
   audit.html — audit tiers use the PUBLISHED names Digital Health Check /
   Competitive Intelligence, not the "Full/Deep" shorthand) pre-filled but
   UNSAVED; "Manage services" surfaced in the toolbar.
4. CONTRACT — Eric's new 2026-07 agreement is the default. His source had
   TWO §16s and §9's heading glued into §8; both fixed in the .docx sent
   back to him (he approved: "yes please fix the numbering"). Template is
   the 19 sections VERBATIM, SAMPLE disclaimer stripped, Word cover table
   re-flowed to plain text with placeholders that autofill from the deal
   (his ask: "autofilled when i enter in their info from the lead").

QUALITY TRAIL — review found 2 BLOCKERS, both fixed:
(F1) the template hardcoded "Davis Digital Studio" in the LETTERHEAD, the
     OPERATIVE PARTIES CLAUSE and the SIGNATURE BLOCK while only the cover
     page used {{studio_name}} — a non-DDS tenant would send a contract
     naming the wrong counterparty. The code it replaced (starterAgreement)
     got this right. Now all four speak one identity; signature renders the
     BUSINESS line only (presence_identity has no owner/person column — an
     honest blank printed-name line beats naming the wrong person).
     ⚠️ ERIC: his name no longer appears in the signature block. If he wants
     "Eric Davis" printed there it needs a new identity field.
(F2) the client/server placeholder hand-mirror was pinned only TEXTUALLY —
     the reviewer broke the deposit-split math and all 271 tests passed.
     Now the pure suite EXECUTES the client mirror and demands output
     equality over 13 cases; both mutations re-run and now fail loudly.
Plus: F3 autofocus stole keystrokes into the wrong field (real input bug),
F4 the new with_body=contract read could have returned the contact-fields
sentinel JSON into the agreement textarea, F5 retry-duplicate contacts,
F6 silent contact substitution, F7 {{today}} local-vs-UTC on the EFFECTIVE
DATE, F8 dead starterAgreement deleted.
Gates: pure 213/0/4, e2e pipeline+crm 64/0 on desktop+tablet+mobile,
repeat-each=10 on the flaky one → 10/10, deno check clean.
NO MIGRATION. Needs merge + FUNCTION DEPLOY (sales.ts + 2 lib files).
Pre-existing, not ours: broadcasts.spec.ts:172 fails on main too (verified
in a clean worktree at b168a9f).

## ✅ "NEEDS YOU" TEARDOWN — BUILT, AWAITING DEPLOY (2026-08-07)

Eric: "also should be able to resolve these some way." RECON FOUND THE REAL
DEFECT: of ~30 notice kinds only 5 had teardown, ALL infrastructure recovery.
Every business obligation cleared NEVER. Resolving a support request did not
clear "Waiting on you" (and the period was once-ever, so it could never
re-raise — a permanent tombstone). Paying an invoice ADDED "Paid" while
"Still unpaid" stayed, both forever. "Reminder sent" was status, not an ask.
So the fix is TEARDOWN FIRST, button second — a dismiss button alone would
have taught him to sweep real work out of sight.
ERIC'S DECISIONS: "Waiting on you" clears on RESOLVE/CLOSE only (not reply)
+ weekly re-nudge · "Reminder sent" stops rendering entirely.

BUILT (70713f6): Tier A — support_aging clears on resolve/close (weekly
bucket `support:<id>:w<floor(now/7d)>`, cleared by prefix); stripe webhook
dismisses invremind: on payment; doc reminders raised pre-dismissed (the
codebase's own booking_reminder pattern); remind:/deal: cleared on sign,
accept, convert, delete; the four client_* kinds raised row-silent;
invoice_paid gets "Got it" not "Take care of it". Tier B — a "Done" button
reusing POST /commerce/notices/dismiss, sibling <button> not nested in the
row's <a>, synthetic rows excluded, MONEY AND LEGAL REFUSED at BOTH the feed
(dismissible flag) and the route.

REVIEW FOUND A BLOCKER I INTRODUCED (23cb7e3 fixes all): (F1) I protected
payment_trouble + account_lapsed — which have NO teardown anywhere — making
them PERMANENTLY unclearable, strictly worse than before (and stranding
agency/portfolio.ts's billing_issue flag + attention_center's count). Fixed
by removing them AND adding a biconditional guard test: a kind is protected
IF AND ONLY IF something can clear it. (F2) the invremind clear ran LAST in
the webhook's best-effort try, so an earlier throw stranded the row and
Stripe's retry short-circuits on already-paid — now runs first, outside that
try, AND on the already-paid path so a retry heals it. (F3) presence.html's
plan card swallowed the 409 and removed the card anyway — now honest.
(F4) row-silent had silently killed WEB PUSH for the four client_* kinds —
push decoupled from row visibility (`push?: boolean`). (F5) filterSafe on
the like-prefix. (F6) legacy support:<id> rows also cleared. (F7) the money
guard now fails closed on a missing period.
Mutation testing found 2 survivors in my own F2 fix; both re-pinned.
Gates: pure 217/0/4, e2e 175/4 desktop + 77/3 mobile+tablet, 26 mutations
all caught. NO MIGRATION. Needs merge + FUNCTION DEPLOY (touches
stripe-webhook + several routes).
REPORTED, NOT FIXED: there is NO void path for invoices (pipeline.html
renders a "Voided" state nothing can produce) — an invoice raised in error
can only be cleared by paying it. And deletion_requested cannot be re-raised
after a cancel (period:'once' + a surviving dismissed row) — pre-existing,
now load-bearing because the kind IS protected.

## 🔕 "NEEDS YOU" ITEMS CAN'T BE RESOLVED (Eric, 2026-08-07) — QUEUED

"also should be able to resolve these some way." The Today/attention "NEEDS
YOU" list gives every row ONE action — "Take care of it →" (a navigation) —
and no way to dismiss, snooze, or mark handled. His screenshot shows 9+
rows including stale test data ("test 2", "hey", "test") he cannot clear,
plus real ones (Hettie's FTP-screenshots request, an unpaid $400 deposit,
proposal/agreement reminders). A list that only grows is a list he stops
reading.
RELATED — the SAME defect class the operator-notification review caught
(F1): per-event notices had NO teardown where booking/review/deal_signed
all have explicit clearNotice calls. That was fixed by EXCLUDING client_*
kinds from the badge count; this ask is the other half — an actual resolve
action on the row itself. Do them as one piece of work: a resolve/dismiss
affordance + whatever teardown each row type needs (support request →
close/reply, invoice → mark paid or dismiss the nudge, proposal/agreement
reminder → dismiss, stale test rows → delete).
Investigate too: WHY the "open a few days without a reply" rows persist —
if replying doesn't clear them, that's a bug, not a missing button.
SEQUENCED: after the CRM deal-page four; alongside or before Files-by-client.

## 🔍 THE DEEP DIVE + FIX WAVES — LIVE (deploys #36-40, 2026-08-07)

Eric: "do a deep dive... gaps, opportunities, refinements... be thorough."
Three parallel audits (operator journey / client experience / code health),
then five build waves. Also from his screenshots: receivables void buttons,
the external-site CTA dead end, and his real contract content.

AUDIT HEADLINES (full reports in the three audit transcripts):
- Operator: the price was retyped 4x (proposal→contract→deposit→rollup);
  signed deals got a FACTUALLY WRONG nudge then went silent forever; retainer
  payment failures were invisible; the questionnaire the contracts reference
  DID NOT EXIST; handover has no ceremony; discovery calls bypass the CRM
  (Calendly); deposit-paid didn't prompt convert.
- Client: welcome email said "welcome to Studio OS" (platform-name leak at the
  exact trust moment); paying produced SILENCE (receipt promised on the
  success page, never sent); site-live never announced; enquiry ack was dead
  code; support replies never emailed portal clients; client bar read 0% the
  day after signing+paying.
- Code health: site_down could fire ONCE PER SITE EVER (period tombstone —
  the class from deletion_requested, surviving in 3 more places);
  the e2e harness CANNOT REJECT any request (method-blind prefix fixtures,
  200-everything catch-all) — the machine behind every green-while-broken
  incident; migrations 0116-0123 queue order-sensitively with only text pins.

SHIPPED (each wave gated + merged + deployed separately):
#36 3216a24 receivables rows carry Send/Copy/Void (shared wireInvoiceActions).
#37 2778a56 external clients reachable: record-their-domain door for existing
  clients (edition NOT flipped — provision re-syncs it from plan, M11 blocks
  authoring, heartbeat drops it: verdict DO NOT FLIP, address is orthogonal);
  dialog values deduped (one silently mapped to the HOSTED plan server-side);
  scoped-operator monitor read fixed (asUser null → "Connect" over a VERIFIED
  row; one tap would merge-duplicate a fresh token over it).
#38 3f98ef7 money chain: accept backfills expected_value_cents (guard rides
  the PATCH WHERE); contract send auto-mints the 50% deposit through ONE
  depositSplit helper (doc and invoice cannot disagree; at-most-once-ever,
  void never overruled); signed deals get convert guidance (agreementSigned
  helper exported for the sweep); impliedTermMonths prefill (⚠ FINDING: the
  templates state NO operative term — the audit's 12-month premise was the
  §10 liability lookback); enquiry text lands on the deal.
  ⚠ ADJACENT: the `created` deal event WAS NEVER WRITTEN (source_submission_id
  posted as a nonexistent column, 400 swallowed by dealEvent's catch).
#39 4b158ff never-silent: outage-day periods + prefix clears (site_down,
  connection_expired, deal/lead followups) + INVARIANT TEST walking every
  raiseNotice call site (cleared kind must bucket its period — closes the
  class); raiseNoticeDetailed created|exists|failed; webhook floor unless
  notice||already (hollow-200 fixed); clientEvent retry+warn (was the Inbox
  feed's source of truth, fire-and-forgotten); retainer dunning INSIDE
  applyRetainerSync (past_due/canceled → notice+email, weekly buckets);
  deal to-do/next-step sweep riding deal_nudges; client RECEIPT email;
  convert-aware paid copy; 400-day dismissed-notice retention.
  ⚠ NEEDS ERIC: 0127 (retainer_status + deal_task_due kinds) — dormant until.
#40(Netlify) 1ac1e8c agreements: Growth completed from the Bacchus PDF
  (GBP access, single approver, content-14-days, PIECEMEAL FEEDBACK rule,
  out-of-scope absorption); custom_photography (direction-NOT-shoot kept
  crisp in 4 places) + template_build (SEO only as bracketed optional; $800
  decision still open) — every clause traces to Bacchus PDF / docx / site,
  unsourceable = bracketed. Legal terms: zero drift vs his docx (dup §16
  resolved, signature tokenized). Signed docs byte-frozen by content_hash.
  Blanks 26/24/23 pinned.
#40 2a759e5 client-lifecycle emails, studio-voiced: welcome ("Your client
  portal is ready — <studio>", never the platform name), site-live via BOTH
  publish doors send-once on the checklist tick's fresh signal, enquiry ack
  wired into lead_intake (Formspree fallback sends none → thanks panel
  stops promising it), support replies now reach auth-uid portal clients
  via emailCustomerByClient + the 15-min throttle.
  ⚠ CALENDLY STAYS (deliberate): no agency-site id exists client-side, and
  booking-enabled state couldn't be verified from the sandbox; half-switching
  risked losing bookings. Path: hardcode the id once booking is confirmed on.

DECISIONS WAITING ON ERIC:
1. Template build: site says ONE revision round; legal §3 grants TWO per
   deliverable. Reconcile.
2. No agreement states a term — want a 12-month term clause so renewal
   reminders can arm?
3. The $800 SEO add-on (estimator) — still open.
4. PRICING ON THE SITE — Eric: "i think i need to take the pricing off my site";
   after weighing it ("Leave it for now", 2026-08-07). Options laid out were:
   strip numbers keep page / remove entirely (+redirects) / RAISE the anchors
   (site says "starts around $1,500" while Bacchus closed at $3,200 — the
   anchor may be low, not wrong). Revisit deliberately, not tonight. NOTE the
   page's whole voice is "An honest number, not a guessing game" — removing
   pricing is a REPOSITIONING, not a deletion; template_build's agreement scope
   was sourced from this page's card, so a rewrite should re-check that scope.
4. SQL: 0120 (or press "Add all standard steps"), 0127.

QUEUED NEXT (specced, not built): questionnaire-as-survey (auto-offer at
convert, submission = evidence, auto-tick step 3) + ONE progress number
(client sees the 10-step bar, his 3 highlighted) + per-step to-do affordances
in the portal (content→share card, review→approvals) + handover ceremony
(10/10 → CSAT + review ask + retainer offer); e2e harness that can say NO
(route manifest, 418 catch-all); migration replay harness; tenant-form
visitor ack (same class as the enquiry ack, tenant surface); monthly care
report; GBP (accounts→locations→reviews + picker) + GA4 runReport adapters;
contact merge RPC; per-proposal declined period; deal-task-done teardown;
NOTICE_HREF entries for the two new kinds.

MULTI-AGENT OPS: 10 builds + 3 audits across the day on ONE shared checkout.
After the morning's cross-staging incidents: explicit-path commits only,
pull-rebase before push, checkout-index to gate a tree mid-flight — zero
further incidents, zero lost bytes.

## 🖼️ THE AFTERNOON BATCH — LIVE (deploys #34-35, 2026-08-07)

Eric's second round from the roster screens: contacts uneditable (+ a live
Claud/Claude duplicate), no task dropdown, pages half-width, analytics
platform-only, Hettie's previews broken.

SHIPPED:
1. CONTACTS EDIT/DELETE. Delete is a dry-run first: DELETE w/o ?confirm=1
   writes NOTHING, answers 409 with the attachment inventory ("1 deal, 1
   signed agreement, 1 paid invoice, 1 project"). Soft-delete, one row, no
   cascade; failed counts report as UNKNOWN never zero. FKs are all
   on-delete-set-null (deals 0074, appointments 0099, reviews 0101).
   ⚠ pipeline.html:982 would have blanked a deleted contact's name off his
   own WON deals — fixed w/ include_deleted=1 (labelling only).
   notes column deliberately NOT on the form — it doubles as the
   CONNECT_INTENT_TAG machine marker. MERGE deliberately not built:
   needs a plpgsql RPC (atomicity across 3 tables) that NO test in this
   repo can exercise; ~45 SQL + 35 route + 40 UI when wanted.
   Duplicate hints via existing findPossibleDuplicates (?dupes=1, opt-in).
2. CHECKLIST PICKER. Checkbox list of the ten (disabled-with-reason when
   present), "Add all N standard steps" nudge when a project has none —
   reconciles evidence via reconcileChecklistFacts, so Bacchus = ONE PRESS
   → 20% (not 30: site_live can't tick a draft). 0123 adds the unique
   index standalone (0120 unrun); POST /tasks now 422s a checklist: source
   — one door. ⚠ picker catalog ships as data.checklist; a pure test fails
   if any of the ten titles is ever pasted into projects.html.
3. WIDTH TIERS. 17 ad-hoc caps → four named tokens in shell.css:61:
   form 640 / focus 760 / app 1280 / data 1600. 19 pages retiered
   (client.html untouched — customer-facing). Roster action column:
   width:1% + sticky right ≥768px w/ opaque fill; email cells
   overflow-wrap:anywhere. ⚠ FOUND: contacts/customers/agency had a
   PRE-EXISTING 91px horizontal body scroll at 390px — a .sr-only label
   in an absolutely-positioned span with no positioned ancestor escaping
   .tscroll's clip; .tscroll{position:relative} fixes all three.
   tests/e2e/responsive.spec.ts pins scrollWidth<=clientWidth for all 19
   pages × 3 viewports.
4. EXTERNAL CLIENTS (the "analytics is platform-only" complaint). NO new
   storage: presence_sites.edition='monitor' (0031!) + monitor_connections
   already held the domain — analytics/gsc_sync just never read them.
   searchReadinessState (compose.ts) now: hasData→measuring; external
   w/o domain→"Where is their website?"; hosted draft→publish nudge
   (9d955c6 preserved); connected→waiting. Visitor numbers for external
   sites are null-with-reason (beacon can't exist there), never 0.
   GBP NOT flipped: adapter queries the ACCOUNTS list but normalizes
   review fields that live on a LOCATION — needs accounts→locations→
   reviews + a location picker. GA same class. Both specced follow-ups.
5. HETTIE'S PREVIEWS. NOT the morning Files commits (predates them).
   Two signing bugs breaking EVERY transformed image everywhere:
   format:'webp' (storage accepts only 'origin' — omitting IS the webp
   ask; confirmed against the vendored SDK type) and expiresIn in the
   query string (sign endpoint 400s; previewUrlMap + room.ts signed
   NOTHING — the room grid rendered blank and nobody noticed). Untouched
   surfaces (signDownload, portal) were fine, which is why files worked
   while previews didn't. Now: original-image fallback, then "Preview
   unavailable — the file itself is fine. Use Download to open it."
   ⚠ residual: handleAssetCards swallows inlineCardImages failure →
   silently blank exported card. Follow-up.
   ⚠ portal uploads pass no width/height → no crop_rect, no "W×H" line.
   Follow-up.

MULTI-AGENT OPS LESSON (twice today): agents sharing one checkout swept
each other's staged files into wrong-attribution commits (802d11c carries
the contacts work; 01df36b carries the checklist wiring restore). Nothing
lost, verified both times — but stage by explicit path, never -A, and
verify route wiring at HEAD before merging.

Gates at merge: pure 226/0/4, chrome 28, shell 5, e2e 224 desktop + 77
mobile on touched surfaces; full 3-project sweep 2171 passed / 7 known.
OPEN FOR ERIC: run 0120 OR press "Add all standard steps" on Bacchus;
publish the three sites; business name/email; the two GSC secrets
(CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID/_SECRET — values likely
copyable from the old GOOGLE_CLIENT_ID/_SECRET) + Google Cloud checks.

## 💸 THE SILENT STUDIO — BUILT, NEEDS 0120 + DEPLOY (2026-08-07)

Eric, from his phone: no email when Claud Beltran signed OR paid his deposit;
Bacchus project stuck at "0% · 0/0 tasks"; "connect search console just takes
me in a circle"; business dashboard empty; then Projects + Pipeline + Contacts
ALL empty; messages unfilterable outside a profile.

FIVE ROOT CAUSES, none of them what the symptom suggested:

1. THE EMAILS NEVER EXISTED. Not misconfigured — absent. handleSalesContractSign
   (sales.ts:1354) emailed only the SIGNER; stripe-webhook had grep -c sendEmail
   = 0. Meanwhile lifecycle.ts happily emailed "your proposal went quiet 3 days
   ago". The nagging worked; the good news didn't. FIXED: raiseDealReady now
   RETURNS the raiseNotice created-flag (it was discarding it at :1179, so there
   was nothing to gate send-once on); webhook forwards to a new secret-gated
   POST /commerce/invoice-paid carrying invoice_id ONLY (re-read server-side, so
   a leaked secret can't forge an amount) — chosen over inlining Resend because
   the route gets brand + push + studioRecipient + checklist tick for free.
   Degrades to today's behaviour if the function isn't deployed yet.
2. THE BLANK BUSINESS EMAIL WAS LOAD-BEARING. lifecycle.ts:403,437,489,581,616
   all did `if (owner)` with NO fallback and NO log against a column that
   defaults to '' — so lead-followup, deal-followup, support-aging, renewal and
   agreement-renewal were ALL silently dying for Eric right now. All five now go
   through emailOperator → studioRecipient's 3-rung chain, and warn on nobody.
3. PROJECTS COULDN'T MOVE OFF 0%. ensureProjectForDeal made an empty shell.
   FIXED: Eric's 10 steps (his choice), source='checklist:<key>' so each is one
   addressable row — no schema change. Progress is COMPUTED (presence_projects
   has no progress column; the one at baseline:1524 is the legacy table).
   Auto-tick: agreement_signed, deposit_paid, site_live. Idempotent via one
   WHERE (source=eq + status=neq.done), so a re-fired webhook matches 0 rows.
   ⚠ site_live needed BOTH doors — publish.ts:183 AND deploy_reconcile.ts:52 —
   a slow deploy would silently have cost 10%. Seed is EVIDENCE-aware not
   event-driven, because the real order is sign → pay → convert: both facts are
   already true before a project exists.
4. THE SEARCH CONSOLE "CIRCLE" WAS THREE BUGS STACKED. (a) providers.ts had ALL
   21 providers status:'planned', and connections.html:132 renders "coming soon"
   instead of a Connect button for anything not read_only — so NO provider had a
   button, for anyone, despite AN-3.1 shipping the real GSC read. (b) the card's
   CTA pointed at /agency.html, which has ZERO connect affordances. (c) the
   callback dropped the client scope, so operator-connects-for-client could
   never complete — the bug that would have looked identical the moment secrets
   were set. All fixed. Only GSC flipped live; the other 20 each have a recorded
   defect (Tag Manager publishes ACCOUNT count as "tags installed"; GA4 points
   at the bare API base; HubSpot reads results.length from limit=1 = always 1;
   Stripe/Square read a `total` their responses lack; Apple's OAuth endpoints
   are invented). Half would print a confidently wrong number.
   ⚠ WORST FIND: /system/health derived connected_platform from GOOGLE_CLIENT_ID
   /_SECRET — names NO code reads (auth.ts uses CONNECTED_<KEY>_CLIENT_ID). Wrong
   in BOTH directions, and PHASE-J-OWNER-ACTIVATION.md told the owner to verify
   activation with that flag. Following the checklist could not have worked.
5. THE SCOPE WAS STICKY AND INVISIBLE. carryScopeGlobally (shell.js:817) rewrites
   every APP_PAGES anchor to carry ?client=, so one drill-in silently scoped
   Projects/Pipeline/Contacts/Analytics — all studio-level — to a client site
   where that data cannot live. Empty states then LIED ("No projects yet · Create
   a project") while Bacchus sat won+converted. FIXED: window.ddsStudioLevel()
   on all three, exit link carries data-noscope (or carryScopeGlobally re-scopes
   the escape hatch straight back), scope read from URL not CTX (the page's own
   fetch beats the context fetch).
   ⚠ AND IT WAS A DATA TRAP, not just bad copy: POST /projects and /sales/deals
   write site_id = caller's site, so creating from a scoped page FILED THE RECORD
   ON THE CLIENT'S SITE where nothing else can see it. Create actions now hidden
   while scoped.
   Truth table recorded: studio-level = projects/pipeline/contacts; mixed =
   analytics/leads/inbox; per-client = the other 17.

ALSO: scoped Business dashboard now does REAL per-client sales (converted_client_id
UNIQUE 0074 + customer_client_id indexed 0086:37 — both populated for Bacchus),
not the cheap suppression. "Won this month" names wins OUTSIDE the window
("most recent win Jul 22 ($4,800)") because $0 read identically for three
different truths. Inbox gains client + project lenses (URL-round-tripping,
filtered-empty names every narrowing) — support rows previously carried only a
project NAME so they couldn't join their own project's lens; +1 field fixes it.
#181's grouping and 0115's client link both preserved; a test asserts no lens
can surface a row absent from the unfiltered list.

WHY IT ALL REACHED HIM — THE TESTS ASSERTED UNREACHABLE HAPPY PATHS:
analytics.spec.ts:282 navigated to ?client= but served the UNSCOPED rich fixture
and asserted $12,400 — green while the real scoped board could only ever return
zeros. analytics_dashboard_test.mjs:121 fixtures stage:'won' which the sign path
never produces. operator_notify_test.mjs scopes itself to the 4 portal actions,
so signing/payment were outside its charter by construction.

⚠ NEEDS ERIC: run 0120_project_checklist_backfill.sql (tested twice against a
scratch PG16: Bacchus → 10 tasks, 3 done, 30%; a project with existing tasks
untouched; a soft-deleted checklist NOT resurrected). Then function deploy.
⚠ SEARCH CONSOLE ACTIVATION (Supabase → Edge Functions → Secrets):
CONNECTION_ENC_KEY (44-char base64), CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID,
_SECRET, SITE_URL. Google Cloud: enable the API, consent screen with
webmasters.readonly, register ${SITE_URL}/connections-callback.html.
Do NOT set GOOGLE_CLIENT_ID/_SECRET/STATE_SIGNING_SECRET for this.
REALISTIC: ~6-10 weeks to a trustworthy number. Sensitive scope = Google review
(days-weeks); sites must be PUBLISHED; Google needs days-weeks to crawl; gsc.ts
queries the PREVIOUS FULL CALENDAR MONTH. Publishing is the long pole, not OAuth.
OPEN CALL FOR ERIC: the client can currently tick "Send your content and photos"
(matches existing template-task behaviour) which moves Eric's bar. Offer to make
the 3 client-facing steps visible-but-not-tickable.
DEFERRED w/ reasons: stage==='converted' dead branch (spans 2 files w/ a binding
comment); UTC month boundaries (needs an operator-timezone source of truth that
doesn't exist yet); APP_PAGES narrowing (trades a teachable message for a silent
scope drop).
Gates: pure 224/0/4, chrome 28, shell 5, e2e desktop 768/1 (known
broadcasts.spec.ts:172), mobile+tablet 95/0.

## 📱 MOBILE MENU DEAD ON REAL iOS — FIXED, AWAITING DEPLOY (2026-08-07)

Eric, from his phone: "I was looking at studio in Mobile view and none of the
buttons on the menu work" + a screenshot showing the drawer OPEN with every
item rendered, then: "The menu closes, but leaves you on the same page."

ROOT CAUSE (shell.js:754, since 9926614 — ~3 WEEKS LIVE): panels that close
on `focusout` treated a NULL relatedTarget as "focus left the document".
iOS Safari does NOT focus a link on tap — it blurs the current element, so
focusout fires with relatedTarget null, closeDrawer() runs, shell.css's
display:none un-renders the panel BETWEEN pointerdown AND click, and the
anchor is gone before its navigation resolves. Captured trace showed the tap
then FALLS THROUGH to page content underneath — so a menu tap could silently
activate an unrelated control. Desktop fine (a click focuses the anchor).

SIX SITES, same wrong premise: shell.js:754 (drawer), shell.js:343 (.dds-nav
.sec — breaks iPad, that nav shows ≥761px and iPads have touch),
analytics.html:449 (period filter — reproduced failing), pipeline.html:1194
(worse — it REMOVES the node), projects.html:688, nav.js:73.
⚠️ CORRECTION TO MY FIRST READ: I told Eric nav.js broke the marketing site
for customers. WRONG — that submenu's visibility is CSS :hover/:focus-within
(styles.css:69), so taps worked; the bug was an ARIA LIE (announcing
aria-expanded=false over an open menu). An a11y defect, not broken nav.
Fix shape everywhere: `if (!to) return;` before the containment check. The
forfeited case (focus leaving the document) leaves a panel open behind a
switched tab — invisible and harmless.

ALSO FIXED: the drawer's LAST ROW was unreachable — #dds-mbar (z 2147483000)
covers .dds-drawer (2147482999). Eric's real nav is longer than the fixture's
so this hid a genuine destination. Drawer now insets above the bar
(72px + env(safe-area-inset-bottom)) inside the ≤760.98px block; the bar
keeps the higher z-index so Menu can still close what it opened.

WHY IT REACHED HIM — THE REAL LESSON: `grep -rn "\.tap(" tests/e2e/` returned
ZERO across all 30 specs. Nothing ever exercised touch; the mobile projects
set a phone viewport but drive clicks. And no test ever ACTIVATED a drawer
item (shell.spec.ts:159 only read an href). Even .tap() wouldn't catch it —
Chromium focuses links on tap; only WebKit's semantics break it, and the
sandbox has no WebKit. So tests/e2e/helpers/ios-focus.ts now emulates the
observable half (capture-phase pointerdown → blur activeElement, text inputs
excluded), and 8 touch specs assert items NAVIGATE. RED before (7 failed),
green after.
FOUND WHILE FIXING: pipeline.spec.ts:563 was PINNING the forfeited branch
(its menu is the last focusable element, so a forward Tab genuinely yields a
null relatedTarget) — re-pointed at a real Tab-out and a second test now
records the trade-off explicitly. Whole-tree grep confirms no other handler
shares the premise (client.html has none; presence.html's four blur
listeners never read relatedTarget).
NOTED, NOT FIXED: .dds-hint (z 2147483001) outranks the drawer and lingers
~200ms at opacity:0 while still hit-testable (shell.js:896) — a brief real
tap-eater at the bottom of every phone page. Pre-existing, once-per-user.
Gates: pure 222/0/4, chrome 28/28, shell 5/5, e2e desktop 477/0, mobile
377/1 (the known portal.spec.ts:533), tablet 377/0.
FRONTEND ONLY — no SQL, Netlify auto-deploys on merge.

## 🔧 GAP SWEEP — BUILT, AWAITING SQL + DEPLOY (2026-08-07)

Eric: "please do all of things you can do and any gaps you see make the
changes." Closed every reported-not-fixed item from the day's reviews.
Commits 5ca624c→4579 2f7 (12).

TWO REAL GAPS:
1. INVOICE VOID — pipeline.html rendered a "Voided" state NOTHING could
   produce; an invoice raised in error could only be cleared by PAYING it,
   and it stranded a permanently-undismissable "Still unpaid" row. Now
   POST /sales/invoices/:id/void: open (sent or not) → voidable, PAID → 409
   never, void → idempotent; guard doubled into the PATCH WHERE; clears the
   invremind notice; Stripe link deactivated AFTER the status write so a
   Stripe hiccup can't leave a void that didn't happen.
   ⚠️ CAUGHT A MONEY BUG: the client portal gated its pay button on
   `status !== 'paid'` — a VOIDED invoice would have kept a live payment
   link in front of the client. Unreachable before only because voiding
   didn't exist. Now allow-lists `status === 'open'`.
2. DELETION RE-REQUEST — `deletion_requested` used period 'once' and cancel
   DISMISSED rather than deleted, so a second request after a cancel raised
   NOTHING: no notice, no bell, no email, silently. Period is now
   per-request; a cancelled request cannot be resurrected.

NOTIFICATION HONESTY BACKLOG (all four flagged earlier, now closed):
· EIGHT operator-directed sends could be silenced by one unsubscribe click
  ("your scheduled jobs are failing", "a site is down") — now critical
  (still respects bounce/complaint; NO customer mail gained the flag).
· text/plain welded labels to values ("ProjectWebsite refresh") — new
  htmlToPlainText; also fixes self-closed <br/> which never broke.
· all THREE doors onto a support thread now bump updated_at (the portal
  reply and the studio's own reply both didn't).
· the bell badge refreshes on tab-return, 60s throttle claimed BEFORE the
  request, no interval, keep-last-good.

REVIEW: NO BLOCKERS — 22 invoice statuses driven, every client-facing money
surface verified to refuse a voided invoice, 0118 kind-set proven equal to
what the code writes. BUT 5 of 10 mutations ESCAPED: correct code, unguarded.
All closed (db860ca/2de3918/45792f7):
(F1) a voided invoice paid via a STALE Stripe link left NO in-app trace —
     deactivatePaymentLink swallowed both throw and non-2xx so all three
     outcomes returned byte-identical success. Now returns a boolean, the
     operator is told when the link may still be live, and the webhook
     raises an `invoice_void_paid` notice when money lands on a withdrawn
     invoice (it still refuses to un-void it).
(F2) the critical-flag guard pinned 6 of 8 sites — now DERIVED: it scans
     every sendEmail bound from OPS_ALERT_EMAIL, so a ninth is covered the
     day it lands. Nearest-preceding-assignment binding, because file-wide
     would have demanded critical on customer mail in lifecycle.ts.
(F3) all three badge claims were unpinned (throttle-before-request,
     failing-endpoint, open-layer) — the layer test opened a popover that
     lives on document.body and survives a re-render either way; now opens
     a nav dropdown inside root. M8/M9/M10 all fail now.
(F4) the sentinel invariant was asserted, not enforced. (F5) delete-request
     never checked its insert — it reported "recorded" and could strand an
     ACTIVE protected notice with no deletion row behind it.
Gates: pure 222/0/4, e2e 334/12/0 desktop, deno check clean.
⚠️ NEEDS ERIC: merge + run 0118 AND 0119 + function deploy. SQL BEFORE the
deploy — dealEvent and raiseNotice are best-effort, so an un-widened CHECK
drops the ledger line / the notice SILENTLY.
NOTE: deploy #30 failed on a Docker Hub rate limit pulling the supabase
edge-runtime image (`toomanyrequests`) — infrastructure, not code; the
re-run succeeded. It will recur; just re-run.

## ✅ FILES — BY CLIENT + REAL FILENAMES — BUILT, AWAITING DEPLOY (2026-08-07)

Eric: "files should be able to be organized and filtered by client...not all
just there at once" + every row showed NAME = "Photo".

FILENAMES WERE NEVER LOST. `displayName` (lib/dam.ts) had three rungs:
metadata.title → storage basename → kind label. Rung 2 is dead BY DESIGN
(createUpload names objects `<siteId>/<uuid>.<ext>`; dam strips
/^[0-9a-f-]{20,}$/). And only PDFs ever got a metadata.title PATCH
(`files.html` had an `if(isDoc)` guard) — so for an image the literal
'Photo' was the ONLY rung that could fire. The real name was in
`alt_text` all along, already selected, already shipped to the browser.
One rung recovers all 8 rows retroactively — no write, NO MIGRATION.
Also fixed: images now PATCH metadata.title; the client-upload metadata
PATCH (a wholesale replace) no longer drops `title`.

TWO COLUMNS STOPPED LYING: asset_status is `not null default 'approved'`
and NOTHING ever sets it — every file was born "Approved" with nobody
approving anything, and Eric's edition is policy='immediate' (no approval
step exists). The column now stands down unless it has something true to
say (archived brings it back). "Not used" only ever measured 4 website
surfaces — project deliverables aren't in the graph, so a client's upload
for live work could NEVER read anything else → "Not on your site".

CLIENT RAIL: presence_media has NO client column, and every client's upload
lands on the AGENCY site — so the page was structurally incapable of
separating them. Built from the existing 3-hop join (deliverables →
service_links → clients), operator-side only. NO MIGRATION.
⚠️ THE TRAP AVOIDED: the `?client=`/x-dds-scope-site drill-in would have
scoped to the CLIENT'S OWN SITE — their website's media, not what they
uploaded to Eric's projects — and would have LOOKED correct. Pinned by a
test asserting customer_site_id never appears in assets.ts.

REVIEW: no blocker; 11 findings, the important ones fixed (c0507cc/9c5882d/
d82b4ef). (F1 HIGH) a client's file could render as "Studio" — claiming the
studio owns their work — because an empty name became an absent field, and
the rail and cell had DIFFERENT fallbacks ('A client' vs 'Studio'); now one
shared `clientLabel()`. (F2) the try/catch couldn't fire — `svc()` returns
{ok:false} rather than throwing — so hop 3 failing mislabelled every client
file; now each hop checks .ok, bails to an EMPTY map (never a half map) and
logs which hop. (F3) unbounded in.() lists (2000 ids ≈ 74KB vs an ~8KB
request line) → chunked at 100, parallel, any chunk failing fails the hop.
(F4) hop 2 is the only service_links read omitting status=eq.active — KEPT
deliberately (a former client's work is still theirs; filtering would re-file
it under "Studio" — a false authorship claim) and pinned. (F8) added an
id.asc tiebreaker — "first deliverable wins" wasn't a total order. (F10) a
surviving mutation (dropping deleted_at) now killed. 8/8 mutations killed.
F5 — MY DECISION, delegated by Eric ("whatever you think is best"): the
filename fix had leaked real filenames into /portal/feed's site-wide pending
list, where a client_reviewer on an AGENCY site could enumerate other
clients' identities from filenames alone (the repro was literally
`Replace Rivera-Builders-new-logo-FINAL-v3`). FIXED: the alt_text rung is
now OPT-IN (`fromAltText`), so privacy is the default and a caller must ask
deliberately. Exactly ONE file in the whole backend opts in (routes/
assets.ts) — pinned by a test that walks the tree and counts.
Gates: pure 217/0/4, files.spec 117/117 ×3 viewports, portal untouched.
NO MIGRATION. Needs merge + FUNCTION DEPLOY.
DEFERRED (reviewer's view recorded): F6 the Status column's return
re-introduces in-container scroll (that's the shared roster anatomy working,
not a regression); F7 a truncated client name is desktop-only readable — the
rail's full names + tap-to-filter is the touch path; the detail slide-over
would need a new server read (deliberate slice, not a drive-by); F9 the
2000-deliverable cap truncates the NEWEST work because the order is
ascending — now WARNS instead of failing silently; a proper fix is a keyset
page on (created_at,id).

## 📁 FILES — ORGANIZE + FILTER BY CLIENT (Eric, 2026-08-07) — QUEUED

"when you're done files should be able to be organized and filtered by
client...not all just there at once." The studio Files page (files.html)
groups ONLY by kind (All files · Favorites · Photos · Stock Library · Brand
· Documents · Templates · Downloads · Archive) — every client's files land
in one undifferentiated list. Wants client as a first-class organizing +
filter dimension.
ALSO OBSERVED in his screenshot (investigate as part of this): all 8 files
render with NAME = "Photo", identical to the KIND column — the real
filename appears to be missing/not surfaced, so the list is unscannable
even before client grouping. Every row also reads "Not used" in WHERE USED
and "BY CLIENT" provenance (that provenance stamp is the SS-wave security
fix working as intended).
SEQUENCED: after the CRM deal-page four (services preset dropdown ·
deal contact info + contract-out unblock · to-do dropdown · new contract
template), per "do all these things first".

## 🔔 OPERATOR EMAIL NOTIFICATIONS — BUILT, AWAITING SQL + DEPLOY

Eric (2026-08-06): "im not getting email notifications when people send
messages, upload files etc." DIAGNOSIS: MISSING FEATURE, never built —
`git log -S"sendEmail"` on the portal delivery routes returns ZERO commits.
The pattern exists and works for bookings/reviews/leads (booking.ts:281,
reviews.ts:140, commercial.ts:218 + lib/notice.ts's ONE notice model), and
the LEGACY clever-api backend had the full portal relay (index.ts:539-543:
client_message/file_uploaded/approval_action/brief_submitted/contract_acked
→ ERIC) with ZERO live callers — it was left behind when the portal was
rebuilt onto presence/client.html. Second defect found: client_upload and
task_done were in NEITHER the bell filter nor the Inbox filter, so uploads
were invisible in-app entirely.

ERIC'S DECISIONS: all four events (message · upload · request · approval);
INSTANT, throttled. Email copy approved-pending (sent in chat).

BUILT (ca21130 → 8d4d7ea): notifyStudioOfClientAction seam in
lib/service_bridge.ts; recipient chain identity.email → site owner's own
clients.email → OPS_ALERT_EMAIL (gated on AGENCY_SITE_ID, agency site ONLY
— reviewer verified at the schema level that a client action can NEVER
email a different client); raiseNotice created-flag = the throttle (15-min
bucket per thread; approvals once ever); migration 0116 widens the notice
kind CHECK; in-app filters/labels/hrefs widened.

QUALITY TRAIL: review found no privacy blocker but 8 findings, all fixed
red-first (8d4d7ea, each proven load-bearing by targeted revert): (F1 HIGH)
badge double-counted every action AND never returned to zero — the notice
half had no teardown where every other per-event kind has one; fixed by
excluding client_* kinds from the count (rows still throttle + still ride
the bell rail). (F2) client chatter hijacked the plan-upgrade card with a
"See plans → pricing.html" CTA. (F3) the notify was an un-awaited ~10-hop
chain the edge isolate could tear down before sending — now
EdgeRuntime.waitUntil with an awaited 3s-capped fallback, tail parallelized.
(F4-F6, F8) env docs, honest throttle contract, studio approvals no longer
inflate counts (needs_reply = client's newest QUESTION, not a clean
approve), tautological e2e replaced.
REPLY-TO HAZARD: operator mail omits opts.siteId so replies go to the human
PLATFORM_REPLY_TO — otherwise Reply would post into /email/inbound, maybe
onto a client's thread. Pinned by 2 tests + verified by hand.
Gates: pure 211/0/4, e2e inbox+crm+portal 206/0, 9 presence.html specs
134/0, deno check clean.

⚠️ NEEDS ERIC: merge + run 0116 SQL + function deploy (SQL BEFORE/WITH the
deploy — pre-migration the notice insert fails → no email, no crash).
ALSO OWED: check presence_identity.email on the AGENCY site (/presence →
About your business → The basics → Email). It's the PUBLIC website contact
address AND rung 1 of the notification chain, and it WINS over rung 2 — if
blank, his booking/review/lead emails have been silently dropping too
(those three notifiers read it alone and were deliberately left untouched:
adding a fallback there would misroute CLIENT-site notifications to Eric).
FLAGGED, NOT BUILT: badge staleness (nothing polls — the bell only
refreshes on navigation, so an email can beat the badge); critical:true
missing on the weekly digest + ops alerts (same silent-suppression bug);
sendEmail's text/plain lacks newlines on </td>; portal support-reply
updated_at bump still missing (FOLLOW-UP comment in inbound_email.ts).

## 📬 CLIENT MESSAGES LANDING AS SUPPORT REQUESTS — FIXED, AWAITING DEPLOY

Eric (2026-07-27): "the messages from Hettie keep coming in as support requests."
DIAGNOSIS (read-only, verified at tip): NOT a display bug — two structural
defects + one fragility. (D1) routes/inbound_email.ts could ONLY write the
support spine — even a bridged client with a live project — while EVERY
outbound email (incl. project-message notifications) carries the inbound
reply-to, so each reply minted a ticket; subject-only + open-only threading
meant a new ticket per subject AND after every resolve, and even a reply to
the auto-ack minted one. (D2) the portal's "Message your studio" composer
minted a support request PER MESSAGE (client.html → POST /client/support).
(D3) support rows tied to clients only by requester-key string matching, so
a GoTrue-resolved uid or alternate address rendered her as an anonymous
"Support request" row outside her CRM thread.

FIX (85c506a→41319f8, 6 commits): F1 matched bridged client + ACTIVE +
client_visible project → presence_project_messages (portal parity, incl. the
kind:'message' event the inbox groups on); reference threading via
In-Reply-To/References with reopen-on-append; support spine as fallback.
F2 composer → newest active project thread, else ONE ongoing project-less
conversation (service requests still mint real tickets). F3 migration 0115
(client_id stamp + project-message external_id dedup) with write-time
stamping, tolerant reads, precise-signal degradation. F4 inbox label.

QUALITY TRAIL: review found a SECURITY BLOCKER — reference-thread append had
no sender-ownership check, so any known sender whose mail carried another
client's Message-Id (forged OR honestly accumulated via forward/reply-all)
injected into the victim's thread AS the victim and reopened their tickets;
and the test meant to pin identity-before-lookup ordering was VACUOUS
(a faithful hoist passed 125/125). All 9 findings fixed; 4 mutations run
by hand afterward, each caught: ownership check removed → 3 R1 tests fail ·
pre-0115 legacy path skipping the check → same 3 · lookup hoisted above the
stranger gate → the R2 ordering pin fails · project active/visible gate off
→ 2 R3 tests fail. Gates: pure 209/0/4 (inbound_email 125→142,
support_routing 15→19), e2e inbox+crm+portal 205/0, marketing 90 untouched.

⚠️ NEEDS ERIC: merge + FUNCTION DEPLOY + run supabase/migrations/
0115_support_client_link.sql. DEPLOY ORDER MATTERS: apply the SQL BEFORE or
WITH the deploy — pre-0115 the project-message landing has no dedup key, so
a webhook redelivery could duplicate a message. Behavior he'll notice: a
client's emailed reply to a CLOSED ticket reopens it (was: minted a new
anonymous ticket).

🏁 **MARKETING OVERHAUL — ALL DECISION-FREE WORK LIVE (2026-07-27).**
✅ PHOTOS GROUP A MERGED TO MAIN @9c4ec7c (Eric "Merge it", 2026-07-27;
Netlify). Six repo-asset slots live: founder avatar on pricing/services/
monthly-retainer credential cards + audit founder cell (alt follows the
index precedent; audit's is decorative-empty beside the visible name),
About's life strip (dog/gym/Rome), Work's desk shot. Review found ONE real
defect — audit avatar became a 46×61 ellipse post-decode (enhance.css
img{height:auto} beat .hero-sig; fixed with the inline box + a W===H
circle pin on all four pages). GROUP B (9 slots, 12 AI images) GATED ON
ERIC: Visual Studio prompts in docs/design/MARKETING-PHOTOS.md (G1,
G2a-d, G3-G9) — he generates, sends here, I place with the same contract.
NOTE 2026-07-27: the container twice restored a stale filesystem snapshot
(repo at d1cb905 + old client.html WIP; scratchpad pw-sandbox.config.ts
reverted). Recovery: park WIP in stash, checkout -B from origin, rewrite
the sandbox config (absolute testDir, headless_shell-1194). Origin is
always truth.
✅ MS6 MERGED TO MAIN @92a717b (Eric "Merge it"; Netlify). Review: no
blockers; 3 nits fixed pre-merge. MS6 delivered the doc's §MS7 sweep: five
capture forms tokenized (services/web-design/pricing/seo-strategy/monthly-
retainer), ai-disclaimer rebuilt on the legal template (copy verbatim,
pinned; pre-existing stray-brace dark bug fixed), start.html + contact-
disclaimer.html deleted (orphaned, 301→/contact), email-signature/
styleguide/a11y excluded from the public build + force-404'd.
REMAINING = ERIC-GATED ONLY: §MS7.4 terms extension + privacy provider
list (LEGAL-DRAFTS-166) · P6 SaaS namespace (get-started/signup/welcome —
NOTE signup.html's no-plan fallback now lands on agency /pricing, wrong
audience; needs the where-do-SaaS-plans-live decision) · estimator $800
SEO add-on + "Package" catalog framing + 25% rush (P2) · /monthly-retainer
→/growth-partnership rename (P5) · Results/Bacchus publish · P4a one-light
strip · health-wellness private-intake claim (needs published backing) ·
audit.html pre-existing :root fork (future sliver) · server cleanup: dead
clever-api discovery_intake route + stale comment (start.html retired).
✅ MS4 MERGED TO MAIN @dbb3503 (Eric "Merge it", 2026-07-27; Netlify).
✅ MS5 MERGED TO MAIN @f22c7f8 (Eric "Merge it", 2026-07-27; Netlify).
Review: no blockers; 4 items fixed pre-merge ($-safe stamp, unique-marker
guard, calm-adjacency copy, pin bookkeeping). Eric flag stands: health-
wellness private-intake claim needs published backing before it returns.
MS6 owes: services.html + web-design.html still carry the inline-hex/pill
soft-capture (outside MS5's fence — tokenize like the landers).
**MS5 BUILT (585fdc9 + 42c03b5):** industries family templatized per doc
§MS5 — the five landers' ~80%-identical shell now propagates from
scripts/industry-shell.template.html via sync-industry-shell.mjs (chrome
propagator's sibling; --check in build-public.sh) into 5 delimited regions,
{{industry}} in the closer H2 the only stamped variance; unique content
(lede/approach/bullets/FAQs/schema) stays per-page. Double closer collapsed
to soft-capture → ONE dark CTA → footer; soft-capture = MS3's tokenized
component (tool-page.css reuse, inline-hex copy dead); Explore pills →
.ind-chip (styles.css, radius 3px, tokens); industries.html process bridge
→ /how-we-work; health-wellness "private" bullet softened to the FAQ's own
"simple and calm". MS4 §2-3 leftovers done: about.html 4-card workspace
grid trimmed to the founder-direct beat + /how-we-work handoff; "Not
credentials" lede now owns the credentials it leans on (origin/beliefs/
signature untouched). Red-first: 13 new pins (21 tests/project) watched fail → green (shell
byte-identity + sync --check, pill/purple scan extended to the family incl.
linked css, single-closer static+live, light+dark AA on every changed
pair). Gates: marketing suites 140/0 ×3 projects (was 119/0), sync 28/28 +
industry-shell 5/5, pure 208/0/4. Shared-file blast radius: styles.css +8
(.ind-chip only), build-public.sh +1 check.
**MS6 BUILT (1a48b48) — entry/legal sweep (doc §MS7; Results shipped early
as MS1's P3 footer-demote, so this moved up a slot):** (1) the owed
soft-capture tokenization — punchlist said services+web-design, the
red-first estate sweep found the SAME byte-identical inline-hex band on
pricing/seo-strategy/monthly-retainer too; all FIVE now on tool-page.css's
.soft-capture (form function identical, above the single closer), the
styles.css div[style*=EDE8F7] dark shims deleted with them, pill/purple
scan extended over the five + legal set + 404 (portal-mock.css sanctioned:
decorative app-UI miniature). (2) ai-disclaimer REBUILT on the
privacy/terms legal template — its :root fork, pill badge, dark legal-hero,
and the stray-brace CSS that trapped dark mode behind <=900px are dead;
LEGAL COPY UNCHANGED and pinned verbatim. (3) legal-template pins on all
four legal pages; portal-terms.html spellings → /portal-terms. (4) 404
fonts on the preload pattern. (5) start.html + contact-disclaimer.html
DELETED (.html 301 pairs added). (6) email-signature/styleguide/a11y out
of the public build (build-public.sh rm + forced 404!s; pinned by running
the build). Gates: 153/0 ×3 projects (+13 pins), sync 28/28 + 5/5, pure
208/0/4. FLAGGED for Eric: terms covers only "this website and the free
tools" while SaaS signup records acceptance of it (doc §MS7.4 — legal
drafts, his call); P6 SaaS namespace UNDECIDED (get-started/signup/welcome/
studio untouched; signup's no-plan fallback still lands on /pricing.html —
now services pricing, wrong audience — but any repoint invents product IA);
audit.html still carries a page-local :root token fork (pre-existing MS2-era,
outside every scan fence so far); ai-disclaimer no longer loads concierge.js
(legal template parity — tool pages keep it).
NEXT: MS6 merge ask → remaining MS7-numbered leftovers are all Eric-gated
(P6 namespace, terms/privacy legal drafts #166, Bacchus/Results flip-back).

## ✅ G13 SLICE 2 — THE IN-PLACE EDITOR: MERGED TO MAIN + LIVE via Netlify (2026-07-20)

Eric's "go" → the marquee feature. dblclick any stamped text on the canvas →
edit in place (plaintext fields plain-only; md fields WYSIWYG w/ B·I·Link
mini-bar serializing to MARKDOWN SOURCE, never HTML); Enter/blur commits via
eeClassify→ipeSetPath→the existing debounced saveBlocks (one PUT+undo per
burst); Escape byte-restores; caps clamp+toast; feature-detect degrade;
Comments/Preview/Timewarp never editable; full a11y.

QUALITY TRAIL (the deepest of the effort — this writes customer sites):
build (94/0) → review: injection moat SOLID but 4 CONFIRMED corruptions →
fix pass (10 findings, fuzz fabrication classes eliminated) → verification
(all gates reproduced; 2 REMAINING browser-only corruptions caught: empty-
text-node em tear, space-leading-em bullet fabrication) → final patch
(3f436a1/b458ba9/c7c84f7): verifier probes 4/4, design_canvas 245, e2e 118/0
×3, zero fabrication classes, zero new fuzz divergences. Tip c7c84f7.

ERIC DECISIONS at merge (non-blocking, surfaced with the demo):
1. Typed markdown metacharacters in md fields render as markdown next paint
   (panel parity; fixing needs renderMarkdown escape support — server change).
2. Clearing a required field (e.g. a title) hides the whole section at publish
   with no warning — wants at least an honest toast (product call).
Known limits (accepted): literal-* adjacency shifts; execCommand script path
(serializer allowlist is the backstop). Backlog: 409 second-save window,
undo-inside-debounce, blockquote edge empties. SLICE 3: hero/core sections.

## 🏁 STANDARDS SWEEP — ALL DECISION-FREE WORK COMPLETE (wave 8 LIVE, 2026-07-20)

Wave 8 merged to main (Netlify): **SS10 snapshot-history** — the compare-iframe
SECURITY fix (client HTML rendered same-origin could read the operator's
Supabase session from localStorage; both panes now sandbox="" — reviewer
verified hole real, closed, no bypass) + family chrome + honest compare states
+ theme-aware chips. **SS12 admin-health** — family chrome + KPI band + banded
ops dashboard + honest operators-only 403 + real area navigations (domains →
presence.html#foundations after the review caught the OAuth-page mismatch;
sweep-spec corrected). Both reviewed safe; gates 1495/0 full e2e + 208/0 pure.

**EVERY non-decision-gated slice of the studio+portal standards sweep is now
LIVE.** Remaining work is ALL Eric-gated:
- Decisions: P1 (timeline+upcoming merge → SS9), P2 (business-insights vs
  analytics → SS11), P3 (leads vs inbox one-queue), P4 (sharing under drill-in
  → SS3), saved-reply scope doctrine, legal drafts' 6 decisions
  (docs/design/LEGAL-DRAFTS-166.md).
- G13 slice 2 — THE IN-PLACE EDITOR — on Eric's "go".
- Activation: Resend (runbook given in-chat 2026-07-20), AWS keys + 4 glue
  records (docs/presence/DNS-SETUP.md), Name.com token (D5).
- Review-backlog rollup lives in the wave entries above (C7 server widen,
  .tscroll 390px leak, viewport inflation on other table pages, server-500
  retry cards, WebKit CI pass, etc.) — none user-facing-critical.

## ✅ WAVE 7 LIVE — SS8 + PS6/PS7 (2026-07-20, Netlify) — SWEEP's non-gated slices COMPLETE

Merged to main. SS8 (website family + the website-health 403-lie fix) and
PS6/PS7 (project drill-in cohesion — VIEW_SEQ, throw honesty, per-read lines,
orphan-free share card, surgical reply repaint — + composer polish + the
projectsFailed-at-Files/Messages residual). Both reviewed safe (no required
fixes); 1408/0 full e2e, 208/0 pure. This closes EVERY non-decision-gated
sweep slice. Backlog notes recorded above.

## 🟢 WAVE 7 IN PROGRESS (resumed 2026-07-20 — Eric "continue" while doing Resend)

- **SS8 (attention + website-health + content-tree): BUILT + REVIEWED — SAFE, no
  required fixes.** 84 page specs + shell green; the website-health 403-lie fix
  and .lhead[hidden] guard both proven red-first; all fields map to real
  payloads. Backlog (all LOW/informational, NOT blocking): (1) website-health
  freshness uses the CLIENT clock ("As of 3:45 PM") — could misstate on a wrong
  client clock; attention/content-tree use clock-skew-immune relative labels;
  cheap fix = make website-health relative too (frontend-only, no server field).
  (2) freshness label doesn't live-tick (cosmetic). (3) Edit-no-clip pinned at
  360px only, structurally safe at 768. (4) health fixture label values diverge
  from the real generators (shapes correct — test-realism only). (5) one
  unreachable REQ_SEQ race. Ready to merge with PS6/PS7 as wave 7.
- **PS6/PS7: BUILT + REVIEWED SAFE (no required fixes).** 5 commits (640210e record
  cohesion + the PS1 projectsFailed-at-Files/Messages residual, cf02f99
  share-card Files, f8e8090 support rows, fa147ad openSupportThread+openSurvey
  cohesion, a02448f PS7 composers). All 4 brief items done (residual was in
  640210e); portal.spec ×3 = 478/0/29, four pure suites green, 11 pins
  red-first. NOTE: a coordinator hard-reset mid-build briefly reverted a
  today_home anchorTarget mirror line — restored verbatim (c97f571), 106/106;
  lesson: doc commits use scoped `git commit <path>`, never stash+reset, while
  a sibling agent shares the tree.
  Review backlog (LOW/pre-existing, non-blocking): (1) openProject/openSupportThread on a server 500 (not a throw) show "not available" + navigate away instead of the retry card — the throw path is honest; extend to !ok 500s later. (2) shareCompose picker read guarded by element-existence not a VIEW_SEQ token (inherited slice-12; narrow race). (3) openSurvey busy() assumes plain-text controls. (4) composers use focus() vs survey's focus({preventScroll:true}) — cosmetic.

## ⏸️ PAUSED BY ERIC (2026-07-20: "lets pause until i have more fable")

State at pause — everything through WAVE 6 is MERGED + LIVE (main@11a0af9).
WAVE 7 state at pause (updated after the dust settled):
- **SS8 is COMPLETE and pushed** (9bb85d3/1f6c9fa/91ee002/c45511c — all three
  pages wear the family chrome, the website-health 403 lie is dead, 84 new
  page-spec tests ×3 green + shell). NOT yet reviewed — on resume it goes
  through the adversarial review before any merge ask.
- PS6+PS7 (project drill-in cohesion B3 + composer stragglers B6; incl. the
  PS1-review residual: projectsFailed honesty at Files/Messages tabs) — the build agent was STOPPED mid-item to honor
  the pause. THREE PS6 commits LANDED first: 640210e (record cohesion —
  VIEW_SEQ + throw honesty + per-read lines + reviewer gate), cf02f99 (drill-in
  Files → slice-12 share card), f8e8090 (support queue-rows + focus contract).
  The uncommitted partial (an openSupportThread rewrite + in-progress spec
  edits) was discarded. On resume: relaunch from §PS6/§PS7 CONTINUING from
  those three commits — remaining: openSupportThread/openSurvey guards+theming,
  PS7 composer VIEW_SEQ/theming/focus, the projectsFailed residual at Files/
  Messages tabs, then the PS6+SS8 reviews (SS8 is also complete-but-unreviewed).
Then reviews → fixes → full suite → Eric merge ask, per the standing pipeline.

REMAINING AFTER WAVE 7 (all Eric-gated):
- Decisions: P1 (timeline+upcoming merge), P2 (business-insights vs analytics),
  P3 (leads vs inbox one-queue), P4 (sharing under drill-in), saved-reply scope
  doctrine, legal drafts' 6 decisions (docs/design/LEGAL-DRAFTS-166.md).
- Decision-gated slices: SS3 (settings trio), SS9 (timeline consolidation),
  SS10/SS12 (small, could also run un-gated), SS11 (approval-center+insights).
- G13 slice 2 — THE IN-PLACE EDITOR — ready to start on Eric's "go".
- Activation: Resend dashboard (inbound email), AWS keys + 4 glue records
  (DNS), Name.com token (D5 resale).

## ✅ STANDARDS SWEEP — WAVE 6 LIVE: PS4+PS5 + SS6 + booking sliver (2026-07-20, Netlify)

All lanes built → adversarially reviewed → fixes red-first.
- **PS4 Help tab**: three-way honest FAQ read, the LAST reviewer /client/* fetch
  leak closed, VIEW_SEQ, account card → profile section. **PS5 booking**:
  failure ≠ absence on all three reads, guarded paints, session identity
  prefill, per-step h1 focus. Review: safe, no fixes. Bonus sliver (review-
  found, pre-existing): stale-DAY slots race killed (BK_SLOT_SEQ) + the confirm/
  success lines now NAME the day being booked.
- **SS6 six CRM pages**: search (leads/inbox/projects), saved-reply INSERT
  (inbox both composers + crm record composer), Add-a-customer (POST parity
  verified; D7 scope header deliberately dropped — stray ?client= blanks the
  roster), C7 fallback alignment + honest labels, REQ/ACT/PROJ_SEQ guards, real
  crm tablists, sr-only h1 + aria-live. Review found a BLOCKING late-commit
  regression: dialog margin:auto + layout-viewport inflation made mobile
  Add-a-customer untappable — root-caused (minimum-scale=1 + explicit margins +
  inner scroller) and pinned on all three affected pages; plus SR_FETCH stale
  cache, refresh-failure honesty, invited:false honesty — all fixed red-first.
- **NEW ERIC DECISION (add to P1-P4 list): saved-reply scope doctrine** — a
  drilled-in operator's inbox picker AND manager resolve to the CUSTOMER site's
  reply set (scoped api()), while crm's picker always uses the operator's own
  (apiAg). Both defensible; pick one doctrine. Comments mark both sites.
- Backlog: C7 server-path disagreement (feed still new-only — server widen or
  label); stray-?client= breadcrumb on customers; leads "M new" base mixing;
  projects search-beyond-cap reports; viewport inflation may affect OTHER
  table pages lacking minimum-scale=1 (only 3 patched); WebKit pass in CI.
Gates: pure 208/0; scoped suites all green ×3; full e2e at merge time.

## ✅ STANDARDS SWEEP — WAVE 5 LIVE: SS5 + PS3 (2026-07-20, Netlify)

Both reviewed; all findings fixed red-first; 1083/0 full e2e + 208/0 pure.
- **SS5 Pipeline**: roster standard (.lhead w/ honest totals — "Latest 100"
  wording at the cap, board meta counts only rendered open cards "$X open",
  search over cached contacts join w/ create-invalidation, REQ_SEQ + boot
  retry, .bc-menu full popup contract incl. Tab-out close, linkable ?stage=won
  landing; both analytics "View won deals" footers land on it, period honestly
  omitted — deals API unwindowed). Backlog: post-move focus restore; >100
  contacts join residual; per-deal task interleave.
- **PS3 Bell chrome**: ONE bell on every tab (fixed top-right <720px, chipbar
  zone reserved after the reviewer caught a tap collision), navFromHref
  fallbacks (no dead clicks), three numbers reconciled by construction
  (needsYouItems(); tile labeled 'in "Needs you"', badge labeled "since you
  last looked"), bell-open refetch w/ exactly-one-GET + reviewer zero-fetch.
  Backlog: persona-probe fallback blast radius (notifications zero out when a
  client's probe fails — pre-existing derivation); mark-seen reopen race
  (cosmetic); snapWaiting per-project wording (deliberate, pinned).

## ✅ STANDARDS SWEEP — WAVE 4 LIVE: PS2 + SS4 + analytics seams (2026-07-20, main@bc5b466, functions deploy SUCCESS; legal drafts with Eric)

All four lanes built → adversarially reviewed → fixes red-first → gates green.
- **PS2 Invoices** (client.html): .frow rows w/ Paid/derived-Overdue chips (D2
  local-calendar math, UTC-trap documented), one fmtMoney everywhere, unpaid
  total = glance formula (string-equal pinned), reviewer-first calm branch,
  VIEW_SEQ, A4 failure honesty kept. Review: safe, no required fixes; optional
  hardenings APPLIED (https-only pay links both surfaces + structural pin, one
  overdue word across tab/needs-you, real status vocab in fixtures).
- **SS4 Broadcasts** (broadcasts.html): console standard + the dead-draft fix
  (Edit draft→GET /:id→PATCH same id); review caught 2 CONFIRMED bugs — post-
  send composer resurrection (duplicate-draft path on the irreversible action)
  + empty drilled-open panel after send — both fixed red-first, plus soft
  retries, ↻ invalidates detail cache, assist merges without blanking. Deferral:
  per-address failed-recipient list needs a new server route (rows exist in
  presence_broadcast_sends, unexposed).
- **Analytics seams** (SUPABASE TOUCHED → deploy.yml at merge):
  /analytics/portfolio active-only (KPI/rollup parity — archived clients no
  longer skew the band), websites[] +site_id +visitors (additive), Visitors
  (7 days) column feature-detected w/ em-dash null; hardening: visits read
  ordered + visitors_truncated marker (em dashes + notice past the 20k cap,
  insight cards suppressed under truncation), hashless rows skipped (parity
  with every other visitors surface).
- **Legal drafts #166**: docs/design/LEGAL-DRAFTS-166.md delivered to Eric — 6
  decisions flagged (refund posture, jurisdiction, address, wind-down number,
  publish-now-vs-activation, dates); compliance catch: SUBPROCESSORS "never
  your uploaded photos" is FALSE for the photo-edit path (corrected language
  drafted); ai-disclaimer needs an OpenAI line when Visual activates.
Gates at tip 8125ecc: pure sweep 208/0, portal 309/0 ×3, broadcasts 54/54,
analytics 82/0; full suite running at merge time.

## ✅ STANDARDS SWEEP — WAVE 3 LIVE: PS1 + SS2 (2026-07-20, main@86c5154, Netlify)

Both reviewed safe-to-present; all findings fixed red-first; 901/0 full e2e.
- **PS1 portal honesty** (client.html): failed reads never masquerade — Home
  keeps surviving rows + calm per-source lines ("caught up" only on all-ok-and-
  empty), billingFailed hides the due tile by contract, recent-updates/bell/
  Messages gated, snaps+wstats failures never cached (true retries), reviewer
  bell calm on its contractual 403, mark-seen POST leak closed. Backlog:
  projectsFailed honesty at Files/Messages tabs (named sliver), compound-failure
  persona demotion (accepted risk), bell-open refetch lands with PS3.
- **SS2 agency roster** (agency.html): full roster standard; 45d domain
  threshold platform-aligned (was 30d — could show High-priority + "All clear"
  on one page); search-issues-only clients surface in Needs attention; ↻ also
  refreshes queues; full-boot Try-again; starter-kit double-POST dead. Backlog:
  shared .tscroll 390px page-scroll leak (standard-wide, fix with
  customers.html), 401 soft-↻ toast, kit-form state wipe, UTC date parse.

## ✅ STANDARDS SWEEP — WAVE 2 LIVE: SS1 + SS7 (2026-07-20, main@9b6ea1a, deploy SUCCESS)

Both slices built → adversarially reviewed → consolidated fixes → gates green.
- **SS1 Files roster** (files.html): full roster standard — .lhead + live rail
  counts + ↻ soft-fail refresh, Table⇄Grid (persisted, mobile Grid), sortable
  typed columns + "by client" provenance chip, REQ_SEQ ?q= search (caret-safe),
  per-read honesty, bulk bar + bulk Download, a11y. Review fixes: F1 the chip was
  production-dead — server now stamps client uploads on the MEDIA row
  (client_delivery.ts) and /assets surfaces client_upload (SUPABASE TOUCHED →
  deploy.yml needed at merge); F2 stock-read generation guard; F3 selection
  pruned on row-set changes; F4 railN countsOk-only gate; F8 test-gap closures.
  Backlog: F5 300-row count cap, F6 search soft semantics, F7 stale-counts cue +
  esc() quotes.
- **SS7 Dashboard + Home** (analytics.html, today.html): the AGENCY PORTFOLIO
  LENS now wears the dashboard standard (KPI band from real payload, insight
  cards recut, per-client rollup drilling into scoped dashboards with ?client=,
  honest trouble/warming, REQ_SEQ + stencil); scoped deltas D1 (?period on all 8
  business-insights footers) / D2 (period labels) / D3 (expected-value copy);
  today.html C5 tokens, C6 Key Deals rail (OPEN-stage allowlist; limit=100) +
  Recent wins, D6 REPORTS cache. Review fixes: lost/converted deals excluded
  from Key deals, keep-last-good roster on soft ↻, zero-client copy, pure-suite
  mirrors re-synced. Backlog (server-side): archived-client mismatch in
  /analytics/portfolio websites[] vs client_count/roster; websites[] should
  carry site_id + visitors (unlocks rollup visitors column); ?stage=won landing
  waits for SS5.
Gates at tip cc03a56: pure sweep 207/0 (70/70 today_home restored), scoped e2e
165/0 ×3 projects, files+shell 121/0; full-suite run in flight at merge time.

## 🟢 POST-AUDIT BUILD — WAVE 1 (2026-07-20)

Three pieces built + independently reviewed. Eric's call (2026-07-20): **ship
Batch A + DNS D1 now, HOLD G13 slice 1** for a proper divergence fix.

**SHIPPED to main this wave (gates green: node --check, Deno pure sweep
205/0/4, full Playwright e2e):**
- ✅ **Batch A** — all 12 audit bugs fixed (aba667b/e2becac) + specs (07e58ac).
  Consolidated-review fixes (eae371d): (1) reviewer Requests contract — deleted
  the two slice-11 e2e tests that fed a `client_reviewer` populated 200s on
  `/client/services`+`/client/support` (impossible: `reviewerAllowed()` 403s both,
  workspace.ts:31); the honest contract lives in "Batch A regressions › A2" (calm
  card, ZERO `/client/*` reads), now carrying the zero-tiles/zero-Request-buttons
  guards. (2) A6 over-scoping — dropped `customers` from shell.js `APP_PAGES`:
  customers.html is the agency-portfolio roster (`/studio/customers` keyed on
  `agency_site_id`), so carrying a drilled LEAF's scope stranded the operator on
  an empty "← Customers"/"Open Customers"; those anchors stay UNSCOPED. broadcasts
  stays scoped (per-site).
- ✅ **DNS D1** — Route 53 adapter + zone lifecycle (1761370) + test suite/runbook
  (1e7b9ec). DORMANT + fail-closed (returns notConfigured until AWS secrets land).
  My inline review: safe-to-merge-dormant (authorization is server-pinned via
  `siteDomain(site)`, `validateRecord` robust, `mergeSpf` never loosens,
  presence_dns_zones has site_id PRIMARY KEY). Two non-blocking follow-ups for
  **D2**: (1) GET re-triggers `provisionSsl` on `propagated && !sslOk` — a write
  side-effect on a read; add a debounce/marker. (2) DELETE snapshots+deletes the
  zone but does NOT clear `presence_dns_zones` desired records, so stale records
  resurface on re-attach — clear on delete. First LIVE zone must be a throwaway
  test domain, not a customer's.

**Batch-A review residuals (tracked, NOT blockers):**
- A4 Home needs-you glance/queue still drops unpaid invoices on a FAILED billing
  read (no `billingFailed` signal into `glanceData`) — deferred-by-design to **B1**;
  de-caching means it self-heals next load.
- Spec-quality (low): A8 test pins only 1 of 4 identical fixes; A4 `#glance-due`
  assertion is non-load-bearing. Fold into a later spec-hardening pass.
- D7 (agency drill-in over-scopes the customers NAV item via `withScope`) is
  UNCHANGED — still a batch-D item; A6's fix only stopped it being *widened*.

**✅ G13 slice 1 + divergence fix — MERGED to main b03cff6, 2026-07-20 (Eric:
"Merge and deploy"). The held divergence was fixed the chosen way: the render
stamps each block's TRUE stored index as `data-dds-src` (provenance threaded
through the resolve pipeline) and the canvas joins by it — sid join demoted to
deploy-window fallback. Adversarial review: safe-to-merge (formula proven under
stacked divergences + 200-fixture fuzz); hardening applied (DDS_SRCMAP
compensation for non-move edits, composeBlocks exported + directly tested).
Gates: 207/207 pure, 699/0 full e2e ×2, golden byte-identical. Functions deploy #22
SUCCESS on b03cff6 (2026-07-20) — G13 s1 fully LIVE, functions + frontend. Next: G13 slice 2 (in-place editor), sequenced with the
standards sweep.** Original hold record follows for history:
⛔ (historical) G13 slice 1 — HELD (do NOT merge until fixed): review found a HIGH,
conditional join-divergence. The `/settings` sidecar computes sids via
`validateBlocksWithMap(row.blocks)` (validate-only), but the RENDER stamps
`data-dds-sid` over `resolveBlockMedia(validateBlocks(resolveLinkedBlocks(...)))`.
When a resolve step changes list length — a linked placeholder resolves in, or a
deleted-media block drops — the per-type `#N` counter shifts, so the canvas
toolbar's sid→BLOCKS_WORK join (Edit/Duplicate/Cut/Hide/Delete/Move via
`eeClassify`→`DDS_SIDMAP`) can hit the WRONG same-type block. Trigger: a page with
(a) a linked section OR (b) a deleted-media block, AND a same-type sibling after
it. Comment WRITE path is unaffected (uses the DOM stamp). **Fix plan:** compute
the sidecar over the SAME resolved list the render stamps — thread raw-index
provenance through `resolveLinkedBlocks` (1:1 or 1:0 drop) + `resolveBlockMedia`
so each resolved block's `src_index` points to its true stored BLOCKS_WORK index
(linked-expanded blocks → the placeholder's index). Add a regression test for the
linked + media-drop cases (the current `dds_stamps_test` blind spot), and re-prove
the render golden is byte-identical. Must land before G13 s1 AND slice 2 (editor)
ship. G13 code stays on branch `claude/supabase-migrations-0107-0108-779hh9`.

## 🌐 DNS ONE-STOP SHOP — DECISIONS LOCKED (Eric 2026-07-19)

Spec: docs/design/DNS-ONE-STOP-SHOP.md. Eric chose: **FULL SHOP** (real
delegated DNS + in-app domain SELLING) · backbone **AWS Route 53** with a
reusable delegation set · **branded nameservers ns1-4.davisdigitalstudio.com
YES**. Resale starts on **Name.com Core API** (retail+markup, $0 commitment),
graduating to OpenSRS wholesale at volume. Build order D1→D5 per spec; all
slices ship DORMANT + fail-closed until secrets land (the slice-6 Resend
pattern).

🔑 **NEEDS ERIC (one-time setup, in order):**
1. AWS account → IAM user with Route53 (+Route53Domains later) permissions →
   access key pair as function secrets AWS_ACCESS_KEY_ID /
   AWS_SECRET_ACCESS_KEY / AWS_REGION (runbook will be at
   docs/presence/DNS-SETUP.md when D1 lands).
2. After D1 creates the delegation set: FOUR GLUE RECORDS
   (ns1-4.davisdigitalstudio.com → the four Route 53 IPs) at HIS registrar
   for davisdigitalstudio.com — exact values will be in the runbook.
3. Name.com account + API token (for D5 resale) — can wait until D5.
## ⛔ STANDING RULE FROM ERIC (do not lose to compaction — he has repeated this many times)

**The redesign (#167) is GATED behind ALL other updates.** Order of work: updates
first, #172 final verification, only THEN #167. If a future session sees
"start the redesign"-type context, check this list first — if items are open,
do them instead.

**GATE STATUS: CLEARED by Eric 2026-07-15** ("as long as all the updates were done
we can do the redesign") — every update above shipped, deployed (functions +
frontend + migrations 0107–0110 in prod AND staging), and Tier-1 verified. #167
work may proceed: client portal first (increments 1–2 shipped; increment 3 =
approval-flow polish), then the studio side. The rule above still applies to any
NEW update Eric raises mid-redesign: new updates outrank redesign work.
