# Platform Services — M12

Studio OS becomes the single place a customer manages the technical foundation of their website — domain, DNS, SSL, email authentication, hosting, migration — without ever needing to understand registrars, name servers, TXT records, SPF, DKIM, or DMARC. **The customer manages their online presence. Studio OS manages the complexity.**

**Permanent principle (adopted M12):** *Infrastructure should be replaceable. Customer trust should not.* Studio OS is the stable control plane; every registrar, DNS host, hosting provider, and email provider is an adapter behind a capability contract. Switching providers must never change the customer experience.

## Architecture — contracts, adapters, plans

```
platform/contract.ts                platform/dns.ts (PURE + one read)     platform/plans.ts (PURE)
─ RegistrarProvider,                ─ record validation: A, AAAA,         ─ Infrastructure Change Plans:
  HostingProvider, DnsProvider,       CNAME (apex caught), MX, TXT,         exact steps, honest risk,
  EmailAuthProvider                   SRV, CAA, NS + SPF/DKIM/DMARC         rollback note, requires_
─ every capability DECLARED:          specializations                       approval (schema CHECK)
  automatic | guided | unsupported  ─ templates: goals → exact records    ─ connect_domain, email_auth,
─ adapters never claim what they    ─ explainRecord: every record in        registrar_care, hosting_
  cannot do                           one plain business sentence           restore + migration
─ shipped: manual registrar         ─ readZone: DoH, read-only,           platform/migration.ts (PURE)
  (guided), Netlify hosting           snapshotted for history/rollback    ─ readiness → full lifecycle
  (automatic, wraps the EXISTING
  lib — zero duplication)
```

**Honesty is structural.** The shipped registrar adapter declares `guided` for everything — it prepares exact human steps and never pretends to automate what no API exists for. The hosting adapter declares `automatic` because Netlify integration is real (provision, deploy, SSL, restore — the same `lib/netlify.ts` the frozen publishing pipeline uses; the adapter is a thin mapping, never a duplicate). DNS reads are automatic (DNS-over-HTTPS); DNS writes are guided until a write-capable DNS adapter ships. A future provider with an API is a registry entry with `automatic` capabilities — proven by a test that plugs one in.

## The approval law

Every infrastructure action is an **Infrastructure Change Plan**: what changes and what doesn't (in sentences), exact records with per-record plain-language translations, which steps are automated vs. performed by a human, honest risk, and a real rollback note backed by a zone snapshot taken at proposal time. `requires_approval` is a CHECK constraint; the apply path refuses any plan whose status isn't `approved` — verified by an integration test that tries. Abandoning is always available. Nothing destructive ever happens implicitly.

## The foundations surface

`GET /foundations` — one view, five sections (domain, DNS, SSL, email, hosting), each leading with a plain sentence: *"The security certificate is healthy and renews itself. Nothing for you to do — ever."* Records are listed with translations ("Lists who is allowed to send email as you — forgeries get caught"). The room opens it from one quiet button: **"The technical side — domain, email, security."** Edition-aware: Monitor customers see observation + guidance ("your website stays on its current hosting"); Presence customers see managed hosting; the ladder adds automation upward.

## Domains, DNS, email — what ships vs. what's guided

- **Real today:** expiration monitoring (M10 RDAP evidence), zone reads + history snapshots, SSL status/provisioning (Netlify), deploy history/restore/rollback, SPF/DKIM/DMARC inspection (M10 email_auth evidence), record validation and preparation, WHOIS-privacy/auto-renew/transfer guidance with exact steps.
- **Guided until an adapter ships:** registrar purchase/transfer execution, DNS record writes, DNSSEC enablement, mail-provider DKIM issuance (the platform names the record; the key comes from the provider — never invented).
- **No parallel systems:** health monitoring stays the Evidence pipeline's job (M10 infrastructure/email providers observe; Moments and the Concierge speak); Platform Services *explains the present* and *prepares approved change*. The platform module imports no evidence/judgment/moments code — asserted structurally.

## The migration lifecycle

Built directly on M11 Migration Readiness (WordPress, Squarespace, Wix, Shopify, Webflow, Framer, static, custom — via the adapter registry): `planMigration(readiness, domain)` produces content mapping per page, media migration, **redirect generation into the existing `draft.redirects` mechanism** (SEO standing preserved, not rebuilt), launch verification checks, post-launch QA (an observation run must come back without new criticals), and a real rollback — the old site stays alive through a 30-day QA window, so rollback is pointing DNS back. Commerce/account pages are planned separately, never silently dropped. *"There is no moment without a website."*

## Integration & commercial

Monitor uses infrastructure observation + guided plans; Presence includes hosting; higher editions include progressively more automation (each new `automatic` adapter capability lands as more automation for them, no redesign). Plans and zone snapshots are client-readable rows (RLS); every proposal/decision/application writes provenance; moments and the concierge keep speaking through the one pipeline.

## Tests

`tests/presence/platform_test.mjs` — 42 checks. Pure: capability honesty, registry composability (a future automatic registrar plugs in), all eight record types + the email trio validated, templates valid and DKIM-honest, all five plan kinds (exact records, honest risk splits, rollback), the migration lifecycle (mapping, redirects, checklists, rollback, determinism), and structural safety (no writes in the platform module, no parallel intelligence, the approval refusal in the code path). Staging integration: foundations in sentences with no leading jargon, prepare → **unapproved apply refused (409)** → approve → apply with guided/automated notes → history readable → abandon. Regression sweep green across monitor, evidence, optimization, judgment, moments, concierge, coach, room, the M5 pipeline, and M6 admin/ops.
