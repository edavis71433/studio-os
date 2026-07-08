# Studio OS Presence — Legal & Compliance (Version 1)

**Production-ready drafts, grounded in the implementation.** Every statement in these documents was verified against the codebase and the [Data Governance & Privacy Audit](../presence/DATA-GOVERNANCE-PRIVACY-AUDIT.md). No document promises behavior the software does not perform.

> **Before publishing (owner + counsel):** these drafts contain `[[OWNER: …]]` placeholders for entity name, jurisdiction, governing law, registered address, contact addresses, and effective dates — fill them in. They are drafted by an AI acting as SaaS/privacy/security counsel and should receive a licensed attorney's review for your jurisdiction before going live. The content is accurate to the software; the legal-entity and jurisdiction specifics are yours to supply.

## The documents

| # | Document | File |
|---|---|---|
| 1 | Terms of Service | [TERMS-OF-SERVICE.md](TERMS-OF-SERVICE.md) |
| 2 | Privacy Policy | [PRIVACY-POLICY.md](PRIVACY-POLICY.md) |
| 3 | Cookie Policy | [COOKIE-POLICY.md](COOKIE-POLICY.md) |
| 4 | Accessibility Statement | [ACCESSIBILITY-STATEMENT.md](ACCESSIBILITY-STATEMENT.md) |
| 5 | Security Statement | [SECURITY-STATEMENT.md](SECURITY-STATEMENT.md) |
| 6–8 | AI Usage Policy + AI Disclosure + Responsible AI Statement | [AI-POLICY.md](AI-POLICY.md) |
| 9–10 | Connected Platform Terms + Connected Provider Disclosure | [CONNECTED-PLATFORM-TERMS.md](CONNECTED-PLATFORM-TERMS.md) |
| 11 | Data Processing Agreement (DPA) | [DPA.md](DPA.md) |
| 12 | Subprocessor List | [SUBPROCESSORS.md](SUBPROCESSORS.md) |
| 13 | Data Retention Policy | [DATA-RETENTION-POLICY.md](DATA-RETENTION-POLICY.md) |
| 14 | Account Deletion Policy | [ACCOUNT-DELETION-POLICY.md](ACCOUNT-DELETION-POLICY.md) |
| 15 | Data Export Policy | [DATA-EXPORT-POLICY.md](DATA-EXPORT-POLICY.md) |
| 16 | Customer Ownership Guarantee | [OWNERSHIP-GUARANTEE.md](OWNERSHIP-GUARANTEE.md) |
| 17 | Acceptable Use Policy | [ACCEPTABLE-USE-POLICY.md](ACCEPTABLE-USE-POLICY.md) |
| 18 | Copyright & IP Policy | [IP-POLICY.md](IP-POLICY.md) |
| 19–21 | Subscription Terms + Founder Pricing + Refund & Cancellation | [SUBSCRIPTION-AND-BILLING.md](SUBSCRIPTION-AND-BILLING.md) |
| 22 | Beta Program Terms (conditional) | [BETA-PROGRAM-TERMS.md](BETA-PROGRAM-TERMS.md) |
| 23 | Service Level Expectations | [SERVICE-LEVEL-EXPECTATIONS.md](SERVICE-LEVEL-EXPECTATIONS.md) |
| 24 | Security & Privacy FAQ | [SECURITY-PRIVACY-FAQ.md](SECURITY-PRIVACY-FAQ.md) |

---

## Legal Compliance Matrix (software behavior ↔ document)

| Behavior (verified) | Where it's disclosed | Accurate? |
|---|---|---|
| No payment-card data stored (Stripe is processor) | Privacy Policy, Subscription & Billing, DPA, Security Statement | ✅ |
| PII = business facts + account emails; no special-category data; no signup IP/UA | Privacy Policy §Data We Collect | ✅ |
| AI receives only business facts / text prompts; Concierge no model; Visual no customer photos | AI Policy, Privacy Policy §AI | ✅ |
| AI drafts human-approved, manual parity, `ai_approved` ownership, no autonomous publishing | AI Policy, Ownership Guarantee | ✅ |
| Connected read-only default; encrypted tokens; disconnect destroys access; writes approval-gated | Connected Platform Terms, Privacy Policy §Connected | ✅ |
| Export = complete + portable (`/export`) | Data Export Policy, Ownership Guarantee | ✅ |
| Deletion self-serve per-entity; full-account erasure operator-assisted (SLA) | Account Deletion Policy, Privacy Policy §Your Rights | ✅ (states the operator-assisted path) |
| Retention: kept until deleted; publishes/audit indefinite; connected cleared on disconnect; soft-delete persists; no auto-purge | Data Retention Policy | ✅ |
| Auth/session localStorage only; no third-party tracking cookies found | Cookie Policy | ✅ (pending public-site cookie confirmation) |
| Deny-all RLS, tenant/org/agency isolation, approval enforcement, encryption, append-only audit | Security Statement, DPA §Security | ✅ |
| Accessibility structural controls present; formal third-party audit pending | Accessibility Statement | ✅ (states "in progress") |
| Ownership: content + domain always the customer's; no metered fees; leave any time | Ownership Guarantee, ToS | ✅ (constitutional) |
| Founder rate = permanent lock; trials where eligible; upgrades prorated; cancel at period end + grace | Subscription & Billing | ✅ |

**Open compliance items before launch (from the audit, R1/R5):** publish these documents (they do not yet exist as live pages); formalize the account-erasure SLA; confirm the public site carries no third-party tracking cookies; schedule a live accessibility + penetration audit. None is a software defect.

---

## Required Customer Consent Matrix

| Moment | Consent required | How |
|---|---|---|
| Sign up | Agree to Terms of Service + acknowledge Privacy Policy | Signup checkbox (see below) |
| Start a paid subscription | Agree to Subscription & Billing terms (recurring charge, founder lock, cancellation) | Checkout consent line |
| Connect a service | Authorize read-only access on the **provider's own** consent screen + acknowledge the Connected disclosure | Provider OAuth screen + in-app disclosure |
| Use AI drafting / Visual Studio | Acknowledge AI Disclosure (AI-assisted, you approve, you own) | One-time AI notice + per-action approval |
| Export / delete | None (customer-initiated right); confirmation dialog for delete | Confirmation prompt |
| Cookies | Consent only if/when non-essential cookies are added (currently essential-only) | Banner **only if** analytics/marketing cookies are introduced |

## Required Signup Checkboxes

1. ☐ *"I agree to the [Terms of Service] and [Acceptable Use Policy], and I've read the [Privacy Policy]."* (required)
2. ☐ *"I understand my plan renews automatically until I cancel, and I can cancel any time."* (required for paid plans — may live at checkout instead)
3. ☐ *(optional)* product-update emails — separate, unticked by default.

## Required In-App Legal Disclosures

- **AI surfaces (Writer/Editor/Visual):** a short line — *"AI-assisted. You review and approve everything; you can always do it by hand; what you approve is yours."*
- **Connect a service:** *"Read-only, with your approval on [provider]'s own screen. Disconnect any time — your account is untouched."*
- **Publish:** *"Nothing changes on your live site until you publish. Every version is kept."*
- **Delete:** *"This removes it from your library/site. [What's recoverable / what isn't]."*
- **Export:** *"Download everything you own — host it anywhere; nothing here requires Studio OS."*

## Required Footer Links (every page)

Terms · Privacy · Cookies · Security · Accessibility · AI · Data Processing (DPA) · Subprocessors · Ownership · Acceptable Use · Contact.

## Required Connected Platform Consent Screens

1. **In-app pre-connect card:** what we read (plain list), what we never change (nothing — read-only), that approval happens on the provider's screen, and that disconnect destroys access. *(Implemented in `connections.html`.)*
2. **Provider's own OAuth consent screen:** the authoritative grant (least-privilege scopes).
3. **Return confirmation:** *"Connected — read-only, your approval, disconnect any time."* *(Implemented in `connections-callback.html`.)*

## Required AI Consent Screens

- **First AI use:** the AI Disclosure summary + a link to the AI Policy.
- **Per action:** the approve/accept step (already enforced — AI never publishes autonomously).
- **Visual Studio:** *"AI-made images, shaped by your brand, saved only when you approve. Your own photos always work too."* *(Implemented in `visual-studio.html`.)*

## Required Billing Notices

- Pre-charge at checkout: amount, term, renewal, founder lock (if applicable), cancellation terms.
- Trial (where eligible): trial end date + first-charge date.
- Renewal, upgrade proration, cancellation confirmation (effective at period end), and lapse → **read-only + export preserved** notice.
- **No metered/overage charges — ever.**

## Required Export / Delete Notices

- Export: *"This is everything you own, portable and framework-free."*
- Delete (media/content): what is removed and whether it is recoverable.
- Disconnect: *"Your account and its data are untouched; we no longer have access."*
- Account deletion: how to request it and the erasure SLA.

---

## Final verification (answered in the [Security & Privacy FAQ](SECURITY-PRIVACY-FAQ.md) and each document)

- **Would an enterprise legal review likely approve this?** Likely **yes**, once these documents are published and the erasure SLA is stated — the substance (ownership, no card storage, encryption, isolation, approval-gated writes, DPA + subprocessors) is enterprise-appropriate.
- **Would a security review likely approve these disclosures?** Yes — they match the [Security Statement](SECURITY-STATEMENT.md) and the verified code; the only caveats (formal pen-test/accessibility audit pending) are stated, not hidden.
- **Would a customer clearly understand their rights?** Yes — plain-language ownership, export, deletion, and disconnect are stated in every relevant place.
- **Is anything legally missing before launch?** The documents themselves needed to exist (now drafted); the owner must fill entity/jurisdiction placeholders, formalize the erasure SLA, confirm no tracking cookies, and obtain counsel review.
