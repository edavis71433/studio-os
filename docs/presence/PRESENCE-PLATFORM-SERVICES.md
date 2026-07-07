# Presence Platform Services — M14

The operational platform: launch, manage, and — crucially — **leave**, all from Studio OS. Builds directly on the M12 contracts (registrar / hosting / DNS / email adapters with declared capabilities; *infrastructure replaceable, customer trust not*) and the M12 plan machinery (every change proposed, explained, approved, reversible). Nothing frozen was touched.

## Ownership guarantees — the right to leave, made executable

Customers always own their domain, content, media, and data. M14 makes each guarantee a working route:

- **`GET /export`** — everything the customer owns in one portable document: the full content snapshot (every word they wrote), the media manifest, redirects, the Brand Profile, knowledge imports, **and the rendered website itself** as plain HTML through the one renderer — hostable anywhere, by anyone. The export's own contract states it: *"Nothing here requires Studio OS."* The room offers it as one quiet button: **"Download everything I own."** A platform that ships its own exit cannot build lock-in.
- **`transfer_out` is a first-class plan** — as guided as `transfer_in`, with the EPP code available "on request, always — no retention hoops," DNS kept answering until the new registrar takes over, and the plan itself stating that leaving is a supported workflow.
- Verified structurally: no M14 module can write to the outside world (no write methods, no deploy calls — asserted by a test reading the source).

## DNS management — a document, drift, and repair

The manual DNS editor edits a **desired-state document** (`presence_dns_zones`), never the world: every record validated (A/AAAA/CNAME/MX/TXT/SRV/CAA/NS + SPF/DKIM/DMARC specializations, duplicates caught, problems named by index), every save versioned (`presence_dns_zone_history`), rollback one call. Observed reality comes from read-only zone snapshots (M12); **drift** = desired records reality doesn't honor — normalized so trailing dots and case never cry wolf, and records the platform doesn't manage are *never* treated as drift or touched. **One-click repair** turns drift into a plan carrying the exact records (adds only, nothing deleted) under the unchanged approval law. When a write-capable DNS adapter ships, repair steps flip from guided to automatic — same plan shape.

## Hosting & SSL

Already automatic through the M12 hosting adapter (deploy history = restore points, one-step rollback, SSL issuance/renewal, health via the evidence pipeline); the foundations surface says it in sentences ("every published version is kept and restorable", "nothing for you to do — ever"). Uptime and infrastructure health remain the observers' job — no parallel monitoring.

## Business email — guided, never hosted

Provider presets as data (`google_workspace`, `microsoft365`, `zoho`, `other` — a new provider is an entry): `email_setup` plans prepare validated MX + SPF + DMARC and name the DKIM record honestly — *the key comes from the provider's panel; the platform never invents signing keys*. MX risk is stated when mail could move. `GET /foundations/email` reports deliverability posture in plain words (MX / SPF / DMARC / DKIM, each explained). The plan says it itself: the platform is not an email service.

## Website migration — reviewed before anything moves

`GET /monitor/import-inventory` reads the verified external site (WordPress/Wix/Squarespace/Shopify/Webflow/Framer/static/custom — the M11 adapter registry) and produces the reviewable inventory: per page, title/description/headings/real body text (nav and footer noise excluded)/word count, plus the deduped absolute-URL media list. Combined with M11 readiness and the M12 migration plan (URL preservation via redirects, launch checks, post-launch QA, DNS-back rollback), that is the migration report and its rollback guidance. **Nothing changes until customer approval** — proven live: the inventory run leaves content byte-identical.

## The Launch Assistant

`GET /launch` — the whole launch as one calm checklist derived from actual state: domain connected, DNS answering, certificate active, website published (or connected & verified for Monitor), search indexing, business profile, analytics, email authenticated, accessibility reviewed. Each item is `done / todo / n/a` (honestly — no-email domains are never nagged) with *how* in plain words pointing at an existing surface. It heads the foundations desk in the room. The feeling it's built for: *"I don't have to leave Studio OS to launch and manage my website."*

## Tests

`tests/presence/services_test.mjs` — 40 checks. Pure: zone validation and drift normalization, repair-plan generation, both transfer directions, all four email presets (records validate, DKIM honesty), import-inventory extraction and determinism, launch derivation across editions and edge states, and the structural ownership assertions. Staging integration: the export verified field by field (including portable HTML), the DNS document round-trip with history and rollback, drift → repair plan under the approval law, transfer-out and email-setup plans, deliverability in sentences, a live launch checklist, and the byte-identical-content proof for the import inventory. Regression sweep green: M12 platform, monitor, agency, evidence, moments, coach, room, M5 pipeline, M6 admin.
