# Inbound email capture — setup runbook (CRM redesign, slice 6)

A client's email **reply** enters Studio OS through the pre-auth webhook
`POST /functions/v1/presence/email/inbound`. Resend routes `*@<inbound-domain>`
to it; a message addressed to `<siteId>@<inbound-domain>` lands on that agency
site's support conversation, matched to a **known** customer/contact by the
sender's email. Everything is HMAC-verified (svix), sender-authenticated
(DMARC/SPF/DKIM), and fail-closed.

This is a ~15-minute Resend dashboard step **plus** a deploy + one migration.
Do the steps **in order** — the ordering (deploy the code FIRST, prove the 404,
THEN set the secret) is what keeps the door from ever being briefly open or
briefly broken.

---

## What you need

- Access to the **Resend dashboard** (the same account the platform sends from).
- Access to **Supabase secrets** for the presence function (staging + prod).
- Access to the **`deploy.yml`** GitHub Action (workflow_dispatch).
- A domain (or subdomain, e.g. `inbound.davisdigitalstudio.com`) you can add MX
  records to. A subdomain is recommended so inbound MX is isolated from your
  sending domain's records.

---

## Steps

### 1. Verify an inbound domain in Resend (MX)
In Resend → **Domains** → add the domain/subdomain you'll receive on, and add the
**MX record(s)** Resend shows to your DNS. Wait for Resend to mark it
**verified**. This is the ~15-minute part (mostly DNS propagation).

### 2. Add the inbound route
In Resend → **Inbound** (or the domain's inbound settings) → add a route that
forwards **`*@<domain>`** (catch-all) to a webhook. We rely on the catch-all so
that **every** `<siteId>@<domain>` address works without per-tenant config.

### 3. Point the route at our webhook
Webhook URL (production):

```
https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/email/inbound
```

Save. Resend will show a **signing secret** that starts with `whsec_`.

### 4. Copy the signing secret — but do NOT set it yet
Copy the `whsec_…` value somewhere safe. You will set it in **step 7**, *after* the
new code is deployed, so the fail-closed **404** proof in Verification is real and
observable. (Setting it now would make the 404 check impossible.)

### 5. Deploy the new code — via CI (PRIMARY)
Deploy the presence function so the `/email/inbound` route **exists** — this is the
FIRST live change, before any secret is set.

**Primary path — the `deploy.yml` workflow:** run the **Deploy** GitHub Action
(`workflow_dispatch`), typing **`deploy-production`** into the confirmation box.
This deploys `main` and runs `supabase functions deploy presence --no-verify-jwt`
for you against staging then production.

> **Fallback only — the bare CLI form.** If (and only if) CI is unavailable, you
> may deploy by hand — but you **MUST** include `--no-verify-jwt`:
>
> ```
> supabase functions deploy presence --no-verify-jwt --project-ref <ref>
> ```
>
> ⚠️ **Omitting `--no-verify-jwt` enables Supabase's gateway JWT verification and
> will 401 EVERY public door platform-wide** (this webhook, `/email/events`,
> `/forms/:id/submit`, `/book/:site`, `/px/:site`, the signed preview/share
> links, `/commerce` signup — all of them). The function does its own auth; the
> gateway must stay out of the way. Use CI, which already gets this right.

### 6. Confirm the fail-closed 404 (secret still unset)
With `RESEND_INBOUND_SECRET` **still unset**, `POST …/presence/email/inbound` must
return **404** — the surface does not exist until the secret is present. Confirming
this BEFORE you set the secret proves fail-closed is real, not incidental. (See
Verification below for the exact check.)

### 7. Set the two secrets
Now set **both** secrets on the presence function (per environment):

```
supabase secrets set RESEND_INBOUND_SECRET=whsec_xxxxxxxxxxxxxxxx --project-ref <ref>
supabase secrets set RESEND_INBOUND_DOMAIN=<your-inbound-domain>  --project-ref <ref>
```

- `RESEND_INBOUND_SECRET` — the svix signing secret. **While it is unset the route
  returns 404** (the surface does not exist — fail-closed). This is also the
  kill-switch: unset it to instantly disable inbound capture.
- `RESEND_INBOUND_DOMAIN` — the domain from step 1. It does two jobs: the
  self-sender guard (drop any `@<domain>` sender to avoid loops) **and** the R1
  loop-closure — outbound **site** mail (studio↔customer messages, support replies,
  acks, bridge nudges, broadcasts) sets `reply_to: <siteId>@<domain>` so a
  customer's reply comes straight back here.

> **Secrets propagate WITHOUT a redeploy.** Setting a secret takes effect on the
> already-running function within a minute — you do **not** need to redeploy to
> pick up a changed `RESEND_INBOUND_SECRET` / `RESEND_INBOUND_DOMAIN`. (The new
> **code** must already be deployed — that was step 5.)

> **DKIM/SPF must be configured in Resend so it stamps a STRUCTURED verdict.**
> The sender-auth gate (SA1) trusts ONLY the provider's structured
> `dmarc`/`spf`/`dkim` verdict fields — it deliberately does **not** parse the
> message's own `Authentication-Results` headers (an attacker controls those and
> could forge a `dmarc=pass`). Consequence: **if Resend forwards a message with no
> structured verdict, the mail FAILS CLOSED and is dropped.** Make sure DKIM/SPF
> are set up in your Resend inbound/domain config so Resend authenticates the
> sender and supplies the verdict; otherwise legitimate mail will silently drop.

### 8. Apply migration 0114
Apply the dedup keys (idempotency for re-delivered webhooks). In Supabase → SQL
Editor, run **`docs/presence/APPLY-0114-prod.sql`** (two-step: a transactional
column add, then CONCURRENT index builds — run them in that order; idempotent) on
each environment. The route degrades gracefully until this is applied (a
re-delivered email could double-land pre-apply), so code-first / apply-after is
safe.

---

## Verification (ORDER MATTERS)

1. **Deploy the new code FIRST** (step 5). Confirm the function is live.
2. **No-secret 404 check** — with `RESEND_INBOUND_SECRET` still **unset** in that
   environment, `POST …/presence/email/inbound` must return **404** (the door is
   closed). Only after you confirm the 404 do you set the secret (step 7). This
   proves fail-closed is real, not incidental.
3. Set the secrets (step 7); send a **real** test reply from a **known**
   customer/contact address to `<siteId>@<domain>`. It should appear on that
   site's support conversation.
   - **A NEW-subject email** (one that does not match an open thread's subject)
     opens a new support request **and** triggers the branded auto-ack back to the
     sender.
   - **A reply that APPENDS to an existing open thread** (its normalized subject
     matches an open request) lands **silently — no auto-ack**. This is
     intentional mail-loop prevention: acking every reply would ping-pong with the
     other side's mail client. So don't expect an ack on a threaded reply.

> **The ack leg needs `RESEND_KEY` set AND an unsuppressed recipient.** The
> auto-ack (on a NEW request only) is sent through the one Resend send point — if
> `RESEND_KEY` is unset, or the sender is on the suppression list
> (bounced/complained, or opted-out for non-critical mail), the message still
> **lands** but no ack goes out. That's expected; don't read a missing ack as a
> failed capture.

> **Threading is by SUBJECT, deterministically (follow-up).** A reply is appended
> to the newest open request whose **normalized subject** matches (Re:/Fwd: chains
> stripped, case-folded); an empty/normalizes-to-empty subject always opens a NEW
> request. Threading currently **ignores** the `In-Reply-To` / `References`
> headers — true RFC-5322 reference threading needs us to first capture the
> Message-Ids of OUTBOUND mail, which is a later slice. Until then, a reply whose
> subject was edited away from the original may open a new request instead of
> appending.

---

## What gets rejected (and how)

| Condition | Response |
|---|---|
| `RESEND_INBOUND_SECRET` unset | **404** (surface doesn't exist) |
| Missing `svix-id` / `-timestamp` / `-signature` | **400** |
| Body over 256KB (declared or streamed) | **413** (before any HMAC) |
| Bad/expired signature | **401** |
| Per-site flood (>30 / 10 min) | **429** |
| Bad JSON / not `email.received` / unparseable | **200 ack** (dropped, masked warn) |
| Auto-responder / bounce / bulk | **200 ack** (dropped) |
| DMARC/SPF/DKIM verdict not ok | **200 ack** (dropped, verdict named in the warn) |
| Our own / `@<inbound-domain>` sender | **200 ack** (dropped) |
| No `<siteId>@…` recipient / unknown site | **200 ack** (dropped) |
| Sender not a known customer/contact on that site | **200 ack** (dropped — spam surface) |
| Landable message hit an infra write failure | **502** (Resend retries) |

Everything past the signature **acks 200** so Resend stops retrying an
un-landable message; only a landable message that hit an infra failure returns a
retriable 502.
