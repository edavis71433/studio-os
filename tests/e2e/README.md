# Studio OS — Browser E2E (Phase PW)

A permanent, hermetic Playwright suite that proves the **product works in a real browser**. It exercises the real page JavaScript (shell.js nav/⌘K/bell, today.html rendering, edition gating, the attention system, leads/CRM/portal/agency surfaces) against **stubbed Supabase auth + mocked API fixtures** — so it is deterministic, independent, repeatable, fast, and needs no credentials or live backend. It verifies *browser behaviour only*; it never re-tests backend logic (that's the deno suites in `tests/presence/`).

## How it works
`tests/e2e/helpers/app.ts` → `installApp(page, { session, api })`:
- serves the supabase-js CDN request with a tiny stub whose `getSession()` returns a session you control (`session: null` = signed-out);
- mocks every `/functions/v1/presence/**` call from fixtures keyed by the path after `/presence` (longest-prefix match; unfixtured writes return `{data:{ok:true}}`).

No real network, no data mutation. Fixtures default to a `studio_os` owner with two things needing attention; each spec overrides per test.

## Run it
```bash
npm install
npx playwright install --with-deps chromium webkit
npm run test:e2e            # all projects: desktop / tablet / mobile
npm run test:e2e:report     # open the HTML report
```
Visual baselines (opt-in):
```bash
VISUAL=1 npm run test:e2e:update-snapshots   # generate
git add tests/e2e/__screenshots__            # commit baselines
VISUAL=1 npm run test:e2e                     # enforce
```

## Coverage
| Area | Spec | Verifies |
|---|---|---|
| Shell | `shell.spec.ts` | brand/nav render, ⌘K palette open+filter+target, bell unified feed (notices→approvals), attention badge, profile sign-out, signed-out degrade |
| Today | `today.spec.ts` | needs-you cards (notices+approvals), **attention == bell badge**, moment dismiss, website vs CRM empty state (PP-5), upgrade orientation once + never-again (PP-6) |
| CMS | `cms.spec.ts` | edition gating hides Business-OS links for CMS (SKU), "Files" terminology (Architecture v1.0), `#design`/`#business` deep-links (OS) |
| CRM | `crm.spec.ts` | leads inbox render + prefilled reply + filter + mark-read toast; relationship timeline |
| Client portal | `portal.spec.ts` | mirrored "needs you" heading + approvals, approve→toast, caught-up state, owner-redirect |
| Agency | `agency.spec.ts` | portfolio status row (attention badge, leads, domain+registrar, billing), non-agency turned away |
| A11y | `a11y.spec.ts` | axe WCAG2A/AA (no serious/critical) on Today/Leads/Portal, accessible names, keyboard palette |
| Responsive | `responsive.spec.ts` | no horizontal overflow + content present at desktop/tablet/mobile |
| Visual | `visual.spec.ts` | per-viewport screenshot vs baseline (opt-in) |

## Honest coverage gaps (not written, with reasons)
These appeared in the phase brief but are **not browser-testable here** or **not built in the product** — writing tests for them would be fiction:
- **Uploads, Contracts, Invoices, Messages** — not built. The client portal is review + approve only (`client.html`); there is no upload/contract/invoice/messaging UI to drive.
- **Magic-link invitation, first login, email delivery** — GoTrue link generation + email are backend/email flows; the browser can't hermetically verify a link that arrives out-of-band. (The invite path is covered by backend tests.)
- **Real publishing / template switching / restore side-effects, weekly digest, renewal + domain-watch emails, Stripe checkout** — these are backend/cron/external; covered by the deno unit/integration suites (`commercial`, `lifecycle`, `render`, `agency`, …). The browser suite verifies the *affordances* (e.g. the Publish control exists and opens), not the server outcome.
- **AI drafting output** — nondeterministic; a browser test can verify the desk opens, not the generated text.

## First-run notes
- **axe** may surface real findings on first CI run — that's the suite doing its job; triage and fix, don't suppress.
- **Session-seed shape** is the one integration point: the stub in `app.ts` fully controls `getSession`, so no real supabase-js internals are involved — if a page ever reads a session field we don't provide, add it to `OWNER_SESSION`.
- **Visual** tests are skipped until `VISUAL=1` and baselines are committed, so the gate is never red merely for a missing baseline.
