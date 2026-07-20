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

## 🟢 STANDARDS SWEEP — WAVE 4 BUILT: PS2 + SS4 + analytics seams + legal drafts (2026-07-20, pending Eric merge)

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
