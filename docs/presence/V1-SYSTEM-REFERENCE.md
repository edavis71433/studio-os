# V1 System Reference — Studio OS Presence

**The current, whole-platform picture.** Documentation only; describes the system as it exists at Version 1 (feature-frozen, QA-passed). Where this and the [Constitution](constitution/) disagree, the constitution wins. Supersedes `ENGINEERING-ATLAS.md` for anything after M8.5 (the Atlas remains the deeper narrative for M1–M8.5).

**Audience:** a senior engineer inheriting the system. Read this, then [PLATFORM-CONTRACTS](PLATFORM-CONTRACTS.md) and the [Constitution](constitution/03-final-constitution.md), before changing anything.

---

## 1. Executive System Overview

**What it is.** A calm SaaS that keeps a small business's public presence — website first, then listings/reviews/analytics — correct, found, and growing, without the owner operating software. The owner states **facts**; the platform owns **presentation** and **intelligence**.

**Why it exists.** Every other tool (Wix/Squarespace/WordPress) makes the owner a webmaster. Presence abolishes that job: there is no page editor because there are no pages to edit — there are facts and deterministic projections of facts.

**How it holds together — two frozen spines:**
1. **The Intelligence Pipeline** (understand the business): `Evidence → Judgment → Recommendation → Business Moments → Concierge`. Pure, deterministic, one-way; each stage consumes only the prior; nothing bypasses it.
2. **The Approved-Plan Lifecycle** (change the world outside the customer's draft): `Propose → Review → Approve → Atomic Claim → Execute → Verify → Audit → Rollback`. One implementation (`lib/approved_plan.ts`), reused by every executor (infrastructure, connected writes, marketplace, enterprise, visual).

Everything else is **data and composition** over those two spines. That is why the platform grew from a single restaurant site (M1) to an industry platform with connected providers, a marketplace, enterprise multi-location, and agency orchestration (L5.7) — with **zero engine changes** (invariants 14/14 held throughout).

**The editions ladder:** Presence Monitor → Presence → Presence Managed → Presence Agency → Presence Enterprise → (operator surface) Studio OS. Editions are capability gates, not separate codebases.

---

## 2. Studio OS Architecture Overview

- **Runtime:** one Supabase Edge Function, `presence` (Deno/TypeScript), fronting Postgres (RLS-guarded) and Supabase Storage. A second function, `stripe-webhook`, handles billing callbacks.
- **Frontend:** static HTML (customer portal + public site) deployed to Netlify by `git push`. No SPA framework; each page talks to the `presence` function with the portal's auth pattern.
- **Boundary (every request):** CORS → resolve principal → [operator/public routes] → resolve caller site via RLS → entitlement gate → router. See [Request Flow](#request-flow).
- **Determinism:** one renderer, one pipeline. Same content snapshot → byte-identical HTML, atomically deployed, every version retained.
- **Data model:** structured content (`presence_identity/offerings/faqs/posts/…`) is the source of truth; everything else is derived (evidence, judgments, recommendations, moments) or operational (plans, audits, usage).

---

## 3. Subsystem Map

Each subsystem is a folder under `supabase/functions/presence/`. (Deep dive per subsystem is linked from the [README](README.md).)

| Folder | Subsystem | Role |
|---|---|---|
| `lib/` | Shared core | `db.ts` (svc/asUser), `site.ts` (tenant resolution), `approved_plan.ts` (the spine), `media.ts`, `provenance.ts`, `render*`, `serializer`, `diff`, `netlify` |
| `_shared/` (repo root of function) | Auth + HTTP | `resolvePrincipal`, `json` envelope |
| `middleware/` | Entitlement | `entitlement.ts` — plan gate |
| `evidence/` | Evidence Engine | pure providers → normalized `EvidenceItem`s (incl. the connected + pack providers) |
| `judgment/` | Judgment Engine | rules over evidence → judgments (audience-scoped) |
| `recommendation/` | Recommendation Engine | judgments → recommendations |
| `moments/` | Business Moments | recommendations → ≤3 merged, plain, dismissable moments |
| `concierge/` | Concierge | grounded Q&A over the pipeline output |
| `optimization/` | Optimization Engine | area-organized optimization providers + introspection |
| `writer/`,`editor` (in writer/),`reviewer/`,`guardian/` | Creative Studio | draft / edit / review / brand-guard — fact-guarded, manual-parity |
| `coach/` | Growth Coach | seasonal/holiday opportunities (observe → prepare → approve) |
| `connected/` | Connected Platform | registry, OAuth/key auth, read adapters, intelligence, write plans, executor, crypto |
| `industry/` | Industry Platform | pack contract, registry, helpers, marketplace lifecycle, SDK, the 4 packs |
| `enterprise/` | Enterprise | org→region→location inheritance, rollout plans |
| `agency/` | Agency | permissions (role×scope), portfolio, orchestration/rollups |
| `visual/` | AI Visual Studio | brand-aware image generation, approval-before-use |
| `monitor/` | Presence Monitor | read-only observation of an existing site |
| `platform/` | Platform Services | infra plans (DNS/email), launch assistant, importer/exporter/transfer |
| `commerce/` | Commerce | signup, plans, entitlements, metering, capacity, subscriptions |
| `ops/` | Operations | the unattended scheduler cycle |
| `routes/` | HTTP handlers | one file per route family; `index.ts` is the router |
| `templates/` | Renderers | versioned deterministic templates (e.g. `restaurant-classic/1.0.0`) |

---

## 4. Feature Inventory (V1)

Customer: CMS/structured content · Creative Studio (Writer/Editor/Reviewer/Brand Guardian) · Business Moments (daily) · Growth Coach · Concierge · Media upload · **AI Visual Studio** · **Connected Platform (connect a service)** · Publishing (draft→approve→live, versioned, restore) · Knowledge import · Preview · Presence Monitor (watch an existing site).
Commerce: signup · plans/editions · upgrade/downgrade · entitlements · capacity notices · Stripe checkout/subscriptions.
Operator/advanced: Admin/Ops · Industry Packs (Restaurant, Coffee Shop, Home Services, Pet Grooming) · Marketplace (install lifecycle) · Enterprise (multi-location) · Agency (portfolio/queues/rollups) · Platform Services (DNS/email/launch).
See the full classification in [Release Notes § Feature Inventory](RELEASE-NOTES.md).

---

## 5. Flows

### Request Flow
`CORS → resolvePrincipal (JWT → staff | client | system | public) → operator/public routes (commerce, marketplace, enterprise, agency, admin — gated on staff||system) → resolveSite(jwt) (RLS: gives site_id + client_id — tenant isolation) → entitlement gate (active/paused/lapsed) → route handler → { data } | { error, message }`. No stack traces or internal ids ever cross the boundary. Full detail: [API Reference](API-REFERENCE.md).

### Data Flow
Structured content (source of truth) → Evidence providers observe it (+ connected read cache + pack observations) → Judgment rules → Recommendations → Business Moments → Concierge. Publishing projects the content snapshot through the renderer to atomically-deployed HTML. Nothing flows backward.

### Approval Flow (the Approved-Plan spine)
`Propose (a plain-language plan: what changes / what stays / risk / reversible / rollback / requires_approval=true) → Review → Approve (recorded decision) → Atomic Claim (single winner via CAS on a claim column) → Execute (executor-specific) → Verify (read-back) → Audit (append-only) → Rollback (reviewed inverse or honest explanation)`. Used by infrastructure (DNS/email), connected writes, marketplace ops, enterprise ops, and visual promotion. `requires_approval` is a DB CHECK constant on every plan table.

### Publishing Flow
`Edit draft → validate → Preview (signed transform URLs) → Publish (render snapshot → atomic Netlify deploy → record presence_publishes version) → Restore (any prior version)`. Every version kept; a failed publish leaves the live site unchanged and says so.

### AI Flow
`Ask/observe → AI proposal (Writer/Editor/Coach/Visual, gated on ANTHROPIC_KEY/VISUAL_MODEL_KEY) → Fact Guard / Brand Guardian veto → Compare → Human approval → Draft → Publish`. **Manual parity** is a law: every AI path has an equal manual path. AI never publishes; it only drafts. Provenance (`ai_approved`) is recorded.

### Connected Platform Flow
`Connect (OAuth consent or read-only key) → callback (signed state verified) → read adapter (bearer GET → normalize) → connected evidence enters the ONE pipeline → intelligence (corroborate/contradict/celebrate)`. Writes are separate approval-gated plans (GBP post/hours, GSC verify) + handoffs (never auto-sent). Read-only by default; nothing changes at a provider without an approved plan.

### Industry Pack Flow
A pack is data: `catalog + providers + judgment rules + growth/creative layers`, registered by spreading into the aggregates (`...PACK_PROVIDERS`, etc.). Providers **self-gate** on the site's industry (inheritance-aware via `industryIsA`). Packs observe industry content; they never fork the engine.

### Marketplace Flow
Install/enable/disable/update/remove are Approved-Plan operations on `presence_pack_installs` / `presence_pack_operations`. Operator-gated (staff/system), before the client-site gate. Infrastructure, not commerce.

### Enterprise Flow
`Organization → Region → Location`, each storing only diffs from its parent (`composeConfig` deep-merges). Rollouts are Approved-Plan `org_operations`. One pipeline serves all locations; industry packs apply automatically.

### Agency Flow
Permissions compose `role × scope` (9 roles). The agency workspace orchestrates the existing platform: portfolio (businesses), a unified **approval queue** drawn from the plan tables, cross-org rollups. No duplication — it reads the same spines. Portfolio-scoped (403 outside your portfolio).

### Visual Studio Flow
`Choose kind (hero/social/OG/…) → describe → brand-aware brief (claim-scrubbed, fact-law-safe) → generate variations (gated on VISUAL_MODEL_KEY) → edit/vary → approve one (+ alt text) → atomic claim → promote to presence_media (ai_approved) → drafts discarded`. Nothing enters the library or the site without approval.

### Commerce Flow
`Signup (public) → checkout (Stripe) → provision (idempotent: one site per client) → entitlement active → editions gate capability`. Metering records generative AI usage (never shown to the customer); a soft capacity notice appears when generous limits are exceeded. Upgrade/downgrade flips the edition and its gates.

---

## 6. Dependency Map

```
_shared/auth ─┬─> every route
lib/db ───────┼─> every subsystem (svc = service role; asUser = RLS-scoped)
lib/site ─────┴─> tenant resolution (RLS) ─> entitlement ─> handlers
lib/approved_plan ──> platform(infra) · connected(writes) · industry(marketplace) · enterprise · visual
evidence/providers ──> optimization/engine (introspection) ; feeds judgment ─> recommendation ─> moments ─> concierge
industry/compose ──> evidence/providers (PACK_PROVIDERS) ; industry/registry ──> enterprise (industry per location)
commerce/enforce (entitlement) ──> middleware ; commerce/capacity+metering ──> AI routes
```
No cycles: the industry/enterprise/agency/visual layers depend on the spines; the spines depend on nothing above them.

---

## 7. Folder Structure (repo)

```
supabase/functions/presence/   the one edge function (subsystems in §3; index.ts = router)
supabase/functions/stripe-webhook/   billing callbacks
supabase/migrations/           0000–0044 (see DATABASE.md; hold-back technique in DEPLOYMENT-AND-OPERATIONS.md)
tests/presence/                44 suites (pure + live-staging integration)
docs/presence/                 this documentation set (README.md = index)
*.html (repo root)             customer portal + public site (Netlify)
scripts/deploy-presence.ps1    verified function deploy
```

---

## 8. Testing

- **44 suites** in `tests/presence/`. Most are **pure** (no I/O — the engines are pure functions); several have a **live-staging integration tier** gated on env vars.
- **Run pure:** `deno run --allow-read --allow-env tests/presence/<name>_test.mjs` (set `$TMPDIR=$TEMP` on Windows).
- **Run integration:** set `SB` + `SR_KEY` + `ANON` (room/pipeline/service/admin) or `SUPABASE_URL` + `SERVICE_ROLE_KEY` + `ANON_KEY` (connected/operations/commerce) to the staging project, then run.
- **Guardrails:** `platform_invariants_test.mjs` enforces 14 architectural invariants — a change that violates a frozen contract fails here. Keep it green.
- Full status: [QA-RELEASE-VERIFICATION](QA-RELEASE-VERIFICATION.md).

---

## 9. Coding Standards

- **Pure by default.** Engines and rule-sets are pure functions; I/O lives at thin boundaries (route handlers, `store.ts`, model callers). This is why the platform is so testable — preserve it.
- **Extend by appending data, not editing engines.** New evidence type → add to the catalog + a provider; new pack → spread into the aggregates; new provider → append to the registry. The engine iterates generically. Invariant INV-8 enforces this.
- **Every external change is an Approved Plan.** Never write to a provider, DNS, or the org config outside `lib/approved_plan.ts`.
- **Plain language at the boundary.** Customer-facing strings are calm merchant words; no scores/tokens/jargon (Law 13). Errors say what happened and that nothing was lost.
- **Fail closed.** Missing key → honest "not available yet", never a fake result (crypto returns null; AI/visual gate on their keys).
- **Provenance on every mutation.** `writeChangeEvent(...)` with `human | ai_approved | import`.

---

## 10. Extension — what can and cannot change

**Never change (frozen — constitutional amendment required):** the two spines (Intelligence Pipeline, Approved-Plan Lifecycle); the one-way, deterministic pipeline; `requires_approval` as a law; the renderer's determinism; the 14 invariants; the Product Laws. See [PLATFORM-CONTRACTS](PLATFORM-CONTRACTS.md).

**Safe to change / extend (by additivity):** new industry packs, connected providers, optimization providers, evidence/judgment/recommendation rules, templates, editions/capacity numbers, email presets — all as appended data. New routes are additive (see the API governance rule in the [API Reference](API-REFERENCE.md)).

**How to add the common things:** Industry Pack → [THIRD-PARTY-PACK-GUIDE](THIRD-PARTY-PACK-GUIDE.md); Connected Provider → [CONNECTED-PLATFORM](CONNECTED-PLATFORM.md); optimization provider → append to `OPTIMIZATION_PROVIDERS` and map it in `PROVIDER_AREA` (`optimization/engine.ts`).

---

## 11. Known open questions / debt

Tracked in the [Release Notes § Technical Debt Register](RELEASE-NOTES.md#technical-debt-register). Nothing open is a correctness blocker for V1.
