# Studio OS — Browser E2E (Phase PW)

A permanent, hermetic Playwright suite that proves the **product works in a real browser**. It exercises the real page JavaScript (shell.js nav/⌘K/bell, today.html rendering, edition gating, the attention system, leads/CRM/portal/agency surfaces) against **stubbed Supabase auth + mocked API fixtures** — so it is deterministic, independent, repeatable, fast, and needs no credentials or live backend. It verifies *browser behaviour only*; it never re-tests backend logic (that's the deno suites in `tests/presence/`).

## How it works
`tests/e2e/helpers/app.ts` → `installApp(page, { session, api })`:
- serves the supabase-js CDN request with a tiny stub whose `getSession()` returns a session you control (`session: null` = signed-out);
- mocks every `/functions/v1/presence/**` call from fixtures keyed by the path after `/presence` (longest-prefix match; unfixtured writes return `{data:{ok:true}}`).

No real network, no data mutation. Fixtures default to a `studio_os` owner with two things needing attention; each spec overrides per test.

## Run it
```bash
npm ci                      # the versions package-lock.json pins (Playwright is pinned on purpose)
npx playwright install --with-deps chromium webkit
npm run test:e2e            # all projects: desktop / tablet / mobile
npm run test:e2e:report     # open the HTML report
```
In CI (`.github/workflows/e2e.yml`) the three devices run side by side inside Playwright's own image, and the `scope` job skips the suite only when every changed file is on its skip list; the `browser` check reports either way.

Visual baselines (opt-in):
```bash
VISUAL=1 npm run test:e2e:update-snapshots   # generate
git add tests/e2e/__screenshots__            # commit baselines
VISUAL=1 npm run test:e2e                     # enforce
```

## Coverage
64 specs as of November 2026. Each spec's opening comment says what it pins; by area:

| Area | Specs |
|---|---|
| Shell, Today, Home, help | `shell`, `today`, `one-needs-list`, `home-words`, `help`, `onboarding`, `settings` |
| Website builder | `site-home`, `g13-editor`, `builder-phase0`, `builder-phase1`, `builder-backoffice`, `cms`, `schedule`, `developer-mode`, `files`, `files-basics`, `visual-studio` |
| Customers, deals and money | `contacts`, `crm`, `customer-names`, `rosters`, `pipeline`, `inbox`, `inbound-rough-edges`, `broadcasts`, `calendar-link`, `estimates-recurring`, `sign`, `doc`, `sales-batch3` to `sales-batch11`, `sales-extras-1` to `-3`, `sales-review-fixes` |
| Projects and the client portal | `projects`, `portal`, `sharing` |
| Studios, scope and roles | `agency`, `studio-sites`, `scope`, `scoped-empty`, `member-roles`, `admin-health` |
| Analytics and connections | `analytics`, `connections` |
| Public pages | `marketing`, `marketing-tools`, `public-pages`, `retired-pages` |
| Cross-cutting passes | `a11y`, `responsive`, `visual` (opt-in), `polish-batch-c`, `security-batch-a`, `speed-batch-b`, `tests-batch-d`, `wave2-bets` |

## Honest coverage gaps (not written, with reasons)
These are **not browser-testable here** — writing tests for them would be fiction:
- **Magic-link invitation, first login, email delivery** — GoTrue link generation + email are backend/email flows; the browser can't hermetically verify a link that arrives out-of-band. (The invite path is covered by backend tests.)
- **Real publishing / template switching / restore side-effects, weekly digest, renewal + domain-watch emails, Stripe checkout** — these are backend/cron/external; covered by the deno unit/integration suites (`commercial`, `lifecycle`, `render`, `agency`, …). The browser suite verifies the *affordances* (e.g. the Publish control exists and opens), not the server outcome.
- **AI drafting output** — nondeterministic; a browser test can verify the desk opens, not the generated text.

## First-run notes
- **axe** may surface real findings on first CI run — that's the suite doing its job; triage and fix, don't suppress.
- **Session-seed shape** is the one integration point: the stub in `app.ts` fully controls `getSession`, so no real supabase-js internals are involved — if a page ever reads a session field we don't provide, add it to `OWNER_SESSION`.
- **Visual** tests are skipped until `VISUAL=1` and baselines are committed, so the gate is never red merely for a missing baseline.
