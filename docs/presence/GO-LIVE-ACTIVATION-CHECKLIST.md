# Go-live activation checklist (owner)

Everything below is done in external dashboards with your accounts — I can't do these, but here are the exact steps/values so there's no guessing. Backend is already current on prod (both functions + all migrations). Do these, then `git push`.

Prod project ref: **`qksstlqzbhesadrrofgn`**

---

## 1. Stripe — go live
**In the Stripe Dashboard (toggle to Live mode, top-right):**
1. **Developers → Webhooks → Add endpoint.**
   - Endpoint URL: **`https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/stripe-webhook`**
   - Select exactly these events (what the function handles):
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
   - After creating it, copy the **Signing secret** (`whsec_…`).
2. **Developers → API keys** → copy your **live Secret key** (`sk_live_…`).

**In Supabase (prod project → Project Settings → Edge Functions → Secrets), set:**
| Secret | Value |
|---|---|
| `STRIPE_SECRET` (and `STRIPE_SECRET_KEY` if present) | your `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` from step 1 |
| `STRIPE_EXPECT_LIVEMODE` | `true`  ← **the live-mode guard; without this the webhook rejects live events** |

**Verify:** Stripe → your webhook → **Send test webhook** (`checkout.session.completed`) → it should show **200**. Then do one real small test purchase and confirm it appears.

## 2. Resend — verify sending domain
1. Resend dashboard → **Domains → Add** `davisdigitalstudio.com`.
2. Add the **SPF / DKIM / DMARC** DNS records Resend gives you at your domain registrar; wait for "Verified."
3. In Supabase secrets, confirm **`RESEND_KEY`** is set to your Resend API key.
- This also unlocks the deferred weekly-digest feature later. (Sender is `EMAIL_FROM`, reply-to `eric@davisdigitalstudio.com`.)

## 3. Google OAuth — consent + redirect URIs
For connected services (Google Business, Analytics, etc.):
1. Google Cloud Console → **APIs & Services → OAuth consent screen** → publish (move from "Testing" to "In production").
2. **Credentials → your OAuth client → Authorized redirect URIs** → add the connections callback:
   - `https://davisdigitalstudio.com/connections-callback.html` (and the localhost equivalent if you test locally).
3. Also confirm Supabase Auth's own redirect/allowed URLs include your prod site (Supabase → Authentication → URL Configuration).

## 4. PITR — point-in-time recovery
Supabase → prod project → **Database → Point-in-Time Recovery → Enable** (it's a paid add-on; turn it on before real customers so you can restore to any second).

## 5. Confirm the other prod secrets exist
Already used by the platform — make sure they're set on prod (most already are from earlier): `SCHEDULER_SECRET`, `BILLING_SYNC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. (Don't rotate `SCHEDULER_SECRET`.)

---

## 6. Lift the fence — go live (YOUR trigger)
When 1–5 are done and you're ready:
```
git push
```
That publishes davisdigitalstudio.com **and** the app together (they're one deployment). That's go-live for the controlled beta. I will not run this — it's yours to pull.

## Quick verify after push
- Sign in to the live app with your real account → Today loads.
- One live test purchase → webhook 200 → entitlement appears.
- A test enquiry from the public site → shows in Website enquiries → "→ Deal" works.
