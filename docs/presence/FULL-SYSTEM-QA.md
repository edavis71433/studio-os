# Version 1 — Full-System QA (No Stone Unturned)

*Master QA pass. Every subsystem tested; broken things fixed and retested; suggestions logged, not built. Grounded in fresh execution (regression re-run + link audit) and the accumulated verified evidence of the six prior audit milestones (Product Freeze, Deep QA, Documentation, Privacy, Legal, Operations, Browser). **Honest boundary:** this environment cannot run a live browser, real mobile devices, screen readers, or live third-party services (Google OAuth, the image model, Stripe checkout) — those are verified by code inspection + automated suites here, and the live device/browser/AT passes are the human step, called out throughout.*

---

## Executive Summary

Everything testable in this environment is **green**. The full automated regression passes — **6 critical integration suites re-run live against staging** (room 38, pipeline 30, connected_writes 23, connected_validation 29, commerce 36, service 22) plus **38 pure suites and the 14 platform invariants** — and a **full internal link audit found zero broken links**. No new defects were found in this pass; the two bugs found in the earlier Deep QA were already fixed and remain fixed. Security, approval, tenant/org/agency isolation, AI safety, connected ownership, and the publishing/commerce flows all hold under test.

What remains is **not engineering breakage** — it is the set of verifications no headless environment can perform (live cross-browser + real mobile + screen-reader passes) and the **owner-activation** items (turn on the AI/Visual/OAuth/Stripe keys; install prod cron + monitoring). These are documented, not hand-waved.

**Verdict: Version 1 Full-System QA Passed with Minor Issues** — the "minor issues" being the human-only live passes and owner activation, none of which is a code defect or a blocker to *starting* real-world QA on a staging deployment.

---

## QA Test Plan

1. **Automated regression** — all 44 suites (pure locally; 6 critical suites live on staging). ✅ run.
2. **Link audit** — every static internal link across the customer app pages. ✅ run (clean).
3. **Page integrity** — every customer HTML page parses; states present; nav resolves. ✅ (from Browser milestones).
4. **Boundary verification** — security/approval/isolation by code + tests. ✅ (Deep QA + this pass).
5. **Per-area review** — AI, Connected, Visual, CMS/Publishing, Commerce, Industry, Enterprise, Agency, Admin. ✅ (per-subsystem suites + audits).
6. **Human-only passes** — live browser/mobile/AT + activated third-party flows. ⏳ handed off (cannot run here).

## QA Matrix (area → evidence → verdict)

| Area | Evidence | Verdict |
|---|---|---|
| CMS / content / publish / restore | `room` 38/38 live; `render` 28 pure | ✅ Pass |
| Intelligence pipeline (Evidence→Moments→Concierge) | `pipeline` 30/30 live; evidence/judgment/recommendation/moments/concierge pure | ✅ Pass |
| Connected reads/writes/validation | `connected_writes` 23, `connected_validation` 29 live; reads pure | ✅ Pass |
| Commerce / billing / entitlements | `commerce` 36/36 live | ✅ Pass |
| Operations / metering / cycle | `operations` 12/12 live (Deep QA); pure re-confirmed | ✅ Pass |
| Admin / operator | `admin` 51/51 live (Deep QA) | ✅ Pass |
| Creative Studio (Writer/Editor/Reviewer/Guardian) | writer 30, editor 21, reviewer 22, guardian 30 pure | ✅ Pass |
| Growth Coach / Concierge | coach 46, concierge 26 pure | ✅ Pass |
| Visual Studio | `visual_studio` 38 pure | ✅ Pass |
| Industry packs | industry 26, restaurant 19, pack_expansion 27, third_party 20, industry_validation 21 | ✅ Pass |
| Enterprise / Agency | enterprise 22, agency 24, agency_orchestration 24 | ✅ Pass |
| Platform invariants (frozen contracts) | `platform_invariants` 14/14 | ✅ Held |
| Browser cohesion (identity/nav/SW) | Browser Implementation (B-1/2/3 resolved) | ✅ Pass |
| Links (internal) | Full link audit | ✅ 0 broken |

## Link Audit

Extracted every static `href`/`src` across the customer app pages (`today`, `connections`, `visual-studio`, `connections-callback`, `portal`, `presence`, `signup`, `welcome`, `start`, `set-password`). **Zero broken internal links.** The only non-resolving matches were **runtime template expressions** (`${esc(v.preview_url)}`, `'+data.signedUrl+'`, `${roomHref}`) — dynamic image/Stripe/room URLs resolved at runtime, not static links. The shared Presence nav (Your Presence · Today · Connections · Visual Studio) resolves to real files on every page. External/legal/footer links live on the public marketing site (out of the app-QA scope; owner to verify on the site).

## Mobile QA Report

Verified structurally (real-device testing not possible here): every customer page sets `viewport`; the shared nav uses `flex-wrap`; layouts use fluid `max-width`/`clamp`/grid; portal carries explicit mobile media queries and 40px touch targets; presence.html has a mobile `.dock`. No horizontal-scroll patterns found in code. **Human step:** click-through on real iPhone/Android sizes (portrait/landscape) for touch, sticky headers, modals, uploads, and image previews.

## Browser QA Report

Standard web APIs only (fetch, localStorage, CSS grid/flex, `prefers-color-scheme`) — expected to work in Chrome/Edge/Safari/Firefox. Multi-page architecture makes refresh, back/forward, deep links, and bookmarks work naturally; session persists (`persistSession` + `autoRefreshToken`); the service worker now correctly excludes all signed-in app surfaces (no stale shells). **Human step (B-9, Recommended):** live pass in the six target browsers; offline/reconnect, clipboard, drag-drop, and print are not implemented (documented, V1.1).

## Accessibility QA Report

Verified: semantic `<nav aria-label>`, `aria-current`, `role="status"` live regions, global `:focus-visible` ring, `prefers-reduced-motion`, alt text required on every uploaded image, plain-language error messages, light/dark theming, scalable type. No keyboard traps or unlabeled controls found in the reviewed pages. **Human step:** a formal screen-reader + contrast-ratio + zoom pass (pending per the Accessibility Statement).

## Security QA Report

Verified by test + inspection: deny-all RLS on all 54 tables; tenant isolation via `resolveSite(jwt)`; operator gates (`staff‖system`) in `routes/enterprise.ts`/`routes/marketplace.ts`; agency portfolio isolation (403); approval enforced by DB CHECK + atomic single-winner claim (`connected_validation` 29/29 live); OAuth `state` signed+verified; connected tokens AES-256-GCM out-of-row, fail-closed; XSS-escaping (`esc()`) on the customer pages; no card data stored; bearer-JWT-in-header (CSRF-resistant); audit ledgers append-only, field-names-only. **Nothing bypasses approval; no cross-tenant leak found.** Residual (Ops): no app-level rate limiting (MED-1) — documented. **Human step:** a live third-party penetration test (Recommended).

## AI QA Report

Writer is fact-guarded (states only fact-sheet facts; missing facts become questions); Brand Guardian vetoes unattributable claims; Concierge calls no model (deterministic); Visual Studio scrubs claim-language and never receives customer photos. **Approval before use and manual parity hold across every AI surface; no autonomous publishing; `ai_approved` provenance recorded.** AI-unavailable states are honest ("not switched on") when keys are unset. Prompt-injection hardening present (`<<<FACTS…>>>`). **Human step:** exercise real generations once `ANTHROPIC_KEY`/`VISUAL_MODEL_KEY` are set.

## Connected Platform QA Report

Connect (OAuth + API-key), refresh, disconnect, health, read-only-by-default, approval-gated writes, and reviewed rollback are all covered (`connected_reads`/`writes`/`validation` green; `connections.html` provides the customer surface with plain-language health + the "About this connection" disclosure). Disconnect destroys the token + cache (ownership preserved). **Human step:** a real Google OAuth round-trip once provider apps are registered.

## CMS / Publishing QA Report

Content editing, drafts, preview, publish (atomic, versioned), restore, and history verified live (`room` 38/38, `render` 28). Nothing reaches the live site without publish; a failed publish leaves the site unchanged; every version is retained and restorable. Media requires alt text; EXIF/GPS stripped on published variants. **Human step:** view a published site on real devices + a broken-link scan of the rendered output.

## Visual Studio QA Report

Generation, all asset kinds (hero/social square/portrait/story/Open Graph/general at correct dimensions), variations, instruction-guided edit, approval-before-store, media-library promotion with `ai_approved` provenance, and honest loading/empty/error/not-available states — verified (`visual_studio` 38 pure; `visual-studio.html` states). **Human step:** live generation + preview + the model-unavailable path once the key is set.

## Commerce QA Report

Plans, signup, checkout, subscription status, entitlements, capacity notices, upgrade (immediate/prorated), downgrade (period-end), cancel→grace (read-only + export preserved), no metered fees — verified (`commerce` 36/36 live). The Stripe webhook is signature-verified + idempotent. **Human step:** a real test-mode checkout once `STRIPE_SECRET` (test) + webhook are configured.

## Industry / Enterprise / Agency QA Reports

Industry: Restaurant/Coffee Shop/Home Services/Pet Grooming with inheritance + inheritance-aware self-gating + no cross-contamination (industry/pack suites green; the pack-provider classification bug fixed in Deep QA). Enterprise: org→region→location inheritance, overrides, rollouts, approvals, cross-location isolation (`enterprise` 22). Agency: portfolio, roles×scope permissions, approvals, rollups, cross-client isolation, operator boundaries (`agency` 24 + orchestration 24). All ✅ — and all are operator/advanced tiers with no customer UI in V1 (by design).

## Performance QA Report

Pure, deterministic engines; failure-isolated providers; on-demand reads (no background fan-out); media variants built at publish and shipped static; Moments capped at ≤3; small self-contained customer pages; timeouts on every external call. No N+1 or unbounded query found in the reviewed paths. **Human step (not runnable here):** real load/latency profiling at scale (many clients/locations/packs/connections) + Lighthouse.

## Error / State QA

Every reviewed customer workflow has loading, empty, success, error, signed-out, and (where relevant) not-available/disabled states. Failures are calm and honest ("nothing changed," "your account is untouched," "not switched on yet"); no silent crash path found. Backend errors return `{error, message}` with no stack traces.

## Bug Log

| # | Bug | Found | Status |
|---|---|---|---|
| 1 | Pack providers mis-classified as orphaned optimization providers | Deep QA | **Fixed + retested** (commit 9233ced) |
| 2 | Flaky capacity-notice number check (matched UUID digits) | Deep QA | **Fixed + retested** (commit 9233ced) |
| — | This full-system pass | now | **0 new bugs; 0 broken links** |

## Fix Log

- Both Deep-QA bugs fixed and retested (green). No new fixes required in this pass (nothing broken found). CI test gate added separately (Audit Findings milestone).

## Remaining Risk Register (documented, not blockers to QA)

| Risk | Type | Disposition |
|---|---|---|
| Live cross-browser / mobile / screen-reader passes not run | Verification (env limit) | Human step before public launch |
| Live third-party flows (Google OAuth, image model, Stripe) not exercised | Activation | Owner sets keys, then smoke-test |
| Prod cron + external monitoring/alerting (Ops CRIT-1/HIGH-1/2) | Owner activation / infra | Before unsupervised production |
| No app-level rate limiting; no correlation IDs | Ops MED | V1.1 |
| Self-serve account deletion (operator-assisted today) | Privacy R1 (Medium) | V1.1 |
| Native dialogs, offline handling, typeface unify | Browser Recommended/V1.1 | Not V1 |

None is a code defect; all are documented and correctly scoped.

## Release Recommendation

**Ship-ready to enter real-world QA / a supervised beta on staging**, pending: (1) the human live-browser/mobile/accessibility passes, and (2) owner activation (keys + prod cron/monitoring) with a smoke test of each activated flow. Everything automatable here is green; the boundaries and workflows hold; the two known bugs are fixed. I would not flip to *unsupervised public launch* until the human passes and owner activation are complete — but nothing engineering-side blocks QA or a supervised beta.

---

## Final Questions (answered honestly)

- **Did every page work?** Every page parses, resolves its links, and has its states — verified by code + suites. Live rendering is the human step.
- **Did every link work?** Yes — the link audit found **zero broken internal links**.
- **Did every feature work?** Every feature with an automated suite passed (44 suites; 6 re-run live). Live third-party features await their keys.
- **Did every mobile / browser view work?** Structurally yes (viewport, responsive, standard APIs); real-device/browser passes are the human step.
- **Did every workflow complete?** In test, yes (CMS/publish/restore, pipeline, connected, commerce, admin — all green live).
- **Did every approval hold? Every permission boundary?** **Yes** — DB CHECK + atomic claim + operator/agency/tenant isolation, all verified live and by inspection.
- **Did every AI feature behave safely?** Yes — fact-guarded, approval-gated, manual parity, no autonomous publishing, no photos/credentials to models.
- **Did every connected workflow preserve ownership?** Yes — read-only default, encrypted tokens, disconnect destroys access.
- **Did anything feel broken, hidden, inaccessible, or unfinished?** No broken/hidden functionality found. The honest "unfinished" edges are the human-only passes and owner activation — documented, not defects.
- **Would I personally ship this to paying customers?** **After** the human live passes + owner activation — yes. Today, I'd confidently put it into supervised QA / a private beta on staging; I would not flip it to unsupervised public launch until those two are done.

---

## Declaration

**Version 1 Full-System QA Passed with Minor Issues.**

*Everything testable in this environment is green (44 suites, 6 re-run live; 0 broken links; 0 new bugs; invariants 14/14; all boundaries hold). The "minor issues" are the human-only live passes (browser/mobile/accessibility) and owner activation (third-party keys + prod cron/monitoring) — none a code defect. No new features, no redesign, no launch work was begun.*
