# CMS-UX-4 — Website Health

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). A calm, plain-English health check that answers one question — *"Is my website healthy?"* — for a business owner with no technical knowledge. Not Lighthouse, not a monitoring dashboard: a trusted-advisor check-up that **projects truth the platform already knows** into reassuring cards.

## Architecture — compose, don't recompute
A pure adapter + a thin composing route. No new validator, no new monitoring, no duplicated logic — every signal is an existing one, re-grouped.

- **`lib/website_health.ts`** — pure `buildWebsiteHealth(input) → WebsiteHealth`. Maps existing signals into customer-safe checks (what / why / one action + a colour-independent status word), grouped into calm categories. Honesty-gated.
- **`routes/health_page.ts` → `handleWebsiteHealth(site, cors)`** — composes the reused projections + small evidence reads.
- **`index.ts`** — `GET /website-health` in the authed, tenant-resolved section.

## Capability inventory + preservation matrix
Every check reuses a source already built. The only new code is the projection.

| Health check | Existing source | Reuse strategy |
|---|---|---|
| Website is online / published | Launch checklist `Website published` (or monitor `…verified`) | reuse `siteLaunchChecklist` item |
| Domain connected | `site.custom_domain` + launch `Domain connected` | reuse |
| Secure connection (SSL) | launch `Security certificate active` (live HTTPS probe) | reuse — **only shown when a custom domain exists** (else unverifiable → omit) |
| Findable on search | launch `Search indexing requested` (sitemap probe) | reuse; `n/a` → omit |
| Visitor insights (analytics) | launch `Analytics connected` (from evidence) | reuse |
| Email protected | launch `Email authenticated` (SPF/DMARC in zone) | reuse; `n/a` (no MX) → omit |
| Content complete / missing | **Content Tree** `missing_required` sections | reuse `siteContentTree` — no re-validation |
| Unpublished / publish-failed / scheduled | Content Tree `has_unpublished_changes` / `site_status` | reuse |
| Website up to date · last published | Content Tree `last_published_at` | reuse |
| Every version saved (backups) | `presence_snapshots` (immutable versions) exist | evidence read (≥1 row) |
| Contact form working | `presence_form_submissions` (a real message received) | evidence read (≥1 non-spam) |
| Connected services + health | `presence_connections` (status/health) + provider labels | reuse |
| Overall verdict + sentence | derived from the composed checks | calm derivation |

**Reused pure helpers/assemblies:** `buildLaunchChecklist` (unchanged) and its gather, now extracted as `siteLaunchChecklist` in `services.ts` so `/launch` and `/website-health` share one honest probe run; `siteContentTree` (CMS-UX-1). No validator or status-mapping was rewritten.

## Honesty Rule (enforced)
A check appears **only when the platform can actually verify it**. Concretely:
- **SSL** is shown only when a custom domain exists (the Studio address is secure by default; claiming/denying the customer's own https without a domain would be dishonest → omitted).
- Any launch item that is **`n/a`** (email with no MX, search before publish) is **omitted**, never shown as a failing item.
- **Contact form** and **saved versions** appear only with real evidence (a received message / a stored snapshot).
- **Performance** is **not a category** — the platform has no reliable performance evidence (Lighthouse is explicitly out of scope), so it is omitted rather than invented. Same standard as SSL / reviews / milestones.

## Categories (only when evidence exists)
Website status · Content · Visibility · Security · Connections · Publishing — in that calm order. Empty categories are never shown; Performance is intentionally absent.

## Customer language & accessibility
- No technical terms: "Something still needs completing before publishing", not "validation error"; the launch checklist's internal `how` text (which mentions "the room", "the observer") is **never** emitted — the adapter writes its own plain-language `why`.
- **Colour is never the only signal:** each check carries an icon glyph *and* a `status_label` word (Working / Needs a look / Scheduled / Not set up). The page is keyboard-complete, screen-reader friendly, reduced-motion aware, with visible focus.

## Security / tenant isolation
Runs after site resolution (`site` scoped to the caller; agency drill-in via `resolveScopedSite`). Every read is hand-scoped `site_id=eq.${site.id}`; connections and evidence are the site's own. Client-safe output only — no launch `how` text, raw step states, evidence type keys, ids, or table names (asserted by test #14).

## Files
- `supabase/functions/presence/lib/website_health.ts` (new — pure adapter)
- `supabase/functions/presence/routes/health_page.ts` (new — composing route)
- `supabase/functions/presence/routes/services.ts` (extracted `siteLaunchChecklist`; `handleLaunch` now wraps it)
- `supabase/functions/presence/index.ts` (registered `GET /website-health`)
- `tests/presence/website_health_test.mjs` (new — 63 assertions)
- `website-health.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`website_health_test.mjs` — 63/63 pass**: healthy site, what/why/status-word shape, **honesty** (no-domain → SSL omitted + neutral domain card; `n/a` items omitted; contact-form/versions only with evidence; no Performance category), missing-content attention, publish-failed priority, scheduled = calm "coming", connection health, empty-category omission, new-site state, calm category order, **client-safe shape**.
- **Regression: 144/144 pure + structural pass** (invariants 14/14; CMS-UX-1/2/3 all green). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /website-health` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't read Tenant B's health, and the live HTTPS/sitemap probes resolve against the right domain.
- Human **browser/mobile/AT pass** on the rendered page (verify colour-independent status reads correctly under a screen reader).
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Future direction (noted, not built)
Website Health is built as a **long-term destination** that can eventually replace the Today dashboard once all CMS customer-experience modules exist. Today and Website Health coexist for now (a doorway links them); **Today was not redesigned in this milestone.**

## Boundaries respected
Stopped at CMS-UX-4. Did **not** begin CMS-UX-5.
