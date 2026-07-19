# DNS ONE-STOP SHOP — spec (2026-07-19)

Eric's directive: *"I want to truly manage someone's DNS and records in my
site… it looks like I'm sending people there having them come back… I want
it all to be one stop shop. Mine looks fake."*

Evidence base: exhaustive 83-page recon (every tab; 15 "configure elsewhere"
moments catalogued with exact copy) + provider research (sources in the
research report). Companion docs: this file is the spec; the audit lives in
POST-REDESIGN-AUDIT.md.

## 1. What exists today (the honest read)

Studio OS OBSERVES DNS excellently and WRITES nothing:
- Connect-domain = Netlify `custom_domain` PATCH + "paste these 2 records at
  GoDaddy/Namecheap" (presence.html:2342-2354); verification is DoH polling
  (admin.ts:188-225); SSL is Netlify-automated.
- The Foundations Desk generates PLANS (connect_domain, email_setup,
  email_auth, dns_repair, registrar_care, transfers) whose every DNS step is
  "guided" — copy-paste instructions (platform/plans.ts, email_providers.ts).
- CRITICAL ASSET: the architecture already contains the socket —
  platform/contract.ts:88-97 declares DNS `write:'guided'` with the note that
  a write-capable adapter slots in as `'automatic'` "without touching
  anything above it"; presence_dns_zones (desired zone) + drift diff +
  presence_infra_plans (approval-gated, schema-CHECKed) + zone snapshots
  ("what changes diff against when a write-capable adapter ships") are the
  intended execution spine. We are shipping the adapter, not a rethink.

## 2. The Squarespace-shaped answer (recommended: Tier B)

Customer's ONE-TIME action: change nameservers at their registrar (we
deep-link the exact screen via the RDAP registrar detection that already
exists — lib/rdap.ts registrarTip). From then on Studio OS is their DNS:
site records auto-managed, email one-click, verification records placed by
us, repair plans APPLY instead of instruct.

**DNS backbone — decision:** AWS Route 53 (recommended) vs Netlify DNS vs
Bunny:
- Route 53: $0.50/zone/mo (first 25; $0.10 after) → ~$12.50/mo @25, $20 @100,
  $60 @500 + pennies of queries. WHITE-LABEL nameservers via a reusable
  delegation set (ns1-4.davisdigitalstudio.com — customers see YOUR brand,
  Shopify-style). DNSSEC available. ToS-clean for managing customer zones.
  Best-documented API. NOTE: delegation set must exist BEFORE the first zone.
- Netlify DNS: $0, zero new vendors, sites already there — but NO DNSSEC
  (stale DS records break onboarding), thin/undocumented API + limits,
  nsone.net-branded nameservers. Acceptable shortcut; plan an exit.
- Bunny DNS: free to 500 zones (~$1/mo minimum) but reseller ToS UNVERIFIED.
- Cloudflare free zones: ToS-prohibited for this use without a partner
  agreement (self-serve resale/MSP ban) — a compliance trap; skip.

**Onboarding flow (the wizard replacing "paste these records"):**
1. Enter domain → RDAP identifies registrar (exists) → DS-record check via
   DoH (stale DNSSEC breaks delegation — block with guidance if present).
2. Record SCAN (honest import): query a fixed name list over DoH (apex, www,
   mail, ftp, autodiscover, _dmarc, common DKIM selectors; A/AAAA/CNAME/MX/
   TXT/SRV) — the DoH machinery exists (platform/dns.ts:175-196). Show the
   found records, customer confirms; email records get an explicit "verify
   before switching" warning. Import into the new zone BEFORE delegation so
   nothing breaks at cutover.
3. Create zone via adapter → show the 2-4 nameservers + registrar deep-link
   → poll NS via DoH with a calm status line ("Waiting for the change at
   GoDaddy → detected → active"; outer-bound copy 24-72h) → auto-place site
   records (A 75.2.60.5 + www CNAME) + verification TXT → SSL kicks as today.
4. Thereafter: the Domain & email desk shows the LIVE ZONE as a managed
   records table (type/name/value/TTL, "managed by Studio OS" chips on
   records we own, add/edit/delete for the rest), one-click email setup
   (google_workspace/microsoft365/zoho templates already exist —
   email_providers.ts — now APPLIED not instructed; SPF as MERGE never
   append), dns_repair plans gain an Apply button through the existing
   approval machinery.

**Guardrails (from the research's liability analysis):** full pre-migration
zone snapshot (table exists); MX/SPF/DKIM/DMARC flagged protected with
confirm friction; never delete records we didn't create; low TTLs during
cutover; every mutation logged to zone history (table exists); per-zone
mutation rate cap.

**Synergies:** slice-6 Resend inbound records auto-provisioned; monitor
_dds-verify TXT self-placed; apex-drift watcher becomes self-healing (with
approval); per-tenant email sending domains become POSSIBLE later (Resend
domain verification needs DKIM/MX we could place).

## 3. Tier A (lighter, NOT recommended as the goal) and Tier C (later)

- Tier A = automate today's flow (Cloudflare for SaaS/custom hostnames or
  Netlify-native): removes SSL/pointing pain, but MX/SPF/everything still
  edited at the registrar — fails "one stop shop". Only worth it as interim.
- Tier C = Tier B + selling domains in-app. Start Name.com Core API (free,
  retail+markup, real API) when ready; graduate to OpenSRS wholesale ($0/mo,
  Shopify's registrar) at volume. ICANN duties land on the sponsoring
  registrar via prebuilt verification flows; we flow down contract terms and
  identify the registrar in our agreement. Registration cost pass-through
  ≈$10-12/yr per .com, rebillable at $20 (margin funds the DNS bill).

## 4. Slice plan (each: build → adversarial review → gates → Eric approves)

- D1 Backend adapter + zone lifecycle: provider adapter implementing the
  contract (create/delete zone, record CRUD, NS status), secrets pattern as
  NETLIFY_AUTH_TOKEN; desired-zone doc becomes writable-through; zone
  history logging. [M]
- D2 Onboarding wizard: DS check, record scan + import review, NS
  instructions w/ registrar deep-link, propagation poller, auto site+verify
  records. Replaces presence.html:2337-2390. [M]
- D3 Records UI: the managed zone table in the Foundations Desk (+ the
  API-only /foundations/dns editor gets its UI), protected-record
  guardrails, plan Apply buttons. [M]
- D4 Email one-click: provider templates applied via adapter (SPF merge
  logic), Resend inbound records auto-placed, posture panel flips from
  "add at your DNS host" to "Fix it for me". [S/M]
- D5 (Tier C, later): in-app domain purchase + renewal lifecycle. [L]

## 5. Decisions for Eric

1. Tier: B now (recommended), C later — or push straight to C?
2. Backbone: Route 53 w/ white-label ns1-4.davisdigitalstudio.com
   (recommended, ~$12.50-60/mo) vs Netlify DNS ($0, no DNSSEC, unbranded)?
3. White-label nameservers on day 1 (Route 53 only; needs 4 glue records set
   once at HIS registrar for davisdigitalstudio.com — the one real manual
   step, done by Eric not customers)?
4. Migration posture for EXISTING connected domains: leave them on the old
   flow until each customer opts in (recommended) vs proactive migration?
