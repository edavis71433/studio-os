# Presence Monitor Edition — M11

The entry edition of Studio OS. Businesses with existing websites receive the full intelligence, monitoring, optimization, and guidance stack **without migrating**. The platform observes, explains, guides, and prepares; it never edits, publishes to, or changes anything on the customer's website or infrastructure.

**Product law (permanent):** *Studio OS meets customers where they are before asking them to migrate. Existing websites are welcome. Migration is optional. Value is proven first.*

## Architecture — one pipeline, one new source

A Monitor site **is** a `presence_sites` row (`edition = 'monitor'`). That single fact is the whole upgrade story: evidence history, judgments, recommendations, moments, brand profile, growth opportunities, knowledge imports, and concierge threads are all keyed on `site_id` — upgrading flips one column and copies nothing, so nothing can be lost (proven by the integration test: row counts identical across the flip).

```
presence_monitor_connections          monitor/external.ts (READ-ONLY)        the ONE pipeline
─ url, domain, platform,              ─ fetchExternalSite: homepage +        Evidence → Judgment →
  method, token, status                 ≤7 same-host discovered pages        Recommendation → Moments →
─ verification lifecycle:             ─ verifyConnection: DNS TXT /          Concierge — unchanged.
  pending → verified                    meta tag / file proof                Monitor pages enter at the
─ readiness (M11): the quiet          ─ GETs and DNS lookups ONLY —          COLLECTOR: same providers,
  migration assessment                  no write method exists               same contract, same storage
```

The evidence **collector** is the only integration point: for a verified Monitor connection, `pages` and the live probe come from the customer's external site, optimization probes target its domain, and publish-ledger inputs are zeroed (publish concepts don't exist for a site we don't host). Three one-line truthfulness guards keep providers honest — `website.not_live`, `website.hosting_missing`, and `trust.hours_not_public` are *false* statements about an external site and are never emitted there (`input.external`, always false for hosted sites — existing behavior provably unchanged).

## Platform adapters

`monitor/adapters.ts` — a read-only registry. An adapter is *data*: detection markers plus an operator note. WordPress, Squarespace, Wix, Shopify, Webflow, Framer ship detected; unknown → `custom` (hand-built and static sites get full observation either way). Detection never changes behavior per platform, never requests credentials, never gains write access. A future platform is a registry entry, nothing more.

## Verification lifecycle

`connect` (URL → pending connection + token + plain instructions) → the customer places a proof → `verify` (read-only check) → observation begins. Three equivalent methods, no provider-specific assumptions: a DNS TXT record on `_dds-verify.<domain>`, a `dds-site-verification` meta tag, or a `/dds-verify-<token>.txt` file. Checks are honest — failure names what's missing; nothing observes an unverified external site. Disconnecting stops observation.

## Migration Readiness (the quiet selling point)

While monitoring, Studio OS deterministically answers *"what would migration take?"* from the same observed pages and evidence (`monitor/readiness.ts`, pure):

- **Pages:** each external page classified (home/menu/about/faq/contact/updates/other) and fitted — `clean` (maps straight onto the template), `review` (becomes an update/page), `manual` (commerce/account features, planned separately).
- **SEO preserved:** titles/descriptions counted as carrying over; renamed paths become 301s through the existing redirects mechanism — search standing preserved; structured data is regenerated (usually an upgrade).
- **Accessibility first:** the worst observed issues, deduped, in order — what deserves fixing before or at migration.
- **Content after:** what the studio would improve post-migration, derived from evidence, as sentences.

Customers get sentences only (`GET /monitor/readiness` — no state word, no score, per Law 13); operators get the full working detail (`GET /admin/sites/:id/migration-readiness`, including the `ready | mostly_ready | needs_prep` shorthand). The latest assessment is quietly kept on the connection row.

## Boundaries (enforced, not promised)

- `POST /publish` and `POST /restore` return 403 for Monitor sites with a warm explanation — the gate sits in the router; the publishing pipeline is untouched and returns at upgrade.
- `monitor/` contains **no write method toward anything external** — GETs and DNS lookups only, asserted by a test that reads the source.
- Everything else stays available: the business profile, Brand Profile, knowledge import, the studio (Writer/Editor/Reviewer/Guardian propose and prepare — nothing can reach an external site), the Coach, and the Concierge.

## Commercial positioning

The first rung of the additive ladder ratified in Amendment 2: **Monitor → Presence → Presence Managed → Agency → Enterprise.** Monitor proves value on the customer's existing site (moments, guidance, readiness); Presence adds hosting, publishing, and the full CMS; each rung is additive and the upgrade preserves every site-keyed row by construction.

## Tests

`tests/presence/monitor_test.mjs` — 46 checks. Pure: adapter detection for seven platforms, same-host page discovery (capped, deduped, asset-free), verification matchers and `verifyConnection` with injected fetchers (no network), the three truthfulness guards (hosted behavior unchanged; external never emits false claims), Migration Readiness (classification, fit, SEO preservation, accessibility priorities, sentence-only summaries, determinism), and no-write-path structural checks. Staging integration: the full lifecycle — edition flip, publish/restore 403, connect example.com, honest verification failure, force-verified 27-provider observation of the real external site, readiness in sentences (client) and full detail (operator), upgrade with all history intact, gate lifted, state fully restored. Full regression sweep green: evidence, optimization, judgment, recommendation, moments, concierge, coach, writer, editor, reviewer, guardian, room, and the M5 publish pipeline.
