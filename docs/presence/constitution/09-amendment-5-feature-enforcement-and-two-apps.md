# Amendment 5 — Feature Enforcement & the Two-App Model (Phase FE-1)

*Amends the commercial + architecture constitution. Ratifies how editions are enforced and how many apps exist. No pricing change.*

## Two apps, never three
Studio OS presents **exactly two web apps**:
1. **Freelancer / Studio App** — the operator's workspace; manages clients, re-scopes the one shell per client, bounded by that client's entitlement.
2. **Client App** — the client's workspace; review, approve, message, upload, see progress — only what role/package allows.

CMS, CRM, DAM, and Analytics are **internal systems and sellable editions**, surfaced *inside* these two apps by **Edition × Role**. They are never separate apps.

## Feature boundaries are a server-side control
The edition a customer buys determines which **capability areas** exist for them at the request boundary — enforced in `middleware/feature.ts` (`requireFeature` / `featureForRoute`), reusing `editionIncludes()`. **Hiding a menu is not the control.** Denials are a friendly upgrade 403.

- **Fail-open on denial:** an unreadable/absent entitlement resolves to the site's natural edition — a paying customer is never wrongly denied.
- **Supersets never deny:** Studio OS / Managed / Agency / Enterprise reach everything below them.
- **The shell is baseline:** bootstrap, Inbox, notes, export, settings, concierge, and reading business facts are reachable by every edition, so no app frame ever breaks.
- **Operator ⊆ client entitlement:** when scoped into a client, the operator cannot exceed what the client purchased.
- **Nav ⇔ server agree:** the server gate mirrors `buildNav`, proven per edition by `tests/presence/feature_boundary_test.mjs`.

## Standalone products (ratified)
- **CMS** (`cms_only`) — the standalone Website product.
- **Business OS** (`business_os_only`) — the standalone Customers/CRM product (CRM + Moments + Connected + Analytics). No narrower `crm_only` edition.
- **Studio OS** (`studio_os`) — the bundle of both.

## Files/DAM ownership
Files is gated on `website` while no edition sells DAM standalone. If/when DAM becomes a standalone product, introduce a `files` EditionFeature (added to every edition that currently has `website`, so nothing regresses) and repoint `featureForRoute` + the Files nav section. Tracked as a packaging follow-up.

*See [PHASE-FE-1-FEATURE-ENFORCEMENT-AND-TWO-APP-MODEL](../PHASE-FE-1-FEATURE-ENFORCEMENT-AND-TWO-APP-MODEL.md).*
