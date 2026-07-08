# Connected Platform Terms & Provider Disclosure

*Covers deliverable 9 (Connected Platform Terms) and 10 (Connected Provider Disclosure). Verified against `connected/` in the codebase.*

---

## Part 1 — Connected Platform Terms

When you connect a third-party service (your "Connected Account" — e.g. your Google Business Profile, reviews, or analytics), these terms apply in addition to the [Terms of Service](TERMS-OF-SERVICE.md).

1. **You authorize access on the provider's own screen.** We initiate the connection; you grant it on the provider's consent screen, at the least-privilege scope needed.
2. **Read-only by default.** We read only the data you authorize, to make your presence smarter — never noisier. We do not change anything at the provider unless you approve a specific action.
3. **Writes are approval-gated.** Where a service supports a change (e.g. posting a Google update, updating hours), we present a plain-language plan — what changes, what stays, and how to undo it — and act **only after you approve**. Nothing is written silently.
4. **Your credentials are protected.** Access tokens are encrypted (AES-256-GCM) and stored separately from your other data; they are never shown to you or anyone, and never sent to AI.
5. **You can disconnect any time.** Disconnecting **immediately destroys our stored access and deletes the cached data.** After that, we cannot access your Connected Account.
6. **Ownership stays with you.** The Connected Account and its data remain entirely yours; we are only a permitted reader.
7. **Provider terms apply.** Your use of each provider remains subject to that provider's own terms; we are not responsible for the provider's service.
8. **Activation.** Some connections require the operator to enable the integration; until then a service honestly reads "not available yet."

---

## Part 2 — Connected Provider Disclosure (customer-facing)

> **What connecting a service does.** You connect the services you already use. We **read** the information you allow (for example, your review count or visitor numbers) to help you keep your presence correct and growing. We **never change** anything on that service unless you approve a specific action first. Your login stays with the provider — we only receive a permission you can revoke. **Disconnect any time; your account and its data are untouched.**

For each provider, the in-app screen lists in plain words exactly what we read, that we never change anything without approval, that you own the account, and how to disconnect. *(Implemented in `connections.html` / `connections-callback.html`.)*

**[[OWNER: as you enable each provider (Google, etc.), confirm its specific scopes and any provider-required disclosure language.]]**
