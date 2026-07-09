# Phase FE-1 — Feature Boundary Enforcement & the Two-App Product Model

*Implement → test → deploy → document. This phase made edition/feature boundaries **enforced server-side** (not merely hidden in nav) and ratified the corrected **two-app** product model. No schema change. Deployed to staging + prod.*

---

## 1. The correction (product model)

Studio OS is **two web apps**, not three — and never a separate CMS app / CRM app / portal:

1. **Freelancer / Studio App** — the operator (Eric). Manage clients; open a client and the one shell **re-scopes** to them (breadcrumb `Studio › client`). Depending on what that client purchased, the operator reaches their Website/CMS, Customers/CRM, Files/DAM, Analytics, Inbox, Approvals, Billing. Operator access is bounded by the **client's entitlement** — you cannot operate a capability the client didn't buy.
2. **Client App** — the client. Review, approve, message, upload files, see progress — and **only what their role/package allows**.

CMS, CRM, DAM, Analytics remain **internal systems / sellable editions**. They appear *inside* the two apps by **entitlement (edition) × role**, never as separate apps. This is the same one-shell model Architecture v1.0 already froze; FE-1 makes the boundary a **server-side control**, not a cosmetic one.

---

## 2. Discovery — what was found (verified in code)

| Layer | Before FE-1 |
|---|---|
| **RLS** | Enforces tenant isolation ("is this row yours"). ✔ intact |
| **Entitlement STATUS** (`middleware/entitlement.ts`) | Binary active/paused/none → full/readonly/denied on `product=presence`. Not per-feature. |
| **Drafting** (`commerce/enforce.ts` → `editor.ts`/`writer.ts`) | The **only** feature-level gate: Monitor cannot draft. |
| **`editionIncludes()`** (`commerce/editions.ts`) | Existed but was **called by nothing** — dead code. |
| **Nav** (`lib/navigation.ts`) | Correctly composes per edition — but hiding a menu is **not** security (the code says so). |

**Conclusion:** feature packaging was real and per-client in the *nav*, but at the request boundary every feature area except drafting was reachable by any active subscriber. A `cms_only` customer's browser could call `/crm`, `/moments`, `/connections`. That is the gap FE-1 closes.

---

## 3. Implementation

### 3.1 `requireFeature` + the route→feature map — `middleware/feature.ts` (new)
- **`featureForRoute(route, method)`** — pure; maps a resolved route to the **one** capability area it belongs to, or `null` for baseline/shell routes every edition may reach. Kept in lockstep with `navigation.ts` (proven by the matrix).
- **`requireFeature(edition, feature, cors)`** — reuses `editionIncludes()`; returns a **friendly upgrade 403** (`error: feature_not_in_plan`, `upgrade: true`) or `null`. Same spirit as `draftingDenial`.
- **`loadEdition(clientId, siteEdition)`** — resolves the caller-site's FEATURE edition from its entitlement plan, **failing open** to the site's natural edition (a paying customer is never wrongly denied by a lookup hiccup). One `svc` read, only when a route actually requires a feature.

### 3.2 Central gate — `index.ts`
One block after the entitlement + reviewer + monitor boundaries, mirroring how those are already done centrally:
```ts
const needed = featureForRoute(route, method);
if (needed) {
  const edition = await loadEdition(site.client_id, site.edition);
  const denial = requireFeature(edition, needed, cors);
  if (denial) return denial;
}
```
Plus: **Visual Studio generation** (`/visual/generate|vary|edit`) now also honors the **drafting** boundary, so an observe-only Monitor site cannot generate assets (reviewing existing ones stays available).

### 3.3 The feature map (route area → edition feature)
| Area | Representative routes | Feature atom |
|---|---|---|
| Website / CMS | `/publish` `/restore` `/preview` `/media/*` `/assets/*` `/site/template(s)` `/redirects` `/brand/*` `/writer/*` `/editor/*` `/review/*` `/visual/*` `/schedule`(write) `/identity`·`/voice`·`/location`(write) content collections `/foundations/dns` | `website` |
| Developer Mode | `/dev/*` | `developer` |
| Customers / CRM | `/crm/*` | `relationship` |
| Business Moments | `/moments*` | `business_moments` |
| Growth / AI brains | `/coach/*` | `ai` |
| Connected services | `/connections/*` | `connected` |
| Analytics | `/analytics*` | `reports` |
| **Baseline (always allowed)** | `/site`(GET) `/identity`(GET) inbox (`/forms/inbox`, `/approve/send`) `/notes` `/changes` `/portal/*` `/concierge/ask` `/knowledge/*` `/export` `/settings` `/monitor/*` `/foundations`(non-dns) `/marketplace/features` | `null` |

**Design invariants:** fail-open on denial (unreadable/absent entitlement → the site's natural edition); supersets (Studio OS / Managed / Agency / Enterprise) never deny; the app **shell** (bootstrap, inbox, notes, export, settings, concierge, reading business facts) is baseline and never breaks for any edition.

---

## 4. Proof — the per-edition test matrix (`tests/presence/feature_boundary_test.mjs`, 189/189)

Proves, for every edition, exactly what is allowed/denied, and that **nav and server agree**:
- **CMS-only** cannot call Customers / Moments / Connected / Coach; **can** publish, edit business info, use Developer Mode.
- **Business-OS-only** cannot publish, edit business info, reach Files/DAM, or use Developer Mode; **can** call Customers / Moments / Connected.
- **Studio OS** can call both sides (website + relationship + moments + connected + files + analytics).
- **Monitor** reaches the website surface + intelligence but not Developer Mode; generation is drafting-gated.
- **Supersets** (Managed/Agency/Enterprise) never deny.
- **Baseline shell** reachable by every edition (the app frame never breaks).
- **Nav↔server agreement:** for each edition, a `buildNav` section is present **iff** its capability routes are allowed (two independent files cross-checked).
- **Reviewer boundary:** reaches only the shared feed + the approvals put to them; denied Customers / publish / Moments / Connected / members / analytics.

**Regression:** 68 pure suites green (incl. editions 36/36 after a stale pre-v1.0-vocabulary fix, nav 3/3, workspace-roles 42/42, reviewer 22/22, scope 14/14, scoped-access 17/17, files 30/30, dam 32/32, crm 24/24, moments 23/23, connected 20/20, analytics 26/26, monitor 29/29, visual 38/38, **platform invariants 14/14**). `deno check` clean. The 4 non-pure suites (admin/pipeline/room/service) are live-integration — they skip without env, not regressions.

**Deploy:** staging (`wjlpursnwbmlcdwbeowv`) + prod (`qksstlqzbhesadrrofgn`), both confirmed "Deployed"; smoke `/connections`=401, `/commerce/plans`=200 on both.

---

## 5. Files/DAM feature ownership review (phase item #4)

**Decision: Files stays tied to `website` for now — no new atom.** Rationale:
- No edition currently **sells** DAM standalone. Every edition that includes Files also includes `website` (CMS, Monitor, Studio OS, Managed, Agency, Enterprise); the only edition without Files is `business_os_only`, which also has no `website`. So gating `/assets` on `website` is **correct and provable today**, and a separate `files` atom would change nothing about who can reach Files.
- The phase said *do not split unless required for the route gates.* It is **not** required — so it was not done.
- **Recommendation for when DAM is sold standalone (V1.1+):** introduce a `files` EditionFeature, add it to every edition that currently has `website` (so nothing regresses), change one line in `featureForRoute` (`assets`/`media` → `files`) and one in `navigation.ts` (Files section gated on `hasFiles`). ~15-minute change, fully covered by extending the matrix. Tracked as a packaging follow-up, not a blocker.

---

## 6. CRM standalone review (phase item #5)

**Decision (matches the owner's stated preference): no `crm_only` edition.**
- **Business OS** (`business_os_only`, $29) **is** the standalone Customers/CRM product — it includes the relationship center plus Moments, Connected, and Analytics. It is coherent, already priced, and already enforced (a Business-OS customer gets Customers but not the website).
- **CMS-only** ($29) remains the standalone Website product.
- **Studio OS** ($49) is the bundle ("Everything in CMS and Business OS, as one operating system").
- A narrower `crm_only` (Customers with *nothing* else) was **not** added — it isn't required, and Business OS is the better-shaped standalone. Revisit only if a cheaper Customers-only entry point is ever wanted.

---

## 7. Two-App Compliance Report

### Freelancer / Studio App (operator)
| Capability | Internal system | Gated by |
|---|---|---|
| Manage portfolio, open/​re-scope a client (`Studio ›`) | Agency orchestration | `agency` feature + agency membership |
| Website: edit, preview, publish, versions, design, developer mode | CMS + render + Developer Mode | client's `website` / `developer` |
| Customers: relationship view, timeline, notes | CRM | client's `relationship` |
| Files: photos/brand/documents, approvals, Visual Studio | DAM + Visual | client's `website` (drafting for generate) |
| Analytics: plain-English + search | Analytics + GSC | client's `reports` |
| Business Moments, Concierge, Growth Coach | Intelligence engines | client's `business_moments` / `ai` |
| Connected services | Connected Platform | client's `connected` |
| Inbox, approvals, scheduling, leads | Approval spine + commercial | baseline (scheduling write = `website`) |
| Billing | Commerce | Settings → Billing |

**Bound by the client's entitlement** when scoped in — the operator never exceeds what the client bought.

### Client App (client audience)
| Capability | Internal system | Gated by |
|---|---|---|
| Review shared updates (feed) | Workspace shares | `client_reviewer` role — `reviewerAllowed` |
| Approve plans / files put to them | Approval spine | reviewer-allowed decide/status routes only |
| Message, upload files, see progress | Workspace + DAM (shared) | role + entitlement |

Everything else in the client gate is **403** for a reviewer — the simplified client view is a **real boundary**, not a facade.

### Editions → capabilities (the matrix, enforced)
| Edition | website | developer | relationship | business_moments | connected | ai | reports |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **CMS** (`cms_only`) | ✅ | ✅ | — | — | — | — | ✅ |
| **Business OS** (`business_os_only`) | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Studio OS** (`studio_os`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Monitor** | ✅¹ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Managed / Agency / Enterprise** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (+ their extras) |

¹ Monitor observes an existing site (no publish — separate gate; no drafting/generation).

### Roles → depth (within a site, `lib/site_roles.ts`)
- **business_owner** — full. **business_staff** — operate (no delete/configure/invite). **developer** — full + Developer Mode. **client_reviewer** — the Client App: view shared, approve, comment, export shared.

---

## 8. Final CTO Review

1. **Exactly two apps from the user's POV?** Yes — Freelancer/Studio App and Client App. One shell each; CMS/CRM/DAM are capabilities inside, never separate apps.
2. **CMS/CRM/DAM enforced, not just hidden?** Yes — server-side `requireFeature` at the boundary; `editionIncludes` is now live (was dead code). Nav hiding is no longer the control.
3. **CMS sellable standalone safely?** Yes — `cms_only` reaches website + files + analytics + inbox; **denied** Customers/Moments/Connected. Proven.
4. **Business OS / Customers sellable standalone safely?** Yes — `business_os_only` reaches Customers/Moments/Connected/Analytics; **denied** website/files/developer. Proven.
5. **Studio OS bundle both safely?** Yes — superset; reaches both sides; never denies.
6. **Files/DAM ownership clear?** Yes — tied to `website` today (correct, since no edition sells DAM alone); clean one-line path to a `files` atom when it's sold standalone (documented).
7. **Server gates and navigation in agreement?** Yes — cross-checked per edition in the matrix (nav section present ⟺ routes allowed).
8. **Anything still behaves like a third app?** No — the reviewer is a scoped audience of the one Client App; the agency is a scope of the one Freelancer App.
9. **Any feature boundary still only cosmetic?** No feature *area* — all headline areas are enforced. Two documented, intentional carve-outs: `forms` (lead-capture inbox) is left baseline to avoid UI regressions (leads still require a hosted site in practice), and `client_portal`/`reports` are universal across current editions (gating them denies nothing). Both are noted, not gaps.
10. **Ready to continue implementation?** Yes — the boundary is real, proven, and live on both envs. Next steps (owner's call): the `files` atom when DAM goes standalone; otherwise nothing blocks.

---

*Stop condition honored: no migration, QA, GSC, DAM expansion, or launch-readiness work begun.*
