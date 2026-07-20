<!-- Studio half from recon workflow (24 surfaces, 5 auditors). The PORTAL half appends below when its recon fleet lands (same directive: 'And the portal'). -->

# STUDIO STANDARDS SWEEP — slice plan (2026-07-20)

Directive (Eric, 2026-07-20, after seeing the un-redesigned Files page): **"yes i want
the whole studio to those standards."** Every studio tab to the Salesforce-redesign
standard. Method: five parallel read-only recon auditors over HEAD (main@ec4e46c)
assessed all 24 studio surfaces against the shipped 12-slice references; audit
batches C + D (POST-REDESIGN-AUDIT.md) fold into this sweep. NOTHING is built yet —
each slice ships only on Eric's approval through the usual pipeline (build →
adversarial review → gates → before/after screenshots). Sequenced after the G13
divergence fix clears review (see OPEN-PUNCHLIST). The portal half of the same
directive is a companion plan (§5).

**The standard, in one paragraph:** every surface wears the redesign anatomy.
Rosters get the shared `.lhead` (object icon · title · "N things · Updated just
now" meta · ↻ refresh that soft-fails — toast + keep the list, never
`location.reload()`), typed sortable columns with `aria-sort` behind a persisted
Table⇄Cards/Grid toggle, and client-side search that never destroys the input or
its caret. Records get rec-head/highlights/Path/related-lists; consoles act in
place. States are honest everywhere: failure ≠ empty (a failed read never paints
an empty state or client-side defaults), per-read partial-failure lines, Try-again
wired to `load()` in place, 401/403/404 distinguished. Every renderer carries a
REQ_SEQ/VIEW_SEQ stale-response guard. Skin is the `--dds-*` alias block with the
full four-block theme contract — no hand-copied palettes, no literal hexes.
Dialogs are the styled askConfirm/askPrompt, toggles carry `aria-pressed`, focus
survives re-renders, one h1 per page, agency scope carries on every link and read.
References: customers/contacts (roster) · crm (record) · inbox (console) ·
analytics (dashboard) · leads (queue feed).

---

## 1. Page-by-page verdicts

| Page | Verdict | Headline gaps | Effort |
|---|---|---|---|
| files.html | **untreated** | No list view/columns/toggle; no .lhead/refresh; load() race (C5); flipped api() (E3); silent partial failures; no upload provenance; hardcoded palette | M |
| agency.html | **untreated** | Failed portfolio read renders "No clients yet" (honesty L); search drops focus per keystroke (L); no roster anatomy; dark-theme token gaps; starter-kit duplicate-POST listeners; silent queues failure | M |
| sharing.html | **untreated** | Failed reads paint fake member lists + share **defaults as truth** (privacy L); D7 drill-in scope mismatch (L); native confirm(); no guards/focus/tokens | S |
| broadcasts.html | partial | Saved drafts unopenable after reload — dead workflow (L); history has no drill-in/refresh/meta; reload() retry; native prompt/confirm; sequential boot (D6) | M |
| schedule.html | partial | api() without try/catch strands "Scheduling…" forever; no .lhead/refresh; no REQ_SEQ; stale datetime min | S |
| connections.html | partial | Post-action reload failure wipes the whole page; no seq guard; focus dropped on every action; ad-hoc palette | S |
| pipeline.html | partial | C1: the only roster without .lhead/refresh/search; no REQ_SEQ; no ?stage=won landing (D1); board-menu popup contract; no boot retry | M |
| analytics.html | partial | D1 drill links carry no ?period; D2 period-label gaps on 3 KPI cards; D3 won-value copy | S |
| today.html | partial | C5 hardcoded palette; C6 Key Deals/recent_wins unrendered; D6 waitingCard N+1 fan-out; D3 sibling copy | M |
| customers.html | partial | C4 no add-customer action; D7 over-scoped roster read under drill-in; C5 keystroke re-render; no REQ_SEQ | S |
| contacts.html | partial | C5 keystroke re-render; no REQ_SEQ — otherwise IS the standard | S |
| leads.html | partial | C5 hardcoded palette; C2 no search; C7 count seam with inbox; filter tablist; no REQ_SEQ | S |
| projects.html | partial | C2 no search; D6 60-request report fan-out; record section loaders unguarded (stale cross-record paints) | M |
| inbox.html | partial | C2 no search; C3 no saved-reply insert; C7 count seam; no h1; no aria-live on reading pane | M |
| crm.html | partial | C3 composer lacks saved-reply insert; loadActivity unguarded; tablists lack arrow keys | S |
| attention.html | partial | No .lhead/count/refresh; trouble() has no retry; group labels aren't headings | S |
| website-health.html | partial | No refresh/retry; 403 renders "nothing's wrong" (permanent lie); no as-of freshness | S |
| content-tree.html | partial | Edit link clips on narrow screens; no search/count/refresh/retry; 403 undistinguished; raw ISO dates | M |
| timeline.html | partial | Duplicates upcoming.html over one scheduled-publishes truth; no category chips; silent 80-event cap; family chrome | M |
| upcoming.html | partial | Substantially duplicates timeline's "Coming up"; back-link to /schedule.html; family chrome | S |
| snapshot-history.html | partial | Unsandboxed compare iframes (client content runs in operator auth context); hardcoded diff chips break dark theme; silent compare-tool failure | S |
| approval-center.html | partial | Omits open G11 feedback threads (F3 — "waiting for your go-ahead" page missing a waiting category); no refresh/meta; link-out only; untyped chips | M |
| business-insights.html | partial | Ignores ?period though it's the target of 8 period-carrying drill links (D1); no as-of/refresh; group-icon steal; overlap-with-analytics question | M |
| admin-health.html | partial | No as-of/↻ on an ops dashboard; area cards are dead ends; flat unbanded grid; page-local palette | M |

---

## 2. THE SLICE PLAN

Ordering: severity + daily-use first. Files leads because Eric flagged it by name;
then the three honesty-critical surfaces (agency, sharing's privacy lie,
broadcasts' dead draft loop); then the daily CRM surfaces; then the website
family; then satellites/ops. One approval per slice. Slices SS8–SS12 share one
cms-family primitive built once in SS8.

### SS1 — Files roster (files.html) — **M** — no dependencies
The page Eric flagged; the only daily-driver never in the 12 slices. Rail + detail
slide-over kept; roster treatment added on top.
1. `--dds-*` alias block; purge literal `#5b3fa0`s; migrate api() to the shared
   `(path, method)` shape while every call site is open (kills E3's standing bug
   factory for this page).
2. Shared `.lhead`: 🗂 icon · "Files" · "N files · Updated just now" · ↻ refresh
   with leads.html's soft-fail contract; rail gains counts for all 9 collections.
3. Table ⇄ Grid toggle (persisted `dds-display:files`; small screens Grid). Grid =
   today's tiles unchanged. Table = customers.html `.tscroll` anatomy: Name
   (mini-thumb) · Kind · Size · **Added** (rel-time + "by client" provenance chip
   — A10's studio-side sibling, surfaced at last) · Where used · Status; sortable
   `.thb`/aria-sort; row click/Enter/Space opens the existing slide-over;
   checkbox column feeds the existing bulkbar + new bulk Download. Sort `<select>`
   dies into `.lmeta`.
4. REQ_SEQ guard on load(); search stays a server `?q=` query but stale responses
   dropped (absorbs **C5**-files).
5. Per-read honesty: assets failure = honest error + Try-again, rail kept;
   collections failure degrades count-less with notice; uploadFiles reports
   "Uploaded N · M failed" truthfully.
6. aria-current on rail; kill renderStock's focus steal.
Closes: all 9 recon gaps. Absorbs: C5 (files), E3 (files api shape), A10-adjacent.

### SS2 — Agency roster rebuild (agency.html) — **M** — no dependencies
The last studio roster wearing the old anatomy, with two L bugs.
1. `--dds-*` alias block (fixes the dark-mode warn/good contrast failures for
   free); delete dead ACTING.
2. `.lhead`: 🗂 icon · fixed views (All · Needs attention · Domain expiring ·
   Billing · All clear) · "N businesses · Updated just now · Sorted by …" · ↻
   refresh with REQ_SEQ.
3. Table ⇄ Cards toggle; columns Name · Edition · Status · Waiting · Leads ·
   Domain, sortable, row opens drill-in, "Manage their website" as .rowact.
4. **Honesty:** failed portfolio read renders trouble, never the empty roster;
   queues-panel failure renders "Your queues wouldn't load just now" instead of
   silent absence; queue rows adopt today.html rail-card anatomy.
5. Search re-render restores focus + caret (fixes the one-character-at-a-time L).
6. Starter kits: class-based card, once-wired delegated events (fixes the
   duplicate-POST accumulation), aria-label on kitToSite.
7. SC-1 scoped drill-ins and healthDoor preserved verbatim.

### SS3 — Settings trio: sharing + connections + schedule — **M** — decision P4 first
Three settings-shaped pages, one shared mechanic set (soft reload, REQ_SEQ, focus
restore, `--dds-*` aliases, styled dialogs, compact lmeta+↻).
- **sharing.html:** per-read failure honesty — members failure renders an in-card
  failure + Try again, never the invite-empty row; shares failure renders the
  toggles card as unavailable — **defaults never paint off a failed read** (the
  privacy L). Resolve **D7-sharing** per decision P4. confirm() → askConfirm
  (lifted from connections). VIEW_SEQ + focus restoration; Inter back into
  `--sans`; "N people · Updated just now" meta. Optimistic toggle reconcile kept.
- **connections.html:** split reload() into boot (trouble) vs soft (keep cards +
  toast) and route all post-action refreshes through soft; REQ_SEQ; focus returns
  to the acted-on card; askConfirm hexes onto tokens; ↻ + updated meta; keybox
  busy state.
- **schedule.html:** api() fetch in try/catch returning `{ok:false,status:0}` (un-strands
  "Scheduling…"); leads-style `.lhead` (🗓 · "N scheduled · Updated just now" · ↻
  soft refresh); REQ_SEQ; :focus-visible ring; re-read datetime min on focus.
Absorbs: D7 (sharing half).

### SS4 — Broadcasts console polish (broadcasts.html) — **M** — no dependencies
Compose-first layout kept; history promoted from dead-end appendix to a real list.
1. **Drafts live again** (the L): "Edit draft" on draft rows loads
   subject/body/audience into the composer with DRAFT.id set so ensureDraft
   PATCHes; scheduled rows keep Cancel + gain Reschedule.
2. History section gets .lhead-style meta ("N broadcasts · last sent X ago ·
   Updated just now") + ↻ soft refresh — the honest way to watch sending→sent.
3. Rows drill in (client.html Messages idiom): status, audience, sent/skipped/
   failed counts, delivered body in the sandboxed srcdoc iframe, failed-recipient
   list when failed_count>0.
4. prompt()/confirm() → shared askPrompt/askConfirm; aria-pressed on segment
   buttons; trouble() retries load() in place.
5. Boot reads parallelized via Promise.all with per-read honesty (absorbs the
   **D6** broadcasts item); render-guard token on async flows; verify agency-scope
   carry now that A6's shell fix landed.

### SS5 — Pipeline to standard (pipeline.html) — **M** — no dependencies
C1 verbatim, plus the pipeline half of D1.
1. `.lhead` atop listWrap: 🤝 · ↻ refresh · "N deals · $X open · Updated just now
   · Sorted by …".
2. `.search` filtering DEALS client-side (title + contact name) across
   List/Board/Table.
3. REQ_SEQ guard on load() (:499).
4. Boot reads `?stage=` — including a **stage=won List landing** so analytics'
   "View won deals" stops landing on a view that hides them (**D1**, pipeline half).
5. Boot catch gains Try again; `.bc-menu` gets the popup keyboard contract
   (Escape + focus return, arrows, 44px); both role=tablist rows → role=group.
Absorbs: C1, D1 (pipeline half), E2's pipeline-named items (page-local).

### SS6 — CRM console + roster quick wins (inbox · leads · projects · crm · customers · contacts) — **M** — no dependencies
Batch C absorbed in one mechanical slice; two shared helpers built once (a ~150ms
debounce; `insertSavedReplies(textareaId)` lazy-loading /service/saved-replies).
- **inbox:** `.search` under .lhead filtering visibleRows() (**C2**); saved-reply
  insert in both composers (**C3**); Enquiries fallback counts non-archived with
  "N new" qualifier so it matches leads (**C7**); sr-only h1 + aria-live #pbody.
- **leads:** `--dds-*` alias block (**C5**); `.search` over ALL (**C2**); Open
  definition aligned with C7's call; tablist → role=group; REQ_SEQ.
- **projects:** `.search` on the roster (**C2**); PROJ_SEQ threaded through
  openProject + all section loaders (fixes real cross-record stale paints);
  ensureReports capped to visible rows until the D6 batch endpoint ships;
  tablist downgrade.
- **crm:** insertSavedReplies above #msgBody (**C3**); ACT_SEQ on loadActivity;
  arrow keys on the two tablists.
- **customers:** "+ Add a customer" porting contacts' custDlg wholesale (**C4**);
  /studio/customers read sent UNSCOPED so a stray ?client= can't blank the roster
  (**D7**, customers half); debounced search (**C5**); REQ_SEQ.
- **contacts:** shared debounce / list-only re-render (**C5**); REQ_SEQ.
Absorbs: C2, C3, C4, C5 (contacts/customers/leads parts), C7, D7 (customers half).

### SS7 — Dashboard + Home (analytics · today) — **M** — depends on SS5 (stage=won landing)
- **analytics:** withScopePeriod() appends `period=` to card footers (**D1**);
  `stage=won` on both "View won deals" footers; periodLabel() onto New
  enquiries/Visitors/Actions (**D2**); "expected value of N deals won" copy
  (**D3**). Period stays only on targets that understand windows
  (business-insights, pipeline stage).
- **today:** `--dds-*` alias block (**C5**); Key Deals rail card (GET /sales/deals,
  top 3–5 open by value, hidden on empty/403) + recent_wins rendered from the
  dash payload already in hand (**C6**); won tile relabeled "expected value won"
  (**D3** sibling); waitingCard fan-out mitigated via a shared REPORTS cache now,
  collapsed onto the **D6** batch endpoint when that backend lands.

### SS8 — Website family chrome (attention · website-health · content-tree) — **M** — no dependencies
Builds the shared cms-family primitive reused by SS9–SS12: `load(soft)` +
REQ_SEQ + Try-again in trouble() + distinct 401/403/404 copy + `.lhead`-lite
header (icon · count meta · "Updated just now" · ↻ soft refresh).
- **attention:** .lhead ("N items need you"; "All clear" at zero); `.glabel` →
  `<h2>`; scope carry and all-clear anatomy untouched.
- **website-health:** "As of {time}" + ↻ soft refresh keeping last good render;
  three honest 401/403/404 states (kills the "nothing's wrong" 403 lie); >300ms
  stencil; :root re-aliased onto `--dds-*`.
- **content-tree:** roster header ("N pages · M sections · X to look at") +
  live search with caret preservation; fix the section-row flex so Edit never
  clips at 360px; "Last published" onto the shared rel-time vocabulary.

### SS9 — Timeline consolidation (timeline · upcoming) — **M** — depends on decision P1 + SS8 primitive
Timeline becomes THE history surface: /website-timeline's "Coming up" absorbs
upcoming's five dated truths (scheduled publishes, domain renewal, trial end,
bridged milestones, waiting-on-you as a flagged tone); category filter chips
(aria-pressed); honest 80-event cap line or "Show earlier" pager; family chrome;
upcoming.html → redirect to /timeline.html#coming-up; housekeeping at
lib/navigation.ts:141 + shell.js APP_PAGES; GET /upcoming kept for consumers.
Fallback if P1 declined: family chrome only on upcoming + back-link to /today.html.

### SS10 — Snapshot-history honesty (snapshot-history.html) — **S** — SS8 primitive
(1) `sandbox="allow-scripts"` on both compare iframes — client-authored content
must not run same-origin with the operator's auth token. *This is a two-attribute
fix; if the queue runs long, cherry-pick it into whichever slice ships next.*
(2) Diff chips retokened onto `--good/--bad/--warn/--accent`-soft pairs (dark
theme holds). (3) initCompare's silent catch → visible "compare tool wouldn't
load — the versions above are complete" line. (4) Transient vs permanent failure
copy split. (5) Family chrome. F8 (three-version-surface unification) stays its
own big-ticket effort — not this slice.

### SS11 — Approval-center + business-insights console-lite — **M** — depends on decisions P2/P3-adjacent + SS7 (period links) + SS8 primitive
Both are cms grouped-card pages with identical boot code; one shared
header/refresh/VIEW_SEQ treatment.
- **approval-center:** compact .lhead (✅ · "N waiting · M scheduled · Updated just
  now" · ↻); **"Feedback on your draft" group** from an independent GET /comments
  read — one card per open G11 thread, honest one-line failure if that read fails
  (the surfacing half of **F3**; the route-for-review bridge stays F3); inline
  Approve / Not yet with optimistic reconcile where decide routes exist (inbox's
  post-A5 pattern); typed chips (warn/good/accent + status_label); `--dds-*` skin.
- **business-insights:** honor `?period=` end-to-end with the analytics chip
  anatomy (**D1** target half); "As of {generated_at} · ↻" in-place refresh;
  per-card evidence-window line ("Based on: last 30 days" — **D2** applied here);
  group icon moved off the first-observation steal; `--dds-*` skin.

### SS12 — Admin-health ops chrome (admin-health.html) — **M** — SS8 primitive optional
dhead header (🩺 · "As of {generated_at}" · ↻ under REQ_SEQ); grid banded into
Jobs & delivery · Reach · Money & usage · Notices; `.cf` drill footers to fixing
surfaces (domains→connections, email→broadcasts, billing/usage→admin-growth),
attention-first within bands; re-skin onto `--dds-*` (keep `--off` as the one
page-local neutral — deletes the hand-maintained theme copy A11 just patched);
:focus-visible + VIEW_SEQ. Honest 401/403/empty/trouble states kept verbatim.

---

## 3. Consolidation calls — Eric decides, F10-style

**P1 — upcoming.html → timeline.html.** Two surfaces project the same
scheduled-publishes truth with different vocabularies ("one queue, two counts" at
page scale). **Recommend: retire upcoming into timeline's "Coming up"** (SS9);
the dashed-rail bucket already exists in both the page and the projection, and no
HTML page links to upcoming — only the nav lens and APP_PAGES. Fallback: family
chrome only.

**P2 — business-insights.html vs analytics.** Analytics is the numbers, insights
is the words, over the same data. **Recommend: keep-and-align** as the drill-in
detail surface (8 inbound footer links, the nav lens, and sw.js caching anchor
it) — SS11 builds that. Alternative: fold into analytics as an "Observations"
band and retire the page — cheaper long-term; the observation-card component
moves either way, so SS11's work is unwasted under either answer.

**P3 — leads.html vs inbox Enquiries (audit F10).** The sweep only ALIGNS the two
counts (SS6, C7: both surfaces count non-archived with an "N new" qualifier).
Whether one queue should have one surface is a product decision that stays with
Eric; the alignment is unwasted under either outcome.

**P4 — sharing.html under agency drill-in (audit D7).** The URL claims the client;
the page reads/writes the OPERATOR's own members and shares — an operator
"inviting the client's reviewer" grants access to their own workspace. Two fixes:
(a) send `x-dds-scope-site` from `?client=` so the data matches the URL's promise
— **recommended if /portal/\* honors the header (verify first in SS3)**; or
(b) remove sharing from APP_PAGES (the A6/customers precedent) so drill-in links
stop minting a false scope. Decide before SS3 builds.

---

## 4. What this sweep does NOT cover

- **Portal (audit batch B, B1–B6 + delta gaps on the treated tabs):** the "and the
  portal" half of the same directive — companion recon + slice plan extends this
  doc through the same pipeline (per the punchlist's 2026-07-20 entry).
- **Batch E foundations (E1 one token source · E2 global focus/popup contracts ·
  E3 window.dds* shared helpers · E4 hygiene):** Eric ruled "later"; each sweep
  slice applies the page-local version (alias block, seq guards, focus ring,
  styled dialogs) so E shrinks as the sweep lands, but retiring
  tokens.css/dds-foundation.css and the global helper migration ship as their own
  approved effort.
- **Batch F big tickets (F1 freeform editor · F2 G13 · F4 outbound email · F5
  docked composer · F6 inline table edit · F7 project timeline · F8 presence
  weight + version-surface unification · F9 dashboard widgets):** these run on
  the post-audit big-ticket track in Eric's 2026-07-19 order, G13 divergence fix
  first. The sweep touches three F items only at their edges: F3's G11 threads
  surfaced read-only in SS11, F8's page-level honesty in SS10, F10 as decision P3.
- **Batch D backend seams (D4 enquiry bridge · D5 email threading · D6's batch
  endpoint itself):** not page treatments; they stay on the audit track — D6's
  endpoint unblocks the final fan-out collapse in SS6/SS7, which ship interim
  caps/caches until it lands.
