# Phase SD — Search, Indexing & Discoverability (implementation report)

*SD-1..10 approved and shipped as one cohesive Search & visibility experience (redirect work folded in). Philosophy held throughout: every control answers a human question — the words "noindex," "canonical," "robots," and "meta" appear nowhere a customer looks. SD-5 (the Search Console connected provider) keeps its documented engineering sequencing — after Playwright, so a browser suite guards the new OAuth surface.*

## Shipped (verified: business_classic 42/42, lifecycle 16/16, full sweep green, live both envs)

**SD-1 · "Which pages should show up on Google?"** — checkboxes per page (offerings/about/questions/updates/contact) and a per-post control; off = `noindex` meta + sitemap exclusion, page stays on the site. Home always shows. Copy: *"Hiding a page keeps it on your site — it just stops appearing in search results."* (`settings.pages_noindex` + `posts.noindex`, migration 0058; both templates; golden stable — defaults unchanged.)

**SD-2 · The Search & visibility card** — health as honest sentences: "Google can read your site — sitemap, page details, and your **Plumber** listing info are built in automatically" ✓ · search headline/description set ✓/fix-hint · Search Console connected ✓/fix-hint · Bing/Copilot ✓ when set · live link results. Yoast's traffic lights, replaced by prose.

**SD-3 · External-link watch** — the health card live-HEAD-checks every rot-capable link (booking, ordering, socials, announcement, external redirect targets — the *only* links that can break, since internal links are correct by construction): *"Your booking link isn't answering."* Fenced, 4-second timeouts, HEAD-with-GET-fallback for hosts that refuse HEAD.

**SD-4 · The search nudge** — one lifecycle notice + email, once ever per client (`period: 'once'` dedupe): published site + no verification code → *"One small step gets you into Google's reports"* — deep-linkable to the exact field via the CP-2.6 hash routes. NAP drift-watch and domain-expiry Moments ride their approved CP-7/CP-8 builds.

**CP-6 folded in · Redirects + per-page search wording** — *"Moved from an old website? Forward old page addresses"* (add `/old-page/` → `/services/` or https; 50 cap; reserved-path + format validation in plain words; delete anytime; rows always shipped in the snapshot — now ownable) and *"Fine-tune how each page reads in search results"* (optional per-page headline ≤60 / description ≤160; blank = the good defaults).

## Honest scope notes
- **SD-5 (Search Console provider)**: approved, sequenced after Playwright by stated engineering reason (new OAuth surface deserves the suite). It remains the CTO pick and the flagship "page not indexed" Moment's prerequisite.
- Content-freshness nudges: **not** built as a new system — the growth coach already owns cadence; duplicating it would violate the no-duplication rule.
- One sweep-logic bug caught mid-build by review: the search nudge was initially unreachable for healthy customers (placed after an early-continue) — fixed before commit, lifecycle 16/16.

## Final questions (honest)
- **Fully manage search visibility without code?** Yes — visibility, wording, forwarding, verification: all sentences and toggles.
- **Control whether a page appears on Google?** Yes — one checkbox, honestly explained.
- **Outperform by simplifying?** The structural story (correct-by-construction schema/links/canonicals) + the human-question layer is now something none of the nine benchmarked tools offers: they audit for problems; Studio OS can't have most of them and *says so in plain English*.

## Post-phase review (the standing lens)
The naturally-revealed item: **the Search & visibility card's health sentences and the Foundations Desk's domain/email sentences are sibling experiences on different pages** — a customer asking "is everything okay?" checks two places. The natural (small) improvement: a one-line **"everything is healthy" rollup** on Today that links to whichever desk needs attention — evidence: Today already hosts Moments and the plan-notice card, so a third calm line fits the existing rail. Effort S. **Recommended, not built — awaiting approval** (it touches Today's calm, which deserves deliberate consent).

**Phase SD — Search, Indexing & Discoverability Excellence complete.**
