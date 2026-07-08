# Phase CP-1 — Agency Scale, Reuse & Customer Setup Excellence

*The first Excellence-Directive build: removes the repetitive work between "new client" and "working site." Consolidates the Agency-Workflow / Reuse / Customer-Setup / AI-Starter reports.*

## What shipped (all verified: kits 11/11, full sweep green, live both envs)

**1 · Starter Kits (CP-1.1/1.2 — the reuse engine).** An agency saves any linked client's *setup* as a named kit and applies it to the next client. Two laws, test-locked:
- **Structure + house style only, never another business's facts** — a kit carries offering/FAQ suggestions, voice, palette tokens, industry, category order, preferred template; it *structurally cannot* carry names, contact, story, testimonials, posts, or media (never transplant one business's reviews or photos into another).
- **Fill-only-empty** — applying adds to fresh sections and *never overwrites*; every skip is reported honestly ("offerings — site already has 5, never overwritten"). No data loss, by construction.
- Machinery: `presence_starter_kits` (mig 0056, deny-all RLS), `lib/kits.ts` pure core, four agency routes fenced to the agency's own linked sites (`manage_clients` role), and a Starter Kits card on the agency dashboard (save-from-client, apply-to-client, delete). "Restaurant Starter / Contractor Starter / Salon Starter…" are now one save away from any well-built client.

**2 · Duplicate-as-starter (CP-1)** — same mechanism: saving a kit from your best site IS the duplicate; applying it to a fresh client is the paste. One machinery, no parallel copy system.

**3 · Template switching with preview (CP-1.4/FD-T8).** The preview stage grows a **"Look"** switcher — render *your* content in any compatible template (preview-only, `?template=` through the one renderer, contract-version-checked), then **"Use this look"** applies it (`PUT /site/template`, owner/operator-only, provenance-logged). Content untouched by architecture; every published version still pins its own template, so the old look remains restorable. The workspace vocabulary re-applies instantly after a switch.

**4 · Never ask twice (CP-1.3).** `get-started` now reads what already exists: if the studio applied a kit (or pre-filled services/industry), the intake arrives **pre-populated from the actual workspace** with a calm note — "Your studio started you off — tweak anything, then continue." The AI starter then personalizes *on top of* the kit instead of starting cold.

**5 · AI starter review (CP-1.5).** Audited end-to-end: intake → persisted industry → fact-guarded drafting → approval — already sound. The kit loop was the missing reuse (now: kit fills structure → intake pre-populates → writer personalizes voice/copy). No further AI changes warranted; conversational editing remains Future (FD-AEM2).

## Step 3 expansion — evaluated against "materially improves V1"
Saved branding/design presets → **palettes ARE the design preset** and kits carry them ✓. FAQ/service packs → **kits carry them** ✓. Onboarding presets → the kit+prefill loop ✓. Email templates/automations → lifecycle owns comms; per-agency email templates = V1.1 (FD-B5 note). Proposal/questionnaire presets → agency-sales tooling, not platform V1 (queued note). Image libraries → media stays per-site (trust); shared *stock* = FD-T10. Legal defaults → generated pages already ✓. **Nothing else passed the filter without manufacturing work.**

## Competitor read (Step 4)
HighLevel snapshots and Duda templates copy *everything* including content facts — fast but dangerous (stale phone numbers and borrowed reviews ship constantly). Studio OS's kit is the **safe version of the same speed**: structure at full speed, facts always fresh, overwrites impossible. That's a sales line, not just a safety note. HubSpot/Wix Studio have nothing equivalent at this price tier; AEM's MSM blueprints are the enterprise ancestor — ours is the SMB-shaped descendant.

## Final questions (honest)
- **Could an agency onboard 100 customers?** Operationally yes (Phase BZ) — and now *authoring-wise* yes: per-client setup drops from hours of re-typing to **kit + tweak + draft ≈ minutes**, with the platform running operations unattended after.
- **Could a freelancer launch 20 sites in a month?** Yes for the CMS/BOS tiers: kit → prefilled intake → AI draft → palette → publish ≈ **under an hour of hands-on time per straightforward site**. The Managed tier stays human-hours by design.
- **Hours saved?** Setup re-typing (~2–4h/client at agency quality) → ~10 minutes; ~**90%+ of per-client setup labor removed** at portfolio scale.
- **Anything else before Gold Master QA?** Yes — the approved plan continues: **CP-2 (sections) and CP-3 (type presets)** next, then the small CP items; see the CP report + the owner's any-other-recommendations answer alongside this phase.

**Phase CP-1 — Agency Scale, Reuse & Customer Setup Excellence complete.**
