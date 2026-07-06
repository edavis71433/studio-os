# Direction A Punch List — M7 screens vs. the frozen design direction

Visual & UX improvements ONLY. No new features, no architecture changes.
Grades: **P1** = reads "internal CMS" · **P2** = misses the premium register · **P3** = polish.
Reference: Direction A (Editorial Concierge) in the design-directions artifact; verdict frozen with two B-grafts (visible pipeline steps, failure reference codes).

## Passes already
Copy voice (calm, "nothing was lost", counted publish), hide-not-delete visibility, honest failed publishes, restore safety-copy language, preview-on-dark-stage concept.

## Global
- **G-01 P1** De-card the product: 16px shadowed cards → stationery (4px corners, hairlines, near-flat); most content sits directly on the page. A box must earn its border; forms never get one.
- **G-02 P1** Kill boxed inputs: field values in serif ~19px over hairline underline; small-caps whisper labels; focus = plum caret only.
- **G-03 P1** Vocabulary: Offerings→Menu, FAQs→Questions, Testimonials→Kind words, Photos→Photographs.
- **G-04 P1** One point of visual gravity: collapse draft pill + Publish into one ink-solid counted "Publish · N"; "Everything saved" as whisper; Preview quiet.
- **G-05 P2** Buttons → pills; primary = ink, never purple fill; purple = links + unpublished wash only.
- **G-06 P2** Section headers → small-caps runes with hairline extenders.
- **G-07 P2** Serif for every sentence that matters (statement, values, note titles, summaries, receipts); sans for labels/hints.
- **G-08 P3** Warm paper ground + warm hairlines (room-scoped tokens; don't touch portal).

## Today
- **T-01 P1** Facts: four metric cards → one prose paragraph with inline bolds + dot separators.
- **T-02 P1** Health: bordered box → 34px serif headline with inline lamp.
- **T-03 P2** Notes: color-strip cards → letters with wax-seal dots; action = plum underlined link; Dismiss = quiet link; 240ms slide-away (reduced-motion honored).
- **T-04 P1** First-run: delete purple gradient hero → paper envelope, serif headline addressing the business, stationery step-cards with circled numbers.
- **T-05 P3** Waiting-to-publish rows: rune label column, journal rhythm.

## Business
- **B-01 P1** Three cards → one continuous document with rune dividers; single 560px column.
- **B-02 P2** Autosave whisper: serif italic "saved just now"; failure: "that didn't save — your words are still here."
- **B-03 P2** Inline consequence: fields differing from live annotated with the existing diff sentence (presentation of /changes data only).
- **B-04 P3** Hours: mono times, aligned columns, "Closed" as quiet word.

## Menu (Offerings)
- **M-01 P1** Menu edits itself: admin list → real menu (serif-italic section heads, dot leaders, right price); click line to edit in place; Esc restores.
- **M-02 P1** Toggle → state language: hidden = struck-through + small-caps "off the menu"; affordance "put it back on."
- **M-03 P2** Unpublished rows get plum wash (from /changes entity ids).
- **M-04 P2** Add-item card → "＋ Add a dish to {Section}" line, inline expand, section prefilled.
- **M-05 P3** Reorder styled as "⋮⋮ drag to reorder" on the section head (arrows may remain as mechanism).

## Questions, Kind words, Updates
- **Q-01 P2** Render the finished thing: serif questions; quoted italic testimonials with em-dash author; updates state as a word (Shown/Draft), not a toggle.
- **Q-02 P2** Empty states show the ghosted artifact + one ink action naming the outcome.
- **Q-03 P3** Two-tap delete stays; quiet text, red only when armed.

## Photographs
- **P-01 P2** "On your site" badge says where, from existing used_by.
- **P-02 P2** Upload alt prompt as stationery inset.
- **P-03 P3** Delete confirms in-cell with usage context.

## Preview
- **V-01 P2** Stage: purple-deep → warm espresso desk; Draft/Live as paper tabs attached to the proof.
- **V-02 P3** Page select → word list; "Desk / Phone"; loading = "Proofing your draft…".

## Publish
- **U-01 P1** Bottom sheet → full-page ritual: "Here's what changes." + sentence list + wide ink pill + "Not yet — keep them in the draft" link.
- **U-02 P1** Success → receipt: ✓ stamp, mono date/count, permanence line.
- **U-03 P2** B-graft: pipeline steps (snapshot sealed → rendered → deploying → live) mapped from existing status transitions.
- **U-04 P2** Blockers as amber prose with a jump link; button absent, never disabled.

## History
- **H-01 P2** Ledger → journal: fixed mono date column, serif summaries, text-link actions, ghost "Kept for the record", hollow ◌ for failures.
- **H-02 P3** Restore sheet as letter; confirm = "Bring it into my draft."

## Mobile
- **MB-01 P1** Tab bar → dark floating word dock: Today · Sections · Proof · Publish·N.
- **MB-02 P2** Statement scales (24px serif); facts paragraph wraps; no metric cards at any width.
- **MB-03 P3** Sections sheet inherits word-rail styling.

## States & system
- **S-01 P2** Loading: "Setting the table…" + shimmer hairline; no skeletons.
- **S-02 P2** Error-order audit: what's safe first, everywhere.
- **S-03 P3** Gate screens get stationery + serif headlines.

**Sequencing:** the P1 set (G-01…04, T-01/02/04, B-01, M-01/02, U-01/02, MB-01) is the "stops being a CMS" pass — one visual sweep over presence.html, zero API/contract changes.
