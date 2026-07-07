# Launch Track 1 — Product Completion & Customer Experience

*Review only. No code, no redesign. The lens is the customer, not the architecture: does a person who pays tomorrow understand it, trust it, and enjoy it?*

---

## Executive Summary

The product is **further along than the L5.8 review implied** — the client app (`portal.html`, ~5,400 lines) genuinely surfaces the core value with calm language: the **Review-and-decide** workflow, the **Growth Coach**, the **Concierge**, the **editor**, **publish**, and optimization guidance are all there, in plain words, with the approval model intact. The copy is already remarkably jargon-free (a real, rare strength — almost no "AI/algorithm/pipeline" leakage). The daily-calm philosophy is visible.

But three things stand between this and an *exceptional, obviously-buyable* product, and none of them are features:

1. **The customer never meets the product.** The public site (davisdigitalstudio.com) sells an **agency's web-design services** — "Web design and SEO for small businesses" — not Studio OS as a thing you buy and run yourself. There is no clear self-serve front door on the homepage; signup exists (`signup.html`, `welcome.html`, `start.html`) but you'd have to already know to look for it. A first-time buyer doesn't discover the product.
2. **The name is ambiguous.** Internally "Studio OS"; the editions are "Presence" (Presence Monitor → Enterprise); the site is "Davis Digital Studio." A customer can't tell what they're buying or what to call it.
3. **The hero of the daily experience isn't the hero of the UI.** "At most three calm Business Moments a day" is the product's signature promise, but Moments don't lead the dashboard the way they should — Growth and Review do. The single most differentiating idea is under-staged.

Everything else (Connected UI, empty/loading/success states, onboarding polish) is real but secondary. **The biggest obstacle is positioning + a product front door, not a missing screen.**

---

## Customer Journey Audit

**① First-time customer (lands on the site):** Sees a web-design *agency*, not a product. No "start free / see it work on my site" path from the homepage. **Drops off before discovering Studio OS.** *(Highest-impact gap.)*

**② Freelancer / solopreneur (signs up):** `signup → welcome → start → payment-success` exists. Once inside, the app is good — Growth, Review, Concierge, editor. Risk: the jump from "I paid" to "I have a live website" — is there a guided first-run that gets them from zero to published, or do they face an empty editor? The L1 first-run exists in the backend; the **guided walkthrough UI is the make-or-break** for this persona.

**③ Small-business owner (the core buyer):** Wants "keep my site correct and get found" without becoming a webmaster. The Monitor edition ("watch your existing site") is a brilliant low-commitment doorway — but it's not obviously offered as *the* try-before-you-migrate path on the marketing site. The daily Moments + Concierge are exactly right for them, if surfaced.

**④ Agency (manages many clients):** The M13/L5.7 agency backend is powerful, but there is **no agency UI** — no portfolio screen, no queues view, no approval queue, no org/location management. An agency cannot self-serve at all today.

**⑤ Enterprise administrator (many locations):** L5.6 gives them org→region→location inheritance and rollouts — **entirely API-only.** No org overview, no location list, no rollout approval screen. Not usable without an operator doing it for them.

**Confusion/trust-loss points, ranked:** (a) no product front door; (b) name ambiguity; (c) unclear where Moments live; (d) connect-your-listing has no UI or callback page; (e) agency/enterprise have no UI at all.

## Trust Audit

**Strengths (keep and lean into):** the copy is calm and ownership-first; approval language is everywhere ("nothing changes on your live site until you publish it"); the Concierge speaks like a knowledgeable partner, not a bot; findings are honest ("a note of honesty: this is a nudge, not a certainty"). This is the product's competitive moat — *do not dilute it*.

**Gaps:**
- **Ownership/export messaging isn't visible at purchase.** Law 2 (export, leave anytime, never penalized) is a killer trust signal for a SaaS a customer is wary of lock-in on — it should be *on the pricing page*, not only in the product.
- **Connected consent copy is absent** (no UI): when a customer connects Google, they need to see, in plain words, "read-only, you approve, disconnect anytime" *at the moment of connecting*.
- **AI disclosure** should appear where drafting happens ("we prepared this — you approve it; you can always write it yourself"), not only on a static `ai-disclaimer.html`.
- The site's agency framing can read as "you're hiring us" rather than "you're in control of your own presence" — a subtle ownership-message mismatch with the product's philosophy.

## UX Audit

- **Empty states**: the calm philosophy *depends* on great empty states ("Everything customers can see is current — nothing needs your attention today"). Confirm every list (Moments, drafts, reviews, connections) has a warm, reassuring empty state, not a blank panel.
- **Loading/success/error states**: confirm publish shows the "You're on the internet" receipt (M8 shipped this); confirm errors are plain and never raw ("that didn't go through — nothing changed").
- **Navigation clarity**: with Growth, Review, Concierge, editor, publish, the app has enough surfaces that first-time orientation matters — a single "what should I do today" home (the Moments view) would anchor it.
- **Approval affordances**: the review-and-decide flow is the trust core; make "Approve & publish" and "not now" equally easy and equally guilt-free.

## Feature Simplification Report

*Prefer removing.* For the **customer** surface (not the backend):
- **Hide Marketplace, Enterprise, and Agency from the customer/beta UI entirely.** They are proven foundations with no customer-facing value for a first-time SMB buyer; showing them adds confusion and support load. Ship them behind an operator flag; give them UI in a later track.
- **Consolidate the marketing landing pages** (`restaurant-web-design`, `salon-web-design`, `retail-web-design`, `home-services-web-design`, `health-wellness-web-design`, `roi-calculator`, `pricing-estimator`, `report-card`, `buy-audit`, `audit`, `ai-critique`) — they overlap, predate the product, and dilute the message. One clear product story beats twelve service pages.
- **Merge screens where possible:** the "connect your existing site" (Monitor) and "see what we found" (Migration Readiness) are two steps of one story — present as one guided flow.
- **Would customers miss anything if removed?** No SMB customer would miss Marketplace/Enterprise/Agency in the UI. They *would* miss a clear place to see "what needs me today."

## UI Gap Report

| Surface | State | Gap |
|---|---|---|
| Product front door (homepage → buy/try) | missing | no self-serve path; site sells the agency |
| Business Moments dashboard (the hero) | under-surfaced | not the anchor of the daily experience |
| Guided first-run (zero → published) | unknown/likely thin | make-or-break for new customers |
| Connected Platform UI + `connections-callback.html` | missing | can't connect a provider at all |
| Agency portfolio / queues / approvals UI | missing | agency can't self-serve |
| Enterprise org/location/rollout UI | missing | enterprise can't self-serve |
| Empty/loading/success/error states (audit) | partial | calm philosophy depends on these |
| Ownership/export + AI disclosure in-context | missing | trust signals not at the decision point |

## Missing Screen Report

**Critical:** a real **product homepage** (what it is, see it on your site, pricing, start); a **"Today" home** that leads with Moments + the Concierge; a **guided first-run**; the **connect flow + callback page**; **connected-consent** and **AI-disclosure** in-context panels.
**Later:** agency portfolio/queues/approvals screens; enterprise org/location/rollout screens; marketplace browse/install (operator, then customer).

## Missing Workflow Report

- **Try-before-you-buy via Monitor** as a first-class marketing → product workflow (observe my existing site → see findings → offer to bring it here).
- **Connect a provider** end-to-end (consent → OAuth → confirmation → "your Google listing: 4.6★" on the surface).
- **Approve a guided fix / connected write** from the daily Moments (the backend exists; the UI loop doesn't).
- **First publish** as a celebrated, guided milestone (the receipt exists; the guided path to it needs to be obvious).

## Copy Review

**Verdict: strong.** The customer-facing copy is already calm, plain, and ownership-first — the scan found almost no engineering/AI jargon. Keep it. **Small fixes:** remove the few "API/dashboard" mentions from customer views; make sure "Studio OS / Presence / Davis Digital Studio" resolve to *one* name the customer sees; put the export/ownership sentence on the pricing page; add the one-line AI disclosure and connected-consent lines at their decision points. Do **not** rewrite the voice — it's the asset.

## Support Readiness Review

**Gaps:** no Help Center / FAQ / knowledge base for customers (the 46 docs are for engineers); no in-product tooltips or walkthroughs; no documented support email/contact flow beyond the marketing contact page; no success-onboarding email sequence described. **Before beta:** a small FAQ (billing, ownership/export, "is my site safe", how connecting works), in-product tooltips on the primary actions, and a support contact path. Video/KB can wait.

---

## Prioritized Product Completion Checklist

### 🔴 Critical Before Beta
1. **Product front door** — a homepage/section that clearly presents Studio OS as a product you can buy and use, with a self-serve start path. Resolve the **one name** the customer sees.
2. **"Today" home** — make Business Moments + the Concierge the anchor of the dashboard (the signature experience).
3. **Guided first-run** — zero → published, with the celebration receipt; never drop a new customer into an empty editor.
4. **Empty/loading/success/error state audit** across the app (the calm promise lives or dies here).
5. **Ownership/export + AI-disclosure copy in-context** (pricing page + at drafting/connect points).
6. **A small FAQ + in-product tooltips + a support contact path.**
7. **Hide Marketplace / Enterprise / Agency from the customer UI** (operator-flag them).

### 🟡 Important Before Public Launch
8. **Connected Platform UI + `connections-callback.html`** + connected-consent copy (the highest-value missing customer capability).
9. **Try-before-you-buy via Monitor** as a marketing→product workflow.
10. **Consolidate the redundant marketing pages** into one clear product story.
11. **Approve-a-fix loop** from Moments (wire the existing backend approval to the daily surface).
12. **Help Center / knowledge base** for customers; onboarding email sequence.

### 🟢 Nice for v1.1
13. Agency portfolio/queues/approvals UI.
14. Enterprise org/location/rollout UI.
15. Marketplace browse/install UI.
16. Walkthrough videos; richer tooltips; design-token system for the new UIs.

---

## Final Questions (answered honestly)

- **Would they understand it?** Inside the app, mostly yes — it's calm and plain. *Before* the app, no — they never learn what it is.
- **Would they trust it?** Yes — the copy and approval model earn trust better than almost any competitor. The one dilution is the agency-vs-product framing.
- **Would they enjoy using it?** The daily-calm loop is genuinely enjoyable *if* Moments lead and first-run is guided. Today it's a bit of a hunt.
- **Would they feel overwhelmed?** Not by the app's tone — but by the *breadth* if Marketplace/Enterprise/Agency are visible. Hide them.
- **What should be removed?** Marketplace/Enterprise/Agency from the customer UI; redundant marketing pages; the "api/dashboard" words.
- **What should be simplified?** The front door and the name; the Monitor→Migration story into one flow.
- **What would make it feel premium?** Staging the Moments experience as the calm centerpiece, a guided first-run with the "You're on the internet" celebration, and the ownership/export promise stated proudly up front.
- **The single biggest obstacle between Studio OS and an exceptional customer experience?** **The customer never meets the product.** The public site sells an agency, the name is ambiguous, and the signature experience (calm daily Moments) isn't staged as the hero. Fix positioning + the front door + stage the Moments, and the rest is polish on an already-strong app.

---

*Consolidate these items into `LAUNCH-BOARD.md` alongside the L5.8 blockers — the beta-critical set here (front door, "Today" home, guided first-run, state audit, in-context trust copy, hide advanced tiers) joins B2 on that board.*
