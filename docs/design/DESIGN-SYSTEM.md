# Studio OS design system — the sheet

Everything a page is allowed to use. The tokens live once in `shell.css` (`:root`, theme-independent) and every shelled page pulls from them with the literal as the `var()` fallback. Mockups Eric approved: [the canvas](https://claude.ai/artifact/BkaE4KvwNxCXXgrNXTke7a) (Tokens · Sweep · Motion · Today boards). Benchmark item 11 in [BENCHMARK-2026-10.md](BENCHMARK-2026-10.md).

**Look refresh E, "Fresh & bold" (Nov 2026).** Eric picked Direction E of five in the Figma file "Studio OS — look refresh directions" (https://www.figma.com/design/HSP7ScFSz2mg1xGzHRrEZi, section "Direction E"): a lavender canvas, white cards that float on a soft shadow, bigger corners, pill buttons in a violet gradient, a floating sidebar, gradient avatars and a gradient greeting on Home. The values below are E's; the names did not change.

## Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--dds-p` / `--dds-p-soft` / `--dds-p-deep` | #6d3fd4 / #f0ebfd / #3d2185 | #b79cf5 / #2c2347 / #d7c8fb | the violet: the active nav row, links, chips; the soft wash; the deep violet for marks |
| `--dds-ink` / `--dds-soft` / `--dds-faint` | #171522 / #55526a / #69667d | #edeaf7 / #b3aecb / #9792b0 | three inks: body, secondary, labels |
| `--dds-line` / `--dds-line-strong` | #e7e6ef / #d6d4e2 | #2d2944 / #403a5e | two hairlines |
| `--dds-bg` / `--dds-card` / `--dds-up` | #f3f3f8 / #fff / #f7f6fb | #131120 / #1d1a2e / #262239 | canvas, card, and a raised surface inside a card (a composer, a deal in a column) |
| `--dds-good` / `--dds-warn` / `--dds-bad` / `--dds-info` (+ `-soft`) | #11744a / #94530a / #bf3535 / #245fa0 | #7fd3a5 / #e3b06b / #f09a92 / #8ab8e8 | four meanings, each with a wash |
| `--dds-shadow` / `--dds-shadow-pop` | | | the one card shadow (soft, two layers); the popover shadow |
| `--dds-grad-btn` + `--dds-on-p` | #6d3fd4 → #7a4bdd, white label | #c4b0fa → #dcb4f0, #171320 label | the one filled button |
| `--dds-grad-brand` | #6d3fd4 → #a63f86 | same | the brand mark, avatars, badges |
| `--dds-grad` | #4a2c8c → #6436c4 → #7d3fb8 | #3c2378 → #56309f → #6f3aa6 | the greeting on Home |

Every text pair is AA (4.5:1) on bg, card and up in both themes, and white or #171320 text is AA on every gradient stop. Pinned by tests (axe 4.5:1, admin-health, shell A7, agency's dark tokens): change a color only with those pins, and re-check the pairs. Four blocks keep them honest: `:root`, `prefers-color-scheme: dark`, `[data-theme="light"]`, `[data-theme="dark"]`; every new token goes in all four.

## Type — six sizes

| | Size | Face / weight |
|---|---|---|
| Page title | 30px (24 on a phone) | Fraunces 600 (`--dds-serif`), the only serif on a page; Home's greeting is 36px |
| Section heading | 14px | Inter 600 |
| Body | 13.5px | Inter 400 — what most text is |
| Secondary | 12.5px | Inter 400, `--dds-soft` — the line under a name |
| Label | 12px | Inter 500, `--dds-faint` — a column head, a stat's name |
| Micro | 11px | Inter 600 — a badge, a kbd |
| Number | 20px | Inter 600, `tabular-nums` — a stat's value |

## Spacing — eight steps, 4px apart

Every gap, padding and margin snaps to one of these.

| Token | px | Use |
|---|---|---|
| `--dds-s1` | 4 | icon to label |
| `--dds-s2` | 8 | between buttons, between chips |
| `--dds-s3` | 12 | inside a row |
| `--dds-s4` | 16 | card padding (`--dds-card-pad`) |
| `--dds-s5` | 20 | between cards |
| `--dds-s6` | 24 | between sections |
| `--dds-s7` | 32 | page gutter (`--dds-gutter`) |
| `--dds-s8` | 40 | bottom of the page |

Under 761px the scale shrinks one step: s4 → 12, s5 → 16, s7 → 16. Values written inside a phone media query are already the phone numbers and stay literal. A 1px hairline, a 2px underline and a 6px dot are intentional one-offs, not steps. A 6px or 10px gap sits between two steps and was left where it was; new work picks a step.

## Corners — four, plus the pill

| Token | px | Use |
|---|---|---|
| `--dds-r-sm` | 8 | inputs, small icon tiles, the brand mark |
| `--dds-r` | 12 | menus, rows, nav items |
| `--dds-r-lg` | 16 | cards, lists, the sidebar |
| `--dds-r-xl` | 20 | dialogs, toasts, the ⌘K box, the greeting |
| `999px` | pill | buttons, chips, toggles, search boxes |

## Motion — three speeds, one curve

| Token | Value | Use |
|---|---|---|
| `--dds-t-fast` | 120ms | hover, toggles, chips |
| `--dds-t-base` | 200ms | menus and popovers (fade in from 4px above), toasts (rise 8px), the bell, ⌘K |
| `--dds-t-slow` | 320ms | drawers and side panels (slide 24px), page sections |
| `--dds-ease` | ease-out | quick start, soft landing — the only curve |

Write `transition: opacity var(--dds-t-base) var(--dds-ease)`; never a raw `.2s`. When someone has reduce motion on, all three durations become 0ms: menus appear, toasts appear, drawers appear, nothing slides (`tests/presence/design_tokens_test.mjs` pins this).

## Icons — one set

The shell's `ICON` map in `shell.js`: 17px, 1.75px stroke, round caps and joins, `currentColor` (`today/home · overview · record · project · messages · get_started · connections · inbox · customers · pipeline · projects · files · analytics · website · studio · client · settings · bell · search · help · account`). Pages draw their own inline SVGs in the same geometry; no emoji as an icon.

## The three rules

1. **One filled button per view.** It wears `--dds-grad-btn` as a pill; the rest are outlined or plain pills.
2. **Sentence case everywhere.** No SHOUTING labels, no Title Case Buttons.
3. **The sidebar from 761px** (`html.dds-side`), floating as a card `--dds-side-gap` (12px) from the edges. Below that, the top bar, the bottom bar (an icon over each word) and the drawer sheet.
