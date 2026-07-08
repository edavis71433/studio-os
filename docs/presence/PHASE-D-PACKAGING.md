# Phase D — Product Packaging, Editions & Licensing

*Implementation, not redesign. Studio OS is packaged into editions as DATA over ONE codebase, one platform, one navigation model, one shell. Navigation adapts automatically to the licensed edition. No separate codebases, deployments, apps, or nav systems.*

---

## Executive summary

Editions are now a **feature-packaging layer** (`commerce/editions.ts`) — a pure matrix mapping each edition (CMS, Business OS, Studio OS, Managed, Agency, Enterprise) to the feature areas it includes. `buildNav` consumes it, so every edition renders a **complete, non-empty, dead-end-free** navigation, and `/portal/context` resolves the edition from the licensed plan and returns it to the shell. Upgrades add capability (data never touched); downgrades hide capability (data preserved). The commercial catalog (`PLANS`) is **untouched** — it's frozen with a DB check and tests — so the two brand-new editions (CMS-Only, Business-OS-Only) are architecturally complete and nav-verified today, with their commercial rungs a documented, low-risk follow-up. 34 new edition tests; nav backward-compatible (existing behavior unchanged when no edition is set); invariants 14/14.

---

## Step 1 — Discovery (verified)

| Dimension | Where it lives | State |
|---|---|---|
| **Commercial ladder** (pricing) | `commerce/catalog.ts` PLANS — 5 rungs, founder rates, trials, ranks | Exists, frozen (DB check on `plan`, `commerce_test` asserts 5) |
| **Site edition** (hosting) | `presence_sites.edition` = monitor \| presence | Exists |
| **Entitlement** (access gate) | `presence_entitlements` (client_id, product, status, **plan**) | Exists; `plan` recorded |
| **Navigation** | `buildNav` (role + edition + capabilities) | Exists (Phase A7.5/C1) |
| **Feature packaging** (CMS-Only vs Business-OS-Only, feature→nav) | — | **Missing — the gap this milestone fills** |

Conclusion: everything to *sell* an edition existed; what was missing was the **feature bundle** that says "this edition includes these capabilities" and drives nav. That is `editions.ts`.

---

## Step 2 — Edition review (Required / Optional / Upgrade / …, with why)

| Feature area | Disposition | Why |
|---|---|---|
| Website / publishing / preview / versioning / rollback | **Required** in CMS, Studio, Managed, Agency, Enterprise | The CMS core. |
| Media / templates / SEO | **Required** with Website | Part of the CMS. |
| Developer Mode | **Optional (licensed)** | Feature area in CMS/Studio/Agency/Enterprise; still capability-gated by `use_developer_mode`. |
| Forms / Lead Capture | **Optional — BUILD pending (FD-2)** | Packaged in CMS/Studio; a Business-OS-audience capability not yet built. |
| Business Moments / Connected / AI / Relationship / Reports | **Required** in Business OS, Studio, Managed, Agency, Enterprise | The Business-OS core. |
| Client Portal (sharing/invite) | **Required** everywhere | Ownership + relationship; present in all editions. |
| Managed service (concierge) | **Managed+ only** | A person in the loop — Managed, Agency, Enterprise. |
| Agency (portfolio, white-label, switching) | **Agency only** | Multi-client operating system. |
| Enterprise (orgs, locations, governance, SSO/SCIM, audit) | **Enterprise only** | Governed multi-location. |
| Operator/Admin tools | **Operator only** | Unchanged; staff bypass. |
| Pipelines / deals / dashboards / custom fields | **Reject** | Out of ethos (A9 / Phase C) — not editions, not features. |

---

## Per-edition completeness (verified by test — every edition non-empty, no dead ends)

- **CMS Only** — Today (Your Presence), Website (site/photos/publish), Create, Clients, Settings (+Developer if licensed), Help. **No Business-OS menus, no empty sections.** Lands on the website. Feels like a complete website product.
- **Business OS Only** — Today (Today + Relationship), Grow (Moments/Growth/Connections), Clients, Settings, Help. **No CMS editing, no empty website menus.** Lands on Today.
- **Studio OS** (flagship) — CMS ∪ Business OS, one product; nothing duplicated (the CRM already threads them, the shell frames them).
- **Managed** — Studio OS + a person in the loop (concierge); operator present.
- **Agency** — Studio OS + Agency section (portfolio, switching) + client portal + CRM + Developer Mode + reporting; multi-client workflow intact (Phase A7/C).
- **Enterprise** — Studio OS + orgs/locations/governance/audit (M13/L5.6); per-location shell; SSO/SCIM/audit are the honest procurement gaps (from A9), not packaging gaps.

`buildNav` drops empty sections, so "no edition feels artificially limited or broken" is structural, not a promise.

---

## Licensing

- **Feature & edition entitlements:** the licensed `plan` on `presence_entitlements` → `editionFromPlan` → the feature edition → nav + gates. `/portal/context` returns `edition_key`, `edition_name`, `edition_features`, `edition_flags`.
- **Access gate unchanged:** `checkEntitlement` still governs active/paused/denied (the security boundary was not touched).
- **Founder pricing / trials / upgrade math:** already in PLANS (founder rate lock on the entitlement row, trial eligibility, rank ordering) — preserved.
- **Upgrade/downgrade paths:** `isUpgrade`/`isDowngrade`/`featureDelta` compute what's gained/lost — **data is never in the delta** (only capabilities move).
- **License/capability changes:** navigation adapts automatically on the next `/portal/context` — no reset, no data touched.

---

## Upgrade / Downgrade experience

- **CMS Only → Studio OS → Agency → Enterprise:** each step's `featureDelta.gained` is additive; `lost` is empty. Nothing resets; data is untouched; new sections simply appear.
- **Downgrade (e.g. Studio OS → CMS Only):** `featureDelta.lost` = the Business-OS areas; **the data stays** (moments/relationship rows aren't deleted) — the sections just stop showing, and re-upgrading reveals them intact. Nav adapts; no broken links (hidden hrefs are simply absent).

---

## Customer experience (per persona)

- **Freelancer** (CMS or Studio) — a complete website/operating product; would pay.
- **Agency** — the portfolio + per-client relationship + white-label; the strongest fit.
- **Business owner** (Studio) — website + calm intelligence in one; premium.
- **Enterprise** — governed multi-location; accepts the platform, still wants SSO/SOC2/SLA (A9).
- **Developer** — Developer Mode as a licensed feature area, framed by the one shell.
- **Client reviewer** — unchanged calm portal; editions don't complicate their world.

---

## Commercial review

| Edition | Plan (today) | Self-serve | Founder | Notes |
|---|---|---|---|---|
| CMS Only | *proposed rung* | yes | yes | **New** — website product for the CMS-only buyer; add to PLANS to sell. |
| Business OS Only | Monitor maps here; *proposed rung* for hosted | yes | yes | **New** — intelligence product; Monitor is the observe-only entry. |
| Studio OS | `presence` ($49/$39) | yes | yes | Flagship. |
| Managed | `presence_managed` ($149/$119) | yes | — | Person in the loop. |
| Agency | `agency` (contact) | no | — | Wholesale. |
| Enterprise | `enterprise` (contact) | no | — | Annual, defined at signing. |

**Packaging matches value:** the two axes buyers actually split on are *website* vs *business intelligence*; CMS-Only and Business-OS-Only name that split, Studio OS unifies it, and Managed/Agency/Enterprise scale the relationship. The one commercial wiring step deferred (by design — the catalog is frozen with a DB check + tests): add `cms_only`/`business_os_only` rungs to PLANS + the `plan` CHECK. Queued as FD-D1.

---

## Testing

- `editions_test.mjs` (new) **34/34** — matrix/supersets, upgrade/downgrade (+ data-never-lost), plan→edition, flags, and **every edition → complete non-empty dead-end-free nav + reachable landing**, plus backward-compat (no editionKey → unchanged nav).
- `shell` 18/18, `workspace_roles` 38/38, `platform_invariants` **14/14**, `deno check` clean.
- **Live staging:** `commerce` 13/13, `room` 38/38. Deployed staging+prod (no migration); smoke: `/commerce/plans` still 5 rungs (catalog untouched), `/portal/context` 401 gated.
- **Unchanged & verified:** permissions, visibility, tenant isolation, approval-first, publishing/preview/rollback/restore, the entitlement security gate.

---

## Feature discovery (documented, not built)

- **FD-D1 · Commercial rungs for CMS-Only & Business-OS-Only** — append to PLANS + widen the `plan` CHECK + Stripe products. *V1 (to sell them) · Low-Medium.*
- **FD-D2 · Self-serve upgrade/downgrade UI** — a plan-change screen driven by `featureDelta` (preview gained/lost before confirming). *V1.1 · Medium.*
- **FD-2 · Forms / Lead Capture** — the one packaged-but-unbuilt CMS feature. *V1.1.*
- **FD-D3 · Per-feature add-ons** — e.g. Developer Mode as an add-on to CMS-Only. *V1.1 · consider carefully (avoid nickel-and-diming the calm).* 
- **Rejected:** separate per-edition codebases/deploys/apps/navs; usage-metered feature gating (Law 20).

---

## Final Questions (answered honestly)

- **Does every edition feel complete?** **Yes** — verified structurally: each yields a non-empty, dead-end-free nav with a reachable landing.
- **Does every edition feel intentional?** **Yes** — the matrix is a deliberate superset ladder; empty sections are dropped, so nothing reads as a stub.
- **Would CMS-Only feel like a full product?** **Yes** — a complete website OS (structure, publishing, versioning, developer, client portal), no Business-OS stubs.
- **Would Business-OS-Only feel like a full product?** **Yes** — moments, connections, AI, relationship, reports; no empty website menus.
- **Does Studio OS feel premium?** **Yes** — CMS ∪ Business OS as one product, framed by the unified shell, threaded by the CRM.
- **Do upgrades feel exciting?** **Yes** — additive; `featureDelta.gained` is the honest "here's what you just unlocked," nothing resets.
- **Do downgrades behave correctly?** **Yes** — capabilities hide, data preserved, nav adapts, no broken links.
- **Does licensing disappear into the experience?** **Yes** — the customer sees an edition, not a license; nav simply is what they bought.
- **Anything confusing / missing / duplicated?** The one honest gap: CMS-Only and Business-OS-Only can't be *purchased* yet (their PLANS rungs are deferred, FD-D1) — the editions work end-to-end in the platform, the checkout doesn't offer them. Nothing duplicated; nothing confusing in-product.

The packaging goal — one platform, many editions, nav adapts automatically, every edition complete — is met.

---

**Phase D — Product Packaging & Editions complete.**
