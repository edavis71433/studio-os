# Studio OS — Launch Board

One prioritized plan consolidating every fix from the L5.8 Launch Readiness Review. Work top-to-bottom; don't start a lower tier until the tier above is green. Each item: **owner** (who unblocks), **why it's here**.

Legend — Owner: 🧑 = requires the human owner (Eric); 🤖 = buildable by Claude; 🔒 = external (registrar/provider/legal counsel).

---

## 🚦 MUST FIX BEFORE BETA
*Nothing ships to a single paying customer until every box here is checked.*

| # | Item | Owner | Why |
|---|---|---|---|
| B1 | **Cross the go-live gate**: confirm the L1 prices, register the Stripe *subscription* webhook events, add nav links to the new pages, then **push the 25 commits** | 🧑 | Nothing since L1 is live on the website; pushing publishes real purchasable pages |
| B2 | **Portal must show the core value**: Business Moments + the Concierge, in the shipped portal (backend exists; wire the UI) | 🤖 | The intelligence is invisible without a front door |
| B3 | **CI**: one command runs the whole test suite; green required on every push | 🤖 | No automated gate today (tests need a local `$TMPDIR` incantation) |
| B4 | **Backups + a real restore test** on both Supabase projects | 🧑🔒 | You cannot sell what you can't recover |
| B5 | **Reconcile migration history** so a single migration applies without the hold-back ritual | 🤖 | The current ritual is manual and one typo from a prod mistake |
| B6 | **`svc()` id-scope security audit**: every service-role query that takes a request-supplied id must filter by tenant/site/org | 🤖 | Service role bypasses RLS; one missing filter = cross-tenant leak |
| B7 | **Secret rotation confirmed** (Netlify token, any password shown in chat); never reset `edavis7143@yahoo.com` | 🧑 | Historical exposure |
| B8 | **Basic monitoring + alerting** (function errors, failed deploys, DB health) + a one-page incident runbook | 🧑🤖 | Operating blind is not acceptable for paid users |
| B9 | **In-product AI disclosure** at the point of generation + confirm AI-capacity metering is enforced | 🤖 | Legal + trust; manual path must stay first-class |

---

## 🟡 SHOULD FIX BEFORE PUBLIC LAUNCH
*Required before opening self-serve signup to the world / selling to enterprise.*

| # | Item | Owner | Why |
|---|---|---|---|
| P1 | **Connected Platform UI + `connections-callback.html`**, and register the provider OAuth apps you actually want live | 🧑🤖🔒 | Connect can't complete today; the callback page is missing |
| P2 | **Cookie Policy + consent flow** | 🤖🔒 | Public-launch legal baseline |
| P3 | **DPA + sub-processor list** (Supabase, Netlify, Stripe, connected providers) | 🧑🔒 | Hard enterprise blocker |
| P4 | **Connected-provider consent copy** in the connect flow (what's read/written, revocation) | 🤖 | Trust + legal at the moment of connection |
| P5 | **Operator/agency auth path** for the Marketplace/Enterprise management surfaces (real privileged caller, not service-role→public) | 🤖 | Those surfaces can't be operated cleanly today |
| P6 | **Fresh WCAG 2.2 AA pass** on templates + portal + any new UI (keyboard, zoom, VoiceOver/TalkBack, forms) | 🤖 | The bar moved; new surfaces unreviewed |
| P7 | **Measure real p95** of `/observe` + full pipeline on a large live site; check edge cold-start & bundle size | 🤖 | Backend is fast in the pure tests; verify under real load |
| P8 | **Consolidate redundant marketing pages**; let Industry Packs earn the industry pages | 🤖 | Overlap + maintenance drag |
| P9 | **Apply `pg_cron`** (or a reliable external trigger) for L2 scheduled operations | 🧑🤖 | Scheduled ops currently need external triggering |
| P10 | **Customer help / KB** + agency + enterprise onboarding guides | 🤖 | Docs serve engineers, not customers yet |
| P11 | **Retire or rename `opt_dormant`** (stop emitting evidence only to suppress it) | 🤖 | Generate-to-suppress is dead weight |
| P12 | **Scope decision**: keep Marketplace/Enterprise/Agency behind an operator flag until they have UI | 🧑 | Ship value, not surface |

---

## 🟢 CAN WAIT UNTIL v1.1
*Real, but not gating a confident launch.*

| # | Item | Owner | Why |
|---|---|---|---|
| V1 | Migrate writer/coach resolution to the Industry Pack umbrella | 🤖 | Latent duplication; harmless today |
| V2 | `connected_data.prev` → real time-series (unlocks trends) | 🤖 | One-deep history is a ceiling, not a bug |
| V3 | Deprecate the deploy `WARN: sdk.ts` noise | 🤖 | Benign |
| V4 | Marketplace agreement + Agency agreement + Enterprise MSA (once those tiers sell) | 🧑🔒 | Only needed when the tier is live |
| V5 | Public API reference for the routes | 🤖 | Nice-to-have until you have API customers |
| V6 | Status page + formal on-call/release process | 🧑 | Scales with customer count |
| V7 | Shared design tokens/components for future management UIs | 🤖 | Prevents divergence as UIs get built |
| V8 | Deepen restaurant (and other packs') intelligence beyond the current shallow rule sets | 🤖 | Quality, not readiness |

---

## The one-paragraph plan

**Beta is close.** The engine is done and trustworthy; the beta work is almost entirely *plumbing to a front door and basic ops*: push what's built (B1), make the portal show Moments + Concierge (B2), stand up CI + backups + monitoring (B3, B4, B8), and close the two security items (B5, B6). **Public launch** adds the connected UI + legal + a11y + the operator-auth path. **Everything else waits for v1.1.** Do not let the breadth of the platform (marketplace, enterprise, agency) pull the beta scope wide — those are proven foundations that can ship behind a flag and get their UIs after the core product is live and monitored.
