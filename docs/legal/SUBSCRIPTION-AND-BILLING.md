# Subscription Terms, Founder Pricing & Refund/Cancellation

*Covers deliverables 19 (Subscription Terms), 20 (Founder Pricing Terms), and 21 (Refund & Cancellation Policy). Describes the billing architecture as implemented (`commerce/`); specific prices are shown at checkout and on the pricing page.*

---

## Part 1 — Subscription Terms

- **What you buy.** A recurring subscription to a Studio OS Presence edition. We **bill the site, not the seat**.
- **Billing cycle.** Monthly or annual, as you choose at checkout. Your subscription **renews automatically** at the then-current term price until you cancel.
- **Payment.** Processed securely by **Stripe**. We do not store your card details.
- **No metered or overage fees — ever.** Generous plan limits apply to generative AI; exceeding them raises a calm in-app notice and never a surprise charge or a hard block.
- **Trials.** Where a plan is trial-eligible, your trial runs until the stated date; you're charged only after it ends unless you cancel first.
- **Upgrades.** Take effect immediately and are **prorated** for the remainder of the current cycle.
- **Downgrades / plan changes.** Take effect at the end of the current cycle; your data is preserved across changes.
- **Taxes.** Prices exclude taxes unless stated; applicable taxes are added at checkout. **[[OWNER: confirm tax handling.]]**

## Part 2 — Founder Pricing Terms

- While the founders cohort is open, self-serve signups receive the **founder rate**.
- **The founder rate is a permanent lock**: as long as your subscription remains active, your locked rate persists even after the cohort closes or standard prices rise.
- The lock is tied to your continuously-active subscription. **[[OWNER: state what happens on lapse/re-signup — recommended: the lock survives a grace-period reactivation but a fully lapsed/cancelled account re-subscribes at current rates.]]**
- Founder pricing is an introductory offer we may open or close at our discretion; existing founders keep their locked rate.

## Part 3 — Refund & Cancellation Policy

- **Cancel any time.** Cancellation stops future renewals; your plan remains active until the end of the paid period, then moves to a **grace period** with **read-only access and full export preserved**, so you never lose your work or your ability to leave with your data.
- **Refunds.** Subscriptions are billed in advance; we do not automatically prorate refunds for partial periods. Trials let you evaluate before paying. If you believe you were charged in error or have a billing problem, contact **[[OWNER: billing@…]]** — we handle refund requests fairly and per applicable consumer law. **[[OWNER: set your refund stance (e.g. 14-day money-back on first purchase) and confirm with counsel; the software does not auto-refund, so state the manual process.]]**
- **After cancellation.** Export your data at any time during the grace period; see [Data Retention](DATA-RETENTION-POLICY.md) and [Account Deletion](ACCOUNT-DELETION-POLICY.md).
- **Failed payments.** If a renewal fails, we retry and notify you; access continues briefly, then moves to read-only + export (a grace model), never immediate data loss.
