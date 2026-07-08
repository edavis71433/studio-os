# Phase SKU — Standalone Product Experience & Packaging

*The test: pretend the business sells three products — CMS, CRM (Business OS), Studio OS — and each must feel intentionally complete, never "the full platform with features removed." I audited the entitlement/edition model and every signed-in surface per edition. The packaging model is genuinely strong (editions as pure data, nav derived from them, upgrades only add). I found **one real standalone leak** — the CMS workspace showed Business-OS "brains" the CMS doesn't include — and closed it. The public pricing page is under the launch fence and was audited, not touched.*

## Step 1 — Discovery (verified)
The three products map to real, pure-data editions (`commerce/editions.ts`):
- **CMS** = `cms_only` = website · developer · forms · client_portal · reports. Capacity: `allowsDrafting: true` — **full website drafting AI**, no Business-OS brains.
- **CRM / Business OS** = `business_os_only` = business_moments · connected · ai · relationship · reports · client_portal. Capacity: `allowsDrafting: false` — intelligence only, no site drafting.
- **Studio OS** = `studio_os` = the union.

Navigation (`buildNav`) is derived from the edition — a capability the edition lacks simply doesn't appear (no locked items, no dead menus), and `landingFor` sends CMS to `/presence.html` and Business-OS/Studio to `/today.html`. This is the right foundation: each edition's *navigation* already feels intentionally designed, not stripped.

## Step 2 — CMS standalone audit → the one real leak, closed
Becoming a CMS customer (`cms_only`, landing on `presence.html`), the nav is clean — but the **workspace home itself leaked Business-OS surfaces** the CMS doesn't include, because `presence.html` had almost no edition awareness (it only special-cased `monitor`):
- **Business Moments** rendered in the home tab (`business_moments` — not in CMS).
- A **Connections** link (`connected` — not in CMS).
- A **Visual Studio** link (`ai` image brains — not in CMS).
- The Studio Desk's **"Plan"** option = the Growth Coach (`business_moments` — not in CMS).

That's Step 2's question — *"does anything reference CRM/Studio OS?"* — answered **yes**. A CMS customer saw the Business-OS product showing through.

**Closed (frontend-only, zero backend change):** `presence.html` now reads the feature edition from `/portal/context` (`edition_features`) and gates those four surfaces:
- Moments render only when the edition includes `business_moments` (CMS falls back to the concierge-notes home);
- the Connections / Visual Studio links hide unless the edition includes `connected` / `ai`;
- the Studio Desk omits "Plan" unless the edition includes `business_moments`.

Website drafting/review/polish AI **stays** — the CMS legitimately includes it (`allowsDrafting: true`), so it was never a leak. **`studio_os` has every feature, so this gating is a no-op for every current customer** — real improvement for the CMS SKU, zero regression risk for the platform.

## Step 3 — CRM (Business OS) standalone audit
Becoming a `business_os_only` customer (lands on `today.html`): the experience is genuinely a Business-OS product — Moments hero, Concierge, relationship view — with the website nav correctly absent. Complete and on-identity. One minor residue (recommended, not fixed): Today's *empty-state* card ("All clear") links to "Open your website" / "See your leads", which a website-less CRM customer shouldn't see. It only appears when there are zero moments, and a Business-OS account may still be observing a site, so it needs a small edition-aware tweak rather than a blind removal — queued.

## Step 4 — Studio OS
With everything on, the surfaces compose exactly as the union implies — the CMS home shows Moments/Connections/Visual Studio again, the Business-OS brains sit alongside the website workspace, and (from Phase OS/FLOW) the bell + Today concentrate "what needs you." Upgrading from CMS *adds* the brains; upgrading from CRM *adds* the website — each upgrade is additive, never a repair. `featureDelta` already powers an honest in-product upsell (gains computed from the matrix, never overpromised).

## Steps 5–6 — Pricing & cross-product (audited; fenced/clean)
The public pricing page and pricing copy are under the standing public-site fence — audited only. The signed-in upsell (`/portal/context.upsell` → the Today plan card) is honest and edition-derived; no duplication found. Data always flows (an upgrade adds capability, never migrates or loses data — `featureDelta` never lists data as gained/lost).

## Testing
`editions` 36/36 · `nav_integrity` 3/3 · `shell` 18/18 · `workspace_roles` 38/38 · `platform_invariants` 14/14 · `commercial` 40/40 · `crm` 24/24 · `lifecycle` 22/22 · `render` 28/28 · `business_classic` 42/42. `presence.html` inline script parse-verified. Frontend-only — no migration, no function deploy; follows the UI-staging pattern (committed, unpushed under the fence). Gating defaults to all-features-on when no edition entitlement is recorded, so `studio_os` behavior is unchanged.

## Step 9 — CTO review: one improvement per product (recommended, not built)
- **CMS stronger:** a first-run **CMS-only onboarding + empty states** that speak purely in website terms (pages, publishing, domains) — so a new CMS customer never sees a Business-OS word even in guidance. (The runtime leak is now closed; this is the onboarding-copy layer.)
- **CRM stronger:** make Today's empty-state ("All clear") **edition-aware** — drop the website/leads links for a website-less Business-OS account, and point instead at the relationship view / connections.
- **Studio OS stronger:** an **upgrade moment** — when a CMS or CRM customer first lands after upgrading, a one-time calm card naming exactly what just became available (from `featureDelta`), so the upgrade *feels* additive at the moment it happens.

## Final questions (answered honestly)
- **Would I confidently sell only the CMS?** Now yes — the workspace references only website + drafting, the leaks are gone, and it has real capability (structured content, versioning, publishing, drafting AI, forms, client sharing). The remaining polish is onboarding copy, not capability.
- **Would I confidently sell only the CRM?** Yes — it's a coherent Business-OS product (Moments, Concierge, relationships, connections) that never mentions publishing or templates in nav. The one empty-state nit is recommended above.
- **Would I confidently sell Studio OS?** Yes — it's the honest superset, and upgrading into it is additive.
- **Would customers feel they bought a complete product?** Yes for CMS and Studio OS today; yes for CRM with the small empty-state tweak.
- **Would upgrading feel additive rather than fixing something missing?** Yes — the matrix guarantees upgrades only add, and the upsell shows gains, not lacks. The recommended "upgrade moment" would make that *felt*, not just true.
- **Do all three have clear identities?** Yes — CMS ("a website that stays correct"), Business OS ("know your business at a glance"), Studio OS ("your website and your business, one calm operating system") — and the workspace now honors those boundaries at runtime.
- **Anything left preventing world-class standalone products?** Nothing at the capability level. What remains is presentation polish (per-edition onboarding copy, the CRM empty-state, the upgrade moment) — tracked above, none of it a gate.

**Phase SKU — Standalone Product Experience & Packaging complete.**
