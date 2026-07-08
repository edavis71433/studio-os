# Phase SD — Search, Indexing & Discoverability Excellence: Audit & Recommendations (AWAITING APPROVAL)

*Audit-only; NOTHING implemented. Verified against code (never assumed); benchmarked vs Search Console, Yoast, RankMath, Squarespace, Wix, Shopify, Webflow, AEM, HubSpot. Overlapping items already owner-approved in Phase CP (CP-6 redirects UI + per-page SEO overrides, CP-7 NAP drift-watch, CP-8 domain expiry watch) are folded in, not double-counted.*

## Verified state — what's already excellent
Schema/canonical/OG/sitemap/robots emitted **by construction**, industry-true JSON-LD (T3), verification = two browser fields (Z), alt text enforced + editable (O), thanks-page noindexed, publish validation already warns on empty search titles/descriptions, redirects engine + snapshot support (UI pending = CP-6), media SEO done (variants/webp/lazy/dims). **New structural finding this audit: internal links cannot break** — every internal href targets the fixed page set or post slugs from the *same snapshot*, so "broken internal links," a whole Yoast/Screaming-Frog category, is architecturally impossible here. Only customer-*entered* URLs (booking, ordering, social, announcement link, redirect targets) can rot.

## THE RECOMMENDATIONS

### 🔴 Required before launch

| # | Recommendation | Evidence · competitor · benefit | Effort | Risk |
|---|---|---|---|---|
| **SD-1** | **"Show this page on Google?" toggles** — plain-English per-page visibility (fixed pages + per-post): off = `noindex` meta + sitemap exclusion, on by default. `settings.pages_noindex[]` + a post field; both templates consume | Verified: zero customer control today (only /thanks/ is system-noindexed). Every competitor exposes this as scary "noindex" jargon; ours is a sentence. The milestone's marquee ask | **S–M** | Low — the thanks-page pattern, generalized |
| **SD-2** | **The Search health card** — plain-English checklist in the workspace (Search & discovery group): verification set ✓/✗ (with the one-field fix inline), sitemap ✓ (always), search title/description ✓/✗ (from existing validation), industry schema ✓ (named), "AI-search ready ✓" (honest: cites the by-construction facts) | Today the pieces exist but nothing SAYS "your search setup is complete." Yoast's traffic lights, replaced by honest sentences | **S–M** | Trivial — derived read-only |
| **SD-3** | **External-link watch** — one evidence rule: HEAD-check customer-entered URLs (booking/ordering/social/announcement/redirect targets) on the existing cycle → calm Moment "your reservation link isn't answering" | Verified: the only rot-capable links. A dead booking link silently costs real money; nobody notices without this | **S–M** | Low — evidence-engine pattern (fence + timeout exist) |
| **SD-4** | **Search Moments** (the material three): verification-missing (one calm nudge with the field deep-link — now hash-routable to #business), NAP mismatch (=CP-7, approved), domain expiry (=CP-8, approved) | Moments are the platform's voice; these three are the search failures a customer can actually act on | **S** (on top of CP-7/8) | Low |
| *(CP-6)* | Redirects UI + per-page SEO title/description overrides | already approved — build with SD-1 (same surfaces) | S+S | Low |

### 🟠 Strongly recommended (size, not value, is the reason)
**SD-5 · Google Search Console as a connected provider** — OAuth read of indexing status + top queries through the EXISTING connected-platform registry: powers "page not indexed" Moments and turns the health card from "configured correctly" into "verified working in the wild." Bing Webmaster same pattern later. Effort **L** (~2 days, a full provider); architecture-perfect fit; sequence **after Playwright** so a suite guards it. This is the biggest remaining gap: today "is my site actually indexed?" is unanswerable in-product.

### 🟡 Nice: content-freshness nudge (fold into existing growth-coach cadence, not a new system).
### ⚪ Future: Bing/Apple sync providers (FD-Z4) · schema *validation* service (ours can't emit invalid schema — validation would test the generator, which tests already do).
### ❌ Reject (with reasoning): canonical selection (auto-correct by construction; exposing it = inviting mistakes) · crawl-budget anything (10-page sites) · duplicate-content tooling (architecture prevents it) · llms.txt (Google explicitly says unnecessary — stays rejected, not reopened) · exposing robots.txt/meta-robots editing (SD-1's sentence IS the safe version).

## Step 4 Business-Moments verdict
Recommended: verification-missing · NAP mismatch · domain expiry · dead external link (SD-3/4). Rejected as moments: missing title/description (publish validation already catches it at the right moment — before publish, not after), schema problems (can't occur), not-indexed (needs SD-5 first — becomes its flagship moment).

## Final CTO review (honest)
- **Fully manage search visibility without code?** After SD-1: **yes** — the last search concept a customer might touch becomes a sentence with a toggle.
- **Control whether a page appears on Google?** Today: no (verified). After SD-1: one plain-English switch.
- **Understand every setting without SEO knowledge?** Yes — that's the design: questions in their language, implementation in ours.
- **Outperform by simplifying?** Already structurally true (schema/canonical/links correct by construction — the competitors' checklists test for problems we cannot have); SD-1..4 finish the *visible* story.
- **CTO's ONE pick, no deadline: SD-5 (Search Console provider).** Everything else configures search correctly; SD-5 is the only thing that can *prove it worked* — real indexing data, real queries, and the "page not indexed" Moment that closes the loop between publishing and being found. It's also the natural first exercise for the connected-platform registry post-Playwright.

**Phase SD — Search, Indexing & Discoverability Excellence audit complete.**

**AWAITING IMPLEMENTATION APPROVAL** — "approve SD-1..4" (required tier, ≈1 day, includes the already-approved CP-6/7/8 as one build), "+SD-5" (adds ~2 days, sequenced after Playwright), or your own list.
