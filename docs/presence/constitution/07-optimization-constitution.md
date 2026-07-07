# The Optimization Promotion Constitution
**L3.A · Constitutional milestone · How optimization evidence is allowed to become customer-facing**

**Status: DRAFTED — pending owner ratification.**
Amends: adds **Law 24** to `02-commercial-constitution.md` Part 11 (Product Laws). Builds on `05-presence-intelligence-constitution.md` (the frozen Evidence → Judgment → Recommendation → Moments chain) and `docs/presence/L3-PROMOTION-AUDIT.md`. Governs L3.1 (Optimization Judgment Depth) and every future optimization provider. Changes no code; everything frozen stands verbatim.

*This document governs a single question: **once the Optimization Engine has observed something, who — if anyone — is allowed to be told?** The engine already observes everything (L3, 28 providers). This is the law for what the customer is ever asked to care about.*

---

## PART 1 — THE OPTIMIZATION PHILOSOPHY

Studio OS owns most of the customer's digital presence — the renderer, the templates, the hosting, the deploy pipeline, the schema, the accessibility scaffolding. A traditional audit tool owns none of that, so all it can do is *hand the owner a list*. We can do the opposite.

**The philosophy, in four sentences:**

1. **Observe everything.** The engine misses nothing — that is its job and it is already true.
2. **Quietly fix everything we legitimately own.** If the fix lives in our template, renderer, or hosting, we make it correct once, for every site, and no one is ever told there was a problem.
3. **Interrupt the customer only when human knowledge, judgment, approval, or a business decision is genuinely required** — the things no platform can supply because they live in the owner's head and their business.
4. **Optimization must reduce customer thinking, not increase it.** Every promoted observation must leave the customer with *less* to hold in mind, never more. A recommendation that adds a chore has failed, even if it is correct.

The measure of this engine is not how much it surfaces. It is **how little the customer is ever asked to care about** — because everything else was already handled.

---

## PART 2 — THE OWNERSHIP TEST (asked first, always)

Before audience, before severity, before anything: **who owns this problem?** Audience may only be chosen after ownership is known. Five owners:

| Owner | What they hold | Example |
|---|---|---|
| **The platform** | The template, renderer, hosting, schema, deploy — everything we produce | Missing canonical tag; uncompressed response; invalid JSON-LD |
| **The customer (as a person)** | Decisions and preferences only they can make | Whether to add online ordering; which story to tell |
| **The customer's business** | Facts only the business holds | Hours; prices; the real menu; holiday closures |
| **An operator (the studio)** | Per-site human actions behind the scenes | Renewing a domain; responding to an outage |
| **An external provider** | Systems we don't run | The customer's existing Wix host (Monitor); Google Business Profile |

### The Ownership Matrix

| Ownership answer | Can we fix it without asking? | Default class (Part 4) |
|---|---|---|
| Platform, no consent needed | Yes | **Silent Platform Improvement** |
| Platform, but it's an infrastructure change | Yes, *after approval* | **Guided Fix (approval-gated)** |
| Customer, a decision | No — only they can decide | **Customer Decision** |
| Customer's business, a fact | No — only they know it | **Business Knowledge Required** |
| Operator | No — a human at the studio acts | **Operator Only** |
| External provider (their site) | No — we may only observe | **Monitor Only** |
| External provider (a service not yet integrated) | No — the feature doesn't exist | **Dormant Until Feature Exists** |

> **Guided Fix** is a genuinely necessary class the audit implied but did not name. The platform *can and will* do the work (add the SPF/DMARC/CAA record, connect the domain), but the frozen infrastructure law — *never destructive without explicit approval; every change an approved plan* (M12/M14) — means it cannot be silent. It is not customer *work*; it is customer *consent*. Distinct from Silent (no consent) and from Customer Decision (the customer does the labor).

---

## PART 3 — THE INTERRUPTION TEST (asked second)

For every observation that ownership did **not** route to silence or the operator, one question decides promotion:

> **Should the customer ever know this exists? If yes — why? If no — why not?**

The decision must be *recorded*, per observation, in the provider's classification. "No" is the default and needs no defense beyond "we own it / it's dormant / it's not severe enough to earn the interruption." "Yes" must name (a) the customer's job-to-be-done, and (b) the reason today. If you cannot name both, the answer is No.

### The Promotion Decision Tree

```
Observe (evidence emitted — always)
│
├─ Can the PLATFORM fix it with no consent?
│     └─ YES → Silent Platform Improvement.  Fix once in template/renderer/hosting.  Tell no one.  ■
│
├─ Can the platform fix it, but it needs APPROVAL (infrastructure)?
│     └─ YES → Guided Fix.  Prepare the exact approved plan; the customer approves; we apply.  ■
│
├─ Does an OPERATOR need to act (per-site, human)?
│     └─ YES → Operator Only.  Studio surface.  Customer never alarmed.  ■
│
├─ Is it about an EXTERNAL site/service?
│     ├─ The customer's own external site (Monitor)      → Monitor Only (migration evidence).  ■
│     └─ A service we don't integrate yet                → Dormant.  Emit; surface nothing.  ■
│
├─ Does it need CUSTOMER knowledge or a CUSTOMER decision?
│     └─ YES → Interruption Test:
│              ├─ Is it severe enough OR part of a job worth doing now?   (else → suppress)
│              ├─ Can it be BUNDLED with kin into one job-shaped Moment?  (always prefer)
│              └─ Promote as ONE calm Business Moment — in their words, no score.  ■
│
└─ Is it a positive COMPLETION the customer earned or the platform achieved?
      └─ YES → Celebration (Part 6).  ■

Default at every unmatched branch: SILENCE.
```

---

## PART 4 — THE OBSERVATION CLASSIFICATION SYSTEM

**Every optimization observation belongs to exactly one class.** The class is declared by the provider and is the contract for how (and whether) the observation may ever reach a customer.

| # | Class | Definition | Customer sees it? |
|---|---|---|---|
| 1 | **Silent Platform Improvement** | We own the fix end-to-end (template/renderer/hosting); fixed once, globally. | Never — not the problem, not the fix. |
| 2 | **Guided Fix (approval-gated)** | We do the work, but an infrastructure change needs explicit approval. | Only as a calm, plain-language plan to approve. |
| 3 | **Customer Decision** | A choice only the customer can make (a preference, a direction, connecting a profile). | Yes, as a gentle option — never a demand. |
| 4 | **Business Knowledge Required** | A fact only the business holds (hours, prices, menu, closures). | Yes, bundled into "let's complete your details." |
| 5 | **Operator Only** | A per-site human action by the studio, behind the scenes. | Never. |
| 6 | **Monitor Only** | Meaningful only for an observed external site we don't control. | Yes on Monitor, as migration evidence; silent elsewhere. |
| 7 | **Edition Dependent** | Audience genuinely changes by edition (see Part 5). | Depends on edition. |
| 8 | **Celebration** | A positive completion worth marking. | Yes — rarely, warmly, asking nothing. |
| 9 | **Dormant Until Feature Exists** | Awaiting an integration that hasn't shipped. | Never, until the feature ships — then a single prompt. |

*(Classes 6 and 7 overlap by design: "Monitor Only" is the common special case of "Edition Dependent." Kept separate because it is the one every migration-era provider will reach for.)*

**Applying it to today's ~90 observations** (illustrative, not exhaustive — the full per-type map is in `L3-PROMOTION-AUDIT.md`):
- **Silent (1):** all `structured_data.*`, `seo.canonical/robots/sitemap/twitter/og/favicon`, template `accessibility.*` (lang, landmark, heading, form label, table, tabindex, aria), `performance.compression/cache/cdn/lazy/fonts/blocking/dimensions`.
- **Guided (2):** `infrastructure.spf/dmarc/caa_missing`, domain connect, `http_not_redirected` (on our hosting).
- **Customer Decision (3):** `conversion.booking/ordering_missing`, `content.cta_missing`.
- **Business Knowledge (4):** `business_info.*`, `knowledge.*` mismatches, `trust.contact_missing`, `reviews.testimonials_none`.
- **Operator Only (5):** `website.*`, `trust.ssl/security_header`, `infrastructure.dns_*` (Presence), `domain_expiring`.
- **Monitor Only (6):** the Silent set *inverts here* — on Monitor we can't fix their HTML, so `seo.*`, template `accessibility.*`, `performance.*` become honest migration evidence.
- **Dormant (9):** `analytics.not_connected`, `local_presence.profile/apple_unconnected`, `reviews.source_unconnected`.
- **Severe-gated Customer (4/3 + gate):** `freshness.*`, `content.thin/reading_hard`, `performance.image_oversized`, `reviews.velocity_slowing`.

---

## PART 5 — EDITION BEHAVIOR

**The same evidence; a different audience. Editions change who is told, never what was observed.** This is the cleanest proof that promotion is a policy layer, not a change to the engine.

### The Edition Matrix

Take one observation — *a page has a missing/weak title (`seo.title_*`)* — and one infrastructure observation — *no DMARC (`infrastructure.dmarc_missing`)*:

| Edition | `seo.title_*` (we render the title) | `infrastructure.dmarc_missing` |
|---|---|---|
| **Presence Monitor** | **Customer evidence.** It's *their* external site; we can't fix it. Shown gently as a migration signal: "bringing this here would fix this for you." | Same — shown as a reason the foundations are safer with us. |
| **Presence** | **Silent.** Our template owns titles; we make them correct. The customer never hears about it. | **Guided Fix.** We prepare the DMARC record; the customer approves; we apply. |
| **Presence Managed** | **Silent — and the concierge has already handled it.** Not even a plan to approve; it's part of the white-glove care. | **Silent to the customer;** the concierge approves and applies on their behalf, within the engagement. |
| **Presence Agency** | **Silent for the client; visible to the agency** as a fleet-health signal in their dashboard — one line, not a per-client alarm. | Same — agency-level foundations posture across the fleet. |
| **Presence Enterprise** | **Silent for locations;** rolls into brand governance + the provenance/audit trail (who fixed what, when). | Same — governed, logged, never a per-location interruption. |

**The rule:** as you climb the ladder, the customer is interrupted *less*, not more — because more is owned and handled on their behalf. Monitor is the one edition where these flip *toward* the customer, precisely because we don't yet own their site. That asymmetry is the product's gravity: it pulls toward "let us hold this for you."

---

## PART 6 — CELEBRATION (why it is not notification)

Positive events may become Business Moments. This is not the same act as surfacing a problem, and conflating them corrupts both.

**A notification is about a gap** — something wrong or incomplete. It points forward to *work*. It asks something of the customer. Even gently worded, it is a small debit against their attention.

**A celebration is about a completion** — something achieved. It points backward at *effort that paid off*. It asks nothing. It is a credit: the emotional payoff that makes calm software feel *rewarding* rather than merely quiet. Software that only ever whispers problems, however politely, still feels like a nagging conscience. A celebration closes a loop the customer opened.

**When a positive event earns a Moment:**
- **Launch complete** — the site is live, verified, answering over HTTPS.
- **Domain connected** — the address they chose now points home.
- **Business profile completed** — the details they filled in are whole.
- **Milestone reached** — a hundredth published update; a year live.
- **Major improvement achieved** — a slow site is now fast; a run of fresh testimonials arrives.
- **Customer effort completed** — they finished the thing a Moment (or the first-run checklist) suggested.

**The laws of celebration:**
1. **It must be true and earned** — never manufactured, never a participation trophy. A false celebration is worse than silence; it teaches the customer to distrust the warm ones.
2. **It must be rare** — scarcity is what makes it land. If everything is celebrated, nothing is.
3. **It asks for nothing** — no upsell rides on it, no "and now you should…". (A capacity/plan nudge is a *separate*, later, clearly-commercial Moment — never dressed as a celebration.)
4. **It is often the completion of a Silent fix made visible** — the one time we may mention what we quietly did, because now it's good news, not a chore: "your site's a good deal faster this week."

---

## PART 7 — DEFAULT SILENCE (the constitutional default)

**Silence is the default state of every observation.** An observation remains internal — emitted to Evidence, suppressed at Judgment — *unless it clearly satisfies every promotion requirement below.* The Foundation shipped everything suppressed on purpose; that is the safe place to promote *from*, deliberately, a few rules at a time.

**Requirements for promotion (all must hold):**
1. **Ownership is customer or customer-business** (Part 2) — the platform genuinely cannot own the fix. *(Guided Fixes promote only as approvable plans; Operator/Dormant/Silent never promote to the customer.)*
2. **It survives the platform's own fix** — you have first asked "should we just fix this for everyone?" and the honest answer is no.
3. **It names a job-to-be-done and a reason today** (the Interruption Test) — both, in the customer's words.
4. **It is severe enough or bundled** — it clears the noise floor, or it joins kin into one Moment.
5. **It reduces net thinking** — after the Moment, the customer holds *less*, not more.
6. **It carries no score, count, grade, or jargon** (Law 13, 16) — health is a sentence.
7. **It is edition-appropriate** (Part 5) — the audience was chosen after ownership and edition.

Fail any requirement → stay silent. Silence never has to justify itself; **promotion always does.**

---

## PART 8 — THE ENGINEERING CONTRACT

**No optimization provider may ship until it answers all seven questions, in code, as a declared classification.** This is the gate; a provider without answers does not run.

1. **Who owns this?** (platform / customer / business / operator / external)
2. **Can Studio OS fix it?** (silently / with approval / not at all)
3. **Should the customer ever know?** (yes → why; no → why not)
4. **Does it belong in Monitor?** (is it migration evidence for an external site?)
5. **Does it belong in Presence?** (or is it silent because we own the fix there?)
6. **Should it become a Moment?** (and if so, which job-to-be-done does it bundle into?)
7. **Should it remain silent forever?** (many should — say so, on purpose)

### The Engineering Checklist (per provider, per observation)

- [ ] Ownership declared (one of five owners).
- [ ] Classification declared (exactly one of the nine classes).
- [ ] Interruption decision recorded ("customer sees it: yes/no", with the reason).
- [ ] Edition behavior specified for all five editions (default: inherit the class's rule).
- [ ] If promotable: the job-to-be-done and bundle it joins are named.
- [ ] If Silent/Guided: the platform fix (template/renderer/hosting/plan) is identified or filed.
- [ ] No score/count/grade/jargon in any customer-facing string.
- [ ] Default is silence unless Part 7's requirements are met.

---

## PART 9 — PRODUCT LAW AMENDMENT

### Amendment 3 — Law 24 (adds to `02-commercial-constitution.md` Part 11)

> **Law 24. The platform silently fixes everything it legitimately owns before asking the customer to do anything.**
> Optimization observations the platform can correct in its own template, renderer, or hosting are corrected once, for every site, and surfaced to no one. The customer is interrupted only for what genuinely requires their knowledge, judgment, approval, or a business decision. Silence is the default; promotion must earn itself.

**Why this law exists.** The Optimization Engine can see roughly ninety kinds of problem. Without this law, "observe everything" degrades into "tell the customer everything" — the exact failure mode of every audit tool. The law fixes the audience *at the point of ownership*: if the fix is ours, the telling never happens. It converts the engine's completeness from a source of anxiety into a source of quiet.

**How it protects calm software.** Calm is not achieved by wording problems gently; it is achieved by *not creating the problem for the customer in the first place* (Laws 15, 19). This law makes silence structural rather than a matter of tone. Two-thirds of what a naive engine would surface simply never reaches the customer, because we fixed it. What remains is short, human, and worth their attention — which is the only way attention stays worth asking for.

**How it differentiates Studio OS from traditional SEO / audit platforms.** Those platforms sell the *list*: a score, a hundred red items, and the maintenance burden of chasing them — the customer does the labor, forever. Studio OS sells the *destination*: the site is correct because we keep it correct, and the customer is asked only for the handful of things that are truly theirs. WordPress-plus-plugins hands you the engine and the chores; the audit tools hand you the report card. We hand you the outcome and keep the burden. Law 24 is the sentence that makes that promise enforceable rather than aspirational.

---

## PART 10 — FUTURE PROVIDER RULES

Binding on every optimization provider added after this constitution:

1. **Ownership before audience.** Run the Ownership Test first; choose audience only after.
2. **Default to silence.** A new provider surfaces nothing to customers until it satisfies Part 7. Shipping suppressed is normal and correct.
3. **Fix-first.** Before writing any customer-facing rule, ask whether the platform should just fix it for every site. Prefer the engineering fix — it is the calmer product and it scales.
4. **Declare a class.** Exactly one of the nine. The class is the contract.
5. **Answer the seven questions** (Part 8) in code before the provider runs.
6. **Be edition-aware.** Read `edition`; the same evidence may be silent on Presence and customer-facing on Monitor.
7. **Emit only evidence** (unchanged from L3). Providers never judge, rank, summarize, or write customer copy; promotion happens in Judgment, under this constitution.
8. **Bundle by job, not by taxonomy.** If it must reach a customer, it joins a job-shaped Moment; it never becomes its own notification.
9. **Never a score.** No grades, counts, percentages, or gamification, ever (Law 13).
10. **Celebrate sparingly and truthfully** (Part 6) — and never disguise a request as one.

---

## FINAL REVIEW

- **Would this philosophy still make sense ten years from now?** **Yes.** It is anchored to *ownership*, not to any SEO tactic, ranking factor, or platform of the day. Titles, Core Web Vitals, and schema will all change; "fix what you own, ask only for what needs human knowledge" will not.
- **Does it reduce customer cognitive load?** **Yes** — by construction. Silence is the default; the platform absorbs the majority of the list; what remains is bundled into a few job-shaped Moments that leave the customer holding less.
- **Does it strengthen customer ownership?** **Yes.** The platform does the *labor* while the customer keeps the *decisions*, their content, and their domain — and Monitor's asymmetry actively pulls value toward "let us hold this for you," which is ownership offered, never seized.
- **Does it make Studio OS more differentiated?** **Yes.** It inverts the entire audit-tool category: report cards become invisible maintenance. That is a moat competitors without the pipeline cannot cross.
- **Does it preserve Calm Software?** **Yes** — it makes calm *constitutional* (Law 24) rather than a matter of tone, and it hands L3.1 a decision procedure that defaults to silence.

**L3.A Optimization Promotion Constitution complete.**
