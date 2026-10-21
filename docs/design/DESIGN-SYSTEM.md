# Studio OS design system — the sheet

Everything a page is allowed to use. The tokens live once in `shell.css` (`:root`, theme-independent) and every shelled page pulls from them with the literal as the `var()` fallback. Mockups Eric approved: [the canvas](https://claude.ai/artifact/BkaE4KvwNxCXXgrNXTke7a) (Tokens · Sweep · Motion · Today boards). Benchmark item 11 in [BENCHMARK-2026-10.md](BENCHMARK-2026-10.md).

## Color (settled in the October refresh, listed for completeness)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--dds-p` / `--dds-p-soft` / `--dds-p-deep` | #5b3fa0 / #f1edfa / #2a1b4a | #b79ceb / #272136 / #cdb6f2 | the plum: the one filled button, the active nav row, links; the soft wash; the deep plum for marks |
| `--dds-ink` / `--dds-soft` / `--dds-faint` | #15141a / #5c5a66 / #6f6d7a | #ededf0 / #a6a4b0 / #8e8c99 | three inks: body, secondary, labels |
| `--dds-line` / `--dds-line-strong` | #e6e6ec / #d2d2db | #2a2932 / #3a3944 | two hairlines |
| `--dds-bg` / `--dds-card` | #f7f7f9 / #fff | #141318 / #1c1b22 | canvas and card |
| `--dds-good` / `--dds-warn` / `--dds-bad` / `--dds-info` (+ `-soft`) | #15713d / #975208 / #c43c3c / #2a6fb5 | #8bbf9f / #d3ac6e / #e08b83 / #8ab8e8 | four meanings, each with a wash |
| `--dds-shadow` / `--dds-shadow-pop` | | | the one card shadow; the popover shadow |

Pinned by tests (axe 4.5:1, admin-health, shell A7): do not change a color. Four blocks keep them honest: `:root`, `prefers-color-scheme: dark`, `[data-theme="light"]`, `[data-theme="dark"]`.

## Type — six sizes

| | Size | Face / weight |
|---|---|---|
| Page title | 28px | Fraunces 500 (`--dds-serif`), the only serif on a page |
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
| `--dds-r-sm` | 6 | inputs, small icon tiles |
| `--dds-r` | 8 | buttons, menus, rows |
| `--dds-r-lg` | 10 | cards, lists |
| `--dds-r-xl` | 14 | dialogs, toasts, the ⌘K box |
| `999px` | pill | chips and toggles |

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

1. **One filled button per view.** The rest are outlined or plain.
2. **Sentence case everywhere.** No SHOUTING labels, no Title Case Buttons.
3. **The sidebar from 761px** (`html.dds-side`). Below that, the top bar, the bottom bar and the drawer sheet.
