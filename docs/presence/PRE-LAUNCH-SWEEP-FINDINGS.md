# Pre-launch deep sweep — findings & recommendations

Final sweep across all authenticated HTML + backend routes, through four lenses: **automation-for-Eric** (touch less), **ease-for-client** (think less), **workflow gaps** (fewer steps, nothing falls through), and **no-code** (every workflow completable without code, as easy as the best benchmark). Ranked by impact; tagged by what's safe to do headlessly vs. needs a browser / your dashboards.

**Headline:** the platform is in genuinely good shape — the *reading* surfaces (8 CMS pages, `approve.html`), the delivery event-sourcing, the one publish pipeline, and the convert-to-customer handoff are excellent and already highly automated. Gaps cluster in three spots: (a) a couple of manual steps in *your* sales loop, (b) friction in client *doing* surfaces (support, request-changes, onboarding, mobile forms), and (c) work that completes in the backend but never surfaces to you.

---

## ✅ Implemented this pass (safe, tested, deployed to staging)
1. **Auto-email proposals & contracts on Send** *(automation — the #1 leverage item both sweeps flagged)*. Was: Send copies a link, then you switch to email and paste it. Now it auto-emails the deal's contact on the **studio's** brand (never "Studio OS"), best-effort, link still returned as fallback. `sales.ts` + `pipeline.html` toast ("emailed to the client").
2. **Fixed the broken "view deal" link** *(workflow)*. `leads.html` pointed converted enquiries at `crm.html#deal-…` (no handler → dead end); now `/pipeline.html?deal=…` with the client scope carried. Test corrected.
3. **Clearer decline copy** *(client)*. Declining an approval said "Set aside." → now "Noted — your studio has been told. Nothing changed."

## 🟢 Safe to implement next (headless, high value)
4. **Surface a signed contract / accepted proposal to you** *(workflow, HIGH)*. When a client signs via the token link, the deal advances but **no operator surface shows it** — you only find out by opening Pipeline and clicking each deal. Emit a notice so "Contract signed — ready to convert {name}" lands on Today/Attention/bell with a deep-link. Pairs with #1 to fully close the sales loop. (`sales.ts` sign/decide → `raiseNotice`; `attention.ts` read.)
5. **Default the Convert plan from the accepted proposal** *(automation, small)*. Convert re-asks the plan every time; default it from the deal, keep the dropdown as override. (`pipeline.html` + `sales.ts:convert`.)
6. **Fix support deep-links** *(workflow)*. `notifications.ts` returns `/support#request-…` but there is no `support.html` — a "your studio replied" notification dead-ends. Rewrite to the surface that renders support (`projects.html?project=…#support` / the client project view).
7. **iOS form auto-zoom** *(client, mobile, CSS)*. Login, verification-code, survey, and brief inputs are `font-size:14px`, so iPhones jump-zoom on focus. Bump form inputs to `16px`.
8. **Move the Google review URL out of code** *(automation + client)*. `project-survey.html` hardcodes `YOUR_PLACE_ID`, so **every happy client is currently never asked for a review** (silent revenue leak). Make it a per-site setting (or derive from the connected Google Business Profile).

## 🟡 Frontend adds — valuable, fenced, best confirmed in a browser
9. **Client support is a one-way dead-end** *(client, HIGH)*. A client can open a request but can't see its status or your replies — even though `GET /client/support` + `/client/support/:id` fully support it. Render the request list + threads in `client.html`.
10. **"Request changes" sends you no context** *(client)*. `client.html` fires `changes_requested` with no note; `portal.html` already does it right (a "what would you like changed?" modal). Mirror that one textarea.
11. **Messages have no timestamps / reply expectation** *(client)*. Add relative time + "your studio usually replies within a day."
12. **"I'll set it up myself" drops a client into the raw editor** *(client)*. Route it to the existing calm 3-step guide instead of `/presence.html`.
13. **Customers hub → deal/project doorways** *(workflow)*. `crm.html` "Open in context" lists everything except the customer's Pipeline deal and Project. Add both (ids resolvable from the bridge + `converted_client_id`).
14. **Unify the three "needs you" surfaces** *(workflow)*. The bell (`/portal/feed`) shows notices+approvals+moments; Inbox additionally shows client messages, surveys, and new leads. Point the bell at Inbox (the intended one place) or widen the feed so all three tell one story.
15. **Suggest AI-image alt text** *(automation)*. `visual-studio.html` asks you to type alt text via `prompt()`; pre-fill a caption to accept/edit.

## 🔴 Needs a browser to verify (auth/routing/native inputs)
16. **Password-setup transcription** *(client, first impression)*. `set-password.html` makes clients hand-copy a numeric code (3 separate autofill warnings on the page = a flow fighting the browser). Move to a magic-link.
17. **Two competing client homes + a choice** *(client)*. `welcome.html` offers "Enter workspace" vs "Go to portal"; pick one canonical landing server-side and route silently.
18. **Scheduling uses `prompt()` with hand-typed ISO timestamps** *(workflow)*. `presence.html` publish-later asks for `2026-08-01T09:00` as text; replace with a `datetime-local` input.
19. **The 10-field brief as first action** *(client)*. Stage it — ask the 1–2 required things first, reveal the rest as optional.

## 🔑 Needs your dashboards / a policy call
20. **Auto-nudge stale approvals** *(automation, policy)*. Today you click "Email the client to approve"; a pending approval could sit forever. Auto-nudge after N days — needs an email-cadence cap so it never feels spammy.
21. **Auto-send the post-project survey on completion** *(automation)* + surface a consented 5★ quote as a CRM note. Currently fully manual/disconnected.
22. **New-project templates** *(automation)*. Every build starts from an empty project; a default task/milestone template (like agency starter kits, "fills only what's empty") would save re-building each time.
23. **"New project" can't attach an existing customer** *(workflow)*. Only Convert builds the client-visible bridge; add a customer/deal picker so a project for an existing client is client-visible.

## No-code comparison (vs the benchmarks)
Every core workflow — add a lead, move a deal, send a proposal, sign a contract, edit the site, publish, approve, get paid, onboard — is completable with **buttons/forms only, no code**. Against the benchmarks: **competitive** with HubSpot/Zoho on CRM ease (and #1 above closes the one spot where they auto-sent and we didn't); **deliberately simpler/safer** than Wix/Webflow/WordPress on editing (form-based "can't-break-it"); and we **lead** the git-based hosts on publishing (one button vs. a deploy pipeline). The single remaining "harder for a non-coder than a competitor" item was the manual proposal/contract email — now fixed. The last no-code-for-*Eric* gap is the review-URL code edit (#8).

## Already excellent — do NOT rebuild
Convert one-tap handoff (provision + project + bridge + welcome email, idempotent) · enquiry→deal with no re-typing · fully event-sourced delivery with derived notifications · one publish/preview/schedule/restore pipeline · `approve.html` (model email-approval flow) · the 8 CMS pages (calm, colour-independent, jargon-free) · portal messaging/upload internals (optimistic send + rollback + double-fire guards) · proactive nudges auto-derived · invoice→Stripe link auto-created · agency starter kits · Today/Inbox aggregation.
