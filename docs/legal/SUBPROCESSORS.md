# Subprocessor List

The third parties that process data to run Studio OS Presence. Verified against the code (each is an integration point in the platform). We will notify customers of changes per the [DPA](DPA.md). **[[OWNER: add each subprocessor's legal entity, location/region, and DPA link.]]**

| Subprocessor | Purpose | Data processed | Always on? |
|---|---|---|---|
| **Supabase** | Application hosting, Postgres database, file storage, backups | All workspace content, account data, encrypted tokens | **Yes** (core) |
| **Netlify** | Hosting of the published customer websites | Published (public) site content | **Yes** (publishing) |
| **Stripe** | Payment processing & subscriptions | Billing contact + **payment-card details (held by Stripe, not us)** | Yes (paid plans) |
| **Resend** | Transactional email (verification, billing notices) | Recipient email + message content | Yes (email) |
| **Anthropic** | AI drafting (Writer/Editor/Growth/Concierge polish) | The business **facts** being drafted / a text prompt — never credentials or photos | **Only if AI enabled** |
| **[[OWNER: image-model provider, e.g. OpenAI]]** | AI Visual Studio image generation | A **text prompt only** — never your uploaded photos | **Only if Visual enabled** |
| **Google** (and other connected providers you choose) | Connected Platform reads (and any writes you approve) | Only the data you authorize on the provider's own consent screen; read-only by default | **Only if you connect it** |
| **[[OWNER: DNS/domain registrar if applicable]]** | Domain/DNS for custom domains | Domain configuration | If custom domain |

**Notes:**
- The AI and connected subprocessors are **activation-gated**: they process nothing until the owner enables the feature and you use it. Until then they are not in the data path.
- Stripe is the payment processor of record; Studio OS never stores card numbers, CVV, or bank details.
- This list is the authoritative record; keep it current when integrations change.
