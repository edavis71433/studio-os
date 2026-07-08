# Security & Privacy FAQ

Plain answers to the questions customers and enterprise procurement reviewers ask most. Every answer is accurate to the implementation.

**Where is my data stored?** In a managed Postgres database and file storage (Supabase); published sites are hosted on a CDN (Netlify). See the [Subprocessor List](SUBPROCESSORS.md). **[[OWNER: state hosting regions.]]**

**Do you store my credit card?** No. Payments are processed by Stripe; we never see or store card numbers, CVV, or bank details.

**Is my data isolated from other customers?** Yes — deny-all row-level security scopes every access to your own workspace; one customer can never see another's data.

**Is my data encrypted?** In transit (HTTPS) everywhere. Connected-service tokens are encrypted with AES-256-GCM and stored separately. Database/storage at rest is encrypted by our host.

**What do you send to AI?** Only the business facts you're drafting from, or a text description for image generation. **Never** your credentials, connected tokens, or uploaded photos. The Concierge uses no AI model at all. See the [AI Policy](AI-POLICY.md).

**Who owns AI-generated content?** You do — the same as anything you type. We only note it was AI-assisted, for honesty.

**Can you change my Google/other accounts?** Only if you approve a specific action; by default we read only. Disconnecting destroys our access immediately.

**Can I get all my data out?** Yes — a complete, portable export (including a framework-free copy of your site) at any time. See [Data Export](DATA-EXPORT-POLICY.md).

**Can I delete my data?** Yes — media, content, and connections yourself; full-account deletion on request within **[[OWNER: 30]]** days. See [Account Deletion](ACCOUNT-DELETION-POLICY.md).

**How long do you keep my data?** Until you delete it; published versions and audit logs are kept for ownership/traceability; connected data is cleared on disconnect. See [Data Retention](DATA-RETENTION-POLICY.md).

**Do you track me with cookies?** No third-party/advertising cookies — only essential sign-in storage. See the [Cookie Policy](COOKIE-POLICY.md).

**Do you have a DPA / subprocessor list?** Yes — [DPA](DPA.md) and [Subprocessors](SUBPROCESSORS.md).

**Have you had a penetration test / accessibility audit?** Structural security and accessibility controls are implemented and code-verified; **independent third-party penetration and accessibility audits are recommended and pending** before public launch — we state this honestly rather than imply certifications we don't yet hold.

**What about breaches?** We monitor and log, and will notify affected customers per the [DPA](DPA.md). Report vulnerabilities to **[[OWNER: security@…]]**.

**Do you sell my data?** No. We never sell customer data or use it for third-party advertising.

**What certifications do you hold?** **[[OWNER: none claimed yet — list SOC 2 / ISO 27001 status honestly, including "in progress" or "not yet pursued." Do not imply certifications you don't hold.]]**
