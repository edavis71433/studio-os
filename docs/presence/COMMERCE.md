# Self-Serve Signup & Commerce — L1

The front door. A stranger can discover Studio OS, choose a plan, create an account, and arrive in their Presence Room — with no operator in the loop. Built entirely on what already existed: the frozen entitlement gate, the ownership chain, the one provisioning shape, and the single Stripe payment-truth webhook. Nothing frozen was touched; every piece is additive.

Governed by the **Commercial Constitution** (`docs/presence/constitution/02-commercial-constitution.md`). Where that document says what is sold and on what terms, this one says how it was wired.

## The commercial ladder (`commerce/catalog.ts`)

Five rungs, as pure data. Only the first three are self-serve; Agency and Enterprise are a conversation with our team (constitution §3.10 wholesale, §3.11 never-self-serve).

| Rung | Edition | Self-serve | Trial | Founder / list (mo) |
|---|---|---|---|---|
| Presence Monitor | monitor | ✓ | ✓ | $15 / $19 |
| Presence | presence | ✓ | ✓ | $39 / $49 |
| Presence Managed | presence | ✓ | — | $119 / $149 |
| Agency | presence | — (contact) | — | — |
| Enterprise | presence | — (contact) | — | — |

- **Bill the site, not the seat** (§3.1). One active entitlement = one live site.
- **Monthly or annual**; annual charges 10 months (two free). **No metered fees, ever** (Law 20).
- **Founders = a permanent rate lock** (§3.3), a boolean on the entitlement — never a feature fork. `FOUNDERS_OPEN` (in `catalog.ts`) gates whether new signups earn it.
- Prices live in ONE place (`catalog.ts`); the constitution deliberately fixed the architecture and left the numbers to launch. **These founder-era numbers are proposed defaults — confirm before opening the doors.**
- Upgrades are instant + prorated; downgrades take effect at renewal, never mid-cycle, never with data loss (§3.6–3.7). `evaluateChange()` encodes this.

## The schema (migration 0036 — additive only)

- **`presence_entitlements`** gains the plan dimension + billing linkage: `plan` (5-value CHECK, default `presence`), `term`, `founder`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`, `cancel_at_period_end`, `canceled_at`. The existing `status` CHECK (`active`/`paused`/`lapsed`) is untouched — billing drives those three states; no new status was needed.
- **`presence_signups`** — the funnel + provisioning idempotency key (deny-all RLS; service-role only). A signup always resolves the same client and site, so provisioning is safe to retry.
- **`presence_first_run`** — per-site welcome state (client-readable). The checklist items are *derived* from live state; this row only records dismissal + arrival.

## Signup → account → provision (`routes/commerce.ts`, `commerce/*`)

`/commerce/*` is a public-safe bounded context, handled (like `/agency`) **before** the client/staff 401 so a stranger can reach it. The authed routes inside enforce their own sign-in.

1. **`POST /commerce/signup`** validates, refuses a duplicate email (409 → "sign in"), then builds the ownership chain the whole platform resolves through: `auth.users` → `contacts(auth_user_id)` → `clients` (`commerce/account.ts`, each step rolls back the prior on failure).
2. **Trial** (Monitor/Presence, no card, §3.4): provisions immediately and lands the customer in their room.
   **Paid**: creates a Stripe subscription Checkout session (inline `price_data`, so no pre-made Stripe prices are needed) and hands off; provisioning happens on the webhook when payment lands.
3. **`commerce/provision.ts`** is idempotent end to end: entitlement upsert (plan + billing) → site get-or-create with the right **edition** (Monitor hosts nothing; Presence provisions Netlify via the same lib the operator path uses) → seed identity + brand profile + first-run → status `ready` → one provenance event.
4. A best-effort branded email (Resend) confirms the address (`/commerce/verify`) — non-blocking; the account works immediately.

## Billing → entitlement (the money path)

The `stripe-webhook` stays the single source of **payment** truth: it verifies Stripe's signature, then delegates the business action to a secret-gated system route, `POST /commerce/billing-sync` (where every secret and the provisioner already live). This keeps provisioning in exactly one place.

- **`checkout.session.completed`** (subscription) → provision + activate.
- **`customer.subscription.created/updated/deleted`** → `entitlementPatchFromSubscription()` maps Stripe state onto the lifecycle ladder (§3.5) and syncs the entitlement:
  - active / trialing → **active**
  - past_due / unpaid → **active + a ~14-day grace clock** (full room, live site, a gentle banner — not a lockout)
  - paused → **paused** (voluntary hold, read-only)
  - canceled / expired → **lapsed** (read-only + export)
  - `cancel_at_period_end` stays active until the period ends, then lapses.

The mapping is pure (`commerce/subscriptions.ts`) and exhaustively unit-tested. A malformed metadata blob never corrupts a known-good plan.

## Managing a subscription

- **`GET /commerce/subscription`** — the caller's plan, status, term, renewal, trial/grace flags.
- **`POST /commerce/portal`** — a Stripe Billing Portal session (update card, cancel, change plan) for paid subscribers.
- **`GET /commerce/first-run`** / **`POST /commerce/first-run/dismiss`** — the derived welcome checklist and its dismissal, surfaced calmly at the top of the room's Today view.

## Enforcement (unchanged)

Everything still funnels through the one frozen gate: `middleware/entitlement.ts` reads `presence_entitlements.status` at the boundary (`active`→full, `paused`→read-only, `lapsed`/none→denied). Billing now *drives* that status; the gate itself was not modified.

## Customer-facing pages

`pricing.html` (the catalog + monthly/annual toggle + founder band), `signup.html` (account + plan summary → trial or Stripe), `welcome.html` (post-checkout confirmation + email verify). All match the existing site identity (Fraunces/Inter, purple, cream), default to prod, and support `?env=staging`.

## Tests

`tests/presence/commerce_test.mjs` — 36 pure checks (ladder integrity, founder + annual pricing math, edition mapping, upgrade/downgrade rules, every Stripe status → entitlement mapping, trial patch) + 14 staging-integration checks (public catalog, trial signup → immediate provision, funnel + entitlement + Monitor site + seeded rows, duplicate refusal, email verify, sign-in, authed subscription + first-run reads, billing-sync subscription lifecycle, and the billing-sync secret gate). Teardown leaves the environment clean.

## Rollout & the go-live gate

Applied and deployed to **staging and production**: migration 0036, the `presence` and `stripe-webhook` functions (`--no-verify-jwt`), and a project-wide `BILLING_SYNC_SECRET` (wires the webhook → billing-sync on both sides, independent of `SCHEDULER_SECRET`).

**Before opening the doors to real customers, these are the human steps only you can do:**

1. **Confirm the prices** in `commerce/catalog.ts` (the founder/list numbers above are proposed defaults).
2. **Register the subscription events** on the production Stripe webhook endpoint: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (`checkout.session.completed` is already registered).
3. **Confirm `STRIPE_SECRET`** on production is the intended mode (test vs live).
4. **Add navigation links** to `pricing.html` from the marketing site, and `git push` to publish the pages — that is the switch that makes the flow publicly discoverable and purchasable.
