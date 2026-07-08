# Phase U — Domain, Hosting & Infrastructure Experience Audit

*The ideal: customers think they own a website, not a hosting account; agencies think they manage clients, not infrastructure. Audited against AEM Cloud, Webflow Hosting, Netlify/Vercel/Cloudflare Pages+DNS, Squarespace, Wix, Shopify, WordPress.com, Duda, HubSpot, HighLevel, and the registrar workflows (Namecheap/Cloudflare/Google-historical). Workflows, not feature lists. Every claim verified in code.*

---

## Executive summary — the finding is inverted from the previous audits

**Infrastructure invisibility is the one area where Studio OS is already substantially done — and differentiated.** The platform ships a **Foundations Desk** in the workspace ("The technical side — domain, email, security") that renders the *entire* infrastructure posture in plain sentences: your address, the records (each DNS record explained in plain words), the lock in the browser (SSL), email protection (SPF/DKIM/DMARC as "anyone can forge mail from this domain until SPF exists"), hosting, and the export door. DNS is managed as a **desired zone vs observed zone with drift detection, version history, and rollback**; every real-world change (transfer in/out, email auth, DNS repair) arrives as an **approval plan** — never a raw record editor. A **Launch Assistant** (`/launch`) checks actual state (apex resolves, site live, sitemap reachable). SSL/CDN/cache/compression/image variants are fully automated (Netlify + the render pipeline) and never surfaced. Publish/preview/rollback are one-click and versioned. **No competitor in the comparison pairs plain-language DNS with approval-gated changes** — registrars give raw record editors; builders hide DNS until it breaks, then dump the user into one.

The honest gaps are all **acquisitions/integrations, not workflow design**: in-product domain purchase, registrar-API auto-connect, renewal/expiry watching, and agency bulk domain ops — every one V1.1+. **No Version-1 implementation was warranted by this audit** (the rare, correct outcome): the remaining V1 infrastructure items are the already-tracked owner-activation steps, not product gaps.

---

## Competitor matrix (workflow-level)

| Workflow | Registrars | Builders (Wix/Sqsp/Shopify/Webflow) | Devhosts (Netlify/Vercel/CF) | AEM Cloud | **Studio OS** |
|---|---|---|---|---|---|
| Buy a domain in-product | ✅ core | ✅ | 🟡 | ❌ (BYO) | ❌ (**FD-INF1**, V1.1) |
| Connect an existing domain | raw DNS | guided copy-paste; some auto-connect | raw-ish | ops team | **guided + plan-gated** ✅ (registrar-specific copy = FD-INF2) |
| See DNS in plain words | ❌ | ❌ | ❌ | ❌ | **✅ unique** (explainRecord) |
| DNS change safety | none | none | none | change mgmt | **✅ versioned + rollback + approval plans** |
| SSL | manual-ish | auto | auto | managed | **✅ auto + explained ("the lock")** |
| CDN/cache/image-opt/compression | n/a | auto | auto | managed | **✅ auto, invisible** |
| Email auth (SPF/DKIM/DMARC) | raw records | mostly ignored | n/a | ops | **✅ plain-words posture + prepare-plan button** |
| Deploy / preview / rollback | n/a | publish + limited versions | ✅ deploys | ✅ | **✅ one-click, versioned, approval-first** |
| Launch readiness check | ❌ | partial checklists | ❌ | ❌ | **✅ from actual state** (`/launch`, wired in the UI — verified) |
| Domain transfer in/out | forms | painful | n/a | ops | **✅ as guided prepare-goals** (transfer_in/transfer_out plans) |
| Renewal/expiry watching | ✅ (their domain) | ✅ (their domain) | ❌ | ops | ❌ for BYO domains (**FD-INF3**, V1.1) |
| Multi-site domain ops at 50+ clients | n/a | per-site | per-site | MSM | per-site via plans; bulk = **FD-INF4** (V1.1) |
| Backups/recovery | n/a | limited | deploys | managed | ✅ versions+restore; PITR = owner activation |
| Monitoring | ❌ | ❌ | 🟡 | ✅ | ✅ health + Monitor edition; uptime watch = FD-10 |

## Domain / Hosting / Email / Agency / Owner audits (condensed, verified)

- **Domain:** connect/verify/transfer/repair all exist as **plans through the approval spine** with plain-language framing; www/apex resolution is checked by the Launch Assistant; the desk explains every record. *Should customers ever manually edit DNS?* **They can't and shouldn't** — the desired-zone + plan model is strictly better; the only V1.1 add is registrar-specific "at GoDaddy, click…" copy (FD-INF2) and API auto-connect where registrars allow (Entri-class, FD-INF2).
- **Hosting:** deploy/preview/rollback/restore one-click ✅; CDN/cache/compression/variants automated ✅; nothing to expose — correctly invisible.
- **Email:** SPF/DMARC read + explained; DKIM guided (provider-side, honestly stated); the platform's own transactional email (Resend/receipts/one-tap) is studio-domain — **customers never see email auth unless they have mail on their domain**, and then it's a plan, not records. Correct.
- **Agency at 10/50/100:** per-client foundations scale linearly (each client = one calm desk); bulk cadence ops exist; the missing multipliers are the known reuse gap (FD-18) + bulk domain/renewal views (FD-INF4). Ownership transfer = the export door + operator tools (documented).
- **Business owner:** every infrastructure workflow is already one wizard/plan/sentence. The Foundations Desk *is* the answer to "should they ever see it" — visible only when they choose the door marked "the technical side."
- **Developer boundary:** raw DNS record values (visible inside plans), SDK, and infra-level operator tools stay technical — correct and constitutional.

## Implementation (Step 9)

**None required — stated plainly rather than manufactured.** This audit's checklist was largely built in M6/M14 (foundations desk, DNS versioning, plans, launch assistant) and verified live earlier in this session (room/pipeline suites cover publish/preview/restore; the desk code is wired). The V1 infrastructure work that remains is **owner activation** (Netlify token, PITR, cron — already gated and documented), not product surface. Queue delta below; regression sweep unchanged-green from T3 (no code touched this phase).

## Feature Discovery updates

- **FD-INF1 · In-product domain purchase** (registrar/reseller integration; renewal billing through the platform). *V1.1+ · High effort · the single biggest "own a website" completer.*
- **FD-INF2 · Registrar-aware connect** — per-registrar instructions + API auto-connect where supported (Entri-class). *V1.1.*
- **FD-INF3 · Renewal/expiry watching for BYO domains** (RDAP check → a calm Moment before expiry). *V1.1 · small engine add.*
- **FD-INF4 · Agency bulk domain/renewal/publish views** (a portfolio-level foundations roll-up). *V1.1 · pairs with FD-C5.*
- *(Named FD-INF\* to avoid colliding with the roadmap's earlier "Phase U — customer-site capabilities" items.)*

## Final questions (honest)

- **Launch + operate without understanding DNS?** **Yes** — connect is guided, changes are plans, records are sentences. The only DNS a customer ever *sees* is explained prose behind a door they chose to open.
- **Agency manage dozens efficiently?** Operationally yes; the multipliers left are reuse (FD-18) + bulk infra views (FD-INF4).
- **Remove more complexity?** The remaining removals are integrations (buy-domain, auto-connect, expiry watch) — queued, none V1.
- **Should customers ever touch DNS / think about SSL / understand hosting?** **No, no, and no** — and today they don't: DNS is plan-gated prose, SSL is "the lock in the browser," hosting is a sentence. This is already the product's reality, not an aspiration.
- **Operators repeating infra tasks?** Provisioning is automated; the manual residue is owner-activation (one-time) and the migration hold-back ritual (tracked, Phase S/B5).
- **What still feels technical?** DKIM's provider-side step (honest, guided), raw record values inside a plan (appropriate), and the operator's own tooling (appropriate).
- **Absolutely V1 before launch?** Nothing new from this audit. The list stands: owner activation, browser QA, front door, the push (+ FD-M2/M3).

**Phase U — Domain, Hosting & Infrastructure Experience complete** *(audit; no V1 implementation was warranted — the invisibility ideal is already substantially built, and honestly saying so beats manufacturing work).*
