# M8 — Trust Layer & Product Polish · Report

Scope honored: zero API, schema, renderer, pipeline, or route changes. All work in `presence.html` presentation + this report. Constitutional note: the brief's "Presence Score improvement" success-state example conflicts with frozen Product Law 13 (no client-facing scores; health is a sentence) — **not built**, flagged. All other success states implemented from existing data.

## 1 · Screens reviewed (all)

Today · Business · Menu · Questions · Kind words · Updates · Photographs · History · Publish ritual (empty / changes / blockers / publishing / receipt / failure) · Proofing desk · Restore letter · Photograph picker · Sections sheet · First-run envelope · Signed-out, not-ready, paused, failed-load gates · Mobile dock · Toasts and whispers.

**"Software or business?" audit result:** post-M7.5, no screen reads as developer software. M8 removed the last traces: amber small-text lightened contrast masking a jargon check (none found), all remaining labels are merchant words. The one intentionally "technical-looking" element is mono timestamps in History — kept, they are ledger language, not developer language.

## 2 · Improvements made (by brief section)

**Empty states** — Questions / Kind words / Updates estates gained a direct ink action ("Answer the first question", "Keep the first kind word", "Write the first update") wired to the existing add flows; every estate now shows the finished artifact ghosted, explains why the section exists, what success looks like, and the exact next step. Photographs and History estates already complied.

**Loading** — boot now opens with "Setting the table…" + shimmer hairline in the Today slot (no blank screen before data); History "Opening the journal…", ritual "Reading over your draft…" already present. Design law kept: warm line + shimmer, never a generic spinner, never fake skeleton content.

**Errors** — offline guard added at the API layer: "You look offline. Everything you saved is safe — it'll be here when you're back." Every failure surface re-audited for the three answers (what happened / is my work safe / what next); all lead with what's safe. No technical words anywhere client-facing.

**Success states** — first publish now gets its own receipt: "You're on the internet." with the business named ("Marlow's Kitchen has a home now — and every word of it came from you"). Domain connection gets a one-time quiet toast when a custom domain first appears ("marlowskitchen.com is yours now"), remembered locally so it never repeats. Presence Score: refused per Law 13. First-visitor and anniversary: future/no data — not invented.

**Consistency** — one radius family (4px stationery / 100px pills), one shadow (paper drop, overlays only), one motion curve and duration pair, serif=meaning / sans=mechanics / mono=timestamps everywhere, purple only as link + unpublished wash, amber small text darkened to `--amber-text` for contrast, `button:disabled` state defined once.

**Accessibility** —
- Keyboard: focus is captured on open and returned on close for every overlay (sheets, ritual, desk); Esc closes everything including inline editors; visible focus rings, with a paper-white ring variant on the espresso desk.
- ARIA: dialogs carry `role="dialog" aria-modal` with labels; toasts and the save whisper are `aria-live="polite"`; nav marks `aria-current="page"`; desk toggles carry `aria-pressed`; dish rows are buttons labeled "Edit {name}"; photograph remove buttons name their photo.
- Contrast: ink 15.2:1, ink-2 4.6:1 (AA), amber small text moved from 3.2:1 → 4.9:1 (`#8a5c07`), sage/clay used at large sizes only, desk chrome ≥ 4.5:1.
- Touch: coarse-pointer media query gives quiet text actions 8px padding (≥40px targets), menu reorder arrows widen, photograph deletes stop hiding behind hover.
- Reduced motion: single global kill switch verified across the new view/receipt/letter animations.

**Mobile** — ≤400px (SE-class): hours rows wrap with the Closed control on its own line, statement steps to 22px, journal label column narrows. ≤760px: desk hides the page-word row (navigation happens by tapping links inside the proof) and the privacy caption; dock unchanged. Layout measured overflow-free (documented headless-DPI artifact aside): `scrollWidth == clientWidth` at mobile widths.

**Trust** — the ritual now states the atomic promise under its actions: *"Publishing replaces your live site all at once — never partially, never halfway. Every version is kept, and any of them can come back."* The desk carries *"A private proof — only you can see it."* Restore, History, Business, and the publish flow already explained their boundaries (M7.5); re-audited, no button on any screen acts without first saying what it will do and what is recoverable.

**Delight** — view transitions fade up 5px/200ms; letters lift 1px on hover; the receipt settles in with a 320ms stamp-in; dismissed letters slide away; everything behind the reduced-motion switch. Nothing loops, nothing bounces, nothing gamified.

## 3 · Before / after

Before = M7.5 screenshots (session artifacts `a-*.png`), after = M8 (`m8-*.png`). Representative delta captured: the publish ritual now carries the trust promise line and correct singular grammar ("One change… Publish this change"), with visible keyboard focus on entry. Most M8 changes are behavioral (focus, ARIA, offline, empty-state actions) and textual; visual deltas are intentionally subtle.

## 4 · Performance (measured 2026-07-06)

| Measure | Value | Note |
|---|---|---|
| presence.html | 92.9 KB | one file, no framework, no build step |
| supabase-js CDN | 201.3 KB raw | the only script; loaded at end of body, cached cross-site |
| Google Fonts CSS | 3.0 KB + `display=swap` | text paints in system faces first — first paint never waits on fonts |
| API latency, prod edge (median of 3) | 132 ms | staging 218 ms |
| Boot requests | 1 page + 2 asset + 10 API | the 10 API calls run as two parallel waves (7 + 3) |
| Interaction latency | keystroke→save is debounced 600–700 ms by design; UI feedback immediate via whisper | optimistic rendering on every toggle/edit (state mutates locally from the API's returned row) |
| Large collections | menu render is a single pass over ≤100 items (manifest cap); no virtualization needed at contract limits | |
| Animation | CSS-only transforms/opacity, compositor-friendly; zero JS animation loops | |

No optimization was needed beyond what the architecture already provides; the page is static HTML with the CDN script deliberately last.

## 5 · Regression

Backend untouched this milestone. Room API suite re-run against staging after all changes: **38/38 PASSED** (includes the full publish → mutate → restore e2e with a real Netlify deploy). Prior M7 suites (renderer 28, service 22, RLS 29, retention 12, pipeline 30, admin 51, smoke 15) stand against the unchanged backend at `e8542bc`.

## 6 · Final product review — six chairs

- **UX designer:** hierarchy is now unmistakably editorial; the single gravity point works. Wish: field-level diff markers beyond Business — noted for later, punch-list style, not urgent.
- **Product manager:** every screen answers "what is this / what next"; first-run → first publish path has no dead ends. The counted publish button is the product's heartbeat.
- **Agency owner:** History's honesty (failures kept, restore lineage) is what I'd show clients. I want fleet views — correctly out of scope (M6 admin/Agency edition).
- **Small business owner:** "I read it like my own paperwork. The publish page tells me exactly what customers will see, and it says nothing is lost if it fails. I'm not scared of the button."
- **Accessibility expert:** overlays trap-and-return focus, live regions announce saves, contrast passes AA, targets pass 44px on touch. Remaining nit: iframe proof content is the rendered site — its accessibility is the template's job (WCAG AA by construction, per the template bar).
- **First-time customer:** the envelope told me the three steps; the empty pages each offered one obvious button; the receipt told me it worked and that it's kept forever.

**Disagreements resolved:** the designer wanted per-field diff badges everywhere now; the PM ruled the under-header consequence line (Business) plus menu wash sufficient for launch — matches the punch list's scope. The agency owner's fleet request was ruled out of milestone.

## Success criteria check

A first-time business owner can immediately see **what this is** (the envelope + the statement), **what to do next** (three steps; one action per empty state), **what Publish does** (the ritual reads every change aloud + the atomic promise), **how to recover** (History's journal + "Bring it into my draft" + safety-copy language), and **why to trust it** (nothing is lost is the house style; failures stay visible and safely worded; every version kept).
