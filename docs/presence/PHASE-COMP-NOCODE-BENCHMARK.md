# Phase COMP — Templates, Components & No-Code Competitive Benchmark

*Benchmarked against AEM, Wix Studio, Squarespace, Webflow, Framer, Shopify, Elementor, Divi, Duda, WordPress — authoring experiences, not feature counts. This ground was mapped by T2/T4/V/O/UX; this phase's job was the sharpest remaining question: **what should ship before Gold Master QA?** Answer: the one everyday task still locked behind Developer Mode — **colors**. Shipped as FD-T6-lite. Consolidates the Template/Component/No-Code/Styling benchmarks + the Developer-Mode boundary review.*

## Implemented — **Design palettes (FD-T6-lite)**: colors are now a no-code control

The #1 finding of every styling audit this session finally shipped, the constitutional way:

- **`lib/palettes.ts`** — six designed palettes (Warm terracotta, Evergreen, Harbor blue, Quiet plum, Espresso, Modern slate), each a full token set (accent, hover shade, ink, secondary text). **Accessibility stays a platform guarantee even when the customer chooses**: every palette passes real WCAG math in tests — white-on-accent ≥ 4.5:1 (buttons), ink-on-paper ≥ 7:1 (body), on *both* templates' paper tones (34/34).
- **One machinery, two doors:** palettes write the *same theme tokens* Developer Mode uses — no duplicate styling system. `designAllowed()` lets a **business owner** write **tokens only** (their request can never touch custom CSS/HTML — a developer's work is preserved verbatim); Developer Mode keeps the full editor. Tokens ride the snapshot → deterministic render → approval-first publish → every previous look restorable.
- **Token plumbing extended additively:** `accent_dark` + `soft` join the allow-list, and the dev layer now also emits dash-cased vars (`--accent-dark`) — the names the templates actually consume — so palette hover states and secondary text recolor *correctly*, not approximately. Verified in the palette suite; devmode 41/41 + dev_render 21/21 untouched.
- **The card:** "Your site's colors" in the Business page — Original + six swatches, current selection marked, honest note when a developer has custom colors, "publish to see it live." No pickers, no hex, no CSS.

## Benchmark verdicts (delta over prior audits — full matrices live in T2/T4/V/O/UX docs)

- **Templates:** 2 shipped (business-classic default + restaurant) — correct for every industry via vocabulary; **with palettes, each now has 7 looks** (~14 visual starting points), attacking the "template gallery" gap the cheap way Phase T designed (themes multiply looks). Enough for GM QA and a founder cohort; verticals/gallery = FD-T3/T4 (V1.1). No merges needed.
- **Components:** catalog 30 · realized ~12 (business-classic's blocks + announcement). vs Elementor/Divi's hundreds: deliberately not the game — structured blocks, no page builder. Realization arc = FD-T5; differentiators FD-T14/T15 stand.
- **Styling, post-palettes:** colors ✅ **no-code now** · logo/share-image/announcement/hours ✅ · typography/spacing presets, section order/visibility, backgrounds/gradients/shadows/animations = the honest remaining Developer-Mode-or-nothing tier → FD-T6-full/T12/T5 (V1.1, unchanged).
- **Developer-Mode boundary — now exactly right:** custom CSS/HTML, raw token values, SDK structure = developer forever. Everyday authoring (facts, SEO, media, notices, **now colors**) = zero code. The boundary review's one misplacement is fixed.

## Final questions (honest)

- **Can a customer build an excellent website without code?** Yes — and as of today they can make it *theirs* in color without code either. The remaining wants (fonts, sections) are V1.1 comforts, not blockers.
- **Agency rapid production / freelancer in-browser?** Operations yes; palettes help brand-matching per client in seconds; volume reuse still = FD-18 (unchanged, top of V1.1).
- **Is Developer Mode reserved for true customization?** **Yes — as of this phase, fully.** Nothing everyday requires it.
- **What would I add before Gold Master QA?** This was it. Palettes were the last high-value, contained, constitutional pre-GM ship in the styling domain. Nothing else in templates/components/styling passes the "improves V1 without delaying it" filter — the rest is correctly queued.

**Tests:** palettes 34/34 (WCAG math + validation + dash-var emission) · devmode 41/41 · dev_render 21/21 · workspace 38/38 · full sweep green · invariants 14/14 · deployed both envs · live room 38/38 + pipeline 30/30. **Queue:** FD-T6 marked *lite-shipped* (full Studio with typography/spacing = V1.1); no new items — the domain is fully mapped.

**Phase COMP — Templates, Components & No-Code Competitive Benchmark complete.**
