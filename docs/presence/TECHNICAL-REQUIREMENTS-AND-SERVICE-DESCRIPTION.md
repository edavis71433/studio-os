# Studio OS Presence — Technical Requirements & Service Description

*The AEM-style product/operations specification (modeled on Adobe's technical-requirements and Managed Services product-description pages), written against the code as deployed. Where AEM publishes provisioning matrices, Studio OS publishes what is true instead: there is nothing to install.*

## 1 · Requirements

| Audience | Requirement |
|---|---|
| **Business owner / member** | An evergreen browser (Chrome, Edge, Firefox, Safari) on desktop or mobile. Nothing else — no Java, no plugins, no minimum hardware. The workspace is responsive; authoring works on a phone. |
| **Site visitor** | Any browser, any device, JavaScript optional — published sites are static HTML/CSS (business-classic emits **zero JavaScript**; forms work without JS via server-side 303 redirects). |
| **Operator (the studio)** | Two Supabase projects (staging `wjlpursnwbmlcdwbeowv`, prod `qksstlqzbhesadrrofgn`), a Netlify account for hosting, Stripe + Resend for commerce/email, and the secret set documented in [ENV-AND-SECRETS](ENV-AND-SECRETS.md). Deploys via `supabase-go functions deploy` (atomic swap). |
| **Developer (optional)** | Developer Mode in the browser (sanitized tokens/CSS/HTML as data) or the SDK for templates/components/packs — TypeScript, deployed with the function. No runtime provisioning ever. |

**Contrast with AEM 6.5/LTS:** no 5 GB install footprint, no 2 GB+ JVM sizing, no Java 8/11/17/21 support matrix, no servlet engines, no MongoDB/Oracle repository planning, no Dispatcher tier. The forced-migration class of problem (e.g., AEM 6.5→LTS Java moves) structurally cannot happen to a customer: templates are versioned server-side and sites pin them; platform upgrades are function deploys.

## 2 · Sizing

Sizing is per-site product caps, not infrastructure math: media per site from the template manifest (default 100, `entities.media.max`), AI capacity per plan (`commerce/capacity.ts`, enforced with calm sentence notices — Law 13), scheduled publishes and form submissions bounded by validation + rate limits (forms 10/min/IP + 60/min/site; signup 5/min/IP; approve 20/min/IP — `lib/ratelimit.ts` over the durable `rate_hit` counter).

## 3 · Environments & deployment

Staging and production are full parallel environments (function + database + migrations). Deploys are **atomic function swaps — zero downtime, no maintenance windows**; published customer sites are immutable static artifacts on a CDN and are not affected by platform deploys at all. Database changes ship as numbered migrations applied per environment (current ritual documented in [DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md); reconciliation tracked FD-S4).

## 4 · Availability, backup & disaster recovery

- **Published sites:** served as static bytes from Netlify's CDN — they keep serving even if the entire Studio OS platform is down (visitor-facing DR by construction; only *dynamic* form submits would queue behind an outage). This is a stronger visitor-availability story than any app-served CMS, AEM included.
- **Content recovery:** every publish is an immutable snapshot; restore is one click (RPO ≈ 0 for published work; RTO = seconds). Version history is never pruned while a site exists.
- **Database:** Supabase daily backups; **PITR + a rehearsed restore drill are owner-activation gate items** (tracked, not yet confirmed).
- **Availability statement:** platform availability is currently inherited from Supabase and Netlify (both publish SLAs and SOC 2 reports); a Studio OS availability statement is published at launch (folded into the FD-R1/Phase-N policy work). No self-declared 9s until we can measure them (FD-S1/S2).

## 5 · Security program

Deny-all RLS with tenant isolation proven per request (`resolveSite`), service-role/caller-JWT separation (audited clean, Phase S), approval-first for every world-changing action, Developer Mode as sanitized inert data, HMAC-signed one-tap approvals, encrypted + revocable connected tokens, honeypot + rate limits on public writes, HSTS-preload/CSP/X-Frame-DENY/nosniff on the app (`_headers`), EXIF-stripped media, and generated privacy/accessibility pages on every customer site (Phase Q) with a **verified no-cookies/no-tracking posture** (no consent banner required). Compliance certifications (SOC 2, ISO) are inherited from Supabase/Netlify/Stripe; first-party certification is a future item.

## 6 · Support & service tiers

Defined per plan as data in `commerce/support.ts` and shipped publicly in `GET /commerce/plans` (Phase P): onboarding, support response (2 business days self-serve → 1 day Managed → named contact/SLA at Agency/Enterprise), AI usage, implementation, training, and maintenance. This is the platform's equivalent of AEM Managed Services' service-component definitions — kept in code so software and service tiers cannot drift.

## 7 · Browser & device support (authoring)

Evergreen Chrome/Edge/Firefox/Safari; responsive workspace (unlike AEM's desktop-class authoring requirement, the workspace is usable on mobile — final verification rides the Phase-K browser pass).
