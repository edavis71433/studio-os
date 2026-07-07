# L4.4 — Connected Platform Validation & Hardening

The whole Connected Platform (L4.0 foundation → L4.1 reads → L4.2 intelligence → L4.3 writes), validated as if Studio OS launches tomorrow. No new providers, no new features — this milestone attacked the platform, hardened what broke, and proved it stays calm, safe, explainable, and trustworthy under every realistic condition.

**Result:** 3 real weaknesses found and fixed; 35 pure + 18 live-integration validation checks passing; full pipeline regression green; deployed to staging + prod.

---

## 1. Connected Platform Validation Report

The full lifecycle was exercised end to end, every stage verified:

| Stage | Verified by |
|---|---|
| Connection | live: `GET /connections` groups services in plain words; connect via OAuth (signed state) or read-only key |
| Authentication | live: API-key connect stores an encrypted secret; OAuth flow builds a consent URL and now verifies a signed state on callback |
| Encrypted token storage | live: stored ciphertext ≠ the key; deny-all RLS; fail-closed with no key |
| Provider reads | pure + live: bearer-GET, isolated, marks health, never throws |
| Normalization | pure: raw JSON → one shared shape; garbage never throws |
| Evidence → Judgment → Recommendation → Moments → Concierge | pure: every connected type is catalogued and judged by exactly one rule; connected customer rules have rec rules and moment templates; the concierge speaks connected data in plain words |
| Write Plan → Approval → Execution → Verification → Audit | live: prepare → *execute-before-approve refused (409)* → approve → execute → verify (read-back / prepared-not-sent) → audit trail |
| Disconnect / Reconnect | live: disconnect destroys the secret + clears cache + marks disconnected; reconnect is the same connect flow |

**Live integration: 18/18** (reads 6, writes 7, validation/concurrency 5). **Pure validation: 35/35.** Pipeline regression: evidence 25, judgment 23, recommendation 26, moments 23, concierge 26, connected-reads 15, connected-intelligence 31, connected-writes 23 — all green.

### Weaknesses found and fixed (hardening)

1. **Unvalidated OAuth state (replay/CSRF).** The `state` parameter was generated but never checked on callback. **Fixed:** `signState`/`verifyState` — a sealed (AES-GCM, unforgeable) token binding the exact site + provider + timestamp, verified server-side before any code is exchanged. Cross-site, cross-provider, tampered, stale, and empty states are all refused.
2. **Non-atomic execution (double-write).** Concurrent or duplicate `execute` calls could each pass the status check and write twice. **Fixed:** an atomic claim (compare-and-swap on `executed_at` while still `approved`) — only one caller proceeds; a second is refused (`409 in_progress`); an interrupted claim becomes reclaimable after a 2-minute staleness window so it is never wedged. **Proven live:** two simultaneous executes → exactly one `200`, one `409`, executed once, one audit event.
3. **Over-promising rollback copy.** `gbp_hours` claimed "previous hours are saved" even when the read layer never captured them. **Fixed:** the plan's summary and rollback text are now conditional and truthful.

---

## 2. Security Review

| Control | Status |
|---|---|
| Least privilege | Every provider declares read-oriented scopes; nothing broader than declared is requested |
| Token encryption | AES-256-GCM before the DB; only ciphertext + iv stored, never returned to a client; fail-closed with no key |
| Secret references | Tokens out-of-row in `presence_connection_secrets`; the connection row holds only a `secret_ref` |
| Key rotation | A new `CONNECTION_ENC_KEY` invalidates old sealed tokens (open returns null) → the customer reconnects; no plaintext is ever exposed |
| Approval enforcement | Enforced in the route **and** in the executor (defense in depth); `requires_approval` is a schema CHECK constant |
| Audit completeness | Every connection and write lifecycle step is an append-only `presence_connection_events` row (non-sensitive detail only) |
| Permission isolation | A failing provider marks its own health and returns null; it never touches another provider or the run |
| Tenant isolation | Every query is scoped to the `site_id` resolved from the authenticated principal; deny-all RLS on all connected tables; signed state is site-bound |
| No plaintext secrets | Verified: sealed values never contain their input |
| No privilege escalation | Reads are GET-only; writes are gated on owner-registered scopes and approval; handoffs touch no provider |
| No provider bypass of the contract | One registry, one auth flow, one read adapter, one executor; a connected observation is an evidence type or it doesn't exist |

---

## 3. Failure Matrix

Every failure degrades to calm, honest, safe behavior:

| Failure | Behavior |
|---|---|
| Expired OAuth token | Silent refresh; if it truly lapses → `expired` / "needs a quick reconnect" (calm, one tap) |
| Revoked permission | Treated as a clean disconnect the customer chose; thanked, not chased |
| Invalid scope / missing permission | Read/write fails isolated; health marked; nothing invented |
| Rotated credentials / key | Old tokens open to null → `not_connected` → reconnect; no plaintext leak |
| Provider outage / HTTP / network / DNS failure | Health = down; last-known data kept and labelled by `last_sync_at`; retried on the next natural read |
| Rate limit / quota exhaustion | Backs off; customer sees nothing; stale-but-honest beats hammering |
| API version change | Adapter fails closed and isolated; one provider breaking never touches another |
| Deleted account / resource | Read returns null; marked disconnected/attention; nothing kept that isn't ours |
| Malformed response | Normalizers degrade to a safe label-only shape; never throw |
| Timeout | 8s read / 10s write abort; isolated failure |
| Clock skew | Token expiry is a soft check; a stale token simply triggers refresh or `not_connected` |
| Duplicate callback / replay | Signed state must verify (fresh, site+provider-bound); the provider's single-use code rejects a replayed exchange |
| Concurrent approval / duplicate execute | Atomic claim — exactly one executes, others refused; **never writes twice** |
| Interrupted execution | Claim becomes reclaimable after 2 min; nothing half-done; approval stands |
| Rollback failure | Rollback is a *reviewed* inverse plan; if it can't be prepared, the honest explanation is returned |
| Customer disconnect during execution | Token gone → `not_connected`; the write simply doesn't run; nothing half-applied |

---

## 4. Recovery Matrix

| Situation | Recovery path |
|---|---|
| Connection lapsed | One-tap reconnect (same connect flow); silent token refresh where possible |
| Read failed | Automatic retry on the next natural read; last-known data kept until then |
| Write failed (provider rejected) | Plan released back to `approved` (retryable); failure audited; nothing half-done |
| Write interrupted | Claim self-releases after the staleness window; re-execute is safe |
| Executed write regretted | `rollback` prepares a reviewed inverse plan (hours restore / post delete) or explains why undo is unneeded |
| Key rotated | Customers reconnect; no data lost in the clear |
| Provider outage | Self-heals on recovery; no manual intervention; no background storm |
| Wrong/forged callback | Refused by state verification; the customer restarts connect; nothing changed |

---

## 5. Performance Report

The platform is **on-demand and pure by design** — the properties that matter for launch are structural, not tuning-dependent:

- **No background jobs, no polling.** Reads happen only on an explicit refresh or an observation run; there is no per-connection scheduler to overload.
- **Provider isolation bounds blast radius.** Each read/write is independently timed out (8s / 10s) and isolated; one slow provider never stalls the others or the run.
- **Bounded outputs regardless of scale.** The pipeline is pure and deterministic; measured in the engine suites: **5,000 evidence items judged in <250 ms**, recommendations bounded by rule count, **≤3 business moments** always. Connected data adds a fixed handful of evidence types — it cannot explode the pipeline.
- **Write preparation is pure** (plan building has no I/O); execution is a single provider call + one verify read.
- **Large accounts / many providers / many customers:** normalization reduces any account to a small fixed shape before it enters the pipeline; per-customer work is independent and tenant-isolated; concurrency on a single plan is serialized by the atomic claim.

Network-bound stages (provider reads/writes) are inherently variable and are handled by isolation + timeouts + honest `last_sync_at`, never by blocking the customer.

---

## 6. Provider Certification Report

Every provider is certified against the same contract (no per-provider exceptions):

- **21 providers** across 9 categories, all behind one `ConnectedProvider` contract; all `reads` declared; `futureWrites` declared.
- **Reads:** representative normalizers shipped; all degrade safely; all isolated.
- **Writes:** only where safe + verifiable. **3 write workflows** (GBP post, GBP hours, Search Console verify) + **3 handoffs** (calendar, email, social — prepared, never sent). Providers without a safe, verifiable write (Analytics, Yelp, live Calendar API, …) are certified **read-only** — the milestone's rule, enforced by the registry.
- **Certification checklist per provider:** one contract ✓, declared capabilities ✓, least-privilege scopes ✓, plain-language profile ✓, isolation ✓, disconnect ✓. No provider can bypass the pipeline or the plan/approval architecture.

---

## 7. Customer Ownership Verification

Ownership is a single platform constant, identical for every provider (`OWNERSHIP` in `connected/contract.ts`):

- **Connect** — the customer approves on the provider's own screen (OAuth) or pastes a read-only key.
- **Disconnect** — always available, never penalized; destroys tokens, clears cache, ends access immediately; **the account and data AT the provider are untouched**.
- **Export** — always includes what was read.
- **Leave Studio OS** — never penalized; no integration creates lock-in.
- **Replace providers** — providers are adapters behind the contract; switching one never changes the customer experience.
- **Revoke access** — one switch, any time; best-effort provider revoke + local token destruction.

Verified: the ownership answer is the customer's account + authorization on every provider; no provider claims to be un-disconnectable.

---

## 8. Operational Runbook

- **Activate a provider's reads (owner):** register an app at the provider's console, set redirect to `${SITE_URL}/connections-callback.html`, request the declared least-privilege scopes, set `CONNECTED_<KEY>_CLIENT_ID/_SECRET`. Until then a connect attempt is honestly "not available on this environment yet."
- **Activate a provider's writes (owner):** additionally set `CONNECTED_<KEY>_WRITE=1`. Until then an approved real write returns "not available yet" with the approval preserved.
- **Encryption key:** `CONNECTION_ENC_KEY` (32-byte base64) must be set (it is, on staging + prod). Rotating it forces reconnects — announce before rotating.
- **Deploy:** `supabase-go.exe functions deploy presence --project-ref <ref> --no-verify-jwt` (the "Docker not running" warning is benign); confirm "Deployed Functions".
- **A connection shows "needs a quick reconnect":** expected after a token truly lapses — the customer taps reconnect; no operator action.
- **A write is stuck "in progress":** it self-clears after the 2-minute staleness window; then re-execute.
- **Audit:** read `presence_connection_events` (filter by `site_id`, `provider_key`) — every connect/read-health/write step is there.
- **Rollback a write:** `POST /connections/:key/write/:id/rollback` — prepares a reviewed inverse plan or returns the explanation.

## 9. Launch Checklist

- [x] Full lifecycle validated end to end (18/18 live, 35/35 pure)
- [x] Every failure mode degrades safely (Failure Matrix)
- [x] Every failure recovers safely (Recovery Matrix)
- [x] Security review clean (encryption, least privilege, approval, audit, isolation, tenant isolation, signed state)
- [x] Ownership preserved on every provider; no lock-in
- [x] Every write: approval-required, plain-language, verified, audited, reversible-or-explained, no silent/auto writes, no bypass
- [x] Connected intelligence strengthens only; no duplicates, no contradictions, edition-aware
- [x] Customer experience is plain-language and calm; no jargon leaks
- [x] Deployed to staging + prod; migration history intact
- [ ] **Owner setup before real external activity:** register provider apps + write scopes (dashboard steps); rotate any credentials shown in chat; confirm prices/nav before go-live push (standing gate)

---

## Final review

- **Would I connect my own business?** Yes — read-only by default, approval on every write, plain language throughout, disconnect any time.
- **Would I trust Studio OS with every connected account?** Yes — encrypted fail-closed tokens, least privilege, complete audit, tenant + provider isolation, no bypass.
- **Would I recommend this architecture to another SaaS company?** Yes — one contract, one auth flow, one read adapter, one executor; capabilities declared not assumed; providers are replaceable adapters; safety (approval, verification, rollback) is structural, not per-feature.
- **Can every failure be explained?** Yes — the Failure Matrix covers each; the customer sees calm, honest states, never raw errors.
- **Can every failure recover safely?** Yes — the Recovery Matrix; nothing is ever half-done or wedged.
- **Does the customer always remain in control?** Yes — they own the account, approve every write, and can disconnect/leave with no penalty.
- **Does the Connected Platform feel calmer than competitors?** Yes — nothing writes without approval, nothing is auto-posted, observations never nag, and good news is celebrated calmly.
- **What did validation remove or simplify?** It removed an over-promise (the "hours saved" rollback claim, now truthful) and collapsed two brittle failure paths into one atomic claim; it added no features and no providers. The platform was already minimal — validation made it *honest* and *concurrency-safe*, not larger.
