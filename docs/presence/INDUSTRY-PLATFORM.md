# L5.0 — Industry Platform Foundation

Studio OS adapts to different businesses **without becoming different software**. This milestone defines one industry architecture: every business type shares the same frozen platform and specializes behavior through *data*, not branching. An Industry Pack **extends** Studio OS; it never forks it.

No packs, templates, AI, or industry features were built — this is architecture only. The contract is real and tested (`industry/`, 26 checks), and it *unifies* the two per-vertical registries that already existed rather than adding a third.

---

## 1. Industry Platform Architecture

An **Industry Pack** is a bundle of DATA that extends the platform through the frozen Extension Contract (`Registry → Adapter → Catalog → Rule`), resolved per site, consumed by engines that never change.

```
site.template_slug  ──resolveIndustryKey──▶  IndustryKey  ──resolvePack/composePack──▶  IndustryPack (layers)
                                                                                              │
        the FROZEN engines iterate their registries ◀── extendRegistry(baseline, pack layer) ─┘
```

Two facts make this work without touching an engine:

1. **Self-gating evidence.** An industry's evidence types are namespaced `<industry>.*` and its providers emit only when the resolved industry matches. Its judgment/recommendation/moment rules key off those types — so they are automatically inert for every other industry. No engine-level industry filter is needed.
2. **Additive registries.** Every engine already iterates "its registry." A pack's contributions are `[...baseline, ...packLayer]` (`extendRegistry`, which never mutates the baseline). "No industry" is simply the empty pack — the platform behaves identically with or without one.

**This unifies, not duplicates.** Two per-vertical registries already existed — `writer/pack.ts` (voice + vocabulary) and `coach/packs.ts` (calendar + seasons), both keyed off `template_slug`. The umbrella `IndustryPack` subsumes them as its **creative** and **growth** layers. L5.0 adds the contract and the missing layers; L5.1 migrates the two call sites to resolve their layer through the umbrella.

## 2. Industry Pack Contract

One shape (`industry/contract.ts`), many additive layers — a pack declares only what it specializes (`makePack` fills the rest with empties):

| Layer | What it carries | Consumed by |
|---|---|---|
| `profile` | what the business type IS (typical services, key fields, booking posture) | first-run, CMS scaffolding |
| `vocabulary` | universal term → industry term (`offerings → menu`) | moments, concierge, writer |
| `evidence` | pure providers + **namespaced** catalog types | Evidence Engine (append) |
| `intelligence` | judgment/recommendation/moment/concierge/coach keys (key off this pack's evidence) | the Intelligence pipeline (append) |
| `growth` | the coach `GrowthPack` (calendar/seasons/events) | Growth Coach |
| `creative` | the writer pack (voice/vocab) + photography/media guidance + brand defaults | the one Creative Studio (config) |
| `connected` | relevant provider keys + defaults + emphasis (reviews/booking/…) | Connected surface (order/filter) |
| `cms` | navigation, pages, components, service/landing pages, blog categories | templates/CMS (declarative) |
| `compliance` | industry requirements + notes (medical/legal/financial) | reviewer/guardian, forms |
| `marketplace` | author, license, version, exportable, shareable, changelog | the marketplace lifecycle |

**Nothing is implemented per industry here** — the layers are the *shape* a pack fits.

## 3. Common vs Specialized — the protected core

`PLATFORM_LAYERS` encodes the split (tested — the frozen spines can never leak into a pack):

- **Universal (frozen platform, NEVER in a pack):** the Intelligence pipeline, the Approved-Plan lifecycle + approval law, ownership/export/disconnect, the pure renderer + determinism, the one Concierge host + ≤3-moments + sentences-never-scores, connected auth/crypto/execute, accessibility by construction.
- **Specialized (pack):** vocabulary, which evidence matters, industry copy, growth calendar, creative voice + media guidance, relevant providers + defaults, CMS scaffolding, compliance posture.
- **Customer content (never a pack):** the actual business facts — name, hours, the real menu items, real services, real photos.
- **Configuration (per site, not a pack):** template variant/palette, which providers are connected, the resolved industry key.

## 4. Extension Guide

Everything is additive; **no engine is ever modified**:

- **A new industry** → one `INDUSTRIES` taxonomy line + a pack via `makePack({ … })`; `registerPack` plugs it in.
- **Industry evidence** → pure providers + `<industry>.*` catalog types (self-gating); appended to the Evidence registry.
- **Industry intelligence** → judgment/recommendation/moment keys that consume those types; appended.
- **Industry growth/creative** → fill the `growth`/`creative` layers (the existing coach/writer registries).
- **Industry connected/CMS** → reference existing provider keys and declare scaffolding as data.
- **A pack that specializes another** → set `extends`; `composePack` overlays parent→child.

**Stop signal:** if adding an industry needs an engine edit, the pack boundary is wrong.

## 5. Marketplace Architecture

`industry/marketplace.ts` — the install/version contract as a pure state machine (no storage/UI/packs yet):

```
planned/draft (author) → available → install → installed ⇄ disable/enable ⇄ disabled
                                    → update (to a strictly-newer version)
                                    → deprecate → deprecated
```

- **Enable/Disable** — per-site toggle (`transition`, `canEnable`/`canDisable`).
- **Update** — only forward (`canUpdate` via semver `compareVersions`).
- **Version** — every pack is semver'd.
- **Export/Share** — a pack is DATA, so it exports to a portable self-describing document (`exportPack` → `studio-os-industry-pack`), gated by the author's `exportable`/`shareable` flags.

## 6. Industry Capability Matrix

The design space (21 industries + the generic baseline), by family — capabilities are the *layers each will eventually fill*, not per-industry code:

| Family | Industries | Emphasis (which layers matter most) |
|---|---|---|
| Food | Restaurant, Coffee Shop | menu vocabulary, reservations/orders, seasonal calendar, food photography |
| Home services | Contractor, Electrician, Plumber, HVAC, Roofer, Landscaper | service areas, quotes/appointments, seasonal demand, before/after media, lead forms |
| Health | Medical, Dental | appointments, recall/insurance calendar, **HIPAA-aware** forms, plain-language education |
| Professional | Legal, Financial, Insurance, Real Estate, Consultant, Professional Services | credibility, **compliance disclaimers**, consultations, case/listing pages |
| Creative | Photographer, Creative Agency | portfolio vocabulary, visual-first CMS, inquiry forms |
| Commerce | Retail, E-commerce | products vocabulary, gift/seasonal calendar, payments/catalog |
| Nonprofit | Nonprofit | donations, events, volunteer forms |
| Universal | Generic | the always-on baseline (GBP + Search + Analytics, Home/About/Contact) |

Every one uses the **same** platform, the **same** contract, and the **same** engines — differing only in the data its pack contributes.

---

## Final review

- **Can every industry use one platform?** Yes — all 21 + the baseline resolve to one `IndustryPack` contract over the frozen engines; nothing is per-industry hard-coded.
- **Can future industries be added without redesign?** Yes — a new industry is one taxonomy line + a `makePack` entry + `registerPack`; the 100th plugs into the same registry.
- **Can Industry Packs extend Studio OS without modifying engines?** Yes — contributions are namespaced + additive (`extendRegistry` never mutates); the baseline adds zero industry rules, so the platform is provably identical without a pack; the invariants suite still holds 14/14.
- **Will this architecture still work with 100 industries?** Yes — resolution and composition are generic (registry + extends chain), self-gating keeps each industry's rules inert elsewhere, and packs are versioned, installable, and exportable data. It unifies the registries that already existed rather than multiplying them.
