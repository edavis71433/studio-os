# AEM Spec Comparison — Studio OS vs the Adobe Experience Manager Standard

*Owner-requested, detailed comparison of Studio OS (as built, verified in code) against: (1) the AEM capability catalog (ranosys overview, 60 items), (2) AEM Managed Services' operational commitments (Adobe legal product description — page timed out on fetch twice; its commitments are cited from its well-established public terms and labeled accordingly), (3) AEM 6.5 + 6.5 LTS technical requirements (Experience League, fetched). Every "Studio OS" claim below is grounded in files, not memory.*

---

## Part 1 — The 60-capability catalog, mapped

Legend: ✅ built (file) · 🟡 partial · 📋 queued · ❌ rejected (law) · ⬜ out of scope (different product).

### Core modules
| AEM | Studio OS | Evidence / disposition |
|---|---|---|
| Sites (create/manage/optimize/publish) | ✅ | the whole platform; one render pipeline (`lib/render.ts`), approval-first publishing |
| DAM (central assets, variations, workflows) | ✅ core · 📋 conveniences | media library + enforced alt + auto responsive variants (`lib/media.ts`, serializer); folders/brand-kit FD-20, crop/focal FD-T11, asset *versioning* folded into FD-20 |
| Mobile (apps) | 📋 | Phase G (native, post-launch) — deliberate |
| Forms (docs + e-sign) | 🟡 | lead/contact forms end-to-end (Phase F/V incl. the working template form + honeypot + thanks); doc-management/e-sign ⬜ (not our product) |
| Communities · Screens · Guides · Learning Manager | ⬜ | different products; explicitly out of scope |
| Cloud Service (auto-scale, redundancy) | ✅ | serverless edge (Deno) + static CDN hosting — scale is inherent, not configured |

### Authoring & content
| AEM | Studio OS | Evidence / disposition |
|---|---|---|
| WYSIWYG editor | ✅ (calmer form) | structured fields + **pixel-perfect preview** (`/preview` uses the production renderer) — same certainty, no layout foot-guns |
| Editable templates · Core components · Style system | ✅ architecture · 📋 build-out | templates-as-data (T: engine × vocab × theme × components); catalog 30 blocks (`lib/site_components.ts`); realization FD-T5, themes FD-T3/T6 |
| Content Fragments (structured, omnichannel) | ✅ | the ENTIRE content model is structured fragments (`SnapshotContent`) — AEM's optional discipline is our only mode |
| Experience Fragments (reusable blocks) | 📋 | FD-T5/T12 + FD-18/B5 (cross-site reuse) |
| Headless / GraphQL delivery | 🟡→📋 **NEW FD-AEM1** | the snapshot IS clean structured JSON and `/export` delivers it (right-to-leave); a *public headless content API* is now queued (V1.1+) — the data model is already headless-ready |
| SPA editor · Drag-and-drop builder | ❌ | constitutional rejection (deterministic render, no freeform builder) |
| Conversational authoring / Document MCP | 🟡→📋 **NEW FD-AEM2** | Concierge answers + writers draft (approval-first) today; chat-*driven editing* queued as Future |
| Translation workflows | 📋 | FD-R4 (multi-language — deliberate decision item) |
| MSM (multi-site, geo/language) | 🟡 | org→region→location inheritance (L5.6, mig 0043) covers governance; content-sync FD-18; language FD-R4 |
| Version control & history | ✅ better-shaped | every publish = an immutable snapshot, 1-step restore (`/publishes`, `/restore`); named versions FD-7, visual diff FD-12 |
| Content staging & preview | ✅ + 📋 | draft/preview/schedule ✅; parallel Launches FD-T7 |
| Workflow automation (approve/publish/distribute) | ✅ constitutional | the Approved-Plan spine + one-tap approve — AEM makes workflows configurable; ours are law |
| Project dashboard | ❌ | rejected (FD-14, Law 13 — no task-management surface) |

### Intelligence (Sensei/Agents)
| AEM | Studio OS | Evidence / disposition |
|---|---|---|
| GenAI authoring (rewrite/summarize/tone) | ✅ | writers + voice guard (`writer/`), fact-guard — drafts never invent, always approval-first |
| Smart tagging / visual search / smart crop | 📋 | FD-M9 (AI alt/tagging) + FD-T11 (crop/focal); visual search rejected for V1 (library scale doesn't need it) |
| Site Optimization Agent / Experience Audit | ✅ **this is our spine** | Evidence→Judgment→Recommendation→Moments (`platform/`, packs) — continuous, industry-aware, calmer than AEM's audit |
| Content Production Agent | ✅ | starter-site + growth writers (Phase I flow) |
| Audience/Journey/Experimentation/Product-Advisor agents | ❌ | personalization/targeting rejected (determinism + calm laws) — a published site is one honest site |
| Data Insights / forecasting | 🟡 | Moments say what matters in sentences (Law 13 forbids dashboards); connected reads supply the data |
| LLM Apps / LLM Optimizer (AI-search visibility) | ✅ posture | clean per-industry schema.org + zero-JS semantic HTML (T3) is exactly what AI search consumes; an explicit AEO report = future note |
| Workflow Optimization Agent | ⬜ | enterprise PM tooling — out of scope |

### Platform & security
| AEM | Studio OS | Evidence |
|---|---|---|
| RBAC | ✅ | site roles + capabilities (`lib/site_roles.ts`), agency role×scope (9 roles), operator gates |
| LDAP/SAML/SSO | 🟡 | Supabase auth (email + OAuth); enterprise SSO = a V1.1+ note on the Enterprise tier |
| TLS everywhere | ✅ | HTTPS end-to-end + HSTS preload (`_headers`) |
| SEO tools (URLs, canonical, sitemaps) | ✅ automatic | canonical/OG/sitemap/robots/redirects emitted by construction — AEM makes this author work |
| CI/CD (Cloud Manager) | 📋 | FD-S5 (CI gate) |
| Real-time analytics integration | 🟡 by choice | customer sites are deliberately tracker-free (Phase Q's no-consent-needed differentiator); business signal arrives via Connected Platform reads instead |

**Part 1 verdict:** every AEM capability that fits Studio OS's market is **built, queued with an owner, or rejected on constitutional grounds with reasoning** — after this review, nothing is unaccounted for. The two genuinely new queue items surfaced: **FD-AEM1** (public headless content API — the model is already headless-shaped) and **FD-AEM2** (conversational editing, Future).

---

## Part 2 — Managed Services operational commitments vs ours

*(Adobe's page timed out on fetch; commitments below are its well-established public structure, labeled as such.)*

| AEM Managed Services defines | Studio OS today (verified) | Gap → action |
|---|---|---|
| Uptime SLA tiers (~99.5–99.99%) | inherited: Netlify CDN (static sites — effectively CDN-grade) + Supabase (function/DB); **no formal published SLA of our own** | publish an honest availability statement at launch (folds into FD-R1 policy work + Phase N) |
| Backup + recovery (defined RPO/RTO) | content: every publish an immutable snapshot (RPO≈0 for published work, RTO = one restore click); DB: **PITR = owner activation** + a restore drill (gated) | already on the activation checklist — unchanged |
| Environments (dev/stage/prod) | staging + prod Supabase projects, per-env deploys, migration parity (hold-back ritual FD-S4) | adequate for our scale; FD-S4 stays V1.1 |
| Monitoring + alerting | `/system/health` capability map + audit ledgers; external alerting = owner activation (FD-S2) | unchanged, gated |
| Maintenance/patching windows | atomic function swaps (zero-downtime deploys); static sites never "go down for maintenance" | ✅ structurally better — document it (done in the new spec doc) |
| Security program (pen tests, ISO/SOC2) | deny-all RLS, rate limiting (S), sanitized dev-mode, HMAC tokens, HSTS/CSP; compliance *certifications* inherited from Supabase/Netlify/Stripe (SOC2) | honest posture documented; own certifications = far-future |
| Customer Success Engineer / support tiers | **Phase P's support-tier matrix** (`commerce/support.ts`) — per-plan onboarding/response/implementation/training/maintenance | ✅ shipped this week, live in `/commerce/plans` |
| Disaster recovery | static sites survive platform outages by construction (CDN-served bytes); function/DB DR = provider + PITR | documented in the new spec doc |

**Part 2 verdict:** structurally at-or-better (static output is a DR strategy AEM can't match); the deltas are *formalization* — a published availability statement and the already-gated activation items (PITR drill, alerting). Nothing new to build.

## Part 3 — Technical requirements (6.5 + 6.5 LTS) vs ours

AEM asks customers/operators to provision: **5 GB disk + 2 GB+ RAM (15 GB temp for Forms), Oracle/Azul Java 8/11 (17/21 on LTS only), RHEL/Debian/SUSE (Windows restricted), Jetty/JBoss servlet engines, MongoDB Enterprise 4.2+/6–8 (no sharding, WiredTiger only), Oracle 19c/SQL Server for Forms, Apache/IIS + Dispatcher 4.3.2+, evergreen browsers, desktop-class authoring screens.**

Studio OS's answer is architectural, and it's now written down the way Adobe writes theirs — **new doc: [TECHNICAL-REQUIREMENTS-AND-SERVICE-DESCRIPTION](TECHNICAL-REQUIREMENTS-AND-SERVICE-DESCRIPTION.md)** (implemented this phase): the customer requirement is **a browser**; the operator requirement is the two Supabase projects + Netlify + the secrets in ENV-AND-SECRETS; sizing is per-site caps (media cap from the manifest, AI capacity per plan) instead of RAM/disk math; there is no Java/servlet/Dispatcher/repository matrix **because there is nothing to install** — the LTS-migration problem AEM customers face (Java 11→17 forced moves) structurally cannot happen to a Studio OS customer.

## Implemented from this comparison

1. **TECHNICAL-REQUIREMENTS-AND-SERVICE-DESCRIPTION.md** — the missing AEM-style product/ops spec (requirements, sizing, environments, availability/backup/DR posture, maintenance model, browser support, security program), written honestly against the code.
2. **Queue:** FD-AEM1 (headless content delivery API, V1.1+) · FD-AEM2 (conversational editing, Future) · asset-versioning note folded into FD-20 · enterprise-SSO note on the Enterprise tier.
3. Everything else the specs demand was verified as already built, already queued with an owner (FD-T3/T5/T6/T7/T11/T12/FD-7/12/18/20/M9/R4/S2/S4/S5), or rejected constitutionally — no silent gaps remain.
