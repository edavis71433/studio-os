# Amendment 6 — The Two-App Law (permanent architectural law)

*Ratified by the owner 2026-07-09. Formalizes and supersedes the two-app statement in [amendment 5](09-amendment-5-feature-enforcement-and-two-apps.md). This is a permanent architectural law: it may only be changed by an explicit further amendment.*

## The Law

Studio OS consists of **exactly two user-facing applications**. There is never a third.

### 1. Studio App (Freelancer / Agency App)
The application the operator (freelancer / agency) uses to run their business. It contains **modules**, shown according to the operator's — or, when scoped into a client, that client's — edition:

- Website (CMS) · Customers (CRM) · Files (DAM) · Analytics · Inbox · Studio Management · AI tools · Publishing · Billing · Settings

**The modules change with the edition; the application does not.**
- Buy only CMS → only the Website-related modules appear.
- Buy Business OS → only those modules appear.
- Buy Studio OS → everything appears.

### 2. Client App
Clients receive **exactly one** Client App — never a second portal, customer OS, reviewer app, CMS app, CRM app, or DAM app. It surfaces only the capabilities appropriate to the client's role, for example:

- Approvals · Website preview · Messages · Files shared with them · Reports · Analytics they're permitted to see · Billing when appropriate

**The Client App is always one experience.**

## Product Rule

CMS, CRM, DAM, Analytics, Inbox, AI, Publishing, Billing, etc. are **modules, not applications**.
- Do not refer to them as separate products.
- Do not design them as separate products.
- **Do not introduce another customer-facing application without an explicit architecture amendment.**

## How it is enforced

- **Composition:** navigation and modules are composed from **Edition × Role** (`lib/navigation.ts` `buildNav`), never hand-listed per app.
- **Server-side boundary:** which modules exist for a caller is enforced at the request boundary by `middleware/feature.ts` (`requireFeature`/`featureForRoute`), reusing `editionIncludes()` — hiding a module was never the control (Phase FE-1).
- **Transitional note:** the *current* Admin Tool and Client Portal HTML pages are transitional implementations; on release they are retired and their functionality **migrated** into the Studio App and Client App. The underlying services (CMS, CRM, DAM, Analytics, Publishing, …) remain unchanged. See [[two-app-product-model]] and PHASE-FE-1-FEATURE-ENFORCEMENT-AND-TWO-APP-MODEL.
