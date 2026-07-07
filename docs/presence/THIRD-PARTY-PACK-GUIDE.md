# L5.4 — Third-Party Industry Pack Developer Experience

Could a company outside the Studio OS core team build, validate, version, and maintain an Industry Pack from the docs alone — without touching platform code? This milestone answers yes, by simulating exactly that: the **Pet Grooming** sample pack was written importing *only* the published SDK, and the gaps that surfaced were fixed.

**Result:** one public SDK surface (`industry/sdk.ts`); validation strengthened to catch every mistake early with clear messages; pack versioning + platform-compatibility added; security boundaries proven; a sample pack that imports only the SDK and flows through the live pipeline. 20 developer-experience checks + full regression green; invariants 14/14 held.

---

## 1. Third-Party Developer Guide

You build an Industry Pack as **data + one pure provider**. You never touch an engine, never bypass approval, never see another tenant. The whole job:

1. **Create `industry/packs/<your_industry>.ts`.** Import only from `../sdk.ts`.
2. **Evidence:** define types with `packType(key, category, name)`, and a provider with `packProvider(key, name, fn)` (auto self-gating).
3. **Intelligence:** write `JudgmentRule`/`RecommendationRule`/`MomentTemplate` objects (shapes from the SDK), one rec + one moment per interruptible judgment rule.
4. **Assemble** the pack with `makePack({ key, label, family, ...only your delta })` — unspecified layers default to empty (or inherit, if you set `extends`).
5. **Validate:** `validatePack(pack)` and `validatePackAgainstRegistry(pack, registeredPacks())` — fix every reported problem.
6. **Ship:** register it (a marketplace install, or one line in `compose.ts` for a first-party pack). Done.

**A new pack is an afternoon's work:** the two worked examples (restaurant/coffee-shop and this sample) plus `makePack` defaults, `packProvider` gating, and `packType` namespacing remove essentially all boilerplate and foot-guns.

## 2. Industry Pack SDK Guide

Everything a pack needs is re-exported from **`industry/sdk.ts`** — if it isn't there, a pack doesn't need it:

- **Contract types:** `IndustryPack`, all layer interfaces, `IndustryKey`, `EMPTY_*`.
- **Contribution shapes:** `Provider`, `JudgmentRule`, `RecommendationRule`, `MomentTemplate`, and their leaf types (`Priority`, `ImpactDimension`, `ActionType`, `ValueDimension`, `Effort`, `Risk`, `Undoability`, `MomentType`, `Tone`).
- **Authoring helpers:** `makePack`, `packProvider`, `packType`, `isPackType`, `typeCollisions`, `validatePack`, `validatePackAgainstRegistry`, `packMaturity`, `packDepth`.
- **Registry + composition:** `registerPack`, `resolvePack`, `composePack`, `resolveIndustryKey`, `industryIsA`, `INDUSTRIES`, `extendRegistry`.
- **Marketplace + versioning:** `PLATFORM_VERSION`, `isCompatible`, `transition`, `canInstall/enable/disable`, `compareVersions`, `canUpdate`, `exportPack`, `canExport/canShare`.

The sample pack imports **only** `../sdk.ts` (verified by test) — proof the boundary is complete.

## 3. Validation Guide

`validatePack` (structural, run anytime) catches, each with an actionable message:

- **Required fields / naming** — `key` must be lowercase snake_case; `label`, `family` required.
- **Evidence namespacing** — types must be `packType`-formed (category-prefixed *and* industry-namespaced).
- **Provider presence** — evidence types require a provider.
- **1:1 intelligence** — judgment rules ↔ recommendation rules ↔ moment templates.
- **Versioning** — `version` and `minPlatformVersion` must be semver; the pack must be compatible with the running platform.

`validatePackAgainstRegistry` (run at install/submission) adds the marketplace-safety checks:

- **Collisions** — an evidence type already claimed by an installed pack.
- **Missing dependency** — `extends` a pack that isn't installed.
- **Inheritance cycle** — a cyclic `extends` chain (bounded, never hangs).

Everything **fails early** — a dev sees the problem before registering, and the marketplace rejects a bad submission with the same messages.

## 4. Versioning Guide

- **Pack version** — semver in `pack.version`; the marketplace only offers strictly-newer updates (`canUpdate` via `compareVersions`).
- **Platform compatibility** — `pack.marketplace.minPlatformVersion` declares the minimum Industry Platform version needed; `isCompatible(pack)` refuses a pack that needs a newer platform than is running (`PLATFORM_VERSION`, currently `5.4.0`; the contract froze at `5.0.0`).
- **Breaking changes** — the pack contract is frozen (L5.0); additions are additive, so an older pack keeps working. A pack that needs a newer platform simply declares a higher `minPlatformVersion`.
- **Deprecation** — the lifecycle state machine (`transition … 'deprecate'`) ends a pack's life; installed sites keep their version until they update.
- **Upgrade path** — `install → update (forward-only) → … → deprecate`; every step is a pure, testable transition.

## 5. Marketplace Readiness Report

Industry Packs are now ready to be **installed, updated, disabled, exported, shared, and sold** without modifying the platform:

- **Install/enable/disable/update/deprecate** — the pure lifecycle state machine.
- **Export/share/sell** — `exportPack` produces a portable, self-describing `studio-os-industry-pack` document; `license`/`shareable`/`exportable` flags gate distribution (the sample ships as `community`).
- **Submission gate** — `validatePack` + `validatePackAgainstRegistry` are the accept/reject checks (naming, namespacing, 1:1 intelligence, semver, compatibility, collisions, dependencies, cycles).
- **Still unbuilt (future, per scope):** the marketplace *surface* — per-site install storage, a browse/purchase UI, partner authoring tools, billing. None require a platform change; they sit on top of this contract.

## 6. Security Review

A pack is sandboxed by construction — it is data plus a pure function, and the engines enforce every guarantee:

- **Cannot invent evidence** — a provider can only `emit` catalogued types; the emit contract rejects anything else (proven: a rogue emit throws).
- **Cannot crash the platform** — a throwing provider is isolated by the evidence engine; the run survives (existing failure-isolation).
- **Cannot bypass approval** — a pack contributes rules that flow through the frozen pipeline; recommendations still carry `approval_required: true` (a schema CHECK); nothing auto-publishes.
- **Cannot cross tenants or industries** — `packProvider` self-gates on the resolved industry (inheritance-aware), so a pack only ever runs for its own industry's sites.
- **Cannot reach an engine** — the SDK exposes data helpers and contribution *shapes*, never engine internals; the invariants suite fails if an engine is touched.

## Sample Industry Pack Walkthrough (Pet Grooming)

`industry/packs/pet_grooming.ts`, ~70 lines, imports only `../sdk.ts`:

1. Two types via `packType('pet_grooming', …)` → `content.pet_grooming_services_unlisted`, `conversion.pet_grooming_booking_missing`.
2. `petGroomingProvider = packProvider('pet_grooming', 'pet_grooming', (i, emit) => { … })` — reads the site's pages, emits when services or booking are missing; self-gates automatically.
3. One judgment (`pet_grooming_essentials`), one recommendation, one moment ("Show your services and let people book.").
4. Layers: profile (breeds, sizes, mobile, appointment booking), vocabulary (book→"book an appointment"), photography guidance, connected (GBP/Calendar/Yelp), CMS (Services/Pricing/Book/Gallery/…), marketplace (`author: 'Acme Pet Co (community sample)'`, `license: 'community'`, `minPlatformVersion: '5.0.0'`).
5. `validatePack` passes; registered like any pack; a pet-grooming site gets a calm services-and-booking moment; every other industry gets nothing. Honestly rated **Standard** maturity (no growth/creative reuse — the model doesn't overclaim).

---

## Final review

- **Could an independent developer build a pack?** Yes — the sample was built importing only the SDK; the gaps found (SDK completeness, versioning, validation depth) are fixed.
- **Would the documentation be enough?** Yes — this guide + the SDK re-exports + two worked examples make a pack a fill-in-the-delta exercise; a new pack is an afternoon.
- **Is the SDK complete?** Yes — the sample compiles and passes validation importing *only* `../sdk.ts`; anything it needed was added.
- **Can the Marketplace safely support community packs?** Yes — `validatePack` + `validatePackAgainstRegistry` gate submissions; packs are sandboxed (catalog-gated emit, isolation, approval-frozen, self-gated); versioning + compatibility + export are in place. The surface is future work; the safety is here.
- **Did anything become simpler?** Yes — one SDK import replaced hunting across internal files; validation now explains every failure instead of failing obscurely; `makePack`/`packProvider`/`packType` removed the boilerplate a pack author would otherwise repeat.
