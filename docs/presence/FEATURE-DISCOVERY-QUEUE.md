# Feature Discovery & Product Review Queue

*A standing queue. When a milestone surfaces a capability that would materially improve the platform, it is logged here with a justification — **not built, not silently added to scope.** This is the input to the A9 Product Review Board, which decides accept / defer / reject. Each item: what · why it matters · where it came from · rough value/effort · disposition.*

> **Rule:** nothing here is committed work. Adding an item ≠ approving it. The Product Review Board (A9) triages.

---

## High value

### FD-1 · Scheduled publish / unpublish (+ content expiry)
**What:** publish a change at a future date/time; auto-retire content on a date (a `publish_at` / `expires_at` on a publish, driven by the existing scheduler). **Why:** every major competitor has it (AEM, Webflow, WordPress, Wix); it's genuinely useful for small businesses — holiday hours that flip automatically, a limited-time promo that retires itself, a seasonal page. Studio OS is publish-now only. Fits the snapshot/versioning model cleanly (additive). **Source:** competitor/operational review. **Value:** High · **Effort:** Medium. **Disposition:** Queued — strong candidate.

### FD-2 · Form / lead capture
**What:** contact/booking form submissions from a customer's published site land in an inbox they can see (and optionally email/notify). **Why:** small businesses live on inbound leads; a static site's contact form currently has no submission home in the platform. Likely the biggest "wait, it can't do that?" gap. **Source:** competitor/operational review (verified: no submissions table/route). **Value:** High · **Effort:** Medium (needs a capture endpoint + inbox; respects the no-tracking ethos). **Disposition:** Queued — verify template form behavior first.

### FD-3 · Approval → notify → one-tap approve loop
**What:** when the operator prepares a publish/connected-write/AI draft, the client gets a plain email → one tap into a focused approve/reject view → it proceeds. **Why:** the whole platform is approval-gated (the moat), but the *handoff* isn't a loop — the client must happen to be in the app. Turns great architecture into a delightful ritual; pairs with the A7.2 client portal. **Source:** operator-experience recommendation. **Value:** High · **Effort:** Medium. **Disposition:** Queued — highest relationship value.

### FD-4 · Operator/system monitoring + alerting + backup drill
**What:** external uptime check on `/system/health` with paging; log-based error/failure alerting; a recorded PITR recovery drill. **Why:** today an operator won't *know* if a publish breaks, a connection drops, or the system is down (Ops audit CRIT-1/HIGH-1/2). Managed competitors do this for you. **Source:** Operations & Production Readiness audit. **Value:** High (operational) · **Effort:** Medium (mostly infra/config). **Disposition:** Queued — already tracked as Owner Activation; surfaced here for the Board.

## Medium value

### FD-5 · Weekly client digest email
**What:** email the Business-Moments "worth a look" summary weekly (or on-demand). **Why:** clients don't live in the app; a calm digest brings them back and builds trust. Reuses the Moments engine. **Source:** operator-experience recommendation. **Value:** Med-High · **Effort:** Low-Medium.

### FD-6 · Shareable preview link for client review
**What:** a signed, time-boxed preview URL of the draft the client can open (no login) to review before publish. **Why:** closes the approval loop with the new client portal — send link → client approves → publish. **Source:** competitor review + A7.2. **Value:** Medium · **Effort:** Medium.

### FD-7 · Save-a-named-version on demand
**What:** let a user snapshot a good state without publishing ("Save version → 'before redesign'"). **Why:** AEM/WordPress allow named versions any time; Studio OS versions only on publish. Cheap — the snapshot machinery already exists. **Source:** competitor review. **Value:** Medium · **Effort:** Low.

### FD-8 · Global top-bar (search + notifications + profile + help)
**What:** a consistent top bar across signed-in surfaces with global search, a notifications bell, profile, and help. **Why:** the one genuine IA enhancement from A7.5 — currently there's no global search/notifications/quick-actions. **Source:** A7.5 IA review. **Value:** Medium · **Effort:** Medium.

### FD-9 · Operator console consolidation
**What:** surface provider **activation**, AI configuration, **feature flags**, **monitoring/reporting**, and Marketplace/Enterprise/Agency management as first-class admin-UI screens (they're API/config today). **Why:** makes the Admin Tool a complete operator console. **Source:** A7.5 Admin Tool review. **Value:** Medium · **Effort:** Medium-High.

### FD-10 · Uptime / broken-link watch on the published site
**What:** extend the Presence Monitor engine to watch the customer's *published* site for downtime/broken links. **Why:** proactive trust ("your site went down / a link broke"). **Source:** competitor review. **Value:** Medium · **Effort:** Medium.

### FD-11 · Agency-managed per-client sharing
**What:** let an agency member set a client's visibility/shares from the agency surface (today sharing is owner-managed on the client's own site). **Why:** the agency scenario wants to control exposure without logging in as each client. **Source:** A7.2/A7.5. **Value:** Medium · **Effort:** Medium (needs agency→client-site scoped write).

## Lower value / watch

### FD-12 · Version diff / compare view
"What changed between v3 and v5." Change-events exist (field names); a visual diff is a nicety. **Value:** Low-Med · **Effort:** Medium.

### FD-13 · Explicit workspace/role switcher
For a person who is both a business owner and an agency member — one switcher. **Value:** Low · **Effort:** Low.

### FD-14 · Task / reminder surface in Business OS
A light task/reminder list (the Growth Coach is adjacent). **Value:** Low · **Effort:** Medium. **Watch:** risks scope creep vs the calm ethos.

---

## Deliberately NOT queued (out of ethos / constitution)

- Page-builder/component versioning · A/B branching · per-customer staging environments · runtime third-party plugins · AI-generated customer photos · auto-publish/auto-social without approval. These conflict with the structured-content / determinism / approval / Product-Law stances and are intentionally excluded (see [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md) and the [Roadmap locked exclusions](ROADMAP-LOCK.md)).

---

*Triage owner: the A9 Product Review Board. Nothing here is scheduled or approved until the Board accepts it.*
