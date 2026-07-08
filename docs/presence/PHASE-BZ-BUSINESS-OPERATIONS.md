# Phase BZ — Business Operations & Launch Readiness

*Audits the business AROUND the product — customer success, sales, internal ops, BI, legal, marketing — with the public-site fence respected (every change here is internal docs or committed-unpushed pages; the live site is untouched). Consolidates the Business-Operations / Customer-Success / Sales-Readiness / Support-Readiness / Internal-Operations / Launch-Readiness audits.*

## Implemented this phase (V1, fence-safe)

1. **Platform legal completed (the real gap):** `terms.html` gained **§9 Studio OS Presence subscriptions** — billing & trials, the honest **refund policy** (cancel anytime, paid-through-period, no proration, "email us and a person will make it right"), the **60-day wind-down promise** (now a legal commitment matching Phase RL's code), content ownership, AI disclosure, fair use. `privacy.html` gained the **Studio OS accounts** section — what we hold, the full **sub-processor list** (Supabase/Netlify/Stripe/Resend/Anthropic with the no-training note), the no-cookies story, deletion rights. Both committed-unpushed; they go live with the push.
2. **Clickwrap at signup:** "By creating your account you agree to the Terms of Service and Privacy Policy" — links under the button. Closes the no-acceptance gap (previously zero references).
3. **[SUPPORT-PLAYBOOK](SUPPORT-PLAYBOOK.md)** (internal): SLAs mirroring `commerce/support.ts`, the triage flow, top-10 canned answers in the product's voice, escalation paths, offboarding script. A second person could run support tomorrow with this + the Customer Guide.
4. **Eric's weekly 15-minute routine** (below) — the honest V1 answer to "will Eric know when something needs attention."

## Audit verdicts (verified)

**Customer success — strong, mostly product-shaped:** guided onboarding ✅ (Phase I), welcome + verify emails ✅, in-product Help ✅ (help.html incl. plans/reliability), Customer Guide ✅, lifecycle comms ✅ (RL), calm cancellation/reactivation ✅. *Can a customer always find help / self-solve?* Yes for everything everyday; the support inbox is the catch-all with published SLAs. Missing (queued): a public searchable KB beyond help.html (**FD-BZ1**, V1.1 — help.html covers V1 scale).

**Sales — self-serve works, persuasion is thin (known):** *Could someone buy without talking to Eric?* **Mechanically yes, end-to-end** (pricing → signup → trial/checkout → provisioned, live-verified in activation). What's thin is pre-purchase *persuasion*: no demo, no walkthrough video, no screenshots, no sales deck — all Phase-H/marketing territory, all fenced until you say go (**FD-BZ2**: interactive demo account with seeded data · **FD-BZ3**: sales one-pager/deck from the editions+support matrices — both V1.1/launch-week). Licensing/agreements: self-serve terms now ✅; Agency Agreement + Enterprise MSA remain **only needed when those tiers sell** (already tracked V4 on the launch board).

**Internal ops — documented to survive a bus:** deployment/ops/runbooks/API/DB/env docs ✅ (the V1 freeze), owner-setup runbooks ✅, activation report ✅, now the support playbook ✅. *Could another employee operate it tomorrow?* Operate + support: **yes** (docs hub → playbook → runbooks). Engineer it: yes with the V1 System Reference. The honest bus-factor residue: Eric holds the account credentials (normal for a solo business).

**Business intelligence — right-sized for V1:** revenue/churn/subscriptions = **Stripe's dashboard** (don't rebuild it); platform health = `/system/health` + the cross-region watchdog emailing ops ✅; failures 24h counter ✅; customer health = CRM per-client sentences (Law 13 — no dashboards, deliberately). *Will Eric know?* Push-based for failures (watchdog + ops alerts), pull-based weekly for trends (routine below). A weekly owner digest email = **FD-5/FD-BZ4** (V1.1, the automation of the routine).

**Legal — closed for launch:** subscription terms ✅ refunds ✅ wind-down ✅ privacy+sub-processors ✅ clickwrap ✅ customer-site legal pages ✅ (Phase Q) cookie story ✅ (none needed, stated). Remaining, correctly deferred: DPA + enterprise/agency agreements (when those buyers appear), and a lawyer's read-through of the terms before serious scale (**recommended, not launch-blocking** — they're plain-English and honest, but I'm an engineer, not your attorney).

**Marketing ops — deliberately behind the fence:** launch checklist ✅ (board + activation report), everything else (campaigns, case studies, referrals, testimonials) is post-"done" work by your explicit instruction. Queued, not built.

## Eric's weekly 15 minutes (Mondays)

1. **Stripe dashboard** (2 min): new subscriptions, failed payments, MRR direction.
2. **Leads inbox** across sites (2 min): anything unanswered > 2 days?
3. **`/system/health`** (1 min): capabilities all true, failures_last_24h = 0.
4. **Support inbox** (5 min): triage per the playbook.
5. **CRM pass** (5 min): any client whose health sentence changed — send one human note. Retention is a relationship, not a metric.

## Final questions (honest)

- **Could DDS support 100 paying customers tomorrow?** **Operationally yes** — the platform runs itself (cron, lifecycle, watchdog), support load at 100 calm-product customers ≈ a few emails/day against a playbook, and billing is fully automated. 
- **What would break first?** **Eric's calendar** — specifically Managed-tier fulfillment (white-glove onboarding is human hours; 10 Managed customers ≈ a real workweek) and pre-sales questions if marketing outruns the help content. Second: support volume if a browser bug ships — which is exactly why Phase K gates the push.
- **What operational work remains?** Only the launch-path items already tracked: K (browser QA), H (front door, fenced until you say done), the reminder list (Stripe key roll, drill, consent screen, PITR trigger), and a lawyer's pass at leisure.
- **What would I improve before launch?** Nothing new — this phase closed the last untracked gap (subscription legal + clickwrap). 
- **Would I launch the business today?** The *business machinery*: yes. The launch itself still correctly waits on K + H — same answer as the product certification, unchanged.

**Phase BZ — Business Operations & Launch Readiness complete.**
