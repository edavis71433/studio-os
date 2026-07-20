# #166 — Legal Half: Drafts for Eric (terms/privacy platform-subscription + provider list)

**Status: DRAFT — nothing here is live.** These are paste-ready sections for the LIVE
legal pages (`terms.html`, `privacy.html`) plus matching rows for
`docs/legal/SUBPROCESSORS.md`. Every claim below was verified against the code on
2026-07-20 (references in the appendix). Anything the code could not answer is marked
**[VERIFY]**; anything that is a business call is in the **Eric decisions** list at the
bottom — nothing should go live until those are settled.

Voice and markup match the live pages (plain English, first person, `<h2 class="mt-l">`
+ `<p class="lead-muted mt-s">`, HTML entities as the pages use them).

---

## 1. Terms of Service — "Website subscriptions" section (drop-in for `terms.html`)

**Where:** insert as a new section **5** after "4. Payments", and renumber the current
5–9 to 6–10. The current "4. Payments" already covers invoices via Stripe; this section
adds the subscription itself.

```html
<h2 class="mt-l">5. Website subscriptions</h2>
<p class="lead-muted mt-s">Some clients keep their website running through my studio platform on a subscription that covers hosting and ongoing management of the site. Here&rsquo;s how that works, plainly:</p>
<p class="lead-muted mt-s"><strong>Billing and renewal.</strong> Subscriptions are billed through Stripe, monthly or annually (the annual price is ten months&rsquo; worth &mdash; two months free), and renew automatically until you cancel. Where a free trial is offered, it doesn&rsquo;t require a card, and nothing is charged unless you choose a paid plan.</p>
<p class="lead-muted mt-s"><strong>Changing plans.</strong> You can change plans yourself from your billing page. Upgrades take effect right away, prorated for the rest of the current billing period; downgrades take effect at your next renewal, so you never lose time you&rsquo;ve paid for.</p>
<p class="lead-muted mt-s"><strong>Canceling &mdash; and what happens to your site.</strong> You can cancel any time from your billing page. Your site and workspace stay fully live until the end of the period you&rsquo;ve paid for. After that, your account becomes read-only: your content stays put and you can export everything, any time. If you don&rsquo;t come back within the wind-down period (about 60 days, with an export reminder before it ends), the hosted site is taken offline &mdash; but your content is preserved, and resubscribing puts the site back up. Nothing you created is deleted because a subscription ended.</p>
<p class="lead-muted mt-s"><strong>If a payment fails.</strong> Your account isn&rsquo;t cut off over a failed charge &mdash; there&rsquo;s a grace period of about two weeks to sort it out, with a notice in your workspace, before anything changes.</p>
<p class="lead-muted mt-s"><strong>Project and service work is separate.</strong> Invoices for project work, deposits, and retainers are billed separately from the website subscription &mdash; they&rsquo;re governed by your project agreement (section 2), and paying or canceling one never silently changes the other.</p>
<p class="lead-muted mt-s"><strong>Acceptable use.</strong> The subscription covers your own business&rsquo;s website and workspace, under the same acceptable-use rules as the rest of this site (section 7) and the <a href="portal-terms.html">Workspace Terms</a>.</p>
```

Refund sentence — **ERIC'S DECISION** (see decision list). Recommended default, ready to
append to the "Canceling" paragraph if adopted:

```html
<p class="lead-muted mt-s"><strong>Refunds.</strong> Because access runs to the end of the period you&rsquo;ve paid for, canceling doesn&rsquo;t generate a prorated refund &mdash; you keep what you paid for instead. If I&rsquo;ve billed you in error, tell me and I&rsquo;ll fix it, promptly and without argument.</p>
```

> Notes for Eric:
> - "about 60 days" wind-down: docs and the day-45 export reminder support 60 days, but
>   I could not read the literal `WIND_DOWN_DAYS` constant — **[VERIFY: confirm the
>   configured wind-down day count before publishing a number, or keep "about 60 days"]**.
> - Grace period is 14 days in code; "about two weeks" keeps the page honest if it's tuned.
> - Trials: card-free per code. **[VERIFY: which plans have trials enabled in the live
>   environment — trial eligibility is per-plan config.]**

---

## 2. Privacy Policy — "Website subscriptions & billing" section (drop-in for `privacy.html`)

**Where:** insert after "Services that help run this site" (its payments note leads
naturally into this), before "Cookies &amp; analytics".

```html
<h2 class="mt-l">Website subscriptions &amp; billing</h2>
<p class="lead-muted mt-s"><strong>If your website runs on my platform</strong> &mdash; the account and billing information processed is what you&rsquo;d expect and nothing more: your name, email, business name, the plan you chose, and your invoices. Payments are processed by Stripe; your card details go directly to Stripe and never touch my servers. What I keep on my side is a payment record &mdash; the amount, date, the email on the payment, and Stripe&rsquo;s reference IDs for your customer and subscription &mdash; plus your invoices, retained because tax law requires it. Everything else follows the deletion and export rules described under &ldquo;Your choices&rdquo; above.</p>
<p class="lead-muted mt-s"><strong>Your website&rsquo;s visitors.</strong> Sites hosted through the platform include a small first-party analytics beacon I run on your behalf so you can see how your site is doing. It is deliberately minimal: no cookies, no raw IP addresses stored, referrers trimmed to just the site they came from, and a visitor identifier that changes every day so nobody can be followed over time. Browsers that send &ldquo;Do Not Track&rdquo; aren&rsquo;t counted at all. That visitor data is your business&rsquo;s &mdash; I process it only to show you your own site&rsquo;s statistics, and your site&rsquo;s own privacy policy is what covers your visitors.</p>
```

---

## 3. Privacy provider-list additions

### 3a. Live page — `privacy.html`, "Services that help run this site" paragraph

The list is a single paragraph of `<strong>Name</strong> (what it does)` entries. Splice
these in (suggested position: after the Anthropic entry, keeping Google Fonts last is
fine either way):

```html
<strong>OpenAI</strong> (AI image generation in the studio platform &mdash; it receives only the text prompt composed for the image: the subject words entered plus the brand&rsquo;s style notes, and, for photo edits like background removal, the specific photo chosen for editing. Website visitor data is never sent), <strong>Pexels</strong> (stock photo search &mdash; it receives only the search words typed; chosen photos are downloaded and stored with the site rather than loaded from Pexels),
```

- Both capabilities are **activation-gated** in code (dark until their API keys are set).
  **[VERIFY: whether Visual Studio (OpenAI) and Pexels are switched on in production.
  If not yet, hold these entries until activation — adding them early is harmless but
  claims a data flow that doesn't exist yet.]**
- **Resend is already in the live list** — no new row needed. When inbound reply-by-email
  is activated, update its entry from "(transactional email)" to:

```html
<strong>Resend</strong> (transactional email, and &mdash; when reply-by-email is on &mdash; receiving your email replies into the project workspace),
```

- The **Anthropic** entry currently reads "the AI behind the free review tools and the
  portal assistant." The platform's AI writer also sends business facts/voice notes to
  Anthropic. Suggested touch-up (optional, keeps it honest as the platform grows):
  "…the AI behind the free review tools, the portal assistant, and the platform&rsquo;s
  writing helper &mdash; see the <a href="/ai-disclaimer">AI disclaimer</a>…"

### 3b. `docs/legal/SUBPROCESSORS.md` — matching table rows

Replace the `[[OWNER: image-model provider, e.g. OpenAI]]` placeholder row and add Pexels:

```markdown
| **OpenAI** | AI Visual Studio image generation & photo edits | The composed **text prompt** (subject + brand style notes); for edits (e.g. background removal), **the source photo being edited**. Never visitor data | **Only if Visual enabled** |
| **Pexels** | Stock photo search | The **search words** typed; chosen photos are downloaded and self-hosted | **Only if stock search enabled** |
```

> **Correction flag:** the current placeholder row says "never your uploaded photos" —
> that is no longer true: the edit endpoint uploads the chosen source image
> (`visual/model.ts:101`, used by the background-removal action). The row above states
> it accurately. Doc-truth requires this fix whenever the table is next touched.

> **Related page, same truth:** `ai-disclaimer.html` currently names only "the Anthropic
> API" as the AI provider. Once Visual/OpenAI activates, that page needs a one-line
> update too (it's linked from both live legal pages).

---

## 4. Eric decisions needed

Clearly separated — none of the drafts above should ship until these are decided:

1. **Refund posture.** Recommended default drafted in section 1: no prorated refunds on
   cancellation (access runs to period end), billing errors fixed promptly. Alternatives:
   a 14/30-day money-back window on first subscription, or case-by-case. **Your call.**
2. **Governing law / jurisdiction.** `terms.html` already says California law, operating
   from Burbank — but `portal-terms.html`'s contact block says "Los Angeles, CA."
   Pick one consistent locality across all legal pages (governing-law section can simply
   continue to apply to the new subscription section; confirm no change wanted).
3. **Contact / business address** for billing questions and disputes — the pages use
   email only today; decide whether the subscription section warrants a mailing address.
4. **Wind-down number.** Confirm the production wind-down window (docs say 60 days,
   export reminder at day 45) before the terms state a number.
5. **Activation timing.** OpenAI and Pexels entries: publish now with "when enabled"
   framing, or hold until the keys are actually set in production (see [VERIFY] flags).
6. **Effective/reviewed dates.** Both live pages carry effective + last-reviewed dates;
   set new ones when these sections land.

---

## Appendix — what the code actually does (verification trail)

- **Subscription creation:** Stripe Checkout `mode: 'subscription'`
  (`supabase/functions/presence/commerce/stripe.ts:63–98`); monthly/annual terms, annual
  bills 10 months (`commerce/catalog.ts:38,143`); card-free trials for eligible plans
  (`routes/commerce.ts:117,166–179`).
- **Plan changes:** upgrades immediate + prorated, downgrades at renewal
  (`commerce/catalog.ts:197–207`); executed through Stripe's hosted Billing Portal
  (`commerce/stripe.ts:175–181`) — the platform itself never calls a proration API.
- **Cancellation:** `cancel_at_period_end` keeps access to period end; then entitlement
  lapses to read-only + export (`commerce/subscriptions.ts:15–16,25–40`); scheduled
  wind-down removes Netlify hosting and archives the site with **database content
  preserved** and resubscribe-republish supported (`commerce/lifecycle.ts:178–203`);
  past-due grace = 14 days (`commerce/subscriptions.ts:23`).
- **Service work separate:** service invoices/deposits via one-time Payment Links
  (`commerce/stripe.ts:106–128`), service retainers on a separate rail
  (`stripe.ts:139–164`; webhook keeps them apart from the SaaS subscription,
  `supabase/functions/stripe-webhook/index.ts:391–411`); the client portal labels the
  two "billed separately" (`routes/client_delivery.ts:45–67`).
- **Billing data stored locally:** `stripe_payments` ledger — session/intent/customer/
  subscription IDs, email, amount, currency, status (`stripe-webhook/index.ts:226–241`);
  entitlement row with Stripe customer/subscription IDs (`commerce/subscriptions.ts:52–64`).
  No card data anywhere.
- **OpenAI:** images only — generation sends text prompt + negative prompt
  (`presence/visual/model.ts:35–62`, default `api.openai.com`, model `gpt-image-1`);
  edits also upload the source image (`model.ts:82–117`, `:101`); prompt = customer's
  subject words + brand snapshot (`routes/visual.ts:34–48`); gated on `VISUAL_MODEL_KEY`
  (`model.ts:30`). The text writer is **Anthropic**, not OpenAI
  (`presence/writer/model.ts:32–57`, `claude-haiku-4-5`).
- **Pexels:** search sends only the query text + page (`presence/lib/stock/pexels.ts:51–57`);
  download fetches by photo ID and returns bytes for self-hosting (`:58–69`); gated on
  `PEXELS_API_KEY` (`:50`); Pexels License permits self-hosting, no attribution (`:1–7,49`).
- **Resend:** outbound gated on `RESEND_KEY` (no-op without it,
  `commerce/account.ts:109`); inbound reply capture exists behind a svix-signed webhook
  that 404s until `RESEND_INBOUND_SECRET` is set
  (`presence/routes/inbound_email.ts:194–197`); already listed on the live privacy page.
- **Client-site visitor analytics:** first-party, cookieless beacon — no raw IP, referrer
  host only, daily-rotating salted visitor hash, DNT honored, bots dropped
  (`presence/routes/collect.ts:39–48`, `presence/lib/visits.ts:1–6,17,29,75–79,143–153`).
- **Docs half of #166:** `docs/presence/DATA-GOVERNANCE-PRIVACY-AUDIT.md:179,220` already
  calls for exactly these subprocessor additions; `docs/legal/SUBPROCESSORS.md:12` still
  has the OpenAI placeholder and no Pexels row — this draft closes that gap.
