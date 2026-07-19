# POST-REDESIGN DEEP AUDIT — consolidated findings (2026-07-19)

Requested by Eric after the Salesforce redesign completed (all 12 slices live,
deploy #19): *"deep audit to make sure everything… is as close to Adobe and
Salesforce as possible… seamless and intuitive… workflows, no errors, all
optimized and cohesive — don't limit yourself to those categories."*

Method: six parallel read-only auditors over HEAD 62d8ccc — (1) studio
Salesforce parity, (2) portal parity/cohesion, (3) end-to-end workflows +
scope carry, (4) robustness/optimization, (5) Adobe builder parity,
(6) visual consistency/a11y. Findings deduped and ranked below. NOTHING has
been fixed yet — each batch ships only on Eric's approval, through the usual
build → adversarial review → gates → screenshots pipeline.

One correction applied to the raw reports: auditor 1 claimed "inbound email
unbuilt" — WRONG; slice 6 shipped the receive side (dormant pending Eric's
Resend setup). What is genuinely unbuilt is the OUTBOUND email compose tab.

---

## BATCH A — Regressions + outright bugs (all S; one sweep)

A1. contacts.html custom-fields manager UNREACHABLE (dead code) — CUR_DETAIL
    never assigned; openFields only wired inside never-called renderDetailView
    (contacts.html:555-643). No UI path to define contact custom fields.
A2. Reviewer persona on portal Requests sees PERMANENT fake outage cards —
    unconditional /client/* fetches 403 for reviewers (client.html:1436,
    1454, 1473); Messages/Files gate first (:928, :1360). [found by 2 auditors]
A3. shell.js bell says "You're all caught up." on a FAILED feed read
    (shell.js:478) — every page inherits the lie.
A4. Portal Invoices: failed /client/billing → "No invoices yet" AND cached
    for the session (client.html:600, 1400) — also zeros Home's unpaid glance.
A5. Inbox approval action does location.reload() (inbox.html:639) — nukes
    console state; everything else refreshes in place.
A6. Scope drops (agency drill-in silently unscoped): leads.html:163 +
    contacts.html:552 convert redirects; APP_PAGES omits customers/broadcasts
    (shell.js:740; hits crm.html:337,928 + today.html:344); agency.html:156
    project drill-in mints no client=; today.html:570 healthLine raw href.
A7. shell.css dark blocks missing --dds-p-deep (defined only in light :root)
    → crm.html accent text near-black on dark.
A8. "1 weeks ago" grammar bug in 4 rel-time copies (inbox.html:214,
    files.html:665, leads.html:84, broadcasts.html:89).
A9. inbox.html partial failure (one of feed/leads fails) renders as complete
    with no notice (inbox.html:703); broadcasts.html empty lists on non-403
    failures (:221-228).
A10. Studio project Files list can't distinguish client uploads from studio
     shares (note stored, never displayed — projects.html:590).
A11. admin-health.html lacks [data-theme] blocks — shell theme toggle can't
     flip it (admin-health.html:11-15).
A12. Legacy support-thread bubbles misattribute studio replies as "You"
     (client.html openSupportThread/bubbleHtml ignore the server `from` the
     Messages pane honors) — route drill-in to the honest renderer.

## BATCH B — Portal cohesion (the two untouched tabs + drill-in debt) [M]

B1. Invoices tab full treatment: list-view rows + status chips (paid/overdue/
    sent) + honest failure + VIEW_SEQ + billingFailed flag consumed by Home;
    unpaid-total line; amount formatting aligned with glance.
B2. Help tab treatment: honest FAQ-failure copy (stop "no articles yet" on
    500/403), VIEW_SEQ, promote the account card to a proper profile section.
B3. Project drill-in cohesion sweep (slice-4 page, pre-dates the standard):
    VIEW_SEQ re-check after awaits (openProject/openSupportThread/openSurvey/
    openBooking); honest partial-failure lines (msgs/support/report); the
    slice-12 share card replaces the legacy upload flow; Files section to
    .frow rows; support recency to last_activity_at; focus management.
B4. Booking flow honesty: three transient failures masquerade as "not set
    up" / "no open times" (client.html:1520-1541).
B5. Messages tab: failed /client/support silently drops all support threads
    from the list (client.html:935).
B6. Reconcile the three adjacent numbers (glance needs-OK vs queue rows vs
    bell badge — three definitions, none labeled); navFromHref dead clicks
    for unhandled notification kinds; mobile bell absent on non-Home tabs;
    "Recent updates" rows to queue-row anatomy; VIEW_SEQ for renderInvoices/
    renderHelp/openServiceRequest/openSupport (contract says every renderer).

## BATCH C — Studio roster parity + quick Salesforce wins [S/M]

C1. Pipeline: adopt the shared .lhead header (only roster without it) +
    refresh button + search; REQ_SEQ guard on load() races (pipeline.html:499).
C2. Search on leads/projects/inbox (client-side, pattern exists).
C3. Saved-reply INSERT button in inbox message+support composers and the
    crm.html record composer (spec 2.1.4 named it; pattern at projects.html:739).
C4. "Add a customer" action on customers.html (dialog exists on contacts.html).
C5. leads.html + today.html adopt the --dds-* token alias block (last two
    stragglers); files.html load() seq guard; palette input debounce
    (2 API calls per keystroke, shell.js:445); ⌘K empty state leads with
    Recent records; contacts/customers keystroke re-render debounce.
C6. Key Deals rail card on Today (existing /sales/deals read); render the
    already-fetched recent_wins on Today.
C7. Enquiry-count alignment: inbox Enquiries view (status==='new' fallback)
    vs leads.html Open — one queue, two counts (inbox.html:278).

## BATCH D — Analytics + workflow seams [S/M]

D1. Dashboard drill links carry the active period (?period=) and targets
    honor it — §12.6's own v1 requirement; "View won deals" needs a
    pipeline ?stage=won landing (board excludes won today).
D2. Period-label honesty: New enquiries / Visitors / Actions cards omit
    periodLabel() while siblings show it.
D3. "Won this month" labeled as expected deal value, not cash (copy fix).
D4. Marketing-site enquiry bridge: contact.html posts to legacy clever-api
    with an error-swallowing, hardcoded-email copy into the product flow
    (clever-api/index.ts:7581-7600) — post directly to /forms/submit or
    harden+log. [workflow auditor's #1]
D5. In-Reply-To/References threading for inbound email BEFORE Resend
    activation (subject-only forks conversations; inbound_email.ts:280-287).
D6. N+1 fan-outs → batch endpoint (today waitingCard, projects ensureReports,
    client ensureSnaps); parallelize broadcasts/developer boot fetches;
    cache /assets/collections+health; ddsContext 2.5s stall (shell.js:1076).
D7. customers.html over-scoping under drill-in (roster fetched with
    x-dds-scope-site of the drilled client — likely wrong roster); sharing
    in APP_PAGES but ignores scope (URL/behavior mismatch).

## BATCH E — Design-system foundations [M/L]

E1. ONE token source: retire dead tokens.css + dds-foundation.css (both
    claim canon, zero pages load them; styleguide.html documents classes no
    page uses); shell.css (or successor) becomes the imported sheet.
    Then: unify 5 inks, 7 muted values, 6 danger reds, shadow/radius drift.
E2. Global focus-visible ring (today only in the unloaded sheet; 17 pages
    have none); complete popup contracts (shell bell/profile/help focusout;
    pipeline .bc-move Escape + 44px floor); finish-or-downgrade the filter
    tablists (no arrow keys/tabpanels on projects/pipeline/leads).
E3. Shared helpers on window.dds*: ONE rel-time (3 vocabularies today), ONE
    money formatter (5 copies, cents-vs-dollars divergence), toast
    consolidation (6 duration variants), api() migration to window.ddsApi
    (4 incompatible shapes, files.html flips arg order — the standing bug
    factory).
E4. Heading hygiene (inbox has NO h1; client.html has 12); aria-live for
    inbox thread updates; serif reconciliation (Fraunces into --dds-serif;
    provision.html off Georgia; doc.html h1); reduced-motion completeness
    (8 guards missing scroll-behavior; 6 ungated JS smooth-scrolls);
    tabular-nums on crm/leads/contacts metrics.

## BATCH F — Big-ticket items (Eric prioritizes; each is its own effort) [L]

F1. Freeform canvas EDITOR (G25 slice 2) — backend live + capped but
    UNREACHABLE by any user; longest-standing philosophy reversal undelivered.
F2. G13 in-place canvas text editing (queue head of Adobe Wave 2) — replace
    the three fragile client mirrors with server-stamped section keys as its
    prerequisite.
F3. Route-for-review bridge — "send for approval" in the builder ritual +
    Page ▾, wiring WF-5 approvals + G11 comment threads + launch gates; the
    stated directive that never landed; also surface G11 threads in
    approval-center.html (punchlist overstates this as done).
F4. Outbound EMAIL COMPOSE on the record page (the un-built half of
    "messages like Salesforce"; receive side ships when Eric does Resend).
F5. Docked composer (SLDS signature element #4) — app-wide pinned composer.
F6. Inline edit in tables (customers Status first; spec promised it).
F7. Project record activity timeline (the shared .ti component; events exist).
F8. presence.html weight (688KB, 571KB inline JS — split/minify/externalize;
    biggest perf lever); dual save model reconciliation; History honesty
    (three silent catch-blanks) + unify the three version surfaces.
F9. Dashboard widgets: win rate, activity volume, lead-source→conversion
    (spec'd in slice 8, deferred).
F10. leads.html vs inbox Enquiries consolidation question (one queue, two
     surfaces) — product decision.

## Verified-good (for the record)
Stage/status enums consistent everywhere; doc-link chain healthy; both file
directions verified; studio dashboard ≡ portal card numbers; zero dead
internal links; injection posture clean across all audited surfaces; voice
register consistent; crm/inbox/analytics anatomy genuinely faithful to the
verified SLDS reference; builder Wave 1 14/14 + increment 6 4/4 real.

## Unverified (auditor cutoffs — candidates for a follow-up pass)
Portal zero-project first-run copy; studio-side booking cancel/reschedule
surface (possible dead end); exhaustive drill-link audit beyond sampled;
full dropdown-contract matrix; chart text-equivalents on admin-growth/
business-insights/report-card/website-health; exhaustive form-label and
touch-target sweeps.
