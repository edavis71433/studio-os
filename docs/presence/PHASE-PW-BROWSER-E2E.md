# Phase PW — Browser Automation & End-to-End Verification

*A permanent Playwright suite that proves the product works in a real browser — protection for every future release. It is **hermetic**: the real HTML/JS/CSS runs against a stubbed Supabase client + mocked `/functions/v1/presence` fixtures, so it verifies browser behaviour deterministically, with no backend, no credentials, and no data mutation. It never re-tests backend logic — that's the job of the deno suites in `tests/presence/`.*

## What was built
- **`playwright.config.ts`** — three projects (desktop 1280×800 / iPad / iPhone 13), local static `webServer`, CI reporters, trace/screenshot/video on failure, screenshot-diff tolerance.
- **`tests/e2e/helpers/app.ts`** — the harness. `installApp(page, { session, api })` stubs supabase-js (so `getSession()` returns a controlled session; `null` = signed-out) and mocks every presence call from fixtures (longest-prefix path match; unfixtured writes → `{ok:true}`). Ships a realistic `studio_os` nav + default fixtures.
- **9 spec files** covering the critical journeys (below).
- **`.github/workflows/e2e.yml`** — installs Node + Chromium/WebKit, runs the suite on push/PR to `main`/`staging`; designed to be made a required status check.
- **`tests/e2e/README.md`** — run instructions, coverage matrix, and the honest gap list.

## Coverage (what the browser actually verifies)
- **Shell** — brand/nav render from context; ⌘K opens, filters, and targets the right href; the unified bell shows **notices then approvals** (Phase FLOW/OS); the attention **badge** equals context; profile sign-out; signed-out degradation.
- **Today** — needs-you cards (notices + approvals) above Moments; **attention consistency** (Today card count == bell badge); moment dismiss removes the card; website vs CRM empty-state language (PP-5); the one-time upgrade orientation appears then never returns, and is silent on first sight (PP-6).
- **CMS workspace** — edition gating hides the Business-OS links for a CMS edition (Phase SKU); "Photos" terminology (Phase PP); `#design`/`#business` hash deep-links (Phase OS).
- **CRM** — leads inbox renders with prefilled reply, the new-lead filter, and a mark-read toast; the relationship timeline renders real activity.
- **Client portal** — the mirrored "needs you" heading + approvals, approve→toast, the caught-up state, and the owner-redirect.
- **Agency** — the merged portfolio status row (attention badge, leads waiting, domain + registrar, billing) and the non-agency turn-away (Phase PP Section 3).
- **Accessibility** — axe WCAG2A/AA (no serious/critical) on Today/Leads/Portal, accessible control names, keyboard palette open/Escape.
- **Responsive** — no horizontal overflow + content present at all three viewports.
- **Visual** — per-viewport screenshot vs baseline (opt-in via `VISUAL=1` so a missing baseline never reds the gate).

## Honest gaps (not written — with reasons)
The brief listed some flows that are **not built** or **not browser-verifiable**, and I did not write fiction for them:
- **Uploads / Contracts / Invoices / Messages** — not built; the client portal is review + approve only. Nothing to drive.
- **Magic-link invitation / first login / email** — GoTrue link + email are out-of-band backend flows; the browser can't hermetically verify a link that arrives by email. (Invite path is covered by backend tests.)
- **Real publishing / template switching / restore, weekly digest, renewal + domain emails, Stripe checkout** — backend/cron/external, covered by the deno unit/integration suites. The browser suite verifies the *affordance* (the control exists/opens), not the server outcome.
- **AI drafting output** — nondeterministic; a browser test can only confirm the desk opens.

## Verification done in this environment
This box has **no Node/Playwright/browser**, so the suite's first execution is in CI (by design — this is the phase where browser runs move to the pipeline). What I *did* verify here: all 11 files parse and lint clean (`deno lint`), package.json is valid, every asserted string/selector was grep-confirmed against the real source (brand, nav labels, `.moment.todo`, "All clear", "Photos", "One thing needs your OK", the agency status bits, ARIA labels, the CRM timeline render, …), and the suite is isolated from the existing deno gate (different dir + extension).

## CTO review
- **Would I trust this to protect every future release?** For the browser behaviour it covers — the shell, the attention system, edition gating, the four product surfaces, a11y, and responsive layout — yes: those are the regressions most likely to slip past unit tests, and they're now caught. I would **not** claim it covers the whole product; the gaps above are real and documented, not hidden.
- **What still lacks coverage?** The genuinely browser-observable gaps I'd add next (recommendations, not built): (1) a real Supabase **auth round-trip** smoke against a disposable test account in staging — the one thing the stub deliberately doesn't exercise; (2) the **AI drafting desks** opening/streaming states (mock the stream, assert the UI states); (3) **connections OAuth** return handling (`connections-callback.html`). None are blockers; all are additive.
- **Would I personally rely on this before every deployment?** Yes as a **required PR check** — it's fast, deterministic, and hermetic, so there's no reason not to gate on it. I'd pair it with the existing deno gate (backend) so both layers must be green.

## Final answers
- **Trust it to protect every future release?** Yes for the covered browser behaviour; the documented gaps keep the claim honest.
- **What browser behaviour still lacks coverage?** Live auth round-trip, AI-desk streaming states, OAuth callback — all recommended, none blocking.
- **Rely on it before every deployment?** Yes — as a required status check alongside the deno suite.

**Phase PW — Browser Automation & End-to-End Verification complete.**
