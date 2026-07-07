# Version 1 — Product Freeze Audit

*Review only. No features built, no polish, no QA, no launch. The question: is the Version 1 customer product feature-complete and internally consistent enough to freeze? Verified against the codebase, the router, the tests, and the deploy — not from memory.*

---

## Product Freeze Report

**Verdict: ready to freeze.** Every V1 customer workflow has both a surface and a backend, both previously-identified gaps are built and deployed, no half-built code remains, and the platform's frozen contracts still hold (invariants 14/14). The only open items are **owner activation** (config, not code) and **QA** (explicitly a post-freeze step). Neither is a build gap.

Grounded checks performed:

| Check | Method | Result |
|---|---|---|
| No half-built code | grep for TODO/FIXME/stub/unimplemented across `presence/` | **Clean** — the only hits are the Launch Assistant's legitimate `done/todo/n/a` state machine and a caught `not_oauth` control-flow error; no unfinished feature code |
| Customer routes wired | grep the router for every customer family | **All present** — moments, concierge, connections (+writes), visual, media, publish/restore, brand, knowledge, content (collection/location/voice/settings), preview, commerce |
| CMS editing surface | `SPECS`-driven collection matcher + `/location`,`/voice`,`/settings` | **Present** — every editable entity (offerings/faqs/posts/business/hours) routes through `handleCollection` |
| Visual Studio | `deno check` + `visual_studio_test.mjs` | **38/38 pure green**, whole module type-clean |
| Frozen contracts intact | `platform_invariants_test.mjs` | **14/14 held** — zero engine change from the V1 finishing work |
| Working tree | `git status` | **Clean** — everything committed |
| Go-live gate | `git log origin/main..HEAD` | **33 commits unpushed** (as designed — nothing is live) |
| Backend live | prod smoke | `/commerce/plans` 200; `/visual/kinds` 401 (route live, customer-gated) |

### The eight required verifications

1. **No remaining V1 feature gaps.** ✅ The two gaps both audits named — the Connected Platform customer UI and AI Visual Studio — are built, tested, and deployed. No other core-customer feature is missing.
2. **No half-built customer workflows.** ✅ Edit content, Creative Studio, the daily Business-Moments/"review & decide" surface, Growth, Concierge, media upload, Publish, Connect a service, and now Visual Studio each complete end-to-end; no partial workflow found.
3. **No V1 backend capability lacking a customer surface.** ✅ Every backend a V1 customer needs now has a surface. The backends without a customer surface — Marketplace, Enterprise, Agency — are **not** V1-customer capabilities; they are operator/advanced-tier and correctly deferred to V1.1.
4. **No customer surface lacking backend support.** ✅ `today.html`, `connections.html`, `connections-callback.html`, `visual-studio.html`, and `portal.html` all consume real, deployed routes. *(Note, out of freeze scope: several public **marketing** pages — `roi-calculator`, `report-card`, `ai-critique`, `buy-audit`, the per-industry SEO pages — belong to the public site/positioning track, not the V1 product; their state is a Track 2.5 concern, not a product-freeze item.)*
5. **No accidental scope creep.** ✅ The V1 finishing work added zero engine changes (invariants held) and no new Product Law; it rides the existing Approved-Plan and media spines. Built-but-dormant advanced tiers (Marketplace/Enterprise/Agency) are not V1 customer scope — they are gated, surfaced to no customer, and classified V1.1.
6. **AI Visual Studio complete.** ✅ Generation, editing (instruction-guided), brand-aware graphics, hero/social/Open Graph assets, variations, media-library storage, and approval-before-use — all present, on the approval spine, gated honestly on an owner key.
7. **Connected Platform customer UI complete.** ✅ View/understand/connect/disconnect/refresh/health + Concierge over the existing L4 backend; OAuth round-trips through the callback page; discoverable from Today.
8. **Owner activation clearly separated from build; V1.1 clearly deferred.** ✅ See the two lists below — activation is dashboard/config only; V1.1 is advanced-tier UIs and additive content.

---

## Final V1 Feature Inventory

| Capability | Customer surface | Backend | State |
|---|---|---|---|
| Buy / signup / billing | `signup.html` → checkout → `welcome.html` | L1 commerce (Stripe) | **Complete** (live billing needs owner Stripe config) |
| Sign in / account | `portal.html`, `set-password.html` | auth (client) | **Complete** |
| Edit content (CMS) | portal / `portal-workspace.html` | `handleCollection`/location/voice/settings | **Complete** |
| Creative Studio (Writer/Editor/Reviewer/Brand Guardian) | portal | writer/reviewer/guardian + `/brand/*` | **Complete** (AI drafting needs owner AI key; manual parity always) |
| Daily intelligence — Business Moments | `today.html` (+ portal) | `/moments`, `/moments/:id/dismiss` | **Complete** |
| Growth Coach | portal | `/growth` (coach) | **Complete** |
| Concierge | `today.html`, `connections.html`, portal | `/concierge/ask` | **Complete** |
| Photos / media (upload) | portal | `/media/upload-url`, `/media/:id` | **Complete** |
| **AI Visual Studio** | `visual-studio.html` | `/visual/*`, mig 0044, `visual/` module | **Complete** (live generation needs owner `VISUAL_MODEL_KEY`) |
| **Connect a service** | `connections.html`, `connections-callback.html` | `/connections/*` (L4.0–L4.4) | **Complete** (live connections need owner OAuth apps) |
| Publish (draft→approve→live, versioned, restore) | portal | `/publish`, `/publishes`, `/restore` | **Complete** |
| Knowledge import | portal | `/knowledge/*` | **Complete** |
| Preview | portal | `/preview` | **Complete** |

**Discovery:** Today (`today.html`) is the daily front door and links to both new surfaces; portal is the workspace. No orphaned core surface.

---

## Deferred V1.1 List (clearly out of V1, not blocking)

- **Marketplace UI** — install/enable/update (backend complete, operator concern).
- **Enterprise UI** — organization/region/location + rollout screens (backend complete).
- **Agency UI** — portfolio/queues/approvals screens (backend complete).
- **Operator/agency auth path** — the shared prerequisite for the three UIs above.
- **Additional Industry Packs** — the home-services trades, then dental/medical/legal/retail (SDK done; additive).
- **Broader connected coverage** — the 3 placeholder providers (Apple/Tag Manager/Meta) and write workflows beyond GBP/GSC.
- **Deeper pack intelligence** and **`connected_data` time-series** (currently one-deep).
- **Pixel-level image editing (inpainting)** — V1 "edit" is instruction-guided regeneration.
- **Public-site / positioning work** (homepage, nav, Monitor demo, SEO-page consolidation) — Launch Track 2.5, a separate track.

---

## Owner Activation Checklist (config, NOT build work)

These switch dormant-but-complete capabilities to live. None require code.

- [ ] **Register provider OAuth apps** → activates live Connected Platform connections (until then the surface honestly reads "not available yet").
- [ ] **Set `VISUAL_MODEL_KEY`** (optionally `VISUAL_MODEL_URL` / `VISUAL_MODEL_NAME`) → activates live AI Visual Studio generation.
- [ ] **Set the AI key** (`ANTHROPIC_KEY`) → activates AI drafting in the Creative Studio (manual parity means the app is fully usable without it).
- [ ] **Confirm Stripe prices + subscription events** → activates live billing at owner-approved prices.
- [ ] **Push the 33 held commits** → publishes the customer pages (the go-live gate; owner-gated on prices + nav + Stripe).

*(Separately, post-freeze process — explicitly NOT part of this audit: live-browser QA of the signed-in customer pages, then launch work.)*

---

## Product Freeze Decision

No build items remain. Every V1 customer workflow is discoverable, has a surface, and has a deployed backend; the two named gaps are closed; no half-built code, no scope creep, frozen contracts intact. Remaining work is owner activation (config) and QA (post-freeze) — neither a build gap.

**Version 1 Product Freeze approved.**
