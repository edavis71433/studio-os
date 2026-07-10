# Post-P2-E Deep Audit (2026-07-10)

Run per the owner standing instruction ("run that same deep audit after every prompt"). Method: four parallel adversarial review agents, each file:line-grounded, covering areas NOT already deep-audited in P2-C/P2-D/P2-E:

1. CMS / publishing / media / templates / Phase-T ecosystem
2. AI subsystems (writer/coach/concierge/guardian/reviewer/visual) + Connected Platform (OAuth/adapters/execute)
3. Cross-cutting security / auth / RLS / secrets / rate limits / platform invariants
4. Cross-surface cohesion + customer frontend + a fresh-eyes review of the P2-E changes themselves

**Totals: ~30 verified findings — 4 High, 11 Medium, ~14 Low + 1 test artifact.** Every finding was confirmed in code. The most important result: the fresh-eyes pass found **real defects in the just-shipped P2-E work**, which have been FIXED and re-tested in this same session (commit `P2-E post-audit hardening`).

---

## FIXED THIS SESSION (in-scope P2-E correctness + recovery)

| Sev | Area | Defect → Fix | Test |
|---|---|---|---|
| High | AI cost | Ceiling only gated writer/visual/coach; `/editor/improve`, reviewer, brand, concierge polish bypassed it → a tenant past their cap kept spending. Now every generative path is covered (editor 429; reviewer/brand/polish skip only the paid tier). | audit_hardening 1-4 |
| High | Billing reconcile | `driftsFrom` ignored `grace_until` → a recovered-but-webhook-missed paying customer had a stale grace anchor never cleared → the sweep would **lapse a paying customer**. Now reconcile drifts on grace presence and clears it. | audit_hardening 5-6 |
| Med | Webhook | Both claim inserts failing (transient DB error) returned `'done'` → event dropped → lost provisioning. Now a hard failure PROCESSES (downstream idempotent). | webhook_idempotency 16 |
| Med | Webhook | A crash after claim left the event `'processing'` forever. A stale (>5min) processing claim is now reclaimable (`'retry'`). | webhook_idempotency 17 |
| Med | Deletion | Executor revoked access before Stripe cancel → a cancel failure could strand a customer locked-out AND still billed. Now cancels Stripe first; revokes only on success. | audit_hardening 7 |
| Med | Deletion | Confirmation email re-sent on every idempotent re-request. `requestDeletion` now reports `created`; email fires once. | audit_hardening 8 |
| High | Recovery UI | `/commerce/portal` + `/commerce/subscription` existed but NO page called them — a paused/lapsed customer had no in-app door to fix payment (which the gate copy promises). Added the billing card (status + Manage-billing/Update-payment → Stripe portal). | (frontend) |
| Med | Deletion UI | `/commerce/delete-cancel` existed but was unreachable. Added a Cancel-request button + dynamic cooling-off days (was hardcoded "30 days"). | (frontend) |
| — | Test | INV-1 flagged `analytics.not_connected` as an evidence orphan — it's an intentional internal signal (opt_dormant retired in P11), consumed directly. Test corrected → invariants 14/14 HELD. | platform_invariants |

---

## QUEUED (verified, out of P2-E scope → tracked in FEATURE-DISCOVERY-QUEUE + ROADMAP-MASTER)

**Data-loss / High**
- 🔴 **FD-AUD1 [High] — `lib/media.ts:111-122` deleteMedia in-use guard is incomplete.** Misses `presence_settings.logo_media_id/og_media_id/cover_media_id` and media IDs inside `settings.blocks` (gallery/team/before-after/video). Deleting a photo that's your logo or in a gallery succeeds silently → serializer drops it from every published page → after the 7-day media_gc window it's permanently gone. Fix: extend the reference scan to settings image columns + block media IDs.

**Medium**
- FD-AUD2 — `serializer.ts:40-41` focal point: `focal_x/y` default NULL, `Number(null)=0` is finite → every image without an explicit focal serializes `focal:{0,0}` → top-left crop in split-hero/gallery/team/before-after blocks. Fix: gate on `focal_x != null && focal_y != null`.
- FD-AUD3 — `publish.ts:247-263` restore of an old version whose media was reaped fails with the generic CALM 502 (no hint it's unrestorable). Fix: detect missing-original, surface a specific message / placeholder.
- FD-AUD4 — `connected/adapters.ts:129` silent token refresh calls `saveTokens(...,[])` → overwrites `scopes_granted` with [] and resets `connected_at` to now on every refresh → connections list shows 0 scopes + bogus "just connected" date; consent record corrupted. Fix: on refresh update only the sealed secret; preserve scopes/connected_at.
- FD-AUD5 — `connected/execute.ts` + `approved_plan.ts` at-least-once write: a crash between the provider POST and `markWriteOutcome` leaves the row reclaimable after 2min → duplicate public write (e.g. gbp_post double-posts). Fix: in-flight marker before the provider call or a provider idempotency key + read-back reconcile.
- FD-AUD6 — satellite pages (`today/client/connections/visual-studio.html`) capture the JWT once at boot, never refresh (unlike presence.html) → stale-token 401s after ~1h; today.html swallows → blank dashboard, no re-auth. Fix: per-request token read / `onAuthStateChange`.
- FD-AUD7 — `presence.html` renderPlanNotice renders only 5 notice kinds; domain_expiry/renewal_reminder/winddown_reminder/win_back/deletion_requested/search_setup/lead_followup inflate the bell but have no href/dismiss → dead-end. Fix: render all kinds or map hrefs + dismiss.
- FD-AUD8 — lapse/wind-down clock rides mutable `updated_at`; a reconcile re-patch on a lapsed row resets the 60-day clock + notice sequence. Bounded (converges). Fix: dedicated `lapsed_at` stamped once on active→lapsed (needs a small migration).

**Low**
- FD-AUD9 — `routes/system.ts:114-119` accepts `SCHEDULER_SECRET` from the URL query string → lands in logs/history. Fix: require the `x-system-secret` header or POST body only. (Touch carefully — cron uses it.)
- FD-AUD10 — `routes/content.ts:58` + `publish.ts:34` hardcode the offering noun to "menu item(s)" regardless of industry (contradicts Phase-T; `vocabFor(industry).offeringLabelSingular` exists unused). Fix: derive from site industry_key.
- FD-AUD11 — `routes/site.ts:23-37` template switch doesn't verify `content_contract_version` (the preview path does). Latent (all manifests ccv=1). Fix: mirror the preview check before persisting.
- FD-AUD12 — `writer/guard.ts:39-43` numeric guard substring-matches concatenated fact digits → an invented number that appears as a substring passes. Fix: tokenized per-field value set.
- FD-AUD13 — `concierge/verify.ts` hallucination gate catches added facts but not dropped caveats/meaning drift. Polish default off → accepted risk, or assert key caveat tokens survive.
- FD-AUD14 — `connected/auth.ts:75-76` `verifyState` fails OPEN when encryption unconfigured (mitigated: storage fails closed). Fix: fail closed in verifyState.
- FD-AUD15 — `lib/devmode.ts:62` dangerous-scheme neutralizer requires a quote after `=`, so unquoted `href=javascript:…` isn't stripped (owner-only/CSP-mitigated). Fix: strip unquoted javascript:/data:/vbscript: too.
- FD-AUD16 — `routes/visual.ts:48` image `subject`/`instruction` have a min length but no max → uncapped text into the prompt + stored brief. Fix: `.slice(0, ~500)`.
- FD-AUD17 — `routes/connections.ts:28` dead import `writeConfigured`. Remove.
- FD-AUD18 (info) — rate limiter + `checkAiCeiling` fail OPEN by design; privileged secret compares use non-constant-time `===` (defense-in-depth). Noted, not urgent.

## Verified CLEAN (no defect)
Cross-tenant scoping across CMS/AI/connected/service surfaces; token-at-rest (AES-256-GCM, fail-closed); OAuth state sealing; `/client/billing` tenant scoping; notice-dismiss scoping; webhook signature + livemode + normal-path idempotency; client approval version-integrity; `checkAiCeiling` fail-open; auth resolvers fail-closed; secret names (not values) in `/system/health`; Phase-T primitives pure/correct; GC paths conservative.
