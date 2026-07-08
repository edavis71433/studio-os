# Phase T4 — Enterprise Authoring Benchmark & Capability Optimization

*AEM Sites as the enterprise benchmark; Webflow/Wix Studio/Squarespace/Shopify/Gutenberg/Duda/HubSpot/Framer/Contentful/Sanity as the field. Question: what should Studio OS expose to make everyday website management EASIER than competitors while preserving the Constitution? Run immediately after T3 (business-classic shipped), so the state below is current.*

---

## Executive summary

Against AEM specifically, Studio OS already matches or beats the capabilities that matter to its market — versions/restore/preview/scheduling/approval workflows/structured authoring/governance — **at a fraction of the operational weight** (AEM needs authors trained for weeks; Studio OS needs none). The AEM capabilities genuinely missing are the **enterprise authoring conveniences**: Launches (FD-T7, queued), named versions + comparison (FD-7/FD-12), and content-reuse across sites (FD-18/FD-B5 — the same reuse gap every audit converges on). The template/component audits confirm T3's strategy holds (two templates + themes > many templates; catalog realization > catalog growth). The customer-workflow finding: the remaining "using software" moments are the V1.1 shape-tier (design studio, sections) plus the still-unbuilt digest/notify polish. **Nothing new qualifies for immediate implementation that isn't already tracked — T3 just shipped this milestone's biggest item; the queue is the correct home for the rest.** No new V1 blockers.

## 1 · Template ecosystem (page-type audit)

| Page type | State |
|---|---|
| Home / offerings / about / FAQ / contact / blog+posts / 404 / thank-you | ✅ both templates ship them |
| Legal pages (privacy/cookie) | ❌ — **already the tracked FD-M3 (V1 candidate)**; T4 confirms it's also the page-type gap |
| Landing/campaign pages · coming-soon · search page | ❌ — landing pages = FD-U (arbitrary pages, V1.1); coming-soon = cheap template state (queued note in FD-U); on-site search = reject for V1 (5-page sites don't need it; sitemap+SEO suffice) |
| Portfolio | covered by business-classic (offerings-as-work) until a vertical look (FD-T4) |
| More templates? | **No** — themes (FD-T3) multiply looks; AI already "chooses" via deterministic default-by-industry (better than model choice); components shared via the catalog pattern. |

## 2 · Component library

Catalog (30) covers the entire T4 list except **event cards** (have: events block ✓), **comparison tables** (queued below), and **layout *variations* per block** (one layout each today — variations fold into FD-T5 realization + FD-T3 themes). Invention over imitation stands as FD-T14 (trust/guarantees, availability/emergency banner, business timeline, review highlights) + **new FD-T15: comparison table + pricing-calculator-lite** (structured inputs → deterministic table; calculators only as fixed-formula data, never runtime code). Emergency banner = announcement variant (FD-T14). Holiday hours ✅ built.

## 3 · No-code editing

Post-V/T3 state: favicon ✅ (logo), OG image ✅, announcement ✅, hours/holiday ✅ (+ typical-hours), service areas ✅ (text; structured = catalog), SEO fields ✅ (site-wide; per-page = FD-N8), schema selection ✅ **better than everyone** (industry-derived, zero user effort — AEM makes this a developer task), accessibility helpers ✅ (guaranteed, not helped). Remaining button-gaps unchanged and queued: crop/focal/replace-image/overlays/backgrounds (FD-T11), icon picker + color/typography presets + button styles (FD-T6), section visibility/order + layout variations (FD-T12/T5), redirects UI (FD-N7).

## 4 · AEM feature benchmark (the headline table)

| AEM capability | Studio OS | Verdict |
|---|---|---|
| Page versions + restore | every publish versioned, 1-step restore | ✅ **exists — simpler than AEM** |
| Named versions | — | queued FD-7 (V1.1) |
| Version comparison (Timewarp-ish) | change-summary sentences exist; visual diff — | FD-12 (V1.1); history ledger ✅ |
| Preview (as-if-live) | pixel-perfect via production renderer | ✅ exists |
| **Launches** | one draft lane only | **FD-T7 (V1.1)** — the bounded single-lane Launch; T4 confirms it as the #1 AEM-class gap |
| Scheduled publish/unpublish | ✅ + UI | ✅ exists |
| Multi-Site Manager | org→region→location inheritance (enterprise) covers the governance half; content-sync across sites — | partial; content-reuse = FD-18/FD-B5 (V1.1) |
| Content reuse | none (the reuse gap) | FD-18/FD-B5 — elevated again |
| Structured authoring | the whole architecture | ✅ **better** (enforced, not optional) |
| Metadata editing | site-wide ✅; per-page FD-N8 | mostly exists |
| Image authoring | upload/alt/variants ✅; crop/focal FD-T11 | improve (V1.1) |
| Asset management | library ✅; folders/brand kit FD-20 | improve (V1.1) |
| Content governance + approval workflows | approval-first EVERYWHERE + roles + audit ledgers | ✅ **better** — AEM's workflows are configurable; ours are constitutional |
| Accessibility tooling | not tooling — **guarantees** (template-enforced, test-locked) | ✅ better philosophy |
| Reject | runtime componentization / client-side personalization / free-form authoring | conflicts with determinism + calm laws |

## 5 · Freelancer workflow

Repetitive work remaining: branding per client (FD-T9 logo→brand-kit + FD-T6), configuration per client (**FD-18 starter kits/duplication — again the top V1.1 item**), component packs (SDK, V1.1 packaging), bulk edits (reject for V1 — item lists are small; agency bulk ops exist for operations). One-click branding = FD-T9. Saved configurations = FD-B5. T4 adds nothing new here — it re-confirms priority.

## 6 · Customer workflow ("software" moments)

Remaining places a customer feels software instead of a studio: choosing among empty design options (fixed when FD-T6 ships **curated** presets — fewer choices, more guidance), the secondary-page nav inconsistency (FD-M12), and silence between visits (FD-5 digest — guidance arriving *to* them). All tracked; the guided first-run (Phase I) + starter draft already carry the studio feel through the critical first hour.

## 7 · Implementation this phase

**None beyond T3's ship** — correctly. T3 implemented this benchmark's single biggest item (the neutral production template) minutes before this audit; every remaining recommendation is already queued with an owner and a tier, and re-implementing "small wins" here would have duplicated tracked items rather than closed new ones. Queue delta from T4: **FD-T15** (comparison table + fixed-formula calculator blocks) + a coming-soon note folded into FD-U.

## Final questions (honest)

- **Compete with AEM on authoring quality while dramatically simpler?** **Yes, for its market.** Versions/preview/scheduling/approvals/governance are at parity or better with zero training burden. The honest AEM deltas — Launches, named versions/diff, cross-site reuse — are queued V1.1 conveniences, not authoring-quality gaps.
- **Business owner manages a whole site without HTML/CSS?** **Yes** (post-V/T3): every everyday task is a control, and now every industry renders correctly.
- **Freelancer faster than competitors?** First site yes; portfolio no until FD-18 — unchanged, elevated.
- **Agencies scale efficiently?** Operationally yes; authoring-reuse is the limiter (same answer).
- **Templates production-ready?** **Yes** — two shipped, correct, tested; variety comes from themes.
- **Components complete?** Catalog yes; realization 2/30 (announcement + business-classic's built-ins) — FD-T5 is the arc.
- **Next structured no-code capability?** **FD-T6 Design Studio** (the single most-wanted), then FD-T12 sections, then FD-T11 images.
- **Absolutely V1 before launch?** Unchanged: owner activation, browser QA, the push, front door — plus FD-M2 (rate limiting) and FD-M3 (legal pages) as the two engineering V1 candidates still open.
- **Developer Mode forever?** Raw CSS/HTML, custom tokens beyond curation, SDK-authored templates/components/schema. That boundary is right and constitutional.

**Phase T4 — Enterprise Authoring Benchmark complete.**
