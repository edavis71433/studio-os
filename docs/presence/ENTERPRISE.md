# L5.6 — Enterprise & Multi-Location Foundation

One business can now own many locations — a restaurant chain, a dental group, a retail chain — while everything that made Studio OS good for one business holds: customer ownership, Calm Software, **one** intelligence pipeline, **one** approval model, **one** connected platform, **one** industry platform. No duplicated architecture, no engine change. A chain behaves exactly like one business, many times over.

**Result:** the inheritance model (Organization → Region → Location, only differences stored), org-wide changes on the frozen Approved-Plan spine, and a per-location config resolver — 22 pure + 5 live checks; full regression green; invariants 14/14 held; 1000 locations resolve + roll up in ~10 ms.

---

## 1. Enterprise Architecture

A **location is a `presence_site`** the existing pipeline already runs. The organization adds one thing: an **inheritance layer**.

```
Organization ─▶ Region (optional) ─▶ Location
   defaults          overrides           overrides
        └──────── resolveConfig (deep-merge, only differences stored) ────────┘
```

- **`presence_organizations`** — an org owned by a tenant (ownership preserved).
- **`presence_regions`** — an optional middle tier.
- **`presence_sites.org_id / region_id`** — a location links to its org (additive, nullable).
- **`presence_org_config`** — the inheritable config, stored **only where overridden** (level `org`/`region`/`location`).
- **`presence_org_operations`** — the Approved-Plan ledger for org-wide changes.

Everything reuses existing contracts: the inheritance is the same layered-merge the Industry Pack `composePack` uses; org changes reuse the Approved-Plan spine; the pipeline is unchanged.

## 2. Location Inheritance Guide

`resolveConfig(org, region?, location?)` deep-merges the chain — a child overrides only the fields it sets; everything else inherits:

- **Scalars/arrays** — a child value replaces the parent's (an override); arrays replace wholesale when set.
- **Objects** — merge recursively, so overriding `brand.palette` keeps the inherited `brand.name` and `brand.logo`.
- **Only differences stored** — `diffFromParent` returns exactly what a location overrides; a location that matches the org stores nothing.

Inheritable: brand, voice, photography, Industry Pack, compliance, connected guidance, business profile, growth calendar, CMS, policies, template. Per-location **identity** (name, address, phone, hours, timezone) is never inherited — it lives on the location.

## 3. Organization Model

An organization owns locations; a region is an optional grouping. Config lives at three levels, resolved bottom-up. The customer thinks "one organization with many locations," never "hundreds of websites." Ownership is the tenant's; delegated administration (agencies) operates through the operator surface without duplicating work.

## 4. Enterprise Connected Platform Guide

- **Organization connections** are guidance/defaults set at the org level and **inherited** by every location.
- **Location connections** override or add — a location can connect its own Google Business Profile while inheriting the org's provider list.
- **Approval inheritance** — connecting a provider is still approved per location (the connected platform's own approval, unchanged); the org only sets *guidance*, never a credential.
- **Delegated / shared credentials** — modeled as org-level connected defaults; a disconnected location simply overrides to none. No provider-specific code — the connected platform is untouched; the org layer only carries the `connected` guidance field.

## 5. Enterprise CMS Guide

- **Organization pages / navigation / policies / components** are set once at the org and inherited.
- **Regional pages** override at the region tier.
- **Location pages / media** override at the location tier.
- **Shared templates** roll out org-wide (an Approved Plan); an overriding location keeps its own until it chooses to adopt.

All of this is the `cms` config layer flowing through `resolveConfig` — the CMS engine and templates are unchanged.

## 6. Enterprise Intelligence Guide

**One pipeline, unchanged.** Each location's site runs the same Evidence → Judgment → Recommendation → Moments → Concierge it always did. The organization adds two things, both without engine changes:

- **Context via inheritance** — a location inherits its Industry Pack, compliance, and voice from the org, so its pipeline already reflects the organization.
- **Cross-location as a read-side rollup** — `aggregateLocations` summarizes what each location's pipeline already produced (open moments, needs-attention, calmest/busiest). This is a *consumer* of stored per-location results, not a new engine.

A restaurant chain's intelligence **is** the restaurant pack, applied per location. No org-specific rules, no second pipeline.

## 7. Security Review

Boundaries, attacked and held:

- **Location isolation** — `resolveConfig` is pure and per-location; one location's override never affects a sibling (tested).
- **Override protection** — an org-wide change reaches inheritors but an **overriding location keeps its own** (inheritance never overwrites a deliberate override; tested).
- **Approval boundaries** — every org-wide change is an Approved Plan with `requires_approval` as a **DB CHECK** (proven live) and an atomic claim (executes exactly once, proven live).
- **Customer ownership** — no org operation touches a location's content, media, drafts, domains, or history; the plan's "what stays" says so and the executor only merges the shared config layer.
- **Cross-location protection** — config is scoped by `org_id`; deny-all RLS on every new table; operators own no site and are gated (staff/system).

## 8. Performance Report

- **Inheritance resolution** — pure deep-merge, O(depth × fields); 1000 locations resolved + rolled up in ~10 ms.
- **Pipeline execution** — unchanged and per-location (independent); an org doesn't slow a location's run.
- **Pack composition / connected resolution** — unchanged (still per-site).
- **Approval operations** — one indexed ledger table; the atomic claim is O(1).
- **Memory / startup** — the org layer is data loaded on demand per request; nothing global, nothing eager.

## 9. Enterprise Readiness Report

Ready as a **foundation**: the organization/region/location model, inheritance with only-differences-stored, per-location config resolution, org-wide changes on the Approved-Plan spine, and cross-location rollups — all reusing existing contracts, all preserving ownership, all engine-free. **Deliberately not built (per scope):** CRM, commerce, analytics dashboards, reporting. The operator/agency surface is present; richer per-org permission tiers (org-admin vs delegated) are a noted extension on top of this foundation.

---

## Final review

- **Can Studio OS manage thousands of locations?** Yes — a location is a site the pipeline already runs; inheritance is pure and fast (1000 in ~10 ms); state is per-org and indexed.
- **Can organizations share everything safely?** Yes — set once at the org, inherited everywhere; deny-all RLS, per-org scoping, ownership preserved.
- **Can locations override only what they need?** Yes — `resolveConfig` + `diffFromParent`; only differences are stored, and an override is never overwritten by an org change.
- **Does the Intelligence Pipeline remain unified?** Yes — one pipeline per location, unchanged; cross-location is a read-side rollup, not a new engine.
- **Did Enterprise require engine changes?** No — the enterprise module imports no pipeline engine; invariants hold 14/14.
- **Does this strengthen — not complicate — the platform?** Yes — it reuses the industry inheritance pattern and the Approved-Plan spine; a chain is one business, expressed many times, with no new architecture.
- **Would another team understand it?** Yes — three tables + a pure resolver + a store that reuses the spine + one route file; the same propose→approve→execute→audit→rollback used everywhere.
