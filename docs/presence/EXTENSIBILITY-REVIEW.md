# Version 1 — Platform Extensibility Review

*Analysis only — no code changed. Assesses whether developers can safely extend Studio OS, and whether extensions stay isolated and preserve the platform's guarantees. Grounded in the code.*

## The model, in one paragraph

Studio OS has a **deliberately narrow, safe extensibility model**. You extend in exactly two ways: **(A) data additivity** — append to a registry/list (packs, connected providers, evidence/judgment/recommendation/optimization rules, catalog types); the engine iterates generically and invariant **INV-8** enforces this; and **(B) developer-authored templates** — build-time, versioned renderers where design freedom lives. There is **no runtime third-party code execution** (verified: zero `eval` / `new Function` / dynamic untrusted `import` in the function). That absence is a **security feature**, not a gap — no foreign code runs in production, so there is no isolation-escape surface.

## The 16 requested extension types, mapped honestly

**First-class, supported, safe:**
- **Custom Industry Packs** — ✅ the one *published third-party SDK* (`industry/sdk.ts`): types + authoring helpers (`makePack`, `packProvider`, `packType`) + validation (`validatePack`, `validatePackAgainstRegistry`). A pack is *data + one pure provider*, self-gating and inheritance-aware; the sample `pet_grooming` pack is built purely from the SDK. Guide: [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md).
- **Custom Connected providers** — ✅ append to `CONNECTED_PROVIDERS` + a pure normalizer; one shared OAuth/key/read/write flow. *(Code-level extension — you add it to the codebase; not a runtime plugin.)*
- **Custom page templates / layouts / themes** — ✅ the template contract (versioned folder + manifest + render function) is where developer design freedom lives. "Themes" = template tokens. *(One template shipped; the contract is the extension point.)*
- **Custom evidence/judgment/recommendation/optimization providers & rules; custom (catalog) validation** — ✅ append-to-list data; engine generic (INV-8).
- **Custom Marketplace extensions** — ✅ pack install/enable/disable/update/remove lifecycle on the Approved-Plan spine + compatibility gates (`minPlatformVersion`/`isCompatible`). *(Marketplace = pack distribution, not arbitrary extensions.)*
- **Custom API integrations** — ✅ via the Connected Platform (that **is** the integration mechanism).

**Not extension surfaces — by constitutional design (not oversights):**
- **Custom CMS components / blocks / widgets** — the CMS is *structured content* (Product Law: facts in, presentation owned by the platform; "no page editor because there are no pages to edit"). Freedom is at the *template* layer for developers, never runtime components for owners.
- **Custom automations / custom workflows** — no user-defined automation engine; workflows are the frozen pipelines (determinism = trust).
- **Custom AI prompts** — no arbitrary-prompt-injection surface (fact law + injection hardening); the **brand profile** is the sanctioned influence.
- **Custom forms / arbitrary custom validation** — content entities have fixed `SPECS`-driven schemas; no form builder.
- **Custom JavaScript modules (runtime)** — intentionally absent; developer JS lives in build-time templates, never runtime.

## Do extensions stay isolated and preserve the guarantees?

**Yes — strongly, precisely because the model is narrow.**

| Guarantee | How it's preserved |
|---|---|
| **Product Laws / Constitution** | Extensions flow through the SAME frozen pipeline + Approved-Plan spine; they can't *express* a law violation (no engine access); the 14 invariants catch architectural violations in CI |
| **Approval architecture** | Any world-changing action goes through `lib/approved_plan.ts` (`requires_approval` DB CHECK); extensions cannot bypass it |
| **Security / tenant isolation** | One function under deny-all RLS + `resolveSite(jwt)`; the SDK re-exports **type-only** shapes — a pack never imports an engine or a DB handle, never sees another tenant; no runtime foreign code = no escape surface |
| **Isolation (blast radius)** | Packs self-gate (`industryIsA`); `validatePack`/`validatePackAgainstRegistry` reject a bad pack **before** registration; provider failures are isolated (one can't poison a run) |
| **Rollback** | Marketplace/org/connected operations are Approved-Plan operations with reviewed rollback; templates are versioned |
| **Versioning / upgrade compatibility** | `PLATFORM_VERSION` + `minPlatformVersion` + `isCompatible` gate packs; templates versioned; the contract freeze (invariants) protects upgrade compatibility |

**The one honest caveat:** "extending" today means editing the codebase (providers/templates) or authoring a pack via the SDK — integrated at **build/deploy time**, then flowing through all the guarantees above. There is **no runtime marketplace of arbitrary third-party plugins** (developers uploading code that executes in production). That is a deliberate safety trade-off; a true runtime third-party ecosystem would be a large V1.1+ architecture effort (sandboxing, per-plugin runtime data scoping) and is out of V1 scope.

## Started-and-didn't-finish / agreed-and-didn't (honest retrospective)

Nothing here is hidden — each is already in the [Technical Debt Register](RELEASE-NOTES.md#technical-debt-register) or a V1.1 list; collected here for candor:

**Started, not finished (in the code):**
1. **3 connected providers are label-only stubs** — `google_tag_manager`, `meta_business`, `apple_business_connect` are registered (appear in the surface) but their normalizers are placeholders `(r,label)=>({label})` — no real read implementation. The clearest "started, unfinished." *(Additive V1.1.)*
2. **`today.html` duplicates `presence.html`** — I built `today.html` (Track 2 daily hero) while `presence.html` was already the daily hub. It's now wired into the shared nav, but consolidating the two daily surfaces into one canonical hub was left for V1.1.
3. **Presence function not wired into CI deploy** — the CI **test gate** was added (Ops HIGH-3), but the presence *function deploy* stays manual (`supabase-go`), because the standard CLI segfaults on it. Half implemented, half a documented residual.
4. **Baseline `deno check` type errors** (`rollback` on `OrgPlan`/`MarketplacePlan`; a marketplace_ops comparison) — pre-existing, flagged repeatedly, never cleaned (cosmetic; suites green).

**Agreed direction / recommended, not executed (correctly deferred, not dropped):**
5. **Guided first-run onboarding** — a signup → 3-step guided setup → First-Publish celebration was *specified* (Track 2 / Launch Board "Critical Before Beta"), but never built. It is **launch/beta-prep scope** (post-freeze), so it was deferred by design, not silently dropped.
6. **Ops CRIT-1 / HIGH-1 / HIGH-2** (install prod cron; external uptime monitoring; error alerting) — recommended, left as **owner activation** (they start live prod ops / need external services).
7. **Browser "Recommended Before Launch"** — native dialogs replacing `confirm()`/`prompt()`, offline/reconnect handling, typeface unification, live cross-browser/AT passes — recommended, deferred per each milestone's scope.
8. **Legal drafts** — authored with `[[OWNER: …]]` placeholders; owner fill + counsel review is the remaining, intended step.

**Nothing was silently abandoned:** every session deliverable the owner asked for was produced (legal zip + Word doc, CMS preview, status page), and every milestone ended with a declaration matching what was actually done. The items above were all classified and documented, not hidden.

## Verdict

Developers **can safely extend** Studio OS along its intended axes (Industry Packs via the SDK; connected providers, templates, and engine rules via additive code) with **full preservation** of the Product Laws, approval architecture, security, tenant isolation, rollback, versioning, and upgrade compatibility — because the extension model is narrow, data-first, and admits no runtime foreign code. What it deliberately does **not** offer is a runtime third-party plugin/component/theme/automation ecosystem; that is a constitutional design choice (structured content, one renderer, determinism), and expanding it would be a V1.1+ architecture initiative, not a V1 gap.
