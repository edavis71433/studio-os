# Phase CP-2 — Design Studio Completion (implementation report)

*DS-1 through DS-9 approved and shipped, plus the focal-verification the owner requested. Everything is a curated, structured choice through the ONE token/settings machinery — no raw CSS anywhere, contrast and readability preserved by construction, Developer Mode untouched as the advanced layer.*

## Shipped (all verified: business_classic 37/37, full sweep green, live both envs)

**The Design Studio card** (Business page) now offers, each as pill choices with visible current state:
- **Colors** — the 6 WCAG-validated palettes (COMP) ✓
- **Type (DS-1)** — 5 curated pairings (Classic serif, Modern sans, Editorial, Friendly rounded, Understated mono) — *system-font stacks, zero font files, zero load cost*; token regex forbids anything CSS-dangerous
- **Text size (DS-1)** — Cozy / Standard / Larger (`font_scale` → `html{font-size:calc(100% * var(--font-scale))}` — every rem scales coherently)
- **Corners (DS-3)** — Sharp / Soft / Round (`radius` → buttons/inputs directly, cards proportionally)
- **Background (DS-3)** — Bright / Warm / Cool (`bg` → each template's paper var adopts it)
- **Spacing (DS-4)** — Compact / Comfortable / Airy (`spacing_scale` → section paddings multiply)
- **Front-page layout (DS-6)** — Classic / *Photo beside text* (split hero — business-classic; the restaurant keeps its identity, documented)
- **Header (DS-7)** — Standard / Centered
- **Suggested for your business (DS-8)** — a deterministic industry→(palette+type) map ("law → Modern slate + Classic serif") with one-click Apply; instant, explainable, no model cost, owner always approves

**Your home page (DS-2)** — a sections card: show/hide + reorder About / What-you-offer / Kind-words / Questions; structured (`sections_hidden/order` → snapshot → both templates assemble parts in order); unchecked = kept, never lost.

**Focus point (DS-5) + the requested verification.** Verified honestly: templates never cropped images before, so focal alone would have been manufactured — **DS-6's split hero is the first cropping presentation**, so they shipped together: `focal_x/y` on media (migration 0057), a 3×3 "Set focus" chooser on every photo card, serializer → `MediaRef.focal` → `object-position` in the split hero (test-locked: `object-position:100% 0%` renders). Replacement (per-entity pickers) and ordering (sort orders; galleries come with blocks) verified as needing **no refinement**. Responsive crops: srcset/sizes already correct; art-direction crops = the deferred full-crop pipeline (real image-processing reason).

**DS-9 (nice-to-have tier) honestly resolved:** footer content toggles (hours/social) ✓ shipped; button outline variant → rejected (templates already deploy ghost buttons contextually; a global toggle would fight their judgment); dark-paper variant → deferred to the GM-adjacent design pass (dark needs a full inverse review, not a token flip).

**Included-because-they-fit (the owner's "naturally fits" clause):** background tone + footer toggles + the suggestion engine were exactly such items — each landed on existing rails without new architecture.

## Laws check
Approval-first ✓ (everything says publish-to-apply) · deterministic ✓ (all choices ride snapshot/tokens) · a11y ✓ (curated values only; palette contrast math still enforced; focal is presentation-only) · token architecture ✓ (extended, never bypassed) · Developer Mode ✓ (still owns raw CSS/HTML; owner writes remain tokens-only) · kits ✓ (carry ALL of it — one kit now equals a complete house style: colors + type + size + corners + background + density).

## The one final Design Studio recommendation before Gold Master QA
**A live style preview inside the Design card** — render the current draft's home page as a thumbnail beside the pills (the preview endpoint already accepts every needed parameter), so choices are seen *before* publish without opening the full stage. Small (S–M, pure UI over the existing `/preview`), it collapses the choose→open-preview→check loop into one glance, and it makes the GM browser pass itself faster. That's my one pick; everything else in the design domain is now correctly V1.1+ (dark variant, per-block layouts with FD-T5, full crop pipeline).

**Phase CP-2 — Design Studio Completion & Browser-First Authoring Excellence complete.**
