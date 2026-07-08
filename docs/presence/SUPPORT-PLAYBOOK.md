# Studio OS — Support Playbook (internal)

*The operating manual for supporting paying customers. Written so a second person could run support tomorrow. SLAs mirror `commerce/support.ts` (the same promises shown on the pricing data — they cannot drift, change them there first).*

## SLAs (the promises we've published)

| Tier | Channel | Response |
|---|---|---|
| Self-serve (Monitor/CMS/BOS/Presence) | support@davisdigitalstudio.com | **2 business days** |
| Managed | priority email | **1 business day** |
| Agency / Enterprise | named contact (Eric) | same business day / per contract |

## Triage flow (every inbound)

1. **Identify the customer**: search the email in the admin console (clients) → their site, plan, entitlement status.
2. **Classify**: 🔴 *broken for them* (can't sign in, can't publish, site down, billing wrong) → same-day regardless of tier · 🟡 *how do I…* → answer + link the exact Help section · 🟢 *feature wish* → thank + log to the Feature Discovery Queue.
3. **Answer in the product's voice**: plain words, honest, no jargon, never blame the customer.
4. **Log it**: CRM relationship note on their site (internal audience) — one line, what happened, what was promised.

## The top-10 answers (canned, adapt the greeting)

1. **"I can't sign in"** → portal.html → "Forgot password"; if invited-member, resend the invite from Members. Never reset `edavis7143@yahoo.com`.
2. **"My site isn't updating"** → Did you publish? Changes are drafts until the Publish button. Check History for the last publish; if a publish shows *failed*, escalate (see below).
3. **"How do I change X?"** → every business fact is in the workspace's Business page; hours/photos/menu-or-services have their own pages. Link help.html's matching section.
4. **"A payment failed / card declined"** → their site is still up (say so first); billing portal link to update the card; retries are automatic.
5. **"I want to cancel"** → billing portal → cancel; explain honestly: paid through the period, site stays up 60 days, everything downloadable forever. No guilt-tripping — the calm exit is the brand.
6. **"Where's my trial going?"** → trial end date is in their subscription view; nothing is deleted at the end; pick a plan to continue.
7. **"The AI won't write"** → capacity notice will say so in-product (sentence, not error). It resets monthly; upgrading raises it.
8. **"Connect Google isn't working"** → connections.html → the flow explains each step; check consent-screen status (Testing = only allow-listed users) and that they're signing into the right Google account.
9. **"I found a bug"** → thank, reproduce if possible, log a CRM note + a queue item; 🔴 if it blocks publishing/billing.
10. **"Can you build/change my site for me?"** → that's the Managed tier (or a studio project) — upsell honestly, never begrudgingly.

## Escalation (🔴 issues)

- **Publish failed**: check `/system/health` (secret in Vault), then the publish row's `error_text` in the admin console; retry via the site's publish after fixing; hosting errors = check Netlify token/status.
- **Platform-wide**: the watchdog (staging→prod) emails ops on health failure. Check Supabase status page + `/system/health`. Communicate honestly on the status of anything customer-visible.
- **Billing truth conflicts**: Stripe dashboard is the source of truth; billing-sync brings entitlements in line; never hand-edit entitlements without a Stripe-side reason logged.
- **Data recovery**: any published version restores in one click from History. DB-level: daily backups (dashboard) + the PITR decision (enable at first paying cohort).

## Offboarding / reactivation

Both are automated (Phase RL): cancellation → 60-day wind-down with export reminders; reactivation → everything exactly as left. Support's only job is to *repeat the policy warmly* and never improvise a different promise.
