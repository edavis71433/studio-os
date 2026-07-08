# Editions & Packaging — Guide

*Phase D. One platform, many editions — packaged as DATA. Covers the Packaging, Licensing, Edition, Upgrade, and Downgrade guides, plus the Capability, Entitlement, Navigation, and Workspace matrices.*

---

## Packaging Guide

An **edition** is a named bundle of feature areas — never a separate codebase, deployment, app, or navigation system. The bundles live in `commerce/editions.ts` (pure, tested). The rules:

- One codebase, one platform, one shell, one nav model.
- A feature the edition doesn't include simply **doesn't appear** — `buildNav` drops empty sections, so no edition looks broken or artificially limited.
- Higher editions are **supersets** — upgrades only add.
- Editions are orthogonal to the two existing dimensions: `PLANS` (pricing) and `presence_sites.edition` (hosting). This is the *feature* dimension.

To change what an edition includes: edit the matrix in `editions.ts`. Nav, gates, and `/portal/context` follow automatically.

## Licensing Guide

- The licensed `plan` on `presence_entitlements` → `editionFromPlan(plan)` → the feature edition.
- `/portal/context` returns `edition_key`, `edition_name`, `edition_features`, `edition_flags`; the shell and pages read them.
- The **access gate** (`checkEntitlement`: active/paused/denied) is separate and unchanged — licensing controls *which features*, entitlement status controls *whether you're active*.
- Founder pricing (rate lock on the entitlement row), trials, and rank ordering live in `PLANS` — unchanged.

## Edition Guide

| Edition | For | Includes (headline) |
|---|---|---|
| **CMS** | someone who needs a correct website | Website, publishing, versioning, developer (licensed), client portal |
| **Business OS** | someone who needs to *know* their business | Moments, connections, AI, relationship, reports |
| **Studio OS** | the flagship buyer | CMS ∪ Business OS as one product |
| **Managed** | done-for-you | Studio OS + a person in the loop |
| **Agency** | studios running many clients | Studio OS + portfolio, switching, white-label |
| **Enterprise** | multi-location, governed | Studio OS + orgs, locations, governance, SSO/SCIM, audit |

## Upgrade Guide

Moving up the ladder (CMS → Studio OS → Agency → Enterprise) is **additive**: `featureDelta(from,to).gained` lists the new capabilities; `.lost` is empty. Nothing resets, no data changes, new nav sections appear on the next context load. Show the customer `gained` — that's the "here's what you unlocked."

## Downgrade Guide

Moving down hides capability but **preserves data**: `featureDelta(from,to).lost` lists what stops showing; the underlying rows (moments, relationship, drafts) are untouched and reappear on re-upgrade. Nav adapts (hidden hrefs are simply absent — no broken links, no errors).

---

## Capability Matrix (edition × feature area)

| Feature | CMS | Business OS | Studio OS | Managed | Agency | Enterprise |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Website / publishing / versioning | ● | | ● | ● | ● | ● |
| Developer Mode (licensed) | ● | | ● | ● | ● | ● |
| Forms / Lead Capture *(FD-2, pending)* | ○ | | ○ | ○ | ○ | ○ |
| Business Moments | | ● | ● | ● | ● | ● |
| Connected Platform | | ● | ● | ● | ● | ● |
| AI (Concierge/Growth/Visual) | | ● | ● | ● | ● | ● |
| Relationship (CRM) | | ● | ● | ● | ● | ● |
| Reports / Export | ● | ● | ● | ● | ● | ● |
| Client Portal (share/invite) | ● | ● | ● | ● | ● | ● |
| Managed service (concierge) | | | | ● | ● | ● |
| Agency (portfolio/white-label) | | | | | ● | ● |
| Enterprise (orgs/governance) | | | | | | ● |

● included · ○ packaged, build pending (FD-2)

## Entitlement Matrix (plan → edition → behavior)

| Plan (`presence_entitlements.plan`) | Feature edition | Self-serve | Status → behavior |
|---|---|:-:|---|
| `presence` | Studio OS | yes | active → full · paused → readonly · none → denied |
| `presence_managed` | Managed | yes | ″ |
| `agency` | Agency | no | ″ |
| `enterprise` | Enterprise | no | ″ |
| `presence_monitor` | Business OS (observe-only) | yes | ″ (site edition = monitor: no publishing) |
| *(cms_only)* | CMS | yes | rung to add — FD-D1 |
| *(business_os_only)* | Business OS | yes | rung to add — FD-D1 |

## Navigation Matrix (edition → nav sections)

| Section | CMS | Business OS | Studio OS | Agency | Enterprise |
|---|:-:|:-:|:-:|:-:|:-:|
| Today (Your Presence) | ● | | ● | ● | ● |
| Today (Today/Moments) | | ● | ● | ● | ● |
| Today (Relationship) | | ● | ● | ● | ● |
| Website / Create | ● | | ● | ● | ● |
| Grow (Moments/Growth/Connections) | | ● | ● | ● | ● |
| Clients (Sharing) | ●¹ | ●¹ | ●¹ | ●¹ | ●¹ |
| Agency (Portfolio) | | | | ●² | ●² |
| Settings (+ Developer³) | ● | ● | ● | ● | ● |
| Help | ● | ● | ● | ● | ● |
| **Landing** | /presence | /today | /today | /agency | /agency |

¹ requires the `invite` capability · ² requires agency membership · ³ requires `use_developer_mode`

## Workspace Matrix (edition → surfaces present)

| Surface | CMS | Business OS | Studio OS | Managed | Agency | Enterprise |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| CMS (presence.html) | ● | | ● | ● | ● | ● |
| Business OS (today.html) | | ● | ● | ● | ● | ● |
| CRM (crm.html) | | ● | ● | ● | ● | ● |
| Connections | | ● | ● | ● | ● | ● |
| Visual Studio | ● | | ● | ● | ● | ● |
| Developer Mode | ●³ | | ●³ | ●³ | ●³ | ●³ |
| Client Portal (client/sharing) | ● | ● | ● | ● | ● | ● |
| Agency (agency.html) | | | | | ● | ● |
| Admin (operator) | operator-only across all editions |

³ licensed + capability-gated.

---

*See also: [PHASE-D-PACKAGING](PHASE-D-PACKAGING.md) (discovery, reviews, final questions), [UNIFIED-WORKSPACE-SHELL](UNIFIED-WORKSPACE-SHELL.md) (the nav the matrix drives), [constitution/02-commercial-constitution](constitution/02-commercial-constitution.md) (pricing law).*
