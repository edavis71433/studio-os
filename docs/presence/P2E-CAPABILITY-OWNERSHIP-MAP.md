# P2-E — Billing Capability & Ownership Map + Audit (mandatory first step)

**Date 2026-07-10.** Evidence-grounded inventory of the EXISTING billing/Stripe/entitlement/usage/lifecycle stack, its ownership under the frozen Agency–Client Bridge, and the concrete defects/gaps — the gate before any P2-E code. Method: four parallel adversarial reviews (Stripe core · entitlements+AI usage · account lifecycle · ownership map + general health), file:line-grounded. This doc is both the required capability/ownership map and the requested deep audit — no separate planning doc.

## Headline
The billing **architecture is sound and reuse-first-ready.** ONE signature-verified webhook (`stripe-webhook`) is the payment-truth authority; it flips invoices/audit-orders directly and delegates subscription→entitlement provisioning to a secret-gated `POST /commerce/billing-sync`. SaaS vs service billing are cleanly separated by `mode`/`metadata`. Entitlements are deny-all RLS, always keyed to the customer (`client_id`), and gated outside RLS. **Ownership map: 0 frozen-boundary violations.** So P2-E is genuinely *validate/harden/complete* — the work concentrates in **AI cost control**, **account-deletion execution**, and **lapse wind-down**, plus a handful of medium/low fixes.

## Ownership map (frozen boundary — COMPLIANT)
| Record | Authoritative owner | Keyed at | Boundary |
|---|---|---|---|
| Stripe customer id | **Customer workspace** | `presence_entitlements.stripe_customer_id` (client_id→clients) `0036:41` | ✅ |
| SaaS subscription | **Customer workspace** | `presence_entitlements.stripe_subscription_id` `0036:43`; written by `billing-sync` `commerce.ts:352` | ✅ |
| Price/plan rung | Platform catalog → stamped on customer | `presence_entitlements.plan` CHECK `0049:9`; inline `price_data` `commerce/stripe.ts:47` | ✅ |
| Checkout session (SaaS) | Customer funnel | `presence_signups.stripe_session_id` `0036:77` (deny-all RLS) | ✅ |
| Invoice (SaaS) | none — subscription-only; Stripe holds them, surfaced via Billing Portal | — | ✅ no duplicate invoice system |
| Invoice (service) | **Agency/Studio** | legacy `public.invoices` (client_id+agency_id) `0000:1148` | ✅ separate table, references not source |
| One-time payment (audit) | Platform | `public.audit_orders` `0000:419`; webhook `metadata.order_id` | ✅ |
| Entitlement | **Customer workspace** | `presence_entitlements` (client_id, `unique(client_id,product)`) `0015:425` | ✅ |
| AI usage ledger | Customer workspace | `presence_ai_usage`/`_events` (client_id+site_id) `0037:15`; SECURITY DEFINER RPC | ✅ |
| Billing history / receipt | Platform (ledger) | `public.stripe_payments` `0000:1702`; Stripe portal for receipts | ✅ ledger, not truth |
| Dunning notice | Customer workspace | `presence_plan_notices` (client_id+site_id) | ✅ |
| Webhook idempotency | Platform | `stripe_webhook_events(event_id)` `0000:1735` | ✅ (but see M1) |
| **Terms/consent (SaaS)** | **NOT RECORDED** | — | ❌ **gap (M4)** |

**Boundary scan:** subscription events → entitlement; `metadata.invoice_id` → invoices; `metadata.order_id` → audit orders — three disjoint branches, no crossover. Entitlements never keyed to the agency. Agency sees only coarse `status` of its OWN linked clients (`agency/routes.ts:48,93`) — matches "bridge authorizes visibility without transferring ownership." `/commerce/*` resolves the caller's own site (before agency drill-in), so an agency can't read another customer's billing.

## Capability inventory (classification)
**Reuse (production-ready):** Stripe helper (form-POST + Idempotency-Key) `commerce/stripe.ts:18` · plan catalog/founder/annual `catalog.ts` · subscription Checkout `stripe.ts:47` · Billing Portal `stripe.ts:76` · self-serve signup→trial|checkout `commerce.ts:65` · idempotent provisioning `provision.ts:55` · sub→entitlement mapping (pure, tested) `subscriptions.ts:70` · webhook signature verify `stripe-webhook:90` · entitlement STATUS gate `entitlement.ts:15` · edition FEATURE gate `feature.ts` · lifecycle sweep (trial-expiry/dunning/renewal/win-back) `lifecycle.ts` · AI usage ledger + RPC `0037` + `metering.ts` · trial (card-free) + expiry (the revenue bug **is** fixed, `lifecycle.ts:36`) · grace-on-lapse (read-only + export) · upgrade/downgrade re-provision · operator AI-usage view `/admin/ai-usage`.
**Needs hardening / complete:** webhook idempotency (M1) · Stripe customer reuse (L) · AI metering coverage + hard cost ceiling (H1/H2) · lapsed enforcement vs copy (M3) · notice dismiss-one (M2) · billing-sync failure logging (M5).
**Genuine defect / absent:** AI cost ceiling (H2) · Visual/concierge metering (H1) · account-deletion executor (H3) · lapse site takedown (H4) · Terms recording (M4).
**Duplicate / retire-after-parity:** clever-api `invoice_paylink` + `public_audit_checkout` (DDS studio/service commerce — fold into rebuilt studio commerce, then retire the duplicate Stripe helper).
**Defer:** seat limits, client limits, overage/prepaid packs (not sold that way yet); in-app receipts (Stripe portal covers it); `evaluateChange` in-app plan-change route (Stripe portal is the single authority today).

## Findings (ranked) — the P2-E work
**HIGH**
- **H1 — AI Visual Studio is completely unmetered (cost-invisible).** `routes/visual.ts` (generate/vary/edit → gpt-image-1, ~$0.04/img ×1–4) writes no usage; `presence_ai_usage` has no `images` column, so `/admin/ai-usage` reports image spend as **$0** structurally. `concierge/polish.ts` also bypasses metering. **Fix:** add `images` to the ledger + meter after each Visual op (all 3 paths) + meter concierge; add `visual:'generative'` to `AGENT_CLASS`.
- **H2 — No hard per-tenant cost ceiling; the cap is a soft dismissible notice that never stops a call.** `overCapacity` only raises a card (`metering.ts:69`); `writer`/`coach` never gate on capacity. **Fix:** before the model call, if usage exceeds a hard multiple/USD ceiling, return a friendly 429/upgrade-required; keep the soft notice below it.
- **H3 — Account deletion has no execution path.** `/commerce/delete-request` writes `deletion_requested_at` (`commerce.ts:418`) but **nothing reads it** — the 30-day promise is unmet; the only hard-delete is legacy clever-api `client_purge`. **Fix:** a `runDeletionSweep` (past the window) that revokes access + deletes hosted site/storage/tenant business rows while **retaining** entitlement/Stripe records for tax/audit; document the manual runbook until then. (No unsafe irreversible deletion exists — the risk is nothing deletes.)
- **H4 — Lapsed sites are never taken down.** `WIND_DOWN_DAYS=60` lives only in email copy (`lifecycle.ts:30,90`); no code unpublishes a lapsed site → it stays live forever (cost + a promise no code keeps). **Fix:** wind-down branch in the sweep — for `lapsed` older than 60d, unpublish/`deleteSite`, keep export reachable.

**MEDIUM**
- **M1 — Webhook idempotency is check-then-act, non-atomic, best-effort** (`stripe-webhook:187` SELECT → act → non-fatal INSERT `:212`). Safe today only via downstream constraints; a duplicate/retry can double-fire any non-idempotent side-effect and re-inserts a `stripe_payments` row (G4). **Fix:** atomic claim — INSERT `stripe_webhook_events` first with `ignore-duplicates,return=representation`; empty = duplicate → 200; add processed status so a failed run still retries.
- **M2 — "Dismiss one notice" dismisses ALL** (`commerce.ts:266` PATCHes all active for the client, no id). A capacity nudge dismissal silently clears a domain-expiry/renewal/deletion notice. **Fix:** accept `{id}`, scope `&id=eq.<id>`.
- **M3 — Lapsed = fully denied vs the documented/emailed "read-only + download anytime."** `entitlement.ts:24` denies all reads (only `/export` works), but the copy promises workspace access. **Fix:** make lapsed `readonly` (like paused), or point the emails straight at `/export`.
- **M4 — SaaS Terms acceptance is never recorded** (no `terms_version`/`accepted_at`/ip on `presence_signups`). Legal-evidence gap. **Fix:** capture it on the signup insert (`clientIp`/`hashIp` helpers exist).
- **M5 — billing-sync provisioning failures lose their reason** (no `console.error`; the webhook only reads status) — a paid customer stuck unprovisioned is undiagnosable. **Fix:** `console.error(prov.error)` in `handleBillingSync` before the 502.

**LOW**
- **L1** No Stripe customer reuse — every checkout mints a new customer (`stripe.ts:57` passes `customer_email`, never `customer`) → duplicate customers + orphaned history on re-subscribe. **Fix:** pass `customer=<existing id>` when present.
- **L2** Shared idempotency key collides when the signup row is missing (`'nosignup'` constant, `commerce.ts:150`) — two buyers can get the same cached Checkout session. **Fix:** `randomUUID()` fallback.
- **L3** No `event.livemode` guard — a test-mode secret misconfigured in prod would provision real workspaces. **Fix:** assert livemode in prod.
- **L4** `grace_until` is `date` but written as ISO timestamp (silent truncation); and past-due grace is never enforced (folded into `active` by design — confirm intent). 
- **L5** Reactivation "welcome-back" email isn't send-once (can double on concurrent events); `account_lapsed` email re-sends every month indefinitely. **Fix:** gate on freshly-inserted row / use `period='once'`.
- **L6** Dead import `evaluateChange` (no route); legacy clever-api Stripe helper (retire-after-parity).

## Recommended P2-E sequence (validate/harden/complete — no second billing system)
1. **AI cost control** (H1+H2+H3-metering): ledger `images` column + meter Visual/concierge + a real hard per-tenant ceiling. *Highest exposure (unbounded real dollars).*
2. **Account lifecycle completion** (H3 deletion executor + H4 wind-down takedown + M3 lapsed-readonly): make the written promises true, retain financial evidence.
3. **Webhook robustness** (M1 atomic idempotency + M5 logging + L1/L2/L3 Stripe hygiene).
4. **Compliance** (M4 Terms record + M2 notice-dismiss-one).
5. **Studio/Client billing surfaces + bridge-aware scoping** (already compliant; add the customer billing view where missing) + the 18-step lifecycle validation.
6. Retire the legacy clever-api one-time commerce after parity (P2-G-adjacent).

None of this reopens P2-D. Owner launch items (prod migrations, Stripe test-event/test-mode checks, fenced billing pages, push at fence-lift) stay tracked, not re-listed here.
