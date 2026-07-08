# Studio OS — Remaining Engineering Roadmap (LOCKED)

*Planning milestone. No code changed. This is the permanent record of everything agreed — completed, remaining, deferred, owner-activation, and future — so nothing is forgotten, silently removed, or moved without explicit approval. **Nothing here may be deleted; items may only be re-sequenced with justification, and only with the owner's approval.***

> **Lock rule:** every item in this document stays on the roadmap until the owner explicitly removes it. "Complete," "Partial," "Deferred," and "Future" are *statuses*, never deletions.

---

## Executive Summary

Version 1 is complete and tagged `v1.0.0-rc1` ("Foundation") — the frozen baseline. Everything beyond it is captured here in one locked roadmap: a short list of **V1 finish-up loose ends** (connected-provider completion, CI/deploy completion, type cleanup, documentation finalization), then the **major post-V1 initiatives** the owner has committed to — **Developer Mode** (required; essentially unbuilt), **Native Desktop**, **Native Mobile**, **CRM Expansion**, **Product Packaging** — followed by the explicitly-ordered launch tail: **Website & Public Experience → Guided Onboarding → Owner Activation → Launch (private beta → feedback → public)**. The full V1.1 backlog and the constitutional "do-not-build" exclusions are locked in below. **Nothing agreed has disappeared.**

---

## Completed Milestones (Version 1 — done)

M1–M8.5 foundations · M9/M9.5 intelligence + Creative Studio · L1–L3 commerce/ops/optimization · M10–M12 knowledge/monitor/platform-services · L4.0–L4.6 Connected Platform + contract freeze · L5.0–L5.7 Industry/Marketplace/Enterprise/Agency · L5.8–L5.9 launch surfaces + Connected customer UI · **AI Visual Studio**. Then the freeze/audit/impl/QA gauntlet: Product Freeze · V1 Feature Completion · Customer Workflow + Integrity audits · Documentation Freeze · Data Governance & Privacy Audit · Legal & Compliance Freeze · Operations & Production Readiness · Browser Platform Completion + Implementation · Audit Findings Implementation · Full-System QA · **Release Candidate RC1**. All ✅ (see [RELEASE-CANDIDATE-RC1](RELEASE-CANDIDATE-RC1.md)).

---

## Remaining Engineering Milestones (LOCKED — recommended sequence)

### Phase A — Version 1 finish-up (small, closes V1 loose ends)

**A1 · Connected Platform Completion** — ✅ **DONE** (see [CONNECTED-PLATFORM-COMPLETION-A1](CONNECTED-PLATFORM-COMPLETION-A1.md)).
All **21 providers** now have a real read adapter (endpoint + normalizer + auth shaping): the 3 stubs (`google_tag_manager`, `meta_business`, `apple_business_connect`) got real normalizers; the 5 partials (`bing_webmaster`, `yelp`, `trustpilot`, `salesforce`, `klaviyo`) got read endpoints; Bing/Trustpilot/Klaviyo got non-Bearer auth shaping. **19 Complete; 2 read-complete with activation caveats:** Salesforce (`instance_url` at activation) and **Apple Business Connect** (its `ownership_verification` **connect flow is not built** — a distinct auth path, deferred as new auth architecture; the one genuine remaining build item, carried on the Owner Activation list). Invariants 14/14; deployed staging+prod.
- **Still on roadmap (not part of A1):** extend **connected write coverage** beyond GBP post/hours + GSC verify (V1.1, additive); build the **Apple ownership-verification connect flow** (deferred auth path).

**A2 · Deployment & CI Completion** — ✅ **DONE** (see [DEPLOYMENT-CI-COMPLETION-A2](DEPLOYMENT-CI-COMPLETION-A2.md)).
- **Done:** presence function now deploys through CI (staging auto, prod confirmation-gated) behind test + **`deno check` type** + **migration-integrity** gates, with pre/post **smoke tests** (catalog 200 + gated 401); a confirmation-gated **rollback workflow** (`rollback.yml`) redeploys any known-good ref. All existing safety gates preserved.
- **Intentionally manual (by design):** migration *application* (hold-back technique; CI verifies integrity, doesn't auto-apply). **Owner:** set CI secrets + confirm the first CI run.

**A3 · Type Cleanup** — ✅ **DONE** (folded into A2). The 6 baseline `deno check` errors fixed (`OrgPlan`/`MarketplacePlan` `rollback` field; redundant `marketplace_ops` comparison; `agency/routes` cast); `deno check` = **0 errors**; type-only, regression-clean; now a CI gate.

**A4 · Documentation Finalization** *(mostly complete — post-QA pass)*
- **Done:** full doc set (72 presence docs incl. the master index) + 24 legal docs; Architecture/API/SDK/Database/Deployment/Operations/Customer Guide/Administrator Guide/Security/Privacy/Release Notes all present; 0 dangling links.
- **Remaining after QA:** a **Knowledge Base / Support** doc (customer-facing help center content) and a light post-QA refresh reflecting any QA outcomes. *(Legal drafts still need owner `[[OWNER: …]]` fill + counsel review — owner action.)*

**A5 · `today.html` / `presence.html` consolidation** *(started, overlapping — decide one canonical daily hub)* — currently both linked; consolidation deferred.

### Phase B — Developer Mode (REQUIRED — essentially unbuilt)

**B1 · Developer Mode** *(required; verified: does NOT exist today)*
Studio OS must serve **both** no-code business owners **and** professional developers — a business owner is never forced into code, and a developer can build an entire custom site if they choose.
- **Exists today (the developer substrate):** build-time, versioned **templates** (render contract + manifest — where design freedom lives); the **Industry Pack SDK** (`industry/sdk.ts`, validated, published); a documented **API** ([API-REFERENCE](API-REFERENCE.md)); content **version history + rollback**; **permissions/entitlements**.
- **Remaining (NOT built — the whole in-app developer experience):** Developer Mode **toggle** + **permissions/gating**; in-app **HTML / CSS / JavaScript / TypeScript** editing; **file explorer**; **layout / theme / component editing**; **custom reusable components**; **developer preview** (beyond content preview); **version history + rollback for developer code**; **API explorer**; a **developer documentation** portal; **SDK** surfacing in-app.
- **Constitutional constraint (locked):** Developer Mode must be designed so it does **not** violate the Product Laws (structured content as source of truth, one deterministic renderer, no runtime foreign code that breaks tenant isolation/security). This is a **major architecture initiative**, not an incremental feature — sequence and design it deliberately.

### Phase C — Native applications

**C1 · Native Desktop** — Studio OS available as **Browser + Mac + Windows**; the desktop app exposes the **same capabilities** as the browser unless technically impossible.
**C2 · Native Mobile** — **iPhone + Android**; workflows adapted appropriately for mobile.

### Phase D — CRM Expansion

**D1 · CRM Expansion** — *Already built (the baseline):* Studio OS **is** the light CRM (clients/contacts/tenants + agency portfolio; the constitution states no separate CRM is built). *Planned additional capabilities to define + build (kept on roadmap, none removed):* deeper contact/lead management, pipeline/stages, activity history, communications log, segmentation, and reporting — scoped as an expansion of the existing CRM substrate, **not** a separate codebase (see Locked Exclusions).

### Phase E — Product Packaging

**E1 · Product Packaging** — verified support to define/finish for each package:
- **CMS Only · Business OS Only · Complete Studio OS · Managed · Agency · Enterprise.**
- *Already built (the engine):* editions ladder (Presence Monitor → Presence → Managed → Agency → Enterprise), **entitlements**, **billing** (Stripe), **upgrades** (immediate/prorated) and **downgrades** (period-end), founder pricing, capacity. *Remaining:* the explicit **CMS-Only** and **Business-OS-Only** packagings + **licensing** model surfacing, and confirming each package's entitlement mapping. One integrated platform gated by entitlements (see Locked Exclusions).

### Phase F — Launch tail (explicit owner-locked ordering — do NOT move earlier)

**F1 · Website & Public Experience** *(REMAINS LAST among build phases; do not move earlier)* — homepage, navigation, pricing, demo, marketing, product positioning, trust, SEO, landing pages, interactive walkthrough. *(Strategy exists: [PUBLIC-EXPERIENCE](PUBLIC-EXPERIENCE.md) — Presence=product, Davis Digital Studio=studio, Studio OS=internal; nothing built.)*
**F2 · Guided Onboarding** *(after Website)* — first login, setup wizard, first publish, Business Moments introduction, success celebration. *Verified state:* **specified but not built** (Track 2 named it "Critical Before Beta"; the First-Publish "you're on the internet" receipt exists in the engine, but the guided walk does not). Remains to build.
**F3 · Owner Activation** *(after Onboarding)* — Stripe Live, OAuth providers, AI keys, monitoring, alerting, production cron, secrets, DNS, email, environment variables *(config, not engineering — see checklist below)*.
**F4 · Launch** *(last)* — private beta → feedback → public launch.

---

## Owner Activation Checklist (config — before launch, not engineering)

- [ ] **Stripe Live** — `STRIPE_SECRET` (live) + webhook + `BILLING_SYNC_SECRET`; confirm prices + subscription events.
- [ ] **OAuth providers** — register each connected provider's app (`GOOGLE_CLIENT_ID/_SECRET`, `CONNECTED_<KEY>_CLIENT_ID/_SECRET`) → live connections.
- [ ] **AI keys** — `ANTHROPIC_KEY` (drafting), `VISUAL_MODEL_KEY` (Visual Studio), `CONNECTION_ENC_KEY` (connection encryption).
- [ ] **Monitoring + Alerting** — external `/system/health` monitor + error-rate alerting (Ops HIGH-1/HIGH-2).
- [ ] **Production cron** — install `schedule-presence-cron.sql` in prod; confirm `SCHEDULER_SECRET` (Ops CRIT-1).
- [ ] **Secrets / Env vars** — all required + activation vars set on both environments ([ENV-AND-SECRETS](ENV-AND-SECRETS.md)).
- [ ] **DNS / Email** — custom domains + `NETLIFY_AUTH_TOKEN`; email (`RESEND_KEY`, `EMAIL_FROM`, SPF/DKIM/DMARC).
- [ ] **Legal** — fill `[[OWNER: …]]` placeholders + counsel review; publish the document set.
- [ ] **Go-live gate** — confirm prices/nav, then **push** (frontend + `v1.0.0-rc1` tag).

## Launch Checklist

- [ ] Owner Activation complete (above) + smoke-test each activated flow.
- [ ] Human live passes: cross-browser (Chrome/Safari/Edge/Firefox) + real mobile + screen-reader.
- [ ] Private beta → collect feedback → address blockers → public launch.

---

## Version 1.1 Backlog (locked — nothing removed)

Marketplace / Enterprise / Agency **customer + operator UIs** (+ operator/agency auth path) · additional **Industry Packs** · broader **connected providers + write coverage** (folds into A1) · **deeper pack intelligence** · **`connected_data` time-series** · **pixel-level image editing** (Visual Studio inpaint) · **self-serve account deletion** (Privacy R1) · **dedicated Presence PWA** + push/offline · **native dialogs** (replace `confirm()`/`prompt()`) · **offline/reconnect** handling · **`beforeunload`** guard · **bookmarkable tabs** · **keyboard shortcuts** · **skeleton loaders** · **high-contrast mode** · **typeface unification** · **app-level rate limiting** · **request correlation IDs** · **automated live security/accessibility/load** harnesses in CI · **`today.html`/`presence.html` consolidation** (A5).

## Future Roadmap (beyond V1.1)

Developer Mode (Phase B) · Native Desktop (C1) · Native Mobile (C2) · CRM Expansion (D1) · Product Packaging extensions (E1) · runtime third-party plugin ecosystem *(major architecture; would require sandboxing + per-plugin runtime data scoping — see [EXTENSIBILITY-REVIEW](EXTENSIBILITY-REVIEW.md))*.

---

## Locked Exclusions — Studio OS intentionally does NOT include (do NOT build; do NOT remove these decisions)

- ❌ Automatic publishing without approval
- ❌ Automatic social posting without approval
- ❌ AI-generated customer photographs
- ❌ Duplicate approval systems
- ❌ Duplicate intelligence engines
- ❌ Separate codebases for CMS and Business OS

**The platform remains one integrated platform gated by entitlements.** These are constitutional stances, verified intact at RC1, and are locked.

---

## Nothing-Removed Report

Every item from every prior audit, review, and this milestone's checklist is placed **somewhere** on this roadmap:
- **Connected stubs/partials** → A1. **CI/presence deploy** → A2. **Type errors** → A3. **Docs/KB/Support** → A4. **today/presence overlap** → A5/V1.1.
- **Developer Mode** → B1 (required, explicitly captured with exact remaining work).
- **Desktop/Mobile/CRM/Packaging** → C/D/E (kept, none removed).
- **Website/Onboarding/Owner-Activation/Launch** → Phase F, in the owner-locked order.
- **Every V1.1 item + every audit finding** (privacy R1–R6, ops CRIT/HIGH/MED, browser B-1..B-12, legal owner-fill) → V1.1 Backlog / Owner Activation / respective phase.
- **Constitutional exclusions** → Locked Exclusions.
**No item was deleted, judged unnecessary, or silently deferred.**

## Anything Started But Not Finished
1. Connected providers — 3 stubs (`google_tag_manager`, `meta_business`, `apple_business_connect`) + 5 partials → **A1**.
2. Presence function not in CI deploy (test gate done) → **A2**.
3. Baseline `deno check` type errors → **A3**.
4. `today.html` overlaps `presence.html` → **A5**.
5. Deeper pack intelligence / `connected_data` time-series (intentionally shallow) → **V1.1**.

## Anything Agreed To But Not Built
1. **Developer Mode** (required by the owner) → **B1**.
2. **Guided Onboarding** (specified "Critical Before Beta") → **F2**.
3. **Native Desktop / Mobile / CRM Expansion / Product Packaging** (kept on roadmap) → **C/D/E**.
4. **Website & Public Experience** (strategy documented, unbuilt) → **F1**.

## Anything Deferred
Ops CRIT-1/HIGH-1/HIGH-2 (owner activation) · privacy R1–R6 · browser Recommended/V1.1 items · legal owner-fill + counsel review · all V1.1 backlog items — each carried forward above, none dropped.

## Recommended Sequencing (justified; owner-locked tail preserved)
**Rationale:** close the small V1 loose ends first (A1–A4 — low effort, high polish, unblock a clean launch), then the big committed initiatives, then the explicit launch tail the owner locked.
1. **A1–A4** (Connected completion · CI/deploy · type cleanup · doc finalization) — finish V1's loose ends.
2. **A5** (daily-surface consolidation) — quick UX cleanup.
3. **B1 Developer Mode** — the largest initiative; design against the constitution first.
4. **C1 Desktop → C2 Mobile** — same-capability native shells.
5. **D1 CRM Expansion.**
6. **E1 Product Packaging** (incl. CMS-Only / Business-OS-Only, licensing).
7. **F1 Website → F2 Guided Onboarding → F3 Owner Activation → F4 Launch** *(owner-locked order — not moved earlier).*
*(Sequencing is a recommendation only; no item was reprioritized against an owner lock, and nothing was removed.)*

---

## Final Questions (answered honestly)

- **Did anything disappear from the roadmap?** No.
- **Did anything get removed?** No.
- **Did anything get silently deferred?** No — every deferral is documented and placed on a phase.
- **Is every agreed feature accounted for?** Yes.
- **Is every agreed milestone accounted for?** Yes.
- **Is every unfinished item accounted for?** Yes (see "Started But Not Finished").
- **Is Developer Mode fully accounted for?** Yes — B1, with exact exists-vs-remains and the constitutional constraint.
- **Is Connected Platform Completion fully accounted for?** Yes — A1, with the verified Complete/Partial/Stub tiers and the named providers.
- **Is Deployment & CI Completion accounted for?** Yes — A2.
- **Is Documentation Finalization accounted for?** Yes — A4.
- **Are Desktop, Mobile, CRM Expansion, Product Packaging, Website, Guided Onboarding, Owner Activation, and Launch all still present?** Yes — Phases C, D, E, and F1–F4.
- **Anything missing?** No — nothing was found missing; everything agreed appears on the roadmap.

---

## Declaration

**Studio OS Remaining Engineering Roadmap locked.**

*Planning only — no code, features, or priorities changed; nothing removed. Every completed, remaining, deferred, owner-activation, and future item is captured and placed on a phase. Committed, not pushed.*
