# L5.8 — Complete Platform Integration & Launch Readiness Review

*Analysis only. No code changed. Reviewed as one integrated platform (M1 → L5.7), attacked from every angle. Honest critique, prioritized for launch.*

---

## Executive Summary

Studio OS is an **unusually coherent, deeply-tested backend** with a rare architectural discipline: one intelligence pipeline, one approval spine, frozen contracts guarded by 14 machine-enforced invariants, and every later capability (optimization, connected platform, industry packs, marketplace, enterprise, agency) added as **data + orchestration** over that frozen core — with zero engine changes and the invariants held at every milestone. The engine is genuinely strong; I would trust its *logic*.

The gap is not the architecture. It is the distance between a **superb backend** and a **shippable product**:

- **25 commits are unpushed.** Everything from L1 (commerce) through L5.7 (agency) is deployed to the Supabase backends (staging + prod) but **not published to the website** — the site still predates self-serve commerce. The go-live gate (owner must confirm prices, register Stripe subscription events, add nav links) has never been crossed.
- **The L4/L5 capabilities are API-only.** Connected Platform, Marketplace, Enterprise, Industry Packs, and the new Agency orchestration have **no customer or operator UI**. They are proven backends with no front door.
- **The OAuth `connections-callback.html` does not exist**, so even a fully-configured connected provider can't complete a connect.
- **Legal is incomplete** (no Cookie Policy, no DPA/sub-processor list — a hard enterprise blocker).
- **Operations are immature** (no CI, a manual + error-prone migration ritual, no documented monitoring / alerting / backup / DR / incident response).

**Readiness by dimension:** Architecture 9/10 · Security 8/10 · Backend correctness 9/10 · **Customer-facing 4/10** · **Legal 5/10** · **Operations 4/10**. **Overall: 6.5/10 — a beta-ready engine, not a public-launch-ready product.** The remaining work is front-end, legal, and ops — *not* redesign.

---

## Architecture Review

**Strengths (keep):** the two frozen spines (Intelligence pipeline, Approved-Plan lifecycle); extension-by-additivity with a machine-checked freeze (`platform_invariants_test`); the L4.5 consolidation that removed the one real duplication (two approval systems → one). Provider isolation, determinism, and catalog-gated evidence are principal-grade.

**Duplication / debt found:**
- **Two per-vertical registries not yet unified at the call site.** L5.0 declared the writer pack + coach pack as *layers* of the Industry Pack, but the live call sites (`writer/pack.ts:packFor`, `coach/packs.ts:growthPackFor`) are still called directly by the writer/coach engines. The umbrella *subsumes* them but hasn't *replaced* their resolution. Low risk, real debt.
- **`opt_dormant` is a graveyard.** It holds unrelated silent evidence types (slowing testimonials, location-term heuristics, Twitter cards) emitted only to be suppressed. The platform *generates observations solely to hide them*. Either stop emitting them or split into honestly-named silent buckets.
- **Operator auth for the new surfaces is unresolved.** Marketplace and Enterprise operator routes gate on `staff || system`, but service-role resolves to `public` and `system` requires the scheduler secret — so there is no clean programmatic operator path, and the full operator HTTP lifecycle is only exercisable by a real staff login (which has no UI). This is an architecture *and* a product gap.
- **Migration history is load-bearing tribal knowledge.** Applying one migration needs the hold-back ritual because remote `schema_migrations` only records some files. Documented, but manual and error-prone.

**Recommend:** reconcile migration history; migrate writer/coach resolution to the umbrella; retire or rename `opt_dormant`; design a first-class operator/agency auth path for the management surfaces.

## Product Simplification Review

The **engine** is not over-built — every subsystem earns its place and the calm-software discipline already cut low-value signals (L3.4). Where simplification is warranted is the **surface**: the marketing site has proliferated (many near-duplicate industry landing pages — `restaurant-web-design`, `salon-web-design`, `retail-web-design`, `home-services-web-design`, `health-wellness-web-design`, plus `roi-calculator`, `pricing-estimator`, `report-card`, `buy-audit`, `audit`, `ai-critique`). These predate the Industry Platform and now overlap with what a real Industry Pack could generate. Consolidate before adding more.

## AI Value Review

The AI passes its own test *because it is constrained*: the Concierge is **deterministic** (not an LLM chatbot), findings are fact-grounded (Law 11), everything is approval-gated with a manual twin (Law 25), and nothing auto-publishes. Would each still exist without AI? The Writer/Editor/Coach genuinely reduce work and have manual parity; the Reviewer/Guardian/Concierge are largely deterministic and would exist regardless. **Nothing to remove.** One thing to watch: the real model calls (Writer/Coach) — confirm AI-capacity metering (L2) is enforced pre-launch and that the "write it by hand" path is never second-class in the UI (there is no UI yet to check).

## Customer Experience Review

**The biggest product gap.** L1 signup/first-run exists; the entire L4/L5 value (connect your Google listing, install industry features, manage locations, agency dashboards) has **no interface**. A customer cannot connect a provider (no callback page), see business moments in a shipped UI beyond the portal, or experience the industry-aware behavior. Friction is not subtle wording — it is *absence of the front door* for the newest, most differentiating capabilities. Empty/loading/error states, notifications, and onboarding for these surfaces don't exist yet.

## Trust Review

The trust *fundamentals* are excellent and constitutional: calm software, sentences-never-scores (Law 13), ownership constants, approval everywhere, plain-language plans that state "what stays." The risk is that **none of this trust copy is carried by a UI** for the new surfaces — the reassurance lives in API responses and docs, not in front of a customer. Also audit the marketing pages for over-"AI" language (`ai-critique`, `ai-disclaimer`) against the calm, ownership-first voice.

## Accessibility Review

Strong foundation: M8 shipped a real trust/a11y layer (focus capture/return, live regions, contrast, target sizes, reduced motion), and `accessibility.html` / `a11y.html` exist; templates are WCAG-AA-by-construction (Law 17). **But** the new surfaces have no UI to audit, and the marketing pages predate the current bar. **Recommend a fresh WCAG 2.2 AA pass** on the rendered templates + portal + any new surface UI, including keyboard order, zoom/large-text, VoiceOver/TalkBack, forms, and the (future) tables/queues in agency/enterprise views.

## Security Review

**Strong:** deny-all RLS on every table, function-mediated access, AES-256-GCM tokens that fail closed, `requires_approval` as DB CHECK constants across five surfaces, tenant/org/location isolation, signed OAuth state, atomic execution claims, and the invariants suite. **Concerns to close before launch:**
- **Operator-auth path** for marketplace/enterprise (above) — currently no clean privileged caller.
- **Secret hygiene** — a temp password and the Netlify token were shown in chat historically; confirm rotation; never reset `edavis7143@yahoo.com`.
- **Global sentinels** — the all-zero `site_id` for global marketplace/org ops is a convention, not a guarded scope; confirm no cross-tenant read via it.
- **Service-role breadth** — `svc()` uses the service role for all function I/O; a single missing site/tenant filter would bypass RLS. Worth a targeted audit of every `svc()` query that takes an id from the request.
- A dedicated penetration test of the connect → write → disconnect and the approval lifecycles.

## Legal Review

**Have:** `terms.html`, `privacy.html`, `accessibility.html`, `ai-disclaimer.html`, `portal-terms.html`. **Missing / must add before the relevant launch:**
- **Cookie Policy** + consent flow (public launch).
- **Data Processing Agreement + sub-processor list** (Supabase, Netlify, Stripe, and every connected provider) — **hard enterprise blocker**.
- **Marketplace agreement** (pack authorship, licensing, `community` vs `platform`) once packs are sold/shared.
- **Agency agreement** and **Enterprise MSA** for those tiers.
- **In-product AI disclosure** at the point of generation (not only a static page).
- **Connected-provider consent language** (what is read/written, revocation) surfaced in the connect flow.
- **Export/leave language** — the *right* exists in product (Law 2); it needs matching legal text.

## Performance Review

**Backend:** excellent and measured — 5,000 evidence items judged <250 ms; 1,000 packs and 10,000 locations resolved ~10 ms; deterministic engines; provider reads isolated + timed out; portfolio is fixed-query regardless of client count. **Unmeasured / to do:** real p95 of `/observe` and the full pipeline on a large live site; edge-function cold-start and **bundle size** (the function has grown to ~23 modules + industry/enterprise/marketplace); the benign deploy `WARN: sdk.ts` noise; CDN/caching posture of the actual website; DB index review as `presence_org_config` / operations tables grow.

## Operations Review

**The weakest dimension.** Gaps that are launch-blocking for a paid product:
- **No CI.** Tests run only via a local Deno node-compat shim that needs `$TMPDIR` set; a stranger (or future-you) can't run them reliably. There is no automated gate.
- **Manual, error-prone migrations** (the hold-back ritual) and **manual deploys** (`supabase-go`).
- **No documented monitoring, logging, alerting, backups, DR, or incident response.**
- **`pg_cron` not applied** (L2 scheduled operations rely on `/system/run` being triggered externally).
- No release process, no on-call, no status page.

## Documentation Review

**Strong where it exists:** 46 architecture/contract/SDK/validation docs — genuinely excellent internal engineering documentation, and a real third-party SDK guide. **Gaps:** customer help / knowledge base; an API reference for the routes; agency + enterprise onboarding guides; operational runbooks (partial); the employee handbook (not written — review only, as instructed). The docs serve engineers well and customers/operators not at all yet.

## Design Review

Consistency can't be fully assessed because the new surfaces have no UI. The existing site + portal + templates carry a coherent, premium, calm voice and the M8 trust layer. The risk at launch is *inconsistency between the mature marketing/portal design and the yet-to-be-built management surfaces* — set the design tokens/components now so agency/enterprise/connected UIs inherit them rather than diverging.

---

## Technical Debt Register

| # | Debt | Severity | Note |
|---|---|---|---|
| 1 | 25 unpushed commits / go-live gate uncrossed | **Blocker** | website predates all of L1–L5.7 |
| 2 | No UI for Connected/Marketplace/Enterprise/Industry/Agency | **Blocker** | API-only |
| 3 | Missing `connections-callback.html` | **Blocker (if OAuth)** | connect can't complete |
| 4 | No CI; test runner needs `$TMPDIR` incantation | High | no automated gate |
| 5 | Migration history reconciliation (hold-back ritual) | High | manual, risky |
| 6 | Operator/agency auth path for management surfaces | High | service-role→public |
| 7 | Legal: Cookie Policy, DPA + sub-processors | High | enterprise blocker |
| 8 | No monitoring / alerting / backup / DR / incident response | High | ops maturity |
| 9 | `pg_cron` not applied | Medium | scheduled ops external |
| 10 | writer/coach not migrated to Industry umbrella | Medium | latent duplication |
| 11 | `opt_dormant` graveyard (emit-to-suppress) | Low | tidy or remove |
| 12 | `connected_data.prev` one-deep history | Low | ceiling for trends |
| 13 | Deploy `WARN: sdk.ts` noise | Low | benign |

## Launch Blockers (must be true before public launch)

1. Cross the go-live gate: owner confirms prices, registers Stripe subscription webhook events, adds nav links, **push**.
2. Ship a UI (or scope the launch): at minimum the portal must surface Business Moments, the Concierge, and — if connected launches — the connect flow + `connections-callback.html`.
3. Legal: Cookie Policy + DPA/sub-processors (before enterprise), in-product AI disclosure, connected-consent copy.
4. Operations: CI, backups + a restore test, basic monitoring/alerting, an incident runbook.
5. Security: close the operator-auth gap; audit `svc()` id-scoped queries; rotate any exposed secrets.

## Recommended Removals

- `opt_dormant` emissions (generate-to-suppress).
- Redundant marketing landing pages (consolidate the industry pages; let the Industry Platform earn its keep).
- **Scope decision:** ship Marketplace/Enterprise/Agency as *foundations behind an operator flag* at beta, not customer-facing — they have no UI and add launch surface without launch value yet.

## Recommended Improvements

CI + a one-command test task · reconcile migration history · monitoring/alerting/DR runbooks · the missing legal docs · build the connected UI + callback · a real staff/agency operator-auth path · design tokens shared with the future management UIs · migrate writer/coach to the umbrella.

## Final Launch Checklist

- [x] **Stripe production config — DONE (Jul 9 2026):** live `STRIPE_SECRET` (`rk_live_` restricted key) set in prod; production checkout verified (`cs_live_` URL); a routing bug (`public_audit_checkout` unregistered) found + fixed + deployed. See LAUNCH-BOARD B1.
- [ ] Remaining Stripe (OWNER pre-launch, not engineering): webhook **test event** → 200 · **publish** buy-audit/audit/payment-success · one **test-mode subscription signup** · one **test-mode invoice payment**
- [ ] Prices confirmed by owner; Stripe subscription events registered; nav links added; **commits pushed**
- [ ] Portal surfaces Moments + Concierge; connect flow + callback page (if connected launches)
- [ ] Cookie Policy, DPA + sub-processor list, in-product AI disclosure, connected-consent copy
- [ ] CI green on every push; migration history reconciled; backups + restore test
- [ ] Monitoring, alerting, incident runbook, status page
- [ ] Operator/agency auth path; `svc()` id-scope audit; secret rotation confirmed
- [ ] Fresh WCAG 2.2 AA pass on templates + portal + any new UI
- [ ] p95 of `/observe` + pipeline measured on a large live site; cold-start acceptable
- [x] Backend architecture, contracts, invariants, security fundamentals (already strong)

## Launch Readiness Score — **6.5 / 10**

*Justification:* The **engine** is a 9 — coherent, frozen, invariant-guarded, deeply tested, secure at the data layer, and proven live. But launch readiness is a product-and-operations score, not an architecture score, and on those axes the platform is early: no front door for its most differentiating capabilities, an uncrossed go-live gate, incomplete legal, and immature operations. **This is a platform to be proud of and not yet ready to sell publicly.** The path to launch is short and clear precisely because the hard part — the architecture — is done.

---

## Final Questions (answered honestly)

- **What would stop it from becoming the best in its category?** Not the architecture — the absence of a customer/operator UI for the L4/L5 capabilities, and operational immaturity. The best-in-category *bones* are here.
- **What still feels unfinished?** The front end for everything after L1, operations, and legal.
- **What would you remove?** `opt_dormant` emissions; redundant marketing pages; and I'd *gate* Marketplace/Enterprise/Agency out of the beta surface.
- **What would you simplify?** The marketing surface; the migration ritual (reconcile it); the operator-auth story.
- **What surprised you?** How disciplined the backend is — the freeze + invariants are genuinely rare — and, conversely, how far ahead the backend is of everything customer-facing.
- **What is now unnecessary?** `opt_dormant`; some duplicate landing pages; possibly shipping the enterprise/marketplace UIs at beta.
- **What deserves another review?** The `svc()` service-role query surface (security), and the real-world performance of a large live pipeline.
- **What absolutely must be completed before launch?** The five Launch Blockers above.
- **Would you confidently sell this to enterprise customers?** The *engine*, yes. The *product* — not until the DPA, the management UI, and operational maturity exist.
- **Would you confidently run your own business on it?** Yes for the intelligence and the safety model; with the caveat that I'd want monitoring, backups-tested, and the connect UI first.

---

See **`LAUNCH-BOARD.md`** for the consolidated, prioritized execution plan (Must Fix Before Beta / Should Fix Before Public Launch / Can Wait Until v1.1).
