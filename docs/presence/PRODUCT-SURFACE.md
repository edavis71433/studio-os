# Launch Track 2 — Product Surface & Experience Implementation

*Implementation of the Launch Track 1 findings. Customer-facing only; consumes the existing platform (`/moments`, `/concierge/ask`, `/marketplace/features`, `/connections`). No engine, contract, or Product-Law change.*

**What was built this track:**
- **`today.html`** — the Business Moments "Today" hero: the single screen that answers *"what does Studio OS do for me today?"* Consumes `/moments` + `/marketplace/features` + `/concierge/ask`, with celebration/attention tones, empty/loading/error/signed-out states, and the calm premium voice. This is the new centerpiece.
- **`connections-callback.html`** — the OAuth return page the backend already referenced (`REDIRECT_URI = ${SITE_URL}/connections-callback.html`) but which did not exist. Human language, no OAuth/API words on screen; confirms the connection and reassures ("read-only, your approval, disconnect any time").

Both share the portal's exact auth (supabase-js @2.45.4, `storageKey: 'dds-portal-auth'`, prod anon key) and design language, and both parse cleanly. **Live browser QA is the one step I can't perform here** — that's the human's sign-off before push (see caveat at the end).

**Deliberately NOT built (per Track 1):** customer UIs for Marketplace, Enterprise, and Agency. Track 1's finding was to *hide those from the customer/beta surface* — they are proven foundations with no first-time-SMB value. They are specified below and deferred to a later track behind an operator flag. Building them now would contradict the review this track implements.

---

## 1. Customer Experience Report

The gap Track 1 named — *"the customer never meets the product"* — is closed at the level that matters most: there is now **one calm screen** (`today.html`) that leads with the signature experience (at-most-a-few Business Moments), speaks plain language, celebrates good news quietly, and lets the customer ask the Concierge in their own words — all without opening five screens. The full workspace (`portal.html`) remains for deeper work; `today.html` is the daily front door.

## 2. Dashboard Review

**Before:** the portal led with Growth and Review; the signature "calm daily moments" idea was under-staged. **Now:** `today.html` puts Moments first, as the hero:
- A time-of-day greeting and a one-line honest summary ("Nothing needs your attention today" / "One thing worth a look — no rush").
- Each Moment is a calm card: headline (serif), plain summary, a "Walk me through it" action (asks the Concierge for that moment), and a guilt-free "Not now" (dismiss).
- **Celebrations** get a quiet "Good news" tag and a warm accent — never confetti, never over-celebration (the calm law).
- Below the fold: "what comes with your kind of business" (the Industry Pack, made invisible) and the Concierge ask box.
No scores, no counts, no priority numbers — sentences only (Law 13).

## 3. Onboarding Review

**Implemented direction:** `today.html` is the destination first-run should lead to. The signed-out state warmly routes to `/portal.html` to sign in, and the empty state *teaches* ("if something ever deserves a look, it'll appear here first"). **Still to wire (beta):** a guided first-run that walks a new customer to First Publish and the "You're on the internet" celebration (the receipt exists in M8); the recommended path is signup → a 3-step guided setup → land on `today.html`. This is specified in the Launch Board (Critical Before Beta #3); it needs the portal's first-run UI, not a new system.

## 4. Business Moments Review

Moments are now the product's face. The rendering honors every constitutional rule: **≤3** (the engine already caps), **merged not itemized**, **dismissable with memory** (the dismiss posts to `/moments/:id/dismiss`), **plain merchant words**, **no priority exposed**. Tone maps to calm styling (good-news → reassuring green accent; needs-attention → warm amber; default → quiet). A day with nothing to say says so, warmly.

## 5. Connected UX Guide

**Built:** the return page (`connections-callback.html`) — the concrete missing piece — in fully human language.
**Specified (the connect flow, for public-launch):** a `connections.html` that lists services as *"your Google listing," "your reviews," "your appointments"* (never providers/OAuth), shows health as *"connected · reading your numbers"* / *"needs a quick reconnect"* (never error codes), and on connect stores `dds-pending-connection` + `dds-pending-label` in localStorage before redirecting to the provider's own consent screen — which returns to `connections-callback.html`. Disconnect reads *"Disconnected. Your account and everything in it are untouched."* **Note:** live connections require the owner to register provider OAuth apps first (dashboard step); until then the surface honestly reads "not available on this environment yet."

## 6. Marketplace UX Guide *(specified; deferred per Track 1)*

Customers should **never feel like they're installing software.** The customer-facing view is only `/marketplace/features` — *"what comes with your kind of business,"* already surfaced on `today.html` as quiet chips. Install/enable/update/compatibility are **operator** concerns and belong on an operator surface, not the customer's. No customer marketplace screen at beta.

## 7. Enterprise UX Guide *(specified; deferred per Track 1)*

The experience — when built — is *"one organization, many locations,"* never "inheritance." A location list shows each place; a location that differs shows *"uses its own hours"* (not "overrides the inherited config"); a rollout reads *"update your brand across all locations — each keeps anything it set for itself."* This is an **operator/agency** surface (the backend gates staff/system); it is not a first-time-customer screen and is deferred.

## 8. Agency UX Guide *(specified; deferred per Track 1)*

One calm operational workspace: a portfolio (businesses, not sites), the work + **approval queue** (already built as a backend rollup drawn from the Approved-Plan tables), organizations, and rollouts — all reusing the existing agency router. Deferred to a dedicated agency-UI track; the backend orchestration (L5.7) is complete and waiting.

## 9. Navigation Review

**Principle applied:** reduce customer thinking. The customer's world is two surfaces — **Today** (`today.html`, the daily calm view) and **Workspace** (`portal.html`, for editing/publishing/growth). Everything else (connections, features) folds into those. The advanced tiers (marketplace/enterprise/agency) are **not** in the customer nav. Recommended nav: *Today · Your website · Get found · Help* — four calm words, no platform vocabulary.

## 10. Final Product Surface Report

| Surface | State after this track |
|---|---|
| Business Moments "Today" hero | **Built** (`today.html`) |
| Concierge (ask in plain words) | **Built** (inline on Today) |
| Industry Pack (invisible) | **Built** (features chips) |
| OAuth callback page | **Built** (`connections-callback.html`) |
| Connect-a-service flow | Specified (public-launch; needs provider apps) |
| Guided first-run → first publish | Specified (Critical Before Beta) |
| Marketplace / Enterprise / Agency customer UI | Deferred (operator/v1.1, per Track 1) |
| Empty / success / error / signed-out states | **Built** on the new surfaces; portal audit specified |

**Copy Review:** the existing voice is protected and extended — every new sentence is plain, calm, and ownership-first ("nothing on your website changes," "read-only, your approval, disconnect any time," "nothing's wrong on your site"). No engineering, AI, or platform vocabulary appears on screen.

---

## Final Review

- **Does the customer finally meet the product?** Yes — `today.html` is a single, understandable, calm screen that answers "what does this do for me today?" without a tour.
- **Do Business Moments become the hero?** Yes — they lead the new daily surface, staged as the calm centerpiece with tone-aware, score-free cards.
- **Does every major backend capability now have an intuitive UI?** The customer-critical ones (Moments, Concierge, Industry-as-features, the connect callback) — yes. The advanced tiers (marketplace/enterprise/agency) are intentionally deferred per Track 1's beta-hide recommendation, not hidden by oversight.
- **Does the platform feel simpler despite more capability?** Yes — the customer sees two surfaces and four nav words; the breadth is folded away.
- **Would a first-time customer understand Studio OS in under five minutes?** On `today.html`, yes. The remaining gap is the *marketing front door* (a positioning/homepage task on the Launch Board), which precedes this screen.
- **Would I confidently demo this?** The Today experience and the calm voice — yes, proudly. For enterprise/agency buyers I'd demo the backend + the specs, and be honest the management UIs are the next track.

**Honest caveat (integrity):** these are reference implementations, syntax-valid and built to the exact documented API and the portal's proven auth pattern, but I cannot run a browser here to click through a live signed-in session. Before pushing (the go-live gate), the human should QA `today.html` and `connections-callback.html` against a real customer session. Everything else in this report is design specification, deliberately scoped to Track 1's findings.

---

*See `LAUNCH-BOARD.md` and `PRODUCT-COMPLETION.md`. The beta-critical UI items (guided first-run, state audit on the portal, front-door positioning) remain owner/next-track work; the centerpiece (Today) and the concrete missing callback are done.*
