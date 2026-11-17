# Studio OS's Stripe key: a restricted one (sales item 131)

The Nov 15 2026 Stripe review found Studio OS using a full-power secret key, named
"Studio OS production" in Stripe. That key can refund payments, send payouts, read every
client's details and change settings. Studio OS needs far less, so it should hold a
restricted key that can do only what it uses.

Only Eric makes the key and puts it in place. Nobody else handles it, and it is never
written down anywhere else.

## What the key may do

Every other row in Stripe's form stays on **None**. This list is
`KEY_NEEDS` in `supabase/functions/presence/commerce/stripe_key.ts`, and
`tests/presence/stripe_key_131_test.mjs` checks the two say the same thing.

| Row in Stripe's form | Set to | What Studio OS uses it for |
|---|---|---|
| Prices | Write | make the price behind each invoice and retainer link |
| Products | Write | name what the price is for (Stripe makes the product with the price) |
| Payment Links | Write | make each invoice and retainer pay link, and switch one off when an invoice is withdrawn |
| Subscriptions | Write | cancel a retainer or a plan, and read one back |
| Customer Portal | Write | open Stripe’s page where a client manages a plan or puts in a new card |
| Checkout Sessions | Read | read back a payment page a client finished |
| Payment Intents | Read | find which invoice a payment, refund or dispute belongs to |
| Charges and Refunds | Read | read a payment, its refunds and which invoice it paid |
| Payment Disputes | Read | read a dispute, its deadline and how it ended |
| Invoices | Read | read each monthly retainer charge |
| Balance | Read | Stripe’s fee on each payment, for the bookkeeper file |
| Payouts | Read | the list of what Stripe sent to your bank, for the bookkeeper file |

What it must not be able to do, and so stays on None or Read: refund a payment
(Charges and Refunds), send money out (Payouts), charge a card (Payment Intents),
change a client's details (Customers), move the webhook (Webhook Endpoints, Event
Destinations) or change the ways to pay (Payment Method Configurations).

## Steps for Eric

1. In Stripe, open **Developers**, then **API keys**: https://dashboard.stripe.com/apikeys
2. Under **Restricted keys**, press **Create restricted key**.
3. Pick **Powering an integration you built** and press **Continue**.
4. On **Choose a permission template**, press **Choose your own**. Pick no template.
5. In **Key name**, type `Studio OS restricted`.
6. Set the twelve rows in the table above. The **Filter resources** box finds each one by
   name. Leave the group rows (Core, Billing and the rest) alone, and leave every other row
   on None.
7. Press **Create key** and finish Stripe's two-step check.
8. Stripe shows the new key once. Copy it.
9. In Supabase, open the project's Edge Function secrets:
   https://supabase.com/dashboard/project/qksstlqzbhesadrrofgn/functions/secrets
10. Put the new key in as the value of **STRIPE_SECRET** and press **Save**. Saving the same
    name replaces the old value. It takes effect straight away, with no deploy.
11. Tell Claude it's in. Claude opens the Health Center (`/admin-health.html`), presses
    **Check its permissions** on the Stripe key card, and reads the answer. It should say:
    "A restricted key that can do everything Studio OS needs and nothing it was refused."
12. Leave the old "Studio OS production" key in Stripe for a week. If its **Last used**
    date in Stripe doesn't move in that week, nothing else uses it, and you can delete it
    from its **⋯** menu.

If anything stops working after the swap, the quick undo is a new standard secret key
from **Create secret key** on the same Stripe page, put into STRIPE_SECRET the same way.

## How the check works

The check asks Stripe about each permission and makes or changes nothing:

- a **read** lists one item and keeps nothing of the answer
- a **write** names an object that can't exist (`price_StudioOSKeyCheck` and so on). A key
  that may write gets "no such price" back; a key that may not gets Stripe's refusal, which
  names the missing permission.

Stripe's request log shows the writes as refused requests. That is expected. The check
can be pressed six times in ten minutes.
