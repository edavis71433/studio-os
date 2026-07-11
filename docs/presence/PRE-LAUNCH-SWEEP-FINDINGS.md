# Pre-launch deep sweep — findings & status

Final sweep across all authenticated HTML + backend routes, through four lenses:
**automation-for-Eric** (touch less), **ease-for-client** (think less), **workflow
gaps** (fewer steps, nothing falls through), and **no-code** (every workflow
completable without code). Ranked by impact. This doc now records final status —
everything safe to do headlessly has been implemented, tested, and deployed to
staging (behind the push fence; prod backend deploy is a separate owner step).

**Headline:** the platform was already in good shape. This pass closed the sales-loop
blind spot, made the client's *doing* surfaces two-way, fixed dead links, and
removed the last mobile friction. What remains is genuinely owner- or
browser-gated (auth-flow change, a policy call, your Google link).

---

## ✅ Implemented, tested (148/0/4), deployed to staging

**Batch 1 — sales automation**
1. **Auto-email proposals & contracts on Send.** Send used to just copy a link; now
   it auto-emails the deal's contact on the **studio's** brand (never "Studio OS"),
   best-effort, link still returned as fallback. `sales.ts` + `pipeline.html`.
2. **Fixed the broken "view deal" link.** `leads.html` pointed converted enquiries at
   `crm.html#deal-…` (dead end) → now `/pipeline.html?deal=…` with client scope.
3. **Clearer decline copy** in `client.html` ("Noted — your studio has been told…").

**Batch 2 — surface work + mobile**
4. **W1 — Surface a signed contract / accepted proposal to you.** A client signing via
   the token link advanced the deal but *no operator surface showed it*. Now raises one
   notice ("ready to convert {name}") on the deal's agency site → Today/Attention/bell
   with a deep-link to Pipeline. Reuses the single notice model; idempotent; operator-only
   by construction. (`sales.ts` sign/accept → `raiseNotice`; `attention_center.ts` +
   `workspace.ts` wire the kind.)
6. **W5 — Fixed support deep-links.** `notifications.ts` + `client_delivery.ts` pointed at
   `/support#request-…` (no such page). Now project-anchored `#support-…` and
   `/client.html?support=…`, which both surfaces actually render.
7. **C6 — iOS form auto-zoom.** Login, verification-code, survey, brief, and portal inputs
   were <16px, so iPhones jump-zoom on focus. Bumped to 16px (`set-password`,
   `project-survey`, `get-started`, `portal` ×4). Desktop density effectively unchanged.

**Batch 3 — client "doing" surfaces**
9. **C1 — Client support is now two-way.** A client could open a request but never see its
   status or your replies. `client.html` now lists their requests + opens a full thread
   (original + studio replies with timestamps + reply box) over the existing
   `/client/support` endpoints. `?support=<id>` deep-link opens a thread directly.
10. **C2 — "Request changes" now carries a note.** Reveals a "what would you like changed?"
    field, passed through as `decision_note` (backend already supported it).
11. **C8 — Message timestamps + reply expectation.** Relative time on each message/reply +
    "your studio usually replies within a day."
12. **C10 — "I'll set it up myself" no longer cold-drops into the raw editor.** Routes
    through the existing calm 3-step guide (`get-started.html manualFallback`).

**Batch 4 — workflow + automation polish**
5. **A5 — Convert plan default.** The Convert dialog already defaults to the flagship
    **Presence** plan (no per-deal plan is captured, so there's nothing better to default
    from without a schema change — noted, not built). No change needed.
13. **W3 — CRM deal/project doorways.** "Open in context" listed every surface *except* the
    customer's Pipeline deal and their Project. `/crm/profile` now returns a studio-only
    context (deal via `converted_client_id`, project via the bridge); `crm.html` shows
    "Pipeline deal →" and "Their project →". Client side never sees them.
14. **W4 — Unified the "needs you" surfaces.** The bell (quick glance) and the Inbox
    (everything, incl. client messages/surveys/leads) competed. The bell popover now ends
    with "See everything in your Inbox →" so they tell one story.
15. **A7 — Suggest AI-image alt text.** Visual Studio asked you to type alt text into an
    empty `prompt()`; it now pre-fills what you described the image as.

---

## 🔑 Owner action remaining (only you can do this)
8. **A2/C5 — Google review link.** `project-survey.html`'s review link is still
   `…?placeid=YOUR_PLACE_ID`. The survey already *hides* the review button while the
   placeholder is present (so no happy client hits a dead link), which means **zero
   reviews are captured until you paste your real link**. Verify your Google Business
   Profile → copy the review link → set `GOOGLE_REVIEW_URL` (one line near the top of the
   survey's `<script>`). This is the single remaining "edit a value" step; everything
   else is button/form driven. (Also added to `GO-LIVE-ACTIVATION-CHECKLIST.md §5b`.)

## 🔴 Deferred — needs a browser to verify (I won't change auth/routing blind)
16. **C4 — Password-setup via magic-link** instead of hand-copying a numeric code. This is
    an auth-flow change; doing it blind risks breaking login. Do it with a browser open.
17. **C3 — Two competing client homes.** `welcome.html` offers "Enter workspace" vs "Go to
    portal"; pick one canonical landing server-side. Needs the edition/routing rules
    confirmed against the live app.
18. **W7 — Scheduling `prompt()` for ISO timestamps** → a `datetime-local` input in
    `presence.html`. Native-input behavior wants a browser check.
19. **C7 — Stage the 10-field brief** (ask 1–2 required first, reveal the rest). Frontend,
    but best confirmed visually.

## 🔑 Deferred — needs a policy call from you
20. **A6 — Auto-nudge stale approvals.** Needs an email-cadence cap (how many days, how
    often) so it never feels spammy — that's your call, and it wants the cron wired.
21. **A3 — Auto-send the post-project survey on completion** + surface a consented 5★ quote
    as a CRM note. Currently manual; the trigger point + cadence are a decision.
22. **A4 — New-project templates** (a default task/milestone starter that "fills only
    what's empty"). Needs your preferred default checklist.
23. **W6 — "New project" can't attach an existing customer.** Only Convert builds the
    client-visible bridge; a customer/deal picker on manual project creation would extend
    that. Medium build; deferred with the other bridge work.

## No-code comparison (unchanged conclusion)
Every core workflow — add a lead, move a deal, send a proposal, sign a contract, edit the
site, publish, approve, get paid, onboard, **now also see/answer support and request
changes with context** — is completable with buttons/forms only. Competitive with
HubSpot/Zoho on CRM ease (auto-send now matched), deliberately simpler/safer than
Wix/Webflow on editing, and ahead of git-based hosts on publishing. The last
"edit-a-value" gap for a non-coder is the review link (#8, owner).

## Already excellent — did NOT rebuild
Convert one-tap handoff · enquiry→deal with no re-typing · fully event-sourced delivery
with derived notifications · one publish/preview/schedule/restore pipeline · `approve.html`
· the 8 CMS pages · portal messaging/upload internals · proactive nudges · invoice→Stripe
link · agency starter kits · Today/Inbox aggregation.
